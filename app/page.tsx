import Link from "next/link";
import { change, fmtSigned } from "@/lib/format";
import { getKOSPIIndex, getSP50Index, getEuroStoxx50Index, type MarketIndex } from "@/lib/index";
import MoverCard from "@/app/components/MoverCard";
import EcoTerminal from "@/app/components/EcoTerminal";
import { createClient } from "@/lib/supabase/server";
import { MARKETS } from "@/lib/constants";
import type { Stock } from "@/lib/types";

export const revalidate = 0; // Disable caching to fetch live data from Supabase

export default async function Home() {
  const supabase = await createClient();
  
  // Fetch only necessary columns for the home page (we need all stocks to calculate index and top movers)
  const [{ data: stocksData }, { data: newsData }] = await Promise.all([
    supabase.from('stocks').select('id, name, ticker, market, sector, current_price, previous_close'),
    supabase.from('news_v2').select('*').order('created_at', { ascending: false }).limit(5)
  ]);
    
  const STOCKS: Stock[] = (stocksData || []).map(row => ({
    id: row.id,
    name: row.name,
    ticker: row.ticker,
    market: row.market,
    sector: row.sector,
    currentPrice: row.current_price,
    previousClose: row.previous_close,
    marketCap: row.current_price * 1000000, // placeholder since we didn't fetch shares_outstanding
  } as Stock));

  const NEWS = newsData || [];

  const kospi = getKOSPIIndex(STOCKS);
  const sp50 = getSP50Index(STOCKS);
  const euroStoxx50 = getEuroStoxx50Index(STOCKS);

  const marketStats = MARKETS.map((m) => {
    const list = STOCKS.filter(s => s.market === m.id);
    const up = list.filter((s) => s.currentPrice > s.previousClose).length;
    const down = list.filter((s) => s.currentPrice < s.previousClose).length;
    const avgPct = list.length > 0 ?
      list.reduce((a, s) => a + change(s.currentPrice, s.previousClose).percent, 0) / list.length : 0;
    return { market: m, count: list.length, up, down, avgPct };
  });

  const sorted = [...STOCKS].sort(
    (a, b) => change(b.currentPrice, b.previousClose).percent - change(a.currentPrice, a.previousClose).percent,
  );
  const gainers = sorted.slice(0, 5);
  const losers = sorted.slice(-5).reverse();

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-tx">메인홈</h1>
        <p className="text-[13px] text-muted">가상 주식 시장 전체 현황 · 거래시간 18:00–22:30</p>
      </div>

      {/* === 시장 지수 === */}
      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <IndexCard index={kospi} />
        <IndexCard index={sp50} />
        <IndexCard index={euroStoxx50} />
      </div>


      <div className="grid gap-6 lg:grid-cols-3">
        <MoverCard title="상승 TOP 5" stocks={gainers} />
        <MoverCard title="하락 TOP 5" stocks={losers} />

        <div className="rounded-xl border border-border bg-panel glass-card hover-glass flex flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-[13px] font-semibold text-tx">최신 뉴스</h3>
            <Link href="/news" className="text-[11px] text-accent hover:underline">
              전체 보기
            </Link>
          </div>
          <div className="divide-y divide-border flex-1 flex flex-col">
            {NEWS.length > 0 ? NEWS.map((n: any) => (
              <Link key={n.id} href="/news" className="block px-4 py-3 hover:bg-panel2/60">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-px text-[9px] font-semibold ${
                      n.publisher?.includes("블룸버그") || n.publisher?.includes("로이터")
                        ? "bg-accent/15 text-accent"
                        : "bg-up/15 text-up"
                    }`}
                  >
                    {n.publisher || "언론사"}
                  </span>
                  <span
                    className={`text-[9px] ${
                      n.sentiment === "positive" ? "text-up" : n.sentiment === "negative" ? "text-down" : "text-dim"
                    }`}
                  >
                    {n.sentiment === "positive" ? "호재" : n.sentiment === "negative" ? "악재" : "중립"}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[12px] text-tx">{n.headline}</p>
              </Link>
            )) : (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <span className="text-2xl mb-2">🤖</span>
                <p className="text-[12px] text-dim font-medium">AI가 시장을 분석 중입니다.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function IndexCard({ index }: { index: MarketIndex }) {
  const dir = index.changeAmount > 0 ? "up" : index.changeAmount < 0 ? "down" : "flat";
  const color = dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-muted";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "–";
  const flag = index.market === "domestic" ? "🇰🇷" : index.market === "europe" ? "🇪🇺" : "🇺🇸";
  const href =
    index.market === "domestic"
      ? "/stocks?tab=kospi"
      : index.market === "europe"
        ? "/stocks?tab=eurostoxx50"
        : "/stocks?tab=sp50";

  return (
    <Link
      href={href}
      className="group relative overflow-hidden rounded-xl border border-border bg-panel p-6 glass-card hover-glass flex flex-col justify-between h-full"
    >
      <div className="absolute inset-0 opacity-10 pointer-events-none" style={{
        background: `linear-gradient(to top, ${dir === 'up' ? 'var(--up)' : dir === 'down' ? 'var(--down)' : 'transparent'} 0%, transparent 100%)`
      }}></div>
      
      <div className="relative z-10 flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl drop-shadow-md">{flag}</span>
            <span className="text-[18px] font-bold text-tx drop-shadow-sm">{index.nameKo}</span>
          </div>
          <div className="text-[12px] text-dim font-medium">
            {index.constituentCount}개 종목 · 시가총액 가중
          </div>
        </div>
        <div className="text-right">
          <div className={`font-mono text-[32px] font-black tabular-nums tracking-tighter ${color} drop-shadow-sm`}>
            {index.currentValue.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className={`mt-1 font-mono text-[15px] font-semibold tabular-nums ${color}`}>
            {arrow} {index.changeAmount >= 0 ? "+" : ""}{index.changeAmount.toFixed(2)} ({fmtSigned(index.changePct)}%)
          </div>
        </div>
      </div>
    </Link>
  );
}
