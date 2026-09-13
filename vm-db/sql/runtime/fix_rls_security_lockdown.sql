-- =====================================================================
-- MUMYEONG: VM DB RLS Security Lockdown Migration
-- 취약한 passthrough (USING true WITH CHECK true) 정책 전면 폐기 및
-- 소유자 기반 CUD 및 시세/거래소 테이블 SELECT 전용 잠금 적용
-- =====================================================================

-- 1. profiles: 본인만 수정/삽입/삭제 가능 (SELECT는 공개/조회용)
DROP POLICY IF EXISTS "passthrough profiles" ON public.profiles;
DROP POLICY IF EXISTS "Profiles viewable by all" ON public.profiles;
DROP POLICY IF EXISTS "Profiles insertable by owner" ON public.profiles;
DROP POLICY IF EXISTS "Profiles updatable by owner" ON public.profiles;
DROP POLICY IF EXISTS "Profiles deletable by owner" ON public.profiles;

CREATE POLICY "Profiles viewable by all" ON public.profiles
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Profiles insertable by owner" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

CREATE POLICY "Profiles updatable by owner" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

CREATE POLICY "Profiles deletable by owner" ON public.profiles
  FOR DELETE TO authenticated USING (auth.uid() = id);


-- 2. holdings: 본인만 수정/삽입/삭제 가능 (SELECT는 조회 허용)
DROP POLICY IF EXISTS "passthrough holdings" ON public.holdings;
DROP POLICY IF EXISTS "Holdings viewable by all" ON public.holdings;
DROP POLICY IF EXISTS "Holdings insertable by owner" ON public.holdings;
DROP POLICY IF EXISTS "Holdings updatable by owner" ON public.holdings;
DROP POLICY IF EXISTS "Holdings deletable by owner" ON public.holdings;

CREATE POLICY "Holdings viewable by all" ON public.holdings
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Holdings insertable by owner" ON public.holdings
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Holdings updatable by owner" ON public.holdings
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Holdings deletable by owner" ON public.holdings
  FOR DELETE TO authenticated USING (auth.uid() = user_id);


-- 3. orders: 호가창 렌더링용 SELECT 공개, 본인 주문만 등록/취소 가능
DROP POLICY IF EXISTS "passthrough orders" ON public.orders;
DROP POLICY IF EXISTS "Orders viewable by all" ON public.orders;
DROP POLICY IF EXISTS "Orders insertable by owner" ON public.orders;
DROP POLICY IF EXISTS "Orders updatable by owner" ON public.orders;
DROP POLICY IF EXISTS "Orders deletable by owner" ON public.orders;

CREATE POLICY "Orders viewable by all" ON public.orders
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Orders insertable by owner" ON public.orders
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Orders updatable by owner" ON public.orders
  FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Orders deletable by owner" ON public.orders
  FOR DELETE TO authenticated USING (auth.uid() = user_id);


-- 4. chat_messages: 조회 공개, 등록은 본인 또는 인증 유저
DROP POLICY IF EXISTS "passthrough chat" ON public.chat_messages;
DROP POLICY IF EXISTS "Chat viewable by all" ON public.chat_messages;
DROP POLICY IF EXISTS "Chat insertable by authenticated" ON public.chat_messages;

CREATE POLICY "Chat viewable by all" ON public.chat_messages
  FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "Chat insertable by authenticated" ON public.chat_messages
  FOR INSERT TO anon, authenticated WITH CHECK (auth.uid() = user_id OR user_id IS NULL);


-- 5. 시세, 거래소 원장 및 시스템 테이블 (SELECT 전용 잠금, 쓰기는 service_role만 가능)
DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'stocks', 'bonds', 'commodities', 'exchange_rates', 'admin_settings',
    'trades', 'options_contracts', 'bots_config', 'institutional_portfolios',
    'stock_price_history', 'market_indices', 'macro_calendar', 'market_news',
    'premium_news', 'financials', 'novel_events', 'sector_relations',
    'shop_items', 'player_events', 'active_player_events', 'active_manipulations'
  ];
BEGIN
  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'passthrough ' || tbl, tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'passthrough ' || substring(tbl from 1 for 2), tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'passthrough rates', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'passthrough admin', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'passthrough options', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'passthrough portfolios', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'passthrough price_history', tbl);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Public read-only ' || tbl, tbl);

    EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO anon, authenticated USING (true)', 'Public read-only ' || tbl, tbl);

    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON TABLE public.%I FROM anon, authenticated', tbl);
    EXECUTE format('GRANT SELECT ON TABLE public.%I TO anon, authenticated', tbl);
  END LOOP;
END $$;

-- 6. 슬라이딩 윈도우 트리밍 RPC (trades 5,000건 / price_history 3,000건 유지, 최소 1,000건 가드)
CREATE OR REPLACE FUNCTION public.trim_old_market_data(
  p_max_trades INT DEFAULT 5000,
  p_max_history INT DEFAULT 3000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_max_trades INT;
  v_max_history INT;
  v_deleted_trades INT := 0;
  v_deleted_history INT := 0;
BEGIN
  v_max_trades := GREATEST(COALESCE(p_max_trades, 5000), 1000);
  v_max_history := GREATEST(COALESCE(p_max_history, 3000), 1000);

  WITH to_delete AS (
    SELECT id
    FROM public.trades
    ORDER BY created_at DESC
    OFFSET v_max_trades
  ),
  del_t AS (
    DELETE FROM public.trades
    WHERE id IN (SELECT id FROM to_delete)
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_trades FROM del_t;

  WITH to_delete_hist AS (
    SELECT id
    FROM public.stock_price_history
    ORDER BY created_at DESC
    OFFSET v_max_history
  ),
  del_h AS (
    DELETE FROM public.stock_price_history
    WHERE id IN (SELECT id FROM to_delete_hist)
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_history FROM del_h;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_trades', v_deleted_trades,
    'deleted_history', v_deleted_history
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trim_old_market_data(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trim_old_market_data(INT, INT) TO service_role;

-- 7. 일괄 원자적 정산 RPC (bulk_settle_trades - service_role 전용)
CREATE OR REPLACE FUNCTION public.bulk_settle_trades(p_trades JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  trade_record RECORD;
  v_trade_count INT := 0;
  v_existing_qty INT;
  v_existing_avg NUMERIC;
  v_new_qty INT;
  v_new_avg NUMERIC;
  v_buyer_cash NUMERIC;
  v_seller_qty INT;
BEGIN
  FOR trade_record IN 
    SELECT 
      (t->>'stock_id')::uuid AS stock_id,
      (t->>'buyer_id')::uuid AS buyer_id,
      (t->>'seller_id')::uuid AS seller_id,
      (t->>'buyer_is_bot')::boolean AS buyer_is_bot,
      (t->>'seller_is_bot')::boolean AS seller_is_bot,
      (t->>'price')::numeric AS price,
      (t->>'size')::bigint AS size,
      (t->>'buyer_fee')::numeric AS buyer_fee,
      (t->>'seller_fee')::numeric AS seller_fee,
      ((t->>'price')::numeric * (t->>'size')::bigint)::numeric AS trade_amount
    FROM jsonb_array_elements(p_trades) AS t
  LOOP
    IF trade_record.price <= 0 OR trade_record.size <= 0 THEN
      RAISE EXCEPTION 'Invalid trade price or size: price=%, size=%', trade_record.price, trade_record.size;
    END IF;

    -- 1. 매수자 현금 차감 및 주식 입고
    IF NOT trade_record.buyer_is_bot AND trade_record.buyer_id IS NOT NULL THEN
      SELECT cash INTO v_buyer_cash
      FROM public.profiles
      WHERE id = trade_record.buyer_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Buyer profile not found for user %', trade_record.buyer_id;
      END IF;

      IF v_buyer_cash < (trade_record.trade_amount * (1 + COALESCE(trade_record.buyer_fee, 0.0))) THEN
        RAISE EXCEPTION 'Insufficient cash for buyer %: required=%, available=%', 
          trade_record.buyer_id, 
          (trade_record.trade_amount * (1 + COALESCE(trade_record.buyer_fee, 0.0))), 
          v_buyer_cash;
      END IF;

      UPDATE public.profiles
      SET cash = cash - (trade_record.trade_amount * (1 + COALESCE(trade_record.buyer_fee, 0.0)))
      WHERE id = trade_record.buyer_id;

      SELECT quantity, avg_price INTO v_existing_qty, v_existing_avg
      FROM public.holdings
      WHERE user_id = trade_record.buyer_id AND stock_id = trade_record.stock_id
      FOR UPDATE;

      IF NOT FOUND THEN
        INSERT INTO public.holdings (user_id, stock_id, quantity, avg_price)
        VALUES (trade_record.buyer_id, trade_record.stock_id, trade_record.size, trade_record.price);
      ELSE
        v_new_qty := v_existing_qty + trade_record.size;
        v_new_avg := ((v_existing_avg * v_existing_qty) + (trade_record.price * trade_record.size)) / v_new_qty;
        
        UPDATE public.holdings
        SET quantity = v_new_qty, avg_price = ROUND(v_new_avg, 4)
        WHERE user_id = trade_record.buyer_id AND stock_id = trade_record.stock_id;
      END IF;
    END IF;

    -- 2. 매도자 현금 입금 및 주식 출고
    IF NOT trade_record.seller_is_bot AND trade_record.seller_id IS NOT NULL THEN
      SELECT quantity, avg_price INTO v_seller_qty, v_existing_avg
      FROM public.holdings
      WHERE user_id = trade_record.seller_id AND stock_id = trade_record.stock_id
      FOR UPDATE;

      IF NOT FOUND OR v_seller_qty < trade_record.size THEN
        RAISE EXCEPTION 'Insufficient holdings for seller %: required=%, available=%',
          trade_record.seller_id,
          trade_record.size,
          COALESCE(v_seller_qty, 0);
      END IF;

      v_new_qty := v_seller_qty - trade_record.size;
      IF v_new_qty = 0 THEN
        DELETE FROM public.holdings WHERE user_id = trade_record.seller_id AND stock_id = trade_record.stock_id;
      ELSE
        UPDATE public.holdings
        SET quantity = v_new_qty
        WHERE user_id = trade_record.seller_id AND stock_id = trade_record.stock_id;
      END IF;

      UPDATE public.profiles
      SET cash = cash + (trade_record.trade_amount * (1 - COALESCE(trade_record.seller_fee, 0.0)))
      WHERE id = trade_record.seller_id;
    END IF;

    -- 3. 체결 내역 기록
    INSERT INTO public.trades (
      stock_id, buyer_id, seller_id, buyer_is_bot, seller_is_bot, price, size, created_at
    ) VALUES (
      trade_record.stock_id, trade_record.buyer_id, trade_record.seller_id,
      trade_record.buyer_is_bot, trade_record.seller_is_bot,
      trade_record.price, trade_record.size, now()
    );

    v_trade_count := v_trade_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'settled_count', v_trade_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bulk_settle_trades(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_settle_trades(JSONB) TO service_role;


