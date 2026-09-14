/**
 * STOCKSYS Market Diagnostics & Metrics Engine
 *
 * Tracks diagnostic indicators with bounded memory buffers:
 * - Strategy-level stats (orders, cancels, fills, volume, maker/taker breakdown)
 * - Market quality (spread, bid/ask depth, slippage, empty book duration)
 * - Order rejection tracking by reason
 */

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
      recentRejections: this.getRecentRejections(10),
    };
  }

  public reset(): void {
    this.strategyStats.clear();
    this.rejectionLog = [];
    this.emptyBookTicks.clear();
    this.spreadHistory.clear();
  }
}
