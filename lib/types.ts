export type MarketId =
  | "domestic"
  | "overseas"
  | "europe"
  | "bonds"
  | "options"
  | "commodities"
  | "etf";

export interface Market {
  id: MarketId;
  name: string;
  nameKo: string;
  icon: string;
  description: string;
  unit: string;
}

export interface FinancialStatement {
  year: number;
  operatingProfit: number;
  netIncome: number;
  opYoY: number;
  niYoY: number;
  type: "ACTUAL" | "PRELIMINARY" | "CONSENSUS";
}

export interface Financials {
  per: number;
  pbr: number;
  evEbitda: number;
  eps: number;
  fairValue: number;
  history: FinancialStatement[];
}

export interface Stock {
  id: string;
  ticker: string;
  name: string;
  market: MarketId;
  sector: string;
  description: string;
  currentPrice: number;
  previousClose: number;
  openPrice: number;
  high: number;
  low: number;
  volume: number;
  marketCap: number;
  relevanceWeight: number;
  targetPrice: number;
  isCore: boolean;
  listedAt: string;
  financials?: Financials;
  /** 선택 사항: 시장(market)==='bonds'일 때만 존재 */
  bondMeta?: {
    couponRate: number;    // 표면금리 (%)
    faceValue: number;     // 액면가 (100 기준)
    maturityYears: number; // 잔존만기 (년)
    currentYtm: number;    // 현재 YTM (%)
    riskCategory: "sovereign" | "corporate_ig" | "high_yield";
    countryCode: string;
    issuerName?: string;
  };
}

export interface OrderBookLevel {
  price: number;
  size: number;
  total: number;
}

export interface OrderBook {
  asks: OrderBookLevel[]; // descending price (sells)
  bids: OrderBookLevel[]; // descending price (buys)
  spread: number;
}

export interface Trade {
  id: string;
  stockId: string;
  price: number;
  size: number;
  side: "buy" | "sell";
  time: string;
}

export interface NewsItem {
  id: string;
  title: string;
  body: string;
  source: "AI" | "DISCLOSURE" | "ADMIN";
  sector?: string;
  stockIds?: string[];
  sentiment: "positive" | "negative" | "neutral";
  createdAt: string;
}

export interface NovelEvent {
  id: string;
  title: string;
  rawText: string;
  impactSummary: string;
  createdAt: string;
  sectorImpacts: SectorImpact[];
}

export interface SectorImpact {
  sector: string;
  impact: "positive" | "negative";
  score: number; // -10 ~ +10
}

export interface Holding {
  stockId: string;
  ticker: string;
  name: string;
  quantity: number;
  avgPrice: number;
  currentPrice: number;
}

export interface ChatMessage {
  id: string;
  stockId: string;
  userId: string;
  userName: string;
  isShareholder: boolean;
  content: string;
  createdAt: string;
}

export interface MarketStatus {
  open: boolean;
  openTime: string; // "18:00"
  closeTime: string; // "22:30"
  nextEvent: string;
}
