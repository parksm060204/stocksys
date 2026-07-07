import type { PropDeskBot } from "./types";

export class PropDeskAgent {
  private bot: PropDeskBot;

  constructor(bot: PropDeskBot) {
    this.bot = bot;
  }

  public executeMarketMaking(currentMarket: any, orderBook: any, myHoldings: any) {
    // 1. KST 정규장 확인 
    const currentKSTHour = (new Date().getUTCHours() + 9) % 24;
    if (currentKSTHour < 18 || currentKSTHour >= 22.5) return;

    const orders = [];

    for (const bond of currentMarket.bonds) {
      const currentInventory = myHoldings[bond.id] || 0;
      
      // 종목별 최우선 매수/매도 호가 파악
      if (!orderBook[bond.id]) continue;

      const bestBid = orderBook[bond.id].bestBid; // 가장 높은 매수 희망가
      const bestAsk = orderBook[bond.id].bestAsk; // 가장 낮은 매도 희망가
      
      if (!bestBid || !bestAsk) continue;

      // 스프레드(호가 차이)가 타겟 이상으로 벌어졌는지 확인
      const spreadGap = bestAsk - bestBid;
      const tickSize = this.getTickSize(bond.currentPrice);

      if (spreadGap >= tickSize * this.bot.mmConfig.targetSpreadHoga) {
        
        // 기본 마켓 메이킹: 빈 공간의 중간에 양방향 지정가 주문 제출
        let myBidPrice = bestBid + tickSize;
        let myAskPrice = bestAsk - tickSize;

        // [재고 관리 로직 - Inventory Skewing]
        if (currentInventory > this.bot.mmConfig.maxInventory * 0.8) {
          myBidPrice -= tickSize; // 더 싼 가격 아니면 안 삼
          myAskPrice -= tickSize; // 1틱 손해 보더라도 빨리 팔아서 재고 비움
        } 
        else if (currentInventory <= 0) {
          myBidPrice += tickSize; 
          myAskPrice += tickSize; 
        }

        // 양방향 호가 제출 (유동성 공급)
        const orderVolume = Math.floor((this.bot.capital * 0.001) / bond.currentPrice); // 소액으로 잘게 쪼개서
        
        orders.push({ botId: this.bot.id, assetId: bond.id, orderType: 'LIMIT', side: 'BUY', price: myBidPrice, volume: orderVolume });
        orders.push({ botId: this.bot.id, assetId: bond.id, orderType: 'LIMIT', side: 'SELL', price: myAskPrice, volume: orderVolume });
      }
    }

    if (orders.length > 0) {
      this.submitLimitOrders(orders);
    }
  }

  // 호가 단위 계산 헬퍼 함수
  private getTickSize(price: number): number {
    if (price < 2000) return 1;
    if (price < 5000) return 5;
    if (price < 20000) return 10;
    if (price < 50000) return 50;
    if (price < 200000) return 100;
    if (price < 500000) return 500;
    return 1000;
  }

  private submitLimitOrders(orders: any[]) {
    // 엔진으로 주문 전송
    console.log(`[PropDesk ${this.bot.name}] Submitting ${orders.length} limit orders for market making.`);
  }
}
