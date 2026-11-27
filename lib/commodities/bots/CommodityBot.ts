import {
  BotConfig,
  BotType,
  BotMarketSnapshot,
  BotCommoditySnapshotItem,
  CommodityOrder,
  CommodityTrade,
  BotState,
} from '../types';
import {
  computeAdaptiveRiskMultipliers,
  type DrawdownRiskOutput,
} from '../../engine/simulation/strategies/adaptiveRiskControl';

export abstract class CommodityBot {
  public readonly id: string;
  public readonly name: string;
  public readonly type: BotType;
  public readonly initialCapital: number;
  public currentCapital: number;
  public readonly riskTolerance: number;
  public readonly positionLimit: number;
  public readonly reactionDelay: number;
  public readonly stopLossPct: number;
  public readonly takeProfitPct: number;
  public readonly clock?: import('../../engine/simulation/runtime/simulationTimeSource').SimulationTimeSource;
  public readonly random?: import('../../engine/simulation/runtime/simulationRandom').SimulationRandomSource;

  // 종목별 보유 포지션: { quantity: number; avgEntryPrice: number }
  public positions: Map<string, { quantity: number; avgEntryPrice: number }> = new Map();
  public realizedPnL: number = 0;
  public totalTradesCount: number = 0;

  // 적응형 드로우다운·성과 추적 상태
  public peakEquity: number;
  public lastEquity: number;
  public maxDrawdownPct: number = 0;
  public consecutiveLossTicks: number = 0;

  // 정보 지연 큐 (reaction_delay 구현용)
  private snapshotHistory: BotMarketSnapshot[] = [];

  constructor(config: BotConfig) {
    this.id = config.id;
    this.name = config.name;
    this.type = config.type;
    this.initialCapital = config.capital;
    this.currentCapital = config.capital;
    this.peakEquity = config.capital;
    this.lastEquity = config.capital;
    this.riskTolerance = config.riskTolerance;
    this.positionLimit = config.positionLimit;
    this.reactionDelay = Math.max(0, config.reactionDelay || 0);
    this.stopLossPct = config.stopLossPct ?? -0.05; // 기본 -5% 손절
    this.takeProfitPct = config.takeProfitPct ?? 0.10; // 기본 +10% 익절
    this.clock = config.clock;
    this.random = config.random;
  }

  /**
   * 매 틱 시장 스냅샷 수신, 마크투마켓 자산 고점(peakEquity)/드로우다운 갱신 및 지연 큐 저장
   */
  public receiveMarketSnapshot(snapshot: BotMarketSnapshot): void {
    this.snapshotHistory.push(snapshot);
    // 최대 지연 틱 수 + 50틱까지만 보관
    if (this.snapshotHistory.length > this.reactionDelay + 100) {
      this.snapshotHistory.shift();
    }

    let positionMtm = 0;
    this.positions.forEach((pos, commodityId) => {
      if (pos.quantity !== 0) {
        const markPrice = snapshot.commodities?.[commodityId]?.currentPrice ?? pos.avgEntryPrice;
        if (Number.isFinite(markPrice) && markPrice > 0) {
          positionMtm += pos.quantity * markPrice;
        }
      }
    });
    const equity = this.currentCapital + positionMtm;
    if (Number.isFinite(equity)) {
      this.peakEquity = Math.max(this.peakEquity, equity);
      const dd =
        this.peakEquity > 0 && equity < this.peakEquity
          ? (this.peakEquity - equity) / this.peakEquity
          : 0;
      this.maxDrawdownPct = Math.max(this.maxDrawdownPct, dd);
      if (equity < this.lastEquity - 1e-6) {
        this.consecutiveLossTicks = Math.min(20, this.consecutiveLossTicks + 1);
      } else if (equity > this.lastEquity + 1e-6) {
        this.consecutiveLossTicks = 0;
      }
      this.lastEquity = equity;
    }
  }

  /**
   * reaction_delay 지연 틱 수만큼 이전의 스냅샷 획득
   */
  protected getDelayedSnapshot(): BotMarketSnapshot | null {
    if (this.snapshotHistory.length === 0) return null;
    const targetIndex = Math.max(0, this.snapshotHistory.length - 1 - this.reactionDelay);
    return this.snapshotHistory[targetIndex] || null;
  }

  /**
   * 드로우다운 및 재고 편중도 기반 동적 포지션 한도/주문 수량 배수 산출
   */
  protected getAdaptiveRiskScale(commodityId: string): DrawdownRiskOutput {
    const pos = this.positions.get(commodityId) || { quantity: 0, avgEntryPrice: 0 };
    return computeAdaptiveRiskMultipliers({
      currentEquity: this.lastEquity,
      peakEquity: this.peakEquity,
      currentPosition: pos.quantity,
      maxPosition: this.positionLimit,
      realizedPnl: this.realizedPnL,
      consecutiveLossSteps: this.consecutiveLossTicks,
      baseRiskTolerance: this.riskTolerance,
    });
  }

  /**
   * 변동성 기반 주문 수량 축소 계수 (0.25 ~ 1.0)
   */
  protected getVolatilitySizeScale(info?: BotCommoditySnapshotItem): number {
    const vol = typeof info?.volatility === 'number' && Number.isFinite(info.volatility) ? Math.max(0, info.volatility) : 0;
    return Math.max(0.25, Math.min(1.0, 1.0 / (1.0 + vol * 15.0)));
  }

  /**
   * 자본 소진 시 거래 비중 축소 계수 (0.1 ~ 1.0)
   */
  public getCapitalScaleFactor(): number {
    if (this.initialCapital <= 0) return 1.0;
    const ratio = this.currentCapital / this.initialCapital;
    return Math.max(0.1, Math.min(1.0, ratio));
  }

  /**
   * 체결 피드백 수신 (포지션 및 자본 갱신)
   */
  public onTradeExecuted(trade: CommodityTrade, isBuyer: boolean): void {
    this.totalTradesCount += 1;
    const notional = trade.price * trade.size;
    const current = this.positions.get(trade.commodityId) || { quantity: 0, avgEntryPrice: 0 };

    if (isBuyer) {
      // 매수: 자본 차감, 포지션 증가
      this.currentCapital -= notional;
      const newQty = current.quantity + trade.size;
      const newAvgPrice = newQty > 0
        ? (current.quantity * current.avgEntryPrice + notional) / newQty
        : trade.price;
      this.positions.set(trade.commodityId, { quantity: newQty, avgEntryPrice: newAvgPrice });
    } else {
      // 매도: 자본 입금, 포지션 감소, 실현 손익 계산
      this.currentCapital += notional;
      if (current.quantity > 0) {
        const pnl = (trade.price - current.avgEntryPrice) * Math.min(current.quantity, trade.size);
        this.realizedPnL += pnl;
      }
      const newQty = current.quantity - trade.size;
      this.positions.set(trade.commodityId, {
        quantity: newQty,
        avgEntryPrice: newQty !== 0 ? current.avgEntryPrice : 0,
      });
    }
  }

  /**
   * 손절/익절 체크 및 청산 주문 생성
   */
  protected checkExitOrders(
    commodityId: string,
    currentPrice: number,
    currentTick: number
  ): CommodityOrder | null {
    const pos = this.positions.get(commodityId);
    if (!pos || pos.quantity === 0 || pos.avgEntryPrice <= 0) return null;

    const returnPct = (currentPrice - pos.avgEntryPrice) / pos.avgEntryPrice;

    // 롱 포지션 손절/익절
    if (pos.quantity > 0) {
      if (returnPct <= this.stopLossPct || returnPct >= this.takeProfitPct) {
        return {
          id: `exit_${this.id}_${commodityId}_${currentTick}`,
          commodityId,
          botId: this.id,
          side: 'sell',
          type: 'market',
          price: currentPrice,
          size: Math.abs(pos.quantity),
          filled: 0,
          createdAtTick: currentTick,
          createdAtTime: this.clock ? this.clock.now() : 0,
        };
      }
    } else if (pos.quantity < 0) {
      // 숏 포지션 손절/익절 (가격 하락 시 이익, 상승 시 손실)
      const shortReturnPct = (pos.avgEntryPrice - currentPrice) / pos.avgEntryPrice;
      if (shortReturnPct <= this.stopLossPct || shortReturnPct >= this.takeProfitPct) {
        return {
          id: `exit_cov_${this.id}_${commodityId}_${currentTick}`,
          commodityId,
          botId: this.id,
          side: 'buy',
          type: 'market',
          price: currentPrice,
          size: Math.abs(pos.quantity),
          filled: 0,
          createdAtTick: currentTick,
          createdAtTime: this.clock ? this.clock.now() : 0,
        };
      }
    }

    return null;
  }

  protected snapshotStrategyState(): Record<string, unknown> | undefined {
    return undefined;
  }

  protected restoreStrategyState(_state?: Record<string, unknown>): void {}

  /**
   * 각 봇 고유의 주문 의사결정 추상 메서드
   */
  public abstract generateOrders(currentTick: number): CommodityOrder[];

  /**
   * 봇 현재 상태 스냅샷
   */
  public getState(): BotState {
    const posObj: Record<string, { quantity: number; avgEntryPrice: number }> = {};
    this.positions.forEach((val, key) => {
      posObj[key] = { ...val };
    });

    return {
      config: {
        id: this.id,
        name: this.name,
        type: this.type,
        capital: this.initialCapital,
        riskTolerance: this.riskTolerance,
        positionLimit: this.positionLimit,
        reactionDelay: this.reactionDelay,
        stopLossPct: this.stopLossPct,
        takeProfitPct: this.takeProfitPct,
      },
      currentCapital: this.currentCapital,
      positions: posObj,
      realizedPnL: this.realizedPnL,
      totalTrades: this.totalTradesCount,
    };
  }

  public snapshotRuntimeState(): {
    currentCapital: number;
    realizedPnL: number;
    totalTradesCount: number;
    peakEquity: number;
    lastEquity: number;
    maxDrawdownPct: number;
    consecutiveLossTicks: number;
    positions: Array<[string, { quantity: number; avgEntryPrice: number }]>;
    snapshotHistory: BotMarketSnapshot[];
    randomSnapshot: ReturnType<NonNullable<CommodityBot['random']>['snapshot']> | null;
    strategyState?: Record<string, unknown>;
  } {
    const strategyState = this.snapshotStrategyState();
    return {
      currentCapital: this.currentCapital,
      realizedPnL: this.realizedPnL,
      totalTradesCount: this.totalTradesCount,
      peakEquity: this.peakEquity,
      lastEquity: this.lastEquity,
      maxDrawdownPct: this.maxDrawdownPct,
      consecutiveLossTicks: this.consecutiveLossTicks,
      positions: Array.from(this.positions.entries()).map(([k, v]) => [k, { ...v }]),
      snapshotHistory: structuredClone(this.snapshotHistory),
      randomSnapshot: this.random?.snapshot ? this.random.snapshot() : null,
      ...(strategyState !== undefined ? { strategyState: structuredClone(strategyState) } : {}),
    };
  }

  public restoreRuntimeState(snap: ReturnType<CommodityBot['snapshotRuntimeState']>): void {
    this.currentCapital = snap.currentCapital;
    this.realizedPnL = snap.realizedPnL;
    this.totalTradesCount = snap.totalTradesCount;
    this.peakEquity = typeof snap.peakEquity === 'number' ? snap.peakEquity : snap.currentCapital;
    this.lastEquity = typeof snap.lastEquity === 'number' ? snap.lastEquity : snap.currentCapital;
    this.maxDrawdownPct = typeof snap.maxDrawdownPct === 'number' ? snap.maxDrawdownPct : 0;
    this.consecutiveLossTicks = typeof snap.consecutiveLossTicks === 'number' ? snap.consecutiveLossTicks : 0;
    this.positions = new Map(snap.positions.map(([k, v]) => [k, { ...v }]));
    this.snapshotHistory = structuredClone(snap.snapshotHistory);
    if (snap.randomSnapshot && this.random?.restore) {
      this.random.restore(snap.randomSnapshot);
    }
    this.restoreStrategyState(snap.strategyState ? structuredClone(snap.strategyState) : undefined);
  }
}
