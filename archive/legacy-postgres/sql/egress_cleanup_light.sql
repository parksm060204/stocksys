-- =====================================================================
-- Egress 절감 - 짧은 청크 DELETE (SQL Editor 타임아웃 대응)
-- 매 쿼리가 1~2초 내 종료되도록 작은 LIMIT 사용
-- 각 섹션을 여러 번 실행(반복)하여 더 이상 삭제 안 될 때까지 진행
-- =====================================================================

-- =================================================================
-- STEP 1: trades 7일 이전 데이터 청크 삭제
-- 한 번에 2000행까지. 더 안 지워지면 EXIT
-- → 여러 번 실행(출력이 0 row가 될 때까지)
-- =================================================================

DELETE FROM trades
WHERE id IN (
  SELECT id FROM trades
  WHERE created_at < NOW() - INTERVAL '7 days'
  LIMIT 2000
);

-- =================================================================
-- STEP 2: 만료 주문(filled/cancelled/expired) 7일 이전 청크 삭제
-- =================================================================

DELETE FROM orders
WHERE id IN (
  SELECT id FROM orders
  WHERE status IN ('filled', 'cancelled', 'expired')
    AND created_at < NOW() - INTERVAL '7 days'
  LIMIT 2000
);

-- =================================================================
-- STEP 3: 1시간 이상 갱신 안 된 LP 호가 정리
-- =================================================================

DELETE FROM orders
WHERE is_lp = true
  AND status = 'open'
  AND created_at < NOW() - INTERVAL '1 hour';

-- =================================================================
-- STEP 4: market_news 30일 이전 청크 삭제
-- =================================================================

DELETE FROM market_news
WHERE ctid IN (
  SELECT ctid FROM market_news
  WHERE created_at < NOW() - INTERVAL '30 days'
  LIMIT 2000
);

-- =================================================================
-- STEP 5: premium_news 30일 이전 청크 삭제
-- =================================================================

DELETE FROM premium_news
WHERE ctid IN (
  SELECT ctid FROM premium_news
  WHERE created_at < NOW() - INTERVAL '30 days'
  LIMIT 2000
);

-- =================================================================
-- STEP 6: active_player_events 만료 건 정리 (즉시 실행)
-- =================================================================

DELETE FROM active_player_events
WHERE status IN ('completed', 'expired', 'declined')
  AND created_at < NOW() - INTERVAL '7 days';

-- =================================================================
-- STEP 7: active_manipulations 만료 건 정리 (즉시 실행)
-- =================================================================

DELETE FROM active_manipulations
WHERE status IN ('COMPLETED', 'CANCELLED')
  AND created_at < NOW() - INTERVAL '7 days';

-- =================================================================
-- STEP 8: Realtime publication에서 trades 전체 제거 (egress 직격타)
-- 프론트 TickChart/ParticipantFlowWidget 컴포넌트는 INSERT 만 구독 중
-- → 일단 publication에서 trades를 빼면 egress 즉시 0에 가깝게 감소
-- (UI는 polling fallback으로 동작하거나 별도 경로 필요)
-- =================================================================

ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.trades;

-- (선택) 대신 컬럼을 한정해서 publish 하려면 위 DROP 후 아래 ADD 실행
-- 단 이 옵션은 Postgres 15+ Supabase 에서만 동작
ALTER PUBLICATION supabase_realtime
  ADD TABLE public.trades (
    id, stock_id, price, size, buyer_is_bot, seller_is_bot, created_at
  );

-- institutional_portfolios 도 publish 축소
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.institutional_portfolios;
ALTER PUBLICATION supabase_realtime
  ADD TABLE public.institutional_portfolios (
    bot_id, name, total_capital,
    current_cash, current_stock,
    current_kr_equity, current_us_equity, current_eu_equity,
    current_bond, current_commodity, current_derivatives,
    updated_at
  );

-- =================================================================
-- STEP 9: 진단 쿼리 (매 단계 후 실행)
-- =================================================================

-- trades/orders 잔여 행 수
SELECT
  (SELECT COUNT(*) FROM trades) AS trades_cnt,
  (SELECT COUNT(*) FROM orders) AS orders_cnt,
  (SELECT COUNT(*) FROM orders WHERE is_lp = true AND status = 'open') AS open_lp_cnt;

-- Realtime publication의 trades 컬럼
SELECT schemaname, tablename, attnames
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
  AND tablename IN ('trades', 'institutional_portfolios');