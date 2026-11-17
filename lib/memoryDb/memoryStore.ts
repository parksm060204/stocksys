import { COMMODITY_DEFINITIONS } from '../commodities/definitions';
import type { ExchangeRateRecord } from '../repositories/types';

// ── 고정 UUID 규격 (Production 스키마 완벽 호환) ──
export const GUEST_USER_ID = '00000000-0000-4000-8000-000000000001';

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
  id: string;
  ticker: string;
  name: string;
  market: string;
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
  current_price: number;
  ytm: number;
  duration: number;
  volume: number;
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
  public adminSettings: Map<string, any> = new Map();
  public exchangeRates: ExchangeRateRecord[] = [];
  public institutionalPortfolios: Map<string, any> = new Map();
  public playerEvents: any[] = [];
  public activePlayerEvents: any[] = [];
  public activeManipulations: any[] = [];
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
  public settledOptionEpochWatermarks: Map<number, number> = new Map();
  public settledDeterministicWatermarks: Map<string, number> = new Map();
  public evictedCustomTradeIds: Set<string> = new Set();
  public tradeEpoch: number = 1;
  public tradeSeq: number = 0;
  public optionTradeSeq: number = 0;
  public engineNextEpoch: number = 1;
  public engineTickCount: number = 0;
  public enginePartialFillSequence: number = 0;
  public commodityPositions: Map<string, CommodityPositionRecord> = new Map();
  public commodityMarginReservations: Map<string, CommodityMarginReservation> = new Map();
  public commoditySettlementLedger: Map<string, CommoditySettlementEntry> = new Map();
  public commodityOpenOrders: Map<string, PersistedCommodityOrder> = new Map();
  public commoditySettledEpochWatermarks: Map<number, number> = new Map();
  public commodityEvictedCustomTradeIds: Set<string> = new Set();
  public commodityNextEpoch: number = 1;
  public commodityCurrentTick: number = 0;
  public commodityUserOrderSeq: number = 0;
  public commodityTradeSeq: number = 0;

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
    return this.executionContext ? this.executionContext.clock.now() : 1774000000000;
  }

  public getIsoTimestamp(): string {
    return new Date(this.getNowMs()).toISOString();
  }

  public generateId(prefix: string = 'id'): string {
    if (this.executionContext) {
      return this.executionContext.idGenerator.nextId(prefix);
    }
    this.fallbackCounter += 1;
    return `${prefix}_${this.fallbackCounter.toString().padStart(6, '0')}`;
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
    this.marketIndex.get(s.market)?.delete(s.id);
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
    this.profileUserIdIndex.set(p.user_id, p.id);
  }

  public ensureUserProfile(
    userId: string,
    initialData?: Partial<ProfileRecord>
  ): ProfileRecord {
    const existingId = this.profileUserIdIndex.get(userId) || userId;
    const existing = this.profiles.get(existingId);
    if (existing) return existing;

    const displayName = initialData?.username || initialData?.nickname || '익명 투자자';
    const profile: ProfileRecord = {
      id: userId,
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
    this.profiles.set(userId, profile);
    this.addProfileToIndex(profile);
    return profile;
  }

  /**
   * [원자적 업데이트] 비동기 경계 간 race condition을 방지하는 키 단위 락 큐
   */
  public async updateAtomic<T>(key: string, updater: (prev: T) => T | Promise<T>): Promise<T> {
    const prevPromise = this.lockQueues.get(key) || Promise.resolve();

    const currentPromise = prevPromise
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

  /**
   * 기본 시드 데이터 로드 (고정 UUID 규격 적용)
   */
  public seedDefaultData(): void {
    // 가상 금융 시장 시뮬레이션 종목 메타데이터 (단일 권위: market_cap = current_price * shares_outstanding)
    const stockList: {
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
    }[] = [
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

    const now = this.getNowMs();

    stockList.forEach((s, idx) => {
      // 고정 UUID 사용 (매핑 없으면 결정론적 UUID 생성)
      const id = STOCK_UUID_MAP[s.ticker] || `00000000-0000-4000-8000-${(1000 + idx).toString().padStart(12, '0')}`;
      const cp = s.current_price;
      const pc = s.previous_close;
      const cr = parseFloat((((cp - pc) / pc) * 100).toFixed(2));
      const record: StockRecord = {
        id,
        ticker: s.ticker,
        name: s.name,
        market: s.market,
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
        is_core: s.is_core ?? false,
        shares_outstanding: s.shares_outstanding,
        floating_shares: s.floating_shares,
        base_liquidity: s.base_liquidity,
        base_spread_bps: s.base_spread_bps,
        base_depth_shares: s.base_depth_shares,
        institutional_fit: s.institutional_fit,
        macro_exposure: s.macro_exposure,
      };
      this.stocks.set(id, record);
      this.addStockToIndex(record);

      // 초기 가격 이력 20건 생성
      for (let h = 20; h >= 0; h--) {
        const randJitter = (Math.sin(h * 0.5 + idx) * 0.008);
        const p = Math.round(cp * (1 + randJitter));
        this.stockPriceHistory.push({
          id: `hist_${id}_${h}`,
          stock_id: id,
          price: p,
          recorded_at: new Date(now - h * 60000).toISOString(),
        });
      }
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
    const bondList: BondRecord[] = [
      { id: 'bond_kr_2y', ticker: 'KR_GVT_2Y', name: '한국 국고채 2년', bond_type: 'govt', maturity: '2Y', coupon_rate: 3.25, face_value: 10000, current_price: 99.80, ytm: 3.35, duration: 1.92, volume: 15000 },
      { id: 'bond_kr_5y', ticker: 'KR_GVT_5Y', name: '한국 국고채 5년', bond_type: 'govt', maturity: '5Y', coupon_rate: 3.50, face_value: 10000, current_price: 98.50, ytm: 3.75, duration: 4.55, volume: 12000 },
      { id: 'bond_kr_10y', ticker: 'KR_GVT_10Y', name: '한국 국고채 10년', bond_type: 'govt', maturity: '10Y', coupon_rate: 3.75, face_value: 10000, current_price: 97.20, ytm: 4.05, duration: 8.40, volume: 8000 },
      { id: 'bond_us_2y', ticker: 'US_GVT_2Y', name: '미국 국고채 2년', bond_type: 'govt', maturity: '2Y', coupon_rate: 4.75, face_value: 10000, current_price: 99.50, ytm: 4.80, duration: 1.94, volume: 24000 },
      { id: 'bond_us_10y', ticker: 'US_GVT_10Y', name: '미국 국고채 10년', bond_type: 'govt', maturity: '10Y', coupon_rate: 4.25, face_value: 10000, current_price: 97.80, ytm: 4.35, duration: 8.25, volume: 28000 },
      { id: 'bond_corp_ig', ticker: 'KR_CORP_IG', name: '한국 우량 회사채', bond_type: 'corp_ig', maturity: '3Y', coupon_rate: 4.10, face_value: 10000, current_price: 98.80, ytm: 4.35, duration: 2.78, volume: 5000 },
      { id: 'bond_corp_hy', ticker: 'KR_CORP_HY', name: '한국 투기 회사채', bond_type: 'corp_hy', maturity: '3Y', coupon_rate: 7.25, face_value: 10000, current_price: 95.20, ytm: 7.85, duration: 2.62, volume: 3000 },
    ];
    bondList.forEach((b) => this.bonds.set(b.id, b));

    // ── 옵션 계약 시드 (현재 시점 기준 향후 3개 월물 + 기본 하위호환 계약) ──
    const optBaseMs = this.executionContext ? this.getNowMs() : Date.now();
    const expDate = new Date(optBaseMs + 30 * 24 * 60 * 60 * 1000).toISOString();
    const osId = STOCK_UUID_MAP['0010'] || '00000000-0000-4000-8000-000000000101';
    const optList: OptionContractRecord[] = [
      { id: 'opt_c_720', underlying_stock_id: osId, ticker: 'IDX-K200-2608-C260.0', asset_class: 'STK', type: 'CALL', option_type: 'CALL', strike_price: 72000, current_price: 2.15, multiplier: 250000, expiry_date: expDate, open_interest: 450, volume: 120, delta: 0.65, gamma: 0.04, theta: -0.15, implied_volatility: 0.22, created_at: this.getIsoTimestamp() },
      { id: 'opt_p_720', underlying_stock_id: osId, ticker: 'IDX-K200-2608-P260.0', asset_class: 'STK', type: 'PUT', option_type: 'PUT', strike_price: 72000, current_price: 1.85, multiplier: 250000, expiry_date: expDate, open_interest: 380, volume: 95, delta: -0.35, gamma: 0.04, theta: -0.12, implied_volatility: 0.21, created_at: this.getIsoTimestamp() },
    ];
    const k200Chain: Array<[number, number, number]> = [
      [290.0, 0.01, 30.90], [287.5, 0.01, 28.35], [285.0, 0.01, 25.35], [282.5, 0.01, 23.40],
      [280.0, 0.02, 20.85], [277.5, 0.02, 17.90], [275.0, 0.05, 16.10], [272.5, 0.09, 13.00],
      [270.0, 0.16, 10.50], [267.5, 0.31, 8.30], [265.0, 0.60, 5.90], [262.5, 1.18, 4.05],
      [260.0, 2.15, 2.57],
      [257.5, 3.60, 1.51], [255.0, 5.45, 0.85], [252.5, 7.50, 0.43], [250.0, 9.80, 0.23],
      [247.5, 12.10, 0.14], [245.0, 13.85, 0.09], [242.5, 16.65, 0.07], [240.0, 19.15, 0.05],
    ];
    const baseUtcDate = new Date(optBaseMs);
    for (let mOffset = 1; mOffset <= 3; mOffset++) {
      const mDate = new Date(Date.UTC(baseUtcDate.getUTCFullYear(), baseUtcDate.getUTCMonth() + mOffset, 15, 6, 30, 0));
      const yyyy = String(mDate.getUTCFullYear());
      const mm = String(mDate.getUTCMonth() + 1).padStart(2, '0');
      const yymm = `${yyyy.slice(2)}${mm}`;
      const monthExpiryIso = mDate.toISOString();
      const timeScale = 1 + (mOffset - 1) * 0.18;
      for (const [strike, callPx, putPx] of k200Chain) {
        const sLabel = strike.toFixed(1);
        const scaledCall = Math.max(0.01, Math.round(callPx * timeScale * 100) / 100);
        const scaledPut = Math.max(0.01, Math.round(putPx * timeScale * 100) / 100);
        optList.push(
          { id: `opt_k200_${yymm}_c_${sLabel}`, underlying_stock_id: osId, ticker: `IDX-K200-${yymm}-C${sLabel}`, asset_class: 'IDX', type: 'CALL', option_type: 'CALL', strike_price: strike, current_price: scaledCall, multiplier: 250000, expiry_date: monthExpiryIso, open_interest: 1000 + (mOffset - 1) * 200, volume: 100 + (3 - mOffset) * 40, created_at: this.getIsoTimestamp() },
          { id: `opt_k200_${yymm}_p_${sLabel}`, underlying_stock_id: osId, ticker: `IDX-K200-${yymm}-P${sLabel}`, asset_class: 'IDX', type: 'PUT', option_type: 'PUT', strike_price: strike, current_price: scaledPut, multiplier: 250000, expiry_date: monthExpiryIso, open_interest: 1000 + (mOffset - 1) * 200, volume: 100 + (3 - mOffset) * 40, created_at: this.getIsoTimestamp() },
        );
      }
    }
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
        this.trades.push(tr);
        this.addTradeToIndex(tr);
      }
    });
  }

  /**
   * 개발자용 시장 리셋 (초기 시드 상태로 완전 복원)
   */
  public resetToSeedData(): void {
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
    this.adminSettings.clear();
    this.exchangeRates = [];
    this.institutionalPortfolios.clear();
    this.settlementLedger.clear();
    this.settlementLedgerCutoffMs = 0;
    this.settledEpochWatermarks.clear();
    this.settledOptionEpochWatermarks.clear();
    this.settledDeterministicWatermarks.clear();
    this.evictedCustomTradeIds.clear();
    this.tradeEpoch += 1;
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
    this.commodityEvictedCustomTradeIds.clear();
    this.commodityNextEpoch += 1;
    this.commodityCurrentTick = 0;
    this.commodityUserOrderSeq = 0;
    this.commodityTradeSeq = 0;

    this.seedDefaultData();
    this.rebuildIndexes();
    console.log('🔄 [MemoryDB] Market state successfully reset to initial seed data.');
    this.publish('market_reset', { timestamp: this.getNowMs() });
  }

  /**
   * 정산 원장(settlementLedger)의 메모리 상한을 유지하되,
   * 단조 증가 ID(tr_e<epoch>_<seq>, opt_tr_e<epoch>_<seq>) 및
   * 결정론적 엔진 체결 ID(trade_<runId>_t<tick>_s..._f<seq>)는 에포크/runId 워터마크로 O(1) 압축하고,
   * 임의 ID만 evictedCustomTradeIds에 보존하여 타임스탬프 누락/변조 재실행도 차단한다.
   */
  public trimSettlementLedger(maxEntries: number = 10000): number {
    if (this.settlementLedger.size <= maxEntries) return 0;
    const entries = Array.from(this.settlementLedger.entries());
    const removeCount = entries.length - maxEntries;
    let maxRemovedMs = this.settlementLedgerCutoffMs;
    const monotonicRe = /^tr_e(\d+)_(\d+)$/;
    const optionMonotonicRe = /^opt_tr_e(\d+)_(\d+)$/;
    const deterministicTradeRe = /^trade_(.+?)_t\d+_s.+~.+_f(\d+)$/;

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
        const cur = this.settledEpochWatermarks.get(epoch) ?? 0;
        if (seq > cur) this.settledEpochWatermarks.set(epoch, seq);
      } else {
        const optMatch = optionMonotonicRe.exec(key);
        if (optMatch) {
          const epoch = Number(optMatch[1]);
          const seq = Number(optMatch[2]);
          const cur = this.settledOptionEpochWatermarks.get(epoch) ?? 0;
          if (seq > cur) this.settledOptionEpochWatermarks.set(epoch, seq);
        } else {
          const detMatch = deterministicTradeRe.exec(key);
          if (detMatch) {
            const runId = detMatch[1];
            const fillSeq = Number(detMatch[2]);
            const cur = this.settledDeterministicWatermarks.get(runId) ?? -1;
            if (fillSeq > cur) this.settledDeterministicWatermarks.set(runId, fillSeq);
          } else {
            this.evictedCustomTradeIds.add(key);
          }
        }
      }
      this.settlementLedger.delete(key);
    }
    this.settlementLedgerCutoffMs = maxRemovedMs;
    return removeCount;
  }

  public isTradeAlreadySettled(tradeId: string): boolean {
    if (this.settlementLedger.has(tradeId)) return true;
    const match = /^tr_e(\d+)_(\d+)$/.exec(tradeId);
    if (match) {
      const epoch = Number(match[1]);
      const seq = Number(match[2]);
      const wm = this.settledEpochWatermarks.get(epoch) ?? 0;
      if (seq <= wm) return true;
    }
    const optMatch = /^opt_tr_e(\d+)_(\d+)$/.exec(tradeId);
    if (optMatch) {
      const epoch = Number(optMatch[1]);
      const seq = Number(optMatch[2]);
      const wm = this.settledOptionEpochWatermarks.get(epoch) ?? 0;
      if (seq <= wm) return true;
    }
    const detMatch = /^trade_(.+?)_t\d+_s.+~.+_f(\d+)$/.exec(tradeId);
    if (detMatch) {
      const runId = detMatch[1];
      const fillSeq = Number(detMatch[2]);
      const wm = this.settledDeterministicWatermarks.get(runId);
      if (wm !== undefined && fillSeq <= wm) return true;
    }
    return this.evictedCustomTradeIds.has(tradeId);
  }

  /**
   * 원자재 정산 원장(commoditySettlementLedger) 트리밍:
   * 단조 ID(cm_trade_e<epoch>_t<tick>_s<seq>)는 에포크 워터마크로 압축하고,
   * 비단조 커스텀 ID는 commodityEvictedCustomTradeIds에 보존하여 단순 cap 삭제를 방지한다.
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
        const cur = this.commoditySettledEpochWatermarks.get(epoch) ?? 0;
        if (seq > cur) this.commoditySettledEpochWatermarks.set(epoch, seq);
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
      const wm = this.commoditySettledEpochWatermarks.get(epoch) ?? 0;
      if (seq <= wm) return true;
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
      adminSettings: Array.from(this.adminSettings.entries()),
      exchangeRates: [...this.exchangeRates],
      institutionalPortfolios: Array.from(this.institutionalPortfolios.entries()),
      playerEvents: [...this.playerEvents],
      activePlayerEvents: [...this.activePlayerEvents],
      activeManipulations: [...this.activeManipulations],
      botsConfig: [...this.botsConfig],
      settlementLedger: Array.from(this.settlementLedger.entries()),
      settlementLedgerCutoffMs: this.settlementLedgerCutoffMs,
      settledEpochWatermarks: Array.from(this.settledEpochWatermarks.entries()),
      settledOptionEpochWatermarks: Array.from(this.settledOptionEpochWatermarks.entries()),
      settledDeterministicWatermarks: Array.from(this.settledDeterministicWatermarks.entries()),
      evictedCustomTradeIds: Array.from(this.evictedCustomTradeIds.values()),
      tradeEpoch: this.tradeEpoch,
      tradeSeq: this.tradeSeq,
      optionTradeSeq: this.optionTradeSeq,
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
      commodityEvictedCustomTradeIds: Array.from(this.commodityEvictedCustomTradeIds.values()),
      commodityNextEpoch: this.commodityNextEpoch,
      commodityCurrentTick: this.commodityCurrentTick,
      commodityUserOrderSeq: this.commodityUserOrderSeq,
      commodityTradeSeq: this.commodityTradeSeq,
      timestamp: this.getNowMs(),
    };
  }

  public importSnapshot(data: any): void {
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
    this.marketNews = Array.isArray(data.marketNews) ? [...data.marketNews] : [];
    this.adminSettings = Array.isArray(data.adminSettings) ? new Map(data.adminSettings) : new Map();
    this.exchangeRates = Array.isArray(data.exchangeRates) ? [...data.exchangeRates] : [];
    this.institutionalPortfolios = Array.isArray(data.institutionalPortfolios)
      ? new Map(data.institutionalPortfolios)
      : new Map();
    this.playerEvents = Array.isArray(data.playerEvents) ? [...data.playerEvents] : [];
    this.activePlayerEvents = Array.isArray(data.activePlayerEvents) ? [...data.activePlayerEvents] : [];
    this.activeManipulations = Array.isArray(data.activeManipulations) ? [...data.activeManipulations] : [];
    this.botsConfig = Array.isArray(data.botsConfig) ? [...data.botsConfig] : [];
    this.settlementLedger = Array.isArray(data.settlementLedger) ? new Map(data.settlementLedger) : new Map();
    this.settlementLedgerCutoffMs =
      typeof data.settlementLedgerCutoffMs === 'number' && Number.isFinite(data.settlementLedgerCutoffMs)
        ? data.settlementLedgerCutoffMs
        : 0;
    this.settledEpochWatermarks = Array.isArray(data.settledEpochWatermarks)
      ? new Map(data.settledEpochWatermarks)
      : new Map();
    this.settledOptionEpochWatermarks = Array.isArray(data.settledOptionEpochWatermarks)
      ? new Map(data.settledOptionEpochWatermarks)
      : new Map();
    this.settledDeterministicWatermarks = Array.isArray(data.settledDeterministicWatermarks)
      ? new Map(data.settledDeterministicWatermarks)
      : new Map();
    this.evictedCustomTradeIds = Array.isArray(data.evictedCustomTradeIds)
      ? new Set(data.evictedCustomTradeIds)
      : new Set();
    const restoredEpoch =
      typeof data.tradeEpoch === 'number' && Number.isFinite(data.tradeEpoch) && data.tradeEpoch >= 1
        ? data.tradeEpoch
        : 1;
    // 재시작 시 항상 새 tradeEpoch로 진입해 스냅샷 직전 미저장 구간과의 ID 충돌을 원천 차단한다.
    this.tradeEpoch = restoredEpoch + 1;
    this.tradeSeq = 0;
    this.optionTradeSeq = 0;
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
