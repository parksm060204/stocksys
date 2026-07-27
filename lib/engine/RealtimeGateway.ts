import { OrderBookTick, TradeFeedEvent, RolloverAlertEvent } from './wsTypes';

export class RealtimeGateway {
  private orderBookBuffer: Map<string, OrderBookTick> = new Map();
  private listeners: Map<string, Set<(data: any) => void>> = new Map();
  private batchInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startTickBatcher(100); // 100ms Debounce Batching
  }

  public subscribe(channel: string, callback: (data: any) => void) {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel)!.add(callback);

    return () => {
      this.unsubscribe(channel, callback);
    };
  }

  public unsubscribe(channel: string, callback: (data: any) => void) {
    const channelListeners = this.listeners.get(channel);
    if (channelListeners) {
      channelListeners.delete(callback);
    }
  }

  private emit(channel: string, data: any) {
    const channelListeners = this.listeners.get(channel);
    if (channelListeners) {
      channelListeners.forEach(cb => cb(data));
    }
  }

  public updateOrderBookBuffer(ticker: string, bids: [number, number][], asks: [number, number][]) {
    this.orderBookBuffer.set(ticker, {
      ticker,
      bids: bids.slice(0, 10),
      asks: asks.slice(0, 10),
      timestamp: Date.now()
    });
  }

  public broadcastTrade(trade: TradeFeedEvent) {
    this.emit(`trades:${trade.ticker}`, trade);

    if (trade.isLiquidation && trade.quantity >= 500) {
      this.emit('liquidation_alert', {
        message: `🚨 [ALERT] ${trade.ticker} ${trade.quantity}계약 대량 강제청산 발생!`,
        trade
      });
    }
  }

  public broadcastRollover(rollover: RolloverAlertEvent) {
    this.emit('rollover:feed', rollover);
  }

  private startTickBatcher(intervalMs: number) {
    this.batchInterval = setInterval(() => {
      if (this.orderBookBuffer.size === 0) return;

      this.orderBookBuffer.forEach((tick, ticker) => {
        this.emit(`orderbook:${ticker}`, tick);
      });

      this.orderBookBuffer.clear();
    }, intervalMs);
  }

  public close() {
    if (this.batchInterval) clearInterval(this.batchInterval);
    this.listeners.clear();
  }
}

// Singleton — browser-only (setInterval은 SSR에서 실행 불가)
let _gatewayInstance: RealtimeGateway | null = null;

export function getRealtimeGateway(): RealtimeGateway {
  if (!_gatewayInstance) {
    _gatewayInstance = new RealtimeGateway();
  }
  return _gatewayInstance;
}

// 클라이언트 컴포넌트 & 엔진 전용 싱글톤 참조 (SSR guard)
export const globalRealtimeGateway: RealtimeGateway =
  typeof window !== 'undefined' ? getRealtimeGateway() : (null as unknown as RealtimeGateway);
