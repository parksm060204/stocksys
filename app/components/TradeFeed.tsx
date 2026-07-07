"use client";

import { useEffect, useState } from "react";
import type { Stock, Trade } from "@/lib/types";
import { getRecentTrades } from "@/lib/mock-data";
import { fmtPrice } from "@/lib/format";

export default function TradeFeed({ stock }: { stock: Stock }) {
  const [trades, setTrades] = useState<Trade[]>([]);

  useEffect(() => {
    const tick = () => setTrades(getRecentTrades(stock, 18));
    tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, [stock]);

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
