-- supabase/cleanup_migration.sql
-- Run this in the Supabase SQL editor to remove unused/obsolete tables.

-- 1. news_v2로 기능이 이관되면서 더 이상 사용되지 않는 구형 news 테이블을 삭제합니다.
-- CASCADE 옵션이 있으므로, 이 테이블을 참조하는 제약 조건이 있다면 함께 삭제됩니다.
DROP TABLE IF EXISTS public.news CASCADE;

-- (선택 사항) 만약 과거에 만들어두고 현재 프론트/백엔드 로직에서 완전히 제외된 테이블이 더 있다면
-- 아래 주석을 해제하여 삭제할 수 있습니다.
-- DROP TABLE IF EXISTS public.financials CASCADE;
