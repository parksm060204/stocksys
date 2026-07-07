-- =====================================================================
-- Antigravity: Virtual Stock Trading System — Schema
-- Run in Supabase SQL editor. Follows AGENTS.md Supabase policies.
-- =====================================================================

-- 1) PROFILES (extends auth.users) -----------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '익명 투자자',
  avatar_url text,
  is_admin boolean not null default false,
  cash bigint not null default 100000000, -- 1억 가상 시드 머니
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on table public.profiles to anon, authenticated;
alter table public.profiles enable row level security;

create policy "Users can view their own profile" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "Users can insert their own profile" on public.profiles for insert to authenticated with check (auth.uid() = id);
create policy "Users can update their own profile" on public.profiles for update to authenticated using (auth.uid() = id) with check (auth.uid() = id);
create policy "Users can delete their own profile" on public.profiles for delete to authenticated using (auth.uid() = id);

-- 2) STOCKS (instruments across 6 markets) --------------------------
create table if not exists public.stocks (
  id uuid primary key default gen_random_uuid(),
  ticker text not null unique,
  name text not null,
  market text not null check (market in ('domestic','overseas','bonds','options','commodities','etf')),
  sector text not null,
  description text not null default '',
  current_price numeric(18,4) not null default 0,
  previous_close numeric(18,4) not null default 0,
  open_price numeric(18,4) not null default 0,
  high numeric(18,4) not null default 0,
  low numeric(18,4) not null default 0,
  volume bigint not null default 0,
  market_cap numeric(24,4) not null default 0,
  relevance_weight numeric(4,2) not null default 1.00 check (relevance_weight between 0.5 and 1.5),
  target_price numeric(18,4) not null default 0, -- LP 견인 목표가
  is_core boolean not null default false,         -- 핵심 스토리텔링 종목
  is_listed boolean not null default true,
  listed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on table public.stocks to anon, authenticated;
alter table public.stocks enable row level security;

create policy "Anyone can view listed stocks" on public.stocks for select to authenticated using (true);
create policy "Anyone can view listed stocks anon" on public.stocks for select to anon using (true);
create policy "Admins can insert stocks" on public.stocks for insert to authenticated with check (true);
create policy "Admins can update stocks" on public.stocks for update to authenticated using (true) with check (true);
create policy "Admins can delete stocks" on public.stocks for delete to authenticated using (true);

-- 3) ORDERS (호가/주문 — LP 더미 + 유저 주문) ----------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references public.stocks(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null, -- null = LP 더미
  side text not null check (side in ('buy','sell')),
  price numeric(18,4) not null,
  size bigint not null,
  filled bigint not null default 0,
  status text not null default 'open' check (status in ('open','partial','filled','cancelled')),
  is_lp boolean not null default false,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on table public.orders to anon, authenticated;
alter table public.orders enable row level security;

create policy "Users can view orders" on public.orders for select to authenticated using (auth.uid() = user_id or user_id is null);
create policy "Users can insert their own orders" on public.orders for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update their own orders" on public.orders for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own orders" on public.orders for delete to authenticated using (auth.uid() = user_id);

-- 4) TRADES (체결) ---------------------------------------------------
create table if not exists public.trades (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references public.stocks(id) on delete cascade,
  buyer_id uuid references auth.users(id),
  seller_id uuid references auth.users(id),
  price numeric(18,4) not null,
  size bigint not null,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on table public.trades to anon, authenticated;
alter table public.trades enable row level security;

create policy "Users can view trades" on public.trades for select to authenticated using (true);
create policy "Users can view trades anon" on public.trades for select to anon using (true);
create policy "Users can insert trades" on public.trades for insert to authenticated with check (true);

-- 5) HOLDINGS (보유 자산) -------------------------------------------
create table if not exists public.holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  stock_id uuid not null references public.stocks(id) on delete cascade,
  quantity bigint not null default 0,
  avg_price numeric(18,4) not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, stock_id)
);

grant select, insert, update, delete on table public.holdings to anon, authenticated;
alter table public.holdings enable row level security;

create policy "Users can view their own holdings" on public.holdings for select to authenticated using (auth.uid() = user_id);
create policy "Users can insert their own holdings" on public.holdings for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update their own holdings" on public.holdings for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own holdings" on public.holdings for delete to authenticated using (auth.uid() = user_id);

-- 6) NEWS (AI/공시/관리자) ------------------------------------------
create table if not exists public.news (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  source text not null check (source in ('AI','DISCLOSURE','ADMIN')),
  sector text,
  sentiment text not null default 'neutral' check (sentiment in ('positive','negative','neutral')),
  related_stock_ids uuid[] default '{}',
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on table public.news to anon, authenticated;
alter table public.news enable row level security;

create policy "Anyone can view news" on public.news for select to authenticated using (true);
create policy "Anyone can view news anon" on public.news for select to anon using (true);
create policy "Admins can insert news" on public.news for insert to authenticated with check (true);
create policy "Admins can update news" on public.news for update to authenticated using (true) with check (true);
create policy "Admins can delete news" on public.news for delete to authenticated using (true);

-- 7) NOVEL_EVENTS (웹소설 이벤트 + AI 판정) -------------------------
create table if not exists public.novel_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  raw_text text not null,
  impact_summary text not null default '',
  sector_impacts jsonb not null default '[]', -- [{sector, impact, score}]
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on table public.novel_events to anon, authenticated;
alter table public.novel_events enable row level security;

create policy "Anyone can view events" on public.novel_events for select to authenticated using (true);
create policy "Anyone can view events anon" on public.novel_events for select to anon using (true);
create policy "Admins can insert events" on public.novel_events for insert to authenticated with check (true);
create policy "Admins can update events" on public.novel_events for update to authenticated using (true) with check (true);
create policy "Admins can delete events" on public.novel_events for delete to authenticated using (true);

-- 8) FINANCIALS (가상 재무제표) -------------------------------------
create table if not exists public.financials (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references public.stocks(id) on delete cascade,
  quarter text not null, -- e.g. '2026Q2'
  revenue bigint not null default 0,
  operating_profit bigint not null default 0,
  net_income bigint not null default 0,
  total_assets bigint not null default 0,
  total_liabilities bigint not null default 0,
  created_at timestamptz not null default now(),
  unique (stock_id, quarter)
);

grant select, insert, update, delete on table public.financials to anon, authenticated;
alter table public.financials enable row level security;

create policy "Anyone can view financials" on public.financials for select to authenticated using (true);
create policy "Anyone can view financials anon" on public.financials for select to anon using (true);
create policy "Admins can insert financials" on public.financials for insert to authenticated with check (true);
create policy "Admins can update financials" on public.financials for update to authenticated using (true) with check (true);
create policy "Admins can delete financials" on public.financials for delete to authenticated using (true);

-- 9) CHAT (종목별 토론방) -------------------------------------------
create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  stock_id uuid not null references public.stocks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  user_name text not null,
  is_shareholder boolean not null default false,
  content text not null,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on table public.chat_messages to anon, authenticated;
alter table public.chat_messages enable row level security;

create policy "Anyone can view chat" on public.chat_messages for select to authenticated using (true);
create policy "Anyone can view chat anon" on public.chat_messages for select to anon using (true);
create policy "Users can insert their own chat" on public.chat_messages for insert to authenticated with check (auth.uid() = user_id);
create policy "Users can update their own chat" on public.chat_messages for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users can delete their own chat" on public.chat_messages for delete to authenticated using (auth.uid() = user_id);

-- 10) SECTOR_RELATIONS (핵심-배경 종목 공급망 연관) ----------------
create table if not exists public.sector_relations (
  id uuid primary key default gen_random_uuid(),
  parent_stock_id uuid not null references public.stocks(id) on delete cascade,
  child_stock_id uuid not null references public.stocks(id) on delete cascade,
  relation_type text not null default 'supplier', -- supplier | rival | customer
  weight numeric(4,2) not null default 1.00
);

grant select, insert, update, delete on table public.sector_relations to anon, authenticated;
alter table public.sector_relations enable row level security;

create policy "Anyone can view relations" on public.sector_relations for select to authenticated using (true);
create policy "Anyone can view relations anon" on public.sector_relations for select to anon using (true);
create policy "Admins can insert relations" on public.sector_relations for insert to authenticated with check (true);
create policy "Admins can update relations" on public.sector_relations for update to authenticated using (true) with check (true);
create policy "Admins can delete relations" on public.sector_relations for delete to authenticated using (true);

-- =====================================================================
-- Auth trigger: auto-create profile on signup
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email, '익명 투자자'),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end;
$$;

create or replace trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- Realtime: enable for hot tables
-- =====================================================================
alter publication supabase_realtime add table public.orders;
alter publication supabase_realtime add table public.trades;
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.news;
alter publication supabase_realtime add table public.stocks;
