import { Stock } from "@/lib/types";
import { fmtCap } from "@/lib/format";

import StrictWidget from './StrictWidget';

export default function FinancialPanel({ stock }: { stock: Stock }) {
  const { financials } = stock;
  if (!financials) return null;

  return (
    <StrictWidget title="기업 실적 및 밸류에이션 (FINANCIALS)">
      {/* Valuation Metrics */}
      <div className="grid grid-cols-4 border-b border-[#212631] text-center bg-[#090B0F] font-mono">
        <div className="py-3 border-r border-[#212631]">
          <div className="text-[10px] text-[#8E939D] uppercase font-bold">PER</div>
          <div className="mt-0.5 text-[12.5px] font-black text-white">{financials.per.toFixed(2)}배</div>
        </div>
        <div className="py-3 border-r border-[#212631]">
          <div className="text-[10px] text-[#8E939D] uppercase font-bold">PBR</div>
          <div className="mt-0.5 text-[12.5px] font-black text-white">{financials.pbr.toFixed(2)}배</div>
        </div>
        <div className="py-3 border-r border-[#212631]">
          <div className="text-[10px] text-[#8E939D] uppercase font-bold">EV/EBITDA</div>
          <div className="mt-0.5 text-[12.5px] font-black text-white">{financials.evEbitda.toFixed(2)}배</div>
        </div>
        <div className="py-3">
          <div className="text-[10px] text-[#8E939D] uppercase font-bold">EPS</div>
          <div className="mt-0.5 text-[12.5px] font-black text-white">{financials.eps.toLocaleString()}</div>
        </div>
      </div>

      <div className="grid grid-cols-4 border-b border-[#212631] text-center bg-[#090B0F] font-mono">
        <div className="p-2.5 text-[10px] text-[#8E939D] font-bold">연도</div>
        <div className="p-2.5 text-[10px] text-[#8E939D] font-bold">영업익</div>
        <div className="p-2.5 text-[10px] text-[#8E939D] font-bold">순이익</div>
        <div className="p-2.5 text-[10px] text-[#8E939D] font-bold">증감 (YoY)</div>
      </div>
      <div className="divide-y divide-[#212631]">
        {financials.history.map((h) => (
          <div key={h.year} className="grid grid-cols-4 text-center hover:bg-[#161B22] transition-colors items-center font-mono">
            <div className="p-2.5 text-[11.5px] text-[#8E939D] font-medium">
              {h.year} <span className="text-[9.5px] text-[#565A63] font-bold block">({h.type === "ACTUAL" ? "확정" : h.type === "PRELIMINARY" ? "잠정" : "컨센서스"})</span>
            </div>
            <div className="p-2.5 text-[11.5px] text-white font-bold">{fmtCap(h.operatingProfit)}</div>
            <div className="p-2.5 text-[11.5px] text-white font-bold">
              {fmtCap(h.netIncome)}
            </div>
            <div className={`p-2.5 text-[11.5px] font-black ${h.opYoY > 0 ? "text-[#F04452]" : "text-[#3182F6]"}`}>
              {h.opYoY > 0 ? "+" : ""}{h.opYoY.toFixed(1)}%
            </div>
          </div>
        ))}
      </div>
    </StrictWidget>
  );
}

