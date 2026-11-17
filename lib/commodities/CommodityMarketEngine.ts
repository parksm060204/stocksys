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
import { ScenarioManager } from '../scenario/ScenarioManager';
import type { SimulationContext } from '../engine/simulation/runtime/simulationContext';
import { createSimulationContext } from '../engine/simulation/runtime/simulationContext';
import type { SimulationTimeSource } from '../engine/simulation/runtime/simulationTimeSource';
import type { SimulationRandomSource } from '../engine/simulation/runtime/simulationRandom';
import { SIMULATION_NAMESPACES } from '../engine/simulation/runtime/simulationNamespaces';
import type { MemoryDatabase } from '../memoryDb/memoryStore';
import { withAccountLocks } from '../memoryDb/accountLocks';
import { runWithCommitGate } from '../memoryDb/PersistenceManager';
import { settleCommodityTradeForUsers, releaseCommodityOrderMargin } from './commodityLedger';

export interface TickSummary {
  tick: number;
  timestamp: number;
  prices: Record<string, { price: number; changePct: number; volume: number }>;
  tradesCount: number;
  totalNotional: number;
  activeEventsCount: number;
  newEvents: ActiveCommodityEvent[];
  newNews: CommodityNewsItem[];
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
  }

  /**
   * [게임 루프 메인 함수] 1틱 진행
   */
  public nextTick(): TickSummary {
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
      activeEvents: [...activeEvents],
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

    this.commodities.forEach((state, commodityId) => {
      const book = this.orderBooks.get(commodityId)!;
      const res = book.matchOrders(state.currentPrice, tick, () => this.nextTradeId());
      matchResults[commodityId] = res;

      totalTickNotional += res.executedNotional;
      totalTradesCount += res.matchedTradesCount;

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
    this.scenarioManager.stepTick();
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

  /**
   * DB 스냅샷 복원 후 엔진 에포크/시퀀스를 동기화하고,
   * 미체결 주문을 오더북에 복원하거나 오더북에서 유실된 고아 예약을 안전하게 환불한다.
   */
  public async reconcileWithDatabase(db: MemoryDatabase): Promise<void> {
    this.db = db;
    if (this.reconciled) return;
    this.reconciled = true;

    this.engineEpoch = db.commodityNextEpoch;
    db.commodityNextEpoch += 1;
    this.currentTick = Math.max(this.currentTick, db.commodityCurrentTick);
    this.userOrderSeq = Math.max(this.userOrderSeq, db.commodityUserOrderSeq);
    this.tradeSeq = Math.max(this.tradeSeq, db.commodityTradeSeq);

    // 1. 미체결 사용자 주문 오더북 복원
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
  }

  /**
   * 권위 런타임 틱: 오더북 매칭 후 비동기 정산·만료 환불·영속 저장을 모두 완료한 뒤 틱을 확정한다.
   * 락 순서: tickLock -> withAccountLocks(후보 계좌 일체) -> commitGate
   */
  public async stepTickAsync(): Promise<TickSummary> {
    return this.runWithTickLock(async () => {
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
      }
      const candidateUserIds = Array.from(candidateUserSet);

      return withAccountLocks(candidateUserIds, async () => {
        const executeTick = async (): Promise<TickSummary> => {
          const prevTick = this.currentTick;
          const prevTradeSeq = this.tradeSeq;
          const prevUserOrderSeq = this.userOrderSeq;
          const prevDbTick = this.db?.commodityCurrentTick;
          const prevDbTradeSeq = this.db?.commodityTradeSeq;

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
          const tradesHistorySnapshot = this.tradesHistory.map((t) => ({ ...t }));
          const botSnapshots = this.bots.map((b) => b.snapshotRuntimeState());
          const eventSystemSnapshot = this.eventSystem.snapshotState();
          const scenarioSnapshot = this.scenarioManager.snapshotState();
          const priceRandSnap = this.priceRandom.snapshot ? this.priceRandom.snapshot() : null;
          const eventRandSnap = this.eventRandom.snapshot ? this.eventRandom.snapshot() : null;
          const engineRandSnap = this.engineRandom.snapshot ? this.engineRandom.snapshot() : null;

          const userSnapshots = new Map<string, any>();
          const posSnapshots = new Map<string, any>();
          const resSnapshots = new Map<string, any>();
          const openOrdSnapshots = new Map<string, any>();
          const watermarkSnap = this.db ? new Map(this.db.commoditySettledEpochWatermarks) : null;
          const evictedSnap = this.db ? new Set(this.db.commodityEvictedCustomTradeIds) : null;

          if (this.db) {
            for (const uid of candidateUserIds) {
              const p = this.db.profiles.get(uid);
              if (p) userSnapshots.set(uid, { ...p });
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
            if (this.db) {
              this.db.commodityCurrentTick = this.currentTick;
              this.db.commodityTradeSeq = this.tradeSeq;
            }

            const botMap = new Map<string, CommodityBot>(this.bots.map((b) => [b.id, b]));
            let userMutations = 0;

            if (this.db) {
              tickTrades = this.tradesHistory.filter((t) => t.tick === this.currentTick);

              for (const trade of tickTrades) {
                const buyerIsUser = Boolean(trade.buyerId && !botMap.has(trade.buyerId));
                const sellerIsUser = Boolean(trade.sellerId && !botMap.has(trade.sellerId));
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
              for (const [orderId, res] of this.db.commodityMarginReservations.entries()) {
                if ((res.status === 'open' || res.status === 'partial') && !activeBookOrderIds.has(orderId)) {
                  const refunded = await releaseCommodityOrderMargin(this.db, orderId, 'expired');
                  if (refunded) userMutations += 1;
                }
              }

              if (userMutations > 0 && this.onPersist) {
                const saved = await this.onPersist();
                if (!saved) {
                  throw new Error('원자재 틱 정산 영속 저장에 실패했습니다.');
                }
              }
            }

            return summary;
          } catch (err) {
            this.currentTick = prevTick;
            this.tradeSeq = prevTradeSeq;
            this.userOrderSeq = prevUserOrderSeq;
            bookSnapshots.forEach((snap, cid) => {
              this.orderBooks.get(cid)?.restoreState(snap);
            });
            commoditySnapshots.forEach((snap, cid) => {
              const cur = this.commodities.get(cid);
              if (cur) Object.assign(cur, snap);
              else this.commodities.set(cid, snap);
            });
            this.tradesHistory = tradesHistorySnapshot;
            this.bots.forEach((b, idx) => {
              const snap = botSnapshots[idx];
              if (snap) b.restoreRuntimeState(snap);
            });
            this.eventSystem.restoreState(eventSystemSnapshot);
            this.scenarioManager.restoreState(scenarioSnapshot);
            if (priceRandSnap && this.priceRandom.restore) this.priceRandom.restore(priceRandSnap);
            if (eventRandSnap && this.eventRandom.restore) this.eventRandom.restore(eventRandSnap);
            if (engineRandSnap && this.engineRandom.restore) this.engineRandom.restore(engineRandSnap);

            if (this.db) {
              if (prevDbTick !== undefined) this.db.commodityCurrentTick = prevDbTick;
              if (prevDbTradeSeq !== undefined) this.db.commodityTradeSeq = prevDbTradeSeq;

              for (const [uid, prevP] of userSnapshots.entries()) {
                const curP = this.db.profiles.get(uid);
                if (curP) Object.assign(curP, prevP);
                else this.db.profiles.set(uid, prevP);
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
              if (evictedSnap) this.db.commodityEvictedCustomTradeIds = evictedSnap;
            }
            throw err;
          }
        };

        return this.onPersist ? runWithCommitGate(this.onPersist, executeTick) : executeTick();
      });
    });
  }

  public removeUserOrder(commodityId: string, orderId: string): CommodityOrder | null {
    const book = this.orderBooks.get(commodityId);
    if (!book) return null;
    return book.removeOrder(orderId);
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
