import { Stock } from "@/lib/types";
import { fmtCap } from "@/lib/format";

import StrictWidget from './StrictWidget';

export default function FinancialPanel({ stock }: { stock: Stock }) {
  const { financials } = stock;
  if (!financials) return null;

  return (
    <StrictWidget title="기업 실적 및 밸류에이션">
      {/* Valuation Metrics */}
      <div className="grid grid-cols-4 border-b border-[#222] text-center bg-[#111]">
        <div className="py-2.5 border-r border-[#222]">
          <div className="text-[10px] text-gray-500 uppercase">PER</div>
          <div className="mt-0.5 text-[12px] font-mono font-medium text-white">{financials.per.toFixed(2)}배</div>
        </div>
        <div className="py-2.5 border-r border-[#222]">
          <div className="text-[10px] text-gray-500 uppercase">PBR</div>
          <div className="mt-0.5 text-[12px] font-mono font-medium text-white">{financials.pbr.toFixed(2)}배</div>
        </div>
        <div className="py-2.5 border-r border-[#222]">
          <div className="text-[10px] text-gray-500 uppercase">EV/EBITDA</div>
          <div className="mt-0.5 text-[12px] font-mono font-medium text-white">{financials.evEbitda.toFixed(2)}배</div>
        </div>
        <div className="py-2.5">
          <div className="text-[10px] text-gray-500 uppercase">EPS</div>
          <div className="mt-0.5 text-[12px] font-mono font-medium text-white">{financials.eps.toLocaleString()}</div>
        </div>
      </div>

      <div className="grid grid-cols-4 border-b border-[#222] text-center bg-[#111]">
        <div className="p-2 text-[10px] text-gray-500 font-medium">연도</div>
        <div className="p-2 text-[10px] text-gray-500 font-medium">영업익</div>
        <div className="p-2 text-[10px] text-gray-500 font-medium">순이익</div>
        <div className="p-2 text-[10px] text-gray-500 font-medium">증감(YoY)</div>
      </div>
      <div className="divide-y divide-[#222]">
        {financials.history.map((h) => (
          <div key={h.year} className="grid grid-cols-4 text-center hover:bg-[#111] transition-none items-center">
            <div className="p-2 text-[11px] font-mono text-gray-400">
              {h.year} <span className="text-[9px] text-gray-600 block">({h.type === "ACTUAL" ? "확정" : h.type === "PRELIMINARY" ? "잠정" : "컨센서스"})</span>
            </div>
            <div className="p-2 text-[11px] font-mono text-white">{fmtCap(h.operatingProfit)}</div>
            <div className={`p-2 text-[11px] font-mono text-white`}>
              {fmtCap(h.netIncome)}
            </div>
            <div className={`p-2 text-[11px] font-mono ${h.opYoY > 0 ? "text-red-400" : "text-blue-400"}`}>
              {h.opYoY > 0 ? "+" : ""}{h.opYoY.toFixed(1)}%
            </div>
          </div>
        ))}
      </div>
    </StrictWidget>
  );
}
