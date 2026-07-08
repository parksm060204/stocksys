import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { MARKETS } from "@/lib/constants";
import { change, fmtSigned } from "@/lib/format";
import StockTable from "@/app/components/StockTable";
import type { MarketId, Stock } from "@/lib/types";
import { createClient } from "@/lib/supabase/server";

const VALID = new Set(MARKETS.map((m) => m.id));

export const revalidate = 0; // Disable static generation so it always fetches live data

export default async function MarketPage({
  params,
}: {
  params: Promise<{ market: string }>;
}) {
  const { market } = await params;
  if (market === "domestic") redirect("/stocks?tab=kospi");
  if (market === "overseas") redirect("/stocks?tab=sp50");
  if (market === "europe") redirect("/stocks?tab=eurostoxx50");

  if (!VALID.has(market as MarketId)) notFound();

  const id = market as MarketId;
  const meta = MARKETS.find((m) => m.id === id)!;
  
  const supabase = await createClient();
  const { data: stocksData } = await supabase
    .from('stocks')
    .select('id, name, ticker, market, sector, current_price, previous_close')
    .eq('market', id);

  const stocks: Stock[] = (stocksData || []).map(row => ({
    id: row.id,
    name: row.name,
    ticker: row.ticker,
    market: row.market,
    sector: row.sector,
    currentPrice: row.current_price,
    previousClose: row.previous_close,
    marketCap: row.current_price * 1000000,
  } as Stock));

  const up = stocks.filter((s) => s.currentPrice > s.previousClose).length;
  const down = stocks.filter((s) => s.currentPrice < s.previousClose).length;
  const flat = stocks.length - up - down;
  const avgPct = stocks.length > 0 ?
    stocks.reduce((a, s) => a + change(s.currentPrice, s.previousClose).percent, 0) / stocks.length : 0;

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <nav className="mb-4 flex items-center gap-2 text-[12px] text-dim">
        <Link href="/" className="hover:text-tx">
          메인홈
        </Link>
        <span>/</span>
        <span className="text-muted">{meta.nameKo}</span>
      </nav>

      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="flex items-center gap-2.5 text-xl font-bold text-tx">
            <span className="text-2xl">{meta.icon}</span>
            {meta.nameKo}
          </h1>
          <p className="mt-1 text-[13px] text-muted">{meta.description}</p>
        </div>
        <div className="flex gap-6 text-right">
          <Stat label="종목 수" value={`${stocks.length}`} />
          <Stat label="평균 등락" value={`${fmtSigned(avgPct)}%`} tone={avgPct >= 0 ? "up" : "down"} />
          <Stat label="상승/보합/하락" value={`${up} / ${flat} / ${down}`} />
        </div>
      </div>

      <StockTable stocks={stocks} />
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
