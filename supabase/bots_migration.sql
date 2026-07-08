-- Create bots_config table
CREATE TABLE bots_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  bot_type TEXT NOT NULL,
  capital BIGINT NOT NULL,
  traits JSONB NOT NULL,
  real_world_target TEXT
);

-- Enable RLS (as per AGENTS.md Supabase policy)
ALTER TABLE bots_config ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE bots_config TO anon, authenticated;

-- Policies for bots_config
CREATE POLICY "Bots config is viewable by everyone"
ON bots_config FOR SELECT
USING (true);

-- Only authenticated users (admins) can modify bots_config
CREATE POLICY "Admin can modify bots_config"
ON bots_config FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

-- Insert initial real-world masked bots (Total 50 Institutions)
INSERT INTO bots_config (name, bot_type, capital, traits, real_world_target) VALUES
-- 1. 연기금 및 국부펀드 (Pension & Sovereign Wealth Funds) - 12개
('NPS (한국 국민연금)', 'PENSION_FUND', 250000000000000, '{"riskTolerance": 0.05, "tradingStyle": "LIMIT_HEAVY", "targetYTM": {"10Y_BOND": 0.035}, "rebalanceIntervalMs": 60000, "sectorTargets": {"FINANCE": 0.4, "MANUFACTURING": 0.4, "TECH": 0.2}}', 'US10Y'),
('CalPERS (미 캘리포니아 공무원 연금)', 'PENSION_FUND', 200000000000000, '{"riskTolerance": 0.04, "tradingStyle": "LIMIT_HEAVY", "targetYTM": {"10Y_BOND": 0.038}, "rebalanceIntervalMs": 60000, "sectorTargets": {"TECH": 0.3, "FINANCE": 0.3, "ENERGY": 0.4}}', 'US10Y'),
('GPIF (일본 연금적립금)', 'PENSION_FUND', 180000000000000, '{"riskTolerance": 0.03, "tradingStyle": "LIMIT_HEAVY", "targetYTM": {"10Y_BOND": 0.030}, "rebalanceIntervalMs": 60000, "sectorTargets": {"MANUFACTURING": 0.5, "FINANCE": 0.3, "CONSUMER": 0.2}}', 'US10Y'),
('NBIM (노르웨이 국부펀드)', 'PENSION_FUND', 300000000000000, '{"riskTolerance": 0.06, "tradingStyle": "LIMIT_HEAVY", "targetYTM": {"10Y_BOND": 0.032}, "rebalanceIntervalMs": 60000, "sectorTargets": {"ENERGY": 0.5, "TECH": 0.3, "FINANCE": 0.2}}', 'US10Y'),
('CPPIB (캐나다 연금)', 'PENSION_FUND', 150000000000000, '{"riskTolerance": 0.04, "tradingStyle": "LIMIT_HEAVY", "targetYTM": {"10Y_BOND": 0.034}, "rebalanceIntervalMs": 60000, "sectorTargets": {"FINANCE": 0.4, "ENERGY": 0.3, "CONSUMER": 0.3}}', 'US10Y'),
('APG (네덜란드 공무원 연금)', 'PENSION_FUND', 120000000000000, '{"riskTolerance": 0.04, "tradingStyle": "LIMIT_HEAVY", "targetYTM": {"10Y_BOND": 0.033}, "rebalanceIntervalMs": 60000, "sectorTargets": {"BIO": 0.3, "TECH": 0.3, "FINANCE": 0.4}}', 'US10Y'),
('GIC (싱가포르 국부펀드)', 'PENSION_FUND', 170000000000000, '{"riskTolerance": 0.05, "tradingStyle": "LIMIT_HEAVY", "targetYTM": {"10Y_BOND": 0.036}, "rebalanceIntervalMs": 60000, "sectorTargets": {"TECH": 0.4, "FINANCE": 0.4, "BIO": 0.2}}', 'US10Y'),
('Temasek (테마섹 홀딩스)', 'PENSION_FUND', 160000000000000, '{"riskTolerance": 0.05, "tradingStyle": "LIMIT_HEAVY", "targetYTM": {"10Y_BOND": 0.037}, "rebalanceIntervalMs": 60000, "sectorTargets": {"TECH": 0.5, "BIO": 0.3, "FINANCE": 0.2}}', 'US10Y'),
('KIC (한국투자공사)', 'PENSION_FUND', 90000000000000, '{"riskTolerance": 0.04, "tradingStyle": "LIMIT_HEAVY", "targetYTM": {"10Y_BOND": 0.035}, "rebalanceIntervalMs": 60000, "sectorTargets": {"FINANCE": 0.3, "TECH": 0.4, "MANUFACTURING": 0.3}}', 'US10Y'),
('NYSCRF (뉴욕주 퇴직연금)', 'PENSION_FUND', 110000000000000, '{"riskTolerance": 0.04, "tradingStyle": "LIMIT_HEAVY", "targetYTM": {"10Y_BOND": 0.034}, "rebalanceIntervalMs": 60000, "sectorTargets": {"FINANCE": 0.5, "TECH": 0.3, "CONSUMER": 0.2}}', 'US10Y'),
('Texas Teachers (텍사스 교원연금)', 'PENSION_FUND', 80000000000000, '{"riskTolerance": 0.03, "tradingStyle": "LIMIT_HEAVY", "targetYTM": {"10Y_BOND": 0.035}, "rebalanceIntervalMs": 60000, "sectorTargets": {"ENERGY": 0.4, "TECH": 0.3, "FINANCE": 0.3}}', 'US10Y'),
('Florida SBA (플로리다 연금)', 'PENSION_FUND', 75000000000000, '{"riskTolerance": 0.03, "tradingStyle": "LIMIT_HEAVY", "targetYTM": {"10Y_BOND": 0.036}, "rebalanceIntervalMs": 60000, "sectorTargets": {"CONSUMER": 0.4, "FINANCE": 0.4, "TECH": 0.2}}', 'US10Y'),

-- 2. 시중은행 및 글로벌 IB (Commercial Banks) - 13개 (은행은 채권 차익거래 위주이므로 섹터는 없음)
('J.P. Morgan (제이피모건)', 'COMMERCIAL_BANK', 80000000000000, '{"reactionSpeed": 800, "tradingStyle": "SWEEP_AGGRESSIVE", "targetSpread": {"1Y_BOND": 0.005}}', 'FEDFUNDS'),
('Citi Bank (씨티은행)', 'COMMERCIAL_BANK', 60000000000000, '{"reactionSpeed": 900, "tradingStyle": "SWEEP_AGGRESSIVE", "targetSpread": {"1Y_BOND": 0.004}}', 'FEDFUNDS'),
('Bank of America (BofA)', 'COMMERCIAL_BANK', 70000000000000, '{"reactionSpeed": 1000, "tradingStyle": "SWEEP_AGGRESSIVE", "targetSpread": {"1Y_BOND": 0.006}}', 'FEDFUNDS'),
('Wells Fargo (웰스파고)', 'COMMERCIAL_BANK', 50000000000000, '{"reactionSpeed": 1100, "tradingStyle": "SWEEP_AGGRESSIVE", "targetSpread": {"1Y_BOND": 0.005}}', 'FEDFUNDS'),
('Goldman Sachs Bank (골드만삭스)', 'COMMERCIAL_BANK', 90000000000000, '{"reactionSpeed": 600, "tradingStyle": "SWEEP_AGGRESSIVE", "targetSpread": {"1Y_BOND": 0.003}}', 'FEDFUNDS'),
('Morgan Stanley (모건스탠리)', 'COMMERCIAL_BANK', 85000000000000, '{"reactionSpeed": 700, "tradingStyle": "SWEEP_AGGRESSIVE", "targetSpread": {"1Y_BOND": 0.004}}', 'FEDFUNDS'),
('HSBC (에이치에스비씨)', 'COMMERCIAL_BANK', 75000000000000, '{"reactionSpeed": 950, "tradingStyle": "SWEEP_AGGRESSIVE", "targetSpread": {"1Y_BOND": 0.005}}', 'FEDFUNDS'),
('Barclays (바클레이즈)', 'COMMERCIAL_BANK', 60000000000000, '{"reactionSpeed": 850, "tradingStyle": "SWEEP_AGGRESSIVE", "targetSpread": {"1Y_BOND": 0.005}}', 'FEDFUNDS'),
('Deutsche Bank (도이치뱅크)', 'COMMERCIAL_BANK', 55000000000000, '{"reactionSpeed": 900, "tradingStyle": "SWEEP_AGGRESSIVE", "targetSpread": {"1Y_BOND": 0.006}}', 'FEDFUNDS'),
('BNP Paribas (BNP 파리바)', 'COMMERCIAL_BANK', 65000000000000, '{"reactionSpeed": 1000, "tradingStyle": "SWEEP_AGGRESSIVE", "targetSpread": {"1Y_BOND": 0.005}}', 'FEDFUNDS'),
('UBS (유비에스)', 'COMMERCIAL_BANK', 70000000000000, '{"reactionSpeed": 800, "tradingStyle": "SWEEP_AGGRESSIVE", "targetSpread": {"1Y_BOND": 0.004}}', 'FEDFUNDS'),
('Santander (산탄데르)', 'COMMERCIAL_BANK', 45000000000000, '{"reactionSpeed": 1100, "tradingStyle": "SWEEP_AGGRESSIVE", "targetSpread": {"1Y_BOND": 0.006}}', 'FEDFUNDS'),
('Standard Chartered (스탠다드차타드)', 'COMMERCIAL_BANK', 40000000000000, '{"reactionSpeed": 1050, "tradingStyle": "SWEEP_AGGRESSIVE", "targetSpread": {"1Y_BOND": 0.006}}', 'FEDFUNDS'),

-- 3. 헤지펀드 (Hedge Funds) - 13개
('Soros Fund Management (소로스 펀드)', 'HEDGE_FUND', 120000000000000, '{"reactionSpeed": 500, "tradingStyle": "SWEEP_AGGRESSIVE", "portfolioTarget": {"equity": 0.6, "safeBonds": 0.2, "highYield": 0.2}, "currentSentiment": "NEUTRAL", "sectorTargets": {"FINANCE": 0.4, "ENERGY": 0.3, "TECH": 0.3}}', 'VIX'),
('BlackRock (블랙록)', 'HEDGE_FUND', 300000000000000, '{"reactionSpeed": 400, "tradingStyle": "SWEEP_AGGRESSIVE", "portfolioTarget": {"equity": 0.5, "safeBonds": 0.4, "highYield": 0.1}, "currentSentiment": "NEUTRAL", "sectorTargets": {"TECH": 0.3, "FINANCE": 0.3, "CONSUMER": 0.2, "BIO": 0.2}}', 'VIX'),
('Bridgewater Associates (브릿지워터)', 'HEDGE_FUND', 150000000000000, '{"reactionSpeed": 600, "tradingStyle": "SWEEP_AGGRESSIVE", "portfolioTarget": {"equity": 0.4, "safeBonds": 0.5, "highYield": 0.1}, "currentSentiment": "NEUTRAL", "sectorTargets": {"FINANCE": 0.5, "MANUFACTURING": 0.3, "CONSUMER": 0.2}}', 'VIX'),
('Renaissance Technologies (르네상스)', 'HEDGE_FUND', 80000000000000, '{"reactionSpeed": 200, "tradingStyle": "SWEEP_AGGRESSIVE", "portfolioTarget": {"equity": 0.7, "safeBonds": 0.1, "highYield": 0.2}, "currentSentiment": "NEUTRAL", "sectorTargets": {"TECH": 0.6, "BIO": 0.3, "FINANCE": 0.1}}', 'VIX'),
('Elliott Management (엘리엇 매니지먼트)', 'HEDGE_FUND', 90000000000000, '{"reactionSpeed": 550, "tradingStyle": "SWEEP_AGGRESSIVE", "portfolioTarget": {"equity": 0.6, "safeBonds": 0.2, "highYield": 0.2}, "currentSentiment": "NEUTRAL", "sectorTargets": {"FINANCE": 0.4, "CONSUMER": 0.3, "ENERGY": 0.3}}', 'VIX'),
('Two Sigma (투 시그마)', 'HEDGE_FUND', 75000000000000, '{"reactionSpeed": 250, "tradingStyle": "SWEEP_AGGRESSIVE", "portfolioTarget": {"equity": 0.65, "safeBonds": 0.15, "highYield": 0.2}, "currentSentiment": "NEUTRAL", "sectorTargets": {"TECH": 0.5, "FINANCE": 0.3, "BIO": 0.2}}', 'VIX'),
('Millennium Management (밀레니엄)', 'HEDGE_FUND', 85000000000000, '{"reactionSpeed": 350, "tradingStyle": "SWEEP_AGGRESSIVE", "portfolioTarget": {"equity": 0.55, "safeBonds": 0.3, "highYield": 0.15}, "currentSentiment": "NEUTRAL", "sectorTargets": {"FINANCE": 0.4, "TECH": 0.3, "ENERGY": 0.3}}', 'VIX'),
('Point72 (포인트72)', 'HEDGE_FUND', 60000000000000, '{"reactionSpeed": 450, "tradingStyle": "SWEEP_AGGRESSIVE", "portfolioTarget": {"equity": 0.6, "safeBonds": 0.25, "highYield": 0.15}, "currentSentiment": "NEUTRAL", "sectorTargets": {"BIO": 0.4, "TECH": 0.4, "CONSUMER": 0.2}}', 'VIX'),
('AQR Capital (에이큐알)', 'HEDGE_FUND', 70000000000000, '{"reactionSpeed": 500, "tradingStyle": "SWEEP_AGGRESSIVE", "portfolioTarget": {"equity": 0.5, "safeBonds": 0.35, "highYield": 0.15}, "currentSentiment": "NEUTRAL", "sectorTargets": {"TECH": 0.4, "FINANCE": 0.4, "MANUFACTURING": 0.2}}', 'VIX'),
('Man Group (맨 그룹)', 'HEDGE_FUND', 55000000000000, '{"reactionSpeed": 650, "tradingStyle": "SWEEP_AGGRESSIVE", "portfolioTarget": {"equity": 0.45, "safeBonds": 0.4, "highYield": 0.15}, "currentSentiment": "NEUTRAL", "sectorTargets": {"FINANCE": 0.5, "ENERGY": 0.3, "CONSUMER": 0.2}}', 'VIX'),
('D.E. Shaw (디이쇼)', 'HEDGE_FUND', 80000000000000, '{"reactionSpeed": 300, "tradingStyle": "SWEEP_AGGRESSIVE", "portfolioTarget": {"equity": 0.6, "safeBonds": 0.2, "highYield": 0.2}, "currentSentiment": "NEUTRAL", "sectorTargets": {"TECH": 0.5, "BIO": 0.3, "FINANCE": 0.2}}', 'VIX'),
('Tiger Global (타이거 글로벌)', 'HEDGE_FUND', 65000000000000, '{"reactionSpeed": 550, "tradingStyle": "SWEEP_AGGRESSIVE", "portfolioTarget": {"equity": 0.7, "safeBonds": 0.1, "highYield": 0.2}, "currentSentiment": "NEUTRAL", "sectorTargets": {"TECH": 0.7, "CONSUMER": 0.3}}', 'VIX'),
('Pershing Square (퍼싱 스퀘어)', 'HEDGE_FUND', 50000000000000, '{"reactionSpeed": 700, "tradingStyle": "SWEEP_AGGRESSIVE", "portfolioTarget": {"equity": 0.65, "safeBonds": 0.2, "highYield": 0.15}, "currentSentiment": "NEUTRAL", "sectorTargets": {"CONSUMER": 0.6, "FINANCE": 0.4}}', 'VIX'),

-- 4. 프랍데스크 및 마켓메이커 (Prop Desk / Market Makers) - 12개
('Citadel Securities (시타델 시큐리티스)', 'PROP_DESK', 20000000000000, '{"reactionSpeed": 5, "tradingStyle": "MARKET_MAKER", "mmConfig": {"maxInventory": 100000, "targetSpreadHoga": 1, "tickProfitTarget": 1}}', 'VIX'),
('Jane Street (제인 스트리트)', 'PROP_DESK', 15000000000000, '{"reactionSpeed": 10, "tradingStyle": "MARKET_MAKER", "mmConfig": {"maxInventory": 80000, "targetSpreadHoga": 1, "tickProfitTarget": 1}}', 'VIX'),
('Goldman Sachs Prop (골드만 프랍)', 'PROP_DESK', 25000000000000, '{"reactionSpeed": 50, "tradingStyle": "MARKET_MAKER", "mmConfig": {"maxInventory": 50000, "targetSpreadHoga": 2, "tickProfitTarget": 2}}', 'VIX'),
('Optiver (옵티버)', 'PROP_DESK', 10000000000000, '{"reactionSpeed": 15, "tradingStyle": "MARKET_MAKER", "mmConfig": {"maxInventory": 60000, "targetSpreadHoga": 1, "tickProfitTarget": 1}}', 'VIX'),
('Susquehanna SIG (서스쿼해나)', 'PROP_DESK', 18000000000000, '{"reactionSpeed": 12, "tradingStyle": "MARKET_MAKER", "mmConfig": {"maxInventory": 90000, "targetSpreadHoga": 1, "tickProfitTarget": 1}}', 'VIX'),
('Flow Traders (플로우 트레이더스)', 'PROP_DESK', 8000000000000, '{"reactionSpeed": 18, "tradingStyle": "MARKET_MAKER", "mmConfig": {"maxInventory": 40000, "targetSpreadHoga": 1, "tickProfitTarget": 1}}', 'VIX'),
('DRW (디알더블유)', 'PROP_DESK', 12000000000000, '{"reactionSpeed": 25, "tradingStyle": "MARKET_MAKER", "mmConfig": {"maxInventory": 70000, "targetSpreadHoga": 2, "tickProfitTarget": 1}}', 'VIX'),
('Virtu Financial (버투 파이낸셜)', 'PROP_DESK', 14000000000000, '{"reactionSpeed": 8, "tradingStyle": "MARKET_MAKER", "mmConfig": {"maxInventory": 85000, "targetSpreadHoga": 1, "tickProfitTarget": 1}}', 'VIX'),
('Jump Trading (점프 트레이딩)', 'PROP_DESK', 16000000000000, '{"reactionSpeed": 6, "tradingStyle": "MARKET_MAKER", "mmConfig": {"maxInventory": 95000, "targetSpreadHoga": 1, "tickProfitTarget": 1}}', 'VIX'),
('Hudson River Trading (HRT)', 'PROP_DESK', 11000000000000, '{"reactionSpeed": 9, "tradingStyle": "MARKET_MAKER", "mmConfig": {"maxInventory": 75000, "targetSpreadHoga": 1, "tickProfitTarget": 1}}', 'VIX'),
('IMC (아이엠씨)', 'PROP_DESK', 9000000000000, '{"reactionSpeed": 22, "tradingStyle": "MARKET_MAKER", "mmConfig": {"maxInventory": 55000, "targetSpreadHoga": 2, "tickProfitTarget": 1}}', 'VIX'),
('Tower Research (타워 리서치)', 'PROP_DESK', 10000000000000, '{"reactionSpeed": 11, "tradingStyle": "MARKET_MAKER", "mmConfig": {"maxInventory": 65000, "targetSpreadHoga": 1, "tickProfitTarget": 1}}', 'VIX'),

-- 5. 개미 군단 (Retail Swarms) - 4개 (광기, 패닉 매매 위주)
('WallStreetBets (WSB 군단)', 'RETAIL_SWARM', 5000000000000, '{"fomoThreshold": 0.05, "panicThreshold": -0.05, "tradingStyle": "MOMENTUM_CHASER"}', 'NONE'),
('디시 주식갤러리 (야수의 심장)', 'RETAIL_SWARM', 3000000000000, '{"fomoThreshold": 0.07, "panicThreshold": -0.07, "tradingStyle": "MOMENTUM_CHASER"}', 'NONE'),
('동학개미운동 (국내 투심)', 'RETAIL_SWARM', 8000000000000, '{"fomoThreshold": 0.03, "panicThreshold": -0.10, "tradingStyle": "VALUE_DIP_BUYER"}', 'NONE'),
('서학개미 (미장 투심)', 'RETAIL_SWARM', 6000000000000, '{"fomoThreshold": 0.04, "panicThreshold": -0.08, "tradingStyle": "MOMENTUM_CHASER"}', 'NONE');

