import type { CommercialBankBot } from "../types";
import { BaseAgent } from "./BaseAgent";

export class CommercialBankAgent extends BaseAgent {
  private bot: CommercialBankBot;

  constructor(bot: CommercialBankBot) {
    super(bot.id, bot.capital);
    this.bot = bot;
  }

  private calculatePriceFromYTM(faceValue: number, ytm: number, maturityYears: number): number {
    return faceValue / Math.pow(1 + ytm, maturityYears);
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

    for (const bond of currentMarket.bonds) {
      const id = (bond.bond_id || '').toUpperCase();
      const bondType = id.includes('10Y') ? '10Y_BOND' : (id.includes('5Y') || id.includes('7Y') ? '5Y_BOND' : (id.includes('3Y') ? '3Y_BOND' : '1Y_BOND'));
      const spread = targetSpread[bondType];
      if (!spread) continue;

      const targetYTM = adminBaseRate + spread;
      const faceValue = bond.face_value !== undefined ? bond.face_value : (bond.faceValue !== undefined ? bond.faceValue : 10000);
      const maturityYears = bond.maturity_years !== undefined ? bond.maturity_years : (bond.maturityYears !== undefined ? bond.maturityYears : 10);
      const currentPrice = bond.current_price !== undefined ? bond.current_price : (bond.currentPrice !== undefined ? bond.currentPrice : 10000);

      const fairPrice = this.calculatePriceFromYTM(faceValue, targetYTM, maturityYears);
      const priceDifference = currentPrice - fairPrice;
      const differenceRatio = Math.abs(priceDifference / fairPrice);

      if (differenceRatio > 0.005) {
        const executionVolume = Math.floor((this.bot.capital * differenceRatio) / currentPrice);

        if (executionVolume > 0) {
          orders.push({
            stock_id: bond.id,
            user_id: null,
            side: priceDifference > 0 ? 'sell' : 'buy',
            price: priceDifference > 0 ? currentPrice - 10 : currentPrice + 10,
            size: executionVolume,
            status: 'open',
            is_lp: true,
            _botId: this.botId,
            _assetClass: 'bond'
          });
          sweepOccurred = true;
        }
      }
    }

    if (sweepOccurred) {
      this.bot.lastSweepTime = now;
      if (!this.bot.cooldownMs) this.bot.cooldownMs = 3000 + Math.random() * 2000;
    }

    return orders;
  }
}
