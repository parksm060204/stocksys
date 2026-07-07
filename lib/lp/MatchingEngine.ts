import { Order, TradeRecord } from "./types";

export class MatchingEngine {
  public asks: Order[] = []; // Sorted ascending by price
  public bids: Order[] = []; // Sorted descending by price
  public lastPrice: number;
  public trades: TradeRecord[] = []; // Recent trades

  private orderIdCounter = 0;

  constructor(initialPrice: number) {
    this.lastPrice = initialPrice;
  }

  public generateOrderId(): string {
    return `ord_${++this.orderIdCounter}_${Date.now()}`;
  }

  public addOrder(orderParams: Omit<Order, "id" | "createdAt" | "remainingSize">): { order: Order; trades: TradeRecord[] } {
    const order: Order = {
      ...orderParams,
      id: this.generateOrderId(),
      createdAt: Date.now(),
      remainingSize: orderParams.size,
    };

    const newTrades: TradeRecord[] = [];

    // Match order
    if (order.side === "buy") {
      while (order.remainingSize > 0 && this.asks.length > 0) {
        const bestAsk = this.asks[0];
        if (order.type === "limit" && order.price < bestAsk.price) {
          break; // Cannot match
        }

        const tradeSize = Math.min(order.remainingSize, bestAsk.remainingSize);
        const tradePrice = bestAsk.price; // Maker's price

        newTrades.push({
          id: `trd_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          makerOrderId: bestAsk.id,
          takerOrderId: order.id,
          makerAccountId: bestAsk.accountId,
          takerAccountId: order.accountId,
          price: tradePrice,
          size: tradeSize,
          timestamp: Date.now(),
          side: "buy", // taker side
        });

        order.remainingSize -= tradeSize;
        bestAsk.remainingSize -= tradeSize;
        this.lastPrice = tradePrice;

        if (bestAsk.remainingSize === 0) {
          this.asks.shift();
        }
      }

      if (order.remainingSize > 0 && order.type === "limit") {
        this.insertBid(order);
      }
    } else {
      while (order.remainingSize > 0 && this.bids.length > 0) {
        const bestBid = this.bids[0];
        if (order.type === "limit" && order.price > bestBid.price) {
          break;
        }

        const tradeSize = Math.min(order.remainingSize, bestBid.remainingSize);
        const tradePrice = bestBid.price;

        newTrades.push({
          id: `trd_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
          makerOrderId: bestBid.id,
          takerOrderId: order.id,
          makerAccountId: bestBid.accountId,
          takerAccountId: order.accountId,
          price: tradePrice,
          size: tradeSize,
          timestamp: Date.now(),
          side: "sell", // taker side
        });

        order.remainingSize -= tradeSize;
        bestBid.remainingSize -= tradeSize;
        this.lastPrice = tradePrice;

        if (bestBid.remainingSize === 0) {
          this.bids.shift();
        }
      }

      if (order.remainingSize > 0 && order.type === "limit") {
        this.insertAsk(order);
      }
    }

    this.trades.push(...newTrades);
    // Keep only last 100 trades to save memory
    if (this.trades.length > 100) {
      this.trades = this.trades.slice(-100);
    }

    return { order, trades: newTrades };
  }

  public cancelOrder(orderId: string): boolean {
    const askIndex = this.asks.findIndex((o) => o.id === orderId);
    if (askIndex !== -1) {
      this.asks.splice(askIndex, 1);
      return true;
    }

    const bidIndex = this.bids.findIndex((o) => o.id === orderId);
    if (bidIndex !== -1) {
      this.bids.splice(bidIndex, 1);
      return true;
    }

    return false;
  }
  
  public cancelAllOrdersByAccount(accountId: string) {
    this.asks = this.asks.filter(o => o.accountId !== accountId);
    this.bids = this.bids.filter(o => o.accountId !== accountId);
  }

  private insertBid(order: Order) {
    const index = this.bids.findIndex((b) => order.price > b.price);
    if (index === -1) {
      this.bids.push(order);
    } else {
      this.bids.splice(index, 0, order);
    }
  }

  private insertAsk(order: Order) {
    const index = this.asks.findIndex((a) => order.price < a.price);
    if (index === -1) {
      this.asks.push(order);
    } else {
      this.asks.splice(index, 0, order);
    }
  }

  // UI에 보여주기 위한 호가 합산 (최대 levels 호가)
  public getAggregatedBook(basePrice: number, tickSize: number, levels: number) {
    const asksResult: { price: number; size: number; total: number }[] = [];
    const bidsResult: { price: number; size: number; total: number }[] = [];

    let askTotal = 0;
    for (let i = 0; i < levels; i++) {
      const p = +(basePrice + tickSize * (i + 1)).toFixed(2);
      const size = this.asks.filter(o => o.price === p).reduce((sum, o) => sum + o.remainingSize, 0);
      askTotal += size;
      asksResult.push({ price: p, size, total: askTotal });
    }

    let bidTotal = 0;
    for (let i = 0; i < levels; i++) {
      const p = +(basePrice - tickSize * (i + 1)).toFixed(2);
      const size = this.bids.filter(o => o.price === p).reduce((sum, o) => sum + o.remainingSize, 0);
      bidTotal += size;
      bidsResult.push({ price: p, size, total: bidTotal });
    }

    return { asks: asksResult, bids: bidsResult, spread: +(asksResult[0].price - bidsResult[0].price).toFixed(2) };
  }
}
