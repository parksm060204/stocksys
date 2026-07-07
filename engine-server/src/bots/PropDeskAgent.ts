import type { PropDeskBot } from "../types";

export class PropDeskAgent {
  private bot: PropDeskBot;

  constructor(bot: PropDeskBot) {
    this.bot = bot;
  }

  public executeMarketMaking(currentMarket: any, orderBook: any, myHoldings: any) {
    const orders = [];

    for (const bond of currentMarket.bonds) {
      const currentInventory = myHoldings[bond.id] || 0;
      
      if (!orderBook || !orderBook[bond.id]) continue;

      const bestBid = orderBook[bond.id].bestBid;
      const bestAsk = orderBook[bond.id].bestAsk;
      
      if (!bestBid || !bestAsk) continue;

      const spreadGap = bestAsk - bestBid;
      const tickSize = this.getTickSize(bond.currentPrice);

      if (spreadGap >= tickSize * this.bot.mmConfig.targetSpreadHoga) {
        let myBidPrice = bestBid + tickSize;
        let myAskPrice = bestAsk - tickSize;

        if (currentInventory > this.bot.mmConfig.maxInventory * 0.8) {
          myBidPrice -= tickSize;
          myAskPrice -= tickSize;
        } else if (currentInventory <= 0) {
          myBidPrice += tickSize; 
          myAskPrice += tickSize; 
        }

        const orderVolume = Math.floor((this.bot.capital * 0.001) / bond.currentPrice);
        
        orders.push({ botId: this.bot.id, assetId: bond.id, orderType: 'LIMIT', side: 'BUY', price: myBidPrice, volume: orderVolume });
        orders.push({ botId: this.bot.id, assetId: bond.id, orderType: 'LIMIT', side: 'SELL', price: myAskPrice, volume: orderVolume });
      }
    }

    return orders;
  }

  private getTickSize(price: number): number {
    if (price < 2000) return 1;
    if (price < 5000) return 5;
    if (price < 20000) return 10;
    if (price < 50000) return 50;
    if (price < 200000) return 100;
    if (price < 500000) return 500;
    return 1000;
  }
}
