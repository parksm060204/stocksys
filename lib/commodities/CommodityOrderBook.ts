import { CommodityOrder, CommodityTrade } from './types';
import type { SimulationTimeSource } from '../engine/simulation/runtime/simulationTimeSource';

export interface MatchResult {
  trades: CommodityTrade[];
  selfTradeCancelledOrders: CommodityOrder[];
  totalBuyVolume: number;
  totalSellVolume: number;
  netBuyVolume: number; // buyVolume - sellVolume
  executedNotional: number;
  matchedTradesCount: number;
}

export class CommodityOrderBook {
  public readonly commodityId: string;
  public bids: CommodityOrder[] = [];
  public asks: CommodityOrder[] = [];
  private readonly clock?: SimulationTimeSource;

  constructor(commodityId: string, clock?: SimulationTimeSource) {
    this.commodityId = commodityId;
    this.clock = clock;
  }

  /**
   * 주문 등록 (지정가 / 시장가)
   */
  public addOrder(order: CommodityOrder): boolean {
    if (!order || typeof order !== 'object') return false;
    if (order.side !== 'buy' && order.side !== 'sell') return false;
    if (order.type !== 'limit' && order.type !== 'market') return false;
    if (typeof order.size !== 'number' || !Number.isFinite(order.size) || !Number.isInteger(order.size) || order.size <= 0) {
      return false;
    }
    if (order.type === 'limit') {
      if (typeof order.price !== 'number' || !Number.isFinite(order.price) || order.price <= 0) {
        return false;
      }
    } else if (!Number.isFinite(order.price) || order.price < 0) {
      order.price = 0;
    }
    if (typeof order.filled !== 'number' || !Number.isFinite(order.filled) || order.filled < 0) {
      order.filled = 0;
    }

    if (order.side === 'buy') {
      this.bids.push(order);
      this.sortBids();
    } else {
      this.asks.push(order);
      this.sortAsks();
    }
    return true;
  }

  /**
   * 매수 호가 정렬:
   * 1. 시장가(market) 최우선
   * 2. 가격 높은 순 (내림차순)
   * 3. 생성 시각 빠른 순 (오름차순)
   */
  private sortBids(): void {
    this.bids.sort((a, b) => {
      if (a.type === 'market' && b.type !== 'market') return -1;
      if (a.type !== 'market' && b.type === 'market') return 1;
      if (b.price !== a.price) {
        return b.price - a.price; // 높은 가격 우선
      }
      return a.createdAtTick - b.createdAtTick || a.createdAtTime - b.createdAtTime; // 시간 우선
    });
  }

  /**
   * 매도 호가 정렬:
   * 1. 시장가(market) 최우선
   * 2. 가격 낮은 순 (오름차순)
   * 3. 생성 시각 빠른 순 (오름차순)
   */
  private sortAsks(): void {
    this.asks.sort((a, b) => {
      if (a.type === 'market' && b.type !== 'market') return -1;
      if (a.type !== 'market' && b.type === 'market') return 1;
      if (a.price !== b.price) {
        return a.price - b.price; // 낮은 가격 우선
      }
      return a.createdAtTick - b.createdAtTick || a.createdAtTime - b.createdAtTime; // 시간 우선
    });
  }

  public snapshotState(): { bids: CommodityOrder[]; asks: CommodityOrder[] } {
    return {
      bids: this.bids.map((o) => ({ ...o })),
      asks: this.asks.map((o) => ({ ...o })),
    };
  }

  public restoreState(snap: { bids: CommodityOrder[]; asks: CommodityOrder[] }): void {
    this.bids = snap.bids.map((o) => ({ ...o }));
    this.asks = snap.asks.map((o) => ({ ...o }));
  }

  /**
   * 틱 종료 시점 오더북 매칭 및 체결
   * @param currentMarketPrice 현재 시장 기준가
   * @param currentTick 현재 틱 번호
   */
  public matchOrders(
    currentMarketPrice: number,
    currentTick: number,
    tradeIdGenerator?: () => string
  ): MatchResult {
    const trades: CommodityTrade[] = [];
    const selfTradeCancelledOrders: CommodityOrder[] = [];
    let totalBuyVolume = 0;
    let totalSellVolume = 0;
    let executedNotional = 0;
    let takerBuyVolume = 0;
    let takerSellVolume = 0;

    while (this.bids.length > 0 && this.asks.length > 0) {
      const topBid = this.bids[0];
      const topAsk = this.asks[0];
      if (!topBid || !topAsk) break;

      // 자기 매매 방지: 동일 사용자 주문이 교차하면 나중 주문을 취소하고 증거금 환불 대상에 포함
      if (topBid.userId && topAsk.userId && topBid.userId === topAsk.userId) {
        const bidIsNewer =
          topBid.createdAtTick > topAsk.createdAtTick ||
          (topBid.createdAtTick === topAsk.createdAtTick && topBid.createdAtTime >= topAsk.createdAtTime);
        if (bidIsNewer) {
          this.bids.shift();
          selfTradeCancelledOrders.push(topBid);
        } else {
          this.asks.shift();
          selfTradeCancelledOrders.push(topAsk);
        }
        continue;
      }

      // 시장가 주문 가격 치환 (매수는 최고가, 매도는 최저가로 간주)
      const bidEffectivePrice = topBid.type === 'market' ? Infinity : topBid.price;
      const askEffectivePrice = topAsk.type === 'market' ? 0 : topAsk.price;

      // 체결 가능 조건: 매수가 >= 매도가
      if (bidEffectivePrice < askEffectivePrice) {
        break; // 교차 호가 없음
      }

      // 체결 가격 결정: Maker-Taker 원칙 (먼저 등록된 주문의 가격)
      let tradePrice = currentMarketPrice;
      const isBidTaker = topBid.createdAtTick > topAsk.createdAtTick || topBid.type === 'market';
      const isAskTaker = topAsk.createdAtTick > topBid.createdAtTick || topAsk.type === 'market';

      if (topBid.type !== 'market' && topAsk.type !== 'market') {
        tradePrice = topBid.createdAtTick <= topAsk.createdAtTick ? topBid.price : topAsk.price;
      } else if (topBid.type !== 'market') {
        tradePrice = topBid.price;
      } else if (topAsk.type !== 'market') {
        tradePrice = topAsk.price;
      }

      const bidRemaining = topBid.size - topBid.filled;
      const askRemaining = topAsk.size - topAsk.filled;

      // 비정상 잔량(NaN/Infinity/0 이하) 방어: 루프가 반드시 진행하거나 종료되도록 제거
      if (!Number.isFinite(bidRemaining) || bidRemaining <= 0) {
        this.bids.shift();
        continue;
      }
      if (!Number.isFinite(askRemaining) || askRemaining <= 0) {
        this.asks.shift();
        continue;
      }

      const tradeSize = Math.min(bidRemaining, askRemaining);
      if (!Number.isFinite(tradeSize) || tradeSize <= 0) {
        this.bids.shift();
        this.asks.shift();
        continue;
      }
      if (!Number.isFinite(tradePrice) || tradePrice <= 0) {
        break;
      }

      // 체결 처리
      topBid.filled += tradeSize;
      topAsk.filled += tradeSize;

      if (isBidTaker && !isAskTaker) {
        takerBuyVolume += tradeSize;
      } else if (isAskTaker && !isBidTaker) {
        takerSellVolume += tradeSize;
      } else {
        takerBuyVolume += tradeSize * 0.5;
        takerSellVolume += tradeSize * 0.5;
      }

      const trade: CommodityTrade = {
        id: tradeIdGenerator ? tradeIdGenerator() : `trade_${this.commodityId}_${currentTick}_${trades.length + 1}`,
        commodityId: this.commodityId,
        buyOrderId: topBid.id,
        sellOrderId: topAsk.id,
        buyerId: topBid.botId || topBid.userId,
        sellerId: topAsk.botId || topAsk.userId,
        price: tradePrice,
        size: tradeSize,
        tick: currentTick,
        timestamp: this.clock ? this.clock.now() : currentTick * 1000,
      };

      trades.push(trade);

      totalBuyVolume += tradeSize;
      totalSellVolume += tradeSize;
      executedNotional += tradePrice * tradeSize;

      // 주문 완전 체결 시 오더북에서 제거
      if (topBid.filled >= topBid.size) {
        this.bids.shift();
      }
      if (topAsk.filled >= topAsk.size) {
        this.asks.shift();
      }
    }

    return {
      trades,
      selfTradeCancelledOrders,
      totalBuyVolume,
      totalSellVolume,
      netBuyVolume: takerBuyVolume - takerSellVolume,
      executedNotional,
      matchedTradesCount: trades.length,
    };
  }

  /**
   * 오더북 최우선 호가 및 스프레드 조회
   */
  public getSpread(fallbackPrice: number): { bestBid: number; bestAsk: number; spread: number; spreadPct: number } {
    const validBids = this.bids.filter((b) => b.type === 'limit');
    const validAsks = this.asks.filter((a) => a.type === 'limit');

    const topB = validBids[0];
    const topA = validAsks[0];

    const bestBid = topB ? topB.price : fallbackPrice * 0.99;
    const bestAsk = topA ? topA.price : fallbackPrice * 1.01;
    const spread = Math.max(0, bestAsk - bestBid);
    const mid = (bestBid + bestAsk) / 2;
    const spreadPct = mid > 0 ? (spread / mid) * 100 : 0;

    return { bestBid, bestAsk, spread, spreadPct };
  }

  /**
   * 오더북 호가 깊이 (Depth) 조회
   */
  public getDepth(levels: number = 5): {
    bids: { price: number; totalSize: number; orderCount: number }[];
    asks: { price: number; totalSize: number; orderCount: number }[];
  } {
    const bidMap = new Map<number, { totalSize: number; orderCount: number }>();
    const askMap = new Map<number, { totalSize: number; orderCount: number }>();

    for (const b of this.bids) {
      if (b.type !== 'limit') continue;
      const rem = b.size - b.filled;
      const entry = bidMap.get(b.price) || { totalSize: 0, orderCount: 0 };
      entry.totalSize += rem;
      entry.orderCount += 1;
      bidMap.set(b.price, entry);
    }

    for (const a of this.asks) {
      if (a.type !== 'limit') continue;
      const rem = a.size - a.filled;
      const entry = askMap.get(a.price) || { totalSize: 0, orderCount: 0 };
      entry.totalSize += rem;
      entry.orderCount += 1;
      askMap.set(a.price, entry);
    }

    const bids = Array.from(bidMap.entries())
      .map(([price, val]) => ({ price, totalSize: val.totalSize, orderCount: val.orderCount }))
      .sort((a, b) => b.price - a.price)
      .slice(0, levels);

    const asks = Array.from(askMap.entries())
      .map(([price, val]) => ({ price, totalSize: val.totalSize, orderCount: val.orderCount }))
      .sort((a, b) => a.price - b.price)
      .slice(0, levels);

    return { bids, asks };
  }

  /**
   * 오래된 미체결 주문 청소 (만료된 주문 목록 반환)
   */
  public extractExpiredOrders(maxAgeTicks: number, currentTick: number): CommodityOrder[] {
    const expired: CommodityOrder[] = [];
    const activeBids: CommodityOrder[] = [];
    for (const o of this.bids) {
      if (currentTick - o.createdAtTick <= maxAgeTicks) {
        activeBids.push(o);
      } else {
        expired.push(o);
      }
    }
    const activeAsks: CommodityOrder[] = [];
    for (const o of this.asks) {
      if (currentTick - o.createdAtTick <= maxAgeTicks) {
        activeAsks.push(o);
      } else {
        expired.push(o);
      }
    }
    this.bids = activeBids;
    this.asks = activeAsks;
    return expired;
  }

  public clearExpiredOrders(maxAgeTicks: number, currentTick: number): number {
    return this.extractExpiredOrders(maxAgeTicks, currentTick).length;
  }

  /**
   * 특정 주문 ID 취소/제거 (롤백 또는 사용자 취소용)
   */
  public removeOrder(orderId: string): CommodityOrder | null {
    const bidIdx = this.bids.findIndex((o) => o.id === orderId);
    if (bidIdx !== -1) {
      const [removed] = this.bids.splice(bidIdx, 1);
      return removed;
    }
    const askIdx = this.asks.findIndex((o) => o.id === orderId);
    if (askIdx !== -1) {
      const [removed] = this.asks.splice(askIdx, 1);
      return removed;
    }
    return null;
  }

  /**
   * 특정 봇의 미체결 주문 취소
   */
  public cancelBotOrders(botId: string): void {
    this.bids = this.bids.filter((o) => o.botId !== botId);
    this.asks = this.asks.filter((o) => o.botId !== botId);
  }

  /**
   * 전체 오더북 초기화
   */
  public clear(): void {
    this.bids = [];
    this.asks = [];
  }
}
