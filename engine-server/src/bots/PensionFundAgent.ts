import type { PensionFundBot } from "../types";
import { BaseAgent } from "./BaseAgent";

export class PensionFundAgent extends BaseAgent {
  private bot: PensionFundBot;

  constructor(bot: PensionFundBot) {
    super(bot.id, bot.capital);
    this.bot = bot;
  }

  private calculatePriceFromYTM(faceValue: number, ytm: number, maturityYears: number): number {
    return faceValue / Math.pow(1 + ytm, maturityYears);
  }

  public evaluateMarketAndPlaceOrders(currentMarket: any, isCreditCrunch: boolean = false) {
    const orders: any[] = [];

    // 채권 매매 로직은 기존 유지
    for (const bond of (currentMarket.bonds || [])) {
      const targetYTM = this.bot.targetYTM[bond.type];
      if (!targetYTM) continue;

      const adjustedTargetYTM = isCreditCrunch ? targetYTM + 0.02 : targetYTM;
      const targetBuyPrice = this.calculatePriceFromYTM(bond.faceValue || 10000, adjustedTargetYTM, bond.maturityYears || 10);
      const adjustedBuyPrice = Math.floor(targetBuyPrice / 10) * 10;

      if (bond.current_price <= adjustedBuyPrice + 50) {
        const orderVolume = Math.floor((this.bot.capital * (Math.random() * 0.01 + 0.01)) / bond.current_price);
        orders.push({
          stock_id: bond.id,
          user_id: null,
          side: 'buy',
          price: adjustedBuyPrice,
          size: orderVolume,
          status: 'open',
          is_lp: true
        });
      }
    }

    // 주식 시장 방어선 구축 로직
    const sectorTargets = this.bot.sectorTargets || {};
    const availableStocks = currentMarket.stocks || [];
    const equityCapital = this.bot.capital * 0.05;

    for (const [sector, weight] of Object.entries(sectorTargets)) {
      const sectorStocks = availableStocks.filter((s: any) => s.sector === sector);
      if (sectorStocks.length > 0) {
        const moneyForSector = equityCapital * weight;
        const moneyPerStock = moneyForSector / sectorStocks.length;
        
        for (const stock of sectorStocks) {
          const totalIntendedQty = Math.floor(moneyPerStock / stock.current_price);
          if (totalIntendedQty <= 0) continue;

          const tickSize = this.getTickSize(stock.current_price);
          
          // 연기금은 현재가보다 1~2틱 아래에서 조용히 대량 매집을 원합니다.
          // 긴급성(urgency)이 낮으면서 목표 물량이 거대하므로 
          // BaseAgent의 판단에 의해 자연스럽게 '빙산 주문(Iceberg)'이 발동됩니다.
          const targetBuyPrice = stock.current_price - (tickSize * (Math.floor(Math.random() * 2) + 1));
          
          orders.push(...this.executeSmartOrder(
            stock,
            'buy',
            targetBuyPrice,
            totalIntendedQty,
            0.2, // 다소 낮은 긴급성 (Iceberg 유도)
            currentMarket.activeEvents
          ));
        }
      }
    }

    return orders;
  }
}
