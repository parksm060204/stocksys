import { CommodityBot } from './CommodityBot';
import { CommodityOrder, BotConfig } from '../types';
import { computeMeanReversionSignal } from '../../engine/simulation/strategies/meanReversionStrategy';

export class MeanReversionBot extends CommodityBot {
  private priceHistories: Map<string, number[]> = new Map();
  private period: number = 20;
  private numStd: number = 2.0;

  constructor(config: BotConfig, period: number = 20, numStd: number = 2.0) {
    super(config);
    this.period = period;
    this.numStd = numStd;
  }

  protected override snapshotStrategyState(): Record<string, unknown> {
    return {
      priceHistories: Array.from(this.priceHistories.entries()).map(([k, v]) => [k, [...v]]),
    };
  }

  protected override restoreStrategyState(state?: Record<string, unknown>): void {
    this.priceHistories.clear();
    const entries = state?.priceHistories;
    if (Array.isArray(entries)) {
      for (const pair of entries) {
        if (Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'string' && Array.isArray(pair[1])) {
          this.priceHistories.set(pair[0], pair[1].map((n) => Number(n)));
        }
      }
    }
  }

  public generateOrders(currentTick: number): CommodityOrder[] {
    const snapshot = this.getDelayedSnapshot();
    if (!snapshot) return [];

    const orders: CommodityOrder[] = [];
    const scaleFactor = this.getCapitalScaleFactor();

    for (const [commodityId, info] of Object.entries(snapshot.commodities)) {
      const price = info.currentPrice;
      if (!Number.isFinite(price) || price <= 0) continue;
      if (!this.priceHistories.has(commodityId)) {
        this.priceHistories.set(commodityId, []);
      }
      const history = this.priceHistories.get(commodityId)!;
      history.push(price);
      if (history.length > 50) history.shift();

      // 손절/익절 체크
      const exitOrder = this.checkExitOrders(commodityId, price, currentTick);
      if (exitOrder) {
        orders.push(exitOrder);
        continue;
      }

      if (history.length < this.period) continue;

      const mrSignal = computeMeanReversionSignal(history, [], this.period, this.numStd, 2.0);
      if (!mrSignal || mrSignal.stdDev <= 0) continue;

      const obi = typeof info.obi === 'number' && Number.isFinite(info.obi) ? info.obi : 0;
      const volScale = Math.min(this.getVolatilitySizeScale(info), mrSignal.volatilitySizeScale);
      const riskScale = this.getAdaptiveRiskScale(commodityId);
      const effectiveLimit = Math.max(1, Math.round(this.positionLimit * riskScale.positionLimitMultiplier));
      const pos = this.positions.get(commodityId) || { quantity: 0, avgEntryPrice: 0 };

      // 변동성 적응형 Z-Score 임계치 (극단적 역방향 OBI 시 추가 안전마진 요구)
      const zBuyEntry = -this.numStd * (obi < -0.45 ? 1.15 : 1.0);
      const zSellEntry = this.numStd * (obi > 0.45 ? 1.15 : 1.0);

      // 하단 밴드 이탈 ➔ 과매도(Oversold) 역발상 매수
      if (mrSignal.zScore <= zBuyEntry && pos.quantity < effectiveLimit) {
        const zIntensity = Math.min(1.4, Math.max(0.75, Math.abs(mrSignal.zScore) / this.numStd));
        const rawQty = Math.round(8 * this.riskTolerance * scaleFactor * volScale * riskScale.buySizeMultiplier * zIntensity);
        const size = Math.min(Math.max(1, rawQty), Math.max(1, effectiveLimit - pos.quantity));
        const aggressive = obi >= 0 || Math.abs(mrSignal.zScore) >= this.numStd * 1.25;
        const limitPrice = aggressive
          ? (info.bestAsk && info.bestAsk > 0 ? Math.min(price * 1.001, info.bestAsk) : price * 1.001)
          : (info.bestBid && info.bestBid > 0 ? info.bestBid : price * 0.999);
        orders.push({
          id: `mr_buy_${this.id}_${commodityId}_${currentTick}`,
          commodityId,
          botId: this.id,
          side: 'buy',
          type: 'limit',
          price: limitPrice,
          size,
          filled: 0,
          createdAtTick: currentTick,
          createdAtTime: this.clock ? this.clock.now() : 0,
        });
      }
      // 상단 밴드 이탈 ➔ 과매수(Overbought) 역발상 매도
      else if (mrSignal.zScore >= zSellEntry && pos.quantity > -effectiveLimit) {
        const zIntensity = Math.min(1.4, Math.max(0.75, Math.abs(mrSignal.zScore) / this.numStd));
        const rawQty = Math.round(8 * this.riskTolerance * scaleFactor * volScale * riskScale.sellSizeMultiplier * zIntensity);
        const size = Math.min(Math.max(1, rawQty), Math.max(1, effectiveLimit + pos.quantity));
        const aggressive = obi <= 0 || Math.abs(mrSignal.zScore) >= this.numStd * 1.25;
        const limitPrice = aggressive
          ? (info.bestBid && info.bestBid > 0 ? Math.max(price * 0.999, info.bestBid) : price * 0.999)
          : (info.bestAsk && info.bestAsk > 0 ? info.bestAsk : price * 1.001);
        orders.push({
          id: `mr_sell_${this.id}_${commodityId}_${currentTick}`,
          commodityId,
          botId: this.id,
          side: 'sell',
          type: 'limit',
          price: limitPrice,
          size,
          filled: 0,
          createdAtTick: currentTick,
          createdAtTime: this.clock ? this.clock.now() : 0,
        });
      }
    }

    return orders;
  }
}
