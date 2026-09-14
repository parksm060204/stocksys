import { memoryDb, TradeRecord, OrderRecord } from '../../memoryDb/memoryStore';
import { MarketEvent } from './marketEventTypes';

export interface StrategyMetrics {
  ordersSubmitted: number;
  ordersCancelled: number;
  ordersFilled: number;
  volumeTraded: number;
  makerFills: number;
  takerFills: number;
  feesPaid: number;
}

export interface RejectionRecord {
  timestamp: number;
  accountId: string;
  stockId: string;
  reason: string;
}

export interface WindowStatistics {
  stockId: string;
  windowDuration: number;
  volume: number;              // 체결 수량
  turnover: number;            // 체결 대금 (KRW / USD)
  turnoverRate: number;        // 회전율 (체결 수량 / 유통주식수)
  returnRate: number;          // 구간 가격 변동률
  relativeReturn: number;      // 시장 대비 상대수익률
  spread: number | null;       // 호가 스프레드
  depthShares: number;         // 10단 호가 총 주수
  depthNotional: number;       // 10단 호가 총 금액
  relativeTurnover: number;    // 시장 대비 상대 거래대금 비중
  buyTakerVolume: number;      // Taker 매수 체결량
  sellTakerVolume: number;     // Taker 매도 체결량
  signedFlow: number;          // 순 체결량 (buyTaker - sellTaker)
  hasActualTrades: boolean;    // 실제 체결 발생 여부 (단순 호가 유지와 구분)
}

export interface LeaderStockScore {
  stockId: string;
  ticker: string;
  name: string;
  sectorId: string;
  leaderScore: number;         // 주도주 종합 점수
  leaderRank: number;          // 주도주 순위 (1, 2, 3...)
  attentionScore: number;      // 시장 관심도 점수
  attentionRank: number;       // 관심도 순위 (주도주 순위와 명확히 분리)
  relativeReturn: number;
  relativeTurnover: number;
  signedFlow: number;
}

export interface CausalTraceLog {
  timestamp: number;
  eventId?: string;
  eventType?: string;
  stockId?: string;
  agentId?: string;
  stage: 'NEWS_RECEIVED' | 'STRATEGY_DECISION' | 'ORDER_SUBMIT' | 'ORDER_FILL' | 'LEADER_UPDATE';
  details: string;
}

export class MarketDiagnostics {
  private strategyStats: Map<string, StrategyMetrics> = new Map();
  private rejectionLog: RejectionRecord[] = [];
  private readonly MAX_REJECTION_LOG = 200;

  // Market quality stats
  private emptyBookTicks: Map<string, number> = new Map();
  private spreadHistory: Map<string, number[]> = new Map();
  private readonly MAX_SPREAD_POINTS = 100;

  constructor() {
    this.strategyStats.set('value', this.createEmptyMetrics());
    this.strategyStats.set('trend', this.createEmptyMetrics());
    this.strategyStats.set('market_maker', this.createEmptyMetrics());
    this.strategyStats.set('human', this.createEmptyMetrics());
  }

  private createEmptyMetrics(): StrategyMetrics {
    return {
      ordersSubmitted: 0,
      ordersCancelled: 0,
      ordersFilled: 0,
      volumeTraded: 0,
      makerFills: 0,
      takerFills: 0,
      feesPaid: 0,
    };
  }

  public recordOrderSubmit(strategy: string): void {
    const s = this.getOrCreateStats(strategy);
    s.ordersSubmitted++;
  }

  public recordOrderCancel(strategy: string): void {
    const s = this.getOrCreateStats(strategy);
    s.ordersCancelled++;
  }

  public recordOrderFill(strategy: string, size: number, isMaker: boolean, fee: number = 0): void {
    const s = this.getOrCreateStats(strategy);
    s.ordersFilled++;
    s.volumeTraded += size;
    if (isMaker) s.makerFills++;
    else s.takerFills++;
    s.feesPaid += fee;
  }

  public recordRejection(accountId: string, stockId: string, reason: string, timestamp: number): void {
    this.rejectionLog.push({ timestamp, accountId, stockId, reason });
    if (this.rejectionLog.length > this.MAX_REJECTION_LOG) {
      this.rejectionLog.shift();
    }
  }

  public recordMarketQuality(stockId: string, spread: number | null, hasTwoSided: boolean): void {
    if (!hasTwoSided) {
      this.emptyBookTicks.set(stockId, (this.emptyBookTicks.get(stockId) || 0) + 1);
    }

    if (spread !== null) {
      let list = this.spreadHistory.get(stockId);
      if (!list) {
        list = [];
        this.spreadHistory.set(stockId, list);
      }
      list.push(spread);
      if (list.length > this.MAX_SPREAD_POINTS) {
        list.shift();
      }
    }
  }

  public getStrategyMetrics(strategy: string): StrategyMetrics {
    return { ...this.getOrCreateStats(strategy) };
  }

  public getAllStrategyMetrics(): Record<string, StrategyMetrics> {
    const result: Record<string, StrategyMetrics> = {};
    for (const [k, v] of this.strategyStats.entries()) {
      result[k] = { ...v };
    }
    return result;
  }

  public getRecentRejections(limit: number = 20): RejectionRecord[] {
    return this.rejectionLog.slice(-limit);
  }

  private causalLogs: CausalTraceLog[] = [];
  private readonly MAX_CAUSAL_LOGS = 300;
  private leaderBoard: LeaderStockScore[] = [];
  private smoothedLeaderScores: Map<string, number> = new Map(); // stockId -> smoothed score

  public recordCausalTrace(log: CausalTraceLog): void {
    this.causalLogs.push(log);
    if (this.causalLogs.length > this.MAX_CAUSAL_LOGS) {
      this.causalLogs.shift();
    }
  }

  public getCausalTraces(limit: number = 50): CausalTraceLog[] {
    return this.causalLogs.slice(-limit);
  }

  /**
   * simulationTime 기반 비중복 구간 통계 계산
   * - 최근 윈도우: [simTime - recentWindowSec, simTime]
   * - 기준선 윈도우: [simTime - recentWindowSec - baselineWindowSec, simTime - recentWindowSec]
   */
  public computeWindowStatistics(
    simTime: number,
    recentWindowSec: number = 10,
    baselineWindowSec: number = 50
  ): Map<string, WindowStatistics> {
    const statsMap = new Map<string, WindowStatistics>();
    const recentStart = Math.max(0, simTime - recentWindowSec);
    const baselineStart = Math.max(0, recentStart - baselineWindowSec);

    const stocks = Array.from(memoryDb.stocks.values());
    let marketTotalTurnover = 0;
    let marketReturnSum = 0;
    let stockReturns: Map<string, number> = new Map();

    // 1단계: 종목별 최근 구간 체결 집계
    for (const stock of stocks) {
      const stockTrades = memoryDb.tradeStockIndex.get(stock.id) || [];
      // Recent window: (recentStart, simTime] — strict open left boundary to avoid
      // double-counting trades that land exactly on recentStart (shared with baseline end).
      const recentTrades = stockTrades.filter(
        (t) => (t.simulation_time ?? simTime) > recentStart && (t.simulation_time ?? simTime) <= simTime
      );

      let volume = 0;
      let turnover = 0;
      let buyTakerVol = 0;
      let sellTakerVol = 0;

      for (const t of recentTrades) {
        volume += t.size;
        turnover += t.price * t.size;
        if (t.buyer_id && !t.seller_id) buyTakerVol += t.size;
        else if (t.seller_id && !t.buyer_id) sellTakerVol += t.size;
        else buyTakerVol += Math.round(t.size / 2); // Split if ambiguous
      }

      // 호가 뎁스 계산
      let depthShares = 0;
      let depthNotional = 0;
      const orderIds = memoryDb.orderStockIndex.get(stock.id);
      if (orderIds) {
        for (const oid of orderIds) {
          const ord = memoryDb.orders.get(oid);
          if (ord && (ord.status === 'open' || ord.status === 'partial')) {
            const rem = Math.max(0, ord.size - (ord.filled || 0));
            depthShares += rem;
            depthNotional += rem * ord.price;
          }
        }
      }

      // 가격 변동률 계산
      const hist = memoryDb.stockPriceHistory.filter((h) => h.stock_id === stock.id);
      let returnRate = 0;
      if (hist.length >= 2) {
        const firstP = hist[Math.max(0, hist.length - 10)].price;
        const lastP = hist[hist.length - 1].price;
        if (firstP > 0) returnRate = (lastP - firstP) / firstP;
      }

      marketTotalTurnover += turnover;
      marketReturnSum += returnRate;
      stockReturns.set(stock.id, returnRate);

      const floatingShares = stock.floating_shares || 10000000;
      const turnoverRate = volume / floatingShares;
      const signedFlow = buyTakerVol - sellTakerVol;

      statsMap.set(stock.id, {
        stockId: stock.id,
        windowDuration: recentWindowSec,
        volume,
        turnover,
        turnoverRate,
        returnRate,
        relativeReturn: 0, // 2단계에서 계산
        spread: this.getAverageSpread(stock.id),
        depthShares,
        depthNotional,
        relativeTurnover: 0, // 2단계에서 계산
        buyTakerVolume: buyTakerVol,
        sellTakerVolume: sellTakerVol,
        signedFlow,
        hasActualTrades: recentTrades.length > 0,
      });
    }

    // 2단계: 시장 평균 대비 상대 수치 정규화
    const avgMarketReturn = stocks.length > 0 ? marketReturnSum / stocks.length : 0;
    const avgMarketTurnover = stocks.length > 0 ? marketTotalTurnover / stocks.length : 1;

    for (const [sId, st] of statsMap.entries()) {
      st.relativeReturn = st.returnRate - avgMarketReturn;
      st.relativeTurnover = avgMarketTurnover > 0 ? st.turnover / avgMarketTurnover : 0;
    }

    return statsMap;
  }

  /**
   * 주도주 점수 갱신 및 순위 산출 (관심 순위 vs 주도주 순위 분리)
   */
  public updateLeaderBoard(simTime: number, attentionMap: Map<string, number>): LeaderStockScore[] {
    const statsMap = this.computeWindowStatistics(simTime, 10, 50);
    const scores: LeaderStockScore[] = [];

    for (const stock of memoryDb.stocks.values()) {
      const st = statsMap.get(stock.id);
      const att = attentionMap.get(stock.id) || stock.base_liquidity || 0.5;

      const relRet = st ? st.relativeReturn : 0;
      const relTurn = st ? st.relativeTurnover : 0;
      const flow = st ? st.signedFlow : 0;
      const flowRatio = st && st.volume > 0 ? flow / st.volume : 0;

      // 활동 최소 조건: 거래대금 존재 또는 실제 체결이 있을 때만 주도주 점수 인정
      let rawScore = 0;
      if (st && st.hasActualTrades && st.turnover > 0) {
        // 가중치: 상대수익률(0.40) + 상대거래대금(0.35) + 체결순방향(0.25)
        rawScore = 0.40 * Math.tanh(relRet / 0.03) + 0.35 * Math.tanh(relTurn / 2.0) + 0.25 * flowRatio;
      }

      // 지수이동평균(EMA) 평활화 (급격한 순위 점멸 방지)
      const prevSmoothed = this.smoothedLeaderScores.get(stock.id) ?? rawScore;
      const smoothed = 0.3 * rawScore + 0.7 * prevSmoothed;
      this.smoothedLeaderScores.set(stock.id, smoothed);

      scores.push({
        stockId: stock.id,
        ticker: stock.ticker,
        name: stock.name,
        sectorId: stock.sector_id || 'general',
        leaderScore: smoothed,
        leaderRank: 0,
        attentionScore: att,
        attentionRank: 0,
        relativeReturn: relRet,
        relativeTurnover: relTurn,
        signedFlow: flow,
      });
    }

    // 1. 주도주 순위 정렬 (leaderScore 내림차순)
    scores.sort((a, b) => b.leaderScore - a.leaderScore);
    scores.forEach((item, idx) => {
      item.leaderRank = idx + 1;
    });

    // 2. 관심 순위 정렬 (attentionScore 내림차순)
    const sortedByAtt = [...scores].sort((a, b) => b.attentionScore - a.attentionScore);
    sortedByAtt.forEach((item, idx) => {
      const orig = scores.find((s) => s.stockId === item.stockId);
      if (orig) orig.attentionRank = idx + 1;
    });

    this.leaderBoard = scores;
    return scores;
  }

  public getLeaderBoard(): LeaderStockScore[] {
    return [...this.leaderBoard];
  }

  public getEmptyBookDuration(stockId: string): number {
    return this.emptyBookTicks.get(stockId) || 0;
  }

  public getAverageSpread(stockId: string): number {
    const list = this.spreadHistory.get(stockId);
    if (!list || list.length === 0) return 0;
    return list.reduce((a, b) => a + b, 0) / list.length;
  }

  private getOrCreateStats(strategy: string): StrategyMetrics {
    let s = this.strategyStats.get(strategy);
    if (!s) {
      s = this.createEmptyMetrics();
      this.strategyStats.set(strategy, s);
    }
    return s;
  }

  public generateSummaryReport(stockId?: string): {
    strategyBreakdown: Record<string, StrategyMetrics>;
    marketSummary: {
      totalTrades: number;
      totalVolume: number;
      orderFillRate: number;
      rejectionCount: number;
    };
    orderBookHealth: {
      avgSpreadBps: number;
      emptyBookTicks: number;
    };
    leaderBoard: LeaderStockScore[];
    recentCausalLogs: CausalTraceLog[];
    recentRejections: RejectionRecord[];
  } {
    const strategyBreakdown = this.getAllStrategyMetrics();
    let totalOrders = 0;
    let totalFills = 0;
    let totalVolume = 0;

    for (const s of Object.values(strategyBreakdown)) {
      totalOrders += s.ordersSubmitted;
      totalFills += s.ordersFilled;
      totalVolume += s.volumeTraded;
    }

    const targetStock = stockId || (Array.from(this.spreadHistory.keys())[0] || '');
    const avgSpread = targetStock ? this.getAverageSpread(targetStock) : 0;
    const emptyTicks = targetStock ? this.getEmptyBookDuration(targetStock) : 0;

    return {
      strategyBreakdown,
      marketSummary: {
        totalTrades: totalFills,
        totalVolume,
        orderFillRate: totalOrders > 0 ? totalFills / totalOrders : 0,
        rejectionCount: this.rejectionLog.length,
      },
      orderBookHealth: {
        avgSpreadBps: avgSpread > 0 ? (avgSpread / 70000) * 10000 : 0,
        emptyBookTicks: emptyTicks,
      },
      leaderBoard: this.leaderBoard.slice(0, 5),
      recentCausalLogs: this.getCausalTraces(10),
      recentRejections: this.getRecentRejections(10),
    };
  }

  public reset(): void {
    this.strategyStats.clear();
    this.rejectionLog = [];
    this.emptyBookTicks.clear();
    this.spreadHistory.clear();
    this.causalLogs = [];
    this.leaderBoard = [];
    this.smoothedLeaderScores.clear();
  }
}
