import { CommodityBot } from './CommodityBot';
import { CommodityOrder, BotConfig } from '../types';

export class MarketMakerBot extends CommodityBot {
  private baseHalfSpreadPct: number = 0.003; // 기본 0.3% 하프 스프레드

  constructor(config: BotConfig, baseHalfSpreadPct: number = 0.003) {
    super(config);
    this.baseHalfSpreadPct = baseHalfSpreadPct;
  }

  public generateOrders(currentTick: number): CommodityOrder[] {
    const snapshot = this.getDelayedSnapshot();
    if (!snapshot) return [];

    const orders: CommodityOrder[] = [];
    const scaleFactor = this.getCapitalScaleFactor();

    for (const [commodityId, info] of Object.entries(snapshot.commodities)) {
      const price = info.currentPrice;
      const pos = this.positions.get(commodityId) || { quantity: 0, avgEntryPrice: 0 };

      // 재고 스큐(Inventory Skew): 재고가 많으면 하방으로 호가 시프트
      const invSkew = (pos.quantity / this.positionLimit) * 0.002;
      const bidSpread = this.baseHalfSpreadPct + invSkew;
      const askSpread = this.baseHalfSpreadPct - invSkew;

      const bidPrice = price * (1 - Math.max(0.001, bidSpread));
      const askPrice = price * (1 + Math.max(0.001, askSpread));

      const orderQty = Math.max(1, Math.round(15 * this.riskTolerance * scaleFactor));

      // 1. 매수 지정가 호가 제출 (유동성 공급)
      if (pos.quantity < this.positionLimit) {
        orders.push({
          id: `mm_bid_${this.id}_${commodityId}_${currentTick}`,
          commodityId,
          botId: this.id,
          side: 'buy',
          type: 'limit',
          price: bidPrice,
          size: Math.min(orderQty, this.positionLimit - pos.quantity),
          filled: 0,
          createdAtTick: currentTick,
          createdAtTime: Date.now(),
        });
      }

      // 2. 매도 지정가 호가 제출 (유동성 공급)
      if (pos.quantity > -this.positionLimit) {
        orders.push({
          id: `mm_ask_${this.id}_${commodityId}_${currentTick}`,
          commodityId,
          botId: this.id,
          side: 'sell',
          type: 'limit',
          price: askPrice,
          size: orderQty,
          filled: 0,
          createdAtTick: currentTick,
          createdAtTime: Date.now(),
        });
      }
    }

    return orders;
  }
}
