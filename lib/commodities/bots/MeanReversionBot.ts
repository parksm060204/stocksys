import { CommodityBot } from './CommodityBot';
import { CommodityOrder, BotConfig } from '../types';

export class MeanReversionBot extends CommodityBot {
  private priceHistories: Map<string, number[]> = new Map();
  private period: number = 20;
  private numStd: number = 2.0;

  constructor(config: BotConfig, period: number = 20, numStd: number = 2.0) {
    super(config);
    this.period = period;
    this.numStd = numStd;
  }

  public generateOrders(currentTick: number): CommodityOrder[] {
    const snapshot = this.getDelayedSnapshot();
    if (!snapshot) return [];

    const orders: CommodityOrder[] = [];
    const scaleFactor = this.getCapitalScaleFactor();

    for (const [commodityId, info] of Object.entries(snapshot.commodities)) {
      const price = info.currentPrice;
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

      const slice = history.slice(-this.period);
      const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
      const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / slice.length;
      const stdDev = Math.sqrt(variance);

      const upperBand = mean + this.numStd * stdDev;
      const lowerBand = mean - this.numStd * stdDev;

      const pos = this.positions.get(commodityId) || { quantity: 0, avgEntryPrice: 0 };
      const baseOrderQty = Math.max(1, Math.round(8 * this.riskTolerance * scaleFactor));

      // 하단 밴드 이탈 ➔ 과매도(Oversold) 역발상 매수
      if (price < lowerBand && pos.quantity < this.positionLimit) {
        orders.push({
          id: `mr_buy_${this.id}_${commodityId}_${currentTick}`,
          commodityId,
          botId: this.id,
          side: 'buy',
          type: 'limit',
          price: price * 1.001,
          size: Math.min(baseOrderQty, this.positionLimit - pos.quantity),
          filled: 0,
          createdAtTick: currentTick,
          createdAtTime: Date.now(),
        });
      }
      // 상단 밴드 이탈 ➔ 과매수(Overbought) 역발상 매도
      else if (price > upperBand && pos.quantity > -this.positionLimit) {
        orders.push({
          id: `mr_sell_${this.id}_${commodityId}_${currentTick}`,
          commodityId,
          botId: this.id,
          side: 'sell',
          type: 'limit',
          price: price * 0.999,
          size: baseOrderQty,
          filled: 0,
          createdAtTick: currentTick,
          createdAtTime: Date.now(),
        });
      }
    }

    return orders;
  }
}
