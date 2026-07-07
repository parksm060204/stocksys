import type { CapClass } from "./config";

export type AccountType = "LP" | "MACRO";

// 한국 시장 기준 투자자 주체 분류 (Investor Category)
export type InvestorCategory =
  | "RETAIL"           // 개인 (개미 투자자)
  | "FOREIGNER"        // 외국인 (외국계 자본, 글로벌 IB)
  | "INST_FINANCE"     // 기관 - 금융투자 (증권사 자기자본/프랍매매)
  | "INST_TRUST"       // 기관 - 투신 (자산운용사, 펀드)
  | "INST_PENSION"     // 기관 - 연기금 (국민연금 등)
  | "INST_PEF"         // 기관 - 사모펀드 (PEF, 헷지펀드)
  | "INST_BANK_INS"    // 기관 - 은행/보험
  | "ETC_CORP";        // 기타법인

// 매매 성향에 따른 분류 (Bot Style)
export type BotStyle =
  | "PASSIVE"            // 패시브 — 지수 추종, 기계적 비중 조정
  | "ACTIVE"             // 액티브 — 종목 분석, 뉴스 반응, 알파 추구
  | "LIQUIDITY_PROVIDER"; // 유동성 공급자 — 마켓 메이커, 호가 채우기

// 시장 집중도
export type MarketFocus = "DOMESTIC" | "OVERSEAS" | "GLOBAL" | "EUROPE";

// 알고리즘 행동 패턴
export type AlgoPattern =
  | "DEFENDER"        // 하락장 방어 — 저가 매수 호가벽
  | "TREND_CHASER"    // 트렌드 추종 — 호재 시 추격 매수
  | "SCALPER"         // 스캘핑 — 초단타, 호가 빈 공간 채우기
  | "VALUE_HOLDER"    // 가치 보유 — 장기 보유, 거래 빈도 낮음
  | "MOMENTUM"        // 모멘텀 — 상승 가속화, 하락 가속화
  | "INDEX_TRACKER"   // 인덱스 추종 — 시장 비중 기계적 조정
  | "MARKET_MAKER"    // 마켓 메이킹 — 촘촘한 호가 유지
  | "ARBITRAGER";     // 차익거래 — 가격 차이 이용

// 채권 등급
export type BondGrade = "INVESTMENT_GRADE" | "HIGH_YIELD" | "MIXED";

// 파생상품 용도
export type DerivativePurpose = "HEDGING" | "SPECULATION" | "ARBITRAGE" | "MARKET_MAKING";

// 포트폴리오 자산 배분 (자본 대비 %)
export interface PortfolioAllocation {
  stockMax: number;        // 주식 투자 상한 (%)
  bondMax: number;         // 채권 투자 상한 (%)
  derivativeMax: number;   // 파생상품 투자 상한 (%)
  cashMin: number;         // 현금 보유 하한 (%)
  bondGrade: BondGrade;             // 채권 등급 (우량/정크/혼합)
  derivativePurpose: DerivativePurpose; // 파생상품 용도
  stockStyle: string;      // 주식 투자 스타일 설명
  bondStyle: string;       // 채권 투자 스타일 설명
  derivativeStyle: string; // 파생상품 투자 스타일 설명
  rationale: string;       // 전체 포트폴리오 운용 이유
}

export interface Holding {
  quantity: number;
  lockedQuantity: number;
  avgPrice: number;
}

export interface LPAccount {
  id: string; // Account ID (e.g., "LP-001")
  type: AccountType;
  isRealUser?: boolean; // 실제 사람 유저 계정 여부
  name: string;
  investorCategory: InvestorCategory;
  botStyle: BotStyle;
  marketFocus: MarketFocus;
  algoPattern: AlgoPattern;
  capital: number;
  cash: number;
  lockedCash: number;
  holdings: Record<string, Holding>; // stockId -> Holding
  availableCash: number; // For compatibility or legacy usage, but we should rely on cash - lockedCash
  aggressiveness: number;
  patience: number;
  sectorBias: string | null;
  defenseThreshold: number;
  newsSensitivity: number;
  tradeFrequency: number;
  description: string;
  allocation: PortfolioAllocation;
  rebalanceStyle: "gradual" | "aggressive";
}

export interface LPOrder {
  accountId: string;
  accountType: AccountType;
  side: "buy" | "sell";
  price: number;
  size: number;
}

export interface Order {
  id: string;
  accountId: string;
  side: "buy" | "sell";
  type: "limit" | "market";
  price: number; // 0 for market orders
  size: number;
  remainingSize: number;
  createdAt: number;
}

export interface TradeRecord {
  id: string;
  makerOrderId: string;
  takerOrderId: string;
  makerAccountId: string;
  takerAccountId: string;
  price: number;
  size: number;
  timestamp: number;
  side: "buy" | "sell"; // taker's side
}

export interface LPState {
  targetPrice: number;
  currentPrice: number;
  velocity: number;
  newsImpact: number;
  newsDecay: number;
  batchedBuySize?: number;
  batchedSellSize?: number;
  lastBatchTime?: number;
  icebergTicks?: number;
  lastOrderBook?: any;
  matchingEngine?: any;
}

export interface MarketStatus {
  open: boolean;
  openTime: string; // "18:00"
  closeTime: string; // "22:30"
  nextEvent: string;
}

export type MarketSession = "PRE" | "REGULAR" | "AFTER" | "CLOSED";

export interface StockMeta {
  id: string;
  ticker: string;
  name: string;
  market: string;
  sector: string;
  marketCap: number;
  capClass: CapClass;
  isCore: boolean;
  relevanceWeight: number;
  sharesOutstanding: number;
  initialPrice: number;
  description: string;
}

// --- 채권 봇 전용 타입 추가 ---

export interface PensionFundBot {
  id: string;
  name: string; // 예: "국민노후보장기금", "대한생명"
  type: 'PENSION_FUND';
  capital: number; // 운용 자금
  riskTolerance: number; // 매우 보수적 (0~1 사이)
  tradingStyle: 'LIMIT_HEAVY'; // 지정가 위주
  targetYTM: Record<string, number>; // 채권 타입별 타겟 YTM
  rebalanceIntervalMs: number; // 시장 감시 주기
}

export interface CommercialBankBot {
  id: string;
  name: string; // 예: "미래제일은행", "국민자산은행"
  type: 'COMMERCIAL_BANK';
  capital: number; // 운용 자금
  reactionSpeed: number; // 매우 빠름
  tradingStyle: 'SWEEP_AGGRESSIVE'; // 시장가 위주의 스윕
  targetSpread: Record<string, number>; // 기준금리 대비 가산금리
  cooldownMs?: number; // 무한 스윕 방지용 쿨다운
  lastSweepTime?: number; // 마지막 스윕 시간
}

export type MarketSentiment = 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';

export interface HedgeFundBot {
  id: string;
  name: string; // 예: "블랙록 IB", "시타델 리서치"
  type: 'HEDGE_FUND';
  capital: number; // 운용 자금
  reactionSpeed: number; // 0.5초 반응 (가장 빠름)
  tradingStyle: 'SWEEP_AGGRESSIVE';
  portfolioTarget: {
    equity: number;
    safeBonds: number;
    highYield: number;
  };
  currentSentiment: MarketSentiment;
}

export interface PropDeskBot {
  id: string;
  name: string; // 예: "키움증권 프랍", "NH투자증권 MM"
  type: 'PROP_DESK';
  capital: number; // 운용 자금
  reactionSpeed: number; // 0.3초 반응 (가장 빠른 스캘핑 속도)
  tradingStyle: 'MARKET_MAKER'; // 유동성 공급 (양방향 지정가)
  mmConfig: {
    maxInventory: number; // 최대 보유 한도
    targetSpreadHoga: number; // 목표 스프레드
    tickProfitTarget: number; // 틱 마진
  };
}
