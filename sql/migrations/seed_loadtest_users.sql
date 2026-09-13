-- =====================================================================
-- Seed 200 Load Test Users in auth.users and public.profiles
-- =====================================================================

DO $$
DECLARE
  i INT;
  uid UUID;
BEGIN
  FOR i IN 1..200 LOOP
    uid := ('10000000-0000-0000-0000-' || LPAD(i::TEXT, 12, '0'))::UUID;
    
    -- 1. auth.users 생성 (트리거로 profiles 자동 생성됨)
    INSERT INTO auth.users (id, email, full_name, created_at)
    VALUES (uid, 'loadtest_' || i || '@loadtest.local', '부하테스터_' || i, now())
    ON CONFLICT (id) DO NOTHING;

    -- 2. profiles 1억원 지급 및 username 설정
    UPDATE public.profiles
    SET cash = 100000000,
        net_worth = 100000000,
        username = '부하테스터_' || i,
        nickname = '부하테스터_' || i,
        display_name = '부하테스터_' || i,
        rank_tier = 'Gold'
    WHERE id = uid;
  END LOOP;
END $$;
