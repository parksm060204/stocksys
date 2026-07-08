"use client";

import { useEffect, useState } from "react";
import type { Stock, Trade } from "@/lib/types";
import { fmtPrice } from "@/lib/format";
import { createClient } from "@/lib/supabase/client";

export default function TradeFeed({ stock }: { stock: Stock }) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const supabase = createClient();

  useEffect(() => {
    const fetchTrades = async () => {
      const { data } = await supabase
        .from('trades')
        .select('*')
        .eq('stock_id', stock.id)
        .order('created_at', { ascending: false })
        .limit(18);

      if (data) {
        setTrades(data.map(t => ({
          id: t.id,
          stockId: t.stock_id,
          price: t.price,
          size: t.size,
          side: t.side,
          time: new Date(t.created_at).toLocaleTimeString([], { hour12: false }),
        } as Trade)));
      }
    };

    fetchTrades();

    const channel = supabase
      .channel(`trades_feed_${stock.id}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trades', filter: `stock_id=eq.${stock.id}` },
        (payload) => {
          const t = payload.new;
          const newTrade: Trade = {
            id: t.id,
            stockId: t.stock_id,
            price: t.price,
            size: t.size,
            side: t.side,
            time: new Date(t.created_at).toLocaleTimeString([], { hour12: false }),
          };
          setTrades(prev => [newTrade, ...prev].slice(0, 18));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [stock.id, supabase]);

  return (
    <div className="rounded-xl border border-border bg-panel">
      <div className="border-b border-border px-4 py-2.5">
        <h3 className="text-[13px] font-semibold text-tx">체결 내역</h3>
      </div>
      <div className="grid grid-cols-3 px-4 py-1.5 text-[10px] uppercase tracking-wider text-dim">
        <span>시간</span>
        <span className="text-center">체결가</span>
        <span className="text-right">수량</span>
      </div>
      <div className="max-h-72 overflow-y-auto px-2 pb-2">
        {trades.map((t) => (
          <div key={t.id} className="grid grid-cols-3 items-center px-2 py-[3px] text-[12px]">
            <span className="font-mono tabular-nums text-dim">{t.time}</span>
            <span className={`text-center font-mono tabular-nums ${t.side === "buy" ? "text-up" : "text-down"}`}>
              {fmtPrice(t.price, stock.market)}
            </span>
            <span className="text-right font-mono tabular-nums text-muted">{t.size.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
