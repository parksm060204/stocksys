import { useEffect, useState } from 'react';
import { globalRealtimeGateway } from '../engine/RealtimeGateway';
import { OrderBookTick, TradeFeedEvent, RolloverAlertEvent } from '../engine/wsTypes';

export const useOptionMarketData = (ticker: string) => {
  const [orderBook, setOrderBook] = useState<{ bids: [number, number][]; asks: [number, number][] }>({ bids: [], asks: [] });
  const [trades, setTrades] = useState<TradeFeedEvent[]>([]);
  const [rolloverEvents, setRolloverEvents] = useState<RolloverAlertEvent[]>([]);

  useEffect(() => {
    if (!globalRealtimeGateway) return;

    // [1] 호가창 100ms 스냅샷 채널 구독
    const unsubOrderBook = globalRealtimeGateway.subscribe(`orderbook:${ticker}`, (tick: OrderBookTick) => {
      setOrderBook({ bids: tick.bids, asks: tick.asks });
    });

    // [2] 실시간 체결 채널 구독 (최근 50건 유지)
    const unsubTrades = globalRealtimeGateway.subscribe(`trades:${ticker}`, (newTrade: TradeFeedEvent) => {
      setTrades((prev) => [newTrade, ...prev.slice(0, 49)]);
    });

    // [3] 기관 롤오버 피드 채널 구독 (최근 10건 유지) — [FIX] 신규 추가
    const unsubRollover = globalRealtimeGateway.subscribe('rollover:feed', (event: RolloverAlertEvent) => {
      setRolloverEvents((prev) => [event, ...prev.slice(0, 9)]);
    });

    return () => {
      unsubOrderBook();
      unsubTrades();
      unsubRollover();
    };
  }, [ticker]);

  return { orderBook, trades, rolloverEvents };
};
