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
  if (market === "etf") redirect("/etf");
  if (market === "options") redirect("/options");

  if (!VALID.has(market as MarketId)) notFound();

  const id = market as MarketId;
  const meta = MARKETS.find((m) => m.id === id)!;
  
  const supabase = await createClient();
  const { data: stocksData } = await supabase
    .from('stocks')
    .select('id, name, ticker, market, sector, current_price, previous_close, volume, market_cap')
    .eq('market', id);

  const stocks: Stock[] = (stocksData || []).map((row: any) => ({
    id: row.id,
    name: row.name,
    ticker: row.ticker,
    market: row.market,
    sector: row.sector,
    currentPrice: row.current_price,
    previousClose: row.previous_close,
    volume: row.volume || 100000,
    marketCap: row.market_cap || (row.current_price * 1000000),
  } as Stock));

  const up = stocks.filter((s) => s.currentPrice > s.previousClose).length;
  const down = stocks.filter((s) => s.currentPrice < s.previousClose).length;
  const flat = stocks.length - up - down;
  const avgPct = stocks.length > 0 ?
    stocks.reduce((a, s) => a + change(s.currentPrice, s.previousClose).percent, 0) / stocks.length : 0;

  return (
    <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">
      <nav className="flex items-center gap-2 text-[12px] text-[#8E939D] font-mono">
        <Link href="/" className="hover:text-white font-medium">
          메인홈
        </Link>
        <span>/</span>
        <span className="text-white font-bold">{meta.nameKo}</span>
      </nav>

      {/* Header Banner */}
      <div className="bg-[#0E1117] border border-[#212631] p-6 rounded-3xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-2xl">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#F04452]/40 bg-[#F04452]/10 px-3.5 py-1 text-[11px] font-mono font-bold text-[#F04452] mb-2">
            <span className="inline-block h-2 w-2 rounded-full bg-[#F04452] animate-pulse" />
            {meta.id.toUpperCase()} MARKET · {meta.nameKo}
          </div>
          <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">
            {meta.nameKo} 시장 종목 리스트
          </h1>
          <p className="text-[12.5px] text-[#8E939D] mt-1 font-medium leading-relaxed font-sans">{meta.description}</p>
        </div>

        <div className="flex gap-6 text-right bg-[#161B22] px-5 py-3 rounded-2xl border border-[#212631] shrink-0 font-mono">
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
  const color = tone === "up" ? "text-[#F04452]" : tone === "down" ? "text-[#3182F6]" : "text-white";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-[#8E939D] font-bold">{label}</div>
      <div className={`font-mono text-[15px] font-black tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

