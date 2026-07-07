import type { CommercialBankBot } from "./types";

export class CommercialBankAgent {
  private bot: CommercialBankBot;

  constructor(bot: CommercialBankBot) {
    this.bot = bot;
  }

  private calculatePriceFromYTM(faceValue: number, ytm: number, maturityYears: number): number {
    return faceValue / Math.pow(1 + ytm, maturityYears);
  }

  public executeArbitrage(currentMarket: any, adminBaseRate: number) {
    const currentKSTHour = (new Date().getUTCHours() + 9) % 24;
    if (currentKSTHour < 18 || currentKSTHour >= 22.5) return;

    // 무한 핑퐁 방지 (쿨다운 체크)
    const now = Date.now();
    if (this.bot.lastSweepTime && this.bot.cooldownMs) {
      if (now - this.bot.lastSweepTime < this.bot.cooldownMs) {
        return;
      }
    }

    const orders = [];
    let sweepOccurred = false;

    for (const bond of currentMarket.bonds) {
      const spread = this.bot.targetSpread[bond.type];
      if (!spread) continue;

      const targetYTM = adminBaseRate + spread;
      const fairPrice = this.calculatePriceFromYTM(bond.faceValue, targetYTM, bond.maturityYears);

      const priceDifference = bond.currentPrice - fairPrice;
      const differenceRatio = Math.abs(priceDifference / fairPrice);

      if (differenceRatio > 0.005) {
        const executionVolume = Math.floor((this.bot.capital * differenceRatio) / bond.currentPrice);

        if (priceDifference > 0) {
          orders.push({
            botId: this.bot.id,
            assetId: bond.id,
            orderType: 'MARKET',
            side: 'SELL',
            volume: executionVolume,
            timestamp: now
          });
        } else {
          orders.push({
            botId: this.bot.id,
            assetId: bond.id,
            orderType: 'MARKET',
            side: 'BUY',
            volume: executionVolume,
            timestamp: now
          });
        }
        sweepOccurred = true;
      }
    }

    if (orders.length > 0) {
      this.submitMarketOrders(orders);
    }

    if (sweepOccurred) {
      this.bot.lastSweepTime = now;
      if (!this.bot.cooldownMs) {
        this.bot.cooldownMs = 3000 + Math.random() * 2000; // 3~5초 쿨다운 자동 부여
      }
    }
  }

  private submitMarketOrders(orders: any[]) {
    // 시장가 스윕 호가 연동 로직
    console.log(`[CommercialBank ${this.bot.name}] Submitting ${orders.length} market sweep orders.`);
  }
}
