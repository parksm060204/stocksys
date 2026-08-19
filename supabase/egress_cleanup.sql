-- =====================================================================
-- Egress 절감 정리 스크립트 - 안전한 청크 단위 삭제
-- Supabase Dashboard > SQL Editor 에서 한 섹션씩 실행
-- =====================================================================

-- =================================================================
-- STEP 1: trades 테이블 청산 (과거 데이터)
-- 게임 경제 시뮬레이션은 "현재" 호가창/차트만 의미 있으므로
-- 7일 이상 지난 체결 내역은 일괄 삭제
-- =================================================================

-- 1-1) 현재 trades 행 수 확인
SELECT COUNT(*) AS total_trades, pg_size_pretty(pg_total_relation_size('trades')) AS size
FROM trades;

-- 1-2) 7일 이전 trades 전량 TRUNCATE 안 함 - 청크 DELETE (egress 폭주 방지)
-- 한 번에 DELETE 시 WAL 급증 → egress 폭증. 확장(plpgsql)으로 5천 행씩 루프
DO $$
DECLARE
  deleted_rows INTEGER := 0;
  total_deleted BIGINT := 0;
BEGIN
  LOOP
    DELETE FROM trades
    WHERE id IN (
      SELECT id FROM trades
      WHERE created_at < NOW() - INTERVAL '7 days'
      LIMIT 5000
    );
    GET DIAGNOSTICS deleted_rows = ROW_COUNT;
    total_deleted := total_deleted + deleted_rows;

    -- 진행 상황 로그
    RAISE NOTICE 'Deleted % rows this chunk, total %', deleted_rows, total_deleted;

    -- 더 이상 삭제할 게 없으면 종료
    EXIT WHEN deleted_rows = 0;

    -- WAL/egress 완화용 짧은 sleep (10ms) - 큰 DB일수록 더 길게
    PERFORM pg_sleep(0.01);
  END LOOP;

  RAISE NOTICE 'Trades cleanup finished. Total rows deleted: %', total_deleted;
END $$;

-- 1-3) trades 테이블 VACUUM (egress 관계없지만 디스크 회수용)
-- 주의: SQL Editor에서는 VACUUM이 안 될 수 있음 → Dashboard > Database > VACUUM ANALYZE 수동 실행 권장
-- 실행 안 되면 무시해도 됨
VACUUM (ANALYZE) trades;

-- =================================================================
-- STEP 2: orders 테이블 정리
-- =================================================================

-- 2-1) 만료된(filled/cancelled) 주문 일괄 삭제 - 7일 기준
DO $$
DECLARE
  deleted_rows INTEGER := 0;
  total_deleted BIGINT := 0;
BEGIN
  LOOP
    DELETE FROM orders
    WHERE id IN (
      SELECT id FROM orders
      WHERE status IN ('filled', 'cancelled', 'expired')
        AND created_at < NOW() - INTERVAL '7 days'
      LIMIT 5000
    );
    GET DIAGNOSTICS deleted_rows = ROW_COUNT;
    total_deleted := total_deleted + deleted_rows;
    RAISE NOTICE 'Orders deleted % (chunk), total %', deleted_rows, total_deleted;
    EXIT WHEN deleted_rows = 0;
    PERFORM pg_sleep(0.01);
  END LOOP;
  RAISE NOTICE 'Orders cleanup finished. Total: %', total_deleted;
END $$;

-- 2-2) LP 호가(is_lp=true) 중 1시간 이상 갱신 안 된 고아 주문 정리
-- 엔진이 5틱마다 LP를 갱신하므로 1시간 이상 된 open LP 주문은 버그/잔재
DO $$
DECLARE
  deleted_rows INTEGER := 0;
BEGIN
  DELETE FROM orders
  WHERE is_lp = true
    AND status = 'open'
    AND created_at < NOW() - INTERVAL '1 hour';
  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  RAISE NOTICE 'Stale LP orders deleted: %', deleted_rows;
END $$;

-- =================================================================
-- STEP 3: market_news / premium_news 정리
-- 뉴스 페이지도 데이터 적재됨
-- =================================================================

-- 3-1) 30일 이상 market_news 삭제
DO $$
DECLARE
  deleted_rows INTEGER := 0;
  total_deleted BIGINT := 0;
BEGIN
  LOOP
    DELETE FROM market_news
    WHERE ctid IN (
      SELECT ctid FROM market_news
      WHERE created_at < NOW() - INTERVAL '30 days'
      LIMIT 5000
    );
    GET DIAGNOSTICS deleted_rows = ROW_COUNT;
    total_deleted := total_deleted + deleted_rows;
    RAISE NOTICE 'Market_news deleted %, total %', deleted_rows, total_deleted;
    EXIT WHEN deleted_rows = 0;
    PERFORM pg_sleep(0.01);
  END LOOP;
END $$;

-- 3-2) 30일 이상 premium_news 삭제
DO $$
DECLARE
  deleted_rows INTEGER := 0;
  total_deleted BIGINT := 0;
BEGIN
  LOOP
    DELETE FROM premium_news
    WHERE ctid IN (
      SELECT ctid FROM premium_news
      WHERE created_at < NOW() - INTERVAL '30 days'
      LIMIT 5000
    );
    GET DIAGNOSTICS deleted_rows = ROW_COUNT;
    total_deleted := total_deleted + deleted_rows;
    RAISE NOTICE 'Premium_news deleted %, total %', deleted_rows, total_deleted;
    EXIT WHEN deleted_rows = 0;
    PERFORM pg_sleep(0.01);
  END LOOP;
END $$;

-- =================================================================
-- STEP 4: active_player_events / active_manipulations 정리
-- =================================================================

DO $$
DECLARE
  deleted_rows INTEGER := 0;
BEGIN
  DELETE FROM active_player_events
  WHERE status IN ('completed', 'expired', 'declined')
    AND created_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  RAISE NOTICE 'Active_player_events cleanup: %', deleted_rows;
END $$;

DO $$
DECLARE
  deleted_rows INTEGER := 0;
BEGIN
  DELETE FROM active_manipulations
  WHERE status IN ('COMPLETED', 'CANCELLED')
    AND created_at < NOW() - INTERVAL '7 days';
  GET DIAGNOSTICS deleted_rows = ROW_COUNT;
  RAISE NOTICE 'Active_manipulations cleanup: %', deleted_rows;
END $$;

-- =================================================================
-- STEP 5: Realtime publication 컬럼 축소 (★★★egress 직격타)
-- trades 테이블 Realtime 구독에서 프론트가 실제 사용하는 컬럼만 publish
-- TickChart: price, created_at, stock_id
-- ParticipantFlowWidget: price, size, buyer_is_bot, seller_is_bot, stock_id
-- buyer_id, seller_id 등 유저 식별자는 Realtime으로 push할 필요 없음
-- =================================================================

-- 5-1) 기존 publication에서 trades 일단 제거
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.trades;

-- 5-2) 필요한 컬럼만 포함하여 재추가 (Postgres 15+ 의 column list)
ALTER PUBLICATION supabase_realtime
  ADD TABLE public.trades (
    id,
    stock_id,
    price,
    size,
    buyer_is_bot,
    seller_is_bot,
    created_at
  );

-- 5-3) institutional_portfolios 도 Realtime publish 중 컬럼 축소 검토
-- 프론트 institutions/page.tsx에서 사용하는 컬럼만 publish
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.institutional_portfolios;

ALTER PUBLICATION supabase_realtime
  ADD TABLE public.institutional_portfolios (
    bot_id,
    name,
    total_capital,
    current_cash,
    current_stock,
    current_kr_equity,
    current_us_equity,
    current_eu_equity,
    current_bond,
    current_commodity,
    current_derivatives,
    updated_at
  );

-- =================================================================
-- STEP 6: 사용하지 않는 테이블 점검 (선택)
-- 진단 쿼리 결과를 보고 미사용 테이블 TRUNCATE/DROP
-- =================================================================

-- 작년 이후로 한 번도 접근 안 된 테이블 후보 (manual 점검 후 결정)
-- SELECT relname, last_seq_scan, n_tup_ins, n_tup_upd, n_tup_del
-- FROM pg_stat_user_tables
-- WHERE n_tup_ins = 0 AND n_tup_upd = 0 AND n_tup_del = 0;

-- =================================================================
-- STEP 7: 최종 상태 재점검
-- =================================================================

SELECT
  relname AS table_name,
  n_tup_ins AS total_inserts,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 15;

-- Realtime publication의 trades 컬럼 확인
SELECT
  schemaname, tablename, attnames
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('trades', 'institutional_portfolios');