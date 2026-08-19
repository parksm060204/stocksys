import {
  BotConfig,
  BotType,
  BotMarketSnapshot,
  CommodityOrder,
  CommodityTrade,
  BotState,
} from '../types';

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

  // 종목별 보유 포지션: { quantity: number; avgEntryPrice: number }
  public positions: Map<string, { quantity: number; avgEntryPrice: number }> = new Map();
  public realizedPnL: number = 0;
  public totalTradesCount: number = 0;

  // 정보 지연 큐 (reaction_delay 구현용)
  private snapshotHistory: BotMarketSnapshot[] = [];

  constructor(config: BotConfig) {
    this.id = config.id;
    this.name = config.name;
    this.type = config.type;
    this.initialCapital = config.capital;
    this.currentCapital = config.capital;
    this.riskTolerance = config.riskTolerance;
    this.positionLimit = config.positionLimit;
    this.reactionDelay = Math.max(0, config.reactionDelay || 0);
    this.stopLossPct = config.stopLossPct ?? -0.05; // 기본 -5% 손절
    this.takeProfitPct = config.takeProfitPct ?? 0.10; // 기본 +10% 익절
  }

  /**
   * 매 틱 시장 스냅샷 수신 및 지연 큐에 저장
   */
  public receiveMarketSnapshot(snapshot: BotMarketSnapshot): void {
    this.snapshotHistory.push(snapshot);
    // 최대 지연 틱 수 + 50틱까지만 보관
    if (this.snapshotHistory.length > this.reactionDelay + 100) {
      this.snapshotHistory.shift();
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
          createdAtTime: Date.now(),
        };
      }
    }

    return null;
  }

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
}
