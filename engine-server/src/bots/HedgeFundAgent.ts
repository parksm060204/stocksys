import type { HedgeFundBot, MarketSentiment } from "../types";
import { BaseAgent } from "./BaseAgent";

export class HedgeFundAgent extends BaseAgent {
  private bot: HedgeFundBot;

  constructor(bot: HedgeFundBot) {
    super(bot.id, bot.capital);
    this.bot = bot;
  }

  public updateSentiment(newSentiment: MarketSentiment) {
    this.bot.currentSentiment = newSentiment;
    this.rebalancePortfolio();
  }

  private rebalancePortfolio() {
    if (this.bot.currentSentiment === 'RISK_OFF') {
      this.bot.portfolioTarget = { equity: 0.1, safeBonds: 0.9, highYield: 0.0 };
    } else if (this.bot.currentSentiment === 'RISK_ON') {
      this.bot.portfolioTarget = { equity: 0.7, safeBonds: 0.0, highYield: 0.3 };
    } else {
      this.bot.portfolioTarget = { equity: 0.5, safeBonds: 0.3, highYield: 0.2 };
    }
  }

  public executeAggressiveSweep(currentMarket: any, myHoldings: any) {
    const orders: any[] = [];
    const currentSafeBondsRatio = (myHoldings.safeBonds || 0) / this.bot.capital;
    
    // 섹터별 타겟 비중 확인 (없으면 균등 분배로 간주)
    const sectorTargets = this.bot.sectorTargets || { 'TECH': 0.33, 'FINANCE': 0.33, 'BIO': 0.34 };
    const availableStocks = currentMarket.stocks || [];

    if (this.bot.currentSentiment === 'RISK_OFF' && currentSafeBondsRatio < this.bot.portfolioTarget.safeBonds) {
      // Risk-Off (패닉): 투매 스윕 (Sweep-to-Fill Down)
      const defenseMoney = this.bot.capital * 0.1;
      
      for (const stock of availableStocks) {
        if (stock.sector === 'FINANCE' || stock.sector === 'CONSUMER') {
          const tickSize = this.getTickSize(stock.current_price);
          const baseQty = Math.floor((defenseMoney / 10) / stock.current_price);
          
          if (baseQty > 0) {
            // 헤지펀드의 패닉셀: 긴급성(urgency)을 0.9로 설정하여 
            // BaseAgent가 판단하여 무조건 아래 호가를 부수며 스윕(Sweep)하게 만듦.
            const targetSellPrice = stock.current_price - (tickSize * 3);
            orders.push(...this.executeSmartOrder(
              stock,
              'sell',
              targetSellPrice,
              baseQty,
              0.9, // 극도의 긴급성 -> 스윕 매도 발동
              currentMarket.activeEvents
            ));
          }
        }
      }
    } else if (this.bot.currentSentiment === 'RISK_ON') {
      const currentEquityRatio = (myHoldings.equity || 0) / this.bot.capital;
      if (currentEquityRatio < this.bot.portfolioTarget.equity) {
        // Risk-On (탐욕): 매수 스윕 (Sweep-to-Fill Up)
        const equityToBuy = this.bot.capital * 0.2; 
        
        for (const [sector, weight] of Object.entries(sectorTargets)) {
          const sectorStocks = availableStocks.filter((s: any) => s.sector === sector);
          if (sectorStocks.length > 0) {
            const moneyForSector = equityToBuy * weight;
            const moneyPerStock = moneyForSector / sectorStocks.length;
            
            for (const stock of sectorStocks) {
              const totalQty = Math.floor(moneyPerStock / stock.current_price);
              
              if (totalQty > 0) {
                const tickSize = this.getTickSize(stock.current_price);
                const targetBuyPrice = stock.current_price + (tickSize * 3);
                
                orders.push(...this.executeSmartOrder(
                  stock,
                  'buy',
                  targetBuyPrice,
                  totalQty,
                  0.8, // 높은 긴급성 -> 스윕 매수 발동
                  currentMarket.activeEvents
                ));
              }
            }
          }
        }
      }
    }
    
    return orders;
  }
}
