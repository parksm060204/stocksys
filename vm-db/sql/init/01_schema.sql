-- =====================================================================
-- 무명 거래소 — VM 자체 PostgreSQL 초기화 스키마
-- docker-entrypoint-initdb.d 에서 자동 실행됨 (처음 한 번)
-- =====================================================================
--  Supabase 호환 포인트:
--   - auth.uid() 함수 직접 구현 (PostgREST JWT claim 'sub' 읽기)
--   - auth.users 테이블을 일반 테이블로 생성 (GoTrue 미사용)
--   - anon / authenticated 역할 직접 생성
--   - 모든 RLS는 일단 PASSTHROUGH (USING true) — VM 내부망/PostgREST 인가에 의존
--   - 향후 자체 JWT 발급 도입 시 policy 만 다시 조이면 됨
-- =====================================================================

-- 0) 익명/인증 역할 생성 (PostgREST v12 용)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres_left') THEN
    CREATE ROLE postgres_left NOLOGIN;
  END IF;

END $$;

-- 확장
CREATE EXTENSION IF NOT EXISTS pgcrypto;        -- gen_random_uuid
CREATE EXTENSION IF NOT EXISTS pg_trgm;        -- 텍스트 검색
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =====================================================================
-- 1) auth.users 호환 —— 일반 테이블 (JWT sub 클레임에 들어갈 UUID)
-- =====================================================================
CREATE SCHEMA IF NOT EXISTS auth;

CREATE TABLE IF NOT EXISTS auth.users (

  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email        text UNIQUE NOT NULL,
  full_name    text,
  avatar_url   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON TABLE auth.users TO anon, authenticated;

-- PostgREST 가 JWT 안의 sub 클레임을 auth.uid() 로 읽도록 하는 호환 함수
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- JWT 의 role 클레임 (anon / authenticated) 도 호환
CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon')::text
$$;

-- =====================================================================
-- 2) public.profiles
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.profiles (
  id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name        text NOT NULL DEFAULT '익명 투자자',
  avatar_url          text,
  is_admin            boolean NOT NULL DEFAULT false,
  cash                bigint NOT NULL DEFAULT 5000000,                 -- 500만 시드
  news_subscriptions  jsonb NOT NULL DEFAULT '{}'::jsonb,
  has_options_license boolean NOT NULL DEFAULT false,
  unlocked_features   jsonb NOT NULL DEFAULT '[]'::jsonb,               -- shop 해금
  created_at          timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.profiles TO anon, authenticated, service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles viewable by all" ON public.profiles FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Profiles insertable by owner" ON public.profiles FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);
CREATE POLICY "Profiles updatable by owner" ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Profiles deletable by owner" ON public.profiles FOR DELETE TO authenticated USING (auth.uid() = id);

-- =====================================================================
-- 3) public.stocks
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.stocks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker            text NOT NULL UNIQUE,
  name              text NOT NULL,
  market            text NOT NULL CHECK (market IN ('domestic','overseas','europe','bonds','options','commodities','etf')),
  sector            text NOT NULL,
  description       text NOT NULL DEFAULT '',
  current_price     numeric(18,4) NOT NULL DEFAULT 0,
  previous_close    numeric(18,4) NOT NULL DEFAULT 0,
  open_price        numeric(18,4) NOT NULL DEFAULT 0,
  high              numeric(18,4) NOT NULL DEFAULT 0,
  low               numeric(18,4) NOT NULL DEFAULT 0,
  volume            bigint NOT NULL DEFAULT 0,
  market_cap        numeric(24,4) NOT NULL DEFAULT 0,
  relevance_weight  numeric(4,2) NOT NULL DEFAULT 1.00 CHECK (relevance_weight BETWEEN 0.5 AND 1.5),
  target_price      numeric(18,4) NOT NULL DEFAULT 0,
  is_core           boolean NOT NULL DEFAULT false,
  is_listed         boolean NOT NULL DEFAULT true,
  listed_at         timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_stocks_market ON public.stocks(market);
CREATE INDEX IF NOT EXISTS idx_stocks_sector ON public.stocks(sector);
CREATE INDEX IF NOT EXISTS idx_stocks_ticker ON public.stocks(ticker);
GRANT SELECT ON TABLE public.stocks TO anon, authenticated;
GRANT ALL ON TABLE public.stocks TO service_role;
ALTER TABLE public.stocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read-only stocks" ON public.stocks FOR SELECT TO anon, authenticated USING (true);

-- =====================================================================
-- 4) public.bonds
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.bonds (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticker          text NOT NULL UNIQUE,
  name            text NOT NULL,
  country         text NOT NULL DEFAULT 'KR',
  bond_type       text NOT NULL CHECK (bond_type IN ('govt','corp_ig','corp_hy')),
  maturity        text NOT NULL,                         -- '2Y','5Y','10Y'
  coupon_rate     numeric(6,3) NOT NULL DEFAULT 0,
  face_value      numeric(18,4) NOT NULL DEFAULT 10000,
  current_price   numeric(10,2) NOT NULL DEFAULT 100.00,
  previous_close  numeric(10,2) NOT NULL DEFAULT 100.00,
  ytm             numeric(6,3) NOT NULL DEFAULT 0,
  duration        numeric(6,2) NOT NULL DEFAULT 0,
  volume          bigint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON TABLE public.bonds TO anon, authenticated;
GRANT ALL ON TABLE public.bonds TO service_role;
ALTER TABLE public.bonds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read-only bonds" ON public.bonds FOR SELECT TO anon, authenticated USING (true);

-- =====================================================================
-- 5) public.commodities
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.commodities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id    text NOT NULL UNIQUE,                  -- 'WTI_CRUDE','GOLD'
  name            text NOT NULL,
  category        text NOT NULL,                         -- 'energy','metal','agri'
  unit            text NOT NULL DEFAULT 'USD',
  tick_size       numeric(10,4) NOT NULL DEFAULT 0.01,
  current_price   numeric(18,4) NOT NULL DEFAULT 0,
  previous_close  numeric(18,4) NOT NULL DEFAULT 0,
  volume          bigint NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON TABLE public.commodities TO anon, authenticated;
GRANT ALL ON TABLE public.commodities TO service_role;
ALTER TABLE public.commodities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read-only commodities" ON public.commodities FOR SELECT TO anon, authenticated USING (true);

-- =====================================================================
-- 6) public.exchange_rates
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.exchange_rates (
  currency_code  text PRIMARY KEY,
  currency_name  text NOT NULL,
  rate_to_krw    numeric(12,4) NOT NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON TABLE public.exchange_rates TO anon, authenticated;
GRANT ALL ON TABLE public.exchange_rates TO service_role;
ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read-only exchange_rates" ON public.exchange_rates FOR SELECT TO anon, authenticated USING (true);

-- =====================================================================
-- 7) public.admin_settings (단일 행)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.admin_settings (
  id                 int PRIMARY KEY DEFAULT 1,
  base_rate          numeric(6,4) NOT NULL DEFAULT 0.025,
  market_sentiment   text NOT NULL DEFAULT 'NEUTRAL',
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT admin_singleton CHECK (id = 1)
);
GRANT SELECT ON TABLE public.admin_settings TO anon, authenticated;
GRANT ALL ON TABLE public.admin_settings TO service_role;
ALTER TABLE public.admin_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read-only admin_settings" ON public.admin_settings FOR SELECT TO anon, authenticated USING (true);

-- =====================================================================
-- 8) public.orders + public.trades
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.orders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id    uuid NOT NULL REFERENCES public.stocks(id) ON DELETE CASCADE,
  user_id     uuid,
  side        text NOT NULL CHECK (side IN ('buy','sell')),
  price       numeric(18,4) NOT NULL,
  size        bigint NOT NULL,
  filled      bigint NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'open' CHECK (status IN ('open','partial','filled','cancelled','expired')),
  is_lp       boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orders_stock_status ON public.orders(stock_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_is_lp ON public.orders(is_lp) WHERE is_lp = true;
CREATE INDEX IF NOT EXISTS idx_orders_user ON public.orders(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.orders TO anon, authenticated, service_role;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Orders viewable by all" ON public.orders FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Orders insertable by owner" ON public.orders FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Orders updatable by owner" ON public.orders FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Orders deletable by owner" ON public.orders FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.trades (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id      uuid NOT NULL REFERENCES public.stocks(id) ON DELETE CASCADE,
  buyer_id      uuid,
  seller_id     uuid,
  buyer_is_bot  boolean NOT NULL DEFAULT false,
  seller_is_bot boolean NOT NULL DEFAULT false,
  price         numeric(18,4) NOT NULL,
  size          bigint NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trades_stock_created ON public.trades(stock_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_created_at ON public.trades(created_at DESC);
GRANT SELECT ON TABLE public.trades TO anon, authenticated;
GRANT ALL ON TABLE public.trades TO service_role;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read-only trades" ON public.trades FOR SELECT TO anon, authenticated USING (true);

-- =====================================================================
-- 9) public.holdings
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.holdings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stock_id    uuid NOT NULL REFERENCES public.stocks(id) ON DELETE CASCADE,
  quantity    bigint NOT NULL DEFAULT 0,
  avg_price   numeric(18,4) NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, stock_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.holdings TO anon, authenticated, service_role;
ALTER TABLE public.holdings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Holdings viewable by all" ON public.holdings FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Holdings insertable by owner" ON public.holdings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Holdings updatable by owner" ON public.holdings FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Holdings deletable by owner" ON public.holdings FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- =====================================================================
-- 10) public.options_contracts
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.options_contracts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  underlying_stock_id   uuid NOT NULL REFERENCES public.stocks(id) ON DELETE CASCADE,
  ticker                text,
  asset_class           text DEFAULT 'STK',
  underlying_symbol     text,
  type                  text CHECK (type IN ('CALL','PUT')),
  option_type           text CHECK (option_type IN ('CALL','PUT')),
  strike_price          numeric(18,4) NOT NULL,
  current_price         numeric(18,4) DEFAULT 0,
  expiry_date           timestamptz NOT NULL,
  open_interest         bigint NOT NULL DEFAULT 0,
  volume                bigint NOT NULL DEFAULT 0,
  delta                 numeric(10,4) DEFAULT 0.50,
  gamma                 numeric(10,4) DEFAULT 0.05,
  theta                 numeric(10,4) DEFAULT -0.10,
  implied_volatility    numeric(10,4) NOT NULL DEFAULT 0.20,
  created_at            timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON TABLE public.options_contracts TO anon, authenticated;
GRANT ALL ON TABLE public.options_contracts TO service_role;
ALTER TABLE public.options_contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read-only options_contracts" ON public.options_contracts FOR SELECT TO anon, authenticated USING (true);

-- =====================================================================
-- 11) public.bots_config (50개 기관 봇 마스터)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.bots_config (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  bot_type          text NOT NULL,                          -- PENSION_FUND | HEDGE_FUND | ...
  capital           bigint NOT NULL,
  traits            jsonb NOT NULL DEFAULT '{}'::jsonb,
  real_world_target text,
  is_real_user      boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON TABLE public.bots_config TO anon, authenticated;
GRANT ALL ON TABLE public.bots_config TO service_role;
ALTER TABLE public.bots_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read-only bots_config" ON public.bots_config FOR SELECT TO anon, authenticated USING (true);

-- =====================================================================
-- 12) public.institutional_portfolios (대시보드)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.institutional_portfolios (
  bot_id                text PRIMARY KEY,
  name                  text NOT NULL,
  total_capital         numeric NOT NULL,
  current_cash          numeric NOT NULL DEFAULT 0,
  current_stock         numeric NOT NULL DEFAULT 0,
  current_kr_equity     numeric NOT NULL DEFAULT 0,
  current_us_equity     numeric NOT NULL DEFAULT 0,
  current_eu_equity     numeric NOT NULL DEFAULT 0,
  current_bond          numeric NOT NULL DEFAULT 0,
  current_commodity     numeric NOT NULL DEFAULT 0,
  current_derivatives   numeric NOT NULL DEFAULT 0,
  target_weights        jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at            timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON TABLE public.institutional_portfolios TO anon, authenticated;
GRANT ALL ON TABLE public.institutional_portfolios TO service_role;
ALTER TABLE public.institutional_portfolios ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read-only institutional_portfolios" ON public.institutional_portfolios FOR SELECT TO anon, authenticated USING (true);

-- =====================================================================
-- 13) 뉴스 / 채팅 / 노벨이벤트 / 재무제표 / 서플라이체인
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.market_news (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type              text,
  category          text NOT NULL DEFAULT 'macro',
  publisher         text,
  outlet            text,
  title             text,
  headline          text,
  content           text,
  summary           text,
  target_sector     text,
  target_ticker     text,
  impact_score      numeric(6,2) DEFAULT 0,
  impact            text,
  is_fake           boolean NOT NULL DEFAULT false,
  original_rumor_id uuid,
  reliability       numeric(4,2) NOT NULL DEFAULT 0.5,
  is_published      boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON TABLE public.market_news TO anon, authenticated;
GRANT ALL ON TABLE public.market_news TO service_role;
ALTER TABLE public.market_news ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read-only market_news" ON public.market_news FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.premium_news (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  outlet        text NOT NULL DEFAULT '무명일보',
  headline      text NOT NULL,
  content       text,
  content_summary text,
  target_stock  uuid,
  reliability   numeric(4,2) NOT NULL DEFAULT 0.5,
  is_quoted     boolean NOT NULL DEFAULT false,
  is_true       boolean NOT NULL DEFAULT true,
  is_correction boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON TABLE public.premium_news TO anon, authenticated;
GRANT ALL ON TABLE public.premium_news TO service_role;
ALTER TABLE public.premium_news ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read-only premium_news" ON public.premium_news FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id      uuid NOT NULL REFERENCES public.stocks(id) ON DELETE CASCADE,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  user_name     text NOT NULL,
  is_shareholder boolean NOT NULL DEFAULT false,
  content       text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_stock_created ON public.chat_messages(stock_id, created_at DESC);
GRANT SELECT, INSERT ON TABLE public.chat_messages TO anon, authenticated, service_role;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Chat viewable by all" ON public.chat_messages FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Chat insertable by authenticated" ON public.chat_messages FOR INSERT TO anon, authenticated WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE TABLE IF NOT EXISTS public.financials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id          uuid NOT NULL REFERENCES public.stocks(id) ON DELETE CASCADE,
  quarter           text NOT NULL,
  revenue           bigint NOT NULL DEFAULT 0,
  operating_profit  bigint NOT NULL DEFAULT 0,
  net_income        bigint NOT NULL DEFAULT 0,
  total_assets      bigint NOT NULL DEFAULT 0,
  total_liabilities bigint NOT NULL DEFAULT 0,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (stock_id, quarter)
);
GRANT SELECT ON TABLE public.financials TO anon, authenticated;
GRANT ALL ON TABLE public.financials TO service_role;
ALTER TABLE public.financials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read-only financials" ON public.financials FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.novel_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title           text NOT NULL,
  raw_text        text NOT NULL,
  impact_summary  text NOT NULL DEFAULT '',
  sector_impacts  jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON TABLE public.novel_events TO anon, authenticated;
GRANT ALL ON TABLE public.novel_events TO service_role;
ALTER TABLE public.novel_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read-only novel_events" ON public.novel_events FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.sector_relations (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_stock_id   uuid NOT NULL REFERENCES public.stocks(id) ON DELETE CASCADE,
  child_stock_id    uuid NOT NULL REFERENCES public.stocks(id) ON DELETE CASCADE,
  relation_type     text NOT NULL DEFAULT 'supplier', -- supplier | rival | customer
  weight            numeric(4,2) NOT NULL DEFAULT 1.00
);
GRANT SELECT ON TABLE public.sector_relations TO anon, authenticated;
GRANT ALL ON TABLE public.sector_relations TO service_role;
ALTER TABLE public.sector_relations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read-only sector_relations" ON public.sector_relations FOR SELECT TO anon, authenticated USING (true);

-- =====================================================================
-- 14) 기타 부가 테이블 (shop / events / manipulations / macro_calendar)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.shop_items (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,
  name         text NOT NULL,
  price        bigint NOT NULL,
  category     text NOT NULL,
  description  text,
  is_available boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON TABLE public.shop_items TO anon, authenticated;
GRANT ALL ON TABLE public.shop_items TO service_role;
ALTER TABLE public.shop_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read-only shop_items" ON public.shop_items FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.player_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code        text NOT NULL UNIQUE,
  title       text NOT NULL,
  description text,
  choice_a    jsonb,
  choice_b    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON TABLE public.player_events TO anon, authenticated;
GRANT ALL ON TABLE public.player_events TO service_role;
ALTER TABLE public.player_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read-only player_events" ON public.player_events FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.active_player_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id   uuid NOT NULL REFERENCES public.player_events(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.active_player_events TO anon, authenticated, service_role;
ALTER TABLE public.active_player_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Active player events viewable by all" ON public.active_player_events FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Active player events manageable by owner" ON public.active_player_events FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.active_manipulations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id   uuid NOT NULL REFERENCES public.stocks(id) ON DELETE CASCADE,
  mode       text NOT NULL,
  status     text NOT NULL DEFAULT 'PENDING',
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON TABLE public.active_manipulations TO anon, authenticated;
GRANT ALL ON TABLE public.active_manipulations TO service_role;
ALTER TABLE public.active_manipulations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read-only active_manipulations" ON public.active_manipulations FOR SELECT TO anon, authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.macro_calendar (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger_time  timestamptz NOT NULL,
  event_name    text NOT NULL,
  period        text,
  impact_level  text NOT NULL DEFAULT 'medium',
  survey_value  numeric(10,2),
  actual_value  numeric(10,2),
  status        text NOT NULL DEFAULT 'scheduled',
  created_at    timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON TABLE public.macro_calendar TO anon, authenticated;
GRANT ALL ON TABLE public.macro_calendar TO service_role;
ALTER TABLE public.macro_calendar ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read-only macro_calendar" ON public.macro_calendar FOR SELECT TO anon, authenticated USING (true);

-- =====================================================================
-- 15) 심볼/인덱스
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.market_indices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,                 -- KOSPI, SP50, EUROSTOXX50
  name         text NOT NULL,
  current_value numeric(18,2) NOT NULL DEFAULT 0,
  previous_close numeric(18,2) NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON TABLE public.market_indices TO anon, authenticated;
GRANT ALL ON TABLE public.market_indices TO service_role;
ALTER TABLE public.market_indices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read-only market_indices" ON public.market_indices FOR SELECT TO anon, authenticated USING (true);

-- =====================================================================
-- 16) 트리거: 신규 auth.users INSERT 시 profile 자동 생성 (GoTrue 대용)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.full_name, NEW.email, '익명 투자자'),
    NEW.avatar_url
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================================
-- 17) 전역 권한 부여 (PostgREST 인식용)
-- =====================================================================
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;



-- =====================================================================
-- 18) 원자적 회계 처리용 RPC 함수 (Race Condition 방지)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.increment_user_cash(p_user_id uuid, p_delta numeric)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_cash bigint;
BEGIN
  UPDATE public.profiles
  SET cash = GREATEST(0, cash + p_delta::bigint)
  WHERE id = p_user_id
  RETURNING cash INTO v_new_cash;
  RETURN v_new_cash;
END;
$$;
GRANT EXECUTE ON FUNCTION public.increment_user_cash TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_user_holding(p_user_id uuid, p_stock_id uuid, p_qty_delta int, p_fill_price numeric)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_existing_qty int;
  v_existing_avg numeric;
  v_new_qty int;
  v_new_avg numeric;
BEGIN
  SELECT quantity, avg_price INTO v_existing_qty, v_existing_avg
  FROM public.holdings
  WHERE user_id = p_user_id AND stock_id = p_stock_id;

  IF NOT FOUND THEN
    IF p_qty_delta > 0 THEN
      INSERT INTO public.holdings (user_id, stock_id, quantity, avg_price)
      VALUES (p_user_id, p_stock_id, p_qty_delta, p_fill_price);
    END IF;
  ELSE
    v_new_qty := GREATEST(0, v_existing_qty + p_qty_delta);
    IF v_new_qty = 0 THEN
      DELETE FROM public.holdings WHERE user_id = p_user_id AND stock_id = p_stock_id;
    ELSE
      IF p_qty_delta > 0 THEN
        v_new_avg := ((v_existing_avg * v_existing_qty) + (p_fill_price * p_qty_delta)) / v_new_qty;
      ELSE
        v_new_avg := v_existing_avg;
      END IF;
      UPDATE public.holdings
      SET quantity = v_new_qty, avg_price = ROUND(v_new_avg, 4)
      WHERE user_id = p_user_id AND stock_id = p_stock_id;
    END IF;
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_user_holding TO anon, authenticated, service_role;

-- =====================================================================
-- 19) NextAuth 통합용 RPC + 뷰
--     - create_user_with_profile: 구글 로그인 최초 시 auth.users + profiles 동시 생성
--     - auth_users_view: PostgREST 가 auth 스키마를 직접 노출 못하므로 public 뷰로 우회
-- =====================================================================

-- 이메일로 auth.users 조회 가능한 뷰 (NextAuth signIn 콜백에서 중복 체크용)
CREATE OR REPLACE VIEW public.auth_users_view AS
  SELECT id, email, full_name, avatar_url, created_at
  FROM auth.users;

GRANT SELECT ON public.auth_users_view TO anon, authenticated, service_role;

-- 신규 구글 유저 생성 RPC (NextAuth signIn 콜백에서 호출)
CREATE OR REPLACE FUNCTION public.create_user_with_profile(
  p_email     text,
  p_full_name text DEFAULT '익명 투자자',
  p_avatar_url text DEFAULT NULL
)
RETURNS TABLE (id uuid, is_new boolean)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_is_new  boolean := false;
BEGIN
  -- 중복 체크
  SELECT au.id INTO v_user_id
  FROM auth.users au
  WHERE au.email = p_email;

  IF NOT FOUND THEN
    -- 신규 유저 생성
    INSERT INTO auth.users (email, full_name, avatar_url)
    VALUES (p_email, p_full_name, p_avatar_url)
    RETURNING auth.users.id INTO v_user_id;

    -- 트리거가 profiles 자동 생성하지만 혹시 대비
    INSERT INTO public.profiles (id, display_name, avatar_url)
    VALUES (v_user_id, COALESCE(p_full_name, '익명 투자자'), p_avatar_url)
    ON CONFLICT (id) DO NOTHING;

    v_is_new := true;
  ELSE
    -- 기존 유저: 이름/아바타 갱신
    UPDATE auth.users
    SET full_name = COALESCE(p_full_name, full_name),
        avatar_url = COALESCE(p_avatar_url, avatar_url)
    WHERE auth.users.id = v_user_id;
  END IF;

  RETURN QUERY SELECT v_user_id, v_is_new;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_user_with_profile TO anon, authenticated, service_role;

-- =====================================================================
-- 20) 과거 주가 기록 테이블 (stock_price_history)
-- =====================================================================
CREATE TABLE IF NOT EXISTS public.stock_price_history (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stock_id    uuid NOT NULL REFERENCES public.stocks(id) ON DELETE CASCADE,
  price       numeric(18,4) NOT NULL,
  volume      bigint NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_price_history_stock_time 
  ON public.stock_price_history(stock_id, created_at DESC);

GRANT SELECT ON TABLE public.stock_price_history TO anon, authenticated;
GRANT ALL ON TABLE public.stock_price_history TO service_role;
ALTER TABLE public.stock_price_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read-only price_history" ON public.stock_price_history FOR SELECT TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_trades_created_at ON public.trades(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trades_stock_created ON public.trades(stock_id, created_at DESC);

-- =====================================================================
-- 21) 슬라이딩 윈도우 트리밍 RPC (trades 5,000건 / price_history 3,000건 유지)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.trim_old_market_data(
  p_max_trades INT DEFAULT 5000,
  p_max_history INT DEFAULT 3000
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_trades INT := 0;
  v_deleted_history INT := 0;
BEGIN
  -- 1. trades 테이블 최신 5,000건 초과분 삭제
  WITH to_delete AS (
    SELECT id
    FROM public.trades
    ORDER BY created_at DESC
    OFFSET p_max_trades
  ),
  del_t AS (
    DELETE FROM public.trades
    WHERE id IN (SELECT id FROM to_delete)
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_trades FROM del_t;

  -- 2. stock_price_history 테이블 최신 3,000건 초과분 삭제
  WITH to_delete_hist AS (
    SELECT id
    FROM public.stock_price_history
    ORDER BY created_at DESC
    OFFSET p_max_history
  ),
  del_h AS (
    DELETE FROM public.stock_price_history
    WHERE id IN (SELECT id FROM to_delete_hist)
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_history FROM del_h;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_trades', v_deleted_trades,
    'deleted_history', v_deleted_history
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.trim_old_market_data(INT, INT) TO anon, authenticated, service_role;

-- 완료
DO $$ BEGIN RAISE NOTICE 'VM DB 스키마 초기화 완료'; END $$;