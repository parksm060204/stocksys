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
        if (!Number.isFinite(price) || price <= 0) continue;
        const pos = this.positions.get(commodityId) || { quantity: 0, avgEntryPrice: 0 };

        // 기본 방향: 호재(magnitude > 0) ➔ 매수, 악재(magnitude < 0) ➔ 매도
        let isBullish = ev.magnitude > 0;

        // 20% 확률로 뉴스 오판 (Noise Trader 성격, 결정론적 PRNG 1회 소비 보존)
        const roll = this.random ? this.random.next() : 0.5;
        if (roll < this.misinterpretRate) {
          isBullish = !isBullish;
        }

        const obi = typeof info.obi === 'number' && Number.isFinite(info.obi) ? info.obi : 0;
        const decayRatio = Math.max(0.25, Math.min(1.0, ev.remainingTicks / Math.max(1, ev.totalTicks)));
        const volScale = this.getVolatilitySizeScale(info);
        const riskScale = this.getAdaptiveRiskScale(commodityId);
        const effectiveLimit = Math.max(1, Math.round(this.positionLimit * riskScale.positionLimitMultiplier));
        const flowBoost = 1 + (isBullish ? obi : -obi) * 0.25;

        if (isBullish && pos.quantity < effectiveLimit) {
          const baseQty = Math.max(
            1,
            Math.round(12 * this.riskTolerance * scaleFactor * decayRatio * volScale * riskScale.buySizeMultiplier * Math.max(0.7, Math.min(1.25, flowBoost)))
          );
          orders.push({
            id: `news_buy_${this.id}_${commodityId}_${currentTick}`,
            commodityId,
            botId: this.id,
            side: 'buy',
            type: 'limit',
            price: price * (decayRatio >= 0.7 ? 1.003 : 1.0015), // 잔여 임팩트에 따른 공격성 조절
            size: Math.min(baseQty, Math.max(1, effectiveLimit - pos.quantity)),
            filled: 0,
            createdAtTick: currentTick,
            createdAtTime: this.clock ? this.clock.now() : 0,
          });
        } else if (!isBullish && pos.quantity > -effectiveLimit) {
          const baseQty = Math.max(
            1,
            Math.round(12 * this.riskTolerance * scaleFactor * decayRatio * volScale * riskScale.sellSizeMultiplier * Math.max(0.7, Math.min(1.25, flowBoost)))
          );
          orders.push({
            id: `news_sell_${this.id}_${commodityId}_${currentTick}`,
            commodityId,
            botId: this.id,
            side: 'sell',
            type: 'limit',
            price: price * (decayRatio >= 0.7 ? 0.997 : 0.9985),
            size: Math.min(baseQty, Math.max(1, effectiveLimit + pos.quantity)),
            filled: 0,
            createdAtTick: currentTick,
            createdAtTime: this.clock ? this.clock.now() : 0,
          });
        }
      }
    }

    return orders;
  }
}
