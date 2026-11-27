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
      const obi = typeof info.obi === 'number' && Number.isFinite(info.obi) ? info.obi : 0;
      const volScale = this.getVolatilitySizeScale(info);
      const riskScale = this.getAdaptiveRiskScale(commodityId);
      const effectiveLimit = Math.max(1, Math.round(this.positionLimit * riskScale.positionLimitMultiplier));
      const maGapPct = longMA > 0 ? (shortMA - longMA) / longMA : 0;
      const obiAdj = (side: 'buy' | 'sell') => {
        const alignedObi = side === 'buy' ? obi : -obi;
        return Math.max(0.6, Math.min(1.3, 1.0 + alignedObi * 0.3));
      };

      // 골든 크로스 또는 강한 추세+OBI 동조 ➔ 매수
      const goldenCross = prevShortMA <= prevLongMA && shortMA > longMA;
      const momentumBuyCont = maGapPct > 0.008 && obi > 0.25 && pos.quantity < effectiveLimit * 0.5;
      if (goldenCross || momentumBuyCont) {
        if (pos.quantity < effectiveLimit) {
          const rawQty = Math.round(10 * this.riskTolerance * scaleFactor * volScale * riskScale.buySizeMultiplier * obiAdj('buy'));
          const size = Math.min(Math.max(1, rawQty), Math.max(1, effectiveLimit - pos.quantity));
          const aggressive = obi >= 0.2 || maGapPct >= 0.01;
          const refAsk = info.bestAsk && info.bestAsk > 0 ? info.bestAsk : price * 1.002;
          const refBid = info.bestBid && info.bestBid > 0 ? info.bestBid : price * 0.999;
          orders.push({
            id: `trend_buy_${this.id}_${commodityId}_${currentTick}`,
            commodityId,
            botId: this.id,
            side: 'buy',
            type: 'limit',
            price: aggressive ? Math.max(price * 1.001, refAsk) : refBid,
            size,
            filled: 0,
            createdAtTick: currentTick,
            createdAtTime: this.clock ? this.clock.now() : 0,
          });
        }
      }
      // 데드 크로스 또는 강한 하락 추세+OBI 동조 ➔ 매도
      else {
        const deadCross = prevShortMA >= prevLongMA && shortMA < longMA;
        const momentumSellCont = maGapPct < -0.008 && obi < -0.25 && pos.quantity > -effectiveLimit * 0.5;
        if ((deadCross || momentumSellCont) && pos.quantity > -effectiveLimit) {
          const rawQty = Math.round(10 * this.riskTolerance * scaleFactor * volScale * riskScale.sellSizeMultiplier * obiAdj('sell'));
          const size = Math.min(Math.max(1, rawQty), Math.max(1, effectiveLimit + pos.quantity));
          const aggressive = obi <= -0.2 || maGapPct <= -0.01;
          const refBid = info.bestBid && info.bestBid > 0 ? info.bestBid : price * 0.998;
          const refAsk = info.bestAsk && info.bestAsk > 0 ? info.bestAsk : price * 1.001;
          orders.push({
            id: `trend_sell_${this.id}_${commodityId}_${currentTick}`,
            commodityId,
            botId: this.id,
            side: 'sell',
            type: 'limit',
            price: aggressive ? Math.min(price * 0.999, refBid) : refAsk,
            size,
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
