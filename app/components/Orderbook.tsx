'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
);

interface Order {
  id: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  status: string;
}

interface OrderbookLevel {
  price: number;
  totalSize: number;
}

export default function Orderbook({ ticker, currentPrice }: { ticker: string, currentPrice: number }) {
  const [bids, setBids] = useState<OrderbookLevel[]>([]);
  const [asks, setAsks] = useState<OrderbookLevel[]>([]);
  const [stockId, setStockId] = useState<string | null>(null);

  useEffect(() => {
    // 1. ticker로 stock_id 찾기
    const initStock = async () => {
      const { data } = await supabase.from('stocks').select('id').eq('ticker', ticker).single();
      if (data) setStockId(data.id);
    };
    initStock();
  }, [ticker]);

  const fetchOrderbook = async (targetId: string) => {
    const { data } = await supabase
      .from('orders')
      .select('side, price, size')
      .eq('stock_id', targetId)
      .eq('status', 'open');

    if (!data) return;

    const bidMap = new Map<number, number>();
    const askMap = new Map<number, number>();

    data.forEach(o => {
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
      .sort((a, b) => a.price - b.price)
      .slice(0, 10)
      .reverse();

    setBids(sortedBids);
    setAsks(sortedAsks);
  };

  useEffect(() => {
    if (!stockId) return;

    fetchOrderbook(stockId);

    const channel = supabase.channel(`orderbook_changes_${stockId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `stock_id=eq.${stockId}` }, () => {
        fetchOrderbook(stockId);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [stockId]);

  return (
    <div className="w-full bg-panel border border-border rounded-xl overflow-hidden flex flex-col font-mono text-[13px]">
      <div className="bg-panel2 py-2 px-4 border-b border-border text-center font-bold text-tx">
        호가창 (Orderbook)
      </div>
      
      <div className="flex flex-col">
        {/* 매도 호가 (Asks) */}
        {asks.map((ask) => (
          <div key={`ask-${ask.price}`} className="flex relative h-8 items-center border-b border-border/50 bg-down/5 hover:bg-down/10">
            {/* 호가 잔량 바 */}
            <div className="absolute right-0 top-0 bottom-0 bg-down/20" style={{ width: `${Math.min(100, (ask.totalSize / 50000) * 100)}%` }} />
            
            <div className="flex-1 px-4 text-left z-10 text-down font-medium">{ask.price.toLocaleString()}</div>
            <div className="flex-1 px-4 text-right z-10 text-dim">{ask.totalSize.toLocaleString()}</div>
          </div>
        ))}

        {/* 현재가 경계 */}
        <div className="flex h-10 items-center justify-center bg-panel2 font-bold text-lg border-y-2 border-border">
          {currentPrice.toLocaleString()}
        </div>

        {/* 매수 호가 (Bids) */}
        {bids.map((bid) => (
          <div key={`bid-${bid.price}`} className="flex relative h-8 items-center border-b border-border/50 bg-up/5 hover:bg-up/10">
            {/* 호가 잔량 바 */}
            <div className="absolute left-0 top-0 bottom-0 bg-up/20" style={{ width: `${Math.min(100, (bid.totalSize / 50000) * 100)}%` }} />
            
            <div className="flex-1 px-4 text-left z-10 text-up font-medium">{bid.price.toLocaleString()}</div>
            <div className="flex-1 px-4 text-right z-10 text-dim">{bid.totalSize.toLocaleString()}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
