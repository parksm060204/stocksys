"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { change, fmtPrice, fmtSigned } from "@/lib/format";
import type { Stock } from "@/lib/types";
import { LP_ENGINE } from "@/lib/mock-data";

export default function MoverCard({ title, stocks }: { title: string; stocks: Stock[] }) {
  const [livePrices, setLivePrices] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const s of stocks) init[s.id] = s.currentPrice;
    return init;
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setLivePrices((prev) => {
        let hasChanges = false;
        const next = { ...prev };
        for (const s of stocks) {
          const state = LP_ENGINE.states.get(s.id);
          if (state && state.currentPrice !== next[s.id]) {
            next[s.id] = state.currentPrice;
            hasChanges = true;
          }
        }
        return hasChanges ? next : prev;
      });
    }, 500); // 0.5s polling
    return () => clearInterval(interval);
  }, [stocks]);

  return (
    <div className="rounded-xl border border-border bg-panel">
      <div className="border-b border-border px-4 py-3">
        <h3 className="text-[13px] font-semibold text-tx">{title}</h3>
      </div>
      <div className="divide-y divide-border/60">
        {stocks.map((s) => {
          const currentPrice = livePrices[s.id] ?? s.currentPrice;
          const { percent, dir } = change(currentPrice, s.previousClose);
          const color = dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-muted";
          return (
            <Link
              key={s.id}
              href={`/stocks/${s.id}`}
              className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-panel2/60 group"
            >
              <div className="flex flex-col">
                <span className="font-semibold text-tx group-hover:text-accent">{s.name}</span>
                <span className="font-mono text-[11px] text-dim">{s.ticker}</span>
              </div>
              <div className="flex flex-col items-end">
                <span className={`font-mono font-semibold tabular-nums ${color}`}>
                  {fmtPrice(currentPrice, s.market)}
                </span>
                <span className={`font-mono text-[11px] tabular-nums ${color}`}>
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
