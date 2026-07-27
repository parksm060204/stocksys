import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { change, fmtSigned, fmtPrice } from "@/lib/format";
import type { Commodity } from "@/lib/types";

export const revalidate = 0;

export default async function CommoditiesPage() {
  const supabase = await createClient();
  const { data } = await supabase.from('commodities').select('*').order('name');
  
  const commodities = (data || []).map(row => ({
    id: row.id,
    commodityId: row.commodity_id,
    name: row.name,
    ticker: row.ticker,
    currentPrice: row.current_price,
    previousPrice: row.previous_price,
    unit: row.unit,
    tickSize: row.tick_size,
    tickValue: row.tick_value,
    marginRequirement: row.margin_requirement,
    description: row.description
  } as Commodity));

  const up = commodities.filter((c) => c.currentPrice > c.previousPrice).length;
  const down = commodities.filter((c) => c.currentPrice < c.previousPrice).length;
  const avgPct = commodities.length > 0 ?
    commodities.reduce((a, c) => a + change(c.currentPrice, c.previousPrice).percent, 0) / commodities.length : 0;

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <nav className="mb-4 flex items-center gap-2 text-[12px] text-dim">
        <Link href="/" className="hover:text-tx">
          메인홈
        </Link>
        <span>/</span>
        <span className="text-muted">원자재 선물</span>
      </nav>

      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="flex items-center gap-2.5 text-xl font-bold text-tx">
            <span className="text-2xl">🛢️</span>
            원자재 선물
          </h1>
          <p className="mt-1 text-[13px] text-muted">글로벌 매크로 경제의 기반이 되는 원자재(에너지, 귀금속, 농산물 등) 시장입니다.</p>
        </div>
        <div className="flex gap-6 text-right">
          <Stat label="상장 상품 수" value={`${commodities.length}`} />
          <Stat label="평균 등락" value={`${fmtSigned(avgPct)}%`} tone={avgPct >= 0 ? "up" : "down"} />
          <Stat label="상승/하락" value={`${up} / ${down}`} />
        </div>
      </div>

      <div className="border border-bd bg-bg">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-bd bg-bg-alt text-dim">
            <tr>
              <th className="px-4 py-3 font-medium">상품명</th>
              <th className="px-4 py-3 font-medium text-right">현재가</th>
              <th className="px-4 py-3 font-medium text-right">등락률</th>
              <th className="px-4 py-3 font-medium text-right hidden sm:table-cell">계약 단위</th>
              <th className="px-4 py-3 font-medium text-right hidden lg:table-cell">증거금</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bd">
            {commodities.map((cmd) => {
              const chg = change(cmd.currentPrice, cmd.previousPrice);
              const isUp = chg.amount > 0;
              const isDown = chg.amount < 0;
              return (
                <tr key={cmd.id} className="hover:bg-bg-alt transition-colors group cursor-pointer">
                  <td className="px-4 py-3">
                    <Link href={`/commodities/${cmd.commodityId}`} className="block">
                      <div className="font-semibold text-tx group-hover:text-hl transition-colors">{cmd.name}</div>
                      <div className="text-[11px] text-muted font-mono">{cmd.ticker}</div>
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right">
                      {fmtPrice(cmd.currentPrice, 'overseas')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className={`font-mono text-[13px] ${isUp ? "text-up" : isDown ? "text-down" : "text-dim"}`}>
                      {fmtSigned(chg.percent)}%
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right hidden sm:table-cell text-muted">
                    {cmd.unit}
                  </td>
                  <td className="px-4 py-3 text-right hidden lg:table-cell font-mono text-muted">
                    {fmtPrice(cmd.marginRequirement, 'overseas')}
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

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-tx";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-dim">{label}</div>
      <div className={`font-mono text-[15px] font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
