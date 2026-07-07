import type { HedgeFundBot, MarketSentiment } from "../types";

export class HedgeFundAgent {
  private bot: HedgeFundBot;

  constructor(bot: HedgeFundBot) {
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
    const orders = [];
    const currentSafeBondsRatio = (myHoldings.safeBonds || 0) / this.bot.capital;
    
    if (this.bot.currentSentiment === 'RISK_OFF' && currentSafeBondsRatio < this.bot.portfolioTarget.safeBonds) {
      orders.push(this.createMarketSweepOrder('EQUITY', 'SELL', (myHoldings.equity || 0) * 0.8));
      orders.push(this.createMarketSweepOrder('HIGH_YIELD_BOND', 'SELL', myHoldings.highYield || 0));
      orders.push(this.createMarketSweepOrder('SAFE_BOND', 'BUY', this.bot.capital * 0.5));
    } else if (this.bot.currentSentiment === 'RISK_ON') {
      const currentEquityRatio = (myHoldings.equity || 0) / this.bot.capital;
      if (currentEquityRatio < this.bot.portfolioTarget.equity) {
        orders.push(this.createMarketSweepOrder('SAFE_BOND', 'SELL', myHoldings.safeBonds || 0));
        orders.push(this.createMarketSweepOrder('EQUITY', 'BUY', this.bot.capital * 0.4));
        orders.push(this.createMarketSweepOrder('HIGH_YIELD_BOND', 'BUY', this.bot.capital * 0.2));
      }
    }
    
    return orders;
  }

  private createMarketSweepOrder(assetType: string, side: 'BUY' | 'SELL', amount: number) {
    return {
      botId: this.bot.id,
      assetType: assetType,
      orderType: 'MARKET',
      side: side,
      volume: amount,
      timestamp: Date.now()
    };
  }
}
