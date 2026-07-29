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
    <div className="overflow-x-auto rounded-2xl bg-[#151821] border border-white/5 shadow-sm">
      <table className="w-full text-left text-[13px] border-collapse">
        <thead className="border-b border-white/5 bg-[#0C0E12]/60 text-[11px] font-semibold text-[#9CA3AF] tracking-wider uppercase">
          <tr>
            <th className="px-5 py-3.5 border-none">종목명</th>
            <th className="px-5 py-3.5 border-none">섹터</th>
            <th className="px-5 py-3.5 border-none text-right">현재가</th>
            <th className="px-5 py-3.5 border-none text-right">등락률</th>
            <th className="px-5 py-3.5 border-none text-right">거래량</th>
            <th className="px-5 py-3.5 border-none text-right">시가총액</th>
            <th className="px-5 py-3.5 border-none text-center">태그</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5">
          {stocks.map((s) => {
            const currentPrice = livePrices[s.id] ?? s.currentPrice;
            const { percent, dir } = change(currentPrice, s.previousClose);
            const pColor = dir === "up" ? "text-[#F04452]" : dir === "down" ? "text-[#3182F6]" : "text-[#9CA3AF]";
            
            return (
              <tr
                key={s.id}
                className="transition-colors hover:bg-white/5 border-b border-white/5 last:border-none"
              >
                {/* 종목명 (세로선 제거) */}
                <td className="px-5 py-4 border-none">
                  <Link href={`/stocks/${s.id}`} className="group flex flex-col">
                    <span className="font-bold text-white group-hover:text-[#3182F6] transition-colors text-[14px]">
                      {s.name}
                    </span>
                    <span className="font-mono text-[11px] text-[#6B7280]">{s.ticker}</span>
                  </Link>
                </td>

                {/* 섹터 */}
                <td className="px-5 py-4 border-none">
                  <span className="rounded-md bg-[#1C1C1E] border border-white/5 px-2.5 py-1 text-[11px] text-[#9CA3AF] font-medium">
                    {s.sector}
                  </span>
                </td>

                {/* 현재가 */}
                <td className="px-5 py-4 border-none text-right">
                  <span className={`font-mono font-bold text-[14px] tabular-nums ${pColor}`}>
                    {fmtPrice(currentPrice, s.market)}
                  </span>
                </td>

                {/* 등락률 */}
                <td className="px-5 py-4 border-none text-right">
                  <span className={`font-mono font-bold text-[13px] tabular-nums ${pColor}`}>
                    {fmtSigned(percent)}%
                  </span>
                </td>

                {/* 거래량 */}
                <td className="px-5 py-4 border-none text-right font-mono tabular-nums text-[#9CA3AF]">
                  {fmtVolume(s.volume)}
                </td>

                {/* 시가총액 */}
                <td className="px-5 py-4 border-none text-right font-mono tabular-nums text-[#9CA3AF]">
                  {fmtCap(s.marketCap)}
                </td>

                {/* 태그 */}
                <td className="px-5 py-4 border-none text-center">
                  {s.isCore ? (
                    <span className="rounded bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 text-[10px] font-bold text-amber-400">
                      CORE
                    </span>
                  ) : (
                    <span className="text-[#6B7280]">·</span>
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
