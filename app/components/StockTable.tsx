"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { Stock } from "@/lib/types";
import { change, fmtCap, fmtPrice, fmtVolume, fmtSigned } from "@/lib/format";
import { ChangeBadge } from "./PriceTag";

export default function StockTable({ stocks }: { stocks: Stock[] }) {
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
    <div className="overflow-x-auto rounded-xl border border-[#222736] bg-[#151821]">
      <table className="w-full text-left text-[13px]">
        <thead className="border-b border-[#222736] bg-[#12151e] text-[11px] font-semibold text-[#9ca3af]">
          <tr>
            <th className="px-4 py-3">종목명</th>
            <th className="px-4 py-3">섹터</th>
            <th className="px-4 py-3 text-right">현재가</th>
            <th className="px-4 py-3 text-right">등락률</th>
            <th className="px-4 py-3 text-right">거래량</th>
            <th className="px-4 py-3 text-right">시가총액</th>
            <th className="px-4 py-3 text-center">태그</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#222736]">
          {stocks.map((s) => {
            const currentPrice = livePrices[s.id] ?? s.currentPrice;
            const { percent, dir } = change(currentPrice, s.previousClose);
            const pColor = dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-muted";
            return (
              <tr
                key={s.id}
                className="transition-colors hover:bg-[#1a1e29]"
              >
                <td className="px-4 py-3">
                  <Link href={`/stocks/${s.id}`} className="group flex flex-col">
                    <span className="font-semibold text-tx group-hover:text-[#3182F6] transition-colors">{s.name}</span>
                    <span className="font-mono text-[11px] text-dim">{s.ticker}</span>
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <span className="rounded bg-[#1c202c] border border-[#262b3a] px-2 py-0.5 text-[11px] text-[#9ca3af] font-medium">{s.sector}</span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`font-mono font-bold tabular-nums ${pColor}`}>
                    {fmtPrice(currentPrice, s.market)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`font-mono font-semibold tabular-nums ${pColor}`}>{fmtSigned(percent)}%</span>
                </td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-muted">{fmtVolume(s.volume)}</td>
                <td className="px-4 py-3 text-right font-mono tabular-nums text-muted">{fmtCap(s.marketCap)}</td>
                <td className="px-4 py-3 text-center">
                  {s.isCore ? (
                    <span className="rounded bg-[#f59e0b]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#f59e0b]">CORE</span>
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
