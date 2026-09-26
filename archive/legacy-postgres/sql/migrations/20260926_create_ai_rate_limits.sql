-- =====================================================================
-- Migration: AI Rate Limits table & atomic check RPC for STOCKSYS VM-DB
-- Security Lockdown: Server-only (service_role) execution and access
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.ai_rate_limits (
  key         text PRIMARY KEY,
  count       int NOT NULL DEFAULT 1,
  reset_at    timestamptz NOT NULL
);

-- RLS & Access Control: Server-only (service_role) access
ALTER TABLE public.ai_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.ai_rate_limits FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_rate_limits TO service_role;

DROP POLICY IF EXISTS "Rate limits manageable by service role" ON public.ai_rate_limits;
DROP POLICY IF EXISTS "Rate limits viewable by all" ON public.ai_rate_limits;
DROP POLICY IF EXISTS "Rate limits manageable by service role only" ON public.ai_rate_limits;

CREATE POLICY "Rate limits manageable by service role only"
  ON public.ai_rate_limits
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Atomic sliding-window rate limit checker
CREATE OR REPLACE FUNCTION public.check_ai_rate_limit(
  p_key text,
  p_limit int DEFAULT 5,
  p_window_seconds int DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_entry public.ai_rate_limits%ROWTYPE;
  v_allowed boolean;
BEGIN
  INSERT INTO public.ai_rate_limits (key, count, reset_at)
  VALUES (p_key, 1, v_now + (p_window_seconds || ' seconds')::interval)
  ON CONFLICT (key) DO UPDATE
  SET count = CASE
        WHEN public.ai_rate_limits.reset_at <= v_now THEN 1
        ELSE public.ai_rate_limits.count + 1
      END,
      reset_at = CASE
        WHEN public.ai_rate_limits.reset_at <= v_now THEN v_now + (p_window_seconds || ' seconds')::interval
        ELSE public.ai_rate_limits.reset_at
      END
  RETURNING * INTO v_entry;

  v_allowed := (v_entry.count <= p_limit);
  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'count', v_entry.count,
    'reset_at', extract(epoch from v_entry.reset_at) * 1000
  );
END;
$$;

-- By default in PostgreSQL, EXECUTE on functions is granted to PUBLIC.
-- Revoke execute from PUBLIC, anon, and authenticated to prevent unauthorized rate limit manipulation.
REVOKE ALL ON FUNCTION public.check_ai_rate_limit(text, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_ai_rate_limit(text, int, int) TO service_role;
