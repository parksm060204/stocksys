-- Options Contracts Table
create table if not exists public.options_contracts (
  id uuid primary key default gen_random_uuid(),
  underlying_stock_id uuid not null references public.stocks(id) on delete cascade,
  type text not null check (type in ('CALL','PUT')),
  strike_price numeric(18,4) not null,
  expiry_date timestamptz not null,
  open_interest bigint not null default 0,
  implied_volatility numeric(10,4) not null default 0.20,
  created_at timestamptz not null default now(),
  unique (underlying_stock_id, type, strike_price, expiry_date)
);

grant select, insert, update, delete on table public.options_contracts to anon, authenticated;
alter table public.options_contracts enable row level security;

create policy "Anyone can view options contracts" on public.options_contracts for select to authenticated using (true);
create policy "Anyone can view options contracts anon" on public.options_contracts for select to anon using (true);
create policy "Admins can insert options contracts" on public.options_contracts for insert to authenticated with check (true);
create policy "Admins can update options contracts" on public.options_contracts for update to authenticated using (true) with check (true);
create policy "Admins can delete options contracts" on public.options_contracts for delete to authenticated using (true);

-- Add options license to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS has_options_license BOOLEAN DEFAULT FALSE;

-- RPC for purchasing options license
CREATE OR REPLACE FUNCTION purchase_options_license(
  user_uuid UUID,          
  price NUMERIC       
) RETURNS BOOLEAN AS $$
DECLARE
  current_cash NUMERIC;
BEGIN
  -- 유저 예수금 조회 (portfolios 테이블 기준 - 기존 shop_migration 구조 호환)
  SELECT cash_balance INTO current_cash FROM public.portfolios WHERE user_id = user_uuid;
  
  -- 잔액 부족 시 FALSE 반환
  IF current_cash < price THEN 
    RETURN FALSE; 
  END IF;
  
  -- 잔액 차감
  UPDATE public.portfolios SET cash_balance = cash_balance - price WHERE user_id = user_uuid;

  -- 프로필 권한 업데이트
  UPDATE public.profiles SET has_options_license = TRUE WHERE id = user_uuid;

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

