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

-- 8. 단일 트랜잭션 주문 매칭 & 정산 RPC (submit_and_match_order)
CREATE OR REPLACE FUNCTION public.submit_and_match_order(
  p_user_id UUID,
  p_stock_id UUID,
  p_side TEXT,
  p_price NUMERIC,
  p_size BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_cash NUMERIC;
  v_user_qty INT;
  v_reserved_cash NUMERIC := 0;
  v_reserved_qty INT := 0;
  v_available_cash NUMERIC;
  v_available_qty INT;
  v_required_cash NUMERIC;

  v_remaining_qty BIGINT := p_size;
  v_total_filled BIGINT := 0;
  v_last_exec_price NUMERIC := p_price;
  v_opp_side TEXT;
  v_opp_record RECORD;
  v_opp_remaining BIGINT;
  v_match_qty BIGINT;
  v_exec_price NUMERIC;

  v_buyer_id UUID;
  v_seller_id UUID;
  v_buyer_is_bot BOOLEAN;
  v_seller_is_bot BOOLEAN;
  v_buyer_fee NUMERIC;
  v_seller_fee NUMERIC;

  v_buyer_cash NUMERIC;
  v_seller_qty INT;
  v_existing_qty INT;
  v_existing_avg NUMERIC;
  v_new_qty INT;
  v_new_avg NUMERIC;

  v_new_order_id UUID;
  v_new_order_status TEXT;
BEGIN
  IF p_user_id IS NULL OR p_stock_id IS NULL THEN
    RAISE EXCEPTION 'user_id and stock_id must not be null';
  END IF;

  IF p_side NOT IN ('buy', 'sell') THEN
    RAISE EXCEPTION 'side must be either buy or sell';
  END IF;

  IF p_price <= 0 OR p_size <= 0 THEN
    RAISE EXCEPTION 'price and size must be greater than zero: price=%, size=%', p_price, p_size;
  END IF;

  -- 1. 자산 예약 확인 및 행 잠금
  IF p_side = 'buy' THEN
    SELECT cash INTO v_user_cash FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'User profile not found: %', p_user_id;
    END IF;

    SELECT COALESCE(SUM((size - filled) * price), 0) INTO v_reserved_cash
    FROM public.orders
    WHERE user_id = p_user_id AND side = 'buy' AND status IN ('open', 'partial');

    v_available_cash := v_user_cash - v_reserved_cash;
    v_required_cash := p_price * p_size;
    IF v_available_cash < v_required_cash THEN
      RAISE EXCEPTION 'Insufficient available cash: required %, available % (reserved %)',
        v_required_cash, v_available_cash, v_reserved_cash;
    END IF;
  ELSE
    SELECT quantity INTO v_user_qty FROM public.holdings WHERE user_id = p_user_id AND stock_id = p_stock_id FOR UPDATE;
    IF NOT FOUND OR v_user_qty <= 0 THEN
      RAISE EXCEPTION 'No holdings found for selling stock %', p_stock_id;
    END IF;

    SELECT COALESCE(SUM(size - filled), 0) INTO v_reserved_qty
    FROM public.orders
    WHERE user_id = p_user_id AND stock_id = p_stock_id AND side = 'sell' AND status IN ('open', 'partial');

    v_available_qty := v_user_qty - v_reserved_qty;
    IF v_available_qty < p_size THEN
      RAISE EXCEPTION 'Insufficient available holdings: required %, available % (reserved %)',
        p_size, v_available_qty, v_reserved_qty;
    END IF;
  END IF;

  -- 2. 반대 주문 탐색 및 매칭
  v_opp_side := CASE WHEN p_side = 'buy' THEN 'sell' ELSE 'buy' END;

  FOR v_opp_record IN
    SELECT id, user_id, is_lp, side, price, size, filled, status, created_at
    FROM public.orders
    WHERE stock_id = p_stock_id
      AND side = v_opp_side
      AND status IN ('open', 'partial')
      AND (
        (p_side = 'buy' AND price <= p_price) OR
        (p_side = 'sell' AND price >= p_price)
      )
    ORDER BY
      CASE WHEN p_side = 'buy' THEN price END ASC,
      CASE WHEN p_side = 'sell' THEN price END DESC,
      created_at ASC
    FOR UPDATE
  LOOP
    IF v_remaining_qty <= 0 THEN EXIT; END IF;

    v_opp_remaining := v_opp_record.size - v_opp_record.filled;
    IF v_opp_remaining <= 0 THEN CONTINUE; END IF;

    v_match_qty := LEAST(v_remaining_qty, v_opp_remaining);
    IF v_match_qty <= 0 THEN CONTINUE; END IF;

    v_exec_price := v_opp_record.price;
    v_last_exec_price := v_exec_price;

    v_buyer_id := CASE WHEN p_side = 'buy' THEN p_user_id ELSE v_opp_record.user_id END;
    v_seller_id := CASE WHEN p_side = 'sell' THEN p_user_id ELSE v_opp_record.user_id END;
    v_buyer_is_bot := CASE WHEN p_side = 'buy' THEN false ELSE (v_opp_record.user_id IS NULL OR v_opp_record.is_lp) END;
    v_seller_is_bot := CASE WHEN p_side = 'sell' THEN false ELSE (v_opp_record.user_id IS NULL OR v_opp_record.is_lp) END;

    IF p_side = 'buy' THEN
      v_buyer_fee := 0.0025;   -- Taker fee
      v_seller_fee := -0.001;  -- Maker rebate
    ELSE
      v_buyer_fee := -0.001;   -- Maker rebate
      v_seller_fee := 0.0025;  -- Taker fee
    END IF;

    -- 2-1. 매수자 정산
    IF NOT v_buyer_is_bot AND v_buyer_id IS NOT NULL THEN
      SELECT cash INTO v_buyer_cash FROM public.profiles WHERE id = v_buyer_id FOR UPDATE;
      IF v_buyer_cash < (v_exec_price * v_match_qty * (1 + v_buyer_fee)) THEN
        RAISE EXCEPTION 'Insufficient cash for buyer % during execution', v_buyer_id;
      END IF;

      UPDATE public.profiles
      SET cash = cash - (v_exec_price * v_match_qty * (1 + v_buyer_fee)),
          net_worth = net_worth - (v_exec_price * v_match_qty * v_buyer_fee)
      WHERE id = v_buyer_id;

      SELECT quantity, avg_price INTO v_existing_qty, v_existing_avg
      FROM public.holdings WHERE user_id = v_buyer_id AND stock_id = p_stock_id FOR UPDATE;

      IF NOT FOUND THEN
        INSERT INTO public.holdings (user_id, stock_id, quantity, avg_price)
        VALUES (v_buyer_id, p_stock_id, v_match_qty, v_exec_price);
      ELSE
        v_new_qty := v_existing_qty + v_match_qty;
        v_new_avg := ((v_existing_avg * v_existing_qty) + (v_exec_price * v_match_qty)) / v_new_qty;
        UPDATE public.holdings
        SET quantity = v_new_qty, avg_price = ROUND(v_new_avg, 4)
        WHERE user_id = v_buyer_id AND stock_id = p_stock_id;
      END IF;
    END IF;

    -- 2-2. 매도자 정산
    IF NOT v_seller_is_bot AND v_seller_id IS NOT NULL THEN
      SELECT quantity INTO v_seller_qty FROM public.holdings WHERE user_id = v_seller_id AND stock_id = p_stock_id FOR UPDATE;
      IF NOT FOUND OR v_seller_qty < v_match_qty THEN
        RAISE EXCEPTION 'Insufficient holdings for seller % during execution', v_seller_id;
      END IF;

      v_new_qty := v_seller_qty - v_match_qty;
      IF v_new_qty = 0 THEN
        DELETE FROM public.holdings WHERE user_id = v_seller_id AND stock_id = p_stock_id;
      ELSE
        UPDATE public.holdings SET quantity = v_new_qty WHERE user_id = v_seller_id AND stock_id = p_stock_id;
      END IF;

      UPDATE public.profiles
      SET cash = cash + (v_exec_price * v_match_qty * (1 - v_seller_fee)),
          net_worth = net_worth - (v_exec_price * v_match_qty * v_seller_fee)
      WHERE id = v_seller_id;
    END IF;

    -- 2-3. trades 테이블 기록
    INSERT INTO public.trades (
      stock_id, buyer_id, seller_id, buyer_is_bot, seller_is_bot,
      price, size, buyer_fee, seller_fee, created_at
    ) VALUES (
      p_stock_id, v_buyer_id, v_seller_id, v_buyer_is_bot, v_seller_is_bot,
      v_exec_price, v_match_qty, v_buyer_fee, v_seller_fee, now()
    );

    -- 2-4. 상대 주문 상태 UPDATE
    UPDATE public.orders
    SET filled = filled + v_match_qty,
        status = CASE WHEN filled + v_match_qty >= size THEN 'filled' ELSE 'partial' END
    WHERE id = v_opp_record.id;

    v_remaining_qty := v_remaining_qty - v_match_qty;
    v_total_filled := v_total_filled + v_match_qty;
  END LOOP;

  -- 3. 주식 통계 원자적 업데이트
  IF v_total_filled > 0 THEN
    UPDATE public.stocks
    SET current_price = v_last_exec_price,
        high = GREATEST(COALESCE(high, 0), v_last_exec_price),
        low = CASE WHEN COALESCE(low, 0) = 0 THEN v_last_exec_price ELSE LEAST(low, v_last_exec_price) END,
        volume = COALESCE(volume, 0) + v_total_filled
    WHERE id = p_stock_id;
  END IF;

  -- 4. 신규 유저 주문 orders INSERT
  v_new_order_status := CASE
    WHEN v_total_filled = 0 THEN 'open'
    WHEN v_remaining_qty = 0 THEN 'filled'
    ELSE 'partial'
  END;

  INSERT INTO public.orders (
    stock_id, user_id, side, price, size, filled, status, is_lp, created_at
  ) VALUES (
    p_stock_id, p_user_id, p_side, p_price, p_size, v_total_filled, v_new_order_status, false, now()
  ) RETURNING id INTO v_new_order_id;

  -- 5. Invariant 최종 검증
  IF p_side = 'buy' THEN
    SELECT cash INTO v_user_cash FROM public.profiles WHERE id = p_user_id;
    IF v_user_cash < 0 THEN RAISE EXCEPTION 'Invariant violation: negative cash balance (%)', v_user_cash; END IF;
  ELSE
    SELECT quantity INTO v_user_qty FROM public.holdings WHERE user_id = p_user_id AND stock_id = p_stock_id;
    IF v_user_qty < 0 THEN RAISE EXCEPTION 'Invariant violation: negative holdings quantity (%)', v_user_qty; END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_new_order_id,
    'filled_qty', v_total_filled,
    'exec_price', v_last_exec_price,
    'status', v_new_order_status,
    'message', CASE
      WHEN v_total_filled > 0 THEN format('🎉 %s주가 체결되었습니다! (체결가: ₩%s)', v_total_filled, v_last_exec_price)
      ELSE format('주문이 호가창에 정상 접수되었습니다! (%s원 %s주)', p_price, p_size)
    END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_and_match_order(UUID, UUID, TEXT, NUMERIC, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_and_match_order(UUID, UUID, TEXT, NUMERIC, BIGINT) TO service_role;



