import type { PensionFundBot } from "../types";

export class PensionFundAgent {
  private bot: PensionFundBot;

  constructor(bot: PensionFundBot) {
    this.bot = bot;
  }

  private calculatePriceFromYTM(faceValue: number, ytm: number, maturityYears: number): number {
    return faceValue / Math.pow(1 + ytm, maturityYears);
  }

  public evaluateMarketAndPlaceOrders(currentMarket: any, isCreditCrunch: boolean = false) {
    const orders = [];

    for (const bond of currentMarket.bonds) {
      const targetYTM = this.bot.targetYTM[bond.type];
      if (!targetYTM) continue;

      const adjustedTargetYTM = isCreditCrunch ? targetYTM + 0.02 : targetYTM;
      const targetBuyPrice = this.calculatePriceFromYTM(bond.faceValue, adjustedTargetYTM, bond.maturityYears);
      const adjustedBuyPrice = Math.floor(targetBuyPrice / 10) * 10;

      if (bond.currentPrice <= adjustedBuyPrice + 50) {
        const orderVolume = Math.floor((this.bot.capital * (Math.random() * 0.01 + 0.01)) / bond.currentPrice);
        orders.push({
          botId: this.bot.id,
          assetId: bond.id,
          orderType: 'LIMIT',
          side: 'BUY',
          price: adjustedBuyPrice,
          volume: orderVolume,
          timestamp: Date.now()
        });
      }
    }
    return orders;
  }
}
