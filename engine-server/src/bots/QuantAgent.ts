import type { QuantBot, MarketEvent } from "../types";
import { BaseAgent } from "./BaseAgent";
import { EventBus } from "../EventBus";

interface PendingNews {
  event: MarketEvent;
  receivedAt: number;
}

export class QuantAgent extends BaseAgent {
  private bot: QuantBot;
  private pendingNews: PendingNews[] = [];
  
  constructor(bot: QuantBot) {
    super(bot.id, bot.capital);
    this.bot = bot;

    // EventBus 구독: 뉴스 이벤트가 발생하면 즉시 비동기로 수신
    EventBus.subscribe('NEWS_ALERT', (event: MarketEvent) => {
      this.pendingNews.push({
        event,
        receivedAt: Date.now()
      });
      console.log(`[QuantAgent] Received breaking news: ${event.id} (Reliability: ${event.reliability || 0})`);
    });
  }

  public executeQuantStrategy(currentMarket: any, orderBook: any) {
    const orders: any[] = [];
    const availableStocks = currentMarket.stocks || [];

    // 대기 중인 뉴스가 없으면 액션 없음 (O(1) 조기 종료)
    if (this.pendingNews.length === 0) return orders;

    // 현재 처리할 뉴스 복사 및 큐 초기화
    const newsToProcess = [...this.pendingNews];
    this.pendingNews = [];

    for (const item of newsToProcess) {
      const { event } = item;
      const targetStockId = event.targetSector; // 시뮬레이션을 위해 sector 필드를 stock id라고 가정하거나, 해당 섹터 주식 전체 타겟
      const stock = availableStocks.find((s: any) => s.id === targetStockId || s.sector === targetStockId);
      
      if (!stock) continue;

      const p0 = stock.current_price;
      const tau = event.reliability !== undefined ? event.reliability : 0.5; // 신뢰도 [0, 1]
      
      // 뉴스의 임팩트를 주가 등락폭 단위로 변환 (간이 모델)
      let deltaNews = 0;
      switch (event.impact) {
        case 'STRONG_POSITIVE': deltaNews = p0 * 0.15; break;
        case 'POSITIVE': deltaNews = p0 * 0.05; break;
        case 'NEGATIVE': deltaNews = -p0 * 0.05; break;
        case 'STRONG_NEGATIVE': deltaNews = -p0 * 0.15; break;
      }

      // Kyle's Model: v = p0 + tau * deltaNews
      const v = p0 + (tau * deltaNews);

      // 호가창 유동성(Lambda) 추정. 깊을수록 작은 람다(시장 충격이 적음)
      const stockBook = orderBook[stock.id] || { asks: [], bids: [] };
      let liquidityDepth = 0;
      for (let i = 0; i < 3; i++) {
        if (stockBook.asks[i]) liquidityDepth += stockBook.asks[i].total_volume;
        if (stockBook.bids[i]) liquidityDepth += stockBook.bids[i].total_volume;
      }
      
      // lambda가 0에 가까워지는 것을 방지
      const lambda = Math.max(0.001, 1000 / (liquidityDepth + 1)); 

      // 최적 주문량: x* = (v - p0) / (2 * lambda)
      const x_star = (v - p0) / (2 * lambda);
      
      const qty = Math.floor(Math.abs(x_star));

      if (qty > 0) {
        const action = x_star > 0 ? 'buy' : 'sell';
        const tickSize = this.getTickSize(p0);
        
        // 찌라시(가짜 뉴스, tau 낮음)일지라도, tau가 0이 아니면 일단 덤벼듭니다.
        // 나중에 해명 뉴스(tau=0, NEGATIVE)가 뜨면 투매하게 됩니다.
        
        // 자본 한도 적용
        const requiredCapital = qty * p0;
        const actualQty = action === 'buy' && requiredCapital > this.capital ? Math.floor(this.capital / p0) : qty;

        if (actualQty > 0) {
          const targetPrice = action === 'buy' ? p0 + tickSize * 5 : p0 - tickSize * 5;
          orders.push(...this.executeSmartOrder(stock, action, targetPrice, actualQty, 1.0, [event]));
          console.log(`[QuantAgent] Informed Trading on ${stock.name}: v=${v.toFixed(0)}, qty=${actualQty}, action=${action}`);
        }
      }
    }

    return orders;
  }
}
