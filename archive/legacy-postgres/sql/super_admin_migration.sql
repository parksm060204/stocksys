-- =====================================================================
-- System Admin Privileges & Auto Feature Unlock Migration
-- =====================================================================

-- 1. profiles 테이블에 unlocked_features 컬럼이 없으면 추가
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS unlocked_features JSONB DEFAULT '[]'::jsonb;

-- 2. 관리자 권한(is_admin = true)을 가진 유저에게 시스템 관리자 혜택 부여 함수 (예수금 변경 없음)
CREATE OR REPLACE FUNCTION public.grant_super_admin_privileges(target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- profiles 테이블 업데이트 (파생상품 라이선스 + 모든 커스텀 기능 해금)
  UPDATE public.profiles
  SET 
    is_admin = true,
    has_options_license = true,
    unlocked_features = '["custom_dashboard", "eco_calendar", "macro_intelligence", "super_admin"]'::jsonb
  WHERE id = target_user_id;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.grant_super_admin_privileges TO authenticated;
