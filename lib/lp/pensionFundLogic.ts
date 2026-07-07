import type { PensionFundBot } from "./types";

export class PensionFundAgent {
  private bot: PensionFundBot;

  constructor(bot: PensionFundBot) {
    this.bot = bot;
  }

  // 가격-YTM 변환 헬퍼
  private calculatePriceFromYTM(faceValue: number, ytm: number, maturityYears: number): number {
    return faceValue / Math.pow(1 + ytm, maturityYears);
  }

  public evaluateMarketAndPlaceOrders(currentMarket: any, isCreditCrunch: boolean = false) {
    // 1. KST 정규장 확인 로직 
    const currentKSTHour = (new Date().getUTCHours() + 9) % 24;
    if (currentKSTHour < 18 || currentKSTHour >= 22.5) {
      return; // 정규장 아님
    }

    const orders = [];

    for (const bond of currentMarket.bonds) {
      const targetYTM = this.bot.targetYTM[bond.type];
      if (!targetYTM) continue;

      // 크레딧 크런치 시 타겟 YTM 상향 조정 (가격을 낮춰서 방관)
      const adjustedTargetYTM = isCreditCrunch ? targetYTM + 0.02 : targetYTM;

      const targetBuyPrice = this.calculatePriceFromYTM(bond.faceValue, adjustedTargetYTM, bond.maturityYears);
      const adjustedBuyPrice = Math.floor(targetBuyPrice / 10) * 10; // 10원 호가 단위

      if (bond.currentPrice <= adjustedBuyPrice + 50) {
        const orderVolume = this.calculateMassiveVolume(this.bot.capital, bond.currentPrice);
        orders.push({
          botId: this.bot.id,
          assetId: bond.id,
          orderType: 'LIMIT',
          side: 'BUY',
          price: adjustedBuyPrice,
          volume: orderVolume,
          timestamp: Date.now(),
          isWall: true
        });
      }
    }

    if (orders.length > 0) {
      this.submitOrdersToSupabase(orders);
    }
  }

  private calculateMassiveVolume(capital: number, price: number): number {
    const allocation = capital * (Math.random() * 0.01 + 0.01);
    return Math.floor(allocation / price);
  }

  private submitOrdersToSupabase(orders: any[]) {
    // 호가창 DB / 엔진 연동
    console.log(`[PensionFund ${this.bot.name}] Submitting ${orders.length} limit orders.`);
  }
}
