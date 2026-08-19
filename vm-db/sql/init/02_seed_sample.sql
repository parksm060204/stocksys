-- =====================================================================
-- 무명 거래소 — VM DB 시드 (기본 운영용 시드 데이터)
-- =====================================================================

-- 1. admin_settings 단일 행
INSERT INTO public.admin_settings (id, base_rate, market_sentiment)
VALUES (1, 0.025, 'NEUTRAL')
ON CONFLICT (id) DO NOTHING;

-- 2. 환율
INSERT INTO public.exchange_rates (currency_code, currency_name, rate_to_krw, updated_at) VALUES
  ('KRW', '대한민국 원', 1.0, now()),
  ('USD', '미국 달러', 1380.0, now()),
  ('EUR', '유로', 1500.0, now()),
  ('JPY', '일본 엔', 9.2, now()),
  ('CNY', '위안', 190.0, now()),
  ('GBP', '영국 파운드', 1750.0, now())
ON CONFLICT (currency_code) DO NOTHING;

-- 3. 원자재
INSERT INTO public.commodities (commodity_id, name, category, unit, tick_size, current_price, previous_close, volume) VALUES
  ('WTI_CRUDE',   'WTI 원유',     'energy', 'USD', 0.01, 78.50, 78.20, 0),
  ('BRENT_CRUDE', '브렌트 원유',   'energy', 'USD', 0.01, 82.30, 82.00, 0),
  ('GOLD',        '금',           'metal',  'USD', 0.10, 2050.00, 2045.00, 0),
  ('SILVER',      '은',           'metal',  'USD', 0.01, 24.30, 24.20, 0),
  ('COPPER',      '구리',          'metal',  'USD', 0.01, 3.85, 3.83, 0)
ON CONFLICT (commodity_id) DO NOTHING;

-- 4. 채권
INSERT INTO public.bonds (ticker, name, country, bond_type, maturity, coupon_rate, face_value, current_price, previous_close, ytm, duration, volume) VALUES
  ('KR_GVT_2Y',  '한국 국고채 2년',  'KR', 'govt',    '2Y',  0.0325, 10000, 99.80,  99.85,  0.0335, 1.92, 0),
  ('KR_GVT_5Y',  '한국 국고채 5년',  'KR', 'govt',    '5Y',  0.0350, 10000, 98.50,  98.60,  0.0375, 4.55, 0),
  ('KR_GVT_10Y', '한국 국고채 10년', 'KR', 'govt',    '10Y', 0.0375, 10000, 97.20,  97.40,  0.0405, 8.40, 0),
  ('US_GVT_2Y',  '미국 국고채 2년',  'US', 'govt',    '2Y',  0.0475, 10000, 99.50,  99.55,  0.0480, 1.94, 0),
  ('US_GVT_10Y', '미국 국고채 10년', 'US', 'govt',    '10Y', 0.0425, 10000, 97.80,  97.90,  0.0435, 8.25, 0),
  ('KR_CORP_IG', '한국 우량 회사채', 'KR', 'corp_ig', '3Y',  0.0410, 10000, 98.80,  98.85,  0.0435, 2.78, 0),
  ('KR_CORP_HY', '한국 투기 회사채', 'KR', 'corp_hy', '3Y',  0.0725, 10000, 95.20,  95.10,  0.0785, 2.62, 0)
ON CONFLICT (ticker) DO NOTHING;

-- 5. 주식: 국내 / 미국 / 유럽
INSERT INTO public.stocks (ticker, name, market, sector, current_price, previous_close, market_cap, is_core) VALUES
  ('0010', '오성전자',    'domestic', '반도체',   72000,  71500,  400000000000000, true),
  ('0015', '미래자동차',  'domestic', '자동차',   210000, 209000, 95000000000000,  true),
  ('0020', '에코에너지',  'domestic', '에너지',   45000,  44800,  22000000000000,  false),
  ('0025', 'NVC',         'domestic', 'IT',       185000, 184500, 60000000000000,  false),
  ('0030', 'KKA',         'domestic', '통신',     52000,  51800,  30000000000000,  false)
ON CONFLICT (ticker) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO public.stocks (ticker, name, market, sector, current_price, previous_close, market_cap, is_core) VALUES
  ('AAPL', '파인애플',      'overseas', 'IT',         185.50, 185.20, 2900000000000, true),
  ('MSFT', '매크로소프트',   'overseas', '소프트웨어',  425.30, 424.00, 3150000000000, true),
  ('NVDA', '엔비디아스',     'overseas', '반도체',    875.20, 870.50, 2100000000000, true),
  ('TSLA', '와트 모빌리티',  'overseas', '자동차',     248.50, 247.80, 790000000000,  false),
  ('GOOGL','구골',          'overseas', 'IT',         141.20, 140.90, 1750000000000, false)
ON CONFLICT (ticker) DO UPDATE SET name = EXCLUDED.name;

INSERT INTO public.stocks (ticker, name, market, sector, current_price, previous_close, market_cap, is_core) VALUES
  ('ASML',  'ADML',         'europe', '반도체',  705.40, 703.20, 280000000000, true),
  ('SAP',   'SAP 넥스트',  'europe', '소프트웨어', 175.30, 174.80, 210000000000, false)
ON CONFLICT (ticker) DO UPDATE SET name = EXCLUDED.name;

-- 6. ETF 종목
INSERT INTO public.stocks (ticker, name, market, sector, description, current_price, previous_close, open_price, volume, market_cap, is_listed) VALUES
  ('KODEX200', 'KODEX 200', 'etf', 'Index ETF', '코스피 200 지수 추종', 35000, 35000, 35000, 0, 5000000000000, true),
  ('KODEXLEV', 'KODEX 레버리지', 'etf', 'Leverage ETF', '코스피 200 지수 2배 추종', 17000, 17000, 17000, 0, 2000000000000, true),
  ('KODEXINV', 'KODEX 인버스', 'etf', 'Inverse ETF', '코스피 200 지수 역방향(-1배) 추종', 4500, 4500, 4500, 0, 1000000000000, true),
  ('SPY', 'SPDR S&P 500 ETF Trust', 'etf', 'Index ETF', 'S&P 500 지수 추종', 500.00, 500.00, 500.00, 0, 600000000000000, true),
  ('QQQ', 'Invesco QQQ Trust', 'etf', 'Index ETF', '나스닥 100 지수 추종', 430.00, 430.00, 430.00, 0, 300000000000000, true),
  ('TQQQ', 'ProShares UltraPro QQQ', 'etf', 'Leverage ETF', '나스닥 100 지수 3배 레버리지', 60.00, 60.00, 60.00, 0, 30000000000000, true)
ON CONFLICT (ticker) DO UPDATE SET name = EXCLUDED.name;

-- 7. 시장 지수
INSERT INTO public.market_indices (code, name, current_value, previous_close) VALUES
  ('KOSPI',       'KOSPI',        2550.30, 2545.00),
  ('SP50',        'S&P 50',       5200.50, 5188.20),
  ('EUROSTOXX50', '유로스톡스 50', 4850.20, 4842.10)
ON CONFLICT (code) DO NOTHING;

-- 8. 관리자 계정 (auth.users)
INSERT INTO auth.users (id, email, full_name)
SELECT '11111111-1111-1111-1111-111111111111', 'admin@moo.local', '관리자'
WHERE NOT EXISTS (SELECT 1 FROM auth.users WHERE email = 'admin@moo.local');

UPDATE public.profiles SET is_admin = true, cash = 10000000000000
WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@moo.local');

-- 9. 마스터 기관 봇 (50개 기관 봇)
INSERT INTO public.bots_config (name, bot_type, capital, traits, real_world_target) VALUES
  ('NPS (한국 국민연금)', 'PENSION_FUND', 250000000000000, '{"riskTolerance": 0.05, "tradingStyle": "LIMIT_HEAVY", "targetYTM": {"10Y_BOND": 0.035}, "rebalanceIntervalMs": 60000, "sectorTargets": {"FINANCE": 0.4, "MANUFACTURING": 0.4, "TECH": 0.2}}', 'US10Y'),
  ('CalPERS (미 캘리포니아 공무원 연금)', 'PENSION_FUND', 200000000000000, '{"riskTolerance": 0.04, "tradingStyle": "LIMIT_HEAVY", "targetYTM": {"10Y_BOND": 0.038}, "rebalanceIntervalMs": 60000, "sectorTargets": {"TECH": 0.3, "FINANCE": 0.3, "ENERGY": 0.4}}', 'US10Y'),
  ('GPIF (일본 연금적립금)', 'PENSION_FUND', 180000000000000, '{"riskTolerance": 0.03, "tradingStyle": "LIMIT_HEAVY", "targetYTM": {"10Y_BOND": 0.030}, "rebalanceIntervalMs": 60000, "sectorTargets": {"MANUFACTURING": 0.5, "FINANCE": 0.3, "CONSUMER": 0.2}}', 'US10Y'),
  ('NBIM (노르웨이 국부펀드)', 'PENSION_FUND', 300000000000000, '{"riskTolerance": 0.06, "tradingStyle": "LIMIT_HEAVY", "targetYTM": {"10Y_BOND": 0.032}, "rebalanceIntervalMs": 60000, "sectorTargets": {"ENERGY": 0.5, "TECH": 0.3, "FINANCE": 0.2}}', 'US10Y'),
  ('J.P. Morgan (제이피모건)', 'COMMERCIAL_BANK', 80000000000000, '{"reactionSpeed": 800, "tradingStyle": "SWEEP_AGGRESSIVE", "targetSpread": {"1Y_BOND": 0.005}}', 'FEDFUNDS'),
  ('Citi Bank (씨티은행)', 'COMMERCIAL_BANK', 60000000000000, '{"reactionSpeed": 900, "tradingStyle": "SWEEP_AGGRESSIVE", "targetSpread": {"1Y_BOND": 0.004}}', 'FEDFUNDS'),
  ('Goldman Sachs Bank (골드만삭스)', 'COMMERCIAL_BANK', 90000000000000, '{"reactionSpeed": 600, "tradingStyle": "SWEEP_AGGRESSIVE", "targetSpread": {"1Y_BOND": 0.003}}', 'FEDFUNDS'),
  ('Soros Fund Management (소로스 펀드)', 'HEDGE_FUND', 120000000000000, '{"reactionSpeed": 500, "tradingStyle": "SWEEP_AGGRESSIVE", "portfolioTarget": {"equity": 0.6, "safeBonds": 0.2, "highYield": 0.2}, "currentSentiment": "NEUTRAL", "sectorTargets": {"FINANCE": 0.4, "ENERGY": 0.3, "TECH": 0.3}}', 'VIX'),
  ('BlackRock (블랙록)', 'HEDGE_FUND', 300000000000000, '{"reactionSpeed": 400, "tradingStyle": "SWEEP_AGGRESSIVE", "portfolioTarget": {"equity": 0.5, "safeBonds": 0.4, "highYield": 0.1}, "currentSentiment": "NEUTRAL", "sectorTargets": {"TECH": 0.3, "FINANCE": 0.3, "CONSUMER": 0.2, "BIO": 0.2}}', 'VIX'),
  ('Bridgewater Associates (브릿지워터)', 'HEDGE_FUND', 150000000000000, '{"reactionSpeed": 600, "tradingStyle": "SWEEP_AGGRESSIVE", "portfolioTarget": {"equity": 0.4, "safeBonds": 0.5, "highYield": 0.1}, "currentSentiment": "NEUTRAL", "sectorTargets": {"FINANCE": 0.5, "MANUFACTURING": 0.3, "CONSUMER": 0.2}}', 'VIX'),
  ('Citadel Securities (시타델 시큐리티스)', 'PROP_DESK', 20000000000000, '{"reactionSpeed": 5, "tradingStyle": "MARKET_MAKER", "mmConfig": {"maxInventory": 100000, "targetSpreadHoga": 1, "tickProfitTarget": 1}}', 'VIX'),
  ('Jane Street (제인 스트리트)', 'PROP_DESK', 15000000000000, '{"reactionSpeed": 10, "tradingStyle": "MARKET_MAKER", "mmConfig": {"maxInventory": 80000, "targetSpreadHoga": 1, "tickProfitTarget": 1}}', 'VIX'),
  ('WallStreetBets (WSB 군단)', 'RETAIL_SWARM', 5000000000000, '{"fomoThreshold": 0.05, "panicThreshold": -0.05, "tradingStyle": "MOMENTUM_CHASER"}', 'NONE'),
  ('동학개미운동 (국내 투심)', 'RETAIL_SWARM', 8000000000000, '{"fomoThreshold": 0.03, "panicThreshold": -0.10, "tradingStyle": "VALUE_DIP_BUYER"}', 'NONE')
ON CONFLICT DO NOTHING;

-- 10. 옵션 계약 시드
INSERT INTO public.options_contracts (underlying_stock_id, ticker, asset_class, underlying_symbol, type, option_type, strike_price, current_price, expiry_date, open_interest, implied_volatility)
SELECT s.id, 'STK-NVDA-2608-C900', 'STK', 'NVDA', 'CALL', 'CALL', 900.00, 15.50, NOW() + INTERVAL '30 days', 1000, 0.35
FROM public.stocks s WHERE s.ticker = 'NVDA'
ON CONFLICT DO NOTHING;

DO $$ BEGIN RAISE NOTICE '시드 02 완료'; END $$;