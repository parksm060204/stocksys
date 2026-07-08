import { LP_CONFIG, TRILLION, classifyCap } from "./lp/config";
import type { StockMeta } from "./lp/types";
import type { Stock, FinancialStatement, Financials } from "@/lib/types";
import { calcYTM } from "./bond-utils";
import type { BondMeta } from "./bond-utils";

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface CoreStockDef {
  id: string;
  ticker: string;
  name: string;
  sector: string;
  description: string;
  marketCap: number;
  initialPrice: number;
}

// --- 국내 핵심 5종목 (스토리텔링) ---
const DOMESTIC_CORE: CoreStockDef[] = [
  {
    id: "d-core-1",
    ticker: "NOVA",
    name: "노바 에너지",
    sector: "에너지",
    description: "소설 세계관의 대장주. 차세대 원자력·수소 기술을 독점하며 에너지 패권을 쥔 거대 기업.",
    marketCap: 160 * TRILLION,
    initialPrice: 312_000,
  },
  {
    id: "d-core-2",
    ticker: "HELIOS",
    name: "헬리오스 반도체",
    sector: "반도체",
    description: "AI 반도체 설계의 핵심. 소설 주인공이 지분을 보유한 성장주.",
    marketCap: 240 * TRILLION,
    initialPrice: 184_500,
  },
  {
    id: "d-core-3",
    ticker: "AEGIS",
    name: "이지스 방산",
    sector: "방산",
    description: "메인 빌런이 지배하는 방산 기업. 전쟁 서사마다 폭등하는 혼의 주식.",
    marketCap: 80 * TRILLION,
    initialPrice: 96_700,
  },
  {
    id: "d-core-4",
    ticker: "GAIA",
    name: "가이아 바이오",
    sector: "바이오",
    description: "난치병 치료제 개발. 서사 전개에 따라 운명이 갈리는 테마주.",
    marketCap: 140 * TRILLION,
    initialPrice: 58_300,
  },
  {
    id: "d-core-5",
    ticker: "PRIMA",
    name: "프리마 금융",
    sector: "금융",
    description: "가상 증시의 흐름을 잡는 대형 은행 지주. 시장 안정阀.",
    marketCap: 70 * TRILLION,
    initialPrice: 71_200,
  },
];

// --- 미국 핵심 5종목 ---
const OVERSEAS_CORE: CoreStockDef[] = [
  {
    id: "o-core-1",
    ticker: "NVT",
    name: "NovaTech",
    sector: "Technology",
    description: "글로벌 AI 플랫폼 거대 기업. 소설 세계관의 미국 대장주.",
    marketCap: 5000 * TRILLION,
    initialPrice: 480.5,
  },
  {
    id: "o-core-2",
    ticker: "HLX",
    name: "Helix Corp",
    sector: "Biotech",
    description: "글로벌 바이오 혁신 기업. 유전자 치료 기술 선도.",
    marketCap: 4000 * TRILLION,
    initialPrice: 320.2,
  },
  {
    id: "o-core-3",
    ticker: "AETH",
    name: "Aether Dynamics",
    sector: "Energy",
    description: "청정에너지·수소 기술 글로벌 리더.",
    marketCap: 3500 * TRILLION,
    initialPrice: 245.8,
  },
  {
    id: "o-core-4",
    ticker: "QTL",
    name: "Quantum Line",
    sector: "Technology",
    description: "양자컴퓨팅 상용화 선도 기업.",
    marketCap: 3000 * TRILLION,
    initialPrice: 190.4,
  },
  {
    id: "o-core-5",
    ticker: "ORB",
    name: "Orbital Net",
    sector: "Technology",
    description: "위성 통신 네트워크 글로벌 인프라 기업.",
    marketCap: 2500 * TRILLION,
    initialPrice: 165.7,
  },
];

const DOMESTIC_SECTORS = [
  "IT", "반도체", "에너지", "금융", "바이오", "방산", "소비재", "화학", "철강", "통신",
];

const DOMESTIC_PREFIX = ["오성", "미래", "선광", "LD", "포스트", "신화", "로제", "지엑스", "한산", "씨와이", "신세상", "메모레", "한길", "은호", "혜성", "NVC", "참진", "백호", "우성", "케이티오", "KKA"];
const DOMESTIC_SUFFIX = [
  "전자", "모빌리티", "화학", "메디컬", "중공업", "스틸", "에너지", "건설", "생명", "증권", "쇼핑", "네트웍스", "푸드", "항공",
];

const OVERSEAS_NAMES = [
  "Macrosoft Corp", "Pineapple Tech", "Googol Alphanet", "Amason Retail", "NVISION Corp",
  "Telsa Motors", "Beta Platforms", "Berkshire Pathway", "JPMorgan Trust", "Lily Pharma",
  "Broadchip Inc", "HexonMobil", "Johnsen & Johnsen", "Viza International", "Valmart Stores",
  "Shevron Gas", "Procter & Global", "MasterPay Group", "PopCo Drinks", "Coda-Cola Corp",
];

const OVERSEAS_SECTORS = [
  "Technology", "Energy", "Finance", "Biotech", "Defense",
  "Consumer", "Mining", "Automotive", "Chemicals", "Telecom",
];

// --- 유럽 핵심 5종목 ---
const EUROPE_CORE: CoreStockDef[] = [
  {
    id: "eu-core-1",
    ticker: "ASML",
    name: "ASML",
    sector: "Technology",
    description: "유럽 반도체 장비 독점 기업. EUV 공정 핵심. 소설 세계관의 유럽 대장주.",
    marketCap: 2000 * TRILLION,
    initialPrice: 620.5,
  },
  {
    id: "eu-core-2",
    ticker: "AIRB",
    name: "Airbus",
    sector: "Defense",
    description: "유럽 항공·방산 거대 기업. 방산 서사의 유럽 축 핵심.",
    marketCap: 1500 * TRILLION,
    initialPrice: 145.8,
  },
  {
    id: "eu-core-3",
    ticker: "LVMH",
    name: "LVMH",
    sector: "Consumer",
    description: "글로벌 럭셔리 그룹. 소비 서사의 유럽 대표주.",
    marketCap: 1200 * TRILLION,
    initialPrice: 890.2,
  },
  {
    id: "eu-core-4",
    ticker: "SAP",
    name: "SAP",
    sector: "Technology",
    description: "유럽 최대 소프트웨어 기업. 기업용 솔루션 독점.",
    marketCap: 800 * TRILLION,
    initialPrice: 210.4,
  },
  {
    id: "eu-core-5",
    ticker: "NOVO",
    name: "Novo Nordisk",
    sector: "Biotech",
    description: "북유럽 바이오 거인. 비만 치료제 글로벌 선도.",
    marketCap: 500 * TRILLION,
    initialPrice: 98.7,
  },
];

const EUROPE_NAMES = [
  "Slemens AG", "Bayer Werk Fictional", "TotalPower Energies", "BPN Paribas Group",
  "Allianze Insurance", "Volkscar Group", "BMVV Group", "Merck KGaA Fictional",
  "Adidad Sport", "Nostle Foods", "Rocher Holding", "Novart Pharma",
  "Telephonica Iberia", "Eni Energia Fictional", "INGE Bank", "Snyder Electric",
  "SanoPharma", "L'Oriel Cosmetics", "Inditex Fashion Fictional", "Anheuser Drink",
];

const EUROPE_SECTORS = [
  "Technology", "Energy", "Finance", "Biotech", "Defense",
  "Consumer", "Automotive", "Chemicals", "Telecom", "Insurance",
];

// =====================================================
// 채권 정의 (현실 고증 9종목)
// price: 액면가 100 기준 %가리(예: 97.8 = 액면가의 97.8%)
// coupon: 표면금리 (%)
// maturityYears: 잔존만기 (년)
// riskCategory: sovereign | corporate_ig | high_yield
// =====================================================
interface BondDef {
  id: string;
  name: string;
  ticker: string;
  price: number;
  cap: number;
  sector: string;
  coupon: number;
  maturityYears: number;
  riskCategory: BondMeta["riskCategory"];
  countryCode: string;
  issuerName: string;
  description: string;
}

const BOND_DEFS: BondDef[] = [
  // ── 국채 (Sovereign) ──
  {
    id: "b-US10Y",
    name: "미국 국채 10년물",
    ticker: "US10Y",
    price: 97.80,
    cap: 1500 * TRILLION,
    sector: "채권",
    coupon: 4.25,
    maturityYears: 9.5,
    riskCategory: "sovereign",
    countryCode: "US",
    issuerName: "U.S. Treasury",
    description: "글로벌 안전자산의 기준. 전쟁 금융위기 시 폭등. 연준 기준금리에 가장 민감하게 반응.",
  },
  {
    id: "b-KR10Y",
    name: "한국 국채 10년물",
    ticker: "KR10Y",
    price: 98.50,
    cap: 800 * TRILLION,
    sector: "채권",
    coupon: 3.40,
    maturityYears: 9.2,
    riskCategory: "sovereign",
    countryCode: "KR",
    issuerName: "기획재정부",
    description: "국내 증시 하락 시 방어 수단. 한국은행 기준금리 정책과 직결.",
  },
  {
    id: "b-DE10Y",
    name: "독일 국채 10년물 (분트)",
    ticker: "DE10Y",
    price: 99.10,
    cap: 500 * TRILLION,
    sector: "채권",
    coupon: 2.60,
    maturityYears: 9.8,
    riskCategory: "sovereign",
    countryCode: "DE",
    issuerName: "Deutsche Finanzagentur",
    description: "유럽 시장 지표 채권. ECB 금리 정책과 연동.",
  },
  {
    id: "b-JP10Y",
    name: "일본 국채 10년물 (JGB)",
    ticker: "JP10Y",
    price: 99.80,
    cap: 700 * TRILLION,
    sector: "채권",
    coupon: 0.80,
    maturityYears: 9.1,
    riskCategory: "sovereign",
    countryCode: "JP",
    issuerName: "일본 재무성",
    description: "국내엔 쾐리 트레이드와 연결된 글로벌 유동성 지표.",
  },
  {
    id: "b-UK10Y",
    name: "영국 국채 10년물 (길트)",
    ticker: "UK10Y",
    price: 97.20,
    cap: 400 * TRILLION,
    sector: "채권",
    coupon: 4.10,
    maturityYears: 9.3,
    riskCategory: "sovereign",
    countryCode: "GB",
    issuerName: "UK Debt Management Office",
    description: "브렉시트 이후 변동성 확대. 영국은행(BOE) 금리 정책 반영.",
  },
  // ── 우량 회사채 (Investment Grade) ──
  {
    id: "b-OSEL3Y",
    name: "오성전자 3년 회사채",
    ticker: "OSEL3Y",
    price: 99.60,
    cap: 80 * TRILLION,
    sector: "채권",
    coupon: 4.80,
    maturityYears: 2.8,
    riskCategory: "corporate_ig",
    countryCode: "KR",
    issuerName: "오성전자",
    description: "초우량 회사채. 오성전자 재무 상태를 주가보다 먼저 반영. 국채 대비 +80bp 프리미엄.",
  },
  {
    id: "b-NOVA5Y",
    name: "노바에너지 5년 회사채",
    ticker: "NOVA5Y",
    price: 99.10,
    cap: 60 * TRILLION,
    sector: "채권",
    coupon: 5.20,
    maturityYears: 4.5,
    riskCategory: "corporate_ig",
    countryCode: "KR",
    issuerName: "노바 에너지",
    description: "소설 대장주 노바에너지 발행 채권. 에너지 서사 전개에 따라 가격 동조.",
  },
  // ── 하이일드 (Junk) ──
  {
    id: "b-GTHY7Y",
    name: "글로벌테크 7년 고수익채",
    ticker: "GTHY7Y",
    price: 72.40,
    cap: 30 * TRILLION,
    sector: "채권",
    coupon: 16.50,
    maturityYears: 6.5,
    riskCategory: "high_yield",
    countryCode: "US",
    issuerName: "GlobalTech Corp (Fiction)",
    description: "부도 위기 하이일드. 쿠폰 16.5%이지만 부도 시 0원. 글로벌테크 운명에 따라 가격 급변동.",
  },
  {
    id: "b-AKHY5Y",
    name: "아크리스 5년 정크본드",
    ticker: "AKHY5Y",
    price: 58.30,
    cap: 15 * TRILLION,
    sector: "채권",
    coupon: 19.00,
    maturityYears: 4.2,
    riskCategory: "high_yield",
    countryCode: "KR",
    issuerName: "아크리스 (소설 내 부실기업)",
    description: "소설 내 파산 위기 기업. 19% 고쿠폰이지만 부도 후 즉시 휴지조각. 최고위험 상품.",
  },
];

const COMMODITY_DEFS = [
  { name: "서부 텍사스산 원유 (WTI)", ticker: "WTI", price: 78.4, cap: 300 * TRILLION, sector: "에너지" },
  { name: "브렌트유", ticker: "BRENT", price: 82.1, cap: 280 * TRILLION, sector: "에너지" },
  { name: "천연가스", ticker: "NATGAS", price: 2.85, cap: 120 * TRILLION, sector: "에너지" },
  { name: "금", ticker: "GOLD", price: 2310.5, cap: 500 * TRILLION, sector: "귀금속" },
  { name: "은", ticker: "SILVER", price: 29.4, cap: 150 * TRILLION, sector: "귀금속" },
  { name: "구리", ticker: "COPPER", price: 4.32, cap: 180 * TRILLION, sector: "산업금속" },
  { name: "희토류 종합", ticker: "REB", price: 156.8, cap: 220 * TRILLION, sector: "희토류" },
  { name: "리튬", ticker: "LITH", price: 88.2, cap: 160 * TRILLION, sector: "희토류" },
  { name: "밀", ticker: "WHEAT", price: 612.5, cap: 90 * TRILLION, sector: "농산물" },
  { name: "옥수수", ticker: "CORN", price: 478.3, cap: 80 * TRILLION, sector: "농산물" },
];

const ETF_DEFS = [
  { name: "코스피 뱅가드 ETF", ticker: "KVETF", cap: 50 * TRILLION, sector: "국내 종합" },
  { name: "테크 블루칩 ETF", ticker: "TBETF", cap: 40 * TRILLION, sector: "IT" },
  { name: "친환경 에너지 ETF", ticker: "GENV", cap: 30 * TRILLION, sector: "에너지" },
  { name: "방위산업 인덱스 ETF", ticker: "DEFX", cap: 25 * TRILLION, sector: "방산" },
  { name: "바이오 성장 ETF", ticker: "BIOG", cap: 20 * TRILLION, sector: "바이오" },
  { name: "반도체 테마 ETF", ticker: "SEMI", cap: 35 * TRILLION, sector: "반도체" },
  { name: "원자재 종합 ETF", ticker: "COMB", cap: 28 * TRILLION, sector: "원자재" },
  { name: "단기채권 안전선호 ETF", ticker: "BNDX", cap: 45 * TRILLION, sector: "채권" },
];

function makeStockAndMeta(
  def: CoreStockDef & { market: Stock["market"]; isCore: boolean; relevanceWeight?: number; bondMeta?: Stock["bondMeta"] },
  rng: () => number,
): { stock: Stock; meta: StockMeta } {
  // Add noise to the marketCap so it doesn't end in clean 00s.
  // We use a small randomized offset (0.9995 to 1.0005) and a random addition
  const capNoise = 0.9995 + rng() * 0.001;
  const rawMarketCap = Math.floor(def.marketCap * capNoise) + Math.floor(rng() * 100_000_000) + 123456;

  const sharesOutstanding = Math.floor(rawMarketCap / def.initialPrice);
  const relevanceWeight = def.relevanceWeight ?? +(0.5 + rng() * 1.0).toFixed(2);
  const drift = (rng() - 0.5) * 0.04;
  const currentPrice = +(def.initialPrice * (1 + drift)).toFixed(2);
  const capClass = classifyCap(rawMarketCap);

  // marketCap is dynamically computed as sharesOutstanding * currentPrice (ensures it is not a flat number ending in 00)
  const finalMarketCap = Math.floor(sharesOutstanding * currentPrice);

  // Ensure volume does not end in flat 00 by adding a prime-based random number
  const volumeNoise = Math.floor(rng() * 9) + 1; // 1 to 9
  const volume = (Math.floor(rng() * 495_000) + 5000) * 10 + volumeNoise;

  // --- Financials Generation ---
  let targetPerBase = 15;
  if (def.sector.includes("바이오") || def.sector.includes("Biotech")) targetPerBase = 40;
  else if (def.sector.includes("IT") || def.sector.includes("Technology") || def.sector.includes("반도체")) targetPerBase = 20;
  else if (def.sector.includes("금융") || def.sector.includes("Finance")) targetPerBase = 7;
  else if (def.sector.includes("에너지") || def.sector.includes("Energy")) targetPerBase = 9;
  else if (def.sector.includes("방산") || def.sector.includes("Defense")) targetPerBase = 18;

  const targetPer = targetPerBase * (0.8 + rng() * 0.4);
  const netIncome = finalMarketCap / targetPer;
  const operatingProfit = netIncome * (1.1 + rng() * 0.4);
  
  const eps = netIncome / sharesOutstanding;
  const fairValue = +(eps * targetPer).toFixed(2);
  const pbr = +(1.0 + rng() * 3.0).toFixed(2);
  const evEbitda = +(targetPer * (0.6 + rng() * 0.2)).toFixed(2);

  const currentYear = 2026;
  const opGrowths = [(rng() - 0.2) * 0.4, (rng() - 0.2) * 0.4, (rng() - 0.2) * 0.4];
  const niGrowths = opGrowths.map(g => g + (rng() - 0.5) * 0.1);

  const op2026 = operatingProfit;
  const op2025 = op2026 / (1 + opGrowths[2]);
  const op2024 = op2025 / (1 + opGrowths[1]);
  const op2023 = op2024 / (1 + opGrowths[0]);

  const ni2026 = netIncome;
  const ni2025 = ni2026 / (1 + niGrowths[2]);
  const ni2024 = ni2025 / (1 + niGrowths[1]);
  const ni2023 = ni2024 / (1 + niGrowths[0]);

  const history: FinancialStatement[] = [
    { year: currentYear - 3, operatingProfit: op2023, netIncome: ni2023, opYoY: opGrowths[0]*100, niYoY: niGrowths[0]*100, type: "ACTUAL" },
    { year: currentYear - 2, operatingProfit: op2024, netIncome: ni2024, opYoY: opGrowths[1]*100, niYoY: niGrowths[1]*100, type: "ACTUAL" },
    { year: currentYear - 1, operatingProfit: op2025, netIncome: ni2025, opYoY: opGrowths[2]*100, niYoY: niGrowths[2]*100, type: "ACTUAL" },
    { year: currentYear, operatingProfit: op2026, netIncome: ni2026, opYoY: opGrowths[2]*100, niYoY: niGrowths[2]*100, type: "CONSENSUS" }
  ];

  const financials: Financials = {
    per: +targetPer.toFixed(2),
    pbr,
    evEbitda,
    eps: +eps.toFixed(2),
    fairValue,
    history
  };

  const stock: Stock = {
    id: def.id,
    ticker: def.ticker,
    name: def.name,
    market: def.market,
    sector: def.sector,
    description: def.description,
    currentPrice,
    previousClose: def.initialPrice,
    openPrice: +(def.initialPrice * (1 + (rng() - 0.5) * 0.02)).toFixed(2),
    high: +Math.max(currentPrice, def.initialPrice * 1.03).toFixed(2),
    low: +Math.min(currentPrice, def.initialPrice * 0.97).toFixed(2),
    volume,
    marketCap: finalMarketCap,
    relevanceWeight,
    targetPrice: fairValue,
    isCore: def.isCore,
    listedAt: "2026-01-05",
    financials,
    ...(def.bondMeta ? { bondMeta: def.bondMeta } : {}),
  };

  const meta: StockMeta = {
    id: def.id,
    ticker: def.ticker,
    name: def.name,
    market: def.market,
    sector: def.sector,
    marketCap: finalMarketCap,
    capClass,
    isCore: def.isCore,
    relevanceWeight,
    sharesOutstanding,
    initialPrice: def.initialPrice,
    description: def.description,
  };

  return { stock, meta };
}

export function generateAllStocks(): { stocks: Stock[]; metas: StockMeta[] } {
  const rng = mulberry32(20260629);
  const stocks: Stock[] = [];
  const metas: StockMeta[] = [];

  // --- 국내주식 (50종목, 총 4000조) ---
  // 핵심 5종목: 1950조
  for (const c of DOMESTIC_CORE) {
    const { stock, meta } = makeStockAndMeta(
      { ...c, market: "domestic", isCore: true, relevanceWeight: 1.3 },
      rng,
    );
    stocks.push(stock);
    metas.push(meta);
  }

  // 나머지 45종목: 2050조
  // 10 대형주 (100~150조): ~1250조
  // 15 중형주 (30~70조): ~750조
  // 20 소형주 (2~10조): ~50조
  const domesticRemaining = 2050 * TRILLION;
  const largeCapCount = 10;
  const midCapCount = 15;
  const smallCapCount = 20;
  const largeCapTotal = 1250 * TRILLION;
  const midCapTotal = 750 * TRILLION;
  const smallCapTotal = 50 * TRILLION;

  const LARGE_DEFS = [
    { name: "오성전자", cap: 800 * TRILLION, sector: "반도체", ticker: "0010", price: 85_000 },
    { name: "선광반도체", cap: 300 * TRILLION, sector: "반도체", ticker: "0020", price: 195_000 },
    { name: "LD에너지", cap: 180 * TRILLION, sector: "에너지", ticker: "0030", price: 340_000 },
    { name: "미래자동차", cap: 110 * TRILLION, sector: "소비재", ticker: "0040", price: 250_000 },
    { name: "은호모빌리티", cap: 90 * TRILLION, sector: "소비재", ticker: "0050", price: 110_000 },
    { name: "셀트리젠", cap: 80 * TRILLION, sector: "바이오", ticker: "0060", price: 180_000 },
    { name: "포스트스틸", cap: 70 * TRILLION, sector: "철강", ticker: "0070", price: 380_000 },
    { name: "NVC", cap: 60 * TRILLION, sector: "IT", ticker: "0080", price: 170_000 },
    { name: "지엑스건설", cap: 30 * TRILLION, sector: "화학", ticker: "0090", price: 50_000 },
    { name: "KKA", cap: 30 * TRILLION, sector: "IT", ticker: "0100", price: 40_000 },
  ];

  for (let i = 0; i < largeCapCount; i++) {
    const def = LARGE_DEFS[i];
    const { stock, meta } = makeStockAndMeta({
      id: `d-large-${i}`,
      ticker: def.ticker,
      name: def.name,
      market: "domestic",
      sector: def.sector,
      description: `${def.sector} 섹터 대형주.`,
      marketCap: def.cap,
      initialPrice: def.price,
      isCore: false,
    }, rng);
    stocks.push(stock);
    metas.push(meta);
  }

  for (let i = 0; i < midCapCount; i++) {
    const cap = midCapTotal / midCapCount * (0.7 + rng() * 0.6);
    const price = Math.floor(rng() * 80_000) + 10_000;
    const prefix = DOMESTIC_PREFIX[Math.floor(rng() * DOMESTIC_PREFIX.length)];
    const suffix = DOMESTIC_SUFFIX[Math.floor(rng() * DOMESTIC_SUFFIX.length)];
    const sector = DOMESTIC_SECTORS[(i + 3) % DOMESTIC_SECTORS.length];
    const { stock, meta } = makeStockAndMeta({
      id: `d-mid-${i}`,
      ticker: String(110 + i * 10).padStart(4, "0"),
      name: `${prefix}${suffix}`,
      market: "domestic",
      sector,
      description: `${sector} 섹터 중형주.`,
      marketCap: cap,
      initialPrice: price,
      isCore: false,
    }, rng);
    stocks.push(stock);
    metas.push(meta);
  }

  for (let i = 0; i < smallCapCount; i++) {
    const cap = smallCapTotal / smallCapCount * (0.5 + rng() * 1.0);
    const price = Math.floor(rng() * 30_000) + 2_000;
    const prefix = DOMESTIC_PREFIX[Math.floor(rng() * DOMESTIC_PREFIX.length)];
    const suffix = DOMESTIC_SUFFIX[Math.floor(rng() * DOMESTIC_SUFFIX.length)];
    const sector = DOMESTIC_SECTORS[(i + 7) % DOMESTIC_SECTORS.length];
    const { stock, meta } = makeStockAndMeta({
      id: `d-small-${i}`,
      ticker: String(260 + i * 10).padStart(4, "0"),
      name: `${prefix}${suffix}`,
      market: "domestic",
      sector,
      description: `${sector} 섹터 소형주.`,
      marketCap: cap,
      initialPrice: price,
      isCore: false,
    }, rng);
    stocks.push(stock);
    metas.push(meta);
  }

  void domesticRemaining;

  // --- 미국주식 (50종목, 총 5경 = 50,000조) ---
  // 핵심 5종목: 18,000조
  for (const c of OVERSEAS_CORE) {
    const { stock, meta } = makeStockAndMeta(
      { ...c, market: "overseas", isCore: true, relevanceWeight: 1.3 },
      rng,
    );
    stocks.push(stock);
    metas.push(meta);
  }

  // 나머지 45종목: 32,000조
  // 15 대형주 (1000~1500조): ~18,750조
  // 15 중형주 (500~900조): ~10,500조
  // 15 소형주 (100~400조): ~2,750조
  const US_LARGE_DEFS = [
    { name: "Macrosoft Corp", ticker: "MCSFT", cap: 4800 * TRILLION, sector: "Technology", price: 420.0 },
    { name: "Pineapple Tech", ticker: "PNPL", cap: 4600 * TRILLION, sector: "Technology", price: 210.0 },
    { name: "NVISION Corp", ticker: "NVSN", cap: 4400 * TRILLION, sector: "Technology", price: 120.0 },
    { name: "Googol Alphanet", ticker: "GGOL", cap: 3000 * TRILLION, sector: "Technology", price: 180.0 },
    { name: "Amason Retail", ticker: "AMSN", cap: 2800 * TRILLION, sector: "Consumer", price: 190.0 },
    { name: "Beta Platforms", ticker: "BETA", cap: 1800 * TRILLION, sector: "Technology", price: 500.0 },
    { name: "Berkshire Pathway", ticker: "BRKP", cap: 1400 * TRILLION, sector: "Finance", price: 460.0 },
    { name: "Lily Pharma", ticker: "LILY", cap: 1200 * TRILLION, sector: "Biotech", price: 890.0 },
    { name: "Broadchip Inc", ticker: "BDCP", cap: 1100 * TRILLION, sector: "Technology", price: 140.0 },
    { name: "JPMorgan Trust", ticker: "JPMT", cap: 900 * TRILLION, sector: "Finance", price: 200.0 },
    { name: "Telsa Motors", ticker: "TLSA", cap: 900 * TRILLION, sector: "Automotive", price: 180.0 },
    { name: "Valmart Stores", ticker: "VLMT", cap: 800 * TRILLION, sector: "Consumer", price: 68.0 },
    { name: "Shevron Gas", ticker: "SHVR", cap: 700 * TRILLION, sector: "Energy", price: 150.0 },
    { name: "Procter & Global", ticker: "PGBL", cap: 600 * TRILLION, sector: "Consumer", price: 165.0 },
    { name: "MasterPay Group", ticker: "MSTP", cap: 600 * TRILLION, sector: "Finance", price: 450.0 },
  ];

  const US_MID_DEFS = [
    { name: "PopCo Drinks", ticker: "PPCO", cap: 500 * TRILLION, sector: "Consumer", price: 170.0 },
    { name: "Coda-Cola Corp", ticker: "CODA", cap: 480 * TRILLION, sector: "Consumer", price: 62.0 },
    { name: "Costgo Retail", ticker: "CSTG", cap: 450 * TRILLION, sector: "Consumer", price: 800.0 },
    { name: "Netflex Stream", ticker: "NTFLX", cap: 420 * TRILLION, sector: "Consumer", price: 650.0 },
    { name: "Adobia Creative", ticker: "ADBE", cap: 380 * TRILLION, sector: "Technology", price: 480.0 },
    { name: "Saleforce Cloud", ticker: "SLFC", cap: 340 * TRILLION, sector: "Technology", price: 240.0 },
    { name: "AMN Processor", ticker: "AMND", cap: 300 * TRILLION, sector: "Technology", price: 160.0 },
    { name: "Intell Silicon", ticker: "ITEL", cap: 280 * TRILLION, sector: "Technology", price: 30.0 },
    { name: "Qualcom Wireless", ticker: "QCOM", cap: 260 * TRILLION, sector: "Technology", price: 200.0 },
    { name: "Honeywel Industrial", ticker: "HNWL", cap: 240 * TRILLION, sector: "Defense", price: 210.0 },
    { name: "Boening Aero", ticker: "BOEN", cap: 220 * TRILLION, sector: "Defense", price: 180.0 },
    { name: "Sisco Networks", ticker: "SISC", cap: 200 * TRILLION, sector: "Technology", price: 48.0 },
    { name: "Oracel Database", ticker: "ORCL", cap: 190 * TRILLION, sector: "Technology", price: 140.0 },
    { name: "Comcast Cable", ticker: "CMCS", cap: 180 * TRILLION, sector: "Telecom", price: 40.0 },
    { name: "Disny Media", ticker: "DISN", cap: 170 * TRILLION, sector: "Consumer", price: 100.0 },
  ];

  const US_SMALL_DEFS = [
    { name: "Ubar Ride", ticker: "UBAR", cap: 150 * TRILLION, sector: "Automotive", price: 70.0 },
    { name: "PayPallet Wallet", ticker: "PPAL", cap: 140 * TRILLION, sector: "Finance", price: 60.0 },
    { name: "Nika Sports", ticker: "NIKA", cap: 130 * TRILLION, sector: "Consumer", price: 95.0 },
    { name: "Goldmann Banking", ticker: "GLDM", cap: 120 * TRILLION, sector: "Finance", price: 450.0 },
    { name: "Morgans Wealth", ticker: "MRGW", cap: 110 * TRILLION, sector: "Finance", price: 90.0 },
    { name: "Catpillar Heavy", ticker: "CATP", cap: 100 * TRILLION, sector: "Automotive", price: 320.0 },
    { name: "GEE Industrial", ticker: "GEEI", cap: 95 * TRILLION, sector: "Energy", price: 160.0 },
    { name: "Phizer Health", ticker: "PHZR", cap: 90 * TRILLION, sector: "Biotech", price: 28.0 },
    { name: "Union Railway", ticker: "UNPR", cap: 85 * TRILLION, sector: "Consumer", price: 230.0 },
    { name: "Starbuck Cafe", ticker: "STBC", cap: 80 * TRILLION, sector: "Consumer", price: 80.0 },
    { name: "Lockhead Defense", ticker: "LKHD", cap: 75 * TRILLION, sector: "Defense", price: 460.0 },
    { name: "Intellect Labs", ticker: "INTL", cap: 70 * TRILLION, sector: "Technology", price: 50.0 },
    { name: "Modern Biotech", ticker: "MDRN", cap: 65 * TRILLION, sector: "Biotech", price: 120.0 },
    { name: "Apply Materials", ticker: "APMT", cap: 60 * TRILLION, sector: "Technology", price: 210.0 },
    { name: "Americard Express", ticker: "AMEX", cap: 55 * TRILLION, sector: "Finance", price: 230.0 },
  ];

  for (let i = 0; i < 15; i++) {
    const def = US_LARGE_DEFS[i];
    const { stock, meta } = makeStockAndMeta({
      id: `o-large-${i}`,
      ticker: def.ticker,
      name: def.name,
      market: "overseas",
      sector: def.sector,
      description: `${def.sector} sector. 다국적 대형 기업.`,
      marketCap: def.cap,
      initialPrice: def.price,
      isCore: false,
    }, rng);
    stocks.push(stock);
    metas.push(meta);
  }

  for (let i = 0; i < 15; i++) {
    const def = US_MID_DEFS[i];
    const { stock, meta } = makeStockAndMeta({
      id: `o-mid-${i}`,
      ticker: def.ticker,
      name: def.name,
      market: "overseas",
      sector: def.sector,
      description: `${def.sector} sector. 중형 기업.`,
      marketCap: def.cap,
      initialPrice: def.price,
      isCore: false,
    }, rng);
    stocks.push(stock);
    metas.push(meta);
  }

  for (let i = 0; i < 15; i++) {
    const def = US_SMALL_DEFS[i];
    const { stock, meta } = makeStockAndMeta({
      id: `o-small-${i}`,
      ticker: def.ticker,
      name: def.name,
      market: "overseas",
      sector: def.sector,
      description: `${def.sector} sector. 소형 기업.`,
      marketCap: def.cap,
      initialPrice: def.price,
      isCore: false,
    }, rng);
    stocks.push(stock);
    metas.push(meta);
  }

  // --- 유럽주식 (50종목, 총 3경) ---
  // 핵심 5종목: 6000조
  for (const c of EUROPE_CORE) {
    const { stock, meta } = makeStockAndMeta(
      { ...c, market: "europe", isCore: true, relevanceWeight: 1.3 },
      rng,
    );
    stocks.push(stock);
    metas.push(meta);
  }

  const EU_LARGE_DEFS = [
    { name: "LVM Luxe", ticker: "LVMH.EU", cap: 1200 * TRILLION, sector: "Consumer", price: 850.0 },
    { name: "AMSL Litho", ticker: "ASML.EU", cap: 1100 * TRILLION, sector: "Technology", price: 620.0 },
    { name: "Novo Care", ticker: "NOVO.EU", cap: 1000 * TRILLION, sector: "Biotech", price: 100.0 },
    { name: "SAPP Software", ticker: "SAP.EU", cap: 750 * TRILLION, sector: "Technology", price: 210.0 },
    { name: "Slemens AG", ticker: "SIEG", cap: 450 * TRILLION, sector: "Technology", price: 170.0 },
    { name: "TotalPower Energies", ticker: "TTE", cap: 420 * TRILLION, sector: "Energy", price: 65.0 },
    { name: "L'Oriel Cosmetics", ticker: "ORIL", cap: 400 * TRILLION, sector: "Consumer", price: 440.0 },
    { name: "Snyder Electric", ticker: "SNDR", cap: 380 * TRILLION, sector: "Technology", price: 210.0 },
    { name: "Allianze Insurance", ticker: "ALNZ", cap: 320 * TRILLION, sector: "Insurance", price: 260.0 },
    { name: "SanoPharma", ticker: "SNFI", cap: 300 * TRILLION, sector: "Biotech", price: 90.0 },
    { name: "AeroParis Aero", ticker: "AIRB.EU", cap: 280 * TRILLION, sector: "Defense", price: 140.0 },
    { name: "German Telecom", ticker: "DTEG", cap: 250 * TRILLION, sector: "Telecom", price: 22.0 },
    { name: "Inditext Fashion", ticker: "ITX", cap: 240 * TRILLION, sector: "Consumer", price: 45.0 },
    { name: "Iberdrol Power", ticker: "IBER", cap: 220 * TRILLION, sector: "Energy", price: 12.0 },
    { name: "Santaner Bank", ticker: "SAN", cap: 200 * TRILLION, sector: "Finance", price: 4.5 },
  ];

  const EU_MID_DEFS = [
    { name: "Bayar Werk", ticker: "BAYN", cap: 180 * TRILLION, sector: "Chemicals", price: 35.0 },
    { name: "BPN Paribas Group", ticker: "BNPP", cap: 170 * TRILLION, sector: "Finance", price: 65.0 },
    { name: "BMVV Group", ticker: "BMWG", cap: 160 * TRILLION, sector: "Automotive", price: 90.0 },
    { name: "Mercedez Cars", ticker: "MBG", cap: 150 * TRILLION, sector: "Automotive", price: 70.0 },
    { name: "BSAF Chemical", ticker: "BASF", cap: 140 * TRILLION, sector: "Chemicals", price: 48.0 },
    { name: "Enell Power", ticker: "ENEL", cap: 130 * TRILLION, sector: "Energy", price: 6.0 },
    { name: "Deutshe Post", ticker: "DPW", cap: 120 * TRILLION, sector: "Consumer", price: 38.0 },
    { name: "Adidad Sport", ticker: "ADID", cap: 110 * TRILLION, sector: "Consumer", price: 220.0 },
    { name: "Nostle Foods", ticker: "NSTL", cap: 100 * TRILLION, sector: "Consumer", price: 95.0 },
    { name: "INGE Bank", ticker: "INGA", cap: 95 * TRILLION, sector: "Finance", price: 15.0 },
    { name: "AXIA Insurance", ticker: "AXAF", cap: 90 * TRILLION, sector: "Insurance", price: 32.0 },
    { name: "Stellanis Auto", ticker: "STLA", cap: 85 * TRILLION, sector: "Automotive", price: 18.0 },
    { name: "Safren Aero", ticker: "SAF", cap: 80 * TRILLION, sector: "Defense", price: 200.0 },
    { name: "Noki Net", ticker: "NOKA", cap: 75 * TRILLION, sector: "Technology", price: 3.5 },
    { name: "Ferrara Race", ticker: "RACE", cap: 70 * TRILLION, sector: "Automotive", price: 380.0 },
  ];

  const EU_SMALL_DEFS = [
    { name: "Hermez Luxury", ticker: "HRMS", cap: 65 * TRILLION, sector: "Consumer", price: 2000.0 },
    { name: "Roch Holding", ticker: "ROCH", cap: 60 * TRILLION, sector: "Biotech", price: 240.0 },
    { name: "Novar Pharma", ticker: "NVRT", cap: 55 * TRILLION, sector: "Biotech", price: 90.0 },
    { name: "Enii Energia", ticker: "ENIE", cap: 50 * TRILLION, sector: "Energy", price: 15.0 },
    { name: "Danon Dairy", ticker: "DANO", cap: 45 * TRILLION, sector: "Consumer", price: 60.0 },
    { name: "Kerring Luxury", ticker: "KER", cap: 42 * TRILLION, sector: "Consumer", price: 350.0 },
    { name: "Heinekey Brew", ticker: "HEIN", cap: 40 * TRILLION, sector: "Consumer", price: 90.0 },
    { name: "Michelan Tyre", ticker: "MICH", cap: 38 * TRILLION, sector: "Automotive", price: 35.0 },
    { name: "Infineos Chip", ticker: "IFX", cap: 35 * TRILLION, sector: "Technology", price: 30.0 },
    { name: "Philps Health", ticker: "PHIA", cap: 32 * TRILLION, sector: "Consumer", price: 25.0 },
    { name: "Volv Heavy", ticker: "VOLV", cap: 30 * TRILLION, sector: "Automotive", price: 25.0 },
    { name: "Sodex Food", ticker: "SDXO", cap: 28 * TRILLION, sector: "Consumer", price: 80.0 },
    { name: "Pumer Sport", ticker: "PUM", cap: 25 * TRILLION, sector: "Consumer", price: 45.0 },
    { name: "Repsoll Oil", ticker: "REP", cap: 22 * TRILLION, sector: "Energy", price: 14.0 },
    { name: "Suezz Utility", ticker: "SUEZ", cap: 20 * TRILLION, sector: "Energy", price: 15.0 },
  ];

  for (let i = 0; i < 15; i++) {
    const def = EU_LARGE_DEFS[i];
    const { stock, meta } = makeStockAndMeta({
      id: `eu-large-${i}`,
      ticker: def.ticker,
      name: def.name,
      market: "europe",
      sector: def.sector,
      description: `${def.sector} sector. 유럽 대형 기업.`,
      marketCap: def.cap,
      initialPrice: def.price,
      isCore: false,
    }, rng);
    stocks.push(stock);
    metas.push(meta);
  }

  for (let i = 0; i < 15; i++) {
    const def = EU_MID_DEFS[i];
    const { stock, meta } = makeStockAndMeta({
      id: `eu-mid-${i}`,
      ticker: def.ticker,
      name: def.name,
      market: "europe",
      sector: def.sector,
      description: `${def.sector} sector. 유럽 중형 기업.`,
      marketCap: def.cap,
      initialPrice: def.price,
      isCore: false,
    }, rng);
    stocks.push(stock);
    metas.push(meta);
  }

  for (let i = 0; i < 15; i++) {
    const def = EU_SMALL_DEFS[i];
    const { stock, meta } = makeStockAndMeta({
      id: `eu-small-${i}`,
      ticker: def.ticker,
      name: def.name,
      market: "europe",
      sector: def.sector,
      description: `${def.sector} sector. 유럽 소형 기업.`,
      marketCap: def.cap,
      initialPrice: def.price,
      isCore: false,
    }, rng);
    stocks.push(stock);
    metas.push(meta);
  }

  // --- 채권 ---
  for (const b of BOND_DEFS) {
    const ytm = calcYTM(b.price, 100, b.coupon, b.maturityYears);
    const bondMeta: Stock["bondMeta"] = {
      couponRate: b.coupon,
      faceValue: 100,
      maturityYears: b.maturityYears,
      currentYtm: ytm,
      riskCategory: b.riskCategory,
      countryCode: b.countryCode,
      issuerName: b.issuerName,
    };
    const { stock, meta } = makeStockAndMeta({
      id: b.id,
      ticker: b.ticker,
      name: b.name,
      market: "bonds",
      sector: b.sector,
      description: b.description,
      marketCap: b.cap,
      initialPrice: b.price, // 액면가 100 기준 %가격
      isCore: false,
      relevanceWeight: 0.7,
      bondMeta,
    }, rng);
    stocks.push(stock);
    metas.push(meta);
  }

  // --- 옵션 (16종목) ---
  const optionTypes = ["CALL", "PUT"];
  for (let i = 0; i < 16; i++) {
    const t = optionTypes[i % 2];
    const strike = 50 + (i % 8) * 25;
    const cap = (50 + rng() * 100) * TRILLION;
    const { stock, meta } = makeStockAndMeta({
      id: `op-${i}`,
      ticker: `${t}${strike}`,
      name: `${t} ${strike} 행사가`,
      market: "options",
      sector: "파생상품",
      description: `${t} 옵션, 행사가 ${strike}.`,
      marketCap: cap,
      initialPrice: +(rng() * 12 + 0.5).toFixed(2),
      isCore: false,
      relevanceWeight: 0.8,
    }, rng);
    stocks.push(stock);
    metas.push(meta);
  }

  // --- 원자재 ---
  for (const c of COMMODITY_DEFS) {
    const { stock, meta } = makeStockAndMeta({
      id: `c-${c.ticker}`,
      ticker: c.ticker,
      name: c.name,
      market: "commodities",
      sector: c.sector,
      description: `${c.sector} 선물.`,
      marketCap: c.cap,
      initialPrice: c.price,
      isCore: false,
      relevanceWeight: 1.1,
    }, rng);
    stocks.push(stock);
    metas.push(meta);
  }

  // --- ETF ---
  for (const e of ETF_DEFS) {
    const price = Math.floor(rng() * 40_000) + 8_000;
    const { stock, meta } = makeStockAndMeta({
      id: `e-${e.ticker}`,
      ticker: e.ticker,
      name: e.name,
      market: "etf",
      sector: e.sector,
      description: `${e.sector} 섹터 ETF.`,
      marketCap: e.cap,
      initialPrice: price,
      isCore: false,
      relevanceWeight: 1.0,
    }, rng);
    stocks.push(stock);
    metas.push(meta);
  }

  return { stocks, metas };
}

export function getMarketCapSummary(metas: StockMeta[]): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const m of metas) {
    summary[m.market] = (summary[m.market] ?? 0) + m.marketCap;
  }
  return summary;
}

export { LP_CONFIG };
