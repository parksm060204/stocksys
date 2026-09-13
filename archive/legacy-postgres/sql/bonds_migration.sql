-- =====================================================================
-- Bonds Table Migration
-- 채권 전용 테이블 — stocks 테이블과 분리
-- Supabase SQL Editor에서 실행하세요.
-- AGENTS.md Supabase 정책 완벽 적용 (GRANT + RLS + Policy)
-- =====================================================================

-- 1) bonds 테이블 생성
CREATE TABLE IF NOT EXISTS public.bonds (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  bond_id         text        NOT NULL UNIQUE,      -- 'US_TREASURY_10Y' 형식 고유 ID
  name            text        NOT NULL,             -- '미국 국채 10년물'
  ticker          text        NOT NULL UNIQUE,      -- 'US10Y'
  face_value      numeric(10,2) NOT NULL DEFAULT 100, -- 액면가 (100 기준)
  coupon_rate     numeric(6,4) NOT NULL,            -- 표면금리 (%) e.g. 3.5000
  maturity_years  numeric(5,1) NOT NULL,            -- 잔존만기 (년) e.g. 9.5
  current_price   numeric(10,4) NOT NULL,           -- 현재 가격 (액면가 대비 %)
  current_ytm     numeric(8,4) NOT NULL DEFAULT 0,  -- 현재 만기수익률 (%, 자동계산)
  previous_price  numeric(10,4) NOT NULL DEFAULT 0, -- 전일 가격
  country_code    text        NOT NULL DEFAULT 'KR', -- 발행 국가
  issuer_name     text,                             -- 발행기관/기업명
  risk_category   text        NOT NULL DEFAULT 'sovereign'
                  CHECK (risk_category IN ('sovereign', 'corporate_ig', 'high_yield')),
  sector          text        NOT NULL DEFAULT '채권',
  description     text        NOT NULL DEFAULT '',
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- 2) GRANT (PostgREST API 접근 허용)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bonds TO anon, authenticated;

-- 3) RLS 활성화
ALTER TABLE public.bonds ENABLE ROW LEVEL SECURITY;

-- 4) RLS Policy
CREATE POLICY "Anyone can view bonds"
ON public.bonds FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "Admins can insert bonds"
ON public.bonds FOR INSERT
TO authenticated
WITH CHECK (true);

CREATE POLICY "Admins can update bonds"
ON public.bonds FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Admins can delete bonds"
ON public.bonds FOR DELETE
TO authenticated
USING (true);

-- 5) YTM 자동계산 함수 (price 업데이트 시 자동 갱신)
--    근사 공식: YTM ≈ (C + (F - P)/N) / ((F + P)/2)
CREATE OR REPLACE FUNCTION public.calc_bond_ytm()
RETURNS TRIGGER AS $$
DECLARE
  C numeric;
  F numeric;
  P numeric;
  N numeric;
  ytm_val numeric;
BEGIN
  C := (NEW.coupon_rate / 100.0) * NEW.face_value;
  F := NEW.face_value;
  P := NEW.current_price;
  N := NEW.maturity_years;
  IF P > 0 AND N > 0 THEN
    ytm_val := (C + (F - P) / N) / ((F + P) / 2.0) * 100.0;
    NEW.current_ytm := GREATEST(0, ROUND(ytm_val::numeric, 4));
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6) 트리거 등록
DROP TRIGGER IF EXISTS trg_calc_ytm ON public.bonds;
CREATE TRIGGER trg_calc_ytm
BEFORE INSERT OR UPDATE OF current_price ON public.bonds
FOR EACH ROW EXECUTE FUNCTION public.calc_bond_ytm();

-- 7) Realtime 활성화 (이미 등록된 경우 무시)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND tablename = 'bonds'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.bonds;
  END IF;
END $$;

-- =====================================================================
-- 초기 데이터 INSERT
-- 9종 채권 라인업:
--   국채 3종: 미국채10Y, 한국채10Y, 독일분트10Y
--   우량회사채 2종: 오성전자3Y, 노바에너지5Y
--   하이일드 2종: 글로벌테크(부실) 7Y, 소설 내 부실기업 5Y
--   기타 2종: 일본JGB10Y, 영국길트10Y
-- =====================================================================

INSERT INTO public.bonds
  (bond_id, name, ticker, face_value, coupon_rate, maturity_years, current_price, previous_price, country_code, issuer_name, risk_category, sector, description)
VALUES
  -- 미국채 10년물 (글로벌 안전자산 끝판왕)
  ('US_TREASURY_10Y', '미국 국채 10년물', 'US10Y', 100, 4.25, 9.5,
   97.80, 98.10, 'US', 'U.S. Department of Treasury', 'sovereign', '채권',
   '글로벌 안전자산의 기준. 전쟁·금융위기 시 폭등. 연준 기준금리에 가장 민감하게 반응.'),

  -- 한국 국채 10년물
  ('KR_TREASURY_10Y', '한국 국채 10년물', 'KR10Y', 100, 3.40, 9.2,
   98.50, 98.70, 'KR', '기획재정부', 'sovereign', '채권',
   '국내 증시 하락 시 방어 수단. 한국은행 기준금리 정책에 직결.'),

  -- 독일 분트 10년물 (유럽 안전자산)
  ('DE_BUND_10Y', '독일 국채 10년물 (분트)', 'DE10Y', 100, 2.60, 9.8,
   99.10, 99.40, 'DE', 'Deutsche Finanzagentur', 'sovereign', '채권',
   '유럽 시장 지표 채권. ECB 금리 정책과 연동. 유럽 위기 시 안전 피난처.'),

  -- 일본 JGB 10년물
  ('JP_JGB_10Y', '일본 국채 10년물 (JGB)', 'JP10Y', 100, 0.80, 9.1,
   99.80, 99.85, 'JP', '일본 재무성', 'sovereign', '채권',
   '극히 낮은 쿠폰. 엔 캐리 트레이드와 연결된 글로벌 유동성 지표.'),

  -- 영국 길트 10년물
  ('UK_GILT_10Y', '영국 국채 10년물 (길트)', 'UK10Y', 100, 4.10, 9.3,
   97.20, 97.50, 'GB', 'UK Debt Management Office', 'sovereign', '채권',
   '브렉시트 이후 변동성 확대. 영국은행(BOE) 금리 정책 반영.'),

  -- 오성전자 3년물 (우량 회사채)
  ('OSUNG_CORP_3Y', '오성전자 3년 회사채', 'OSEL3Y', 100, 4.80, 2.8,
   99.60, 99.70, 'KR', '오성전자', 'corporate_ig', '채권',
   '초우량 회사채. 오성전자 재무 상태가 주가보다 먼저 반영됨. 국채 대비 +80bp 프리미엄.'),

  -- 노바에너지 5년물 (우량 회사채)
  ('NOVA_ENERGY_5Y', '노바에너지 5년 회사채', 'NOVA5Y', 100, 5.20, 4.5,
   99.10, 99.30, 'KR', '노바 에너지', 'corporate_ig', '채권',
   '소설 대장주 노바에너지 발행 채권. 에너지 서사 전개에 따라 가격 동조.'),

  -- 글로벌테크 정크본드 (하이일드)
  ('GLOBALTECH_HY_7Y', '글로벌테크 7년 고수익채', 'GTHY7Y', 100, 16.50, 6.5,
   72.40, 74.00, 'US', 'GlobalTech Corp (Fiction)', 'high_yield', '채권',
   '부도 위기 하이일드. 쿠폰 16.5%지만 부도 시 0원. 소설에서 회사 운명에 따라 가격 급변동.'),

  -- 아크리스 하이일드 (소설 내 부실 기업)
  ('AKRIS_HY_5Y', '아크리스 5년 정크본드', 'AKHY5Y', 100, 19.00, 4.2,
   58.30, 61.00, 'KR', '아크리스 (소설 내 부실기업)', 'high_yield', '채권',
   '소설 내 파산 위기 기업. 19% 고쿠폰이지만 회사 부도 처리 시 즉시 휴지조각. 최고위험 상품.')

ON CONFLICT (bond_id) DO UPDATE
  SET current_price = EXCLUDED.current_price,
      updated_at = now();
