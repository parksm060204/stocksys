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
      if (!Number.isFinite(price) || price <= 0) continue;
      const pos = this.positions.get(commodityId) || { quantity: 0, avgEntryPrice: 0 };
      const obi = typeof info.obi === 'number' && Number.isFinite(info.obi) ? info.obi : 0;
      const vol = typeof info.volatility === 'number' && Number.isFinite(info.volatility) ? Math.max(0, info.volatility) : 0;
      const volScale = this.getVolatilitySizeScale(info);
      const riskScale = this.getAdaptiveRiskScale(commodityId);
      const effectiveLimit = Math.max(1, Math.round(this.positionLimit * riskScale.positionLimitMultiplier));

      // 변동성 적응형 스프레드 + OBI 역선택 방지 시프트 + Avellaneda-Stoikov 재고 스큐
      // 정상 변동성에서는 타이트한 유동성 공급을 유지하고 고변동성/편향 구간에서만 완만히 확대한다.
      const dynamicHalfSpread =
        this.baseHalfSpreadPct * 0.7 +
        Math.min(0.0025, vol * 0.05) +
        Math.abs(obi) * 0.0005;
      const invSkew = (pos.quantity / effectiveLimit) * 0.002;
      const obiShift = obi * 0.0008; // 매수세 압도 시 중심 호가 소폭 상향해 역선택 회피

      const bidSpread = dynamicHalfSpread + invSkew - obiShift;
      const askSpread = dynamicHalfSpread - invSkew + obiShift;

      const bidPrice = price * (1 - Math.max(0.001, bidSpread));
      const askPrice = price * (1 + Math.max(0.001, askSpread));

      const bidQty = Math.max(
        1,
        Math.round(15 * this.riskTolerance * scaleFactor * volScale * riskScale.buySizeMultiplier)
      );
      const askQty = Math.max(
        1,
        Math.round(15 * this.riskTolerance * scaleFactor * volScale * riskScale.sellSizeMultiplier)
      );

      // 1. 매수 지정가 호가 제출 (유동성 공급)
      if (pos.quantity < effectiveLimit) {
        orders.push({
          id: `mm_bid_${this.id}_${commodityId}_${currentTick}`,
          commodityId,
          botId: this.id,
          side: 'buy',
          type: 'limit',
          price: bidPrice,
          size: Math.min(bidQty, Math.max(1, effectiveLimit - pos.quantity)),
          filled: 0,
          createdAtTick: currentTick,
          createdAtTime: this.clock ? this.clock.now() : 0,
        });
      }

      // 2. 매도 지정가 호가 제출 (유동성 공급)
      if (pos.quantity > -effectiveLimit) {
        orders.push({
          id: `mm_ask_${this.id}_${commodityId}_${currentTick}`,
          commodityId,
          botId: this.id,
          side: 'sell',
          type: 'limit',
          price: askPrice,
          size: Math.min(askQty, Math.max(1, effectiveLimit + pos.quantity)),
          filled: 0,
          createdAtTick: currentTick,
          createdAtTime: this.clock ? this.clock.now() : 0,
        });
      }
    }

    return orders;
  }
}
