-- supabase/bot_allocations_migration.sql
-- Run this migration to completely replace bots_config with the new specific allocations.

CREATE TABLE IF NOT EXISTS public.bots_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  bot_type TEXT NOT NULL,
  capital BIGINT NOT NULL,
  traits JSONB NOT NULL,
  real_world_target TEXT
);

-- Enable RLS and Policies
ALTER TABLE public.bots_config ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.bots_config TO anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'bots_config' AND policyname = 'Bots config is viewable by everyone'
    ) THEN
        CREATE POLICY "Bots config is viewable by everyone" ON public.bots_config FOR SELECT USING (true);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'bots_config' AND policyname = 'Admin can modify bots_config'
    ) THEN
        CREATE POLICY "Admin can modify bots_config" ON public.bots_config FOR ALL TO authenticated USING (true) WITH CHECK (true);
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.institutional_portfolios (
    bot_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    total_capital NUMERIC NOT NULL,
    current_cash NUMERIC NOT NULL,
    current_stock NUMERIC NOT NULL,
    current_bond NUMERIC NOT NULL,
    current_commodity NUMERIC NOT NULL,
    target_weights JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Apply Supabase Policies per AGENTS.md rules
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.institutional_portfolios TO anon, authenticated;

-- (Optional) If RLS isn't enabled yet:
ALTER TABLE public.institutional_portfolios ENABLE ROW LEVEL SECURITY;

-- Allow read access to all users (Dashboard data is public)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'institutional_portfolios' AND policyname = 'Anyone can view institutional portfolios'
    ) THEN
        CREATE POLICY "Anyone can view institutional portfolios"
        ON public.institutional_portfolios FOR SELECT
        USING (true);
    END IF;
END
$$;

ALTER TABLE public.institutional_portfolios ADD COLUMN IF NOT EXISTS current_kr_equity NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.institutional_portfolios ADD COLUMN IF NOT EXISTS current_us_equity NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.institutional_portfolios ADD COLUMN IF NOT EXISTS current_eu_equity NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE public.institutional_portfolios ADD COLUMN IF NOT EXISTS current_derivatives NUMERIC NOT NULL DEFAULT 0;

TRUNCATE TABLE public.bots_config;

INSERT INTO public.bots_config (name, bot_type, capital, traits) VALUES
('NPS (한국 국민연금)', 'PENSION_FUND', 1200000000000000, '{"targetAllocation":{"kr_equity":0.15,"us_equity":0.35,"eu_equity":0.05,"bond":0.4,"commodity":0,"derivatives":0,"cash":0.05},"gamma":0.5,"strategyDescription":"국내주식 하방 방어, 글로벌 장기채권 매집","tradingStyle":"LIMIT_HEAVY","reactionSpeed":800,"riskTolerance":0.05}'::jsonb),
('CalPERS (미 캘리포니아 공무원 연금)', 'PENSION_FUND', 650000000000000, '{"targetAllocation":{"kr_equity":0.01,"us_equity":0.45,"eu_equity":0.14,"bond":0.35,"commodity":0.02,"derivatives":0,"cash":0.03},"gamma":0.6,"strategyDescription":"미국 중심 글로벌 주식/채권 배분","tradingStyle":"LIMIT_HEAVY","reactionSpeed":800,"riskTolerance":0.06}'::jsonb),
('GPIF (일본 연금적립금)', 'PENSION_FUND', 2000000000000000, '{"targetAllocation":{"kr_equity":0.01,"us_equity":0.45,"eu_equity":0.04,"bond":0.45,"commodity":0,"derivatives":0,"cash":0.05},"gamma":0.5,"strategyDescription":"초안전자산 및 선진국 주식 패시브 추종","tradingStyle":"LIMIT_HEAVY","reactionSpeed":800,"riskTolerance":0.05}'::jsonb),
('NBIM (노르웨이 국부펀드)', 'PENSION_FUND', 2200000000000000, '{"targetAllocation":{"kr_equity":0.01,"us_equity":0.45,"eu_equity":0.2,"bond":0.3,"commodity":0,"derivatives":0,"cash":0.04},"gamma":0.6,"strategyDescription":"유럽/미국 중심 글로벌 패시브 흐름 주도","tradingStyle":"LIMIT_HEAVY","reactionSpeed":800,"riskTolerance":0.06}'::jsonb),
('CPPIB (캐나다 연금)', 'PENSION_FUND', 600000000000000, '{"targetAllocation":{"kr_equity":0.01,"us_equity":0.4,"eu_equity":0.09,"bond":0.3,"commodity":0.1,"derivatives":0,"cash":0.1},"gamma":0.7,"strategyDescription":"대체투자 및 원자재(에너지) 비중 높음","tradingStyle":"LIMIT_HEAVY","reactionSpeed":800,"riskTolerance":0.06999999999999999}'::jsonb),
('APG (네덜란드 공무원 연금)', 'PENSION_FUND', 850000000000000, '{"targetAllocation":{"kr_equity":0.01,"us_equity":0.35,"eu_equity":0.25,"bond":0.35,"commodity":0,"derivatives":0,"cash":0.04},"gamma":0.5,"strategyDescription":"유로스톡스 주식 비중 상대적 과체중","tradingStyle":"LIMIT_HEAVY","reactionSpeed":800,"riskTolerance":0.05}'::jsonb),
('GIC (싱가포르 국부펀드)', 'PENSION_FUND', 1000000000000000, '{"targetAllocation":{"kr_equity":0.05,"us_equity":0.35,"eu_equity":0.1,"bond":0.4,"commodity":0.05,"derivatives":0,"cash":0.05},"gamma":0.6,"strategyDescription":"아시아 신흥국 및 선진국 정밀 분산","tradingStyle":"LIMIT_HEAVY","reactionSpeed":800,"riskTolerance":0.06}'::jsonb),
('Temasek (테마섹 홀딩스)', 'PENSION_FUND', 400000000000000, '{"targetAllocation":{"kr_equity":0.05,"us_equity":0.4,"eu_equity":0.1,"bond":0.2,"commodity":0.05,"derivatives":0,"cash":0.2},"gamma":0.8,"strategyDescription":"공격적 에퀴티 투자 및 현금(Cash) 대기","tradingStyle":"LIMIT_HEAVY","reactionSpeed":800,"riskTolerance":0.08000000000000002}'::jsonb),
('KIC (한국투자공사)', 'PENSION_FUND', 250000000000000, '{"targetAllocation":{"kr_equity":0,"us_equity":0.5,"eu_equity":0.15,"bond":0.3,"commodity":0,"derivatives":0,"cash":0.05},"gamma":0.6,"strategyDescription":"100% 해외자산 투자 (국내 편입 배제)","tradingStyle":"LIMIT_HEAVY","reactionSpeed":800,"riskTolerance":0.06}'::jsonb),
('NYSCRF (뉴욕주 퇴직연금)', 'PENSION_FUND', 350000000000000, '{"targetAllocation":{"kr_equity":0,"us_equity":0.5,"eu_equity":0.1,"bond":0.35,"commodity":0,"derivatives":0,"cash":0.05},"gamma":0.5,"strategyDescription":"보수적 자산 배분 (S&P 50 추종)","tradingStyle":"LIMIT_HEAVY","reactionSpeed":800,"riskTolerance":0.05}'::jsonb),
('Texas Teachers (텍사스 교원연금)', 'PENSION_FUND', 260000000000000, '{"targetAllocation":{"kr_equity":0,"us_equity":0.45,"eu_equity":0.1,"bond":0.35,"commodity":0.05,"derivatives":0,"cash":0.05},"gamma":0.6,"strategyDescription":"원자재 및 에너지 섹터 선호","tradingStyle":"LIMIT_HEAVY","reactionSpeed":800,"riskTolerance":0.06}'::jsonb),
('Florida SBA (플로리다 연금)', 'PENSION_FUND', 240000000000000, '{"targetAllocation":{"kr_equity":0,"us_equity":0.45,"eu_equity":0.1,"bond":0.4,"commodity":0,"derivatives":0,"cash":0.05},"gamma":0.5,"strategyDescription":"미국 대형주와 우량 채권 중심의 방어전","tradingStyle":"LIMIT_HEAVY","reactionSpeed":800,"riskTolerance":0.05}'::jsonb),
('J.P. Morgan (제이피모건)', 'COMMERCIAL_BANK', 400000000000000, '{"targetAllocation":{"kr_equity":0.01,"us_equity":0.2,"eu_equity":0.09,"bond":0.5,"commodity":0.05,"derivatives":0.1,"cash":0.05},"gamma":1,"strategyDescription":"금리 민감, 강력한 채권 차익 및 매크로 트레이딩","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":800,"riskTolerance":0.1}'::jsonb),
('Citi Bank (씨티은행)', 'COMMERCIAL_BANK', 300000000000000, '{"targetAllocation":{"kr_equity":0.01,"us_equity":0.15,"eu_equity":0.09,"bond":0.55,"commodity":0.05,"derivatives":0.1,"cash":0.05},"gamma":0.9,"strategyDescription":"신흥국 통화 및 글로벌 금리 갭 차익","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":800,"riskTolerance":0.09000000000000001}'::jsonb),
('Bank of America (BofA)', 'COMMERCIAL_BANK', 350000000000000, '{"targetAllocation":{"kr_equity":0.01,"us_equity":0.25,"eu_equity":0.04,"bond":0.5,"commodity":0,"derivatives":0.1,"cash":0.1},"gamma":0.9,"strategyDescription":"미국 내수 중심 주식 및 픽스드인컴","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":800,"riskTolerance":0.09000000000000001}'::jsonb),
('Wells Fargo (웰스파고)', 'COMMERCIAL_BANK', 250000000000000, '{"targetAllocation":{"kr_equity":0,"us_equity":0.3,"eu_equity":0,"bond":0.55,"commodity":0,"derivatives":0.05,"cash":0.1},"gamma":0.8,"strategyDescription":"보수적인 국채 및 회사채 포트폴리오","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":800,"riskTolerance":0.08000000000000002}'::jsonb),
('Goldman Sachs Bank', 'COMMERCIAL_BANK', 350000000000000, '{"targetAllocation":{"kr_equity":0.02,"us_equity":0.25,"eu_equity":0.1,"bond":0.3,"commodity":0.1,"derivatives":0.15,"cash":0.08},"gamma":1.5,"strategyDescription":"원자재 및 파생상품 선도, 고위험 감수","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":800,"riskTolerance":0.15000000000000002}'::jsonb),
('Morgan Stanley (모건스탠리)', 'COMMERCIAL_BANK', 320000000000000, '{"targetAllocation":{"kr_equity":0.02,"us_equity":0.3,"eu_equity":0.1,"bond":0.3,"commodity":0.05,"derivatives":0.15,"cash":0.08},"gamma":1.4,"strategyDescription":"에퀴티 언더라이팅 및 콜/풋 옵션 월 형성","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":800,"riskTolerance":0.13999999999999999}'::jsonb),
('HSBC (에이치에스비씨)', 'COMMERCIAL_BANK', 280000000000000, '{"targetAllocation":{"kr_equity":0.05,"us_equity":0.1,"eu_equity":0.2,"bond":0.5,"commodity":0.05,"derivatives":0.05,"cash":0.05},"gamma":0.9,"strategyDescription":"아시아/유럽 크로스보더 자금 흐름 주도","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":800,"riskTolerance":0.09000000000000001}'::jsonb),
('Barclays (바클레이즈)', 'COMMERCIAL_BANK', 220000000000000, '{"targetAllocation":{"kr_equity":0.01,"us_equity":0.15,"eu_equity":0.25,"bond":0.4,"commodity":0.04,"derivatives":0.1,"cash":0.05},"gamma":1.1,"strategyDescription":"유로스톡스 50 및 영국 금리 차익","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":800,"riskTolerance":0.11000000000000001}'::jsonb),
('Deutsche Bank (도이치뱅크)', 'COMMERCIAL_BANK', 200000000000000, '{"targetAllocation":{"kr_equity":0,"us_equity":0.1,"eu_equity":0.3,"bond":0.4,"commodity":0,"derivatives":0.15,"cash":0.05},"gamma":1.2,"strategyDescription":"유럽 매크로 헷징 및 파생상품 딜링","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":800,"riskTolerance":0.12}'::jsonb),
('BNP Paribas (BNP 파리바)', 'COMMERCIAL_BANK', 240000000000000, '{"targetAllocation":{"kr_equity":0,"us_equity":0.1,"eu_equity":0.3,"bond":0.45,"commodity":0,"derivatives":0.1,"cash":0.05},"gamma":1,"strategyDescription":"안정적인 유로존 국채 및 옵션 헷징","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":800,"riskTolerance":0.1}'::jsonb),
('UBS (유비에스)', 'COMMERCIAL_BANK', 260000000000000, '{"targetAllocation":{"kr_equity":0.02,"us_equity":0.2,"eu_equity":0.25,"bond":0.35,"commodity":0.03,"derivatives":0.1,"cash":0.05},"gamma":1.1,"strategyDescription":"안정적 분산 자산관리 (WM 중심)","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":800,"riskTolerance":0.11000000000000001}'::jsonb),
('Santander (산탄데르)', 'COMMERCIAL_BANK', 180000000000000, '{"targetAllocation":{"kr_equity":0,"us_equity":0.05,"eu_equity":0.35,"bond":0.5,"commodity":0,"derivatives":0.05,"cash":0.05},"gamma":0.9,"strategyDescription":"남유럽 국채 및 유로스톡스 편향","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":800,"riskTolerance":0.09000000000000001}'::jsonb),
('Standard Chartered', 'COMMERCIAL_BANK', 150000000000000, '{"targetAllocation":{"kr_equity":0.05,"us_equity":0.05,"eu_equity":0.15,"bond":0.6,"commodity":0.05,"derivatives":0.05,"cash":0.05},"gamma":0.9,"strategyDescription":"신흥국 채권(한국 포함) 차익 위주","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":800,"riskTolerance":0.09000000000000001}'::jsonb),
('Soros Fund Management', 'HEDGE_FUND', 40000000000000, '{"targetAllocation":{"kr_equity":0.05,"us_equity":0.3,"eu_equity":0.15,"bond":0.1,"commodity":0.1,"derivatives":0.2,"cash":0.1},"gamma":2.8,"strategyDescription":"매크로 취약점 공격 (가짜 뉴스 투매/폭등 스윕)","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":500,"riskTolerance":0.27999999999999997}'::jsonb),
('BlackRock (블랙록)', 'HEDGE_FUND', 13000000000000000, '{"targetAllocation":{"kr_equity":0.02,"us_equity":0.48,"eu_equity":0.15,"bond":0.3,"commodity":0.02,"derivatives":0.01,"cash":0.02},"gamma":1,"strategyDescription":"시장 그 자체. 전 세계 지수 패시브 복제 (ALADDIN)","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":500,"riskTolerance":0.1}'::jsonb),
('Vanguard (뱅가드)', 'HEDGE_FUND', 10000000000000000, '{"targetAllocation":{"kr_equity":0.02,"us_equity":0.5,"eu_equity":0.13,"bond":0.32,"commodity":0.01,"derivatives":0,"cash":0.02},"gamma":0.9,"strategyDescription":"저비용 인덱스 펀드, 시장 충격 없이 매집(TWAP)","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":500,"riskTolerance":0.09000000000000001}'::jsonb),
('Renaissance Technologies', 'HEDGE_FUND', 160000000000000, '{"targetAllocation":{"kr_equity":0.05,"us_equity":0.4,"eu_equity":0.1,"bond":0,"commodity":0.05,"derivatives":0.3,"cash":0.1},"gamma":2.5,"strategyDescription":"스프레드 차익거래, 펀더멘털 방향성 없음","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":500,"riskTolerance":0.25}'::jsonb),
('Bridgewater Associates', 'HEDGE_FUND', 200000000000000, '{"targetAllocation":{"kr_equity":0.02,"us_equity":0.28,"eu_equity":0.1,"bond":0.4,"commodity":0.15,"derivatives":0,"cash":0.05},"gamma":1.2,"strategyDescription":"사계절 포트폴리오 (인플레이션 시 원자재 스윕)","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":500,"riskTolerance":0.12}'::jsonb),
('Citadel (시타델)', 'HEDGE_FUND', 80000000000000, '{"targetAllocation":{"kr_equity":0.05,"us_equity":0.35,"eu_equity":0.1,"bond":0.05,"commodity":0.05,"derivatives":0.35,"cash":0.05},"gamma":2.2,"strategyDescription":"옵션 델타 헤징 및 감마 스퀴즈 유발","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":500,"riskTolerance":0.22000000000000003}'::jsonb),
('Two Sigma (투시그마)', 'HEDGE_FUND', 85000000000000, '{"targetAllocation":{"kr_equity":0.04,"us_equity":0.4,"eu_equity":0.1,"bond":0.1,"commodity":0.05,"derivatives":0.25,"cash":0.06},"gamma":2,"strategyDescription":"빅데이터 기반 단기 모멘텀 트레이딩","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":500,"riskTolerance":0.2}'::jsonb),
('D.E. Shaw (DE 쇼)', 'HEDGE_FUND', 80000000000000, '{"targetAllocation":{"kr_equity":0.03,"us_equity":0.35,"eu_equity":0.12,"bond":0.15,"commodity":0.05,"derivatives":0.2,"cash":0.1},"gamma":1.9,"strategyDescription":"퀀트 및 하이브리드 이벤트 드리븐","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":500,"riskTolerance":0.19}'::jsonb),
('Elliott Management', 'HEDGE_FUND', 70000000000000, '{"targetAllocation":{"kr_equity":0.1,"us_equity":0.4,"eu_equity":0.1,"bond":0.1,"commodity":0,"derivatives":0.1,"cash":0.2},"gamma":2.4,"strategyDescription":"이벤트 드리븐 (특정 주식 집중 매수 후 펌핑)","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":500,"riskTolerance":0.24}'::jsonb),
('Point72 (포인트72)', 'HEDGE_FUND', 40000000000000, '{"targetAllocation":{"kr_equity":0.05,"us_equity":0.5,"eu_equity":0.1,"bond":0.05,"commodity":0.05,"derivatives":0.15,"cash":0.1},"gamma":2.1,"strategyDescription":"롱/숏 에퀴티. 고도로 정밀한 실적 플레이","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":500,"riskTolerance":0.21000000000000002}'::jsonb),
('Millennium Management', 'HEDGE_FUND', 80000000000000, '{"targetAllocation":{"kr_equity":0.04,"us_equity":0.4,"eu_equity":0.15,"bond":0.1,"commodity":0.06,"derivatives":0.15,"cash":0.1},"gamma":1.8,"strategyDescription":"다중 매니저, 짧은 주기 차익 실현","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":500,"riskTolerance":0.18000000000000002}'::jsonb),
('AQR Capital', 'HEDGE_FUND', 130000000000000, '{"targetAllocation":{"kr_equity":0.03,"us_equity":0.35,"eu_equity":0.15,"bond":0.2,"commodity":0.07,"derivatives":0.1,"cash":0.1},"gamma":1.5,"strategyDescription":"팩터 기반(가치, 모멘텀) 분산 투자","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":500,"riskTolerance":0.15000000000000002}'::jsonb),
('Baupost Group', 'HEDGE_FUND', 40000000000000, '{"targetAllocation":{"kr_equity":0.02,"us_equity":0.3,"eu_equity":0.08,"bond":0.1,"commodity":0,"derivatives":0.1,"cash":0.4},"gamma":1.2,"strategyDescription":"초안전 마진(현금 40% 대기) 폭락장 투매 줍기","tradingStyle":"SWEEP_AGGRESSIVE","reactionSpeed":500,"riskTolerance":0.12}'::jsonb),
('Jane Street (제인스트리트)', 'PROP_DESK', 30000000000000, '{"targetAllocation":{"kr_equity":0.05,"us_equity":0.25,"eu_equity":0.1,"bond":0,"commodity":0,"derivatives":0.45,"cash":0.15},"gamma":2.5,"strategyDescription":"ETF-현물 간 차익거래 및 파생상품 마켓메이킹","tradingStyle":"MARKET_MAKER","reactionSpeed":200,"riskTolerance":0.25}'::jsonb),
('Optiver (옵티버)', 'PROP_DESK', 20000000000000, '{"targetAllocation":{"kr_equity":0.02,"us_equity":0.2,"eu_equity":0.2,"bond":0,"commodity":0,"derivatives":0.45,"cash":0.13},"gamma":2.4,"strategyDescription":"유럽/미국 옵션 스프레드 집중 유동성 공급","tradingStyle":"MARKET_MAKER","reactionSpeed":200,"riskTolerance":0.24}'::jsonb),
('Jump Trading (점프 트레이딩)', 'PROP_DESK', 15000000000000, '{"targetAllocation":{"kr_equity":0.05,"us_equity":0.35,"eu_equity":0.05,"bond":0,"commodity":0.05,"derivatives":0.3,"cash":0.2},"gamma":2.8,"strategyDescription":"선물/현물 마이크로초 단위 스캘핑","tradingStyle":"MARKET_MAKER","reactionSpeed":200,"riskTolerance":0.27999999999999997}'::jsonb),
('Susquehanna (SIG)', 'PROP_DESK', 25000000000000, '{"targetAllocation":{"kr_equity":0.02,"us_equity":0.3,"eu_equity":0.08,"bond":0,"commodity":0,"derivatives":0.5,"cash":0.1},"gamma":2.3,"strategyDescription":"미국 옵션 호가창 전역 촘촘한 빙산 주문(Iceberg)","tradingStyle":"MARKET_MAKER","reactionSpeed":200,"riskTolerance":0.22999999999999998}'::jsonb),
('DRW (디알더블유)', 'PROP_DESK', 15000000000000, '{"targetAllocation":{"kr_equity":0,"us_equity":0.2,"eu_equity":0.1,"bond":0.15,"commodity":0.15,"derivatives":0.25,"cash":0.15},"gamma":2.2,"strategyDescription":"실물/원자재 연계 파생상품 차익","tradingStyle":"MARKET_MAKER","reactionSpeed":200,"riskTolerance":0.22000000000000003}'::jsonb),
('Hudson River Trading (HRT)', 'PROP_DESK', 10000000000000, '{"targetAllocation":{"kr_equity":0.04,"us_equity":0.4,"eu_equity":0.16,"bond":0,"commodity":0,"derivatives":0.25,"cash":0.15},"gamma":2.6,"strategyDescription":"AI 기반 전 자산군 오더플로우 선행매매(Front-running)","tradingStyle":"MARKET_MAKER","reactionSpeed":200,"riskTolerance":0.26}'::jsonb),
('Reddit WallStreetBets', 'RETAIL_SWARM', 15000000000000, '{"targetAllocation":{"kr_equity":0,"us_equity":0.7,"eu_equity":0,"bond":0,"commodity":0,"derivatives":0.25,"cash":0.05},"gamma":3,"strategyDescription":"미국 밈주식 영끌 펌핑 및 OTM 콜옵션 몰빵","tradingStyle":"MOMENTUM_CHASER","reactionSpeed":800,"riskTolerance":0.30000000000000004}'::jsonb),
('Robinhood Retail Army', 'RETAIL_SWARM', 10000000000000, '{"targetAllocation":{"kr_equity":0,"us_equity":0.85,"eu_equity":0,"bond":0,"commodity":0,"derivatives":0.1,"cash":0.05},"gamma":2.7,"strategyDescription":"미국 S&P 50 대형주 맹목적 추종 및 패닉셀","tradingStyle":"MOMENTUM_CHASER","reactionSpeed":800,"riskTolerance":0.27}'::jsonb),
('Naver Finance Board (종토방)', 'RETAIL_SWARM', 5000000000000, '{"targetAllocation":{"kr_equity":0.85,"us_equity":0.05,"eu_equity":0,"bond":0,"commodity":0,"derivatives":0,"cash":0.1},"gamma":2.5,"strategyDescription":"국내주식 가십 반응, 테마/세력주 묻지마 추격","tradingStyle":"MOMENTUM_CHASER","reactionSpeed":800,"riskTolerance":0.25}'::jsonb),
('DC Inside Stock Gallery', 'RETAIL_SWARM', 3000000000000, '{"targetAllocation":{"kr_equity":0.5,"us_equity":0.4,"eu_equity":0,"bond":0,"commodity":0,"derivatives":0.05,"cash":0.05},"gamma":2.9,"strategyDescription":"국내/미국 레버리지 ETF 및 야수의 심장 베팅","tradingStyle":"MOMENTUM_CHASER","reactionSpeed":800,"riskTolerance":0.29}'::jsonb),
('Telegram Crypto/Stock Signals', 'RETAIL_SWARM', 2000000000000, '{"targetAllocation":{"kr_equity":0.6,"us_equity":0.2,"eu_equity":0,"bond":0,"commodity":0,"derivatives":0.1,"cash":0.1},"gamma":3,"strategyDescription":"작전 세력 펌핑(마크업)에 동원되는 불나방","tradingStyle":"MOMENTUM_CHASER","reactionSpeed":800,"riskTolerance":0.30000000000000004}'::jsonb),
('Kakao Open Chat Rooms', 'RETAIL_SWARM', 2000000000000, '{"targetAllocation":{"kr_equity":0.9,"us_equity":0,"eu_equity":0,"bond":0,"commodity":0,"derivatives":0,"cash":0.1},"gamma":2.4,"strategyDescription":"국내 KOSPI 중소형주 상따/하따, 찌라시 맹신","tradingStyle":"MOMENTUM_CHASER","reactionSpeed":800,"riskTolerance":0.24}'::jsonb);
