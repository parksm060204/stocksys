-- =====================================================================
-- MUMYEONG: Trim Old Market Data RPC
-- trades 테이블(최신 5,000건 유지)과 stock_price_history(최신 3,000건 유지)
-- 슬라이딩 윈도우 트리밍을 수행하여 PostgreSQL WAL 및 디스크 포화를 원천 차단
-- =====================================================================

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
  -- 보안 및 데이터 보호: 최소 1,000건 강제 보존 (0 전달 등으로 인한 전체 삭제 원천 차단)
  v_max_trades := GREATEST(COALESCE(p_max_trades, 5000), 1000);
  v_max_history := GREATEST(COALESCE(p_max_history, 3000), 1000);

  -- 1. trades 테이블 최신 N건 초과분 삭제
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

  -- 2. stock_price_history 테이블 최신 N건 초과분 삭제
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

-- 보안 강화: 일반 사용자(anon, authenticated) 권한 박탈 및 service_role만 실행 허용
REVOKE EXECUTE ON FUNCTION public.trim_old_market_data(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trim_old_market_data(INT, INT) TO service_role;

