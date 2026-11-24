import type { ClockState } from '../engine/simulation/simClock';
import type { MarketEvent } from '../engine/simulation/marketEventTypes';
import { COMMODITY_DEFINITIONS } from '../commodities/definitions';
import { isUsdQuotedAsset } from '../engine/currency';
import type { ExchangeRateRecord } from '../repositories/types';

// ── 고정 UUID 규격 (Production 스키마 완벽 호환) ──
export const GUEST_USER_ID = '00000000-0000-4000-8000-000000000001';
export const K200_INDEX_UNDERLYING_ID = 'idx_k200';
export const K200_INDEX_BASE_VALUE = 260.0;
let nextMemoryDbInstanceSeq = 0;

/**
 * 국내 주식(domestic) 시가총액 가중 변동률 기반 KOSPI200 기준 지수(260.0 기준) 산출.
 */
export function computeK200IndexPrice(stocks: Iterable<StockRecord>): number {
  let prevCapSum = 0;
  let currCapSum = 0;
  for (const s of stocks) {
    if (s.market !== 'domestic') continue;
    if (s.is_listed === false) continue;
    const shares = Number(s.shares_outstanding || 1_000_000);
    const cur = Number(s.current_price);
    const prev = Number(s.previous_close || cur);
    if (!Number.isFinite(cur) || cur <= 0 || !Number.isFinite(prev) || prev <= 0 || !Number.isFinite(shares) || shares <= 0) {
      continue;
    }
    prevCapSum += prev * shares;
    currCapSum += cur * shares;
  }
  if (prevCapSum <= 0) return K200_INDEX_BASE_VALUE;
  const ratio = Math.max(0.5, Math.min(1.5, currCapSum / prevCapSum));
  return Math.round(K200_INDEX_BASE_VALUE * ratio * 100) / 100;
}

export const STOCK_UUID_MAP: Record<string, string> = {
  '0010': '00000000-0000-4000-8000-000000000101', // 오성전자
  '0015': '00000000-0000-4000-8000-000000000102', // 미래자동차
  '0020': '00000000-0000-4000-8000-000000000103', // 에코에너지
  '0025': '00000000-0000-4000-8000-000000000104', // NVC
  '0030': '00000000-0000-4000-8000-000000000105', // KKA
  '000660': '00000000-0000-4000-8000-000000000106', // SK하이닉스
  '035420': '00000000-0000-4000-8000-000000000107', // NAVER
  '035720': '00000000-0000-4000-8000-000000000108', // 카카오
  '105560': '00000000-0000-4000-8000-000000000109', // KB금융
  '068270': '00000000-0000-4000-8000-000000000110', // 셀트리온
  '017670': '00000000-0000-4000-8000-000000000111', // SK텔레콤
  '005930': '00000000-0000-4000-8000-000000000112', // 삼성전자
  '005380': '00000000-0000-4000-8000-000000000113', // 현대차
  'AAPL': '00000000-0000-4000-8000-000000000201', // 파인애플
  'MSFT': '00000000-0000-4000-8000-000000000202', // 매크로소프트
  'NVDA': '00000000-0000-4000-8000-000000000203', // 엔비디아스
  'TSLA': '00000000-0000-4000-8000-000000000204', // 와트 모빌리티
  'GOOGL': '00000000-0000-4000-8000-000000000205', // 구골
  'ASML': '00000000-0000-4000-8000-000000000301', // ADML
  'SAP': '00000000-0000-4000-8000-000000000302', // SAP 넥스트
  'KODEX200': '00000000-0000-4000-8000-000000000401',
  'KODEXLEV': '00000000-0000-4000-8000-000000000402',
  'KODEXINV': '00000000-0000-4000-8000-000000000403',
  'SPY': '00000000-0000-4000-8000-000000000404',
  'QQQ': '00000000-0000-4000-8000-000000000405',
  'TQQQ': '00000000-0000-4000-8000-000000000406',
  'KODEXINV2X': '00000000-0000-4000-8000-000000000407',
  'KODEXSEMI': '00000000-0000-4000-8000-000000000408',
  'TIGERBAT': '00000000-0000-4000-8000-000000000409',
  'TSLL': '00000000-0000-4000-8000-000000000410',
  'NVDL': '00000000-0000-4000-8000-000000000411',
  'EWJ': '00000000-0000-4000-8000-000000000412',
  'FXI': '00000000-0000-4000-8000-000000000413',
};

export interface StockRecord {
  target_price?: number;
  id: string;
  ticker: string;
  name: string;
  market: string;
  currency?: 'KRW' | 'USD';
  current_price: number;
  previous_close: number;
  open_price: number;
  high: number;
  low: number;
  volume: number;
  change_rate: number;
  market_cap: number;
  pe_ratio: number;
  dividend_yield: number;
  sector: string;
  is_listed?: boolean;
  is_core?: boolean;
  // 구조적 유동성 & 메타데이터 (하위 호환 및 fallback 지원)
  shares_outstanding?: number;     // 총 발행주식 수
  floating_shares?: number;        // 유통주식 수
  sector_id?: string;              // 정규화된 섹터 ID ('semiconductor' | 'auto' | 'energy' | 'it' | 'telecom' | 'finance' | 'bio' | 'index')
  theme_ids?: string[];            // 테마 태그 목록 (예: ['ai', 'tech'])
  base_liquidity?: number;         // 평상시 유동성 등급 (0.0 ~ 1.0)
  base_spread_bps?: number;        // 평상시 기준 스프레드 (basis points, e.g. 10 = 0.10%)
  base_depth_shares?: number;      // 평상시 레벨당 기본 호가 깊이 (shares)
  institutional_fit?: number;      // 기관 투자 적합도 (0.0 ~ 1.0)
  macro_exposure?: Record<string, number>; // 거시 변수 노출도 (e.g. { interest_rate: -0.3, growth: 1.0 })
  // 하위 호환용 optional alias
  high_price?: number;
  low_price?: number;
}

export interface StockPriceHistoryRecord {
  id: string;
  stock_id: string;
  price: number;
  recorded_at: string;
}

export interface CommodityRecord {
  id: string;
  commodity_id: string;
  ticker: string;
  name: string;
  category: string;
  current_price: number;
  previous_close: number;
  unit: string;
  tick_size: number;
  volume: number;
  open_price: number;
  high_price: number;
  low_price: number;
}

export interface ProfileRecord {
  id: string;
  user_id: string;
  username: string;
  nickname: string;
  email?: string;
  cash: number;
  net_worth: number;
  rank_tier: string;
  usd_balance?: number;
  eur_balance?: number;
  jpy_balance?: number;
  cny_balance?: number;
  gbp_balance?: number;
  is_admin?: boolean;
  has_options_license?: boolean;
  margin_debt_krw?: number;
  unlocked_features?: string[];
  feature_expiries?: Record<string, string>;
  news_subscriptions?: Record<string, string>;
  acquired_passives?: string[];
  created_at: string;
}

export interface CommodityPositionRecord {
  id: string;
  user_id: string;
  commodity_id: string;
  side: 'long' | 'short' | 'flat';
  quantity: number;
  avg_entry_price: number;
  reserved_margin_krw: number;
  realized_pnl_krw: number;
  updated_at: string;
}

export interface CommodityMarginReservation {
  order_id: string;
  user_id: string;
  commodity_id: string;
  side: 'buy' | 'sell';
  total_size: number;
  remaining_size: number;
  margin_per_contract_krw: number;
  reserved_krw: number;
  status: 'open' | 'partial' | 'filled' | 'cancelled' | 'expired';
  created_at: string;
}

export interface CommoditySettlementEntry {
  id: string;
  commodity_id: string;
  tick: number;
  settled_at: string;
}

export interface PersistedCommodityOrder {
  id: string;
  commodityId: string;
  botId?: string | undefined;
  userId?: string | undefined;
  side: 'buy' | 'sell';
  type: 'limit' | 'market';
  price: number;
  size: number;
  filled: number;
  createdAtTick: number;
  createdAtTime: number;
}

export interface HoldingRecord {
  id: string;
  user_id: string;
  stock_id: string;
  quantity: number;
  avg_price: number;
  created_at: string;
}

export interface OrderRecord {
  id: string;
  stock_id: string;
  user_id?: string | null;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  filled: number;
  status: 'open' | 'partial' | 'filled' | 'cancelled' | 'expired';
  is_lp: boolean;
  created_at: string;
  originalQuantity?: number;
  filledQuantity?: number;
  remainingQuantity?: number;
  remaining?: number;
  version?: number;
  // ABM participant & sequencing fields
  participantId?: string;
  participantKind?: string;
  strategyId?: string;
  orderType?: string;
  participant_type?: 'human' | 'bot' | 'lp';
  account_id?: string;
  agent_id?: string;
  order_type?: 'limit' | 'ioc';
  sequence?: number;
  simulation_time?: number;
}

export interface TradeRecord {
  id: string;
  stock_id: string;
  buyer_id?: string | null;
  seller_id?: string | null;
  buy_order_id?: string;
  sell_order_id?: string;
  buyer_is_bot: boolean;
  seller_is_bot: boolean;
  price: number;
  size: number;
  buyer_fee?: number;
  seller_fee?: number;
  created_at: string;
  sequence?: number;
  cursor?: number;
  simulation_time?: number;
}

export interface OptionContractRecord {
  id: string;
  underlying_stock_id: string;
  ticker: string;
  asset_class?: string;
  type: 'CALL' | 'PUT';
  option_type?: 'CALL' | 'PUT';
  strike_price: number;
  current_price: number;
  expiry_date: string;
  open_interest?: number;
  volume?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  implied_volatility?: number;
  multiplier?: number;
  created_at?: string;
  // Optional schema aliases
  underlying_asset_id?: string;
  stock_id?: string;
}

export interface BondRecord {
  id: string;
  ticker: string;
  name: string;
  bond_type: string;
  maturity: string;
  maturity_date?: string;
  coupon_rate: number;
  face_value: number;
  quote_base?: number;
  payments_per_year?: number;
  current_price: number;
  ytm: number;
  duration: number;
  volume: number;
}

function compareMarketNews(a: MarketNewsRecord, b: MarketNewsRecord): number {
  const time = (news: MarketNewsRecord) => Date.parse(news.created_at ?? '') || 0;
  return time(a) - time(b) || Number(a.sequence ?? 0) - Number(b.sequence ?? 0);
}

export interface MarketNewsRecord {
  id: string;
  type: string;
  category: 'OFFICIAL' | 'RUMOR' | 'CORRECTION';
  publisher: string;
  title: string;
  content: string;
  target_sector?: string | null;
  target_ticker?: string | null;
  impact_score?: number;
  is_fake?: boolean;
  original_rumor_id?: string | null;
  correction_due_simulation_time?: number;
  simulation_time?: number;
  sequence?: number;
  created_at: string;
}

export interface DeterministicIdGenerator {
  nextId(prefix?: string): string;
}

/**
 * Authoritative settlement ledger entry (성공적으로 커밋된 정산 1건).
 * fee rate(비율)와 fee amount(금액)를 모두 보관하여 단위 혼동을 제거한다.
 * 양수 rate = 수수료 차감, 음수 rate = 리베이트 지급.
 */
export interface SettlementLedgerEntry {
  readonly trade_id: string;
  readonly stock_id: string;
  readonly price: number;
  readonly size: number;
  readonly total_amount: number;
  readonly buyer_fee_rate: number;
  readonly seller_fee_rate: number;
  readonly buyer_fee_amount: number;
  readonly seller_fee_amount: number;
  readonly settled_at: string;
  readonly simulation_time?: number;
  readonly sequence?: number;
}

export class SequentialIdGenerator implements DeterministicIdGenerator {
  private counter: number = 0;
  constructor(private readonly baseSeed: number = 0) {}

  public nextId(prefix: string = 'id'): string {
    this.counter += 1;
    return `${prefix}_${this.baseSeed}_${this.counter.toString().padStart(6, '0')}`;
  }

  public getSnapshot(): number {
    return this.counter;
  }

  public restoreSnapshot(snapshot: number): void {
    this.counter = snapshot;
  }
}

export interface DatabaseExecutionContext {
  readonly clock: { now(): number };
  readonly idGenerator: DeterministicIdGenerator;
}

export class MemoryDatabase {
  // ── 1. 기본 엔티티 스토어 (Primary Maps) ──
  public stocks: Map<string, StockRecord> = new Map();
  public stockPriceHistory: StockPriceHistoryRecord[] = [];
  public commodities: Map<string, CommodityRecord> = new Map();
  public profiles: Map<string, ProfileRecord> = new Map();
  public holdings: Map<string, HoldingRecord> = new Map();
  public orders: Map<string, OrderRecord> = new Map();
  public trades: TradeRecord[] = [];
  public optionsContracts: Map<string, OptionContractRecord> = new Map();
  public bonds: Map<string, BondRecord> = new Map();
  public marketNews: MarketNewsRecord[] = [];
  public pendingAdminMarketEvents: MarketEvent[] = [];
  public localSimulationClock: ClockState | null = null;

  public saveMarketNews(record: MarketNewsRecord): void {
    const index = this.marketNews.findIndex((news) => news.id === record.id);
    if (index >= 0) this.marketNews.splice(index, 1);
    this.marketNews.push(record);
    this.marketNews.sort(compareMarketNews);
    if (this.marketNews.length > 200) this.marketNews.splice(0, this.marketNews.length - 200);
  }
  public adminSettings: Map<string, any> = new Map();
  public exchangeRates: ExchangeRateRecord[] = [];
  public institutionalPortfolios: Map<string, any> = new Map();
  public playerEvents: any[] = [];
  public activePlayerEvents: any[] = [];
  public activeManipulations: any[] = [];
  public scenarioRuntimeState: any = null;
  public scenarioResetVersion: number = 0;
  public commodityEventRuntimeState: any = null;
  public botsConfig: any[] = [];
  public optionSettlements: any[] = [];
  public bondCouponPayments: any[] = [];
  public lpAccounts: Set<string> = new Set(['bot_as_mm_001', 'AS_MARKET_MAKER', 'bot_options_mm_001', 'lp_market_maker']);
  public lpQuoteGeneration: number = 0;
  public lpLiabilities: Map<string, number> = new Map();
  /**
   * Authoritative settlement ledger.
   * 정산 성공한 trade ID를 데이터 계층이 유일 권위로 보유한다.
   * repository 인스턴스를 재생성해도 이 원장 덕분에 중복 정산이 차단된다.
   */
  public settlementLedger: Map<string, SettlementLedgerEntry> = new Map();
  public settlementLedgerCutoffMs: number = 0;
  public settledEpochWatermarks: Map<number, number> = new Map();
  public settledEpochIntervals: Map<number, Array<[number, number]>> = new Map();
  public settledOptionEpochWatermarks: Map<number, number> = new Map();
  public settledOptionEpochIntervals: Map<number, Array<[number, number]>> = new Map();
  public settledDeterministicWatermarks: Map<string, number> = new Map();
  public settledDeterministicIntervals: Map<string, Array<[number, number]>> = new Map();
  public settledBondCouponIntervals: Map<string, Array<[string, string]>> = new Map();
  public settledBondCouponQuarterIntervals: Map<string, Array<[string, string]>> = new Map();
  public settledBondRedemptions: Set<string> = new Set();
  public settledBondRedemptionWatermarkYm: string = '';
  public settledBondRedemptionWatermarkYq: string = '';
  public settledOptionExpiryKeys: Set<string> = new Set();
  public settledOptionExpiryWatermarkYmd: string = '';
  public evictedCustomTradeIds: Set<string> = new Set();
  private readonly tradeInstanceToken: string = `db_${++nextMemoryDbInstanceSeq}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  public tradeGenerationCounter: number = 1;
  public tradeEpoch: number = 1;
  public tradeSeq: number = 0;
  public tradeCursorSeq: number = 0;

  public getTradeStreamGeneration(): string {
    return `${this.tradeInstanceToken}:${this.tradeEpoch}:${this.tradeGenerationCounter}`;
  }
  public optionTradeSeq: number = 0;
  public engineNextEpoch: number = 1;
  public engineTickCount: number = 0;
  public enginePartialFillSequence: number = 0;
  public commodityPositions: Map<string, CommodityPositionRecord> = new Map();
  public commodityMarginReservations: Map<string, CommodityMarginReservation> = new Map();
  public commoditySettlementLedger: Map<string, CommoditySettlementEntry> = new Map();
  public commodityOpenOrders: Map<string, PersistedCommodityOrder> = new Map();
  public commoditySettledEpochWatermarks: Map<number, number> = new Map();
  public commoditySettledEpochIntervals: Map<number, Array<[number, number]>> = new Map();
  public commodityEvictedCustomTradeIds: Set<string> = new Set();
  public commodityNextEpoch: number = 1;
  public commodityCurrentTick: number = 0;
  public commodityUserOrderSeq: number = 0;
  public commodityTradeSeq: number = 0;
  public commodityResetVersion: number = 0;
  public commoditySnapshotVersion: number = 0;

  public isTradingHalted(): boolean {
    const setting = this.adminSettings.get('1') ?? Array.from(this.adminSettings.values())[0];
    return Boolean(setting?.trading_halt);
  }

  public isAuthorizedLp(id: string): boolean {
    if (!id) return false;
    if (this.lpAccounts.has(id)) return true;
    return this.botsConfig.some((b: any) =>
      (b.bot_id === id || b.id === id) &&
      (b.participant_kind === 'LIQUIDITY_PROVIDER' || b.participantKind === 'LIQUIDITY_PROVIDER' || b.type === 'OPTIONS_MM')
    );
  }

  // ── 2. 보조 인덱스 계층 (Secondary Indexes for O(1) Lookups) ──
  public tickerIndex: Map<string, string> = new Map(); // ticker -> stockId
  public marketIndex: Map<string, Set<string>> = new Map(); // market -> Set<stockId>
  public commodityTickerIndex: Map<string, string> = new Map(); // ticker -> commodityId
  public commodityCategoryIndex: Map<string, Set<string>> = new Map(); // category -> Set<commodityId>
  public orderStockIndex: Map<string, Set<string>> = new Map(); // stock_id -> Set<orderId>
  public orderUserIndex: Map<string, Set<string>> = new Map(); // user_id -> Set<orderId>
  public tradeStockIndex: Map<string, TradeRecord[]> = new Map(); // stock_id -> TradeRecord[]
  public holdingUserIndex: Map<string, Set<string>> = new Map(); // user_id -> Set<holdingId>
  public profileUserIdIndex: Map<string, string> = new Map(); // user_id -> profileId

  // ── 3. 동시성 원자적 업데이트 락 큐 ──
  private lockQueues: Map<string, Promise<any>> = new Map();

  // ── 4. Pub/Sub 리스너 ──
  private listeners: Map<string, Set<(payload: any) => void>> = new Map();
  private symbolListeners: Map<string, Set<(payload: any) => void>> = new Map();

  private fallbackCounter: number = 0;

  constructor(public readonly executionContext?: DatabaseExecutionContext) {
    this.seedDefaultData();
    this.rebuildIndexes();
  }

  public getNowMs(): number {
    return this.executionContext ? this.executionContext.clock.now() : Date.now();
  }

  public getIsoTimestamp(): string {
    return new Date(this.getNowMs()).toISOString();
  }

  public generateId(prefix: string = 'id'): string {
    if (this.executionContext) {
      return this.executionContext.idGenerator.nextId(prefix);
    }
    this.fallbackCounter += 1;
    return `${prefix}_e${this.tradeEpoch}_${this.fallbackCounter.toString().padStart(6, '0')}`;
  }

  /**
   * 단조 증가 에포크 기반 체결 ID 할당기 (trimSettlementLedger에서 워터마크 O(1) 압축 가능).
   */
  public nextMonotonicTradeId(kind: 'tr' | 'opt_tr' = 'tr'): string {
    if (kind === 'opt_tr') {
      this.optionTradeSeq += 1;
      return `opt_tr_e${this.tradeEpoch}_${this.optionTradeSeq}`;
    }
    this.tradeSeq += 1;
    return `tr_e${this.tradeEpoch}_${this.tradeSeq}`;
  }

  public snapshotIdGenerator(): unknown {
    if (this.executionContext && typeof (this.executionContext.idGenerator as any).getSnapshot === 'function') {
      return (this.executionContext.idGenerator as any).getSnapshot();
    }
    return this.fallbackCounter;
  }

  public restoreIdGenerator(snapshot: unknown): void {
    if (snapshot === null || snapshot === undefined) return;
    if (this.executionContext && typeof (this.executionContext.idGenerator as any).restoreSnapshot === 'function') {
      (this.executionContext.idGenerator as any).restoreSnapshot(snapshot);
    } else if (typeof snapshot === 'number') {
      this.fallbackCounter = snapshot;
    }
  }

  /**
   * 보조 인덱스 재구축 (초기화 및 스냅샷 복원 시 사용)
   */
  public rebuildIndexes(): void {
    this.ensureTradeCursors();
    this.tickerIndex.clear();
    this.marketIndex.clear();
    this.commodityTickerIndex.clear();
    this.commodityCategoryIndex.clear();
    this.orderStockIndex.clear();
    this.orderUserIndex.clear();
    this.tradeStockIndex.clear();
    this.holdingUserIndex.clear();
    this.profileUserIdIndex.clear();

    for (const s of this.stocks.values()) this.addStockToIndex(s);
    for (const c of this.commodities.values()) this.addCommodityToIndex(c);
    for (const o of this.orders.values()) this.addOrderToIndex(o);
    for (const t of this.trades) this.addTradeToIndex(t);
    for (const h of this.holdings.values()) this.addHoldingToIndex(h);
    for (const p of this.profiles.values()) this.addProfileToIndex(p);
  }

  // ── 인덱스 동기화 헬퍼 메서드 ──
  public addStockToIndex(s: StockRecord): void {
    if (s.ticker) this.tickerIndex.set(s.ticker.toUpperCase(), s.id);
    if (!this.marketIndex.has(s.market)) this.marketIndex.set(s.market, new Set());
    this.marketIndex.get(s.market)!.add(s.id);
  }

  public removeStockFromIndex(s: StockRecord): void {
    if (s.ticker) this.tickerIndex.delete(s.ticker.toUpperCase());
    const marketSet = this.marketIndex.get(s.market);
    if (marketSet) {
      marketSet.delete(s.id);
      if (marketSet.size === 0) {
        this.marketIndex.delete(s.market);
      }
    }
  }

  public addCommodityToIndex(c: CommodityRecord): void {
    if (c?.ticker) this.commodityTickerIndex.set(c.ticker.toUpperCase(), c.id);
    if (!this.commodityCategoryIndex.has(c.category)) this.commodityCategoryIndex.set(c.category, new Set());
    this.commodityCategoryIndex.get(c.category)!.add(c.id);
  }

  public addOrderToIndex(o: OrderRecord): void {
    if (!this.orderStockIndex.has(o.stock_id)) this.orderStockIndex.set(o.stock_id, new Set());
    this.orderStockIndex.get(o.stock_id)!.add(o.id);

    if (o.user_id) {
      if (!this.orderUserIndex.has(o.user_id)) this.orderUserIndex.set(o.user_id, new Set());
      this.orderUserIndex.get(o.user_id)!.add(o.id);
    }
  }

  public removeOrderFromIndex(o: OrderRecord): void {
    this.orderStockIndex.get(o.stock_id)?.delete(o.id);
    if (o.user_id) this.orderUserIndex.get(o.user_id)?.delete(o.id);
  }

  public appendTrade(t: TradeRecord): TradeRecord {
    if (typeof t.cursor !== 'number' || !Number.isFinite(t.cursor) || t.cursor <= 0) {
      this.tradeCursorSeq += 1;
      t.cursor = this.tradeCursorSeq;
    } else if (t.cursor > this.tradeCursorSeq) {
      this.tradeCursorSeq = t.cursor;
    }
    this.trades.push(t);
    this.addTradeToIndex(t);
    return t;
  }

  public ensureTradeCursors(): void {
    for (const t of this.trades) {
      if (typeof t.cursor === 'number' && Number.isFinite(t.cursor) && t.cursor > this.tradeCursorSeq) {
        this.tradeCursorSeq = t.cursor;
      }
    }
    for (const t of this.trades) {
      if (typeof t.cursor !== 'number' || !Number.isFinite(t.cursor) || t.cursor <= 0) {
        this.tradeCursorSeq += 1;
        t.cursor = this.tradeCursorSeq;
      }
    }
  }

  public addTradeToIndex(t: TradeRecord): void {
    if (!this.tradeStockIndex.has(t.stock_id)) this.tradeStockIndex.set(t.stock_id, []);
    this.tradeStockIndex.get(t.stock_id)!.push(t);
  }

  public addHoldingToIndex(h: HoldingRecord): void {
    if (!this.holdingUserIndex.has(h.user_id)) this.holdingUserIndex.set(h.user_id, new Set());
    this.holdingUserIndex.get(h.user_id)!.add(h.id);
  }

  public removeHoldingFromIndex(h: HoldingRecord): void {
    this.holdingUserIndex.get(h.user_id)?.delete(h.id);
  }

  public addProfileToIndex(p: ProfileRecord): void {
    if (p.user_id) {
      this.profileUserIdIndex.set(p.user_id, p.id);
    }
  }

  /**
   * 인증/주문 user_id 기준으로 단일 프로필을 안전하게 조회한다.
   * 레거시 스냅샷(profile.id !== profile.user_id)에서도 profileUserIdIndex를 우선 확인하며,
   * 다른 계정의 user_id가 붙어 있는 프로필과 ID 충돌 시 교차 접근을 허용하지 않는다.
   */
  public resolveProfileByUserId(userId: string): ProfileRecord | undefined {
    if (!userId) return undefined;
    const indexedId = this.profileUserIdIndex.get(userId);
    if (indexedId) {
      const indexedProfile = this.profiles.get(indexedId);
      if (indexedProfile && (indexedProfile.user_id === userId || (!indexedProfile.user_id && indexedProfile.id === userId))) {
        return indexedProfile;
      }
    }
    const direct = this.profiles.get(userId);
    if (direct && (!direct.user_id || direct.user_id === userId)) {
      return direct;
    }
    for (const p of this.profiles.values()) {
      if (p.user_id === userId) {
        this.addProfileToIndex(p);
        return p;
      }
    }
    return undefined;
  }

  /**
   * 계좌 잠금(withAccountLocks) 시 모든 경로가 동일한 정규 프로필 키(profile.id)를 사용하도록 반환한다.
   */
  public resolveAccountLockKey(userId: string): string {
    const profile = this.resolveProfileByUserId(userId);
    return profile ? profile.id : userId;
  }

  public ensureUserProfile(
    userId: string,
    initialData?: Partial<ProfileRecord>
  ): ProfileRecord {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new Error('userId is required to ensure user profile');
    }
    const existing = this.resolveProfileByUserId(userId);
    if (existing) return existing;

    const displayName = initialData?.username || initialData?.nickname || '익명 투자자';
    const requestedId =
      initialData?.id && typeof initialData.id === 'string' && initialData.id.trim()
        ? initialData.id
        : undefined;
    let pk =
      requestedId &&
      !this.profiles.has(requestedId) &&
      (requestedId === userId || !this.resolveProfileByUserId(requestedId))
        ? requestedId
        : (!this.profiles.has(userId) ? userId : this.generateId('prof'));
    while (this.profiles.has(pk) || (pk !== userId && this.resolveProfileByUserId(pk))) {
      pk = this.generateId('prof');
    }

    const profile: ProfileRecord = {
      id: pk,
      user_id: userId,
      username: displayName,
      nickname: displayName,
      email: initialData?.email,
      cash: initialData?.cash ?? 5000000,
      net_worth: initialData?.net_worth ?? 5000000,
      rank_tier: initialData?.rank_tier ?? 'Bronze',
      usd_balance: initialData?.usd_balance ?? 0,
      eur_balance: initialData?.eur_balance ?? 0,
      jpy_balance: initialData?.jpy_balance ?? 0,
      cny_balance: initialData?.cny_balance ?? 0,
      gbp_balance: initialData?.gbp_balance ?? 0,
      is_admin: initialData?.is_admin ?? false,
      unlocked_features: initialData?.unlocked_features ?? [],
      created_at: initialData?.created_at ?? this.getIsoTimestamp(),
    };
    this.profiles.set(pk, profile);
    this.addProfileToIndex(profile);
    return profile;
  }

  /**
   * [원자적 업데이트] 비동기 경계 간 race condition을 방지하는 키 단위 락 큐
   */
  public async updateAtomic<T>(key: string, updater: (prev: T) => T | Promise<T>): Promise<T> {
    const prevPromise = this.lockQueues.get(key) || Promise.resolve();

    const currentPromise = prevPromise
      .catch(() => undefined)
      .then(async () => {
        let currentVal: any = null;
        if (key.startsWith('profile:')) {
          const id = key.replace('profile:', '');
          currentVal = this.profiles.get(id);
        } else if (key.startsWith('holding:')) {
          const id = key.replace('holding:', '');
          currentVal = this.holdings.get(id);
        }

        const nextVal = await updater(currentVal);

        if (key.startsWith('profile:')) {
          const id = key.replace('profile:', '');
          if (nextVal) {
            this.profiles.set(id, nextVal as unknown as ProfileRecord);
            this.addProfileToIndex(nextVal as unknown as ProfileRecord);
          }
        } else if (key.startsWith('holding:')) {
          const id = key.replace('holding:', '');
          if (nextVal) {
            this.holdings.set(id, nextVal as unknown as HoldingRecord);
            this.addHoldingToIndex(nextVal as unknown as HoldingRecord);
          }
        }

        return nextVal;
      })
      .finally(() => {
        if (this.lockQueues.get(key) === currentPromise) {
          this.lockQueues.delete(key);
        }
      });

    this.lockQueues.set(key, currentPromise);
    return currentPromise;
  }

  private getDefaultStockDefinitions(): {
    ticker: string;
    name: string;
    market: string;
    current_price: number;
    previous_close: number;
    sector: string;
    sector_id: string;
    theme_ids: string[];
    is_core?: boolean;
    shares_outstanding: number;
    floating_shares: number;
    base_liquidity: number;
    base_spread_bps: number;
    base_depth_shares: number;
    institutional_fit: number;
    macro_exposure: Record<string, number>;
  }[] {
    return [
      // 국내 주요 종목
      { ticker: '0010', name: '오성전자', market: 'domestic', current_price: 72000, previous_close: 71500, sector: '반도체', sector_id: 'semiconductor', theme_ids: ['tech', 'ai', 'hardware'], is_core: true, shares_outstanding: 5969000000, floating_shares: 4500000000, base_liquidity: 0.95, base_spread_bps: 10, base_depth_shares: 1000, institutional_fit: 0.95, macro_exposure: { interest_rate: -0.3, growth: 1.2 } },
      { ticker: '0015', name: '미래자동차', market: 'domestic', current_price: 210000, previous_close: 209000, sector: '자동차', sector_id: 'auto', theme_ids: ['mobility', 'ev'], is_core: true, shares_outstanding: 213000000, floating_shares: 150000000, base_liquidity: 0.85, base_spread_bps: 15, base_depth_shares: 400, institutional_fit: 0.85, macro_exposure: { interest_rate: -0.5, growth: 0.9 } },
      { ticker: '0020', name: '에코에너지', market: 'domestic', current_price: 45000, previous_close: 44800, sector: '에너지', sector_id: 'energy', theme_ids: ['renewables', 'green'], is_core: false, shares_outstanding: 50000000, floating_shares: 25000000, base_liquidity: 0.30, base_spread_bps: 50, base_depth_shares: 100, institutional_fit: 0.30, macro_exposure: { oil_price: 1.2, interest_rate: -0.8 } },
      { ticker: '0025', name: 'NVC', market: 'domestic', current_price: 185000, previous_close: 184500, sector: 'IT', sector_id: 'it', theme_ids: ['cloud', 'software'], is_core: false, shares_outstanding: 80000000, floating_shares: 50000000, base_liquidity: 0.50, base_spread_bps: 35, base_depth_shares: 150, institutional_fit: 0.50, macro_exposure: { interest_rate: -0.6, growth: 1.1 } },
      { ticker: '0030', name: 'KKA', market: 'domestic', current_price: 52000, previous_close: 51800, sector: '통신', sector_id: 'telecom', theme_ids: ['telecom', 'infrastructure'], is_core: false, shares_outstanding: 120000000, floating_shares: 80000000, base_liquidity: 0.60, base_spread_bps: 25, base_depth_shares: 300, institutional_fit: 0.65, macro_exposure: { interest_rate: -0.2, defensive: 1.0 } },
      { ticker: '000660', name: 'SK하이닉스', market: 'domestic', current_price: 188500, previous_close: 185000, sector: '반도체', sector_id: 'semiconductor', theme_ids: ['tech', 'ai', 'semiconductor'], is_core: true, shares_outstanding: 728000000, floating_shares: 550000000, base_liquidity: 0.90, base_spread_bps: 12, base_depth_shares: 800, institutional_fit: 0.90, macro_exposure: { interest_rate: -0.3, tech_cycle: 1.3 } },
      { ticker: '035420', name: 'NAVER', market: 'domestic', current_price: 192000, previous_close: 194000, sector: '플랫폼', sector_id: 'it', theme_ids: ['platform', 'ai'], is_core: true, shares_outstanding: 164000000, floating_shares: 120000000, base_liquidity: 0.80, base_spread_bps: 18, base_depth_shares: 350, institutional_fit: 0.85, macro_exposure: { interest_rate: -0.5, growth: 1.0 } },
      { ticker: '035720', name: '카카오', market: 'domestic', current_price: 43500, previous_close: 43000, sector: '플랫폼', sector_id: 'it', theme_ids: ['platform', 'fintech'], is_core: false, shares_outstanding: 445000000, floating_shares: 300000000, base_liquidity: 0.70, base_spread_bps: 22, base_depth_shares: 400, institutional_fit: 0.70, macro_exposure: { interest_rate: -0.7, growth: 0.9 } },
      { ticker: '105560', name: 'KB금융', market: 'domestic', current_price: 78000, previous_close: 77500, sector: '금융', sector_id: 'finance', theme_ids: ['banking', 'dividend'], is_core: true, shares_outstanding: 403000000, floating_shares: 320000000, base_liquidity: 0.85, base_spread_bps: 15, base_depth_shares: 600, institutional_fit: 0.90, macro_exposure: { interest_rate: 0.8, defensive: 0.7 } },
      { ticker: '068270', name: '셀트리온', market: 'domestic', current_price: 182000, previous_close: 181000, sector: '바이오', sector_id: 'bio', theme_ids: ['healthcare', 'biosimilar'], is_core: true, shares_outstanding: 216000000, floating_shares: 160000000, base_liquidity: 0.75, base_spread_bps: 20, base_depth_shares: 300, institutional_fit: 0.75, macro_exposure: { interest_rate: -0.6, growth: 1.2 } },
      { ticker: '017670', name: 'SK텔레콤', market: 'domestic', current_price: 53000, previous_close: 52800, sector: '통신', sector_id: 'telecom', theme_ids: ['telecom', 'dividend'], is_core: false, shares_outstanding: 218000000, floating_shares: 150000000, base_liquidity: 0.65, base_spread_bps: 20, base_depth_shares: 450, institutional_fit: 0.75, macro_exposure: { interest_rate: -0.1, defensive: 1.1 } },
      { ticker: '005930', name: '삼성전자', market: 'domestic', current_price: 74200, previous_close: 73500, sector: '반도체', sector_id: 'semiconductor', theme_ids: ['tech', 'ai', 'hardware'], is_core: true, shares_outstanding: 5969000000, floating_shares: 4500000000, base_liquidity: 0.95, base_spread_bps: 10, base_depth_shares: 1000, institutional_fit: 0.95, macro_exposure: { interest_rate: -0.3, growth: 1.2 } },
      { ticker: '005380', name: '현대차', market: 'domestic', current_price: 245000, previous_close: 242000, sector: '자동차', sector_id: 'auto', theme_ids: ['mobility', 'ev'], is_core: true, shares_outstanding: 213000000, floating_shares: 150000000, base_liquidity: 0.85, base_spread_bps: 15, base_depth_shares: 400, institutional_fit: 0.85, macro_exposure: { interest_rate: -0.5, growth: 0.9 } },
      // 해외 종목 (미국)
      { ticker: 'AAPL', name: '파인애플', market: 'overseas', current_price: 185.5, previous_close: 185.2, sector: 'IT', sector_id: 'it', theme_ids: ['consumer_tech', 'hardware'], is_core: true, shares_outstanding: 15400000000, floating_shares: 15000000000, base_liquidity: 0.98, base_spread_bps: 5, base_depth_shares: 2000, institutional_fit: 0.99, macro_exposure: { interest_rate: -0.3, growth: 1.1 } },
      { ticker: 'MSFT', name: '매크로소프트', market: 'overseas', current_price: 425.3, previous_close: 424.0, sector: '소프트웨어', sector_id: 'it', theme_ids: ['cloud', 'ai', 'software'], is_core: true, shares_outstanding: 7430000000, floating_shares: 7200000000, base_liquidity: 0.97, base_spread_bps: 6, base_depth_shares: 1800, institutional_fit: 0.98, macro_exposure: { interest_rate: -0.4, growth: 1.3 } },
      { ticker: 'NVDA', name: '엔비디아스', market: 'overseas', current_price: 875.2, previous_close: 870.5, sector: '반도체', sector_id: 'semiconductor', theme_ids: ['ai', 'gpu', 'semiconductor'], is_core: true, shares_outstanding: 2460000000, floating_shares: 2300000000, base_liquidity: 0.99, base_spread_bps: 5, base_depth_shares: 2500, institutional_fit: 0.99, macro_exposure: { interest_rate: -0.5, growth: 1.8 } },
      { ticker: 'TSLA', name: '와트 모빌리티', market: 'overseas', current_price: 248.5, previous_close: 247.8, sector: '자동차', sector_id: 'auto', theme_ids: ['ev', 'autonomy'], is_core: false, shares_outstanding: 3180000000, floating_shares: 2800000000, base_liquidity: 0.95, base_spread_bps: 8, base_depth_shares: 1500, institutional_fit: 0.90, macro_exposure: { interest_rate: -0.9, growth: 1.5 } },
      { ticker: 'GOOGL', name: '구골', market: 'overseas', current_price: 141.2, previous_close: 140.9, sector: 'IT', sector_id: 'it', theme_ids: ['search', 'ai', 'cloud'], is_core: false, shares_outstanding: 12300000000, floating_shares: 11000000000, base_liquidity: 0.96, base_spread_bps: 6, base_depth_shares: 1800, institutional_fit: 0.97, macro_exposure: { interest_rate: -0.4, growth: 1.2 } },
      // 유럽 종목
      { ticker: 'ASML', name: 'ADML', market: 'europe', current_price: 705.4, previous_close: 703.2, sector: '반도체', sector_id: 'semiconductor', theme_ids: ['lithography', 'semiconductor'], is_core: true, shares_outstanding: 393000000, floating_shares: 380000000, base_liquidity: 0.88, base_spread_bps: 12, base_depth_shares: 500, institutional_fit: 0.95, macro_exposure: { interest_rate: -0.4, growth: 1.3 } },
      { ticker: 'SAP', name: 'SAP 넥스트', market: 'europe', current_price: 175.3, previous_close: 174.8, sector: '소프트웨어', sector_id: 'it', theme_ids: ['erp', 'enterprise'], is_core: false, shares_outstanding: 1230000000, floating_shares: 1100000000, base_liquidity: 0.80, base_spread_bps: 15, base_depth_shares: 600, institutional_fit: 0.90, macro_exposure: { interest_rate: -0.3, growth: 1.0 } },
      // ETF
      { ticker: 'KODEX200', name: 'KODEX 200', market: 'etf', current_price: 35000, previous_close: 35000, sector: 'Index ETF', sector_id: 'index', theme_ids: ['korea', 'index'], is_core: false, shares_outstanding: 250000000, floating_shares: 250000000, base_liquidity: 0.95, base_spread_bps: 8, base_depth_shares: 1500, institutional_fit: 0.95, macro_exposure: { market_beta: 1.0 } },
      { ticker: 'KODEXLEV', name: 'KODEX 레버리지', market: 'etf', current_price: 17000, previous_close: 17000, sector: 'Leverage ETF', sector_id: 'index', theme_ids: ['korea', 'leverage'], is_core: false, shares_outstanding: 300000000, floating_shares: 300000000, base_liquidity: 0.92, base_spread_bps: 10, base_depth_shares: 1200, institutional_fit: 0.70, macro_exposure: { market_beta: 2.0 } },
      { ticker: 'KODEXINV', name: 'KODEX 인버스', market: 'etf', current_price: 4500, previous_close: 4500, sector: 'Inverse ETF', sector_id: 'index', theme_ids: ['korea', 'inverse'], is_core: false, shares_outstanding: 400000000, floating_shares: 400000000, base_liquidity: 0.90, base_spread_bps: 10, base_depth_shares: 1500, institutional_fit: 0.70, macro_exposure: { market_beta: -1.0 } },
      { ticker: 'SPY', name: 'SPDR S&P 500', market: 'etf', current_price: 500.0, previous_close: 500.0, sector: 'Index ETF', sector_id: 'index', theme_ids: ['us', 'index'], is_core: false, shares_outstanding: 900000000, floating_shares: 900000000, base_liquidity: 0.99, base_spread_bps: 2, base_depth_shares: 5000, institutional_fit: 0.99, macro_exposure: { market_beta: 1.0 } },
      { ticker: 'QQQ', name: 'Invesco QQQ', market: 'etf', current_price: 430.0, previous_close: 430.0, sector: 'Index ETF', sector_id: 'index', theme_ids: ['us', 'tech_index'], is_core: false, shares_outstanding: 600000000, floating_shares: 600000000, base_liquidity: 0.99, base_spread_bps: 3, base_depth_shares: 4000, institutional_fit: 0.99, macro_exposure: { market_beta: 1.2 } },
      { ticker: 'TQQQ', name: 'ProShares UltraPro QQQ', market: 'etf', current_price: 60.0, previous_close: 60.0, sector: 'Leverage ETF', sector_id: 'index', theme_ids: ['us', 'leverage'], is_core: false, shares_outstanding: 500000000, floating_shares: 500000000, base_liquidity: 0.96, base_spread_bps: 5, base_depth_shares: 3000, institutional_fit: 0.60, macro_exposure: { market_beta: 3.0 } },
      { ticker: 'KODEXINV2X', name: 'KODEX 200선물인버스2X (곱버스 -2X)', market: 'etf', current_price: 2500, previous_close: 2500, sector: 'Leverage ETF', sector_id: 'index', theme_ids: ['korea', 'inverse', 'leverage'], is_core: false, shares_outstanding: 400000000, floating_shares: 400000000, base_liquidity: 0.92, base_spread_bps: 10, base_depth_shares: 1500, institutional_fit: 0.65, macro_exposure: { market_beta: -2.0 } },
      { ticker: 'KODEXSEMI', name: 'KODEX 반도체', market: 'etf', current_price: 32000, previous_close: 32000, sector: 'Sector ETF', sector_id: 'semiconductor', theme_ids: ['korea', 'semiconductor'], is_core: false, shares_outstanding: 150000000, floating_shares: 150000000, base_liquidity: 0.90, base_spread_bps: 10, base_depth_shares: 1000, institutional_fit: 0.85, macro_exposure: { market_beta: 1.1 } },
      { ticker: 'TIGERBAT', name: 'TIGER 2차전지테마', market: 'etf', current_price: 25000, previous_close: 25000, sector: 'Sector ETF', sector_id: 'energy', theme_ids: ['korea', 'battery'], is_core: false, shares_outstanding: 160000000, floating_shares: 160000000, base_liquidity: 0.88, base_spread_bps: 12, base_depth_shares: 900, institutional_fit: 0.80, macro_exposure: { market_beta: 1.2 } },
      { ticker: 'TSLL', name: 'Direxion Daily TSLA Bull 2X (테슬라 2X)', market: 'etf', current_price: 10.0, previous_close: 10.0, sector: 'Leverage ETF', sector_id: 'auto', theme_ids: ['us', 'ev', 'leverage'], is_core: false, shares_outstanding: 300000000, floating_shares: 300000000, base_liquidity: 0.94, base_spread_bps: 8, base_depth_shares: 2500, institutional_fit: 0.55, macro_exposure: { market_beta: 2.0 } },
      { ticker: 'NVDL', name: 'GraniteShares 2x Long NVDA (엔비디아 2X)', market: 'etf', current_price: 45.0, previous_close: 45.0, sector: 'Leverage ETF', sector_id: 'semiconductor', theme_ids: ['us', 'ai', 'leverage'], is_core: false, shares_outstanding: 250000000, floating_shares: 250000000, base_liquidity: 0.95, base_spread_bps: 6, base_depth_shares: 2000, institutional_fit: 0.60, macro_exposure: { market_beta: 2.2 } },
      { ticker: 'EWJ', name: 'iShares MSCI Japan ETF (일본)', market: 'etf', current_price: 70.0, previous_close: 70.0, sector: 'Index ETF', sector_id: 'index', theme_ids: ['global', 'japan'], is_core: false, shares_outstanding: 200000000, floating_shares: 200000000, base_liquidity: 0.92, base_spread_bps: 5, base_depth_shares: 2000, institutional_fit: 0.90, macro_exposure: { market_beta: 0.9 } },
      { ticker: 'FXI', name: 'iShares China Large-Cap ETF (중국)', market: 'etf', current_price: 25.0, previous_close: 25.0, sector: 'Index ETF', sector_id: 'index', theme_ids: ['global', 'china'], is_core: false, shares_outstanding: 240000000, floating_shares: 240000000, base_liquidity: 0.91, base_spread_bps: 6, base_depth_shares: 2000, institutional_fit: 0.85, macro_exposure: { market_beta: 0.95 } },
    ];
  }

  private buildDefaultStockRecord(
    s: ReturnType<MemoryDatabase['getDefaultStockDefinitions']>[number],
    idx: number
  ): StockRecord {
    const id = STOCK_UUID_MAP[s.ticker] || `00000000-0000-4000-8000-${(1000 + idx).toString().padStart(12, '0')}`;
    const cp = s.current_price;
    const pc = s.previous_close;
    const cr = parseFloat((((cp - pc) / pc) * 100).toFixed(2));
    return {
      id,
      ticker: s.ticker,
      name: s.name,
      market: s.market,
      currency: isUsdQuotedAsset({ market: s.market, ticker: s.ticker }) ? 'USD' : 'KRW',
      current_price: cp,
      previous_close: pc,
      open_price: pc,
      high: Math.max(cp, pc) * 1.015,
      low: Math.min(cp, pc) * 0.985,
      high_price: Math.max(cp, pc) * 1.015,
      low_price: Math.min(cp, pc) * 0.985,
      volume: 154000 + idx * 12000,
      change_rate: cr,
      market_cap: Math.round(cp * s.shares_outstanding),
      pe_ratio: 15.4,
      dividend_yield: 2.1,
      sector: s.sector,
      sector_id: s.sector_id,
      theme_ids: s.theme_ids,
      is_listed: true,
      is_core: s.is_core ?? false,
      shares_outstanding: s.shares_outstanding,
      floating_shares: s.floating_shares,
      base_liquidity: s.base_liquidity,
      base_spread_bps: s.base_spread_bps,
      base_depth_shares: s.base_depth_shares,
      institutional_fit: s.institutional_fit,
      macro_exposure: s.macro_exposure,
    };
  }

  private seedInitialStockHistory(record: StockRecord, idx: number, nowMs: number): void {
    const cp = record.current_price;
    const isUsd = isUsdQuotedAsset(record);
    for (let h = 20; h >= 0; h--) {
      const randJitter = Math.sin(h * 0.5 + idx) * 0.008;
      const raw = cp * (1 + randJitter);
      const p = isUsd ? Math.round(raw * 100) / 100 : Math.round(raw);
      this.stockPriceHistory.push({
        id: `hist_${record.id}_${h}`,
        stock_id: record.id,
        price: p,
        recorded_at: new Date(nowMs - h * 60000).toISOString(),
      });
    }
  }

  private getK200ChainTemplates(): Array<[number, number, number]> {
    return [
      [290.0, 0.01, 30.90], [287.5, 0.01, 28.35], [285.0, 0.01, 25.35], [282.5, 0.01, 23.40],
      [280.0, 0.02, 20.85], [277.5, 0.02, 17.90], [275.0, 0.05, 16.10], [272.5, 0.09, 13.00],
      [270.0, 0.16, 10.50], [267.5, 0.31, 8.30], [265.0, 0.60, 5.90], [262.5, 1.18, 4.05],
      [260.0, 2.15, 2.57],
      [257.5, 3.60, 1.51], [255.0, 5.45, 0.85], [252.5, 7.50, 0.43], [250.0, 9.80, 0.23],
      [247.5, 12.10, 0.14], [245.0, 13.85, 0.09], [242.5, 16.65, 0.07], [240.0, 19.15, 0.05],
    ];
  }

  private buildFutureOptionContractsForMonth(
    optBaseMs: number,
    mOffset: number,
    cycleIdx: number
  ): { yymm: string; contracts: OptionContractRecord[] } {
    const k200Chain = this.getK200ChainTemplates();
    const baseUtcDate = new Date(optBaseMs);
    const createdIso = new Date(optBaseMs).toISOString();
    const mDate = new Date(Date.UTC(baseUtcDate.getUTCFullYear(), baseUtcDate.getUTCMonth() + mOffset, 15, 6, 30, 0));
    const yyyy = String(mDate.getUTCFullYear());
    const mm = String(mDate.getUTCMonth() + 1).padStart(2, '0');
    const yymm = `${yyyy.slice(2)}${mm}`;
    const monthExpiryIso = mDate.toISOString();
    const timeScale = 1 + cycleIdx * 0.18;
    const contracts: OptionContractRecord[] = [];
    for (const [strike, callPx, putPx] of k200Chain) {
      const sLabel = strike.toFixed(1);
      const scaledCall = Math.max(0.01, Math.round(callPx * timeScale * 100) / 100);
      const scaledPut = Math.max(0.01, Math.round(putPx * timeScale * 100) / 100);
      contracts.push(
        { id: `opt_k200_${yymm}_c_${sLabel}`, underlying_stock_id: K200_INDEX_UNDERLYING_ID, ticker: `IDX-K200-${yymm}-C${sLabel}`, asset_class: 'IDX', type: 'CALL', option_type: 'CALL', strike_price: strike, current_price: scaledCall, multiplier: 250000, expiry_date: monthExpiryIso, open_interest: 1000 + cycleIdx * 200, volume: 100 + Math.max(0, 2 - cycleIdx) * 40, created_at: createdIso },
        { id: `opt_k200_${yymm}_p_${sLabel}`, underlying_stock_id: K200_INDEX_UNDERLYING_ID, ticker: `IDX-K200-${yymm}-P${sLabel}`, asset_class: 'IDX', type: 'PUT', option_type: 'PUT', strike_price: strike, current_price: scaledPut, multiplier: 250000, expiry_date: monthExpiryIso, open_interest: 1000 + cycleIdx * 200, volume: 100 + Math.max(0, 2 - cycleIdx) * 40, created_at: createdIso },
      );
    }
    return { yymm, contracts };
  }

  private buildFutureOptionContracts(optBaseMs: number): OptionContractRecord[] {
    const list: OptionContractRecord[] = [];
    for (let mOffset = 1; mOffset <= 3; mOffset++) {
      list.push(...this.buildFutureOptionContractsForMonth(optBaseMs, mOffset, mOffset - 1).contracts);
    }
    return list;
  }

  /**
   * 비파괴 카탈로그 보충: 구버전 스냅샷 복원 시 누락된 신규 종목/ETF만 추가한다.
   * 기존 종목의 가격/상태/주문/잔고는 절대 수정하지 않는다.
   */
  public supplementMissingCatalogStocks(): number {
    const stockList = this.getDefaultStockDefinitions();
    const now = this.getNowMs();
    let added = 0;
    stockList.forEach((s, idx) => {
      const id = STOCK_UUID_MAP[s.ticker] || `00000000-0000-4000-8000-${(1000 + idx).toString().padStart(12, '0')}`;
      if (this.stocks.has(id) || this.tickerIndex.has(s.ticker.toUpperCase())) {
        return;
      }
      const record = this.buildDefaultStockRecord(s, idx);
      this.stocks.set(record.id, record);
      this.addStockToIndex(record);
      this.seedInitialStockHistory(record, idx, now);
      added++;
    });
    return added;
  }

  /**
   * 비파괴 미래 옵션 월물 보충: 유효한 미래 만기 옵션 계약이 0건일 때만 향후 3개 월물을 추가한다.
   * 기존 과거 계약의 expiry_date나 기존 포지션/가격은 절대 변경하지 않으며,
   * 이미 만기된 동일 월물 ID가 존재할 경우 다음 유효 미래 월물로 자동 이월 생성한다.
   */
  public supplementFutureOptionContracts(nowMs?: number): number {
    const checkNowMs = nowMs ?? (this.executionContext ? this.getNowMs() : Date.now());
    let hasUnexpired = false;
    for (const c of this.optionsContracts.values()) {
      const expMs = Date.parse(c.expiry_date || '');
      if (Number.isFinite(expMs) && expMs > checkNowMs) {
        hasUnexpired = true;
        break;
      }
    }
    if (hasUnexpired) return 0;

    let added = 0;
    let monthsAdded = 0;
    for (let mOffset = 1; mOffset <= 24 && monthsAdded < 3; mOffset++) {
      const { contracts } = this.buildFutureOptionContractsForMonth(checkNowMs, mOffset, monthsAdded);
      const hasAnyCollision = contracts.some((c) => this.optionsContracts.has(c.id));
      if (hasAnyCollision) {
        continue;
      }
      for (const c of contracts) {
        this.optionsContracts.set(c.id, c);
        added++;
      }
      monthsAdded++;
    }
    return added;
  }

  /**
   * 기본 시드 데이터 로드 (고정 UUID 규격 적용)
   */
  public seedDefaultData(): void {
    // 가상 금융 시장 시뮬레이션 종목 메타데이터 (단일 권위: market_cap = current_price * shares_outstanding)
    const stockList = this.getDefaultStockDefinitions();
    const now = this.getNowMs();

    stockList.forEach((s, idx) => {
      const record = this.buildDefaultStockRecord(s, idx);
      this.stocks.set(record.id, record);
      this.addStockToIndex(record);
      this.seedInitialStockHistory(record, idx, now);
    });

    // ── 원자재 시드 ──
    COMMODITY_DEFINITIONS.forEach((c) => {
      const record: CommodityRecord = {
        id: c.id,
        commodity_id: c.id,
        ticker: c.ticker,
        name: c.name,
        category: c.category,
        current_price: c.basePrice,
        previous_close: c.basePrice,
        unit: c.unit,
        tick_size: c.tickSize,
        volume: 5200,
        open_price: c.basePrice,
        high_price: c.basePrice * 1.01,
        low_price: c.basePrice * 0.99,
      };
      this.commodities.set(c.id, record);
      this.addCommodityToIndex(record);
    });

    // ── 채권 시드 ──
    const bondBaseMs = this.executionContext ? this.getNowMs() : Date.now();
    const yearsToIso = (years: number) => new Date(bondBaseMs + years * 365 * 24 * 60 * 60 * 1000).toISOString();
    const bondList: BondRecord[] = [
      { id: 'bond_kr_2y', ticker: 'KR_GVT_2Y', name: '한국 국고채 2년', bond_type: 'govt', maturity: '2Y', maturity_date: yearsToIso(2), coupon_rate: 3.25, face_value: 10000, quote_base: 100, payments_per_year: 4, current_price: 99.80, ytm: 3.35, duration: 1.92, volume: 15000 },
      { id: 'bond_kr_5y', ticker: 'KR_GVT_5Y', name: '한국 국고채 5년', bond_type: 'govt', maturity: '5Y', maturity_date: yearsToIso(5), coupon_rate: 3.50, face_value: 10000, quote_base: 100, payments_per_year: 4, current_price: 98.50, ytm: 3.75, duration: 4.55, volume: 12000 },
      { id: 'bond_kr_10y', ticker: 'KR_GVT_10Y', name: '한국 국고채 10년', bond_type: 'govt', maturity: '10Y', maturity_date: yearsToIso(10), coupon_rate: 3.75, face_value: 10000, quote_base: 100, payments_per_year: 4, current_price: 97.20, ytm: 4.05, duration: 8.40, volume: 8000 },
      { id: 'bond_us_2y', ticker: 'US_GVT_2Y', name: '미국 국고채 2년', bond_type: 'govt', maturity: '2Y', maturity_date: yearsToIso(2), coupon_rate: 4.75, face_value: 10000, quote_base: 100, payments_per_year: 4, current_price: 99.50, ytm: 4.80, duration: 1.94, volume: 24000 },
      { id: 'bond_us_10y', ticker: 'US_GVT_10Y', name: '미국 국고채 10년', bond_type: 'govt', maturity: '10Y', maturity_date: yearsToIso(10), coupon_rate: 4.25, face_value: 10000, quote_base: 100, payments_per_year: 4, current_price: 97.80, ytm: 4.35, duration: 8.25, volume: 28000 },
      { id: 'bond_corp_ig', ticker: 'KR_CORP_IG', name: '한국 우량 회사채', bond_type: 'corp_ig', maturity: '3Y', maturity_date: yearsToIso(3), coupon_rate: 4.10, face_value: 10000, quote_base: 100, payments_per_year: 4, current_price: 98.80, ytm: 4.35, duration: 2.78, volume: 5000 },
      { id: 'bond_corp_hy', ticker: 'KR_CORP_HY', name: '한국 투기 회사채', bond_type: 'corp_hy', maturity: '3Y', maturity_date: yearsToIso(3), coupon_rate: 7.25, face_value: 10000, quote_base: 100, payments_per_year: 4, current_price: 95.20, ytm: 7.85, duration: 2.62, volume: 3000 },
    ];
    bondList.forEach((b) => this.bonds.set(b.id, b));

    // ── 옵션 계약 시드 (현재 시점 기준 향후 3개 월물 + 기본 하위호환 계약) ──
    const optBaseMs = this.executionContext ? this.getNowMs() : Date.now();
    const expDateObj = new Date(optBaseMs + 30 * 24 * 60 * 60 * 1000);
    const expDate = expDateObj.toISOString();
    const expYymm = `${String(expDateObj.getUTCFullYear()).slice(2)}${String(expDateObj.getUTCMonth() + 1).padStart(2, '0')}`;
    const optList: OptionContractRecord[] = [
      { id: 'opt_c_720', underlying_stock_id: K200_INDEX_UNDERLYING_ID, ticker: `IDX-K200-${expYymm}-C260.0`, asset_class: 'IDX', type: 'CALL', option_type: 'CALL', strike_price: 260, current_price: 2.15, multiplier: 250000, expiry_date: expDate, open_interest: 450, volume: 120, delta: 0.65, gamma: 0.04, theta: -0.15, implied_volatility: 0.22, created_at: this.getIsoTimestamp() },
      { id: 'opt_p_720', underlying_stock_id: K200_INDEX_UNDERLYING_ID, ticker: `IDX-K200-${expYymm}-P260.0`, asset_class: 'IDX', type: 'PUT', option_type: 'PUT', strike_price: 260, current_price: 1.85, multiplier: 250000, expiry_date: expDate, open_interest: 380, volume: 95, delta: -0.35, gamma: 0.04, theta: -0.12, implied_volatility: 0.21, created_at: this.getIsoTimestamp() },
      ...this.buildFutureOptionContracts(optBaseMs),
    ];
    optList.forEach((o) => this.optionsContracts.set(o.id, o));

    // ── 환율 시드 ──
    this.exchangeRates = [
      { currency_code: 'KRW', currency_name: '대한민국 원', rate_to_krw: 1.0, updated_at: this.getIsoTimestamp() },
      { currency_code: 'USD', currency_name: '미국 달러', rate_to_krw: 1380.0, updated_at: this.getIsoTimestamp() },
      { currency_code: 'EUR', currency_name: '유로', rate_to_krw: 1500.0, updated_at: this.getIsoTimestamp() },
      { currency_code: 'JPY', currency_name: '일본 엔', rate_to_krw: 9.2, updated_at: this.getIsoTimestamp() },
      { currency_code: 'CNY', currency_name: '위안', rate_to_krw: 190.0, updated_at: this.getIsoTimestamp() },
      { currency_code: 'GBP', currency_name: '영국 파운드', rate_to_krw: 1750.0, updated_at: this.getIsoTimestamp() },
    ];

    // ── 테스트 사용자 (고정 UUID 적용) ──
    const guestUser: ProfileRecord = {
      id: GUEST_USER_ID,
      user_id: GUEST_USER_ID,
      username: '서학개미',
      nickname: '서학개미',
      cash: 100000000, // 1억 원
      net_worth: 100000000,
      rank_tier: 'Diamond',
      usd_balance: 50000,
      eur_balance: 10000,
      jpy_balance: 200000,
      cny_balance: 0,
      gbp_balance: 0,
      is_admin: true,
      unlocked_features: ['custom_dashboard', 'advanced_charts'],
      created_at: this.getIsoTimestamp(),
    };
    this.profiles.set(guestUser.id, guestUser);
    this.addProfileToIndex(guestUser);

    const optionsLpProfile: ProfileRecord = {
      id: 'bot_options_mm_001',
      user_id: 'bot_options_mm_001',
      username: '옵션 마켓메이커 LP',
      nickname: '옵션 마켓메이커 LP',
      cash: 10_000_000_000_000,
      net_worth: 10_000_000_000_000,
      rank_tier: 'LP',
      is_admin: false,
      created_at: this.getIsoTimestamp(),
    };
    this.profiles.set(optionsLpProfile.id, optionsLpProfile);
    this.addProfileToIndex(optionsLpProfile);

    // ── 테스트 사용자의 초기 보유 주식 (Holdings) ──
    const initialHoldings = [
      { stockTicker: '0010', qty: 100, avgPrice: 70000 },
      { stockTicker: '000660', qty: 50, avgPrice: 180000 },
      { stockTicker: '035420', qty: 30, avgPrice: 190000 },
      { stockTicker: 'AAPL', qty: 20, avgPrice: 180 },
    ];

    let totalStockEval = 0;
    initialHoldings.forEach((ih) => {
      const sId = STOCK_UUID_MAP[ih.stockTicker];
      if (sId) {
        const hId = `${GUEST_USER_ID}_${sId}`;
        const hRec: HoldingRecord = {
          id: hId,
          user_id: GUEST_USER_ID,
          stock_id: sId,
          quantity: ih.qty,
          avg_price: ih.avgPrice,
          created_at: this.getIsoTimestamp(),
        };
        this.holdings.set(hId, hRec);
        this.addHoldingToIndex(hRec);
        totalStockEval += ih.qty * ih.avgPrice;
      }
    });
    guestUser.net_worth = guestUser.cash + totalStockEval;

    // ── ABM 봇 및 LP 계좌 시드 (유한한 현금과 보유주식을 가진 독립 계좌) ──
    const abmAccounts = [
      { id: 'acc_lp_main', name: '유동성공급자(LP)', cash: 5_000_000_000, holdingPerStock: 5000 },
      { id: 'acc_bot_val_01', name: '가치투자 봇 1호', cash: 2_000_000_000, holdingPerStock: 1000 },
      { id: 'acc_bot_val_02', name: '가치투자 봇 2호', cash: 1_500_000_000, holdingPerStock: 500 },
      { id: 'acc_bot_trend_01', name: '모멘텀 봇 1호', cash: 2_000_000_000, holdingPerStock: 1000 },
      { id: 'acc_bot_trend_02', name: '모멘텀 봇 2호', cash: 1_500_000_000, holdingPerStock: 500 },
    ];

    for (const acc of abmAccounts) {
      const pRec: ProfileRecord = {
        id: acc.id,
        user_id: acc.id,
        username: acc.name,
        nickname: acc.name,
        cash: acc.cash,
        net_worth: acc.cash,
        rank_tier: 'Diamond',
        is_admin: false,
        created_at: this.getIsoTimestamp(),
      };
      this.profiles.set(acc.id, pRec);
      this.addProfileToIndex(pRec);

      let botStockEval = 0;
      for (const stk of this.stocks.values()) {
        const hId = `${acc.id}_${stk.id}`;
        const hRec: HoldingRecord = {
          id: hId,
          user_id: acc.id,
          stock_id: stk.id,
          quantity: acc.holdingPerStock,
          avg_price: stk.current_price,
          created_at: this.getIsoTimestamp(),
        };
        this.holdings.set(hId, hRec);
        this.addHoldingToIndex(hRec);
        botStockEval += acc.holdingPerStock * stk.current_price;
      }
      pRec.net_worth = acc.cash + botStockEval;
    }

    // ── 관리자 설정 ──
    this.adminSettings.set('1', {
      id: 1,
      base_rate: 0.025,
      market_sentiment: 'NEUTRAL',
    });

    // ── 50개 기관 봇 LP 호가 및 초기 체결 적재 ──
    Array.from(this.stocks.values()).forEach((stk) => {
      const cp = stk.current_price;
      const tick = cp < 2000 ? 1 : cp < 5000 ? 5 : cp < 20000 ? 10 : cp < 50000 ? 50 : cp < 200000 ? 100 : 500;
      const baseVol = cp >= 50000 ? 2500 : cp >= 10000 ? 800 : 200;

      // 매수 호가 10단계 (가격 내림차순)
      for (let level = 1; level <= 10; level++) {
        const bidPrice = cp - level * tick;
        if (bidPrice > 0) {
          const oId = `lp_bid_${stk.id}_${level}_${now}`;
          const ord: OrderRecord = {
            id: oId,
            stock_id: stk.id,
            user_id: null,
            side: 'buy',
            price: bidPrice,
            size: Math.round(baseVol * (1 + (10 - level) * 0.2)),
            filled: 0,
            status: 'open',
            is_lp: true,
            created_at: new Date(now - (11 - level) * 1000).toISOString(),
          };
          this.orders.set(oId, ord);
          this.addOrderToIndex(ord);
        }
      }

      // 매도 호가 10단계 (가격 오름차순)
      for (let level = 1; level <= 10; level++) {
        const askPrice = cp + level * tick;
        const oId = `lp_ask_${stk.id}_${level}_${now}`;
        const ord: OrderRecord = {
          id: oId,
          stock_id: stk.id,
          user_id: null,
          side: 'sell',
          price: askPrice,
          size: Math.round(baseVol * (1 + (10 - level) * 0.2)),
          filled: 0,
          status: 'open',
          is_lp: true,
          created_at: new Date(now - (11 - level) * 1000).toISOString(),
        };
        this.orders.set(oId, ord);
        this.addOrderToIndex(ord);
      }

      // 초기 체결 기록 5건
      for (let t = 5; t >= 1; t--) {
        const trId = `trade_${stk.id}_init_${t}`;
        const trPrice = cp + (t % 2 === 0 ? tick : -tick);
        const trSize = Math.round(baseVol * 0.2);
        const tr: TradeRecord = {
          id: trId,
          stock_id: stk.id,
          buyer_id: null,
          seller_id: null,
          buyer_is_bot: true,
          seller_is_bot: true,
          price: trPrice,
          size: trSize,
          buyer_fee: 0.0025,
          seller_fee: 0.0025,
          created_at: new Date(now - t * 3000).toISOString(),
        };
        this.appendTrade(tr);
      }
    });
  }

  /**
   * 개발자용 시장 리셋 (초기 시드 상태로 완전 복원)
   */
  public resetToSeedData(options?: { suppressPublish?: boolean }): void {
    this.stocks.clear();
    this.stockPriceHistory = [];
    this.commodities.clear();
    this.profiles.clear();
    this.holdings.clear();
    this.orders.clear();
    this.trades = [];
    this.optionsContracts.clear();
    this.bonds.clear();
    this.marketNews = [];
    this.pendingAdminMarketEvents = [];
    this.localSimulationClock = null;
    this.adminSettings.clear();
    this.exchangeRates = [];
    this.institutionalPortfolios.clear();
    this.activePlayerEvents = [];
    this.activeManipulations = [];
    this.settlementLedger.clear();
    this.settlementLedgerCutoffMs = 0;
    this.settledEpochWatermarks.clear();
    this.settledEpochIntervals.clear();
    this.settledOptionEpochWatermarks.clear();
    this.settledOptionEpochIntervals.clear();
    this.settledDeterministicWatermarks.clear();
    this.settledDeterministicIntervals.clear();
    this.settledBondCouponIntervals.clear();
    this.settledBondCouponQuarterIntervals.clear();
    this.settledBondRedemptions.clear();
    this.settledBondRedemptionWatermarkYm = '';
    this.settledBondRedemptionWatermarkYq = '';
    this.scenarioRuntimeState = null;
    this.scenarioResetVersion += 1;
    this.commodityEventRuntimeState = null;
    this.settledOptionExpiryKeys.clear();
    this.settledOptionExpiryWatermarkYmd = '';
    this.evictedCustomTradeIds.clear();
    this.tradeEpoch += 1;
    this.tradeGenerationCounter += 1;
    this.tradeSeq = 0;
    this.optionTradeSeq = 0;
    this.engineNextEpoch += 1;
    this.engineTickCount = 0;
    this.enginePartialFillSequence = 0;
    this.lpLiabilities.clear();
    this.lpQuoteGeneration = 0;
    this.optionSettlements = [];
    this.bondCouponPayments = [];
    this.commodityPositions.clear();
    this.commodityMarginReservations.clear();
    this.commoditySettlementLedger.clear();
    this.commodityOpenOrders.clear();
    this.commoditySettledEpochWatermarks.clear();
    this.commoditySettledEpochIntervals.clear();
    this.commodityEvictedCustomTradeIds.clear();
    this.commodityNextEpoch += 1;
    this.commodityCurrentTick = 0;
    this.commodityUserOrderSeq = 0;
    this.commodityTradeSeq = 0;
    this.commodityResetVersion += 1;
    this.commoditySnapshotVersion += 1;

    this.seedDefaultData();
    this.rebuildIndexes();
    console.log('🔄 [MemoryDB] Market state successfully reset to initial seed data.');
    if (!options?.suppressPublish) {
      this.publish('market_reset', { timestamp: this.getNowMs() });
    }
  }

  private recordContiguousSeq<K>(
    watermarks: Map<K, number>,
    intervalsMap: Map<K, Array<[number, number]>>,
    key: K,
    seq: number,
    defaultWatermark: number
  ): void {
    let wm = watermarks.get(key) ?? defaultWatermark;
    if (seq <= wm) return;

    const intervals = intervalsMap.get(key) ? [...intervalsMap.get(key)!] : [];
    intervals.push([seq, seq]);
    intervals.sort((a, b) => a[0] - b[0]);

    const merged: Array<[number, number]> = [];
    for (const cur of intervals) {
      const last = merged[merged.length - 1];
      if (last && last[1] + 1 >= cur[0]) {
        last[1] = Math.max(last[1], cur[1]);
      } else {
        merged.push([cur[0], cur[1]]);
      }
    }

    if (merged.length > 0 && merged[0][0] <= wm + 1) {
      wm = Math.max(wm, merged[0][1]);
      watermarks.set(key, wm);
      merged.shift();
    } else if (!watermarks.has(key)) {
      watermarks.set(key, wm);
    }

    if (merged.length === 0) {
      intervalsMap.delete(key);
    } else {
      intervalsMap.set(key, merged);
    }
  }

  private isContiguousSeqSettled<K>(
    watermarks: Map<K, number>,
    intervalsMap: Map<K, Array<[number, number]>>,
    key: K,
    seq: number,
    defaultWatermark: number
  ): boolean {
    const wm = watermarks.get(key) ?? defaultWatermark;
    if (seq <= wm) return true;
    const intervals = intervalsMap.get(key);
    if (!intervals) return false;
    for (const [s, e] of intervals) {
      if (seq >= s && seq <= e) return true;
      if (seq < s) break;
    }
    return false;
  }

  private nextYearMonth(ym: string): string {
    const [yStr, mStr] = ym.split('-');
    let y = Number(yStr);
    let m = Number(mStr) + 1;
    if (m > 12) {
      y += 1;
      m = 1;
    }
    return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`;
  }

  private recordBondCouponInterval(bondUserKey: string, ym: string): void {
    const existing = this.settledBondCouponIntervals.get(bondUserKey)
      ? [...this.settledBondCouponIntervals.get(bondUserKey)!]
      : [];
    existing.push([ym, ym]);
    existing.sort((a, b) => a[0].localeCompare(b[0]));

    const merged: Array<[string, string]> = [];
    for (const cur of existing) {
      const last = merged[merged.length - 1];
      if (last && this.nextYearMonth(last[1]) >= cur[0]) {
        if (cur[1] > last[1]) last[1] = cur[1];
      } else {
        merged.push([cur[0], cur[1]]);
      }
    }
    this.settledBondCouponIntervals.set(bondUserKey, merged);
  }

  private isBondCouponSettledInIntervals(bondUserKey: string, ym: string): boolean {
    const intervals = this.settledBondCouponIntervals.get(bondUserKey);
    if (!intervals) return false;
    for (const [start, end] of intervals) {
      if (ym >= start && ym <= end) return true;
      if (ym < start) break;
    }
    return false;
  }

  private nextYearQuarter(yq: string): string {
    const [yStr, qStr] = yq.split('-Q');
    let y = Number(yStr);
    let q = Number(qStr) + 1;
    if (q > 4) {
      y += 1;
      q = 1;
    }
    return `${String(y).padStart(4, '0')}-Q${q}`;
  }

  private recordBondCouponQuarterInterval(bondUserKey: string, yq: string): void {
    const existing = this.settledBondCouponQuarterIntervals.get(bondUserKey)
      ? [...this.settledBondCouponQuarterIntervals.get(bondUserKey)!]
      : [];
    existing.push([yq, yq]);
    existing.sort((a, b) => a[0].localeCompare(b[0]));

    const merged: Array<[string, string]> = [];
    for (const cur of existing) {
      const last = merged[merged.length - 1];
      if (last && this.nextYearQuarter(last[1]) >= cur[0]) {
        if (cur[1] > last[1]) last[1] = cur[1];
      } else {
        merged.push([cur[0], cur[1]]);
      }
    }
    this.settledBondCouponQuarterIntervals.set(bondUserKey, merged);
  }

  private isBondCouponQuarterSettledInIntervals(bondUserKey: string, yq: string): boolean {
    const intervals = this.settledBondCouponQuarterIntervals.get(bondUserKey);
    if (!intervals) return false;
    for (const [start, end] of intervals) {
      if (yq >= start && yq <= end) return true;
      if (yq < start) break;
    }
    return false;
  }

  private compactSettledOptionExpiryKeys(): void {
    if (this.settledOptionExpiryKeys.size <= 2000) return;

    // 보유 잔고가 남아있는 옵션 계약(또는 전체 미결제/존재 계약)의 최소 만기일 이전만 안전하게 날짜 워터마크로 압축한다.
    let minProtectedYmd = '9999-12-31';
    for (const h of this.holdings.values()) {
      if (Number(h.quantity || 0) <= 0) continue;
      const opt = this.optionsContracts.get(h.stock_id);
      if (opt?.expiry_date) {
        const ymd = opt.expiry_date.split('T')[0];
        if (ymd && ymd < minProtectedYmd) {
          minProtectedYmd = ymd;
        }
      }
    }
    for (const opt of this.optionsContracts.values()) {
      const expMs = Date.parse(opt.expiry_date || '');
      if (Number.isFinite(expMs) && expMs > this.getNowMs()) {
        const ymd = opt.expiry_date.split('T')[0];
        if (ymd && ymd < minProtectedYmd) {
          minProtectedYmd = ymd;
        }
      }
    }

    const optYmdRe = /^opt_settle_.+_(\d{4}-\d{2}-\d{2})$/;
    const candidateYmds: string[] = [];
    for (const key of this.settledOptionExpiryKeys) {
      const m = optYmdRe.exec(key);
      if (m && m[1] < minProtectedYmd) {
        candidateYmds.push(m[1]);
      }
    }
    if (candidateYmds.length === 0) return;
    candidateYmds.sort();
    // 오래된 완료 만기일들을 날짜 워터마크로 압축 (동일 만기 내 신규 미정산 계약이 없도록 minProtectedYmd 미만만 대상)
    const compactCutoffYmd = candidateYmds[Math.min(candidateYmds.length - 1, Math.floor(candidateYmds.length * 0.75))];
    if (compactCutoffYmd > this.settledOptionExpiryWatermarkYmd) {
      this.settledOptionExpiryWatermarkYmd = compactCutoffYmd;
    }
    for (const key of Array.from(this.settledOptionExpiryKeys)) {
      const m = optYmdRe.exec(key);
      if (m && m[1] <= this.settledOptionExpiryWatermarkYmd) {
        this.settledOptionExpiryKeys.delete(key);
      }
    }
  }

  private compactSettledBondRedemptionKeys(): void {
    if (this.settledBondRedemptions.size <= 2000) return;

    let minProtectedYm = '9999-12';
    for (const h of this.holdings.values()) {
      if (Number(h.quantity || 0) <= 0) continue;
      const bond = this.bonds.get(h.stock_id);
      const mat = bond?.maturity_date || bond?.maturity;
      if (mat && /^\d{4}-\d{2}/.test(mat)) {
        const ym = mat.slice(0, 7);
        if (ym < minProtectedYm) minProtectedYm = ym;
      }
    }
    for (const bond of this.bonds.values()) {
      const mat = bond.maturity_date || bond.maturity;
      const matMs = Date.parse(mat || '');
      if (Number.isFinite(matMs) && matMs > this.getNowMs() && /^\d{4}-\d{2}/.test(mat || '')) {
        const ym = mat.slice(0, 7);
        if (ym < minProtectedYm) minProtectedYm = ym;
      }
    }

    const bondYmRe = /^bond_maturity_redemption_.+_period_(\d{4}-\d{2})$/;
    const candidateYms: string[] = [];
    for (const key of this.settledBondRedemptions) {
      const m = bondYmRe.exec(key);
      if (m && m[1] < minProtectedYm) {
        candidateYms.push(m[1]);
      }
    }
    if (candidateYms.length > 0) {
      candidateYms.sort();
      const compactCutoffYm = candidateYms[Math.min(candidateYms.length - 1, Math.floor(candidateYms.length * 0.75))];
      if (compactCutoffYm > this.settledBondRedemptionWatermarkYm) {
        this.settledBondRedemptionWatermarkYm = compactCutoffYm;
      }
      for (const key of Array.from(this.settledBondRedemptions)) {
        const m = bondYmRe.exec(key);
        if (m && m[1] <= this.settledBondRedemptionWatermarkYm) {
          this.settledBondRedemptions.delete(key);
        }
      }
    }

    const ymParts = minProtectedYm.split('-');
    const minProtectedYq = `${ymParts[0]}-Q${Math.floor((Number(ymParts[1]) - 1) / 3) + 1}`;
    const bondYqRe = /^bond_maturity_redemption_.+_period_(\d{4}-Q[1-4])$/;
    const candidateYqs: string[] = [];
    for (const key of this.settledBondRedemptions) {
      const m = bondYqRe.exec(key);
      if (m && m[1] < minProtectedYq) {
        candidateYqs.push(m[1]);
      }
    }
    if (candidateYqs.length > 0) {
      candidateYqs.sort();
      const compactCutoffYq = candidateYqs[Math.min(candidateYqs.length - 1, Math.floor(candidateYqs.length * 0.75))];
      if (compactCutoffYq > this.settledBondRedemptionWatermarkYq) {
        this.settledBondRedemptionWatermarkYq = compactCutoffYq;
      }
      for (const key of Array.from(this.settledBondRedemptions)) {
        const m = bondYqRe.exec(key);
        if (m && m[1] <= this.settledBondRedemptionWatermarkYq) {
          this.settledBondRedemptions.delete(key);
        }
      }
    }
  }

  /**
   * 정산 원장(settlementLedger)의 메모리 상한을 유지하되,
   * 단조 증가 ID(tr_e<epoch>_<seq>, opt_tr_e<epoch>_<seq>) 및
   * 결정론적 엔진 체결 ID(trade_<runId>_t<tick>_s..._f<seq>)는 연속 확인(contiguous) 워터마크 + 비연속 구간(interval)으로 압축해
   * 비순차 삽입/퇴거 시에도 미처리 거래를 기처리로 오인하지 않는다.
   * 또한 opt_settle_* / bond_* ID는 전용 압축 구조(월별 구간 병합·만기 날짜 워터마크)로 분리한다.
   */
  public trimSettlementLedger(maxEntries: number = 10000): number {
    if (this.settlementLedger.size <= maxEntries) return 0;
    const entries = Array.from(this.settlementLedger.entries());
    const removeCount = entries.length - maxEntries;
    let maxRemovedMs = this.settlementLedgerCutoffMs;
    const monotonicRe = /^tr_e(\d+)_(\d+)$/;
    const optionMonotonicRe = /^opt_tr_e(\d+)_(\d+)$/;
    const deterministicTradeRe = /^trade_(.+?)_t\d+_s.+~.+_f(\d+)$/;
    const bondCouponPeriodRe = /^bond_coupon_(.+)_period_(\d{4}-\d{2})$/;
    const bondCouponQuarterRe = /^bond_coupon_(.+)_period_(\d{4}-Q[1-4])$/;

    for (let i = 0; i < removeCount; i++) {
      const [key, val] = entries[i];
      const settledMs = Date.parse(val.settled_at || '');
      if (Number.isFinite(settledMs) && settledMs > maxRemovedMs) {
        maxRemovedMs = settledMs;
      }
      const match = monotonicRe.exec(key);
      if (match) {
        const epoch = Number(match[1]);
        const seq = Number(match[2]);
        this.recordContiguousSeq(this.settledEpochWatermarks, this.settledEpochIntervals, epoch, seq, 0);
      } else {
        const optMatch = optionMonotonicRe.exec(key);
        if (optMatch) {
          const epoch = Number(optMatch[1]);
          const seq = Number(optMatch[2]);
          this.recordContiguousSeq(this.settledOptionEpochWatermarks, this.settledOptionEpochIntervals, epoch, seq, 0);
        } else {
          const detMatch = deterministicTradeRe.exec(key);
          if (detMatch) {
            const runId = detMatch[1];
            const fillSeq = Number(detMatch[2]);
            this.recordContiguousSeq(this.settledDeterministicWatermarks, this.settledDeterministicIntervals, runId, fillSeq, -1);
          } else {
            const couponMatch = bondCouponPeriodRe.exec(key);
            if (couponMatch) {
              this.recordBondCouponInterval(couponMatch[1], couponMatch[2]);
            } else {
              const quarterCouponMatch = bondCouponQuarterRe.exec(key);
              if (quarterCouponMatch) {
                this.recordBondCouponQuarterInterval(quarterCouponMatch[1], quarterCouponMatch[2]);
              } else if (key.startsWith('bond_')) {
                this.settledBondRedemptions.add(key);
              } else if (key.startsWith('opt_settle_')) {
                this.settledOptionExpiryKeys.add(key);
              } else {
                this.evictedCustomTradeIds.add(key);
              }
            }
          }
        }
      }
      this.settlementLedger.delete(key);
    }
    this.compactSettledOptionExpiryKeys();
    this.compactSettledBondRedemptionKeys();
    this.settlementLedgerCutoffMs = maxRemovedMs;
    return removeCount;
  }

  public isTradeAlreadySettled(tradeId: string): boolean {
    if (this.settlementLedger.has(tradeId)) return true;
    const match = /^tr_e(\d+)_(\d+)$/.exec(tradeId);
    if (match) {
      const epoch = Number(match[1]);
      const seq = Number(match[2]);
      if (this.isContiguousSeqSettled(this.settledEpochWatermarks, this.settledEpochIntervals, epoch, seq, 0)) {
        return true;
      }
    }
    const optMatch = /^opt_tr_e(\d+)_(\d+)$/.exec(tradeId);
    if (optMatch) {
      const epoch = Number(optMatch[1]);
      const seq = Number(optMatch[2]);
      if (this.isContiguousSeqSettled(this.settledOptionEpochWatermarks, this.settledOptionEpochIntervals, epoch, seq, 0)) {
        return true;
      }
    }
    const detMatch = /^trade_(.+?)_t\d+_s.+~.+_f(\d+)$/.exec(tradeId);
    if (detMatch) {
      const runId = detMatch[1];
      const fillSeq = Number(detMatch[2]);
      if (this.isContiguousSeqSettled(this.settledDeterministicWatermarks, this.settledDeterministicIntervals, runId, fillSeq, -1)) {
        return true;
      }
    }
    const couponMatch = /^bond_coupon_(.+)_period_(\d{4}-\d{2})$/.exec(tradeId);
    if (couponMatch) {
      if (this.isBondCouponSettledInIntervals(couponMatch[1], couponMatch[2])) {
        return true;
      }
    }
    const quarterCouponMatch = /^bond_coupon_(.+)_period_(\d{4}-Q[1-4])$/.exec(tradeId);
    if (quarterCouponMatch) {
      if (this.isBondCouponQuarterSettledInIntervals(quarterCouponMatch[1], quarterCouponMatch[2])) {
        return true;
      }
    }
    if (tradeId.startsWith('bond_')) {
      if (this.settledBondRedemptions.has(tradeId)) return true;
      if (this.settledBondRedemptionWatermarkYm) {
        const ymMatch = /^bond_maturity_redemption_.+_period_(\d{4}-\d{2})$/.exec(tradeId);
        if (ymMatch && ymMatch[1] <= this.settledBondRedemptionWatermarkYm) {
          return true;
        }
      }
      if (this.settledBondRedemptionWatermarkYq) {
        const yqMatch = /^bond_maturity_redemption_.+_period_(\d{4}-Q[1-4])$/.exec(tradeId);
        if (yqMatch && yqMatch[1] <= this.settledBondRedemptionWatermarkYq) {
          return true;
        }
      }
      return this.evictedCustomTradeIds.has(tradeId);
    }
    if (tradeId.startsWith('opt_settle_')) {
      if (this.settledOptionExpiryKeys.has(tradeId)) return true;
      if (this.settledOptionExpiryWatermarkYmd) {
        const ymdMatch = /^opt_settle_.+_(\d{4}-\d{2}-\d{2})$/.exec(tradeId);
        if (ymdMatch && ymdMatch[1] <= this.settledOptionExpiryWatermarkYmd) {
          return true;
        }
      }
      return this.evictedCustomTradeIds.has(tradeId);
    }
    return this.evictedCustomTradeIds.has(tradeId);
  }

  /**
   * 원자재 정산 원장(commoditySettlementLedger) 트리밍:
   * 단조 ID(cm_trade_e<epoch>_t<tick>_s<seq>)는 연속 확인 워터마크 + 비연속 구간으로 압축한다.
   */
  public trimCommoditySettlementLedger(maxEntries: number = 5000): number {
    if (this.commoditySettlementLedger.size <= maxEntries) return 0;
    const entries = Array.from(this.commoditySettlementLedger.entries());
    const removeCount = entries.length - maxEntries;
    const monotonicRe = /^cm_trade_e(\d+)_t\d+_s(\d+)$/;

    for (let i = 0; i < removeCount; i++) {
      const [key] = entries[i];
      const match = monotonicRe.exec(key);
      if (match) {
        const epoch = Number(match[1]);
        const seq = Number(match[2]);
        this.recordContiguousSeq(this.commoditySettledEpochWatermarks, this.commoditySettledEpochIntervals, epoch, seq, 0);
      } else {
        this.commodityEvictedCustomTradeIds.add(key);
      }
      this.commoditySettlementLedger.delete(key);
    }
    return removeCount;
  }

  public isCommodityTradeSettled(tradeId: string): boolean {
    if (this.commoditySettlementLedger.has(tradeId)) return true;
    const match = /^cm_trade_e(\d+)_t\d+_s(\d+)$/.exec(tradeId);
    if (match) {
      const epoch = Number(match[1]);
      const seq = Number(match[2]);
      if (this.isContiguousSeqSettled(this.commoditySettledEpochWatermarks, this.commoditySettledEpochIntervals, epoch, seq, 0)) {
        return true;
      }
    }
    return this.commodityEvictedCustomTradeIds.has(tradeId);
  }

  public exportSnapshot(): any {
    return {
      schemaVersion: 2,
      stocks: Array.from(this.stocks.entries()),
      stockPriceHistory: [...this.stockPriceHistory],
      commodities: Array.from(this.commodities.entries()),
      profiles: Array.from(this.profiles.entries()),
      holdings: Array.from(this.holdings.entries()),
      orders: Array.from(this.orders.entries()),
      trades: [...this.trades],
      optionsContracts: Array.from(this.optionsContracts.entries()),
      bonds: Array.from(this.bonds.entries()),
      marketNews: [...this.marketNews],
      pendingAdminMarketEvents: this.pendingAdminMarketEvents,
      localSimulationClock: this.localSimulationClock,
      adminSettings: Array.from(this.adminSettings.entries()),
      exchangeRates: [...this.exchangeRates],
      institutionalPortfolios: Array.from(this.institutionalPortfolios.entries()),
      playerEvents: [...this.playerEvents],
      activePlayerEvents: [...this.activePlayerEvents],
      activeManipulations: [...this.activeManipulations],
      scenarioRuntimeState: this.scenarioRuntimeState ? structuredClone(this.scenarioRuntimeState) : null,
      commodityEventRuntimeState: this.commodityEventRuntimeState ? structuredClone(this.commodityEventRuntimeState) : null,
      botsConfig: [...this.botsConfig],
      settlementLedger: Array.from(this.settlementLedger.entries()),
      settlementLedgerCutoffMs: this.settlementLedgerCutoffMs,
      settledEpochWatermarks: Array.from(this.settledEpochWatermarks.entries()),
      settledEpochIntervals: Array.from(this.settledEpochIntervals.entries()),
      settledOptionEpochWatermarks: Array.from(this.settledOptionEpochWatermarks.entries()),
      settledOptionEpochIntervals: Array.from(this.settledOptionEpochIntervals.entries()),
      settledDeterministicWatermarks: Array.from(this.settledDeterministicWatermarks.entries()),
      settledDeterministicIntervals: Array.from(this.settledDeterministicIntervals.entries()),
      settledBondCouponIntervals: Array.from(this.settledBondCouponIntervals.entries()),
      settledBondCouponQuarterIntervals: Array.from(this.settledBondCouponQuarterIntervals.entries()),
      settledBondRedemptions: Array.from(this.settledBondRedemptions.values()),
      settledBondRedemptionWatermarkYm: this.settledBondRedemptionWatermarkYm,
      settledBondRedemptionWatermarkYq: this.settledBondRedemptionWatermarkYq,
      settledOptionExpiryKeys: Array.from(this.settledOptionExpiryKeys.values()),
      settledOptionExpiryWatermarkYmd: this.settledOptionExpiryWatermarkYmd,
      evictedCustomTradeIds: Array.from(this.evictedCustomTradeIds.values()),
      tradeEpoch: this.tradeEpoch,
      tradeSeq: this.tradeSeq,
      tradeCursorSeq: this.tradeCursorSeq,
      optionTradeSeq: this.optionTradeSeq,
      fallbackCounter: this.fallbackCounter,
      engineNextEpoch: this.engineNextEpoch,
      engineTickCount: this.engineTickCount,
      enginePartialFillSequence: this.enginePartialFillSequence,
      lpLiabilities: Array.from(this.lpLiabilities.entries()),
      lpQuoteGeneration: this.lpQuoteGeneration,
      lpAccounts: Array.from(this.lpAccounts.values()),
      optionSettlements: [...this.optionSettlements],
      bondCouponPayments: [...this.bondCouponPayments],
      commodityPositions: Array.from(this.commodityPositions.entries()),
      commodityMarginReservations: Array.from(this.commodityMarginReservations.entries()),
      commoditySettlementLedger: Array.from(this.commoditySettlementLedger.entries()),
      commodityOpenOrders: Array.from(this.commodityOpenOrders.entries()),
      commoditySettledEpochWatermarks: Array.from(this.commoditySettledEpochWatermarks.entries()),
      commoditySettledEpochIntervals: Array.from(this.commoditySettledEpochIntervals.entries()),
      commodityEvictedCustomTradeIds: Array.from(this.commodityEvictedCustomTradeIds.values()),
      commodityNextEpoch: this.commodityNextEpoch,
      commodityCurrentTick: this.commodityCurrentTick,
      commodityUserOrderSeq: this.commodityUserOrderSeq,
      commodityTradeSeq: this.commodityTradeSeq,
      commodityResetVersion: this.commodityResetVersion,
      commoditySnapshotVersion: this.commoditySnapshotVersion,
      scenarioResetVersion: this.scenarioResetVersion,
      timestamp: this.getNowMs(),
    };
  }

  /**
   * 트랜잭션/틱 롤백 전용 심층 스냅샷 생성 (구조적 복제로 중첩 레코드 앨리어싱 차단).
   */
  public exportRollbackSnapshot(): any {
    return structuredClone(this.exportSnapshot());
  }

  /**
   * 트랜잭션/틱 롤백 전용 복원: tradeEpoch 증가 및 부팅 카탈로그 보충을 수행하지 않고 원상태로 되돌린다.
   */
  public restoreRollbackSnapshot(data: any): void {
    const cloned = structuredClone(data);
    const prevProfiles = this.profiles;
    this.applySnapshotData(cloned, { bumpTradeEpoch: false, migrateCatalog: false });
    // 기존에 캐시된 ProfileRecord 참조가 있더라도 롤백된 잔고/상태가 일관되게 보이도록 동기화한다.
    // 틱 중 추가된 프로퍼티(예: has_options_license, news_subscriptions 등)도 정확히 제거한다.
    for (const [id, restored] of this.profiles.entries()) {
      const existingObj = prevProfiles.get(id);
      if (existingObj && existingObj !== restored) {
        for (const k of Object.keys(existingObj)) {
          if (!(k in restored)) {
            delete (existingObj as any)[k];
          }
        }
        Object.assign(existingObj, restored);
        this.profiles.set(id, existingObj);
      }
    }
  }

  private applySnapshotData(
    data: any,
    options: { bumpTradeEpoch: boolean; migrateCatalog: boolean }
  ): void {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('유효하지 않은 스냅샷 형식입니다.');
    }

    const version = data.schemaVersion;
    if (version !== undefined && version !== 1 && version !== 2) {
      throw new Error(`지원하지 않는 스냅샷 버전입니다: ${String(version)}`);
    }

    if (!Array.isArray(data.profiles) || !Array.isArray(data.stocks) || !Array.isArray(data.orders)) {
      throw new Error('스냅샷에 필수 장부 데이터(profiles, stocks, orders)가 누락되었습니다.');
    }

    if (version === 2) {
      const requiredArrays = [
        'settlementLedger',
        'lpLiabilities',
        'optionSettlements',
        'bondCouponPayments',
      ];
      for (const field of requiredArrays) {
        if (!Array.isArray(data[field])) {
          throw new Error(`스냅샷(v2)에 필수 권위 데이터(${field})가 누락되었습니다.`);
        }
      }
    } else {
      // 구버전(v1) 스냅샷 마이그레이션 정책: 체결 이력이 있는데 정산 원장이 없으면 중복 정산 위험으로 복원 거절
      if (Array.isArray(data.trades) && data.trades.length > 0 && !Array.isArray(data.settlementLedger)) {
        throw new Error('구버전 스냅샷에 체결 이력은 있으나 settlementLedger가 없어 안전하게 복원할 수 없습니다.');
      }
    }

    this.stocks = new Map(data.stocks);
    this.stockPriceHistory = Array.isArray(data.stockPriceHistory) ? [...data.stockPriceHistory] : [];
    this.commodities = Array.isArray(data.commodities) ? new Map(data.commodities) : new Map();
    this.profiles = new Map(data.profiles);
    this.holdings = Array.isArray(data.holdings) ? new Map(data.holdings) : new Map();
    this.orders = new Map(data.orders);
    this.trades = Array.isArray(data.trades) ? [...data.trades] : [];
    this.optionsContracts = Array.isArray(data.optionsContracts) ? new Map(data.optionsContracts) : new Map();
    this.bonds = Array.isArray(data.bonds) ? new Map(data.bonds) : new Map();
    this.marketNews = Array.isArray(data.marketNews) ? [...data.marketNews].sort(compareMarketNews) : [];
    this.localSimulationClock = data.localSimulationClock ? { ...data.localSimulationClock } : null;
    this.pendingAdminMarketEvents = Array.isArray(data.pendingAdminMarketEvents)
      ? structuredClone(data.pendingAdminMarketEvents)
      : [];
    this.adminSettings = Array.isArray(data.adminSettings) ? new Map(data.adminSettings) : new Map();
    this.exchangeRates = Array.isArray(data.exchangeRates) ? [...data.exchangeRates] : [];
    this.institutionalPortfolios = Array.isArray(data.institutionalPortfolios)
      ? new Map(data.institutionalPortfolios)
      : new Map();
    this.playerEvents = Array.isArray(data.playerEvents) ? [...data.playerEvents] : [];
    this.activePlayerEvents = Array.isArray(data.activePlayerEvents) ? [...data.activePlayerEvents] : [];
    this.activeManipulations = Array.isArray(data.activeManipulations) ? [...data.activeManipulations] : [];
    this.scenarioRuntimeState = data.scenarioRuntimeState ? structuredClone(data.scenarioRuntimeState) : null;
    if (options.bumpTradeEpoch) {
      if (
        typeof data.scenarioResetVersion === 'number' &&
        Number.isFinite(data.scenarioResetVersion) &&
        data.scenarioResetVersion >= 0
      ) {
        this.scenarioResetVersion = Math.max(this.scenarioResetVersion, data.scenarioResetVersion) + 1;
      } else {
        this.scenarioResetVersion += 1;
      }
    } else if (
      typeof data.scenarioResetVersion === 'number' &&
      Number.isFinite(data.scenarioResetVersion) &&
      data.scenarioResetVersion >= 0
    ) {
      this.scenarioResetVersion = data.scenarioResetVersion;
    }
    this.commodityEventRuntimeState = data.commodityEventRuntimeState ? structuredClone(data.commodityEventRuntimeState) : null;
    this.botsConfig = Array.isArray(data.botsConfig) ? [...data.botsConfig] : [];
    this.settlementLedger = Array.isArray(data.settlementLedger) ? new Map(data.settlementLedger) : new Map();
    this.settlementLedgerCutoffMs =
      typeof data.settlementLedgerCutoffMs === 'number' && Number.isFinite(data.settlementLedgerCutoffMs)
        ? data.settlementLedgerCutoffMs
        : 0;
    this.settledEpochWatermarks = Array.isArray(data.settledEpochWatermarks)
      ? new Map(data.settledEpochWatermarks)
      : new Map();
    this.settledEpochIntervals = Array.isArray(data.settledEpochIntervals)
      ? new Map(data.settledEpochIntervals)
      : new Map();
    this.settledOptionEpochWatermarks = Array.isArray(data.settledOptionEpochWatermarks)
      ? new Map(data.settledOptionEpochWatermarks)
      : new Map();
    this.settledOptionEpochIntervals = Array.isArray(data.settledOptionEpochIntervals)
      ? new Map(data.settledOptionEpochIntervals)
      : new Map();
    this.settledDeterministicWatermarks = Array.isArray(data.settledDeterministicWatermarks)
      ? new Map(data.settledDeterministicWatermarks)
      : new Map();
    this.settledDeterministicIntervals = Array.isArray(data.settledDeterministicIntervals)
      ? new Map(data.settledDeterministicIntervals)
      : new Map();
    this.settledBondCouponIntervals = Array.isArray(data.settledBondCouponIntervals)
      ? new Map(data.settledBondCouponIntervals)
      : new Map();
    this.settledBondCouponQuarterIntervals = Array.isArray(data.settledBondCouponQuarterIntervals)
      ? new Map(data.settledBondCouponQuarterIntervals)
      : new Map();
    this.settledBondRedemptions = Array.isArray(data.settledBondRedemptions)
      ? new Set(data.settledBondRedemptions)
      : new Set();
    this.settledBondRedemptionWatermarkYm =
      typeof data.settledBondRedemptionWatermarkYm === 'string'
        ? data.settledBondRedemptionWatermarkYm
        : '';
    this.settledBondRedemptionWatermarkYq =
      typeof data.settledBondRedemptionWatermarkYq === 'string'
        ? data.settledBondRedemptionWatermarkYq
        : '';
    this.settledOptionExpiryKeys = Array.isArray(data.settledOptionExpiryKeys)
      ? new Set(data.settledOptionExpiryKeys)
      : new Set();
    this.settledOptionExpiryWatermarkYmd =
      typeof data.settledOptionExpiryWatermarkYmd === 'string'
        ? data.settledOptionExpiryWatermarkYmd
        : '';
    this.evictedCustomTradeIds = Array.isArray(data.evictedCustomTradeIds)
      ? new Set(data.evictedCustomTradeIds)
      : new Set();
    const restoredEpoch =
      typeof data.tradeEpoch === 'number' && Number.isFinite(data.tradeEpoch) && data.tradeEpoch >= 1
        ? data.tradeEpoch
        : 1;
    if (options.bumpTradeEpoch) {
      // 재시작 시 항상 새 tradeEpoch로 진입해 스냅샷 직전 미저장 구간과의 ID 충돌을 원천 차단한다.
      this.tradeEpoch = restoredEpoch + 1;
      this.tradeGenerationCounter += 1;
      this.tradeSeq = 0;
      this.optionTradeSeq = 0;
    } else {
      this.tradeEpoch = restoredEpoch;
      this.tradeSeq = typeof data.tradeSeq === 'number' && Number.isFinite(data.tradeSeq) ? data.tradeSeq : 0;
      this.optionTradeSeq = typeof data.optionTradeSeq === 'number' && Number.isFinite(data.optionTradeSeq) ? data.optionTradeSeq : 0;
    }
    if (typeof data.tradeCursorSeq === 'number' && Number.isFinite(data.tradeCursorSeq) && data.tradeCursorSeq >= 0) {
      this.tradeCursorSeq = Math.max(this.tradeCursorSeq, data.tradeCursorSeq);
    }
    if (typeof data.fallbackCounter === 'number' && Number.isFinite(data.fallbackCounter) && data.fallbackCounter >= 0) {
      this.fallbackCounter = data.fallbackCounter;
    }
    this.engineNextEpoch =
      typeof data.engineNextEpoch === 'number' && Number.isFinite(data.engineNextEpoch) && data.engineNextEpoch >= 1
        ? data.engineNextEpoch
        : 1;
    this.engineTickCount =
      typeof data.engineTickCount === 'number' && Number.isFinite(data.engineTickCount) && data.engineTickCount >= 0
        ? data.engineTickCount
        : 0;
    this.enginePartialFillSequence =
      typeof data.enginePartialFillSequence === 'number' && Number.isFinite(data.enginePartialFillSequence) && data.enginePartialFillSequence >= 0
        ? data.enginePartialFillSequence
        : 0;
    this.lpLiabilities = Array.isArray(data.lpLiabilities) ? new Map(data.lpLiabilities) : new Map();
    this.lpQuoteGeneration =
      typeof data.lpQuoteGeneration === 'number' && Number.isFinite(data.lpQuoteGeneration)
        ? data.lpQuoteGeneration
        : 0;
    if (Array.isArray(data.lpAccounts)) {
      this.lpAccounts = new Set(data.lpAccounts);
    }
    this.optionSettlements = Array.isArray(data.optionSettlements) ? [...data.optionSettlements] : [];
    this.bondCouponPayments = Array.isArray(data.bondCouponPayments) ? [...data.bondCouponPayments] : [];
    this.commodityPositions = Array.isArray(data.commodityPositions)
      ? new Map(data.commodityPositions)
      : new Map();
    this.commodityMarginReservations = Array.isArray(data.commodityMarginReservations)
      ? new Map(data.commodityMarginReservations)
      : new Map();
    this.commoditySettlementLedger = Array.isArray(data.commoditySettlementLedger)
      ? new Map(data.commoditySettlementLedger)
      : new Map();
    this.commodityOpenOrders = Array.isArray(data.commodityOpenOrders)
      ? new Map(data.commodityOpenOrders)
      : new Map();
    this.commoditySettledEpochWatermarks = Array.isArray(data.commoditySettledEpochWatermarks)
      ? new Map(data.commoditySettledEpochWatermarks)
      : new Map();
    this.commoditySettledEpochIntervals = Array.isArray(data.commoditySettledEpochIntervals)
      ? new Map(data.commoditySettledEpochIntervals)
      : new Map();
    this.commodityEvictedCustomTradeIds = Array.isArray(data.commodityEvictedCustomTradeIds)
      ? new Set(data.commodityEvictedCustomTradeIds)
      : new Set();
    this.commodityNextEpoch =
      typeof data.commodityNextEpoch === 'number' && Number.isFinite(data.commodityNextEpoch) && data.commodityNextEpoch >= 1
        ? data.commodityNextEpoch
        : 1;
    this.commodityCurrentTick =
      typeof data.commodityCurrentTick === 'number' && Number.isFinite(data.commodityCurrentTick)
        ? data.commodityCurrentTick
        : 0;
    this.commodityUserOrderSeq =
      typeof data.commodityUserOrderSeq === 'number' && Number.isFinite(data.commodityUserOrderSeq)
        ? data.commodityUserOrderSeq
        : 0;
    this.commodityTradeSeq =
      typeof data.commodityTradeSeq === 'number' && Number.isFinite(data.commodityTradeSeq)
        ? data.commodityTradeSeq
        : 0;
    if (options.bumpTradeEpoch) {
      if (
        typeof data.commodityResetVersion === 'number' &&
        Number.isFinite(data.commodityResetVersion) &&
        data.commodityResetVersion >= 0
      ) {
        this.commodityResetVersion = Math.max(this.commodityResetVersion, data.commodityResetVersion);
      }
      if (
        typeof data.commoditySnapshotVersion === 'number' &&
        Number.isFinite(data.commoditySnapshotVersion) &&
        data.commoditySnapshotVersion >= 0
      ) {
        this.commoditySnapshotVersion = Math.max(this.commoditySnapshotVersion, data.commoditySnapshotVersion) + 1;
      } else {
        this.commoditySnapshotVersion += 1;
      }
    } else {
      if (
        typeof data.commodityResetVersion === 'number' &&
        Number.isFinite(data.commodityResetVersion) &&
        data.commodityResetVersion >= 0
      ) {
        this.commodityResetVersion = data.commodityResetVersion;
      }
      if (
        typeof data.commoditySnapshotVersion === 'number' &&
        Number.isFinite(data.commoditySnapshotVersion) &&
        data.commoditySnapshotVersion >= 0
      ) {
        this.commoditySnapshotVersion = data.commoditySnapshotVersion;
      }
    }

    // 복원 시 LP 옵션 계좌가 없으면 보장 (구버전 스냅샷 호환)
    if (!this.profiles.has('bot_options_mm_001')) {
      const optionsLpProfile: ProfileRecord = {
        id: 'bot_options_mm_001',
        user_id: 'bot_options_mm_001',
        username: '옵션 마켓메이커 LP',
        nickname: '옵션 마켓메이커 LP',
        cash: 10_000_000_000_000,
        net_worth: 10_000_000_000_000,
        rank_tier: 'LP',
        is_admin: false,
        created_at: this.getIsoTimestamp(),
      };
      this.profiles.set('bot_options_mm_001', optionsLpProfile);
    }

    this.rebuildIndexes();

    if (options.migrateCatalog) {
      this.migrateLegacyStockListingFlags();
      this.migrateLegacyIdxOptionUnderlyings();
      this.migrateLegacySeedBonds();
      this.supplementMissingCatalogStocks();
      this.supplementFutureOptionContracts();
    }
  }

  /**
   * 구버전 스냅샷 상장 상태 마이그레이션:
   * 기존 시드/상장 종목에 is_listed가 누락(undefined)된 경우 true로 보정하고,
   * 명시적으로 상장 폐지된(is_listed === false) 종목은 그대로 보존한다.
   */
  public migrateLegacyStockListingFlags(): number {
    let migrated = 0;
    for (const stock of this.stocks.values()) {
      if (stock.is_listed === undefined) {
        stock.is_listed = true;
        migrated++;
      }
    }
    return migrated;
  }

  /**
   * 구버전 스냅샷 내장 시드 채권 마이그레이션:
   * 알려진 내장 시드 채권(bond_kr_*, bond_us_*, bond_corp_*)에 명시적 ISO maturity_date와
   * quote_base(100 기준 호가 -> face_value 10,000 환산)가 누락된 경우에만 멱등적으로 보완한다.
   * 비표준/모호한 사용자·테스트 채권은 임의 변환하지 않고 fail-closed 검증에 맡긴다.
   */
  public migrateLegacySeedBonds(): number {
    const SEED_BOND_YEARS: Record<string, number> = {
      bond_kr_2y: 2,
      bond_kr_5y: 5,
      bond_kr_10y: 10,
      bond_us_2y: 2,
      bond_us_10y: 10,
      bond_corp_ig: 3,
      bond_corp_hy: 3,
    };
    const baseMs = this.executionContext ? this.getNowMs() : Date.now();
    const heldBondIds = new Set(
      Array.from(this.holdings.values()).filter(h => h.quantity > 0).map(h => h.stock_id)
    );
    let migrated = 0;
    for (const [bondId, years] of Object.entries(SEED_BOND_YEARS)) {
      const bond = this.bonds.get(bondId);
      if (!bond) continue;
      let changed = false;
      if (!bond.maturity_date || /^\s*\d+\s*[YMDW]\s*$/i.test(bond.maturity_date)) {
        // A relative tenor cannot determine an existing holder's redemption date.
        // Preserve it for explicit reconciliation instead of extending it on restart.
        if (!heldBondIds.has(bondId)) {
          bond.maturity_date = new Date(baseMs + years * 365 * 24 * 60 * 60 * 1000).toISOString();
          changed = true;
        }
      }
      if (bond.quote_base === undefined && bond.face_value >= 1000 && bond.current_price < 500) {
        bond.quote_base = 100;
        changed = true;
      }
      if (bond.payments_per_year === undefined) {
        bond.payments_per_year = 4;
        changed = true;
      }
      if (changed) migrated++;
    }
    return migrated;
  }

  /**
   * 구버전 스냅샷 마이그레이션: asset_class === 'IDX'이면서 지수형 행사가(< 1000)인데
   * underlying_stock_id가 개별 주식(예: 0010 오성전자)을 가리키는 계약만 지수 기준 ID('idx_k200')로 교정한다.
   * 기존 계약의 행사가·만기일·승수는 절대 변경하지 않는다.
   */
  public migrateLegacyIdxOptionUnderlyings(): number {
    let migrated = 0;
    const heldContractIds = new Set<string>();
    for (const h of this.holdings.values()) {
      if ((h.quantity ?? 0) > 0) heldContractIds.add(h.stock_id);
    }
    for (const order of this.orders.values()) {
      if (order.status === 'open' || order.status === 'partial') heldContractIds.add(order.stock_id);
    }
    for (const opt of this.optionsContracts.values()) {
      if (
        opt.asset_class === 'IDX' &&
        typeof opt.strike_price === 'number' &&
        opt.strike_price > 0 &&
        opt.strike_price < 1000 &&
        opt.underlying_stock_id !== K200_INDEX_UNDERLYING_ID &&
        this.stocks.has(opt.underlying_stock_id)
      ) {
        opt.underlying_stock_id = K200_INDEX_UNDERLYING_ID;
        migrated++;
      } else if (
        (opt.id === 'opt_c_720' || opt.id === 'opt_p_720') &&
        opt.ticker?.startsWith('IDX-K200-') &&
        opt.asset_class === 'STK' &&
        opt.strike_price === 72000 &&
        !heldContractIds.has(opt.id)
      ) {
        opt.asset_class = 'IDX';
        opt.underlying_stock_id = K200_INDEX_UNDERLYING_ID;
        opt.strike_price = 260;
        const d = new Date(opt.expiry_date || Date.now());
        if (!Number.isNaN(d.getTime())) {
          const yymm = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
          const sideChar = opt.id === 'opt_c_720' ? 'C' : 'P';
          opt.ticker = `IDX-K200-${yymm}-${sideChar}260.0`;
        }
        migrated++;
      }
    }
    return migrated;
  }

  public importSnapshot(data: any, options?: { migrateCatalog?: boolean }): void {
    this.applySnapshotData(data, {
      bumpTradeEpoch: true,
      migrateCatalog: options?.migrateCatalog !== false,
    });
  }

  // ── Pub/Sub 리스너 ──
  public subscribe(channel: string, callback: (payload: any) => void): () => void {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel)!.add(callback);
    return () => {
      this.listeners.get(channel)?.delete(callback);
    };
  }

  public subscribeSymbol(symbolId: string, callback: (payload: any) => void): () => void {
    if (!this.symbolListeners.has(symbolId)) {
      this.symbolListeners.set(symbolId, new Set());
    }
    this.symbolListeners.get(symbolId)!.add(callback);
    return () => {
      this.symbolListeners.get(symbolId)?.delete(callback);
    };
  }

  public publish(channel: string, payload: any): void {
    this.listeners.get(channel)?.forEach((cb) => {
      try {
        cb(payload);
      } catch (e) {
        console.error(`[MemoryDB] Listener error on channel ${channel}:`, e);
      }
    });

    if (payload?.stock_id || payload?.symbolId) {
      const sym = payload.stock_id || payload.symbolId;
      this.symbolListeners.get(sym)?.forEach((cb) => {
        try {
          cb(payload);
        } catch {}
      });
    }
  }
}

// ── Node.js globalThis 싱글톤 보장 (Next.js HMR 중복 인스턴스화 차단) ──
const globalForMemoryDb = globalThis as unknown as {
  __STOCKSYS_MEMORY_DB__?: MemoryDatabase;
};

export const memoryDb: MemoryDatabase =
  globalForMemoryDb.__STOCKSYS_MEMORY_DB__ ?? new MemoryDatabase();

if (process.env.NODE_ENV !== 'production') {
  globalForMemoryDb.__STOCKSYS_MEMORY_DB__ = memoryDb;
}
