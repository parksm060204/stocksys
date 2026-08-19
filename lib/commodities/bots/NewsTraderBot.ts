import { CommodityBot } from './CommodityBot';
import { CommodityOrder, BotConfig } from '../types';
import { COMMODITY_DEFINITIONS } from '../definitions';

export class NewsTraderBot extends CommodityBot {
  private misinterpretRate: number = 0.20; // 20% 확률로 오판
  private defMap = new Map(COMMODITY_DEFINITIONS.map((d) => [d.id, d]));

  constructor(config: BotConfig, misinterpretRate: number = 0.20) {
    super(config);
    this.misinterpretRate = misinterpretRate;
  }

  public generateOrders(currentTick: number): CommodityOrder[] {
    const snapshot = this.getDelayedSnapshot();
    if (!snapshot || !snapshot.activeEvents || snapshot.activeEvents.length === 0) {
      return [];
    }

    const orders: CommodityOrder[] = [];
    const scaleFactor = this.getCapitalScaleFactor();

    for (const ev of snapshot.activeEvents) {
      // 신규 또는 활성 이벤트 대상 종목 탐색
      for (const [commodityId, info] of Object.entries(snapshot.commodities)) {
        const def = this.defMap.get(commodityId);
        if (!def) continue;

        const isTargetCat = ev.targetCategories.includes(def.category);
        const isTargetId = ev.targetCommodityIds ? ev.targetCommodityIds.includes(commodityId) : false;

        if (!isTargetCat && !isTargetId) continue;

        const price = info.currentPrice;
        const pos = this.positions.get(commodityId) || { quantity: 0, avgEntryPrice: 0 };

        // 기본 방향: 호재(magnitude > 0) ➔ 매수, 악재(magnitude < 0) ➔ 매도
        let isBullish = ev.magnitude > 0;

        // 20% 확률로 뉴스 오판 (Noise Trader 성격)
        if (Math.random() < this.misinterpretRate) {
          isBullish = !isBullish;
        }

        const baseQty = Math.max(1, Math.round(12 * this.riskTolerance * scaleFactor));

        if (isBullish && pos.quantity < this.positionLimit) {
          orders.push({
            id: `news_buy_${this.id}_${commodityId}_${currentTick}`,
            commodityId,
            botId: this.id,
            side: 'buy',
            type: 'limit',
            price: price * 1.003, // 빠른 체결을 위한 공격적 가격
            size: Math.min(baseQty, this.positionLimit - pos.quantity),
            filled: 0,
            createdAtTick: currentTick,
            createdAtTime: Date.now(),
          });
        } else if (!isBullish && pos.quantity > -this.positionLimit) {
          orders.push({
            id: `news_sell_${this.id}_${commodityId}_${currentTick}`,
            commodityId,
            botId: this.id,
            side: 'sell',
            type: 'limit',
            price: price * 0.997,
            size: baseQty,
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
