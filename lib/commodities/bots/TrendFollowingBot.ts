import { CommodityBot } from './CommodityBot';
import { CommodityOrder, BotConfig } from '../types';

export class TrendFollowingBot extends CommodityBot {
  private priceHistories: Map<string, number[]> = new Map();
  private shortPeriod: number = 5;
  private longPeriod: number = 20;

  constructor(config: BotConfig, shortPeriod: number = 5, longPeriod: number = 20) {
    super(config);
    this.shortPeriod = shortPeriod;
    this.longPeriod = longPeriod;
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

      // 손절/익절 주문 먼저 확인
      const exitOrder = this.checkExitOrders(commodityId, price, currentTick);
      if (exitOrder) {
        orders.push(exitOrder);
        continue;
      }

      if (history.length < this.longPeriod) continue;

      const shortSlice = history.slice(-this.shortPeriod);
      const longSlice = history.slice(-this.longPeriod);

      const shortMA = shortSlice.reduce((a, b) => a + b, 0) / shortSlice.length;
      const longMA = longSlice.reduce((a, b) => a + b, 0) / longSlice.length;

      const prevShortSlice = history.slice(-this.shortPeriod - 1, -1);
      const prevLongSlice = history.slice(-this.longPeriod - 1, -1);

      if (prevShortSlice.length < this.shortPeriod || prevLongSlice.length < this.longPeriod) continue;

      const prevShortMA = prevShortSlice.reduce((a, b) => a + b, 0) / prevShortSlice.length;
      const prevLongMA = prevLongSlice.reduce((a, b) => a + b, 0) / prevLongSlice.length;

      const pos = this.positions.get(commodityId) || { quantity: 0, avgEntryPrice: 0 };
      const baseOrderQty = Math.max(1, Math.round(10 * this.riskTolerance * scaleFactor));

      // 골든 크로스 (Golden Cross) ➔ 매수
      if (prevShortMA <= prevLongMA && shortMA > longMA) {
        if (pos.quantity < this.positionLimit) {
          orders.push({
            id: `trend_buy_${this.id}_${commodityId}_${currentTick}`,
            commodityId,
            botId: this.id,
            side: 'buy',
            type: 'limit',
            price: price * 1.002, // 약간 공격적 지정가 (Taker 경향)
            size: Math.min(baseOrderQty, this.positionLimit - pos.quantity),
            filled: 0,
            createdAtTick: currentTick,
            createdAtTime: Date.now(),
          });
        }
      }
      // 데드 크로스 (Dead Cross) ➔ 매도
      else if (prevShortMA >= prevLongMA && shortMA < longMA) {
        if (pos.quantity > -this.positionLimit) {
          orders.push({
            id: `trend_sell_${this.id}_${commodityId}_${currentTick}`,
            commodityId,
            botId: this.id,
            side: 'sell',
            type: 'limit',
            price: price * 0.998,
            size: baseOrderQty,
            filled: 0,
            createdAtTick: currentTick,
            createdAtTime: Date.now(),
          });
        }
      }
    }

    return orders;
  }
}
