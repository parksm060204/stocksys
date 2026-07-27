const fs = require('fs');
const path = require('path');

const tsvData = `Category	Bot Name	Capital	KR Stock	US Stock	EU Stock	Bond	Commodity	Deriv	Cash	Gamma	Description
Pension & SWF	NPS (한국 국민연금)	1,200	15.0%	35.0%	5.0%	40.0%	0.0%	0.0%	5.0%	0.5	국내주식 하방 방어, 글로벌 장기채권 매집
Pension & SWF	CalPERS (미 캘리포니아 공무원 연금)	650	1.0%	45.0%	14.0%	35.0%	2.0%	0.0%	3.0%	0.6	미국 중심 글로벌 주식/채권 배분
Pension & SWF	GPIF (일본 연금적립금)	2,000	1.0%	45.0%	4.0%	45.0%	0.0%	0.0%	5.0%	0.5	초안전자산 및 선진국 주식 패시브 추종
Pension & SWF	NBIM (노르웨이 국부펀드)	2,200	1.0%	45.0%	20.0%	30.0%	0.0%	0.0%	4.0%	0.6	유럽/미국 중심 글로벌 패시브 흐름 주도
Pension & SWF	CPPIB (캐나다 연금)	600	1.0%	40.0%	9.0%	30.0%	10.0%	0.0%	10.0%	0.7	대체투자 및 원자재(에너지) 비중 높음
Pension & SWF	APG (네덜란드 공무원 연금)	850	1.0%	35.0%	25.0%	35.0%	0.0%	0.0%	4.0%	0.5	유로스톡스 주식 비중 상대적 과체중
Pension & SWF	GIC (싱가포르 국부펀드)	1,000	5.0%	35.0%	10.0%	40.0%	5.0%	0.0%	5.0%	0.6	아시아 신흥국 및 선진국 정밀 분산
Pension & SWF	Temasek (테마섹 홀딩스)	400	5.0%	40.0%	10.0%	20.0%	5.0%	0.0%	20.0%	0.8	공격적 에퀴티 투자 및 현금(Cash) 대기
Pension & SWF	KIC (한국투자공사)	250	0.0%	50.0%	15.0%	30.0%	0.0%	0.0%	5.0%	0.6	100% 해외자산 투자 (국내 편입 배제)
Pension & SWF	NYSCRF (뉴욕주 퇴직연금)	350	0.0%	50.0%	10.0%	35.0%	0.0%	0.0%	5.0%	0.5	보수적 자산 배분 (S&P 50 추종)
Pension & SWF	Texas Teachers (텍사스 교원연금)	260	0.0%	45.0%	10.0%	35.0%	5.0%	0.0%	5.0%	0.6	원자재 및 에너지 섹터 선호
Pension & SWF	Florida SBA (플로리다 연금)	240	0.0%	45.0%	10.0%	40.0%	0.0%	0.0%	5.0%	0.5	미국 대형주와 우량 채권 중심의 방어전
Global IBs	J.P. Morgan (제이피모건)	400	1.0%	20.0%	9.0%	50.0%	5.0%	10.0%	5.0%	1.0	금리 민감, 강력한 채권 차익 및 매크로 트레이딩
Global IBs	Citi Bank (씨티은행)	300	1.0%	15.0%	9.0%	55.0%	5.0%	10.0%	5.0%	0.9	신흥국 통화 및 글로벌 금리 갭 차익
Global IBs	Bank of America (BofA)	350	1.0%	25.0%	4.0%	50.0%	0.0%	10.0%	10.0%	0.9	미국 내수 중심 주식 및 픽스드인컴
Global IBs	Wells Fargo (웰스파고)	250	0.0%	30.0%	0.0%	55.0%	0.0%	5.0%	10.0%	0.8	보수적인 국채 및 회사채 포트폴리오
Global IBs	Goldman Sachs Bank	350	2.0%	25.0%	10.0%	30.0%	10.0%	15.0%	8.0%	1.5	원자재 및 파생상품 선도, 고위험 감수
Global IBs	Morgan Stanley (모건스탠리)	320	2.0%	30.0%	10.0%	30.0%	5.0%	15.0%	8.0%	1.4	에퀴티 언더라이팅 및 콜/풋 옵션 월 형성
Global IBs	HSBC (에이치에스비씨)	280	5.0%	10.0%	20.0%	50.0%	5.0%	5.0%	5.0%	0.9	아시아/유럽 크로스보더 자금 흐름 주도
Global IBs	Barclays (바클레이즈)	220	1.0%	15.0%	25.0%	40.0%	4.0%	10.0%	5.0%	1.1	유로스톡스 50 및 영국 금리 차익
Global IBs	Deutsche Bank (도이치뱅크)	200	0.0%	10.0%	30.0%	40.0%	0.0%	15.0%	5.0%	1.2	유럽 매크로 헷징 및 파생상품 딜링
Global IBs	BNP Paribas (BNP 파리바)	240	0.0%	10.0%	30.0%	45.0%	0.0%	10.0%	5.0%	1.0	안정적인 유로존 국채 및 옵션 헷징
Global IBs	UBS (유비에스)	260	2.0%	20.0%	25.0%	35.0%	3.0%	10.0%	5.0%	1.1	안정적 분산 자산관리 (WM 중심)
Global IBs	Santander (산탄데르)	180	0.0%	5.0%	35.0%	50.0%	0.0%	5.0%	5.0%	0.9	남유럽 국채 및 유로스톡스 편향
Global IBs	Standard Chartered	150	5.0%	5.0%	15.0%	60.0%	5.0%	5.0%	5.0%	0.9	신흥국 채권(한국 포함) 차익 위주
Hedge Funds & AMCs	Soros Fund Management	40	5.0%	30.0%	15.0%	10.0%	10.0%	20.0%	10.0%	2.8	매크로 취약점 공격 (가짜 뉴스 투매/폭등 스윕)
Hedge Funds & AMCs	BlackRock (블랙록)	13,000	2.0%	48.0%	15.0%	30.0%	2.0%	1.0%	2.0%	1.0	시장 그 자체. 전 세계 지수 패시브 복제 (ALADDIN)
Hedge Funds & AMCs	Vanguard (뱅가드)	10,000	2.0%	50.0%	13.0%	32.0%	1.0%	0.0%	2.0%	0.9	저비용 인덱스 펀드, 시장 충격 없이 매집(TWAP)
Hedge Funds & AMCs	Renaissance Technologies	160	5.0%	40.0%	10.0%	0.0%	5.0%	30.0%	10.0%	2.5	스프레드 차익거래, 펀더멘털 방향성 없음
Hedge Funds & AMCs	Bridgewater Associates	200	2.0%	28.0%	10.0%	40.0%	15.0%	0.0%	5.0%	1.2	사계절 포트폴리오 (인플레이션 시 원자재 스윕)
Hedge Funds & AMCs	Citadel (시타델)	80	5.0%	35.0%	10.0%	5.0%	5.0%	35.0%	5.0%	2.2	옵션 델타 헤징 및 감마 스퀴즈 유발
Hedge Funds & AMCs	Two Sigma (투시그마)	85	4.0%	40.0%	10.0%	10.0%	5.0%	25.0%	6.0%	2.0	빅데이터 기반 단기 모멘텀 트레이딩
Hedge Funds & AMCs	D.E. Shaw (DE 쇼)	80	3.0%	35.0%	12.0%	15.0%	5.0%	20.0%	10.0%	1.9	퀀트 및 하이브리드 이벤트 드리븐
Hedge Funds & AMCs	Elliott Management	70	10.0%	40.0%	10.0%	10.0%	0.0%	10.0%	20.0%	2.4	이벤트 드리븐 (특정 주식 집중 매수 후 펌핑)
Hedge Funds & AMCs	Point72 (포인트72)	40	5.0%	50.0%	10.0%	5.0%	5.0%	15.0%	10.0%	2.1	롱/숏 에퀴티. 고도로 정밀한 실적 플레이
Hedge Funds & AMCs	Millennium Management	80	4.0%	40.0%	15.0%	10.0%	6.0%	15.0%	10.0%	1.8	다중 매니저, 짧은 주기 차익 실현
Hedge Funds & AMCs	AQR Capital	130	3.0%	35.0%	15.0%	20.0%	7.0%	10.0%	10.0%	1.5	팩터 기반(가치, 모멘텀) 분산 투자
Hedge Funds & AMCs	Baupost Group	40	2.0%	30.0%	8.0%	10.0%	0.0%	10.0%	40.0%	1.2	초안전 마진(현금 40% 대기) 폭락장 투매 줍기
Prop Desks & HFT	Jane Street (제인스트리트)	30	5.0%	25.0%	10.0%	0.0%	0.0%	45.0%	15.0%	2.5	ETF-현물 간 차익거래 및 파생상품 마켓메이킹
Prop Desks & HFT	Optiver (옵티버)	20	2.0%	20.0%	20.0%	0.0%	0.0%	45.0%	13.0%	2.4	유럽/미국 옵션 스프레드 집중 유동성 공급
Prop Desks & HFT	Jump Trading (점프 트레이딩)	15	5.0%	35.0%	5.0%	0.0%	5.0%	30.0%	20.0%	2.8	선물/현물 마이크로초 단위 스캘핑
Prop Desks & HFT	Susquehanna (SIG)	25	2.0%	30.0%	8.0%	0.0%	0.0%	50.0%	10.0%	2.3	미국 옵션 호가창 전역 촘촘한 빙산 주문(Iceberg)
Prop Desks & HFT	DRW (디알더블유)	15	0.0%	20.0%	10.0%	15.0%	15.0%	25.0%	15.0%	2.2	실물/원자재 연계 파생상품 차익
Prop Desks & HFT	Hudson River Trading (HRT)	10	4.0%	40.0%	16.0%	0.0%	0.0%	25.0%	15.0%	2.6	AI 기반 전 자산군 오더플로우 선행매매(Front-running)
Retail Swarms	Reddit WallStreetBets	15	0.0%	70.0%	0.0%	0.0%	0.0%	25.0%	5.0%	3.0	미국 밈주식 영끌 펌핑 및 OTM 콜옵션 몰빵
Retail Swarms	Robinhood Retail Army	10	0.0%	85.0%	0.0%	0.0%	0.0%	10.0%	5.0%	2.7	미국 S&P 50 대형주 맹목적 추종 및 패닉셀
Retail Swarms	Naver Finance Board (종토방)	5	85.0%	5.0%	0.0%	0.0%	0.0%	0.0%	10.0%	2.5	국내주식 가십 반응, 테마/세력주 묻지마 추격
Retail Swarms	DC Inside Stock Gallery	3	50.0%	40.0%	0.0%	0.0%	0.0%	5.0%	5.0%	2.9	국내/미국 레버리지 ETF 및 야수의 심장 베팅
Retail Swarms	Telegram Crypto/Stock Signals	2	60.0%	20.0%	0.0%	0.0%	0.0%	10.0%	10.0%	3.0	작전 세력 펌핑(마크업)에 동원되는 불나방
Retail Swarms	Kakao Open Chat Rooms	2	90.0%	0.0%	0.0%	0.0%	0.0%	0.0%	10.0%	2.4	국내 KOSPI 중소형주 상따/하따, 찌라시 맹신`;

function parsePercent(str) {
  return parseFloat(str.replace('%', '')) / 100;
}

function parseCapital(str) {
  // e.g. "1,200", "13,000" (조 원)
  // 1조 = 1,000,000,000,000
  const num = parseInt(str.replace(/,/g, ''), 10);
  // Using BigInt literal
  return num + "000000000000";
}

function getBotType(category) {
  if (category.includes('Pension')) return 'PENSION_FUND';
  if (category.includes('Global IBs')) return 'COMMERCIAL_BANK';
  if (category.includes('Hedge Funds')) return 'HEDGE_FUND';
  if (category.includes('Prop Desks')) return 'PROP_DESK';
  if (category.includes('Retail')) return 'RETAIL_SWARM';
  return 'HEDGE_FUND';
}

function getTradingStyle(category) {
  if (category.includes('Pension')) return 'LIMIT_HEAVY';
  if (category.includes('Global IBs')) return 'SWEEP_AGGRESSIVE';
  if (category.includes('Hedge Funds')) return 'SWEEP_AGGRESSIVE';
  if (category.includes('Prop Desks')) return 'MARKET_MAKER';
  if (category.includes('Retail')) return 'MOMENTUM_CHASER';
  return 'SWEEP_AGGRESSIVE';
}

const lines = tsvData.trim().split('\n');
const headers = lines[0];
const rows = lines.slice(1);

let sql = `-- supabase/bot_allocations_migration.sql
-- Run this migration to completely replace bots_config with the new specific allocations.

TRUNCATE TABLE public.bots_config;

INSERT INTO public.bots_config (name, bot_type, capital, traits) VALUES
`;

const values = rows.map(row => {
  const cols = row.split('\t');
  const cat = cols[0];
  const name = cols[1];
  const cap = parseCapital(cols[2]);
  
  const traits = {
    targetAllocation: {
      kr_equity: parsePercent(cols[3]),
      us_equity: parsePercent(cols[4]),
      eu_equity: parsePercent(cols[5]),
      bond: parsePercent(cols[6]),
      commodity: parsePercent(cols[7]),
      derivatives: parsePercent(cols[8]),
      cash: parsePercent(cols[9])
    },
    gamma: parseFloat(cols[10]),
    strategyDescription: cols[11],
    tradingStyle: getTradingStyle(cat),
    reactionSpeed: cat.includes('Prop') ? 200 : cat.includes('Hedge') ? 500 : 800,
    riskTolerance: parseFloat(cols[10]) * 0.1
  };
  
  // stringify JSON carefully to escape quotes for SQL
  const traitsJson = JSON.stringify(traits).replace(/'/g, "''");
  
  return `('${name}', '${getBotType(cat)}', ${cap}, '${traitsJson}'::jsonb)`;
});

sql += values.join(',\n') + ';\n';

fs.writeFileSync(path.join(__dirname, 'supabase/bot_allocations_migration.sql'), sql, 'utf8');
console.log('Migration generated successfully.');
