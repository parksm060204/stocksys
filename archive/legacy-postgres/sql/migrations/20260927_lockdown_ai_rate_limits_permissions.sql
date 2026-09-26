-- =====================================================================
-- Migration: 20260927_lockdown_ai_rate_limits_permissions.sql
-- Restrict check_ai_rate_limit RPC and ai_rate_limits table strictly
-- to server-only (service_role), revoking from anon, authenticated, and PUBLIC.
-- =====================================================================

-- 1. Revoke public/client permissions on table ai_rate_limits
REVOKE ALL ON TABLE public.ai_rate_limits FROM PUBLIC, anon, authenticated;

-- Ensure service_role has full management permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_rate_limits TO service_role;

-- 2. Clean up old permissive RLS policies
DROP POLICY IF EXISTS "Rate limits viewable by all" ON public.ai_rate_limits;
DROP POLICY IF EXISTS "Rate limits manageable by service role" ON public.ai_rate_limits;
DROP POLICY IF EXISTS "Rate limits manageable by service role only" ON public.ai_rate_limits;

-- 3. Enforce server-only RLS policy
ALTER TABLE public.ai_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Rate limits manageable by service role only"
  ON public.ai_rate_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 4. Revoke EXECUTE on check_ai_rate_limit from PUBLIC, anon, and authenticated
REVOKE ALL ON FUNCTION public.check_ai_rate_limit(text, int, int) FROM PUBLIC, anon, authenticated;

-- 5. Grant EXECUTE exclusively to service_role
GRANT EXECUTE ON FUNCTION public.check_ai_rate_limit(text, int, int) TO service_role;
