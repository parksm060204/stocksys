import Link from "next/link";
import { HOLDINGS, getStock } from "@/lib/mock-data";
import { fmtPrice } from "@/lib/format";

export default function MyPage() {
  const rows = HOLDINGS.map((h) => {
    const stock = getStock(h.stockId);
    const market = stock?.market ?? "domestic";
    const value = h.currentPrice * h.quantity;
    const cost = h.avgPrice * h.quantity;
    const pnl = value - cost;
    const pnlPct = cost !== 0 ? (pnl / cost) * 100 : 0;
    return { ...h, market, value, cost, pnl, pnlPct };
  });

  const totalValue = rows.reduce((a, r) => a + r.value, 0);
  const totalCost = rows.reduce((a, r) => a + r.cost, 0);
  const totalPnl = totalValue - totalCost;
  const totalPnlPct = totalCost !== 0 ? (totalPnl / totalCost) * 100 : 0;
  const cash = 100_000_000 - totalCost;

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-tx">마이페이지</h1>
        <p className="text-[13px] text-muted">포트폴리오 · 수익률 · 거래내역</p>
      </div>

      <div className="mb-6 grid grid-cols-2 gap-4 md:grid-cols-4">
        <Summary label="총 자산" value={fmtPrice(totalValue + cash, "domestic")} />
        <Summary label="평가 금액" value={fmtPrice(totalValue, "domestic")} />
        <Summary label="예수금" value={fmtPrice(cash, "domestic")} />
        <Summary
          label="평가 손익"
          value={`${fmtPrice(totalPnl, "domestic")} (${totalPnlPct >= 0 ? "+" : ""}${totalPnlPct.toFixed(2)}%)`}
          tone={totalPnl >= 0 ? "up" : "down"}
        />
      </div>

      <div className="rounded-xl border border-border bg-panel">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-[14px] font-semibold text-tx">보유 종목</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-border text-[11px] uppercase tracking-wider text-dim">
              <tr>
                <th className="px-4 py-2.5 font-semibold">종목</th>
                <th className="px-4 py-2.5 text-right font-semibold">보유</th>
                <th className="px-4 py-2.5 text-right font-semibold">평단가</th>
                <th className="px-4 py-2.5 text-right font-semibold">현재가</th>
                <th className="px-4 py-2.5 text-right font-semibold">평가금액</th>
                <th className="px-4 py-2.5 text-right font-semibold">손익</th>
                <th className="px-4 py-2.5 text-right font-semibold">수익률</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.stockId} className="border-b border-border/60 last:border-0 hover:bg-panel2/60">
                  <td className="px-4 py-3">
                    <Link href={`/stocks/${r.stockId}`} className="font-medium text-tx hover:text-accent">
                      {r.name}
                    </Link>
                    <div className="font-mono text-[11px] text-dim">{r.ticker}</div>
                  </td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-muted">{r.quantity.toLocaleString()}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-muted">{fmtPrice(r.avgPrice, r.market as "domestic" | "overseas" | "bonds" | "options" | "commodities" | "etf")}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-tx">{fmtPrice(r.currentPrice, r.market as "domestic" | "overseas" | "bonds" | "options" | "commodities" | "etf")}</td>
                  <td className="px-4 py-3 text-right font-mono tabular-nums text-tx">{fmtPrice(r.value, r.market as "domestic" | "overseas" | "bonds" | "options" | "commodities" | "etf")}</td>
                  <td className={`px-4 py-3 text-right font-mono tabular-nums ${r.pnl >= 0 ? "text-up" : "text-down"}`}>
                    {r.pnl >= 0 ? "+" : ""}{fmtPrice(r.pnl, r.market as "domestic" | "overseas" | "bonds" | "options" | "commodities" | "etf")}
                  </td>
                  <td className={`px-4 py-3 text-right font-mono font-semibold tabular-nums ${r.pnlPct >= 0 ? "text-up" : "text-down"}`}>
                    {r.pnlPct >= 0 ? "+" : ""}{r.pnlPct.toFixed(2)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-border bg-panel p-5">
        <h2 className="mb-3 text-[14px] font-semibold text-tx">거래내역</h2>
        <p className="text-[12px] text-dim">체결 내역이 여기에 표시됩니다. (데모)</p>
      </div>
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-tx";
  return (
    <div className="rounded-xl border border-border bg-panel p-4">
      <div className="text-[11px] uppercase tracking-wider text-dim">{label}</div>
      <div className={`mt-1 font-mono text-[16px] font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
