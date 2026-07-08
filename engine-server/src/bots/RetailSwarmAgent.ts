import type { RetailSwarmBot } from "../types";

export class RetailSwarmAgent {
  private bot: RetailSwarmBot;

  constructor(bot: RetailSwarmBot) {
    this.bot = bot;
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

  public executeSwarmBehavior(currentMarket: any, myHoldings: any) {
    const orders: any[] = [];
    const availableStocks = currentMarket.stocks || [];
    const activeEvents = currentMarket.activeEvents || [];

    for (const stock of availableStocks) {
      if (!stock.previous_close || stock.previous_close === 0) continue;
      
      let fomoOverride = false;
      let panicOverride = false;

      // 뉴스 이벤트 확인하여 개미들의 광기/공포 스위치 켜기
      for (const event of activeEvents) {
        if (event.targetSector === 'ALL' || event.targetSector === stock.sector) {
          if (event.impact === 'STRONG_POSITIVE' || event.impact === 'POSITIVE') {
            fomoOverride = true;
          } else if (event.impact === 'STRONG_NEGATIVE' || event.impact === 'NEGATIVE') {
            panicOverride = true;
          }
        }
      }
      
      const dayReturn = (stock.current_price - stock.previous_close) / stock.previous_close;
      const tickSize = this.getTickSize(stock.current_price);

      // 1. FOMO Buy Logic (불나방 매수 - 호가창이 맞닿는 최우선 매도호가를 즉시 긁음)
      if (this.bot.tradingStyle === 'MOMENTUM_CHASER' && (dayReturn >= this.bot.fomoThreshold || fomoOverride)) {
        const antSwarmCount = fomoOverride ? Math.floor(Math.random() * 20) + 15 : Math.floor(Math.random() * 10) + 5; 
        for (let i = 0; i < antSwarmCount; i++) {
          const tinyQty = Math.floor(Math.random() * 3) + 1; // 1~3주
          // 최우선 매도호가(현재가 + 1틱)를 즉시 타격하여 체결(Trade) 발생시킴
          const executionPrice = stock.current_price + (Math.floor(Math.random() * 2) * tickSize); 
          
          orders.push({
            stock_id: stock.id,
            user_id: null,
            side: 'buy',
            price: executionPrice,
            size: tinyQty,
            status: 'open',
            is_lp: true
          });
        }
      }

      // 2. Dip Buying Logic (동학개미 - 하락 시 최우선 매수호가에 주문을 넣거나 방어)
      if (this.bot.tradingStyle === 'VALUE_DIP_BUYER' && dayReturn <= this.bot.panicThreshold && !panicOverride) {
        const antSwarmCount = Math.floor(Math.random() * 10) + 5; 
        for (let i = 0; i < antSwarmCount; i++) {
          const tinyQty = Math.floor(Math.random() * 5) + 1;
          // 매도세에 맞서기 위해 현재가(최우선 호가) 부근에서 체결 유도
          const executionPrice = stock.current_price - (Math.floor(Math.random() * 2) * tickSize);
          
          orders.push({
            stock_id: stock.id,
            user_id: null,
            side: 'buy',
            price: executionPrice, 
            size: tinyQty,
            status: 'open',
            is_lp: true
          });
        }
      }

      // 3. Panic Sell Logic (투매 - 호가창이 맞닿는 최우선 매수호가를 즉시 때림)
      if (dayReturn <= this.bot.panicThreshold || panicOverride) {
        const antSwarmCount = panicOverride ? Math.floor(Math.random() * 25) + 10 : Math.floor(Math.random() * 15) + 5; 
        for (let i = 0; i < antSwarmCount; i++) {
          const tinyQty = Math.floor(Math.random() * 3) + 1;
          // 최우선 매수호가(현재가 - 1틱)를 즉시 타격하여 체결 발생시킴
          const executionPrice = stock.current_price - (Math.floor(Math.random() * 2) * tickSize);
          
          orders.push({
            stock_id: stock.id,
            user_id: null,
            side: 'sell',
            price: executionPrice,
            size: tinyQty,
            status: 'open',
            is_lp: true
          });
        }
      }
    }

    return orders;
  }
}

