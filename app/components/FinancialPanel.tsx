import { Stock } from "@/lib/types";
import { fmtCap } from "@/lib/format";

export default function FinancialPanel({ stock }: { stock: Stock }) {
  const { financials } = stock;
  if (!financials) return null;

  return (
    <div className="rounded-xl border border-border bg-panel flex flex-col font-sans overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h3 className="text-[13px] font-semibold text-tx">기업 실적 및 밸류에이션</h3>
        <span className="text-[11px] text-dim">적정 주가: {financials.fairValue.toLocaleString()} {stock.market === "domestic" || stock.market === "etf" ? "₩" : "$"}</span>
      </div>

      {/* Valuation Metrics */}
      <div className="grid grid-cols-4 border-b border-border text-center bg-panel2">
        <div className="py-2.5 border-r border-border">
          <div className="text-[10px] text-dim uppercase">PER</div>
          <div className="mt-0.5 text-[12px] font-mono font-medium text-tx">{financials.per.toFixed(2)}배</div>
        </div>
        <div className="py-2.5 border-r border-border">
          <div className="text-[10px] text-dim uppercase">PBR</div>
          <div className="mt-0.5 text-[12px] font-mono font-medium text-tx">{financials.pbr.toFixed(2)}배</div>
        </div>
        <div className="py-2.5 border-r border-border">
          <div className="text-[10px] text-dim uppercase">EV/EBITDA</div>
          <div className="mt-0.5 text-[12px] font-mono font-medium text-tx">{financials.evEbitda.toFixed(2)}배</div>
        </div>
        <div className="py-2.5">
          <div className="text-[10px] text-dim uppercase">EPS</div>
          <div className="mt-0.5 text-[12px] font-mono font-medium text-tx">{financials.eps.toLocaleString()}</div>
        </div>
      </div>

      {/* Financial History Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-[11px] text-tx whitespace-nowrap">
          <thead className="bg-panel2 border-b border-border">
            <tr>
              <th className="px-4 py-2 font-medium text-dim">연도 (타입)</th>
              <th className="px-4 py-2 font-medium text-dim text-right">영업이익</th>
              <th className="px-4 py-2 font-medium text-dim text-right">전년비(YoY)</th>
              <th className="px-4 py-2 font-medium text-dim text-right">순이익</th>
              <th className="px-4 py-2 font-medium text-dim text-right">전년비(YoY)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {financials.history.map((h) => {
              const opColor = h.opYoY > 0 ? "text-up" : h.opYoY < 0 ? "text-down" : "text-dim";
              const niColor = h.niYoY > 0 ? "text-up" : h.niYoY < 0 ? "text-down" : "text-dim";
              
              return (
                <tr key={h.year} className="hover:bg-panel2/50 transition-colors">
                  <td className="px-4 py-2 font-mono">
                    {h.year} <span className="text-[9px] text-dim">({h.type === "ACTUAL" ? "확정" : h.type === "PRELIMINARY" ? "잠정" : "컨센서스"})</span>
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{fmtCap(h.operatingProfit)}</td>
                  <td className={`px-4 py-2 text-right font-mono ${opColor}`}>
                    {h.opYoY > 0 ? "+" : ""}{h.opYoY.toFixed(1)}%
                  </td>
                  <td className="px-4 py-2 text-right font-mono">{fmtCap(h.netIncome)}</td>
                  <td className={`px-4 py-2 text-right font-mono ${niColor}`}>
                    {h.niYoY > 0 ? "+" : ""}{h.niYoY.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
