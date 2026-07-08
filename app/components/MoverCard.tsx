"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { change, fmtPrice, fmtSigned } from "@/lib/format";
import type { Stock } from "@/lib/types";

export default function MoverCard({ title, stocks }: { title: string; stocks: Stock[] }) {
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});

  useEffect(() => {
    const next: Record<string, number> = {};
    for (const s of stocks) {
      next[s.id] = s.currentPrice;
    }
    setLivePrices(next);
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
