-- =====================================================================
-- Egress 절감 진단 쿼리 모음
-- Supabase Dashboard > SQL Editor 에서 먼저 실행하여 현황 파악
-- =====================================================================

-- 1. 테이블별 행 수 및 크기 (egress 원인 식별)
SELECT
  relname AS table_name,
  n_tup_ins AS total_inserts,
  n_tup_upd AS total_updates,
  n_tup_del AS total_deletes,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(relid) DESC
LIMIT 30;

-- 2. trades 테이블 시간 분포 (가장 큰 egress 소스 예상)
SELECT
  date_trunc('hour', created_at) AS hour,
  COUNT(*) AS row_count,
  pg_size_pretty(COUNT(*) * 200) AS approx_size  -- trades row 평균 ~200 bytes 가정
FROM trades
GROUP BY 1
ORDER BY 1 DESC
LIMIT 48;

-- 3. orders 테이블 상태 분포 (LP 주문 적체 확인)
SELECT
  status,
  is_lp,
  COUNT(*) AS cnt,
  pg_size_pretty(COUNT(*) * 150) AS approx_size
FROM orders
GROUP BY 1, 2
ORDER BY cnt DESC;

-- 4. Realtime publication 현황 (어떤 테이블이 구독되고 있는지)
SELECT
  schemaname AS schema,
  tablename AS table,
  rowsecurity AS rls_enabled
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY tablename;

-- 5. Realtime 활성 구독 세션 수 (egress와 정비례)
SELECT
  pid,
  usename,
  application_name,
  state,
  sync_state,
  sent_lsn,
  write_lsn,
  flush_lsn,
  replay_lsn
FROM pg_stat_replication
WHERE application_name LIKE 'supabase_realtime%';

-- 6. 인덱스 크기 Top 10 (egress는 아니지만 디스크/쿼리 성능 점검)
SELECT
  schemaname || '.' || relname AS table,
  indexrelname AS index_name,
  pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
  idx_scan AS scan_count
FROM pg_stat_user_indexes
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 10;