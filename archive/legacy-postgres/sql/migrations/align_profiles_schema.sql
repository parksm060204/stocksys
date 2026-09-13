-- =====================================================================
-- MUMYEONG: Align Profiles Schema Migration
-- profiles 테이블에 username, nickname, net_worth, rank_tier 컬럼 정합성 추가
-- =====================================================================

ALTER TABLE ONLY public.profiles 
  ADD COLUMN IF NOT EXISTS username TEXT,
  ADD COLUMN IF NOT EXISTS nickname TEXT,
  ADD COLUMN IF NOT EXISTS net_worth NUMERIC DEFAULT 100000000,
  ADD COLUMN IF NOT EXISTS rank_tier TEXT DEFAULT 'Bronze';

-- 기존 유저 nickname 및 username 기본값 설정
UPDATE public.profiles 
SET nickname = COALESCE(display_name, '익명 투자자'),
    username = COALESCE(display_name, '익명 투자자')
WHERE nickname IS NULL;

-- 권한 부여
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO anon, authenticated;
