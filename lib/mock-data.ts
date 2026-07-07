import type {
  ChatMessage,
  Holding,
  Market,
  MarketId,
  MarketStatus,
  NewsItem,
  OrderBook,
  Stock,
  Trade,
} from "./types";
import { generateAllStocks } from "./stock-data";
import { getLPEngine } from "./lp/engine";
// Trigger HMR for engine initialization - Bond market overhaul
import { getInstitution } from "./lp/institution";
import type { StockMeta } from "./lp/types";
import { capLabel } from "./lp/config";

export const MARKETS: Market[] = [
  {
    id: "domestic",
    name: "Domestic Stocks",
    nameKo: "국내 주식",
    icon: "🇰🇷",
    description: "소설 무대의 중심 기업들 (총시총 4000조)",
    unit: "₩",
  },
  {
    id: "overseas",
    name: "US Stocks",
    nameKo: "미국 주식",
    icon: "🇺🇸",
    description: "미국 다국적 기업 (총시총 5경)",
    unit: "$",
  },
  {
    id: "europe",
    name: "European Stocks",
    nameKo: "유럽 주식",
    icon: "🇪🇺",
    description: "유럽 다국적 기업 (총시총 3경)",
    unit: "€",
  },
  {
    id: "bonds",
    name: "Government Bonds",
    nameKo: "주요국 채권",
    icon: "🏛️",
    description: "거시경제의 안전 자산",
    unit: "",
  },
  {
    id: "options",
    name: "Options",
    nameKo: "옵션",
    icon: "⚙️",
    description: "고위험 파생상품·헤지 수단",
    unit: "P",
  },
  {
    id: "commodities",
    name: "Commodity Futures",
    nameKo: "원자재 선물",
    icon: "🛢️",
    description: "자원 서사 직결 (석유·희토류 등)",
    unit: "$",
  },
  {
    id: "etf",
    name: "ETF",
    nameKo: "ETF",
    icon: "📊",
    description: "섹터별 분산 투자 지수",
    unit: "₩",
  },
];

export const MARKET_STATUS: MarketStatus = {
  open: false,
  openTime: "18:00",
  closeTime: "22:30",
  nextEvent: "장전 대기",
};

export const MARKET_HOURS: Record<MarketId, { open: string; close: string }> = {
  domestic: { open: "18:00", close: "22:30" },
  overseas: { open: "18:00", close: "22:30" },
  europe: { open: "18:00", close: "22:30" },
  bonds: { open: "18:00", close: "22:30" },
  options: { open: "18:00", close: "22:30" },
  commodities: { open: "18:00", close: "22:30" },
  etf: { open: "18:00", close: "22:30" },
};

// --- 주식 데이터 + LP 엔진 초기화 ---
const _gen = generateAllStocks();
export const STOCKS: Stock[] = _gen.stocks;
const _metas: StockMeta[] = _gen.metas;

const _engine = getLPEngine();
for (const stock of STOCKS) {
  const meta = _metas.find((m) => m.id === stock.id);
  if (meta) _engine.registerStock(stock, meta);
}

// --- 글로벌 실시간 틱(Tick) 루프 ---
// 사용자가 호가창(상세 페이지)을 보고 있지 않더라도, 모든 주식의 호가와 체결이 실시간으로 이루어지도록 강제합니다.
const globalObj = typeof window !== "undefined" ? window : global;
if (!(globalObj as any).__engineRunning) {
  (globalObj as any).__engineRunning = true;
  setInterval(() => {
    for (const stock of STOCKS) {
      _engine.tick(stock);
    }
  }, 100); // 0.1초마다 모든 주식 틱 업데이트
}

export const STOCK_METAS = _metas;
export const LP_ENGINE = _engine;
export const INSTITUTION = getInstitution();

export function getStocksByMarket(market: MarketId): Stock[] {
  return STOCKS.filter((s) => s.market === market).sort((a, b) => b.marketCap - a.marketCap);
}

export function getStock(id: string): Stock | undefined {
  return STOCKS.find((s) => s.id === id);
}

export function getStockMeta(id: string): StockMeta | undefined {
  return _metas.find((m) => m.id === id);
}

// --- LP 기반 호가창 및 체결 내역 ---
export function getMarketData(stock: Stock) {
  return _engine.tick(stock);
}

export function getOrderBook(stock: Stock): OrderBook {
  return getMarketData(stock).orderBook;
}

// --- LP 기반 체결 내역 ---
export function getRecentTrades(stock: Stock, n = 20): Trade[] {
  const result = _engine.tick(stock);
  const now = Date.now();
  return result.trades.slice(0, n).map((t, i) => ({
    id: `${stock.id}-t${i}`,
    stockId: stock.id,
    price: t.price,
    size: t.size,
    side: t.side,
    time: new Date(now - i * 4000).toISOString().slice(11, 19),
  }));
}

// --- 뉴스 ---
export const NEWS: NewsItem[] = [
  {
    id: "n1",
    title: "노바 에너지, 차세대 수소 추진 시스템 양산 성공 발표",
    body: "가이아 바이오와 공동으로 개발한 연료전지 모듈이 양산 품질 테스트를 통과했다. 에너지 섹터 전반에 호재로 작용할 것으로 보인다.",
    source: "AI",
    sector: "에너지",
    sentiment: "positive",
    createdAt: "2026-06-29T18:05:00Z",
  },
  {
    id: "n2",
    title: "이지스 방산, 대규모 해외 수주 계약 체결",
    body: "중동 국가와 미사일 방어 체계 수출 계약을 체결했다. 방산 섹터에 강한 호재.",
    source: "ADMIN",
    sector: "방산",
    sentiment: "positive",
    createdAt: "2026-06-29T18:20:00Z",
  },
  {
    id: "n3",
    title: "희토류 수급 불안… 리튬 선물 급등",
    body: "주요 생산국 수출 제한 소식에 원자재 선물 시장이 요동치고 있다.",
    source: "AI",
    sector: "희토류",
    sentiment: "negative",
    createdAt: "2026-06-29T19:10:00Z",
  },
  {
    id: "n4",
    title: "헬리오스 반도체, 분기 실적 시장 기대치 하회",
    body: "AI 수요 폭증에도 신규 팹 증설 비용이 영업이익률을 압박했다.",
    source: "DISCLOSURE",
    sector: "반도체",
    sentiment: "negative",
    createdAt: "2026-06-29T20:00:00Z",
  },
  {
    id: "n5",
    title: "美 연방준비제도, 금리 동결… 글로벌 채권 안정",
    body: "시장 예상대로 기준금리가 동결되며 안전자산 채권이 안정적인 흐름을 보였다.",
    source: "AI",
    sector: "채권",
    sentiment: "neutral",
    createdAt: "2026-06-29T21:00:00Z",
  },
  {
    id: "n6",
    title: "가이아 바이오, 2상 임상 종료… 결과 발표 임박",
    body: "난치병 치료제 2상 임상이 예정대로 종료되었다. 결과에 따라 주가 변동성이 커질 전망.",
    source: "DISCLOSURE",
    sector: "바이오",
    sentiment: "neutral",
    createdAt: "2026-06-29T21:30:00Z",
  },
];

// --- 포트폴리오 ---
export const HOLDINGS: Holding[] = [
  { stockId: "d-core-1", ticker: "NOVA", name: "노바 에너지", quantity: 20, avgPrice: 298_000, currentPrice: 312_000 },
  { stockId: "d-core-2", ticker: "HELIOS", name: "헬리오스 반도체", quantity: 50, avgPrice: 172_000, currentPrice: 184_500 },
  { stockId: "d-core-4", ticker: "GAIA", name: "가이아 바이오", quantity: 100, avgPrice: 61_000, currentPrice: 58_300 },
  { stockId: "c-WTI", ticker: "WTI", name: "WTI Crude Oil", quantity: 200, avgPrice: 76.5, currentPrice: 78.4 },
];

// --- 채팅 ---
function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getChatMessages(stockId: string): ChatMessage[] {
  const seed = hashStr(stockId);
  const rng = mulberry32(seed);
  const names = ["독자_3721", "주주_단짝", "노벨리스트", "차트봇", "신입_물개"];
  const msgs: ChatMessage[] = [];
  for (let i = 0; i < 6; i++) {
    msgs.push({
      id: `${stockId}-m${i}`,
      stockId,
      userId: `u${i}`,
      userName: names[Math.floor(rng() * names.length)],
      isShareholder: rng() > 0.4,
      content: [
        "이번 화 분위기 보니까 다음 장에 폭등이겠네",
        "주주 인증. 오늘 호가 벽 두껍다",
        "소설 읽고 선 매수 들어감",
        "LP가 타겟가 올리는 중인가?",
        "공시 떴는데 실적은 아쉽네",
        "이거 섹터 연관성 때문에 같이 움직임",
      ][i],
      createdAt: new Date(Date.now() - i * 60000).toISOString(),
    });
  }
  return msgs;
}

export { capLabel };
