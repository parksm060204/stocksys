import Link from "next/link";
import { MARKETS, NEWS, STOCKS, getStocksByMarket } from "@/lib/mock-data";
import { change, fmtSigned } from "@/lib/format";
import { getKOSPIIndex, getSP50Index, getEuroStoxx50Index } from "@/lib/index";
import type { MarketIndex } from "@/lib/index";
import MoverCard from "@/app/components/MoverCard";
import EcoTerminal from "@/app/components/EcoTerminal";

export default function Home() {
  const kospi = getKOSPIIndex();
  const sp50 = getSP50Index();
  const euroStoxx50 = getEuroStoxx50Index();

  const marketStats = MARKETS.map((m) => {
    const list = getStocksByMarket(m.id);
    const up = list.filter((s) => s.currentPrice > s.previousClose).length;
    const down = list.filter((s) => s.currentPrice < s.previousClose).length;
    const avgPct =
      list.reduce((a, s) => a + change(s.currentPrice, s.previousClose).percent, 0) / list.length;
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

      <div className="mb-3 px-1 text-[11px] font-semibold uppercase tracking-wider text-dim">
        시장별 현황
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
        {marketStats.map(({ market, count, up, down, avgPct }) => {
          const href =
            market.id === "domestic"
              ? "/stocks?tab=kospi"
              : market.id === "overseas"
                ? "/stocks?tab=sp50"
                : market.id === "europe"
                  ? "/stocks?tab=eurostoxx50"
                  : `/markets/${market.id}`;
          return (
            <Link
              key={market.id}
              href={href}
              className="group rounded-xl border border-border bg-panel p-4 transition-colors hover:border-accent/40"
            >
              <div className="mb-2 flex items-center gap-2">
                <span className="text-lg">{market.icon}</span>
                <span className="text-[13px] font-semibold text-tx">{market.nameKo}</span>
              </div>
              <div className="text-[11px] text-dim">{count}종목</div>
              <div
                className={`mt-2 font-mono text-[15px] font-bold tabular-nums ${
                  avgPct >= 0 ? "text-up" : "text-down"
                }`}
              >
                {avgPct >= 0 ? "▲" : "▼"} {fmtSigned(avgPct)}%
              </div>
              <div className="mt-1 flex gap-2 text-[10px]">
                <span className="text-up">▲{up}</span>
                <span className="text-down">▼{down}</span>
              </div>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          <MoverCard title="상승 TOP 5" stocks={gainers} />
          <MoverCard title="하락 TOP 5" stocks={losers} />
          
          {/* ECO 터미널 UI 추가 */}
          <div className="mt-8">
            <EcoTerminal />
          </div>
        </div>

        <div className="rounded-xl border border-border bg-panel">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="text-[13px] font-semibold text-tx">최신 뉴스</h3>
            <Link href="/news" className="text-[11px] text-accent hover:underline">
              전체 보기
            </Link>
          </div>
          <div className="divide-y divide-border">
            {NEWS.slice(0, 5).map((n) => (
              <Link key={n.id} href="/news" className="block px-4 py-3 hover:bg-panel2/60">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded px-1.5 py-px text-[9px] font-semibold ${
                      n.source === "AI"
                        ? "bg-accent/15 text-accent"
                        : n.source === "DISCLOSURE"
                          ? "bg-warn/15 text-warn"
                          : "bg-up/15 text-up"
                    }`}
                  >
                    {n.source}
                  </span>
                  <span
                    className={`text-[9px] ${
                      n.sentiment === "positive" ? "text-up" : n.sentiment === "negative" ? "text-down" : "text-dim"
                    }`}
                  >
                    {n.sentiment === "positive" ? "호재" : n.sentiment === "negative" ? "악재" : "중립"}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[12px] text-tx">{n.title}</p>
              </Link>
            ))}
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
      className="group rounded-xl border border-border bg-panel p-5 transition-colors hover:border-accent/40"
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">{flag}</span>
            <span className="text-[16px] font-bold text-tx">{index.nameKo}</span>
          </div>
          <div className="mt-0.5 text-[11px] text-dim">
            {index.constituentCount}개 종목 · 시가총액 가중
          </div>
        </div>
        <div className="text-right">
          <div className={`font-mono text-[28px] font-bold tabular-nums ${color}`}>
            {index.currentValue.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          <div className={`mt-0.5 font-mono text-[14px] tabular-nums ${color}`}>
            {arrow} {index.changeAmount >= 0 ? "+" : ""}{index.changeAmount.toFixed(2)} ({fmtSigned(index.changePct)}%)
          </div>
        </div>
      </div>

      {/* 상승/하락 종목 */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-up">
            상승 TOP 3
          </div>
          <div className="space-y-1">
            {index.topGainers.slice(0, 3).map((g) => (
              <div key={g.ticker} className="flex justify-between text-[11px]">
                <span className="text-muted">{g.name}</span>
                <span className="font-mono text-up">+{g.changePct.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-down">
            하락 TOP 3
          </div>
          <div className="space-y-1">
            {index.topLosers.slice(0, 3).map((l) => (
              <div key={l.ticker} className="flex justify-between text-[11px]">
                <span className="text-muted">{l.name}</span>
                <span className="font-mono text-down">{l.changePct.toFixed(2)}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}
