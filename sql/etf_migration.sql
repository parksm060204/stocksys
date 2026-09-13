-- supabase/etf_migration.sql
-- 한국, 미국, 글로벌 주요 국가 ETF 종목 추가 마이그레이션

INSERT INTO public.stocks (ticker, name, market, sector, description, current_price, previous_close, open_price, volume, market_cap, is_listed)
VALUES
-- 1) 한국 (국내) ETF
('KODEX200', 'KODEX 200', 'etf', 'Index ETF', '코스피 200 지수 추종', 35000, 35000, 35000, 0, 5000000000000, true),
('KODEXLEV', 'KODEX 레버리지', 'etf', 'Leverage ETF', '코스피 200 지수 2배 추종', 17000, 17000, 17000, 0, 2000000000000, true),
('KODEXINV', 'KODEX 인버스', 'etf', 'Inverse ETF', '코스피 200 지수 역방향(-1배) 추종', 4500, 4500, 4500, 0, 1000000000000, true),
('KODEXINV2X', 'KODEX 200선물인버스2X', 'etf', 'Inverse ETF', '코스피 200 지수 -2배 추종 (곱버스)', 2500, 2500, 2500, 0, 1500000000000, true),
('TIGERK150L', 'TIGER 코스닥150 레버리지', 'etf', 'Leverage ETF', '코스닥 150 지수 2배 추종', 12000, 12000, 12000, 0, 800000000000, true),
('KODEXSEMI', 'KODEX 반도체', 'etf', 'Sector ETF', '국내 반도체 핵심 기업 추종', 32000, 32000, 32000, 0, 1200000000000, true),
('TIGERBAT', 'TIGER 2차전지테마', 'etf', 'Sector ETF', '2차전지 관련 밸류체인 기업 추종', 25000, 25000, 25000, 0, 1400000000000, true),

-- 2) 미국 ETF (지수 및 단일종목)
('SPY', 'SPDR S&P 500 ETF Trust', 'etf', 'Index ETF', 'S&P 500 지수 추종 (세계 최대 규모)', 500.00, 500.00, 500.00, 0, 600000000000000, true),
('VOO', 'Vanguard S&P 500 ETF', 'etf', 'Index ETF', 'S&P 500 지수 추종 (저비용 장기투자용)', 450.00, 450.00, 450.00, 0, 400000000000000, true),
('QQQ', 'Invesco QQQ Trust', 'etf', 'Index ETF', '나스닥 100 지수 추종 (빅테크 중심)', 430.00, 430.00, 430.00, 0, 300000000000000, true),
('TQQQ', 'ProShares UltraPro QQQ', 'etf', 'Leverage ETF', '나스닥 100 지수 3배 레버리지 추종', 60.00, 60.00, 60.00, 0, 30000000000000, true),
('SQQQ', 'ProShares UltraPro Short QQQ', 'etf', 'Inverse ETF', '나스닥 100 지수 -3배 인버스 추종', 12.00, 12.00, 12.00, 0, 15000000000000, true),
('TSLL', 'Direxion Daily TSLA Bull 2X', 'etf', 'Leverage ETF', '테슬라(TSLA) 주가 2배 롱', 10.00, 10.00, 10.00, 0, 2000000000000, true),
('TSLQ', 'Direxion Daily TSLA Bear 1X', 'etf', 'Inverse ETF', '테슬라(TSLA) 주가 1배 숏', 30.00, 30.00, 30.00, 0, 1000000000000, true),
('NVDL', 'GraniteShares 2x Long NVDA', 'etf', 'Leverage ETF', '엔비디아(NVDA) 주가 2배 롱', 45.00, 45.00, 45.00, 0, 5000000000000, true),
('NVD', 'GraniteShares 2x Short NVDA', 'etf', 'Inverse ETF', '엔비디아(NVDA) 주가 2배 숏', 2.50, 2.50, 2.50, 0, 100000000000, true),

-- 3) 글로벌 주요 국가 지수 ETF
('EWJ', 'iShares MSCI Japan ETF', 'etf', 'Country ETF', '일본 주식시장 지수 추종', 70.00, 70.00, 70.00, 0, 18000000000000, true),
('FXI', 'iShares China Large-Cap ETF', 'etf', 'Country ETF', '중국 대형주 지수 추종', 25.00, 25.00, 25.00, 0, 6000000000000, true),
('INDA', 'iShares MSCI India ETF', 'etf', 'Country ETF', '인도 주식시장 지수 추종', 55.00, 55.00, 55.00, 0, 8000000000000, true),
('EWG', 'iShares MSCI Germany ETF', 'etf', 'Country ETF', '독일 주식시장 지수 추종', 35.00, 35.00, 35.00, 0, 2500000000000, true),
('EWU', 'iShares MSCI United Kingdom', 'etf', 'Country ETF', '영국 주식시장 지수 추종', 33.00, 33.00, 33.00, 0, 4000000000000, true),
('EWZ', 'iShares MSCI Brazil ETF', 'etf', 'Country ETF', '브라질 주식시장 지수 추종', 32.00, 32.00, 32.00, 0, 6000000000000, true)
ON CONFLICT (ticker) DO NOTHING;
