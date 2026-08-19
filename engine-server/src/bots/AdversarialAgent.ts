import { BaseAgent } from "./BaseAgent";
import { CircularQueue } from "./utils/CircularQueue";

export class AdversarialAgent extends BaseAgent {
  public id = 'PROP_DESK_PREDATOR';
  private lobHistory: Map<string, CircularQueue<any>> = new Map(); 

  constructor() {
    super({ id: 'PROP_DESK_PREDATOR', baseWeights: { stock: 0.5, bond: 0, commodity: 0, cash: 0.5 } } as any, 50000000000); // 500억
  }



  public triggerManipulation(stockId: string, marketCap: number, currentPrice: number) {
    console.log(`[Adversarial] Triggered manipulation for ${stockId} (Cap: ${marketCap}, Price: ${currentPrice})`);
  }

  // 틱마다 MarketEngine에서 호출할 진입점
  public executeManipulation(marketState: any): any[] {
    const orders: any[] = [];
    
    // 단순 LOB 추론 로직
    if (marketState.orderBook) {
      for (const [stockId, book] of Object.entries(marketState.orderBook)) {
        const b = book as { bids: any[], asks: any[] };
        if (b.bids.length > 0 && b.asks.length > 0) {
          const lobInfo = {
            bestBidPrice: b.bids[0].price,
            bestBidVol: b.bids[0].size,
            bestAskPrice: b.asks[0].price,
            bestAskVol: b.asks[0].size
          };
          orders.push(...this.executeFrontRunning(stockId, lobInfo));
        }
      }
    }
    
    return orders;
  }

  // 이벤트 주도형 호출: LOB 정보(최우선 매수/매도 호가와 잔량)
  public executeFrontRunning(stockId: string, currentLOB: { bestBidPrice: number, bestBidVol: number, bestAskPrice: number, bestAskVol: number }): any[] {
    const orders: any[] = [];
    
    if (!this.lobHistory.has(stockId)) {
      this.lobHistory.set(stockId, new CircularQueue(5)); // 최대 5틱 유지 (O(1))
    }
    
    const history = this.lobHistory.get(stockId)!;
    history.push(currentLOB);

    if (history.length() === 5) {
      // OFI (Order Flow Imbalance) 계산
      let ofiSum = 0;
      let priceStagnant = true;
      const basePrice = history.get(0).bestBidPrice;

      for (let i = 1; i < history.length(); i++) {
        const prev = history.get(i-1);
        const curr = history.get(i);
        
        if (curr.bestBidPrice !== basePrice) priceStagnant = false;

        const dvb = curr.bestBidPrice > prev.bestBidPrice ? curr.bestBidVol : (curr.bestBidPrice === prev.bestBidPrice ? curr.bestBidVol - prev.bestBidVol : -prev.bestBidVol);
        const dvs = curr.bestAskPrice < prev.bestAskPrice ? curr.bestAskVol : (curr.bestAskPrice === prev.bestAskPrice ? curr.bestAskVol - prev.bestAskVol : -prev.bestAskVol);
        
        ofiSum += (dvb - dvs);
      }

      // 고래(연기금) 감지: 가격은 그대로인데 매수세가 비정상적으로 누적됨 (예: 5만 주 이상 누적)
      if (priceStagnant && ofiSum > 50000) {
        console.log(`[Adversarial] 🦈 Whale detected on ${stockId}! OFI: ${ofiSum}. Front-running!`);
        const tickSize = this.getTickSize(basePrice);
        const frontRunPrice = basePrice + tickSize; // 정확히 1틱 위에서 새치기

        orders.push({
          stock_id: stockId,
          user_id: null, // LP 봇은 항상 null (UUID 컬럼에 문자열 삽입 금지)
          side: 'buy',
          price: frontRunPrice,
          size: 1000, // 가로채기 물량
          status: 'open',
          is_lp: true,
          _botId: this.botId
        });
        
        // 실행 후 큐 초기화 (연속 발동 방지)
        this.lobHistory.set(stockId, new CircularQueue(5));
      }
    }
    
    return orders;
  }
}
