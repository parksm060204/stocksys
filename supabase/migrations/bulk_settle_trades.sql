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
      ((t->>'price')::numeric * (t->>'size')::bigint)::bigint AS trade_amount
    FROM jsonb_array_elements(p_trades) AS t
  LOOP
    -- 1. 매수자 현금 차감 (봇이 아닌 경우)
    IF NOT trade_record.buyer_is_bot THEN
      UPDATE public.profiles
      SET cash = cash - trade_record.trade_amount
      WHERE id = trade_record.buyer_id;
    END IF;

    -- 2. 매도자 현금 입금 (봇이 아닌 경우)
    IF NOT trade_record.seller_is_bot THEN
      UPDATE public.profiles
      SET cash = cash + trade_record.trade_amount
      WHERE id = trade_record.seller_id;
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
