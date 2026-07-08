"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { Stock } from "@/lib/types";
import { change, fmtCap, fmtPrice, fmtVolume, fmtSigned } from "@/lib/format";
import { ChangeBadge } from "./PriceTag";

export default function StockTable({ stocks }: { stocks: Stock[] }) {
  const [livePrices, setLivePrices] = useState<Record<string, number>>({});

  useEffect(() => {
    const next: Record<string, number> = {};
    for (const s of stocks) {
      next[s.id] = s.currentPrice;
    }
    setLivePrices(next);
  }, [stocks]);

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-panel">
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-border text-[11px] uppercase tracking-wider text-dim">
          <tr>
            <th className="px-4 py-3 font-semibold">종목</th>
            <th className="px-4 py-3 font-semibold">섹터</th>
            <th className="px-4 py-3 text-right font-semibold">현재가</th>
            <th className="px-4 py-3 text-right font-semibold">전일대비</th>
            <th className="px-4 py-3 text-right font-semibold">거래량</th>
            <th className="px-4 py-3 text-right font-semibold">시가총액</th>
            <th className="px-4 py-3 text-center font-semibold">핵심</th>
          </tr>
        </thead>
        <tbody>
          {stocks.map((s) => {
            const currentPrice = livePrices[s.id] ?? s.currentPrice;
            const { percent, dir } = change(currentPrice, s.previousClose);
            const pColor = dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-muted";
            return (
              <tr
                key={s.id}
                className="border-b border-border/60 transition-colors last:border-0 hover:bg-panel2/60"
              >
                <td className="px-4 py-3">
                  <Link href={`/stocks/${s.id}`} className="group flex flex-col">
                    <span className="font-semibold text-tx group-hover:text-accent">{s.name}</span>
                    <span className="font-mono text-[11px] text-dim">{s.ticker}</span>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded bg-panel2 px-2 py-0.5 text-[11px] text-muted">{s.sector}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`font-mono font-semibold tabular-nums ${pColor}`}>
                    {fmtPrice(currentPrice, s.market)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`font-mono tabular-nums ${pColor}`}>{fmtSigned(percent)}%</span>
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-muted">{fmtVolume(s.volume)}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-muted">{fmtCap(s.marketCap)}</td>
                <td className="px-4 py-3 text-center">
                  {s.isCore ? (
                    <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] font-semibold text-warn">CORE</span>
                  ) : (
                    <span className="text-dim">·</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export { ChangeBadge };
