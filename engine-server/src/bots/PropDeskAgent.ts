import type { PropDeskBot } from "../types";
import { BaseAgent } from "./BaseAgent";

export class PropDeskAgent extends BaseAgent {
  private bot: PropDeskBot;

  constructor(bot: PropDeskBot) {
    super(bot.id, bot.capital);
    this.bot = bot;
  }

  public executeMarketMaking(currentMarket: any, orderBook: any, myHoldings: any) {
    const orders: any[] = [];
    const availableStocks = currentMarket.stocks || [];

    for (const stock of availableStocks) {
      const tickSize = this.getTickSize(stock.current_price);
      
      // HFT 봇은 매우 낮은 긴급성(0.1)으로 3틱 위아래에서 매매를 시도합니다.
      // 수량(목표 물량)을 크게 잡으면 BaseAgent의 자연스러운 판단 로직에 의해
      // 높은 확률로 스푸핑(Spoofing) 메커니즘이 발동됩니다.
      const targetQty = Math.floor((this.bot.capital * 0.05) / stock.current_price);
      if (targetQty <= 0) continue;

      const targetBuyPrice = stock.current_price - (tickSize * 3);
      const targetSellPrice = stock.current_price + (tickSize * 3);
      
      // 매수 사이드 스마트 주문 판단
      orders.push(...this.executeSmartOrder(
        stock,
        'buy',
        targetBuyPrice,
        targetQty,
        0.1, // 낮은 긴급성 -> 스푸핑이나 빙산 유도
        currentMarket.activeEvents
      ));

      // 매도 사이드 스마트 주문 판단
      orders.push(...this.executeSmartOrder(
        stock,
        'sell',
        targetSellPrice,
        targetQty,
        0.1,
        currentMarket.activeEvents
      ));
    }

    return orders;
  }
}
