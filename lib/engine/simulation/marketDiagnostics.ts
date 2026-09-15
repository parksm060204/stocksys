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

export interface MarketFlowTimeSeriesPoint {
  timestamp: number;              // simTime (epoch ms)
  timeLabel: string;              // "HH:mm:ss"
  totalTurnover: number;          // 전체 체결 대금
  sectorTurnover: Record<string, number>;        // 섹터별 체결 대금 (KRW)
  sectorTurnoverShare: Record<string, number>;   // 섹터별 거래대금 비중 (%)
  sectorBotNetTurnover: Record<string, number>;  // 봇 집단 순매수 거래대금 (Signed Net Buy Turnover = Bot Buy - Bot Sell)
  sectorAvgAttention: Record<string, number>;    // 섹터별 평균 관심도 (0.0 ~ 1.0)
  topLeaders: {
    stockId: string;
    ticker: string;
    name: string;
    sectorId: string;
    leaderRank: number;
    leaderScore: number;
    attentionRank: number;
    attentionScore: number;
    spreadBps: number;
    depthNotional: number;
  }[];
  newsEvent?: {
    id: string;
    headline: string;
    targetSector?: string;
    targetStockId?: string;
    urgency: number;
    impactDirection?: number;
  };
  newsEvents?: NonNullable<MarketFlowTimeSeriesPoint['newsEvent']>[];
}

export interface SectorFlowSummary {
  sectorId: string;
  sectorName: string;
  turnover: number;
  turnoverShare: number;
  botNetTurnover: number;
  avgAttention: number;
  stockCount: number;
  leadStockName: string;
  leadStockRank: number;
}

export const SECTOR_METADATA: Record<string, { nameKo: string; color: string }> = {
  semiconductor: { nameKo: '반도체', color: '#06B6D4' },
  finance: { nameKo: '금융', color: '#F59E0B' },
  it: { nameKo: 'IT·플랫폼', color: '#8B5CF6' },
  auto: { nameKo: '자동차·모빌리티', color: '#10B981' },
  bio: { nameKo: '바이오·헬스케어', color: '#EC4899' },
  energy: { nameKo: '에너지·화학', color: '#F97316' },
  telecom: { nameKo: '통신·네트워크', color: '#3B82F6' },
  index: { nameKo: '지수·ETF', color: '#94A3B8' },
  general: { nameKo: '일반제조', color: '#64748B' },
};

export interface CausalTraceLog {
  timestamp: number;
  eventId?: string;
  eventIds?: string[];
  eventType?: string;
  stockId?: string;
  agentId?: string;
  decisionId?: string;
  orderId?: string;
  tradeId?: string;
  stage: 'NEWS_RECEIVED' | 'STRATEGY_DECISION' | 'ORDER_SUBMIT' | 'ORDER_FILL' | 'LEADER_UPDATE';
  details: string;
}

export class MarketDiagnostics {
  private strategyStats: Map<string, StrategyMetrics> = new Map();
  private rejectionLog: RejectionRecord[] = [];
  private readonly MAX_REJECTION_LOG = 200;

  // Time-series history ring buffer for synchronized flow dashboard
  private timeSeriesHistory: MarketFlowTimeSeriesPoint[] = [];
  private readonly MAX_TIME_SERIES_POINTS = 120;
  private lastSnapshotSimTime: number = 0;

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
    if (!Number.isFinite(simTime)) {
      throw new RangeError(`simTime must be a finite epoch-millisecond timestamp: ${simTime}`);
    }
    const recentDelta = recentWindowSec * 1000;
    const baselineDelta = baselineWindowSec * 1000;
    const recentStart = Math.max(0, simTime - recentDelta);
    const baselineStart = Math.max(0, recentStart - baselineDelta);

    const stocks = Array.from(memoryDb.stocks.values());
    let marketTotalTurnover = 0;
    let marketReturnSum = 0;
    let stockReturns: Map<string, number> = new Map();

    // 1단계: 종목별 최근 구간 체결 집계
    for (const stock of stocks) {
      const stockTrades = memoryDb.tradeStockIndex.get(stock.id) || [];
      // Recent window: (recentStart, simTime] — strict open left boundary to avoid
      // double-counting trades that land exactly on recentStart (shared with baseline end).
      const recentTrades = stockTrades.filter((t) => {
        const tTime = t.simulation_time ?? 0;
        return tTime > recentStart && tTime <= simTime;
      });

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
  public updateLeaderBoard(
    simTime: number,
    attentionMap: Map<string, number>,
    statsMap: Map<string, WindowStatistics> = this.computeWindowStatistics(simTime, 10, 50)
  ): LeaderStockScore[] {
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

  public isBotAccount(accountId?: string | null): boolean {
    if (!accountId) return false;
    return (
      accountId.startsWith('acc_') ||
      accountId.startsWith('bot_') ||
      accountId.startsWith('inst_') ||
      accountId.startsWith('lp_') ||
      accountId === 'lp_system'
    );
  }

  /**
   * 동일 시간축 시계열 스냅샷 기록
   * - 산업별 거래대금 (Turnover)
   * - 봇 집단의 실제 체결 기반 순매수 거래대금 (Signed Net Buy Turnover = Bot Buy - Bot Sell)
   * - 산업별 평균 관심도 (Attention)
   * - 상위 주도주 스냅샷 (순위, 관심순위, 스프레드, 뎁스)
   * - 최근 뉴스 이벤트 마커
   */
  public recordSnapshot(
    simTime: number,
    attentionMap: Map<string, number>,
    recentEvents?: MarketEvent[],
    statsMap?: Map<string, WindowStatistics>
  ): MarketFlowTimeSeriesPoint {
    if (!Number.isFinite(simTime)) {
      throw new RangeError(`simTime must be a finite epoch-millisecond timestamp: ${simTime}`);
    }
    const existingPoint = this.timeSeriesHistory.find((item) => item.timestamp === simTime);
    const previousSnapshotSimTime = this.lastSnapshotSimTime;
    this.lastSnapshotSimTime = simTime;

    const date = new Date(simTime);
    const timeLabel = isFinite(date.getTime())
      ? date.toTimeString().split(' ')[0]
      : `${Math.floor(simTime)}s`;

    const recentWindowSec = 10;
    const recentDelta = recentWindowSec * 1000;
    const recentStart = Math.max(0, simTime - recentDelta);

    const finalStatsMap = statsMap ?? this.computeWindowStatistics(simTime, recentWindowSec, 50);

    const sectorTurnover: Record<string, number> = {};
    const sectorTurnoverShare: Record<string, number> = {};
    const sectorBotNetTurnover: Record<string, number> = {};
    const sectorAttentionSum: Record<string, number> = {};
    const sectorStockCount: Record<string, number> = {};

    for (const secKey of Object.keys(SECTOR_METADATA)) {
      sectorTurnover[secKey] = 0;
      sectorTurnoverShare[secKey] = 0;
      sectorBotNetTurnover[secKey] = 0;
      sectorAttentionSum[secKey] = 0;
      sectorStockCount[secKey] = 0;
    }

    let totalTurnover = 0;

    // 1. 섹터별 거래대금 및 관심도 집계
    for (const stock of memoryDb.stocks.values()) {
      const secId = stock.sector_id || 'general';
      const st = finalStatsMap.get(stock.id);
      const tOver = st ? st.turnover : 0;
      sectorTurnover[secId] = (sectorTurnover[secId] || 0) + tOver;
      totalTurnover += tOver;

      const att = attentionMap.get(stock.id) || stock.base_liquidity || 0.5;
      sectorAttentionSum[secId] = (sectorAttentionSum[secId] || 0) + att;
      sectorStockCount[secId] = (sectorStockCount[secId] || 0) + 1;
    }

    // 2. 봇 집단의 실제 체결 기반 순매수 거래대금 계산 (평가액 왜곡 배제)
    for (const stock of memoryDb.stocks.values()) {
      const secId = stock.sector_id || 'general';
      const stockTrades = memoryDb.tradeStockIndex.get(stock.id) || [];
      for (const t of stockTrades) {
        const tTime = t.simulation_time !== undefined ? t.simulation_time : 0;
        if (tTime > recentStart && tTime <= simTime) {
          const tradeNotional = t.price * t.size;
          const isBuyerBot = t.buyer_is_bot || this.isBotAccount(t.buyer_id);
          const isSellerBot = t.seller_is_bot || this.isBotAccount(t.seller_id);

          if (isBuyerBot) {
            sectorBotNetTurnover[secId] = (sectorBotNetTurnover[secId] || 0) + tradeNotional;
          }
          if (isSellerBot) {
            sectorBotNetTurnover[secId] = (sectorBotNetTurnover[secId] || 0) - tradeNotional;
          }
        }
      }
    }

    // 3. 비중 및 평균 산출
    const sectorAvgAttention: Record<string, number> = {};
    for (const secKey of Object.keys(SECTOR_METADATA)) {
      const tOver = sectorTurnover[secKey] || 0;
      sectorTurnoverShare[secKey] = totalTurnover > 0 ? (tOver / totalTurnover) * 100 : 0;
      const count = sectorStockCount[secKey] || 0;
      sectorAvgAttention[secKey] = count > 0 ? (sectorAttentionSum[secKey] || 0) / count : 0.5;
    }

    // 4. 주도주 1~3위 스냅샷
    const topLeaders = this.leaderBoard.slice(0, 3).map((lb) => {
      const st = finalStatsMap.get(lb.stockId);
      const curStock = memoryDb.stocks.get(lb.stockId);
      const curPrice = curStock?.current_price || 1;
      const spread = st?.spread || this.getAverageSpread(lb.stockId);
      const spreadBps = spread > 0 ? Math.round((spread / curPrice) * 10000) : 0;

      return {
        stockId: lb.stockId,
        ticker: lb.ticker,
        name: lb.name,
        sectorId: lb.sectorId,
        leaderRank: lb.leaderRank,
        leaderScore: Number(lb.leaderScore.toFixed(3)),
        attentionRank: lb.attentionRank,
        attentionScore: Number(lb.attentionScore.toFixed(3)),
        spreadBps,
        depthNotional: st?.depthNotional || 0,
      };
    });

    // 5. 최근 뉴스 이벤트 마커
    const markerStart = existingPoint
      ? recentStart
      : Math.max(recentStart, previousSnapshotSimTime);
    const newsEvents: NonNullable<MarketFlowTimeSeriesPoint['newsEvent']>[] = (recentEvents || [])
      .filter((event) => event.publishedAt > markerStart && event.publishedAt <= simTime)
      .sort((a, b) => a.publishedAt - b.publishedAt || (a.sequence ?? 0) - (b.sequence ?? 0))
      .map((event) => ({
        id: event.eventId,
        headline: event.title,
        targetSector: event.sectorId,
        targetStockId: event.targetStockIds?.[0],
        urgency: event.attentionShock,
        impactDirection: event.valuationSignal,
      }));

    const point: MarketFlowTimeSeriesPoint = {
      timestamp: simTime,
      timeLabel,
      totalTurnover,
      sectorTurnover,
      sectorTurnoverShare,
      sectorBotNetTurnover,
      sectorAvgAttention,
      topLeaders,
      newsEvent: newsEvents[newsEvents.length - 1],
      newsEvents,
    };

    const existingPointIndex = this.timeSeriesHistory.findIndex((item) => item.timestamp === simTime);
    if (existingPointIndex >= 0) {
      this.timeSeriesHistory[existingPointIndex] = point;
    } else {
      this.timeSeriesHistory.push(point);
    }
    if (this.timeSeriesHistory.length > this.MAX_TIME_SERIES_POINTS) {
      this.timeSeriesHistory.shift();
    }

    return point;
  }

  /**
   * 시장 흐름 대시보드 종합 데이터 쿼리
   */
  public getMarketFlowData(
    simTime: number,
    pointsLimit: number = 60
  ): {
    simTime: number;
    formattedSimTime: string;
    leaderBoard: LeaderStockScore[];
    sectorSummary: SectorFlowSummary[];
    timeSeries: MarketFlowTimeSeriesPoint[];
    causalLogs: CausalTraceLog[];
    recentNews: Array<{
      id: string;
      title: string;
      content: string;
      stock_id: string | null;
      sector_id?: string | null;
      sentiment_score?: number | null;
      urgency?: number | null;
      created_at: string;
      simulation_time?: number;
    }>;
  } {
    if (!Number.isFinite(simTime)) {
      throw new RangeError(`simTime must be a finite epoch-millisecond timestamp: ${simTime}`);
    }
    const date = new Date(simTime);
    const formattedSimTime = isFinite(date.getTime())
      ? date.toTimeString().split(' ')[0]
      : `${Math.floor(simTime)}s`;

    // 최신 시계열 포인트가 없으면 즉시 하나 생성
    const latestPt = this.timeSeriesHistory[this.timeSeriesHistory.length - 1];

    // 7대 섹터 요약 구성
    const sectorSummary: SectorFlowSummary[] = Object.keys(SECTOR_METADATA).map((secKey) => {
      const meta = SECTOR_METADATA[secKey];
      const turnover = latestPt?.sectorTurnover[secKey] || 0;
      const turnoverShare = latestPt?.sectorTurnoverShare[secKey] || 0;
      const botNetTurnover = latestPt?.sectorBotNetTurnover[secKey] || 0;
      const avgAttention = latestPt?.sectorAvgAttention[secKey] || 0.5;

      const stocksInSec = Array.from(memoryDb.stocks.values()).filter(
        (s) => (s.sector_id || 'general') === secKey
      );

      // 해당 섹터 내 최상위 주도주 탐색
      const lead = this.leaderBoard.find((lb) => lb.sectorId === secKey);

      return {
        sectorId: secKey,
        sectorName: meta.nameKo,
        turnover,
        turnoverShare: Number(turnoverShare.toFixed(1)),
        botNetTurnover,
        avgAttention: Number(avgAttention.toFixed(3)),
        stockCount: stocksInSec.length,
        leadStockName: lead ? lead.name : (stocksInSec[0]?.name || '-'),
        leadStockRank: lead ? lead.leaderRank : 99,
      };
    });

    // 최근 뉴스 (최신순 10건)
    const recentNews = Array.from(memoryDb.marketNews.values())
      .sort((a, b) => {
        const timeA = a.simulation_time ?? new Date(a.created_at).getTime();
        const timeB = b.simulation_time ?? new Date(b.created_at).getTime();
        return timeB - timeA || (b.sequence ?? 0) - (a.sequence ?? 0);
      })
      .slice(0, 10)
      .map((n) => ({
        id: n.id,
        title: n.title,
        content: n.content,
        stock_id: n.target_ticker || null,
        sector_id: n.target_sector || null,
        sentiment_score: n.impact_score ?? 0,
        urgency: 0.5,
        created_at: n.created_at,
        simulation_time: n.simulation_time,
      }));

    return {
      simTime,
      formattedSimTime,
      leaderBoard: this.getLeaderBoard().slice(0, 10),
      sectorSummary,
      timeSeries: this.timeSeriesHistory.slice(-pointsLimit),
      causalLogs: this.getCausalTraces(30),
      recentNews,
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
    this.timeSeriesHistory = [];
    this.lastSnapshotSimTime = 0;
  }
}
