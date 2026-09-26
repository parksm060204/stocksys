-- =====================================================================
-- Migration: AI Rate Limits table & atomic check RPC for STOCKSYS VM-DB
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.ai_rate_limits (
  key         text PRIMARY KEY,
  count       int NOT NULL DEFAULT 1,
  reset_at    timestamptz NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_rate_limits TO anon, authenticated, service_role;
ALTER TABLE public.ai_rate_limits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Rate limits manageable by service role" ON public.ai_rate_limits FOR ALL TO service_role USING (true);
CREATE POLICY "Rate limits viewable by all" ON public.ai_rate_limits FOR SELECT TO anon, authenticated USING (true);

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

GRANT EXECUTE ON FUNCTION public.check_ai_rate_limit TO anon, authenticated, service_role;
