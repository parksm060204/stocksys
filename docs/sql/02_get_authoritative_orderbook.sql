-- ====================================================================
-- PostgreSQL / Supabase Migration: get_authoritative_orderbook RPC
-- ====================================================================
-- 목적:
-- 1. 방향별 limit(200)에 의해 잘리던 동일 가격 대량 주문의 잔량을 100% 완전 집계
-- 2. 단일 SQL 트랜잭션 스냅샷으로 매수/매도/체결 내역을 원자적으로 반환하여
--    비동기 T와 T+Δ 시점 차이에 의한 가짜 교차 호가(Crossed Book)를 원천 차단
-- ====================================================================

CREATE OR REPLACE FUNCTION public.get_authoritative_orderbook(
  p_stock_id TEXT,
  p_depth INT DEFAULT 10
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_depth INT := GREATEST(1, LEAST(50, COALESCE(p_depth, 10)));
  v_bids JSONB;
  v_asks JSONB;
  v_trades JSONB;
  v_now_ms BIGINT := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT;
BEGIN
  -- 1. 매수 호가 집계 (가격 내림차순, 상위 depth개 고유 가격 레벨, 모든 미체결 잔량 100% 합산)
  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_bids
  FROM (
    SELECT
      price,
      ROUND(SUM(size - COALESCE(filled, 0)))::NUMERIC AS "totalSize",
      SUM(size - COALESCE(filled, 0))::NUMERIC AS "actualDbSize",
      false AS "isSynthetic",
      COUNT(*)::INT AS "orderCount"
    FROM orders
    WHERE stock_id = p_stock_id
      AND side = 'buy'
      AND status IN ('open', 'partial')
      AND (size - COALESCE(filled, 0)) > 0
      AND price > 0
    GROUP BY price
    HAVING ROUND(SUM(size - COALESCE(filled, 0))) > 0
    ORDER BY price DESC
    LIMIT v_depth
  ) sub;

  -- 2. 매도 호가 집계 (가격 오름차순, 상위 depth개 고유 가격 레벨, 모든 미체결 잔량 100% 합산)
  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_asks
  FROM (
    SELECT
      price,
      ROUND(SUM(size - COALESCE(filled, 0)))::NUMERIC AS "totalSize",
      SUM(size - COALESCE(filled, 0))::NUMERIC AS "actualDbSize",
      false AS "isSynthetic",
      COUNT(*)::INT AS "orderCount"
    FROM orders
    WHERE stock_id = p_stock_id
      AND side = 'sell'
      AND status IN ('open', 'partial')
      AND (size - COALESCE(filled, 0)) > 0
      AND price > 0
    GROUP BY price
    HAVING ROUND(SUM(size - COALESCE(filled, 0))) > 0
    ORDER BY price ASC
    LIMIT v_depth
  ) sub;

  -- 3. 최근 체결 내역 50건 조회
  SELECT COALESCE(jsonb_agg(sub), '[]'::jsonb)
  INTO v_trades
  FROM (
    SELECT
      id,
      stock_id,
      price,
      size,
      buyer_is_bot,
      seller_is_bot,
      created_at
    FROM trades
    WHERE stock_id = p_stock_id
    ORDER BY created_at DESC
    LIMIT 50
  ) sub;

  -- 4. 단일 스냅샷 JSON 반환
  RETURN jsonb_build_object(
    'stockId', p_stock_id,
    'timestamp', v_now_ms,
    'fetchDurationMs', 0,
    'bids', v_bids,
    'asks', v_asks,
    'trades', v_trades
  );
END;
$$;

-- 권한 부여 (AGENTS.md 규칙: anon, authenticated 호출 허용)
GRANT EXECUTE ON FUNCTION public.get_authoritative_orderbook(TEXT, INT) TO anon, authenticated;
