-- =====================================================================
-- MUMYEONG: Bulk Settle Trades RPC
-- 틱당 발생한 다수의 체결 건을 단일 트랜잭션으로 일괄 원자적 정산
-- =====================================================================

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
BEGIN
  -- JSONB 배열을 순회하며 원자적 정산 수행
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
    -- 1. 매수자 현금 차감 및 주식 입고 (봇이 아닌 경우)
    IF NOT trade_record.buyer_is_bot THEN
      -- 현금 차감 (금액 + 수수료)
      UPDATE public.profiles
      SET cash = cash - (trade_record.trade_amount * (1 + COALESCE(trade_record.buyer_fee, 0.0)))
      WHERE id = trade_record.buyer_id;

      -- 보유량 업데이트 로직 (update_user_holding과 동일)
      SELECT quantity, avg_price INTO v_existing_qty, v_existing_avg
      FROM public.holdings
      WHERE user_id = trade_record.buyer_id AND stock_id = trade_record.stock_id;

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

    -- 2. 매도자 현금 입금 및 주식 출고 (봇이 아닌 경우)
    IF NOT trade_record.seller_is_bot THEN
      -- 현금 입금 (금액 - 수수료)
      UPDATE public.profiles
      SET cash = cash + (trade_record.trade_amount * (1 - COALESCE(trade_record.seller_fee, 0.0)))
      WHERE id = trade_record.seller_id;

      -- 보유량 차감
      SELECT quantity, avg_price INTO v_existing_qty, v_existing_avg
      FROM public.holdings
      WHERE user_id = trade_record.seller_id AND stock_id = trade_record.stock_id;

      IF FOUND THEN
        v_new_qty := GREATEST(0, v_existing_qty - trade_record.size);
        IF v_new_qty = 0 THEN
          DELETE FROM public.holdings WHERE user_id = trade_record.seller_id AND stock_id = trade_record.stock_id;
        ELSE
          UPDATE public.holdings
          SET quantity = v_new_qty
          WHERE user_id = trade_record.seller_id AND stock_id = trade_record.stock_id;
        END IF;
      END IF;
    END IF;

    -- 3. trades 테이블 기록
    INSERT INTO public.trades (
      stock_id, buyer_id, seller_id, buyer_is_bot, seller_is_bot, price, size, created_at
    ) VALUES (
      trade_record.stock_id, trade_record.buyer_id, trade_record.seller_id,
      trade_record.buyer_is_bot, trade_record.seller_is_bot,
      trade_record.price, trade_record.size, now()
    );

    v_trade_count := v_trade_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'settled_count', v_trade_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_settle_trades(JSONB) TO anon, authenticated;
