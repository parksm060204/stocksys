'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface OrderbookLevel {
  price: number;
  totalSize: number;
}

/** 현재가 기준 가상 호가창 생성 (틱 단위 기반) */
function getTickSize(price: number) {
  if (price < 2000) return 1;
  if (price < 5000) return 5;
  if (price < 20000) return 10;
  if (price < 50000) return 50;
  if (price < 200000) return 100;
  if (price < 500000) return 500;
  return 1000;
}

function makeFallbackLevels(
  currentPrice: number,
  side: 'bid' | 'ask'
): OrderbookLevel[] {
  const tick = getTickSize(currentPrice);
  const levels: OrderbookLevel[] = [];
  // 간단한 시드 기반 볼륨 (가격에 의존 → 새로고침해도 같음)
  for (let i = 0; i < 10; i++) {
    const offset = (i + 1) * tick;
    const price = side === 'bid' ? currentPrice - offset : currentPrice + offset;
    // 현재가에서 멀수록 적은 잔량 (간략 모형)
    const baseVol = Math.round(50000 / (i + 1) / tick) * tick;
    const vol = Math.max(100, baseVol + ((currentPrice * (i + 1)) % 3000));
    levels.push({ price: +price.toFixed(0), totalSize: vol });
  }
  return levels;
}

export default function Orderbook({ ticker, currentPrice }: { ticker: string; currentPrice: number }) {
  const [bids, setBids] = useState<OrderbookLevel[]>([]);
  const [asks, setAsks] = useState<OrderbookLevel[]>([]);
  const [stockId, setStockId] = useState<string | null>(null);
  const [isFallback, setIsFallback] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    supabase.from('stocks').select('id').eq('ticker', ticker).single().then(({ data }) => {
      if (data) setStockId(data.id);
    });
  }, [ticker]);

  const fetchOrderbook = async (targetId: string) => {
    const { data } = await supabase
      .from('orders')
      .select('side, price, size')
      .eq('stock_id', targetId)
      .eq('status', 'open');

    if (!data || data.length === 0) {
      // 실 데이터 없음 → 폴백
      setBids(makeFallbackLevels(currentPrice, 'bid'));
      setAsks(makeFallbackLevels(currentPrice, 'ask'));
      setIsFallback(true);
      return;
    }

    const bidMap = new Map<number, number>();
    const askMap = new Map<number, number>();

    data.forEach((o) => {
      if (o.side === 'buy') {
        bidMap.set(o.price, (bidMap.get(o.price) || 0) + o.size);
      } else {
        askMap.set(o.price, (askMap.get(o.price) || 0) + o.size);
      }
    });

    const sortedBids = Array.from(bidMap.entries())
      .map(([price, totalSize]) => ({ price, totalSize }))
      .sort((a, b) => b.price - a.price)
      .slice(0, 10);

    const sortedAsks = Array.from(askMap.entries())
      .map(([price, totalSize]) => ({ price, totalSize }))
      .sort((a, b) => b.price - a.price)
      .slice(0, 10);

    setBids(sortedBids);
    setAsks(sortedAsks);
    setIsFallback(false);
  };

  useEffect(() => {
    if (!stockId) return;
    fetchOrderbook(stockId);

    const channel = supabase
      .channel(`orderbook_${stockId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `stock_id=eq.${stockId}` }, () => {
        fetchOrderbook(stockId);
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [stockId]);

  const maxSize = Math.max(...bids.map((b) => b.totalSize), ...asks.map((a) => a.totalSize), 1);

  return (
    <div className="w-full bg-panel border border-border rounded-xl overflow-hidden flex flex-col font-mono text-[12px]">
      {/* 헤더 */}
      <div className="bg-panel2 py-2 px-4 border-b border-border flex items-center justify-between">
        <span className="font-bold text-tx text-[13px]">호가창</span>
        {isFallback && (
          <span className="text-[10px] text-warn/80 bg-warn/10 px-1.5 py-px rounded">시뮬레이션</span>
        )}
      </div>

      {/* 컬럼 헤더 */}
      <div className="flex px-2 py-1 text-[10px] uppercase tracking-wider text-dim border-b border-border/40">
        <span className="flex-1 text-left">잔량</span>
        <span className="flex-1 text-center">가격</span>
        <span className="flex-1 text-right">잔량</span>
      </div>

      {/* 매도 호가 — 높은 가격이 위 */}
      {asks.map((ask) => (
        <div key={`ask-${ask.price}`} className="relative flex h-7 items-center border-b border-border/20 overflow-hidden">
          <div
            className="absolute right-0 top-0 bottom-0 bg-down/15"
            style={{ width: `${Math.min(100, (ask.totalSize / maxSize) * 100)}%` }}
          />
          <span className="flex-1 px-2 text-left z-10 text-dim tabular-nums text-[11px]">
            {ask.totalSize.toLocaleString()}
          </span>
          <span className="flex-1 text-center z-10 font-semibold text-down tabular-nums">
            {ask.price.toLocaleString()}
          </span>
          <span className="flex-1 px-2 text-right z-10 text-transparent select-none">·</span>
        </div>
      ))}

      {/* 현재가 */}
      <div className="flex h-9 items-center justify-center bg-panel2 font-bold text-[15px] border-y-2 border-accent/60 text-tx">
        {currentPrice.toLocaleString()}
      </div>

      {/* 매수 호가 — 높은 가격이 위 (현재가 바로 아래) */}
      {bids.map((bid) => (
        <div key={`bid-${bid.price}`} className="relative flex h-7 items-center border-b border-border/20 overflow-hidden">
          <div
            className="absolute left-0 top-0 bottom-0 bg-up/15"
            style={{ width: `${Math.min(100, (bid.totalSize / maxSize) * 100)}%` }}
          />
          <span className="flex-1 px-2 text-left z-10 text-transparent select-none">·</span>
          <span className="flex-1 text-center z-10 font-semibold text-up tabular-nums">
            {bid.price.toLocaleString()}
          </span>
          <span className="flex-1 px-2 text-right z-10 text-dim tabular-nums text-[11px]">
            {bid.totalSize.toLocaleString()}
          </span>
        </div>
      ))}
    </div>
  );
}
