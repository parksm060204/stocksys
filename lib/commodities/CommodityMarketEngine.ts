import { AsyncLocalStorage } from 'node:async_hooks';
import {
  CommodityDefinition,
  CommodityState,
  CommodityOrder,
  CommodityTrade,
  ActiveCommodityEvent,
  CommodityNewsItem,
  BotMarketSnapshot,
  BotState,
} from './types';
import { COMMODITY_DEFINITIONS } from './definitions';
import { computeNextPrice } from './priceEngine';
import { CommodityOrderBook, MatchResult } from './CommodityOrderBook';
import { CommodityEventSystem } from './eventSystem';
import { CommodityBot, createBotSwarm, BotRatios } from './bots';
import { ScenarioManager, syncScenarioManagerFromDatabase } from '../scenario/ScenarioManager';
import type { SimulationContext } from '../engine/simulation/runtime/simulationContext';
import { createSimulationContext } from '../engine/simulation/runtime/simulationContext';
import type { SimulationTimeSource } from '../engine/simulation/runtime/simulationTimeSource';
import type { SimulationRandomSource } from '../engine/simulation/runtime/simulationRandom';
import { SIMULATION_NAMESPACES } from '../engine/simulation/runtime/simulationNamespaces';
import type { MemoryDatabase } from '../memoryDb/memoryStore';
import { withAccountLocks } from '../memoryDb/accountLocks';
import { runWithCommitGate, persistenceManager } from '../memoryDb/PersistenceManager';
import {
  settleCommodityTradeForUsers,
  releaseCommodityOrderMargin,
  evaluateAndLiquidateCommodityMaintenanceMargin,
} from './commodityLedger';

export interface TickSummary {
  tick: number;
  timestamp: number;
  prices: Record<string, { price: number; changePct: number; volume: number }>;
  tradesCount: number;
  totalNotional: number;
  activeEventsCount: number;
  newEvents: ActiveCommodityEvent[];
  newNews: CommodityNewsItem[];
  selfTradeCancelledOrders?: CommodityOrder[];
}

export interface CommodityEngineOptions {
  customDefinitions?: CommodityDefinition[];
  totalBots?: number;
  botRatios?: BotRatios;
  eventProbability?: number;
  initialTick?: number;
  simulationContext?: SimulationContext;
  scenarioManager?: ScenarioManager;
  db?: MemoryDatabase;
  onPersist?: () => Promise<boolean>;
}

const dbCommodityEngines = new WeakMap<MemoryDatabase, Set<WeakRef<CommodityMarketEngine>>>();

function registerCommodityEngineForDb(db: MemoryDatabase, engine: CommodityMarketEngine): void {
  let set = dbCommodityEngines.get(db);
  if (!set) {
    set = new Set();
    dbCommodityEngines.set(db, set);
  }
  for (const ref of set) {
    const existing = ref.deref();
    if (!existing) {
      set.delete(ref);
    } else if (existing === engine) {
      return;
    }
  }
  set.add(new WeakRef(engine));
}

export function getAttachedCommodityEngines(db: MemoryDatabase): CommodityMarketEngine[] {
  const set = dbCommodityEngines.get(db);
  if (!set) return [];
  const active: CommodityMarketEngine[] = [];
  for (const ref of set) {
    const eng = ref.deref();
    if (!eng) {
      set.delete(ref);
    } else if (eng.getAttachedDatabase() === db) {
      active.push(eng);
    }
  }
  return active;
}

export class CommodityMarketEngine {
  public currentTick: number = 0;
  public commodities: Map<string, CommodityState> = new Map();
  public orderBooks: Map<string, CommodityOrderBook> = new Map();
  public eventSystem: CommodityEventSystem;
  public bots: CommodityBot[] = [];
  public tradesHistory: CommodityTrade[] = [];
  public readonly simContext: SimulationContext;
  public readonly clock: SimulationTimeSource;
  public readonly scenarioManager: ScenarioManager;
  private db?: MemoryDatabase;
  private onPersist?: () => Promise<boolean>;
  private readonly priceRandom: SimulationRandomSource;
  private readonly eventRandom: SimulationRandomSource;
  private readonly engineRandom: SimulationRandomSource;
  private userOrderSeq: number = 0;
  private tradeSeq: number = 0;
  private engineEpoch: number = 1;
  private isTicking: boolean = false;
  private reconciled: boolean = false;
  private reconciledDb: MemoryDatabase | null = null;
  private reconciledResetVersion: number = -1;
  private reconciledSnapshotVersion: number = -1;
  private initialRuntimeSnapshot!: ReturnType<CommodityMarketEngine['snapshotRuntime']>;
  private reconcilePromise: Promise<void> | null = null;
  private tickTail: Promise<void> = Promise.resolve();
  private tickLockStorage = new AsyncLocalStorage<symbol>();
  private activeTickToken: symbol | null = null;

  private isRunning: boolean = false;
  private intervalTimer: NodeJS.Timeout | null = null;
  private tickIntervalMs: number = 1000;
  private onTickCallbacks: ((summary: TickSummary) => void)[] = [];

  constructor(options?: CommodityEngineOptions) {
    const definitions = options?.customDefinitions || COMMODITY_DEFINITIONS;
    this.simContext = options?.simulationContext ?? createSimulationContext({ seed: 42 });
    this.clock = this.simContext.clock;
    this.db = options?.db;
    this.onPersist = options?.onPersist;
    this.engineRandom = this.simContext.fork(SIMULATION_NAMESPACES.COMMODITIES.ENGINE);
    this.eventRandom = this.simContext.fork(SIMULATION_NAMESPACES.COMMODITIES.EVENTS);
    this.priceRandom = this.simContext.fork(SIMULATION_NAMESPACES.COMMODITIES.PRICE);

    // 1. 원자재 종목 초기화
    for (const def of definitions) {
      this.commodities.set(def.id, {
        ...def,
        currentPrice: def.basePrice,
        previousPrice: def.basePrice,
        openPrice: def.basePrice,
        high: def.basePrice,
        low: def.basePrice,
        volume: 0,
        priceHistory: [{ tick: 0, price: def.basePrice, volume: 0 }],
      });

      this.orderBooks.set(def.id, new CommodityOrderBook(def.id, this.clock));
    }

    // 2. 이벤트 시스템 초기화
    this.eventSystem = new CommodityEventSystem(
      options?.eventProbability ?? 0.02,
      this.eventRandom,
      this.clock
    );

    // 3. 봇 군단 초기화
    this.bots = createBotSwarm({
      totalBots: options?.totalBots ?? 50,
      ...(options?.botRatios ? { ratios: options.botRatios } : {}),
      context: this.simContext,
      clock: this.clock,
    });

    this.currentTick = options?.initialTick ?? 0;
    this.scenarioManager = options?.scenarioManager ?? new ScenarioManager({
      clock: this.clock,
      seed: options?.simulationContext ? (options.simulationContext.seed ?? 42) : 42,
    });
    this.initialRuntimeSnapshot = this.snapshotRuntime();
    if (this.db) {
      registerCommodityEngineForDb(this.db, this);
    }
  }

  /**
   * [게임 루프 메인 함수] 1틱 진행
   */
  public nextTick(): TickSummary {
    if (this.db?.isTradingHalted?.()) {
      return {
        tick: this.currentTick,
        timestamp: this.clock.now(),
        prices: {},
        tradesCount: 0,
        totalNotional: 0,
        activeEventsCount: this.eventSystem.activeEvents.length,
        newEvents: [],
        newNews: [],
        selfTradeCancelledOrders: [],
      };
    }
    this.currentTick += 1;
    const tick = this.currentTick;
    const now = this.clock.now();

    // ── 1. 이벤트 발생 판정 & 감쇄 ──
    const { newEvents, newNews } = this.eventSystem.tick(tick);
    const activeEvents = this.eventSystem.activeEvents;

    // ── 2. 시장 스냅샷 생성 & 봇들에게 배포 ──
    const snapshot: BotMarketSnapshot = {
      tick,
      commodities: {},
      activeEvents: activeEvents.map((e) => ({ ...e })),
    };
    this.commodities.forEach((c, id) => {
      snapshot.commodities[id] = {
        currentPrice: c.currentPrice,
        high: c.high,
        low: c.low,
        volume: c.volume,
      };
    });

    for (const bot of this.bots) {
      bot.receiveMarketSnapshot(snapshot);
    }

    // ── 3. 봇들의 주문 생성 & 오더북에 제출 ──
    for (const bot of this.bots) {
      if (bot.type === 'market_maker') {
        for (const book of this.orderBooks.values()) {
          book.cancelBotOrders(bot.id);
        }
      }
      const orders = bot.generateOrders(tick);
      for (const order of orders) {
        const book = this.orderBooks.get(order.commodityId);
        if (book) {
          book.addOrder(order);
        }
      }
    }

    // ── 4. 오더북 매칭 & 체결 ──
    const botMap = new Map<string, CommodityBot>(this.bots.map((b) => [b.id, b]));
    const matchResults: Record<string, MatchResult> = {};
    let totalTickNotional = 0;
    let totalTradesCount = 0;
    const allSelfTradeCancelledOrders: CommodityOrder[] = [];

    this.commodities.forEach((state, commodityId) => {
      const book = this.orderBooks.get(commodityId)!;
      const res = book.matchOrders(state.currentPrice, tick, () => this.nextTradeId());
      matchResults[commodityId] = res;

      totalTickNotional += res.executedNotional;
      totalTradesCount += res.matchedTradesCount;
      if (res.selfTradeCancelledOrders && res.selfTradeCancelledOrders.length > 0) {
        allSelfTradeCancelledOrders.push(...res.selfTradeCancelledOrders);
      }

      // 체결 내역을 봇과 엔진 히스토리에 반영
      for (const trade of res.trades) {
        this.tradesHistory.push(trade);

        if (trade.buyerId && botMap.has(trade.buyerId)) {
          botMap.get(trade.buyerId)!.onTradeExecuted(trade, true);
        }
        if (trade.sellerId && botMap.has(trade.sellerId)) {
          botMap.get(trade.sellerId)!.onTradeExecuted(trade, false);
        }
      }

      // 오래된 미체결 주문 청소 (50틱 이상 방치 주문 제거)
      book.extractExpiredOrders(50, tick);
    });

    if (this.tradesHistory.length > 2000) {
      this.tradesHistory = this.tradesHistory.slice(-1000);
    }

    // ── 5. 가격 갱신 (수학 공식 적용 + 시나리오 Bias 주입) ──
    this.scenarioManager.stepTick('commodity');
    const priceSummaries: Record<string, { price: number; changePct: number; volume: number }> = {};

    this.commodities.forEach((state, commodityId) => {
      const match = matchResults[commodityId];
      const netBuyVolume = match ? match.netBuyVolume : 0;
      const executedVolume = match ? match.totalBuyVolume : 0;

      // 시나리오 바이어스 적용 (작전 세력 및 거시경제 충격)
      const bias = this.scenarioManager.getAssetBias(commodityId);
      const biasedNetBuyVolume = netBuyVolume * bias.buyBias - (netBuyVolume < 0 ? Math.abs(netBuyVolume) * bias.sellBias : 0);

      // 공식에 의한 차기 가격 산출
      const priceResult = computeNextPrice({
        currentPrice: state.currentPrice,
        commodity: state,
        tick,
        netBuyVolume: biasedNetBuyVolume,
        activeEvents,
        impactCoefficient: 0.006,
        random: this.priceRandom,
      });

      // 강제 추가 충격 (Event Shock) 합성
      let rawNextPrice = priceResult.nextPrice * (1 + bias.eventShock);
      if (bias.suppressVolatility) {
        // 매집 단계: 가격 급변동 억제 (현재가 기준 ±0.5% 내로 완충)
        rawNextPrice = state.currentPrice * 0.9 + rawNextPrice * 0.1;
      }

      const nextPrice = Math.max(state.tickSize, Math.round(rawNextPrice / state.tickSize) * state.tickSize);
      const changePct = state.previousPrice > 0
        ? ((nextPrice - state.previousPrice) / state.previousPrice) * 100
        : 0;

      // 상태 업데이트
      state.previousPrice = state.currentPrice;
      state.currentPrice = nextPrice;
      state.high = Math.max(state.high, nextPrice);
      state.low = Math.min(state.low, nextPrice);
      state.volume += executedVolume * bias.volumeMultiplier;

      state.priceHistory.push({
        tick,
        price: nextPrice,
        volume: executedVolume,
      });
      if (state.priceHistory.length > 500) {
        state.priceHistory.shift();
      }

      priceSummaries[commodityId] = {
        price: nextPrice,
        changePct,
        volume: executedVolume,
      };
    });

    // ── 6. 뉴스 및 급등락 모니터링 ──
    this.commodities.forEach((state) => {
      const changePct = state.previousPrice > 0
        ? ((state.currentPrice - state.previousPrice) / state.previousPrice) * 100
        : 0;

      // 1틱에 4% 이상 급변동 시 시황 뉴스 자동 생성
      if (Math.abs(changePct) >= 4.0) {
        const isSpike = changePct > 0;
        const autoNews: CommodityNewsItem = {
          id: `flash_news_${tick}_${state.id}`,
          tick,
          timestamp: now,
          category: state.category,
          title: `⚡ [시황속보] ${state.nameKo} 선물 ${isSpike ? '폭등' : '급락'}세… 틱당 ${changePct.toFixed(2)}% 변동`,
          content: `${state.nameKo} 선물 가격이 틱당 ${changePct > 0 ? '+' : ''}${changePct.toFixed(2)}% ${isSpike ? '치솟으며' : '추락하며'} ₩${state.currentPrice.toLocaleString()}에 거래 중입니다.`,
          impactSentiment: isSpike ? 'bullish' : 'bearish',
          affectedCommodities: [state.id],
        };
        this.eventSystem.newsFeed.unshift(autoNews);
        newNews.push(autoNews);
      }
    });

    const summary: TickSummary = {
      tick,
      timestamp: now,
      prices: priceSummaries,
      tradesCount: totalTradesCount,
      totalNotional: totalTickNotional,
      activeEventsCount: activeEvents.length,
      newEvents,
      newNews,
      selfTradeCancelledOrders: allSelfTradeCancelledOrders,
    };

    // 리스너 콜백 호출
    for (const cb of this.onTickCallbacks) {
      cb(summary);
    }

    return summary;
  }

  /**
   * 사용자 주문 제출 인터페이스
   */
  public submitUserOrder(order: Omit<CommodityOrder, 'id' | 'filled' | 'createdAtTick' | 'createdAtTime'>): CommodityOrder {
    if (!order || typeof order !== 'object') {
      throw new Error('유효한 주문 객체가 필요합니다.');
    }
    const commodity = this.commodities.get(order.commodityId);
    if (!commodity) {
      throw new Error(`존재하지 않는 원자재 종목입니다: ${String(order.commodityId)}`);
    }
    if (order.side !== 'buy' && order.side !== 'sell') {
      throw new Error('주문 방향(side)은 buy 또는 sell이어야 합니다.');
    }
    if (order.type !== 'limit' && order.type !== 'market') {
      throw new Error('주문 유형(type)은 limit 또는 market이어야 합니다.');
    }
    if (typeof order.size !== 'number' || !Number.isFinite(order.size) || !Number.isInteger(order.size) || order.size <= 0) {
      throw new Error('주문 수량(size)은 1 이상의 유한한 정수여야 합니다.');
    }
    if (order.type === 'limit') {
      if (typeof order.price !== 'number' || !Number.isFinite(order.price) || order.price <= 0) {
        throw new Error('지정가 주문 가격(price)은 0보다 큰 유한한 숫자여야 합니다.');
      }
    }

    const normalizedPrice = order.type === 'market' ? commodity.currentPrice : order.price;
    this.userOrderSeq += 1;
    if (this.db) {
      this.db.commodityCurrentTick = this.currentTick;
      this.db.commodityUserOrderSeq = this.userOrderSeq;
    }
    const fullOrder: CommodityOrder = {
      ...order,
      price: normalizedPrice,
      id: `usr_e${this.engineEpoch}_t${this.currentTick}_s${this.userOrderSeq}`,
      filled: 0,
      createdAtTick: this.currentTick,
      createdAtTime: this.clock.now(),
    };

    const book = this.orderBooks.get(order.commodityId);
    if (!book || !book.addOrder(fullOrder)) {
      throw new Error('오더북에 주문을 등록할 수 없습니다.');
    }
    return fullOrder;
  }

  private nextTradeId(): string {
    this.tradeSeq += 1;
    if (this.db) {
      this.db.commodityTradeSeq = this.tradeSeq;
    }
    return `cm_trade_e${this.engineEpoch}_t${this.currentTick}_s${this.tradeSeq}`;
  }

  public attachDatabase(db: MemoryDatabase): void {
    this.db = db;
    registerCommodityEngineForDb(db, this);
  }

  public getAttachedDatabase(): MemoryDatabase | undefined {
    return this.db;
  }

  public getReconcileMetadata(): {
    reconciled: boolean;
    reconciledDb: MemoryDatabase | null;
    reconciledResetVersion: number;
    reconciledSnapshotVersion: number;
  } {
    return {
      reconciled: this.reconciled,
      reconciledDb: this.reconciledDb,
      reconciledResetVersion: this.reconciledResetVersion,
      reconciledSnapshotVersion: this.reconciledSnapshotVersion,
    };
  }

  public restoreReconcileMetadata(meta: {
    reconciled: boolean;
    reconciledDb: MemoryDatabase | null;
    reconciledResetVersion: number;
    reconciledSnapshotVersion: number;
  }): void {
    this.reconciled = meta.reconciled;
    this.reconciledDb = meta.reconciledDb;
    this.reconciledResetVersion = meta.reconciledResetVersion;
    this.reconciledSnapshotVersion = meta.reconciledSnapshotVersion;
  }

  /**
   * 틱 실행과 사용자 주문 등록/취소가 오더북 및 엔진 상태를 경합 없이 직렬화하도록 보장한다.
   * (전역 락 순서: tickLock -> withAccountLocks -> commitGate)
   */
  public async runWithTickLock<T>(fn: () => Promise<T>): Promise<T> {
    const currentToken = this.tickLockStorage.getStore();
    if (currentToken && currentToken === this.activeTickToken) {
      return await fn();
    }

    let release!: () => void;
    const prev = this.tickTail;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tickTail = prev.then(() => next, () => next);
    await prev;
    const token = Symbol('commodityTickLock');
    this.activeTickToken = token;
    try {
      return await this.tickLockStorage.run(token, fn);
    } finally {
      this.activeTickToken = null;
      release();
    }
  }

  public snapshotRuntime() {
    const bookSnapshots = new Map<string, { bids: CommodityOrder[]; asks: CommodityOrder[] }>();
    this.orderBooks.forEach((book, cid) => {
      bookSnapshots.set(cid, book.snapshotState());
    });
    const commoditySnapshots = new Map<string, CommodityState>();
    this.commodities.forEach((c, cid) => {
      commoditySnapshots.set(cid, {
        ...c,
        priceHistory: c.priceHistory.map((p) => ({ ...p })),
      });
    });
    return {
      currentTick: this.currentTick,
      tradeSeq: this.tradeSeq,
      userOrderSeq: this.userOrderSeq,
      engineEpoch: this.engineEpoch,
      bookSnapshots,
      commoditySnapshots,
      tradesHistorySnapshot: this.tradesHistory.map((t) => ({ ...t })),
      botSnapshots: this.bots.map((b) => b.snapshotRuntimeState()),
      eventSystemSnapshot: this.eventSystem.snapshotState(),
      scenarioSnapshot: this.scenarioManager.snapshotState(),
      priceRandSnap: this.priceRandom.snapshot ? this.priceRandom.snapshot() : null,
      eventRandSnap: this.eventRandom.snapshot ? this.eventRandom.snapshot() : null,
      engineRandSnap: this.engineRandom.snapshot ? this.engineRandom.snapshot() : null,
    };
  }

  public restoreRuntime(snap: ReturnType<CommodityMarketEngine['snapshotRuntime']>): void {
    this.currentTick = snap.currentTick;
    this.tradeSeq = snap.tradeSeq;
    this.userOrderSeq = snap.userOrderSeq;
    this.engineEpoch = snap.engineEpoch;
    snap.bookSnapshots.forEach((bSnap, cid) => {
      this.orderBooks.get(cid)?.restoreState(bSnap);
    });
    snap.commoditySnapshots.forEach((cSnap, cid) => {
      const cur = this.commodities.get(cid);
      if (cur) {
        Object.assign(cur, {
          ...cSnap,
          priceHistory: cSnap.priceHistory.map((p) => ({ ...p })),
        });
      } else {
        this.commodities.set(cid, {
          ...cSnap,
          priceHistory: cSnap.priceHistory.map((p) => ({ ...p })),
        });
      }
    });
    this.tradesHistory = snap.tradesHistorySnapshot.map((t) => ({ ...t }));
    this.bots.forEach((b, idx) => {
      const bSnap = snap.botSnapshots[idx];
      if (bSnap) b.restoreRuntimeState(bSnap);
    });
    this.eventSystem.restoreState(snap.eventSystemSnapshot);
    this.scenarioManager.restoreState(snap.scenarioSnapshot);
    if (snap.priceRandSnap && this.priceRandom.restore) this.priceRandom.restore(snap.priceRandSnap);
    if (snap.eventRandSnap && this.eventRandom.restore) this.eventRandom.restore(snap.eventRandSnap);
    if (snap.engineRandSnap && this.engineRandom.restore) this.engineRandom.restore(snap.engineRandSnap);
  }

  private syncPricesToDatabase(targetDb: MemoryDatabase): boolean {
    let changed = false;
    this.commodities.forEach((state, cid) => {
      const existing = targetDb.commodities.get(cid);
      if (existing) {
        if (
          existing.current_price !== state.currentPrice ||
          existing.previous_close !== state.previousPrice ||
          existing.open_price !== state.openPrice ||
          existing.high_price !== state.high ||
          existing.low_price !== state.low ||
          existing.volume !== state.volume
        ) {
          existing.current_price = state.currentPrice;
          existing.previous_close = state.previousPrice;
          existing.open_price = state.openPrice;
          existing.high_price = state.high;
          existing.low_price = state.low;
          existing.volume = state.volume;
          changed = true;
        }
      } else {
        const rec = {
          id: state.id,
          commodity_id: state.id,
          ticker: state.ticker,
          name: state.nameKo,
          category: state.category,
          current_price: state.currentPrice,
          previous_close: state.previousPrice,
          unit: state.unit,
          tick_size: state.tickSize,
          volume: state.volume,
          open_price: state.openPrice,
          high_price: state.high,
          low_price: state.low,
        };
        targetDb.commodities.set(cid, rec);
        targetDb.addCommodityToIndex(rec);
        changed = true;
      }
    });
    return changed;
  }

  private isHoldingTickLock(): boolean {
    const currentToken = this.tickLockStorage.getStore();
    return Boolean(currentToken && currentToken === this.activeTickToken);
  }

  private isReconciledFor(db: MemoryDatabase): boolean {
    return (
      this.reconciled &&
      this.reconciledDb === db &&
      this.reconciledResetVersion === db.commodityResetVersion &&
      this.reconciledSnapshotVersion === db.commoditySnapshotVersion
    );
  }

  private async performReconcile(db: MemoryDatabase): Promise<void> {
    await this.runWithTickLock(async () => {
      if (this.isReconciledFor(db)) {
        return;
      }
      this.attachDatabase(db);

      const isSeedReset =
        this.reconciledResetVersion !== -1 &&
        this.reconciledResetVersion !== db.commodityResetVersion;
      const isSnapshotReplacement =
        this.reconciled &&
        !isSeedReset &&
        (this.reconciledDb !== db || this.reconciledSnapshotVersion !== db.commoditySnapshotVersion);

      const candidateUserSet = new Set<string>();
      for (const ord of db.commodityOpenOrders.values()) {
        if (ord.userId) candidateUserSet.add(ord.userId);
      }
      for (const res of db.commodityMarginReservations.values()) {
        if (res.status === 'open' || res.status === 'partial') {
          candidateUserSet.add(res.user_id);
        }
      }

      const candidateLockKeys = Array.from(candidateUserSet).map((uid) => db.resolveAccountLockKey(uid));

      await withAccountLocks(candidateLockKeys, async () => {
        if (isSeedReset) {
          this.restoreRuntime(this.initialRuntimeSnapshot);
          this.eventSystem.clear();
          this.scenarioManager.resetEmpty(true);
        } else if (isSnapshotReplacement && db.commodityCurrentTick === 0) {
          this.restoreRuntime(this.initialRuntimeSnapshot);
        }

        this.engineEpoch = db.commodityNextEpoch;
        db.commodityNextEpoch += 1;
        if (this.reconciled) {
          this.currentTick = db.commodityCurrentTick;
          this.userOrderSeq = db.commodityUserOrderSeq;
          this.tradeSeq = db.commodityTradeSeq;
        } else {
          this.currentTick = Math.max(this.currentTick, db.commodityCurrentTick);
          this.userOrderSeq = Math.max(this.userOrderSeq, db.commodityUserOrderSeq);
          this.tradeSeq = Math.max(this.tradeSeq, db.commodityTradeSeq);
        }

        syncScenarioManagerFromDatabase(db, this.scenarioManager, { clearOnDbNull: true });
        if (db.commodityEventRuntimeState && typeof db.commodityEventRuntimeState === 'object') {
          try {
            this.eventSystem.restoreState(db.commodityEventRuntimeState);
          } catch {
            if (isSeedReset || isSnapshotReplacement) {
              this.eventSystem.clear();
            }
          }
        } else if (isSeedReset || isSnapshotReplacement) {
          this.eventSystem.clear();
        }

        // 스냅샷에 저장된 원자재 가격 복원 (초기 부팅 또는 스냅샷 import 시)
        if (db.commodityCurrentTick > 0) {
          this.commodities.forEach((state, cid) => {
            const dbRec = db.commodities.get(cid);
            if (dbRec && Number.isFinite(dbRec.current_price) && dbRec.current_price > 0) {
              state.currentPrice = dbRec.current_price;
              if (Number.isFinite(dbRec.previous_close) && dbRec.previous_close > 0) {
                state.previousPrice = dbRec.previous_close;
              }
              if (Number.isFinite(dbRec.open_price) && dbRec.open_price > 0) {
                state.openPrice = dbRec.open_price;
              }
              if (Number.isFinite(dbRec.high_price) && dbRec.high_price > 0) {
                state.high = dbRec.high_price;
              }
              if (Number.isFinite(dbRec.low_price) && dbRec.low_price > 0) {
                state.low = dbRec.low_price;
              }
              if (Number.isFinite(dbRec.volume)) {
                state.volume = dbRec.volume;
              }
            }
          });
        }

        // 1. 미체결 사용자 주문 오더북 복원 (구세대 잔여 주문 완전 제거)
        for (const book of this.orderBooks.values()) {
          book.clear();
        }
        for (const [orderId, ord] of db.commodityOpenOrders.entries()) {
          const res = db.commodityMarginReservations.get(orderId);
          if (!res || (res.status !== 'open' && res.status !== 'partial') || ord.size - ord.filled <= 0) {
            db.commodityOpenOrders.delete(orderId);
            continue;
          }
          const book = this.orderBooks.get(ord.commodityId);
          if (book) {
            book.addOrder({ ...ord });
          } else {
            await releaseCommodityOrderMargin(db, orderId, 'cancelled');
          }
        }

        // 2. 오더북에 없는 고아 예약(크래시/구버전 스냅샷) 안전 환불
        for (const [orderId, res] of db.commodityMarginReservations.entries()) {
          if ((res.status === 'open' || res.status === 'partial') && !db.commodityOpenOrders.has(orderId)) {
            await releaseCommodityOrderMargin(db, orderId, 'cancelled');
          }
        }

        this.reconciledDb = db;
        this.reconciled = true;
        this.reconciledResetVersion = db.commodityResetVersion;
        this.reconciledSnapshotVersion = db.commoditySnapshotVersion;
      });
    });
  }

  /**
   * DB 스냅샷 복원 후 엔진 에포크/시퀀스를 동기화하고,
   * 미체결 주문을 오더북에 복원하거나 오더북에서 유실된 고아 예약을 안전하게 환불한다.
   * 동시 호출 시 공유 in-flight Promise를 대기하며 실패 시 다음 호출에서 재시도 가능하다.
   * 이미 tickLock을 보유한 흐름에서는 재진입하여 동시 reconcilePromise 대기로 인한 교착을 방지한다.
   */
  public async reconcileWithDatabase(db: MemoryDatabase): Promise<void> {
    if (this.isReconciledFor(db)) {
      return;
    }

    if (this.isHoldingTickLock()) {
      await this.performReconcile(db);
      return;
    }

    while (this.reconcilePromise) {
      await this.reconcilePromise;
      if (this.isReconciledFor(db)) {
        return;
      }
    }

    let pending: Promise<void> | null = null;
    pending = (async () => {
      try {
        await this.performReconcile(db);
      } finally {
        if (this.reconcilePromise === pending) {
          this.reconcilePromise = null;
        }
      }
    })();
    this.reconcilePromise = pending;

    return pending;
  }

  /**
   * 권위 런타임 틱: 오더북 매칭 후 비동기 정산·만료 환불·가격 동기화·영속 저장을 모두 완료한 뒤 틱을 확정한다.
   * 락 순서: tickLock -> withAccountLocks(후보 계좌 일체) -> commitGate
   */
  public async stepTickAsync(): Promise<TickSummary> {
    return this.runWithTickLock(async () => {
      if (
        this.db &&
        this.reconciled &&
        (this.reconciledDb !== this.db ||
          this.reconciledResetVersion !== this.db.commodityResetVersion ||
          this.reconciledSnapshotVersion !== this.db.commoditySnapshotVersion)
      ) {
        await this.reconcileWithDatabase(this.db);
      }
      const candidateUserSet = new Set<string>();
      this.orderBooks.forEach((book) => {
        for (const b of book.bids) if (b.userId) candidateUserSet.add(b.userId);
        for (const a of book.asks) if (a.userId) candidateUserSet.add(a.userId);
      });
      if (this.db) {
        for (const ord of this.db.commodityOpenOrders.values()) {
          if (ord.userId) candidateUserSet.add(ord.userId);
        }
        for (const res of this.db.commodityMarginReservations.values()) {
          if (res.status === 'open' || res.status === 'partial') {
            candidateUserSet.add(res.user_id);
          }
        }
        for (const pos of this.db.commodityPositions.values()) {
          if (pos.quantity > 0) {
            candidateUserSet.add(pos.user_id);
          }
        }
      }
      const candidateUserIds = Array.from(candidateUserSet);
      const candidateLockKeys = this.db
        ? candidateUserIds.map((uid) => this.db!.resolveAccountLockKey(uid))
        : candidateUserIds;

      return withAccountLocks(candidateLockKeys, async () => {
        const executeTick = async (): Promise<TickSummary> => {
          const prevDbScenarioSnap = this.db?.scenarioRuntimeState
            ? structuredClone(this.db.scenarioRuntimeState)
            : null;
          const prevDbEventSnap = this.db?.commodityEventRuntimeState
            ? structuredClone(this.db.commodityEventRuntimeState)
            : null;
          if (this.db) {
            syncScenarioManagerFromDatabase(this.db, this.scenarioManager);
          }
          const scenarioSnapBeforeTick = JSON.stringify(this.scenarioManager.snapshotState());
          const eventSnapBeforeTick = JSON.stringify(this.eventSystem.snapshotState());
          const runtimeSnap = this.snapshotRuntime();
          const prevDbTick = this.db?.commodityCurrentTick;
          const prevDbTradeSeq = this.db?.commodityTradeSeq;
          const prevDbUserOrderSeq = this.db?.commodityUserOrderSeq;

          const userSnapshots = new Map<string, any>();
          const posSnapshots = new Map<string, any>();
          const resSnapshots = new Map<string, any>();
          const openOrdSnapshots = new Map<string, any>();
          const dbCommoditiesSnapshot = this.db
            ? new Map(Array.from(this.db.commodities.entries()).map(([k, v]) => [k, { ...v }]))
            : null;
          const watermarkSnap = this.db ? new Map(this.db.commoditySettledEpochWatermarks) : null;
          const intervalSnap = this.db
            ? new Map(
                Array.from(this.db.commoditySettledEpochIntervals.entries()).map(([k, v]) => [
                  k,
                  v.map((iv) => [iv[0], iv[1]] as [number, number]),
                ])
              )
            : null;
          const evictedSnap = this.db ? new Set(this.db.commodityEvictedCustomTradeIds) : null;

          if (this.db) {
            for (const uid of candidateUserIds) {
              const p = this.db.resolveProfileByUserId(uid);
              if (p) userSnapshots.set(p.id, { ...p });
              for (const cid of this.commodities.keys()) {
                const pk = `${uid}_${cid}`;
                const pos = this.db.commodityPositions.get(pk);
                posSnapshots.set(pk, pos ? { ...pos } : null);
              }
            }
            for (const [k, v] of this.db.commodityMarginReservations.entries()) {
              if (v.status === 'open' || v.status === 'partial' || candidateUserSet.has(v.user_id)) {
                resSnapshots.set(k, { ...v });
              }
            }
            for (const [k, v] of this.db.commodityOpenOrders.entries()) {
              openOrdSnapshots.set(k, { ...v });
            }
          }

          let tickTrades: CommodityTrade[] = [];
          try {
            const summary = this.nextTick();
            let userMutations = 0;
            let dbPricesSynced = false;

            if (this.db) {
              this.db.commodityCurrentTick = this.currentTick;
              this.db.commodityTradeSeq = this.tradeSeq;
              this.db.commodityUserOrderSeq = this.userOrderSeq;
              dbPricesSynced = this.syncPricesToDatabase(this.db);

              const nextScenarioSnap = this.scenarioManager.snapshotState();
              const scenarioChanged =
                JSON.stringify(nextScenarioSnap) !== scenarioSnapBeforeTick ||
                (prevDbScenarioSnap === null &&
                  (nextScenarioSnap.activeScenarios.length > 0 || nextScenarioSnap.activeMacroShocks.length > 0));
              if (
                prevDbScenarioSnap !== null ||
                nextScenarioSnap.activeScenarios.length > 0 ||
                nextScenarioSnap.activeMacroShocks.length > 0
              ) {
                this.db.scenarioRuntimeState = nextScenarioSnap;
              }

              const nextEventSnap = this.eventSystem.snapshotState();
              const hasEventPayload =
                nextEventSnap.activeEvents.length > 0 ||
                nextEventSnap.newsFeed.length > 0 ||
                nextEventSnap.eventHistory.length > 0 ||
                (nextEventSnap.manualSequence ?? 0) > 0;
              const shouldSyncDbEventState = prevDbEventSnap !== null || hasEventPayload;
              const nextEventSnapJson = shouldSyncDbEventState ? JSON.stringify(nextEventSnap) : '';
              const eventStateChanged =
                shouldSyncDbEventState &&
                (nextEventSnapJson !== eventSnapBeforeTick ||
                  nextEventSnapJson !== JSON.stringify(prevDbEventSnap));
              if (shouldSyncDbEventState) {
                this.db.commodityEventRuntimeState = nextEventSnap;
              }

              tickTrades = this.tradesHistory.filter((t) => t.tick === this.currentTick);

              for (const trade of tickTrades) {
                const buyerIsUser = Boolean(trade.buyerId && !this.bots.some((b) => b.id === trade.buyerId));
                const sellerIsUser = Boolean(trade.sellerId && !this.bots.some((b) => b.id === trade.sellerId));
                if (buyerIsUser || sellerIsUser) {
                  const state = this.commodities.get(trade.commodityId);
                  if (state) {
                    await settleCommodityTradeForUsers(this.db, trade, state);
                    userMutations += 1;
                  }
                }
              }

              const activeBookOrderIds = new Set<string>();
              this.orderBooks.forEach((book) => {
                for (const b of book.bids) activeBookOrderIds.add(b.id);
                for (const a of book.asks) activeBookOrderIds.add(a.id);
              });
              const selfTradeCancelledIds = new Set(
                (summary.selfTradeCancelledOrders || []).map((o) => o.id)
              );
              for (const [orderId, res] of this.db.commodityMarginReservations.entries()) {
                if ((res.status === 'open' || res.status === 'partial') && !activeBookOrderIds.has(orderId)) {
                  const releaseStatus = selfTradeCancelledIds.has(orderId) ? 'cancelled' : 'expired';
                  const refunded = await releaseCommodityOrderMargin(this.db, orderId, releaseStatus);
                  if (refunded) userMutations += 1;
                }
              }

              const liquidatedCount = await evaluateAndLiquidateCommodityMaintenanceMargin(
                this.db,
                this.commodities,
                (cid, oid) => this.removeUserOrder(cid, oid)
              );
              if (liquidatedCount > 0) {
                userMutations += liquidatedCount;
              }

              if ((userMutations > 0 || dbPricesSynced || scenarioChanged || eventStateChanged) && this.onPersist) {
                const saved = await this.onPersist();
                if (!saved) {
                  throw new Error('원자재 틱 정산 영속 저장에 실패했습니다.');
                }
              }
            }

            return summary;
          } catch (err) {
            this.restoreRuntime(runtimeSnap);

            if (this.db) {
              this.db.scenarioRuntimeState = prevDbScenarioSnap;
              this.db.commodityEventRuntimeState = prevDbEventSnap;
              if (prevDbTick !== undefined) this.db.commodityCurrentTick = prevDbTick;
              if (prevDbTradeSeq !== undefined) this.db.commodityTradeSeq = prevDbTradeSeq;
              if (prevDbUserOrderSeq !== undefined) this.db.commodityUserOrderSeq = prevDbUserOrderSeq;

              if (dbCommoditiesSnapshot) {
                this.db.commodities = dbCommoditiesSnapshot;
                this.db.rebuildIndexes();
              }
              for (const [uid, prevP] of userSnapshots.entries()) {
                const curP = this.db.profiles.get(uid);
                if (curP) {
                  for (const k of Object.keys(curP)) {
                    if (!(k in prevP)) delete (curP as any)[k];
                  }
                  Object.assign(curP, prevP);
                } else {
                  this.db.profiles.set(uid, prevP);
                }
              }
              for (const [pk, prevPos] of posSnapshots.entries()) {
                if (prevPos) this.db.commodityPositions.set(pk, prevPos);
                else this.db.commodityPositions.delete(pk);
              }
              for (const [ok, prevRes] of resSnapshots.entries()) {
                this.db.commodityMarginReservations.set(ok, prevRes);
              }
              for (const [ok, prevOrd] of openOrdSnapshots.entries()) {
                if (prevOrd) this.db.commodityOpenOrders.set(ok, prevOrd);
                else this.db.commodityOpenOrders.delete(ok);
              }
              for (const t of tickTrades) {
                this.db.commoditySettlementLedger.delete(t.id);
              }
              if (watermarkSnap) this.db.commoditySettledEpochWatermarks = watermarkSnap;
              if (intervalSnap) this.db.commoditySettledEpochIntervals = intervalSnap;
              if (evictedSnap) this.db.commodityEvictedCustomTradeIds = evictedSnap;
            }
            throw err;
          }
        };

        return runWithCommitGate(
          this.onPersist,
          executeTick,
          this.onPersist ? undefined : persistenceManager
        );
      });
    });
  }

  public removeUserOrder(commodityId: string, orderId: string): CommodityOrder | null {
    const book = this.orderBooks.get(commodityId);
    if (!book) return null;
    return book.removeOrder(orderId);
  }

  public restoreUserOrder(commodityId: string, order: CommodityOrder): void {
    const book = this.orderBooks.get(commodityId);
    if (book) {
      book.addOrder(order);
    }
  }

  /**
   * 자동 타이머 시작 (DB 복원·조정 완료 후 호출해야 함)
   */
  public start(intervalMs: number = 1000, onPersist?: () => Promise<boolean>): void {
    if (onPersist) this.onPersist = onPersist;
    if (this.isRunning) return;
    this.tickIntervalMs = intervalMs;
    this.isRunning = true;
    this.intervalTimer = setInterval(() => {
      if (this.isTicking) return;
      this.isTicking = true;
      void this.stepTickAsync()
        .catch((err) => {
          console.error('[CommodityMarketEngine] Tick execution error:', err);
        })
        .finally(() => {
          this.isTicking = false;
        });
    }, this.tickIntervalMs);
  }

  /**
   * 타이머 중지
   */
  public stop(): void {
    if (!this.isRunning) return;
    if (this.intervalTimer) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    this.isRunning = false;
  }

  public onTick(callback: (summary: TickSummary) => void): () => void {
    this.onTickCallbacks.push(callback);
    return () => {
      this.onTickCallbacks = this.onTickCallbacks.filter((cb) => cb !== callback);
    };
  }

  public getCommodity(id: string): CommodityState | undefined {
    return this.commodities.get(id);
  }

  public getAllCommodities(): CommodityState[] {
    return Array.from(this.commodities.values());
  }

  public getOrderBook(id: string): CommodityOrderBook | undefined {
    return this.orderBooks.get(id);
  }

  public getActiveEvents(): ActiveCommodityEvent[] {
    return this.eventSystem.activeEvents;
  }

  public getNewsFeed(): CommodityNewsItem[] {
    return this.eventSystem.newsFeed;
  }

  public getBotStates(): BotState[] {
    return this.bots.map((b) => b.getState());
  }
}
