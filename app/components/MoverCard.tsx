"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { change, fmtPrice, fmtSigned } from "@/lib/format";
import type { Stock } from "@/lib/types";

export default function MoverCard({ title, stocks }: { title: string; stocks: Stock[] }) {
  const [livePrices, setLivePrices] = useState<Record<string, number>>(() => {
    const next: Record<string, number> = {};
    for (const s of stocks) {
      next[s.id] = s.currentPrice;
    }
    return next;
  });

  useEffect(() => {
    setLivePrices((prev) => {
      const next: Record<string, number> = { ...prev };
      for (const s of stocks) {
        next[s.id] = s.currentPrice;
      }
      return next;
    });
  }, [stocks]);

  return (
    <div className="rounded-xl border border-[#222736] bg-[#151821] flex flex-col h-full overflow-hidden">
      <div className="border-b border-[#222736] px-4 py-3 bg-[#12151e]">
        <h3 className="text-[13px] font-semibold text-tx">{title}</h3>
      </div>
      <div className="divide-y divide-[#222736] flex-1">
        {stocks.map((s) => {
          const currentPrice = livePrices[s.id] ?? s.currentPrice;
          const { percent, dir } = change(currentPrice, s.previousClose);
          const color = dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-muted";
          
          return (
            <Link
              key={s.id}
              href={`/stocks/${s.id}`}
              className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-[#1a1e29] group"
            >
              <div className="flex flex-col">
                <span className="font-semibold text-[13px] text-tx group-hover:text-[#3182F6] transition-colors">{s.name}</span>
                <span className="font-mono text-[11px] text-dim">{s.ticker}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className={`font-mono text-[13px] font-bold tabular-nums ${color}`}>
                  {fmtPrice(currentPrice, s.market)}
                </span>
                <span className={`font-mono text-[11px] font-medium tabular-nums ${color}`}>
                  {dir === "up" ? "▲" : dir === "down" ? "▼" : "–"} {fmtSigned(percent)}%
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
