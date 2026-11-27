import { CommodityBot } from './CommodityBot';
import { CommodityOrder, BotConfig } from '../types';
import { COMMODITY_DEFINITIONS } from '../definitions';
import { calculateSeasonalityLevel } from '../priceEngine';

export class HedgerBot extends CommodityBot {
  private targetInventory: Map<string, number> = new Map();
  private defMap = new Map(COMMODITY_DEFINITIONS.map((d) => [d.id, d]));

  constructor(config: BotConfig, defaultTargetInventory: number = 30) {
    super(config);
    // 각 종목별 목표 재고 설정
    for (const def of COMMODITY_DEFINITIONS) {
      this.targetInventory.set(def.id, defaultTargetInventory);
    }
  }

  public generateOrders(currentTick: number): CommodityOrder[] {
    const snapshot = this.getDelayedSnapshot();
    if (!snapshot) return [];

    const orders: CommodityOrder[] = [];
    const scaleFactor = this.getCapitalScaleFactor();

    for (const [commodityId, info] of Object.entries(snapshot.commodities)) {
      const def = this.defMap.get(commodityId);
      if (!def) continue;

      const price = info.currentPrice;
      if (!Number.isFinite(price) || price <= 0) continue;
      const pos = this.positions.get(commodityId) || { quantity: 0, avgEntryPrice: 0 };
      const obi = typeof info.obi === 'number' && Number.isFinite(info.obi) ? info.obi : 0;
      const volScale = this.getVolatilitySizeScale(info);
      const riskScale = this.getAdaptiveRiskScale(commodityId);
      const effectiveLimit = Math.max(1, Math.round(this.positionLimit * riskScale.positionLimitMultiplier));
      const targetQty = Math.min(effectiveLimit, this.targetInventory.get(commodityId) || 20);

      // 계절성 레벨 산출 (-진폭 ~ +진폭)
      const seasonality = calculateSeasonalityLevel(currentTick, def.seasonality);

      // 계절성 저점(수확기 가격 하락 시기) 또는 목표 재고 미달 ➔ 분할 매수
      const isSeasonallyCheap = seasonality < -0.02;
      const isUnderTarget = pos.quantity < targetQty;

      if ((isSeasonallyCheap || isUnderTarget) && pos.quantity < effectiveLimit) {
        const orderQty = Math.max(
          1,
          Math.round(5 * this.riskTolerance * scaleFactor * volScale * riskScale.buySizeMultiplier)
        );
        // 매수 불균형이 강할 때는 호가 공백 방지를 위해 살짝 상향 패시브 지정가
        const bidFactor = obi > 0.35 ? 1.0005 : 0.999;
        orders.push({
          id: `hedge_buy_${this.id}_${commodityId}_${currentTick}`,
          commodityId,
          botId: this.id,
          side: 'buy',
          type: 'limit',
          price: price * bidFactor,
          size: Math.min(orderQty, Math.max(1, effectiveLimit - pos.quantity)),
          filled: 0,
          createdAtTick: currentTick,
          createdAtTime: this.clock ? this.clock.now() : 0,
        });
      }
      // 계절성 고점(수요 성수기) 또는 재고 초과 ➔ 실수요 방출 매도
      else if (seasonality > 0.04 && pos.quantity > 5) {
        const orderQty = Math.max(
          1,
          Math.round(4 * this.riskTolerance * scaleFactor * volScale * riskScale.sellSizeMultiplier)
        );
        const askFactor = obi < -0.35 ? 0.9995 : 1.002;
        orders.push({
          id: `hedge_sell_${this.id}_${commodityId}_${currentTick}`,
          commodityId,
          botId: this.id,
          side: 'sell',
          type: 'limit',
          price: price * askFactor,
          size: Math.min(orderQty, pos.quantity),
          filled: 0,
          createdAtTick: currentTick,
          createdAtTime: this.clock ? this.clock.now() : 0,
        });
      }
    }

    return orders;
  }
}
