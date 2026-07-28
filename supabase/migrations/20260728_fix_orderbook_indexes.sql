-- 1. Create indexes for fast orderbook queries and LP order deletions
CREATE INDEX IF NOT EXISTS idx_orders_is_lp_stock_id ON public.orders (is_lp, stock_id);
CREATE INDEX IF NOT EXISTS idx_orders_stock_id_status ON public.orders (stock_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_status_is_lp ON public.orders (status, is_lp);

-- 2. Create exchange_rates table if not existing
CREATE TABLE IF NOT EXISTS public.exchange_rates (
  currency_code TEXT PRIMARY KEY,
  currency_name TEXT NOT NULL,
  rate_to_krw NUMERIC(18,4) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Grant privileges for exchange_rates
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.exchange_rates TO anon, authenticated;

-- Enable RLS for exchange_rates
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;

-- Policies for exchange_rates
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Anyone can view exchange rates') THEN
    CREATE POLICY "Anyone can view exchange rates" ON public.exchange_rates FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can update exchange rates') THEN
    CREATE POLICY "Admins can update exchange rates" ON public.exchange_rates FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Admins can insert exchange rates') THEN
    CREATE POLICY "Admins can insert exchange rates" ON public.exchange_rates FOR INSERT TO authenticated WITH CHECK (true);
  END IF;
END $$;

-- Seed default exchange rates if table empty
INSERT INTO public.exchange_rates (currency_code, currency_name, rate_to_krw) VALUES
  ('KRW', '대한민국 원', 1.0000),
  ('USD', '미국 달러', 1380.5000),
  ('EUR', '유럽 유로', 1505.2000),
  ('JPY', '일본 엔', 9.1500),
  ('CNY', '중국 위안', 190.4000),
  ('GBP', '영국 파운드', 1785.8000)
ON CONFLICT (currency_code) DO UPDATE SET
  rate_to_krw = EXCLUDED.rate_to_krw,
  updated_at = NOW();
