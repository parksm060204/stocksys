export type EventCallback = (payload: any) => void;

class EventBusImpl {
  private subscribers: Record<string, EventCallback[]> = {};
  private symbolSubscribers: Record<string, EventCallback[]> = {};
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
  private pendingDebouncedPayloads: Map<string, any> = new Map();

  // 이벤트 채널을 구독합니다.
  public subscribe(channel: string, callback: EventCallback): () => void {
    if (!this.subscribers[channel]) {
      this.subscribers[channel] = [];
    }
    this.subscribers[channel]!.push(callback);

    return () => {
      this.subscribers[channel] = (this.subscribers[channel] || []).filter((cb) => cb !== callback);
    };
  }

  // 특정 종목 단위(SymbolId)로 구독합니다.
  public subscribeSymbol(symbolId: string, callback: EventCallback): () => void {
    if (!this.symbolSubscribers[symbolId]) {
      this.symbolSubscribers[symbolId] = [];
    }
    this.symbolSubscribers[symbolId]!.push(callback);

    return () => {
      this.symbolSubscribers[symbolId] = (this.symbolSubscribers[symbolId] || []).filter((cb) => cb !== callback);
    };
  }

  // 이벤트를 비동기적으로 브로드캐스팅합니다.
  public publish(channel: string, payload: any): void {
    const callbacks = this.subscribers[channel];
    const symbolId = payload?.stock_id || payload?.symbolId || payload?.ticker;
    const symbolCallbacks = symbolId ? this.symbolSubscribers[symbolId] : undefined;

    setImmediate(() => {
      if (callbacks) {
        for (const cb of callbacks) {
          try {
            cb(payload);
          } catch (e) {
            console.error(`[EventBus] Error in subscriber callback for channel ${channel}:`, e);
          }
        }
      }
      if (symbolCallbacks) {
        for (const cb of symbolCallbacks) {
          try {
            cb(payload);
          } catch (e) {
            console.error(`[EventBus] Error in symbol callback for ${symbolId}:`, e);
          }
        }
      }
    });
  }

  // 100ms 디바운스로 고빈도 이벤트(오더북 갱신 등)를 묶어서 발행합니다.
  public publishDebounced(channel: string, key: string, payload: any, delayMs: number = 100): void {
    const debounceKey = `${channel}:${key}`;
    this.pendingDebouncedPayloads.set(debounceKey, payload);

    if (this.debounceTimers.has(debounceKey)) {
      return; // 이미 타이머 대기 중
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(debounceKey);
      const latestPayload = this.pendingDebouncedPayloads.get(debounceKey);
      this.pendingDebouncedPayloads.delete(debounceKey);
      if (latestPayload !== undefined) {
        this.publish(channel, latestPayload);
      }
    }, delayMs);

    this.debounceTimers.set(debounceKey, timer);
  }
}

// 싱글톤 인스턴스
export const EventBus = new EventBusImpl();
