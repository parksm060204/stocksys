-- Supabase Migration: active_manipulations table

CREATE TABLE IF NOT EXISTS public.active_manipulations (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  stock_id text NOT NULL REFERENCES public.stocks (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'COMPLETED', 'FAILED')),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT active_manipulations_pkey PRIMARY KEY (id)
);

-- RLS
ALTER TABLE public.active_manipulations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view active manipulations"
  ON public.active_manipulations
  FOR SELECT
  TO authenticated, anon
  USING (true);

-- Functions
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers
DROP TRIGGER IF EXISTS trigger_active_manipulations_updated_at ON public.active_manipulations;
CREATE TRIGGER trigger_active_manipulations_updated_at
BEFORE UPDATE ON public.active_manipulations
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.active_manipulations TO anon, authenticated;
