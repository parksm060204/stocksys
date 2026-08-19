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
import { scenarioManager } from '../scenario/ScenarioManager';

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

export class CommodityMarketEngine {
  public currentTick: number = 0;
  public commodities: Map<string, CommodityState> = new Map();
  public orderBooks: Map<string, CommodityOrderBook> = new Map();
  public eventSystem: CommodityEventSystem;
  public bots: CommodityBot[] = [];
  public tradesHistory: CommodityTrade[] = [];

  private isRunning: boolean = false;
  private intervalTimer: NodeJS.Timeout | null = null;
  private tickIntervalMs: number = 1000;
  private onTickCallbacks: ((summary: TickSummary) => void)[] = [];

  constructor(options?: {
    customDefinitions?: CommodityDefinition[];
    totalBots?: number;
    botRatios?: BotRatios;
    eventProbability?: number;
    initialTick?: number;
  }) {
    const definitions = options?.customDefinitions || COMMODITY_DEFINITIONS;

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

      this.orderBooks.set(def.id, new CommodityOrderBook(def.id));
    }

    // 2. 이벤트 시스템 초기화
    this.eventSystem = new CommodityEventSystem(options?.eventProbability ?? 0.02);

    // 3. 봇 군단 초기화
    this.bots = createBotSwarm({
      totalBots: options?.totalBots ?? 50,
      ...(options?.botRatios ? { ratios: options.botRatios } : {}),
    });

    this.currentTick = options?.initialTick ?? 0;
  }

  /**
   * [게임 루프 메인 함수] 1틱 진행
   */
  public nextTick(): TickSummary {
    this.currentTick += 1;
    const tick = this.currentTick;
    const now = Date.now();

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
      const res = book.matchOrders(state.currentPrice, tick);
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
      book.clearExpiredOrders(50, tick);
    });

    if (this.tradesHistory.length > 2000) {
      this.tradesHistory = this.tradesHistory.slice(-1000);
    }

    // ── 5. 가격 갱신 (수학 공식 적용 + 시나리오 Bias 주입) ──
    scenarioManager.stepTick();
    const priceSummaries: Record<string, { price: number; changePct: number; volume: number }> = {};

    this.commodities.forEach((state, commodityId) => {
      const match = matchResults[commodityId];
      const netBuyVolume = match ? match.netBuyVolume : 0;
      const executedVolume = match ? match.totalBuyVolume : 0;

      // 시나리오 바이어스 적용 (작전 세력 및 거시경제 충격)
      const bias = scenarioManager.getAssetBias(commodityId);
      const biasedNetBuyVolume = netBuyVolume * bias.buyBias - (netBuyVolume < 0 ? Math.abs(netBuyVolume) * bias.sellBias : 0);

      // 공식에 의한 차기 가격 산출
      const priceResult = computeNextPrice({
        currentPrice: state.currentPrice,
        commodity: state,
        tick,
        netBuyVolume: biasedNetBuyVolume,
        activeEvents,
        impactCoefficient: 0.006,
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
    const fullOrder: CommodityOrder = {
      ...order,
      id: `usr_${this.currentTick}_${Math.random().toString(36).slice(2, 7)}`,
      filled: 0,
      createdAtTick: this.currentTick,
      createdAtTime: Date.now(),
    };

    const book = this.orderBooks.get(order.commodityId);
    if (book) {
      book.addOrder(fullOrder);
    }
    return fullOrder;
  }

  /**
   * 자동 타이머 시작
   */
  public start(intervalMs: number = 1000): void {
    if (this.isRunning) return;
    this.tickIntervalMs = intervalMs;
    this.isRunning = true;
    this.intervalTimer = setInterval(() => {
      this.nextTick();
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
