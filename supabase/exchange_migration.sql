-- 1. Add foreign currency balances to public.profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS usd_balance numeric(18,4) not null default 0.0000;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS eur_balance numeric(18,4) not null default 0.0000;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS jpy_balance numeric(18,4) not null default 0.0000;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS cny_balance numeric(18,4) not null default 0.0000;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gbp_balance numeric(18,4) not null default 0.0000;

-- 2. Create exchange_rates table
create table if not exists public.exchange_rates (
  currency_code text primary key,
  currency_name text not null,
  rate_to_krw numeric(18,4) not null,
  updated_at timestamptz not null default now()
);

-- Grant privileges for exchange_rates
grant select, insert, update, delete on table public.exchange_rates to anon, authenticated;

-- Enable RLS for exchange_rates
alter table public.exchange_rates enable row level security;

-- Policies for exchange_rates
create policy "Anyone can view exchange rates" on public.exchange_rates for select to anon, authenticated using (true);
create policy "Admins can insert exchange rates" on public.exchange_rates for insert to authenticated with check (true);
create policy "Admins can update exchange rates" on public.exchange_rates for update to authenticated using (true) with check (true);
create policy "Admins can delete exchange rates" on public.exchange_rates for delete to authenticated using (true);

-- Seed initial exchange rates
insert into public.exchange_rates (currency_code, currency_name, rate_to_krw) values
  ('KRW', '대한민국 원', 1.0000),
  ('USD', '미국 달러', 1380.5000),
  ('EUR', '유럽 유로', 1505.2000),
  ('JPY', '일본 엔', 9.1500),
  ('CNY', '중국 위안', 190.4000),
  ('GBP', '영국 파운드', 1785.8000)
on conflict (currency_code) do update set
  rate_to_krw = excluded.rate_to_krw,
  updated_at = now();

-- Add exchange_rates to realtime publication if needed
alter publication supabase_realtime add table public.exchange_rates;

-- 3. Create RPC function for currency exchange transaction
CREATE OR REPLACE FUNCTION exchange_currency(
  p_user_id UUID,
  p_from_cur TEXT,
  p_to_cur TEXT,
  p_amount NUMERIC
) RETURNS BOOLEAN AS $$
DECLARE
  v_from_rate NUMERIC;
  v_to_rate NUMERIC;
  v_from_bal NUMERIC;
  v_received NUMERIC;
BEGIN
  -- 1. Get exchange rates relative to KRW
  SELECT rate_to_krw INTO v_from_rate FROM public.exchange_rates WHERE currency_code = p_from_cur;
  SELECT rate_to_krw INTO v_to_rate FROM public.exchange_rates WHERE currency_code = p_to_cur;
  
  IF v_from_rate IS NULL OR v_to_rate IS NULL THEN
    RETURN FALSE;
  END IF;

  -- 2. Fetch the current balance of the sell currency
  IF p_from_cur = 'KRW' THEN
    SELECT cash INTO v_from_bal FROM public.profiles WHERE id = p_user_id;
  ELSIF p_from_cur = 'USD' THEN
    SELECT usd_balance INTO v_from_bal FROM public.profiles WHERE id = p_user_id;
  ELSIF p_from_cur = 'EUR' THEN
    SELECT eur_balance INTO v_from_bal FROM public.profiles WHERE id = p_user_id;
  ELSIF p_from_cur = 'JPY' THEN
    SELECT jpy_balance INTO v_from_bal FROM public.profiles WHERE id = p_user_id;
  ELSIF p_from_cur = 'CNY' THEN
    SELECT cny_balance INTO v_from_bal FROM public.profiles WHERE id = p_user_id;
  ELSIF p_from_cur = 'GBP' THEN
    SELECT gbp_balance INTO v_from_bal FROM public.profiles WHERE id = p_user_id;
  ELSE
    RETURN FALSE;
  END IF;

  -- Verify balance is sufficient
  IF v_from_bal < p_amount THEN
    RETURN FALSE;
  END IF;

  -- 3. Calculate quantity of destination currency to receive
  -- (amount * from_rate_in_krw) / to_rate_in_krw
  v_received := (p_amount * v_from_rate) / v_to_rate;

  -- 4. Deduct the sell currency amount
  IF p_from_cur = 'KRW' THEN
    UPDATE public.profiles SET cash = cash - p_amount WHERE id = p_user_id;
  ELSIF p_from_cur = 'USD' THEN
    UPDATE public.profiles SET usd_balance = usd_balance - p_amount WHERE id = p_user_id;
  ELSIF p_from_cur = 'EUR' THEN
    UPDATE public.profiles SET eur_balance = eur_balance - p_amount WHERE id = p_user_id;
  ELSIF p_from_cur = 'JPY' THEN
    UPDATE public.profiles SET jpy_balance = jpy_balance - p_amount WHERE id = p_user_id;
  ELSIF p_from_cur = 'CNY' THEN
    UPDATE public.profiles SET cny_balance = cny_balance - p_amount WHERE id = p_user_id;
  ELSIF p_from_cur = 'GBP' THEN
    UPDATE public.profiles SET gbp_balance = gbp_balance - p_amount WHERE id = p_user_id;
  END IF;

  -- 5. Add the buy currency amount
  IF p_to_cur = 'KRW' THEN
    UPDATE public.profiles SET cash = cash + v_received WHERE id = p_user_id;
  ELSIF p_to_cur = 'USD' THEN
    UPDATE public.profiles SET usd_balance = usd_balance + v_received WHERE id = p_user_id;
  ELSIF p_to_cur = 'EUR' THEN
    UPDATE public.profiles SET eur_balance = eur_balance + v_received WHERE id = p_user_id;
  ELSIF p_to_cur = 'JPY' THEN
    UPDATE public.profiles SET jpy_balance = jpy_balance + v_received WHERE id = p_user_id;
  ELSIF p_to_cur = 'CNY' THEN
    UPDATE public.profiles SET cny_balance = cny_balance + v_received WHERE id = p_user_id;
  ELSIF p_to_cur = 'GBP' THEN
    UPDATE public.profiles SET gbp_balance = gbp_balance + v_received WHERE id = p_user_id;
  END IF;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
