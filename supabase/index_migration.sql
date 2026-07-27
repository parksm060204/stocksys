-- supabase/index_migration.sql
-- Run this in the Supabase SQL editor to create the market_indices table

create table if not exists public.market_indices (
  id uuid primary key default gen_random_uuid(),
  market text not null check (market in ('kospi', 'sp50', 'eurostoxx50')),
  index_value numeric(18,4) not null,
  recorded_at timestamptz not null default now()
);

grant select, insert, update, delete on table public.market_indices to anon, authenticated;
alter table public.market_indices enable row level security;

create policy "Anyone can view market indices" on public.market_indices for select to authenticated using (true);
create policy "Anyone can view market indices anon" on public.market_indices for select to anon using (true);
create policy "Admins can insert market indices" on public.market_indices for insert to authenticated with check (true);
create policy "Admins can update market indices" on public.market_indices for update to authenticated using (true) with check (true);

-- Insert initial base values
insert into public.market_indices (market, index_value) values
('kospi', 2500.0000),
('sp50', 5000.0000),
('eurostoxx50', 4000.0000);
