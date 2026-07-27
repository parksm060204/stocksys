import { Order, Trade } from './types';

export class OrderBook {
  public contractTicker: string;
  // 매수호가: 내림차순 정렬 (높은 가격 우선)
  private bids: Order[] = [];
  // 매도호가: 오름차순 정렬 (낮은 가격 우선)
  private asks: Order[] = [];

  constructor(contractTicker: string) {
    this.contractTicker = contractTicker;
  }

  /**
   * 신규 주문 접수 및 즉시 매칭
   */
  public processOrder(order: Order): Trade[] {
    const trades: Trade[] = [];

    if (order.side === 'BUY') {
      this.matchOrders(order, this.asks, trades);
      if (order.quantity > order.filledQuantity && order.type !== 'MARKET') {
        this.insertOrder(this.bids, order, (a, b) => b.price - a.price);
      }
    } else {
      this.matchOrders(order, this.bids, trades);
      if (order.quantity > order.filledQuantity && order.type !== 'MARKET') {
        this.insertOrder(this.asks, order, (a, b) => a.price - b.price);
      }
    }

    return trades;
  }

  private matchOrders(incomingOrder: Order, oppositeBook: Order[], trades: Trade[]) {
    let i = 0;
    while (i < oppositeBook.length && incomingOrder.filledQuantity < incomingOrder.quantity) {
      const restingOrder = oppositeBook[i];

      // 가격 조건 검증 (지정가 매수일 때 매도호가가 더 높으면 체결 불가)
      if (incomingOrder.type === 'LIMIT' && incomingOrder.side === 'BUY' && restingOrder.price > incomingOrder.price) break;
      if (incomingOrder.type === 'LIMIT' && incomingOrder.side === 'SELL' && restingOrder.price < incomingOrder.price) break;

      const matchQuantity = Math.min(
        incomingOrder.quantity - incomingOrder.filledQuantity,
        restingOrder.quantity - restingOrder.filledQuantity
      );

      const executionPrice = restingOrder.price; // 잔량 지정가 우선 법칙

      incomingOrder.filledQuantity += matchQuantity;
      restingOrder.filledQuantity += matchQuantity;

      trades.push({
        tradeId: `TRD-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        contractTicker: this.contractTicker,
        buyOrderId: incomingOrder.side === 'BUY' ? incomingOrder.id : restingOrder.id,
        sellOrderId: incomingOrder.side === 'SELL' ? incomingOrder.id : restingOrder.id,
        buyBotId: incomingOrder.side === 'BUY' ? incomingOrder.botId : restingOrder.botId,
        sellBotId: incomingOrder.side === 'SELL' ? incomingOrder.botId : restingOrder.botId,
        price: executionPrice,
        quantity: matchQuantity,
        timestamp: Date.now(),
        isLiquidation: incomingOrder.type === 'LIQUIDATION' || restingOrder.type === 'LIQUIDATION'
      });

      // 호가 잔량이 모두 소진되면 호가창에서 제거
      if (restingOrder.filledQuantity >= restingOrder.quantity) {
        oppositeBook.splice(i, 1);
      } else {
        i++;
      }
    }
  }

  private insertOrder(book: Order[], order: Order, sortFn: (a: Order, b: Order) => number) {
    book.push(order);
    book.sort(sortFn);
  }

  // 최상단 호가 조회 (스프레드 계산용)
  public getBestBid(): number | null { return this.bids[0]?.price ?? null; }
  public getBestAsk(): number | null { return this.asks[0]?.price ?? null; }
}
