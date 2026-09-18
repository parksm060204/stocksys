-- ====================================================================
-- PostgreSQL / Supabase Migration: get_authoritative_orderbook RPC
-- ====================================================================
-- 목적:
-- 1. 단일 SQL CTE 및 STABLE 선언을 통해 단일 읽기 트랜잭션/스냅샷 구간에서
--    매수(bids), 매도(asks), 최근체결(trades)을 100% 원자적으로 집계
-- 2. 방향별 200건 한도에 잘리지 않고 동일 가격 대량 주문의 잔량을 100% 완전 합산
-- 3. 비동기 조회 시점 차이(T와 T+Δ)로 인한 가짜 교차 호가(Crossed Book) 원천 방지
--
-- 보안 정책 (Security Policy):
-- - 본 RPC는 HTS/MTS 공개 호가창 표준 정책에 따라 anon(익명 사용자) 및
--   authenticated(인증 사용자) 모두에게 실행 권한이 부여됩니다.
-- - 반환되는 데이터에는 주문자 ID(user_id), 계좌번호, 주문자 IP 등 민감한 개인정보나
--   비공개 원장이 일체 포함되지 않으며, 오직 익명화된 가격(price), 총 잔량(totalSize),
--   주문 건수(orderCount), 최근 체결 내역만 집계하여 반환하므로 정보 유출 위험이 없습니다.
-- - SECURITY DEFINER 및 search_path = public, pg_temp 설정을 통해 함수 권한 상승 공격을 차단합니다.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.get_authoritative_orderbook(
  p_stock_id TEXT,
  p_depth INT DEFAULT 10
)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  WITH params AS (
    SELECT
      NULLIF(btrim(p_stock_id), '') AS stock_id,
      LEAST(GREATEST(COALESCE(p_depth, 10), 1), 50) AS depth,
      (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::BIGINT AS now_ms
  ),
  aggregated_bids AS (
    SELECT
      price,
      ROUND(SUM(size - COALESCE(filled, 0)))::NUMERIC AS "totalSize",
      SUM(size - COALESCE(filled, 0))::NUMERIC AS "actualDbSize",
      false AS "isSynthetic",
      COUNT(*)::INT AS "orderCount"
    FROM public.orders, params
    WHERE params.stock_id IS NOT NULL
      AND stock_id = params.stock_id
      AND side = 'buy'
      AND status IN ('open', 'partial')
      AND (size - COALESCE(filled, 0)) > 0
      AND price > 0
    GROUP BY price
    HAVING ROUND(SUM(size - COALESCE(filled, 0))) > 0
    ORDER BY price DESC
    LIMIT (SELECT depth FROM params)
  ),
  aggregated_asks AS (
    SELECT
      price,
      ROUND(SUM(size - COALESCE(filled, 0)))::NUMERIC AS "totalSize",
      SUM(size - COALESCE(filled, 0))::NUMERIC AS "actualDbSize",
      false AS "isSynthetic",
      COUNT(*)::INT AS "orderCount"
    FROM public.orders, params
    WHERE params.stock_id IS NOT NULL
      AND stock_id = params.stock_id
      AND side = 'sell'
      AND status IN ('open', 'partial')
      AND (size - COALESCE(filled, 0)) > 0
      AND price > 0
    GROUP BY price
    HAVING ROUND(SUM(size - COALESCE(filled, 0))) > 0
    ORDER BY price ASC
    LIMIT (SELECT depth FROM params)
  ),
  recent_trades AS (
    SELECT
      id,
      stock_id,
      price,
      size,
      buyer_is_bot,
      seller_is_bot,
      created_at
    FROM public.trades, params
    WHERE params.stock_id IS NOT NULL
      AND stock_id = params.stock_id
    ORDER BY created_at DESC
    LIMIT 50
  )
  SELECT jsonb_build_object(
    'stockId', COALESCE((SELECT stock_id FROM params), ''),
    'timestamp', (SELECT now_ms FROM params),
    'fetchDurationMs', 0,
    'bids', COALESCE((SELECT jsonb_agg(b) FROM aggregated_bids b), '[]'::jsonb),
    'asks', COALESCE((SELECT jsonb_agg(a) FROM aggregated_asks a), '[]'::jsonb),
    'trades', COALESCE((SELECT jsonb_agg(t) FROM recent_trades t), '[]'::jsonb)
  );
$$;

-- 보안 강화: 기본 PUBLIC 실행 권한 회수 및 명시적 역할(anon, authenticated)에만 허용
REVOKE ALL ON FUNCTION public.get_authoritative_orderbook(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_authoritative_orderbook(TEXT, INT) TO anon, authenticated;
