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
  v_max_trades INT;
  v_max_history INT;
  v_deleted_trades INT := 0;
  v_deleted_history INT := 0;
BEGIN
  -- 보안 및 데이터 보호: 최소 1,000건 강제 보존 (0 전달 등으로 인한 전체 삭제 원천 차단)
  v_max_trades := GREATEST(COALESCE(p_max_trades, 5000), 1000);
  v_max_history := GREATEST(COALESCE(p_max_history, 3000), 1000);

  -- 1. trades 테이블 최신 N건 초과분 삭제
  WITH to_delete AS (
    SELECT id
    FROM public.trades
    ORDER BY created_at DESC
    OFFSET v_max_trades
  ),
  del_t AS (
    DELETE FROM public.trades
    WHERE id IN (SELECT id FROM to_delete)
    RETURNING id
  )
  SELECT COUNT(*) INTO v_deleted_trades FROM del_t;

  -- 2. stock_price_history 테이블 최신 N건 초과분 삭제
  WITH to_delete_hist AS (
    SELECT id
    FROM public.stock_price_history
    ORDER BY created_at DESC
    OFFSET v_max_history
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

REVOKE EXECUTE ON FUNCTION public.trim_old_market_data(INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trim_old_market_data(INT, INT) TO service_role;

-- =====================================================================
-- 22) 일괄 원자적 정산 RPC (bulk_settle_trades)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.bulk_settle_trades(p_trades JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  trade_record RECORD;
  v_trade_count INT := 0;
  v_existing_qty INT;
  v_existing_avg NUMERIC;
  v_new_qty INT;
  v_new_avg NUMERIC;
  v_buyer_cash NUMERIC;
  v_seller_qty INT;
BEGIN
  FOR trade_record IN 
    SELECT 
      (t->>'stock_id')::uuid AS stock_id,
      (t->>'buyer_id')::uuid AS buyer_id,
      (t->>'seller_id')::uuid AS seller_id,
      (t->>'buyer_is_bot')::boolean AS buyer_is_bot,
      (t->>'seller_is_bot')::boolean AS seller_is_bot,
      (t->>'price')::numeric AS price,
      (t->>'size')::bigint AS size,
      (t->>'buyer_fee')::numeric AS buyer_fee,
      (t->>'seller_fee')::numeric AS seller_fee,
      ((t->>'price')::numeric * (t->>'size')::bigint)::numeric AS trade_amount
    FROM jsonb_array_elements(p_trades) AS t
  LOOP
    IF trade_record.price <= 0 OR trade_record.size <= 0 THEN
      RAISE EXCEPTION 'Invalid trade price or size: price=%, size=%', trade_record.price, trade_record.size;
    END IF;

    -- 1. 매수자 현금 차감 및 주식 입고
    IF NOT trade_record.buyer_is_bot AND trade_record.buyer_id IS NOT NULL THEN
      SELECT cash INTO v_buyer_cash
      FROM public.profiles
      WHERE id = trade_record.buyer_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Buyer profile not found for user %', trade_record.buyer_id;
      END IF;

      IF v_buyer_cash < (trade_record.trade_amount * (1 + COALESCE(trade_record.buyer_fee, 0.0))) THEN
        RAISE EXCEPTION 'Insufficient cash for buyer %: required=%, available=%', 
          trade_record.buyer_id, 
          (trade_record.trade_amount * (1 + COALESCE(trade_record.buyer_fee, 0.0))), 
          v_buyer_cash;
      END IF;

      UPDATE public.profiles
      SET cash = cash - (trade_record.trade_amount * (1 + COALESCE(trade_record.buyer_fee, 0.0)))
      WHERE id = trade_record.buyer_id;

      SELECT quantity, avg_price INTO v_existing_qty, v_existing_avg
      FROM public.holdings
      WHERE user_id = trade_record.buyer_id AND stock_id = trade_record.stock_id
      FOR UPDATE;

      IF NOT FOUND THEN
        INSERT INTO public.holdings (user_id, stock_id, quantity, avg_price)
        VALUES (trade_record.buyer_id, trade_record.stock_id, trade_record.size, trade_record.price);
      ELSE
        v_new_qty := v_existing_qty + trade_record.size;
        v_new_avg := ((v_existing_avg * v_existing_qty) + (trade_record.price * trade_record.size)) / v_new_qty;
        
        UPDATE public.holdings
        SET quantity = v_new_qty, avg_price = ROUND(v_new_avg, 4)
        WHERE user_id = trade_record.buyer_id AND stock_id = trade_record.stock_id;
      END IF;
    END IF;

    -- 2. 매도자 현금 입금 및 주식 출고
    IF NOT trade_record.seller_is_bot AND trade_record.seller_id IS NOT NULL THEN
      SELECT quantity, avg_price INTO v_seller_qty, v_existing_avg
      FROM public.holdings
      WHERE user_id = trade_record.seller_id AND stock_id = trade_record.stock_id
      FOR UPDATE;

      IF NOT FOUND OR v_seller_qty < trade_record.size THEN
        RAISE EXCEPTION 'Insufficient holdings for seller %: required=%, available=%',
          trade_record.seller_id,
          trade_record.size,
          COALESCE(v_seller_qty, 0);
      END IF;

      v_new_qty := v_seller_qty - trade_record.size;
      IF v_new_qty = 0 THEN
        DELETE FROM public.holdings WHERE user_id = trade_record.seller_id AND stock_id = trade_record.stock_id;
      ELSE
        UPDATE public.holdings
        SET quantity = v_new_qty
        WHERE user_id = trade_record.seller_id AND stock_id = trade_record.stock_id;
      END IF;

      UPDATE public.profiles
      SET cash = cash + (trade_record.trade_amount * (1 - COALESCE(trade_record.seller_fee, 0.0)))
      WHERE id = trade_record.seller_id;
    END IF;

    -- 3. 체결 내역 기록
    INSERT INTO public.trades (
      stock_id, buyer_id, seller_id, buyer_is_bot, seller_is_bot, price, size, created_at
    ) VALUES (
      trade_record.stock_id, trade_record.buyer_id, trade_record.seller_id,
      trade_record.buyer_is_bot, trade_record.seller_is_bot,
      trade_record.price, trade_record.size, now()
    );

    v_trade_count := v_trade_count + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'settled_count', v_trade_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.bulk_settle_trades(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_settle_trades(JSONB) TO service_role;

-- =====================================================================
-- 23) 단일 트랜잭션 주문 매칭 & 정산 RPC (submit_and_match_order)
-- =====================================================================
CREATE OR REPLACE FUNCTION public.submit_and_match_order(
  p_user_id UUID,
  p_stock_id UUID,
  p_side TEXT,
  p_price NUMERIC,
  p_size BIGINT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_cash NUMERIC;
  v_user_qty INT;
  v_reserved_cash NUMERIC := 0;
  v_reserved_qty INT := 0;
  v_available_cash NUMERIC;
  v_available_qty INT;
  v_required_cash NUMERIC;

  v_remaining_qty BIGINT := p_size;
  v_total_filled BIGINT := 0;
  v_last_exec_price NUMERIC := p_price;
  v_opp_side TEXT;
  v_opp_record RECORD;
  v_opp_remaining BIGINT;
  v_match_qty BIGINT;
  v_exec_price NUMERIC;

  v_buyer_id UUID;
  v_seller_id UUID;
  v_buyer_is_bot BOOLEAN;
  v_seller_is_bot BOOLEAN;
  v_buyer_fee NUMERIC;
  v_seller_fee NUMERIC;

  v_buyer_cash NUMERIC;
  v_seller_qty INT;
  v_existing_qty INT;
  v_existing_avg NUMERIC;
  v_new_qty INT;
  v_new_avg NUMERIC;

  v_new_order_id UUID;
  v_new_order_status TEXT;
BEGIN
  IF p_user_id IS NULL OR p_stock_id IS NULL THEN
    RAISE EXCEPTION 'user_id and stock_id must not be null';
  END IF;

  IF p_side NOT IN ('buy', 'sell') THEN
    RAISE EXCEPTION 'side must be either buy or sell';
  END IF;

  IF p_price <= 0 OR p_size <= 0 THEN
    RAISE EXCEPTION 'price and size must be greater than zero: price=%, size=%', p_price, p_size;
  END IF;

  -- 1. 자산 예약 확인 및 행 잠금
  IF p_side = 'buy' THEN
    SELECT cash INTO v_user_cash FROM public.profiles WHERE id = p_user_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'User profile not found: %', p_user_id;
    END IF;

    SELECT COALESCE(SUM((size - filled) * price), 0) INTO v_reserved_cash
    FROM public.orders
    WHERE user_id = p_user_id AND side = 'buy' AND status IN ('open', 'partial');

    v_available_cash := v_user_cash - v_reserved_cash;
    v_required_cash := p_price * p_size;
    IF v_available_cash < v_required_cash THEN
      RAISE EXCEPTION 'Insufficient available cash: required %, available % (reserved %)',
        v_required_cash, v_available_cash, v_reserved_cash;
    END IF;
  ELSE
    SELECT quantity INTO v_user_qty FROM public.holdings WHERE user_id = p_user_id AND stock_id = p_stock_id FOR UPDATE;
    IF NOT FOUND OR v_user_qty <= 0 THEN
      RAISE EXCEPTION 'No holdings found for selling stock %', p_stock_id;
    END IF;

    SELECT COALESCE(SUM(size - filled), 0) INTO v_reserved_qty
    FROM public.orders
    WHERE user_id = p_user_id AND stock_id = p_stock_id AND side = 'sell' AND status IN ('open', 'partial');

    v_available_qty := v_user_qty - v_reserved_qty;
    IF v_available_qty < p_size THEN
      RAISE EXCEPTION 'Insufficient available holdings: required %, available % (reserved %)',
        p_size, v_available_qty, v_reserved_qty;
    END IF;
  END IF;

  -- 2. 반대 주문 탐색 및 매칭
  v_opp_side := CASE WHEN p_side = 'buy' THEN 'sell' ELSE 'buy' END;

  FOR v_opp_record IN
    SELECT id, user_id, is_lp, side, price, size, filled, status, created_at
    FROM public.orders
    WHERE stock_id = p_stock_id
      AND side = v_opp_side
      AND status IN ('open', 'partial')
      AND (
        (p_side = 'buy' AND price <= p_price) OR
        (p_side = 'sell' AND price >= p_price)
      )
    ORDER BY
      CASE WHEN p_side = 'buy' THEN price END ASC,
      CASE WHEN p_side = 'sell' THEN price END DESC,
      created_at ASC
    FOR UPDATE
  LOOP
    IF v_remaining_qty <= 0 THEN EXIT; END IF;

    v_opp_remaining := v_opp_record.size - v_opp_record.filled;
    IF v_opp_remaining <= 0 THEN CONTINUE; END IF;

    v_match_qty := LEAST(v_remaining_qty, v_opp_remaining);
    IF v_match_qty <= 0 THEN CONTINUE; END IF;

    v_exec_price := v_opp_record.price;
    v_last_exec_price := v_exec_price;

    v_buyer_id := CASE WHEN p_side = 'buy' THEN p_user_id ELSE v_opp_record.user_id END;
    v_seller_id := CASE WHEN p_side = 'sell' THEN p_user_id ELSE v_opp_record.user_id END;
    v_buyer_is_bot := CASE WHEN p_side = 'buy' THEN false ELSE (v_opp_record.user_id IS NULL OR v_opp_record.is_lp) END;
    v_seller_is_bot := CASE WHEN p_side = 'sell' THEN false ELSE (v_opp_record.user_id IS NULL OR v_opp_record.is_lp) END;

    IF p_side = 'buy' THEN
      v_buyer_fee := 0.0025;   -- Taker fee
      v_seller_fee := -0.001;  -- Maker rebate
    ELSE
      v_buyer_fee := -0.001;   -- Maker rebate
      v_seller_fee := 0.0025;  -- Taker fee
    END IF;

    -- 2-1. 매수자 정산
    IF NOT v_buyer_is_bot AND v_buyer_id IS NOT NULL THEN
      SELECT cash INTO v_buyer_cash FROM public.profiles WHERE id = v_buyer_id FOR UPDATE;
      IF v_buyer_cash < (v_exec_price * v_match_qty * (1 + v_buyer_fee)) THEN
        RAISE EXCEPTION 'Insufficient cash for buyer % during execution', v_buyer_id;
      END IF;

      UPDATE public.profiles
      SET cash = cash - (v_exec_price * v_match_qty * (1 + v_buyer_fee)),
          net_worth = net_worth - (v_exec_price * v_match_qty * v_buyer_fee)
      WHERE id = v_buyer_id;

      SELECT quantity, avg_price INTO v_existing_qty, v_existing_avg
      FROM public.holdings WHERE user_id = v_buyer_id AND stock_id = p_stock_id FOR UPDATE;

      IF NOT FOUND THEN
        INSERT INTO public.holdings (user_id, stock_id, quantity, avg_price)
        VALUES (v_buyer_id, p_stock_id, v_match_qty, v_exec_price);
      ELSE
        v_new_qty := v_existing_qty + v_match_qty;
        v_new_avg := ((v_existing_avg * v_existing_qty) + (v_exec_price * v_match_qty)) / v_new_qty;
        UPDATE public.holdings
        SET quantity = v_new_qty, avg_price = ROUND(v_new_avg, 4)
        WHERE user_id = v_buyer_id AND stock_id = p_stock_id;
      END IF;
    END IF;

    -- 2-2. 매도자 정산
    IF NOT v_seller_is_bot AND v_seller_id IS NOT NULL THEN
      SELECT quantity INTO v_seller_qty FROM public.holdings WHERE user_id = v_seller_id AND stock_id = p_stock_id FOR UPDATE;
      IF NOT FOUND OR v_seller_qty < v_match_qty THEN
        RAISE EXCEPTION 'Insufficient holdings for seller % during execution', v_seller_id;
      END IF;

      v_new_qty := v_seller_qty - v_match_qty;
      IF v_new_qty = 0 THEN
        DELETE FROM public.holdings WHERE user_id = v_seller_id AND stock_id = p_stock_id;
      ELSE
        UPDATE public.holdings SET quantity = v_new_qty WHERE user_id = v_seller_id AND stock_id = p_stock_id;
      END IF;

      UPDATE public.profiles
      SET cash = cash + (v_exec_price * v_match_qty * (1 - v_seller_fee)),
          net_worth = net_worth - (v_exec_price * v_match_qty * v_seller_fee)
      WHERE id = v_seller_id;
    END IF;

    -- 2-3. trades 테이블 기록
    INSERT INTO public.trades (
      stock_id, buyer_id, seller_id, buyer_is_bot, seller_is_bot,
      price, size, buyer_fee, seller_fee, created_at
    ) VALUES (
      p_stock_id, v_buyer_id, v_seller_id, v_buyer_is_bot, v_seller_is_bot,
      v_exec_price, v_match_qty, v_buyer_fee, v_seller_fee, now()
    );

    -- 2-4. 상대 주문 상태 UPDATE
    UPDATE public.orders
    SET filled = filled + v_match_qty,
        status = CASE WHEN filled + v_match_qty >= size THEN 'filled' ELSE 'partial' END
    WHERE id = v_opp_record.id;

    v_remaining_qty := v_remaining_qty - v_match_qty;
    v_total_filled := v_total_filled + v_match_qty;
  END LOOP;

  -- 3. 주식 통계 원자적 업데이트
  IF v_total_filled > 0 THEN
    UPDATE public.stocks
    SET current_price = v_last_exec_price,
        high = GREATEST(COALESCE(high, 0), v_last_exec_price),
        low = CASE WHEN COALESCE(low, 0) = 0 THEN v_last_exec_price ELSE LEAST(low, v_last_exec_price) END,
        volume = COALESCE(volume, 0) + v_total_filled
    WHERE id = p_stock_id;
  END IF;

  -- 4. 신규 유저 주문 orders INSERT
  v_new_order_status := CASE
    WHEN v_total_filled = 0 THEN 'open'
    WHEN v_remaining_qty = 0 THEN 'filled'
    ELSE 'partial'
  END;

  INSERT INTO public.orders (
    stock_id, user_id, side, price, size, filled, status, is_lp, created_at
  ) VALUES (
    p_stock_id, p_user_id, p_side, p_price, p_size, v_total_filled, v_new_order_status, false, now()
  ) RETURNING id INTO v_new_order_id;

  -- 5. Invariant 최종 검증
  IF p_side = 'buy' THEN
    SELECT cash INTO v_user_cash FROM public.profiles WHERE id = p_user_id;
    IF v_user_cash < 0 THEN RAISE EXCEPTION 'Invariant violation: negative cash balance (%)', v_user_cash; END IF;
  ELSE
    SELECT quantity INTO v_user_qty FROM public.holdings WHERE user_id = p_user_id AND stock_id = p_stock_id;
    IF v_user_qty < 0 THEN RAISE EXCEPTION 'Invariant violation: negative holdings quantity (%)', v_user_qty; END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_new_order_id,
    'filled_qty', v_total_filled,
    'exec_price', v_last_exec_price,
    'status', v_new_order_status,
    'message', CASE
      WHEN v_total_filled > 0 THEN format('🎉 %s주가 체결되었습니다! (체결가: ₩%s)', v_total_filled, v_last_exec_price)
      ELSE format('주문이 호가창에 정상 접수되었습니다! (%s원 %s주)', p_price, p_size)
    END
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_and_match_order(UUID, UUID, TEXT, NUMERIC, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_and_match_order(UUID, UUID, TEXT, NUMERIC, BIGINT) TO service_role;

-- 완료
DO $$ BEGIN RAISE NOTICE 'VM DB 스키마 초기화 완료'; END $$;