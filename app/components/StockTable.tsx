"use client";

import Link from "next/link";
import type { Stock } from "@/lib/types";
import { change, fmtCap, fmtPrice, fmtVolume, fmtSigned } from "@/lib/format";
import { ChangeBadge } from "./PriceTag";

export default function StockTable({ stocks }: { stocks: Stock[] }) {
  return (
    <div className="overflow-x-auto rounded-2xl bg-[#0E1117] border border-[#212631] shadow-2xl">
      <table className="w-full text-left text-[13px] border-collapse">
        <thead className="border-b border-[#212631] bg-[#090B0F] text-[11px] font-extrabold text-[#8E939D] tracking-wider uppercase">
          <tr>
            <th className="px-5 py-4 border-none">종목명</th>
            <th className="px-5 py-4 border-none">섹터</th>
            <th className="px-5 py-4 border-none text-right">현재가</th>
            <th className="px-5 py-4 border-none text-right">등락률</th>
            <th className="px-5 py-4 border-none text-right">거래량</th>
            <th className="px-5 py-4 border-none text-right">시가총액</th>
            <th className="px-5 py-4 border-none text-center">태그</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#212631]">
          {stocks.map((s) => {
            const currentPrice = s.currentPrice;
            const { percent, dir } = change(currentPrice, s.previousClose);
            const pColor = dir === "up" ? "text-[#F04452]" : dir === "down" ? "text-[#3182F6]" : "text-[#8E939D]";
            const badgeBg = dir === "up" ? "bg-[#F04452]/10 border-[#F04452]/30 text-[#F04452]" : dir === "down" ? "bg-[#3182F6]/10 border-[#3182F6]/30 text-[#3182F6]" : "bg-[#161B22] border-[#212631] text-[#8E939D]";
            
            return (
              <tr
                key={s.id}
                className="transition-colors hover:bg-[#161B22] border-b border-[#212631] last:border-none group cursor-pointer"
              >
                {/* 종목명 */}
                <td className="px-5 py-4 border-none">
                  <Link href={`/stocks/${s.id}`} className="group flex flex-col">
                    <span className="font-extrabold text-white group-hover:text-[#F04452] transition-colors text-[14.5px]">
                      {s.name}
                    </span>
                    <span className="font-mono text-[11px] text-[#565A63] font-bold">{s.ticker}</span>
                  </Link>
                </td>

                {/* 섹터 */}
                <td className="px-5 py-4 border-none">
                  <span className="rounded-full bg-[#161B22] border border-[#212631] px-3 py-1 text-[11px] text-[#8E939D] font-medium">
                    {s.sector}
                  </span>
                </td>

                {/* 현재가 */}
                <td className="px-5 py-4 border-none text-right">
                  <span className={`font-mono font-black text-[14.5px] tabular-nums ${pColor}`}>
                    {fmtPrice(currentPrice, s.market)}
                  </span>
                </td>

                {/* 등락률 */}
                <td className="px-5 py-4 border-none text-right">
                  <span className={`inline-block font-mono font-bold text-[12px] tabular-nums px-2.5 py-0.5 rounded-full border ${badgeBg}`}>
                    {fmtSigned(percent)}%
                  </span>
                </td>

                {/* 거래량 */}
                <td className="px-5 py-4 border-none text-right font-mono tabular-nums text-[#8E939D] font-medium">
                  {fmtVolume(s.volume)}
                </td>

                {/* 시가총액 */}
                <td className="px-5 py-4 border-none text-right font-mono tabular-nums text-[#8E939D] font-medium">
                  {fmtCap(s.marketCap)}
                </td>

                {/* 태그 */}
                <td className="px-5 py-4 border-none text-center">
                  {s.isCore ? (
                    <span className="rounded-full bg-amber-500/10 border border-amber-500/30 px-2.5 py-0.5 text-[10px] font-extrabold text-amber-400">
                      CORE
                    </span>
                  ) : (
                    <span className="text-[#565A63]">·</span>
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
