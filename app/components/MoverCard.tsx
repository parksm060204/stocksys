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
    <div className="rounded-2xl border border-border bg-[#0E1117] flex flex-col h-full overflow-hidden">
      <div className="border-b border-border px-5 py-3.5 bg-[#090B0F]">
        <h3 className="text-[13.5px] font-extrabold text-white">{title}</h3>
      </div>
      <div className="divide-y divide-[#212631] flex-1">
        {stocks.map((s) => {
          const currentPrice = livePrices[s.id] ?? s.currentPrice;
          const { percent, dir } = change(currentPrice, s.previousClose);
          const color = dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-[#8E939D]";
          const badgeBg = dir === "up" ? "bg-up/10 border-[#F04452]/30 text-up" : dir === "down" ? "bg-down/10 border-[#3182F6]/30 text-down" : "bg-[#161B22] border-border text-[#8E939D]";
          
          return (
            <Link
              key={s.id}
              href={`/stocks/${s.id}`}
              className="flex items-center justify-between px-5 py-3.5 transition-colors hover:bg-[#161B22] group"
            >
              <div className="flex flex-col">
                <span className="font-extrabold text-[13.5px] text-white group-hover:text-up transition-colors">{s.name}</span>
                <span className="font-mono text-xs font-bold text-[#565A63]">{s.ticker}</span>
              </div>

              <div className="flex flex-col items-end gap-0.5">
                <span className={`font-mono text-[13.5px] font-black tabular-nums ${color}`}>
                  {fmtPrice(currentPrice, s.market)}
                </span>
                <span className={`inline-block font-mono text-[10.5px] font-bold tabular-nums px-2 py-0.5 rounded-full border ${badgeBg}`}>
                  {fmtSigned(percent)}%
                </span>

              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

