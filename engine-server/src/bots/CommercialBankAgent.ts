import type { CommercialBankBot } from "../types";
import { BaseAgent } from "./BaseAgent";

export class CommercialBankAgent extends BaseAgent {
  private bot: CommercialBankBot;

  constructor(bot: CommercialBankBot) {
    super(bot.id, bot.capital);
    this.bot = bot;
  }

  private calculatePriceFromYTM(ytm: number): number {
    // 100.00 par base: 3.5% YTM -> 100.00, YTM shift shifts price by ~2.0%
    const basePrice = 100.00 * (1 - (ytm - 0.035) * 2.0);
    return Math.max(90.00, Math.min(110.00, basePrice));
  }

  public executeArbitrage(currentMarket: any, adminBaseRate: number) {
    const orders: any[] = [];
    const now = Date.now();

    if (this.bot.lastSweepTime && this.bot.cooldownMs) {
      if (now - this.bot.lastSweepTime < this.bot.cooldownMs) {
        return orders;
      }
    }

    let sweepOccurred = false;
    const targetSpread = this.bot.targetSpread || { "1Y_BOND": 0.005, "3Y_BOND": 0.007, "5Y_BOND": 0.010, "10Y_BOND": 0.015 };

    for (const bond of (currentMarket.bonds || [])) {
      const ticker = (bond.ticker || bond.bond_code || bond.name || '').toUpperCase();
      const bondType = ticker.includes('10Y') ? '10Y_BOND' : (ticker.includes('5Y') || ticker.includes('7Y') ? '5Y_BOND' : (ticker.includes('3Y') ? '3Y_BOND' : '1Y_BOND'));
      const spread = targetSpread[bondType] || 0.010;

      const targetYTM = adminBaseRate + spread;
      const rawCurrentPrice = Number(bond.current_price || bond.currentPrice || 100.00);
      const currentPrice = (rawCurrentPrice > 0 && rawCurrentPrice <= 150) ? rawCurrentPrice : 100.00;

      const fairPrice = this.calculatePriceFromYTM(targetYTM);
      const priceDifference = currentPrice - fairPrice;

      if (Math.abs(priceDifference) > 0.05) {
        const side = priceDifference > 0 ? 'sell' : 'buy';
        const tickOffset = 0.02;
        const targetOrderPrice = side === 'sell' ? currentPrice - tickOffset : currentPrice + tickOffset;
        const boundedPrice = Number(Math.max(90.00, Math.min(110.00, Math.round(targetOrderPrice * 100) / 100)).toFixed(2));
        const executionVolume = Math.min(500, Math.max(10, Math.floor((this.bot.capital * 0.00001) / currentPrice)));

        orders.push({
          stock_id: bond.id,
          user_id: null,
          side: side,
          price: boundedPrice,
          size: executionVolume,
          status: 'open',
          is_lp: true,
          _botId: this.botId,
          _assetClass: 'bond'
        });
        sweepOccurred = true;
      }
    }

    if (sweepOccurred) {
      this.bot.lastSweepTime = now;
      if (!this.bot.cooldownMs) this.bot.cooldownMs = 3000 + Math.random() * 2000;
    }

    return orders;
  }
}
