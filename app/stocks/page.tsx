"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { change, fmtSigned } from "@/lib/format";
import { getKOSPIIndex, getSP50Index, getEuroStoxx50Index } from "@/lib/index";
import type { MarketIndex } from "@/lib/index";
import type { MarketId, Stock } from "@/lib/types";
import StockTable from "@/app/components/StockTable";
import { createClient } from "@/lib/supabase/client";

type RegionTab = "kospi" | "sp50" | "eurostoxx50";

const TABS: { id: RegionTab; label: string; flag: string; market: MarketId }[] = [
  { id: "kospi", label: "KOSPI", flag: "🇰🇷", market: "domestic" },
  { id: "sp50", label: "S&P 50", flag: "🇺🇸", market: "overseas" },
  { id: "eurostoxx50", label: "유로스톡스 50", flag: "🇪🇺", market: "europe" },
];

export default function StocksPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-7xl px-6 py-6 text-center text-dim text-[13px]">불러오는 중...</div>}>
      <StocksContent />
    </Suspense>
  );
}

function StocksContent() {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<RegionTab>("kospi");
  const [allStocks, setAllStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  useEffect(() => {
    async function fetchStocks() {
      const { data } = await supabase
        .from('stocks')
        .select('id, name, ticker, market, sector, current_price, previous_close');
      
      if (data) {
        setAllStocks(data.map(row => ({
          id: row.id,
          name: row.name,
          ticker: row.ticker,
          market: row.market,
          sector: row.sector,
          currentPrice: row.current_price,
          previousClose: row.previous_close,
          marketCap: row.current_price * 1000000,
        } as Stock)));
      }
      setLoading(false);
    }
    fetchStocks();

    // Polling for live prices every 2 seconds
    const interval = setInterval(fetchStocks, 2000);
    return () => clearInterval(interval);
  }, [supabase]);

  useEffect(() => {
    const tabParam = searchParams.get("tab") as RegionTab;
    if (tabParam && (tabParam === "kospi" || tabParam === "sp50" || tabParam === "eurostoxx50")) {
      setTab(tabParam);
    }
  }, [searchParams]);

  if (loading) return <div className="mx-auto max-w-7xl px-6 py-6 text-center text-dim text-[13px]">데이터 로딩 중...</div>;

  const indices: Record<RegionTab, MarketIndex> = {
    kospi: getKOSPIIndex(allStocks),
    sp50: getSP50Index(allStocks),
    eurostoxx50: getEuroStoxx50Index(allStocks),
  };

  const currentTab = TABS.find((t) => t.id === tab)!;
  const index = indices[tab];
  const stocks = allStocks.filter(s => s.market === currentTab.market);

  const up = stocks.filter((s) => s.currentPrice > s.previousClose).length;
  const down = stocks.filter((s) => s.currentPrice < s.previousClose).length;
  const flat = stocks.length - up - down;

  const dir = index.changeAmount > 0 ? "up" : index.changeAmount < 0 ? "down" : "flat";
  const color = dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-muted";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "–";

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <nav className="mb-4 flex items-center gap-2 text-[12px] text-dim">
        <Link href="/" className="hover:text-tx">
          메인홈
        </Link>
        <span>/</span>
        <span className="text-muted">주식</span>
      </nav>

      <div className="mb-5">
        <h1 className="text-xl font-bold text-tx">주식 시장</h1>
        <p className="text-[13px] text-muted">KOSPI · S&P 50 · 유로스톡스 50 — 3개 지수 통합 조회</p>
      </div>

      {/* === 3개 지수 탭 === */}
      <div className="mb-5 flex gap-1 rounded-lg border border-border bg-panel p-1">
        {TABS.map((t) => {
          const idx = indices[t.id];
          const tDir = idx.changeAmount > 0 ? "up" : idx.changeAmount < 0 ? "down" : "flat";
          const tColor = tDir === "up" ? "text-up" : tDir === "down" ? "text-down" : "text-muted";
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-md px-4 py-2.5 transition-colors ${
                tab === t.id ? "bg-panel2" : "hover:bg-panel2/50"
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <span className="text-base">{t.flag}</span>
                <span className={`text-[13px] font-semibold ${tab === t.id ? "text-tx" : "text-dim"}`}>
                  {t.label}
                </span>
              </div>
              <div className={`mt-1 font-mono text-[15px] font-bold tabular-nums ${tColor}`}>
                {idx.currentValue.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span className="ml-1.5 text-[11px]">
                  {tDir === "up" ? "▲" : tDir === "down" ? "▼" : "–"} {fmtSigned(idx.changePct)}%
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* === 현재 지수 상세 === */}
      <div className="mb-6 rounded-xl border border-border bg-panel p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{currentTab.flag}</span>
              <h2 className="text-[18px] font-bold text-tx">{index.nameKo}</h2>
            </div>
            <p className="mt-0.5 text-[12px] text-dim">
              {index.constituentCount}개 종목 · 시가총액 가중 지수
            </p>
          </div>
          <div className="text-right">
            <div className={`font-mono text-[32px] font-bold tabular-nums ${color}`}>
              {index.currentValue.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            <div className={`mt-0.5 font-mono text-[15px] tabular-nums ${color}`}>
              {arrow} {index.changeAmount >= 0 ? "+" : ""}{index.changeAmount.toFixed(2)} ({fmtSigned(index.changePct)}%)
            </div>
          </div>
        </div>

        {/* 상승/하락 TOP 5 */}
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-up">
              상승 TOP 5
            </div>
            <div className="space-y-1">
              {index.topGainers.map((g) => (
                <Link
                  key={g.ticker}
                  href={`/stocks/${g.ticker}`}
                  className="flex justify-between text-[12px] hover:text-accent"
                >
                  <span className="text-muted">{g.name}</span>
                  <span className="font-mono text-up">+{g.changePct.toFixed(2)}%</span>
                </Link>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-down">
              하락 TOP 5
            </div>
            <div className="space-y-1">
              {index.topLosers.map((l) => (
                <div key={l.ticker} className="flex justify-between text-[12px]">
                  <span className="text-muted">{l.name}</span>
                  <span className="font-mono text-down">{l.changePct.toFixed(2)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* === 종목 통계 === */}
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-tx">
            {currentTab.flag} {currentTab.label} 구성 종목
          </h3>
          <p className="text-[12px] text-dim">{stocks.length}종목</p>
        </div>
        <div className="flex gap-6 text-right">
          <Stat label="상승" value={String(up)} tone="up" />
          <Stat label="보합" value={String(flat)} />
          <Stat label="하락" value={String(down)} tone="down" />
        </div>
      </div>

      {/* === 종목 테이블 === */}
      <StockTable stocks={stocks} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-tx";
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-dim">{label}</div>
      <div className={`font-mono text-[15px] font-semibold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}
