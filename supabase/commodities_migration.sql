-- =====================================================================
-- Commodities Table Migration
-- 원자재 선물 테이블 (WTI, Gold 등)
-- Supabase SQL Editor에서 실행하세요.
-- =====================================================================

-- 1) commodities 테이블 생성
CREATE TABLE IF NOT EXISTS public.commodities (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  commodity_id    text        NOT NULL UNIQUE,      -- 'WTI_CRUDE', 'GOLD_1OZ' 등
  name            text        NOT NULL,             -- 'WTI 원유 선물'
  ticker          text        NOT NULL UNIQUE,      -- 'CL', 'GC'
  current_price   numeric(10,4) NOT NULL,           -- 현재 가격
  previous_price  numeric(10,4) NOT NULL DEFAULT 0, -- 전일 가격
  unit            text        NOT NULL,             -- '배럴', '온스'
  tick_size       numeric(10,4) NOT NULL,           -- 최소 호가 단위 (예: 0.01)
  tick_value      numeric(10,4) NOT NULL,           -- 틱당 가치 (달러 등)
  margin_requirement numeric(10,2) NOT NULL DEFAULT 0, -- 증거금
  description     text        NOT NULL DEFAULT '',
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 2) GRANT (PostgREST API 접근 허용)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.commodities TO anon, authenticated;

-- 3) RLS 활성화
ALTER TABLE public.commodities ENABLE ROW LEVEL SECURITY;

-- 4) RLS Policy
CREATE POLICY "Anyone can view commodities"
ON public.commodities FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "Admins can update commodities"
ON public.commodities FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

-- 5) 트리거 등록 (updated_at 자동 갱신)
CREATE OR REPLACE FUNCTION public.update_commodities_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_commodities_updated_at ON public.commodities;
CREATE TRIGGER trg_commodities_updated_at
BEFORE UPDATE ON public.commodities
FOR EACH ROW EXECUTE FUNCTION public.update_commodities_updated_at();

-- 6) Realtime 활성화
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'commodities'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.commodities;
  END IF;
END $$;

-- 7) 초기 데이터 세팅 (Seed Data)
INSERT INTO public.commodities (commodity_id, name, ticker, current_price, previous_price, unit, tick_size, tick_value, margin_requirement, description)
VALUES
  ('WTI_CRUDE', 'WTI 원유 선물', 'CL', 75.50, 74.20, '배럴', 0.01, 10, 5000, '뉴욕상업거래소(NYMEX) 기준 WTI 원유 선물. 글로벌 매크로 경제 및 인플레이션의 핵심 지표입니다.'),
  ('GOLD_1OZ', '금 선물 (1oz)', 'GC', 2050.10, 2045.00, '온스', 0.10, 10, 8000, '안전 자산의 대명사. 증시 패닉이나 인플레이션 우려 시 상승합니다.'),
  ('COPPER', '구리 선물', 'HG', 3.8500, 3.8000, '파운드', 0.0005, 12.50, 4000, '닥터 코퍼. 글로벌 제조업 및 인프라 경기의 선행 지표 역할을 합니다.'),
  ('NATURAL_GAS', '천연가스 선물', 'NG', 2.850, 2.900, 'MMBtu', 0.001, 10, 3000, '변동성이 매우 극심한 에너지 상품. 날씨와 계절의 영향을 강하게 받습니다.'),
  ('CORN', '옥수수 선물', 'ZC', 450.25, 448.50, '부셸', 0.25, 12.50, 2000, '대표적인 농산물 선물. 기후 변화와 식량 안보 테마에 반응합니다.')
ON CONFLICT (commodity_id) DO NOTHING;
