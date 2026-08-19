/**
 * 원자재 시장 (Commodity Market) 타입 정의
 */

export type CommodityCategory =
  | 'energy'            // 에너지 (원유, 천연가스)
  | 'precious_metals'   // 귀금속 (금, 은)
  | 'industrial_metals' // 산업금속 (구리, 철광석, 리튬)
  | 'agriculture'       // 농산물 (밀, 대두, 커피)
  | 'livestock';        // 축산물 (소고기, 돈육)

export interface SeasonalityCurve {
  period: number;     // 주기 (틱 수)
  amplitude: number;  // 진폭 (예: 0.05 = 5%)
  phase: number;      // 위상차 (라디안)
}

export interface CommodityDefinition {
  id: string;
  ticker: string;
  name: string;
  nameKo: string;
  category: CommodityCategory;
  unit: string;
  basePrice: number;
  tickSize: number;
  tickValue: number;
  baseVolatility: number;      // base_volatility (예: 0.015)
  drift: number;               // 장기 완만한 추세값 (예: 0.0001)
  eventSensitivity: number;    // 이벤트 민감도 계수 (예: 1.5)
  averageVolume: number;       // 평균 거래량 (수급 압력 정규화 분모)
  seasonality?: SeasonalityCurve;
  marginRequirement: number;   // 계약당 증거금 (원화/달러)
  description: string;
}

export interface CommodityState extends CommodityDefinition {
  currentPrice: number;
  previousPrice: number;
  openPrice: number;
  high: number;
  low: number;
  volume: number;
  priceHistory: { tick: number; price: number; volume: number }[];
}

export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit' | 'market';

export interface CommodityOrder {
  id: string;
  commodityId: string;
  botId?: string | undefined;
  userId?: string | undefined;
  side: OrderSide;
  type: OrderType;
  price: number;
  size: number;
  filled: number;
  createdAtTick: number;
  createdAtTime: number;
}

export interface CommodityTrade {
  id: string;
  commodityId: string;
  buyerId?: string | undefined;
  sellerId?: string | undefined;
  price: number;
  size: number;
  tick: number;
  timestamp: number;
}

export interface CommodityEventTemplate {
  id: string;
  title: string;
  headline: string;
  description: string;
  targetCategories: CommodityCategory[];
  targetCommodityIds?: string[] | undefined;
  magnitude: number;        // 가격 충격 크기 (+0.04 = +4%, -0.03 = -3%)
  decayTicks: number;       // 효과 지속 기간 (틱 수)
  probability: number;      // 틱당 발생 확률
}

export interface ActiveCommodityEvent {
  id: string;
  templateId: string;
  title: string;
  headline: string;
  targetCategories: CommodityCategory[];
  targetCommodityIds?: string[] | undefined;
  magnitude: number;
  totalTicks: number;
  remainingTicks: number;
  startTick: number;
}

export interface CommodityNewsItem {
  id: string;
  tick: number;
  timestamp: number;
  category: string;
  title: string;
  content: string;
  impactSentiment: 'bullish' | 'bearish' | 'neutral';
  affectedCommodities: string[];
}

export type BotType =
  | 'trend_following' // 1. 트렌드추종형
  | 'mean_reversion'  // 2. 평균회귀형
  | 'hedger'          // 3. 헤저(실수요형)
  | 'market_maker'    // 4. 마켓메이커
  | 'news_trader';    // 5. 뉴스트레이더

export interface BotConfig {
  id: string;
  name: string;
  type: BotType;
  capital: number;
  riskTolerance: number;   // 0.1 ~ 1.0
  positionLimit: number;   // 계약 수 캡
  reactionDelay: number;   // 지연 틱 수 (0: 즉각, 1~5: 지연 반영)
  stopLossPct?: number;    // 손절 기준 (예: -0.05)
  takeProfitPct?: number;  // 익절 기준 (예: 0.10)
}

export interface BotMarketSnapshot {
  tick: number;
  commodities: Record<string, { currentPrice: number; high: number; low: number; volume: number }>;
  activeEvents: ActiveCommodityEvent[];
}

export interface BotState {
  config: BotConfig;
  currentCapital: number;
  positions: Record<string, { quantity: number; avgEntryPrice: number }>;
  realizedPnL: number;
  totalTrades: number;
}
