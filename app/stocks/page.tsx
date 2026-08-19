"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { fmtSigned } from "@/lib/format";
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
    <Suspense fallback={<StocksSkeleton />}>
      <StocksContent />
    </Suspense>
  );
}

function StocksSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-6 space-y-5 animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-4 w-12 rounded bg-[#222736]" />
        <div className="h-4 w-3 rounded bg-[#1c2030]" />
        <div className="h-4 w-10 rounded bg-[#222736]" />
      </div>
      <div className="h-7 w-28 rounded bg-[#222736]" />
      {/* Tab skeleton */}
      <div className="flex gap-1 rounded-lg border border-[#222736] bg-[#151821] p-1">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex-1 h-14 rounded-md bg-[#1c2030]" />
        ))}
      </div>
      {/* Index card skeleton */}
      <div className="rounded-xl border border-[#222736] bg-[#151821] p-5 space-y-3">
        <div className="h-6 w-40 rounded bg-[#222736]" />
        <div className="h-9 w-52 rounded bg-[#222736]" />
      </div>
      {/* Table skeleton */}
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between rounded-lg border border-[#222736]/50 bg-[#151821] px-4 py-3.5">
            <div className="space-y-1.5">
              <div className="h-4 w-24 rounded bg-[#222736]" />
              <div className="h-3 w-16 rounded bg-[#1c2030]" />
            </div>
            <div className="h-4 w-20 rounded bg-[#222736]" />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-2 pt-2 text-[12px] text-dim">
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#3182F6] border-t-transparent" />
        시장 데이터 불러오는 중...
      </div>
    </div>
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
        setAllStocks(data.map((row: { id: string; name: string; ticker: string; market: string; sector: string; current_price: number; previous_close: number }) => ({
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

    // Polling for live prices every 5 seconds
    const interval = setInterval(fetchStocks, 5000);
    return () => clearInterval(interval);
  }, [supabase]);

  useEffect(() => {
    const tabParam = searchParams.get("tab") as RegionTab;
    if (tabParam && (tabParam === "kospi" || tabParam === "sp50" || tabParam === "eurostoxx50")) {
      setTab(tabParam);
    }
  }, [searchParams]);

  if (loading) return <StocksSkeleton />;

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

      {/* Header Banner */}
      <div className="mb-6 bg-[#0E1117] border border-[#212631] p-6 rounded-3xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-2xl">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#F04452]/40 bg-[#F04452]/10 px-3.5 py-1 text-[11px] font-bold text-[#F04452] mb-2">
            <span className="inline-block h-2 w-2 rounded-full bg-[#F04452] animate-pulse" />
            LIVE STOCKS MARKET · 주식 시장
          </div>
          <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">
            주식 시장 통합 터미널
          </h1>
          <p className="text-[12.5px] text-[#8E939D] mt-1 font-medium">
            KOSPI · S&P 50 · 유로스톡스 50 — 3개 주요 시장 지수 및 상장 종목 실시간 시세
          </p>
        </div>

        <div className="flex gap-6 text-right bg-[#161B22] px-5 py-3 rounded-2xl border border-[#212631] shrink-0 font-mono">
          <div>
            <div className="text-[10px] uppercase font-bold tracking-wider text-[#8E939D]">선택 시장</div>
            <div className="text-[15px] font-black text-white">{currentTab.label}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold tracking-wider text-[#8E939D]">상승 / 하락</div>
            <div className="text-[15px] font-black text-[#F04452] tabular-nums">{up} <span className="text-[#8E939D]">/</span> <span className="text-[#3182F6]">{down}</span></div>
          </div>
        </div>
      </div>

      {/* === 3개 지수 탭 (Robinhood Segmented Pills) === */}
      <div className="mb-6 flex gap-2 rounded-2xl border border-[#212631] bg-[#0E1117] p-1.5 shadow-lg">
        {TABS.map((t) => {
          const idx = indices[t.id];
          const tDir = idx.changeAmount > 0 ? "up" : idx.changeAmount < 0 ? "down" : "flat";
          const tColor = tDir === "up" ? "text-[#F04452]" : tDir === "down" ? "text-[#3182F6]" : "text-[#8E939D]";
          const isSelected = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex-1 rounded-xl px-4 py-3 transition-all cursor-pointer ${
                isSelected ? "bg-[#161B22] border border-white/10 shadow-md" : "hover:bg-[#12161F]/60"
              }`}
            >
              <div className="flex items-center justify-center gap-2">
                <span className="text-base">{t.flag}</span>
                <span className={`text-[13.5px] font-extrabold ${isSelected ? "text-white" : "text-[#8E939D]"}`}>
                  {t.label}
                </span>
              </div>
              <div className={`mt-1 font-mono text-[15px] font-black tabular-nums ${tColor}`}>
                {Math.round(idx.currentValue).toLocaleString("ko-KR")}
                <span className="ml-1.5 text-[11px] font-bold">
                  {fmtSigned(idx.changePct)}%
                </span>

              </div>
            </button>
          );
        })}
      </div>

      {/* === 현재 지수 상세 === */}
      <div className="mb-6 rounded-2xl border border-[#212631] bg-[#0E1117] p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">{currentTab.flag}</span>
              <h2 className="text-[20px] font-black text-white">{index.nameKo}</h2>
            </div>
            <p className="mt-1 text-[12.5px] text-[#8E939D]">
              {index.constituentCount}개 종목 · 시가총액 가중 지수
            </p>
          </div>
          <div className="text-right">
            <div className={`font-mono text-[34px] font-black tabular-nums ${color}`}>
              {Math.round(index.currentValue).toLocaleString("ko-KR")}
            </div>
            <div className={`mt-0.5 font-mono text-[14.5px] font-bold tabular-nums ${color}`}>
              {arrow} {index.changeAmount >= 0 ? "+" : ""}{Math.round(index.changeAmount).toLocaleString("ko-KR")} ({fmtSigned(index.changePct)}%)
            </div>
          </div>
        </div>

        {/* 상승/하락 TOP 5 */}
        <div className="mt-6 grid grid-cols-2 gap-6 pt-5 border-t border-[#212631]">
          <div>
            <div className="mb-2 text-[10.5px] font-mono font-bold uppercase tracking-wider text-[#F04452]">
              ▲ 실시간 상승 TOP 5
            </div>
            <div className="space-y-1.5">
              {index.topGainers.map((g) => (
                <Link
                  key={g.ticker}
                  href={`/stocks/${g.ticker}`}
                  className="flex justify-between text-[12.5px] hover:text-[#F04452] transition-colors group"
                >
                  <span className="text-[#8E939D] group-hover:text-white font-medium">{g.name}</span>
                  <span className="font-mono font-bold tabular-nums text-[#F04452]">+{g.changePct.toFixed(2)}%</span>
                </Link>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 text-[10.5px] font-mono font-bold uppercase tracking-wider text-[#3182F6]">
              ▼ 실시간 하락 TOP 5
            </div>
            <div className="space-y-1.5">
              {index.topLosers.map((l) => (
                <div key={l.ticker} className="flex justify-between text-[12.5px]">
                  <span className="text-[#8E939D] font-medium">{l.name}</span>
                  <span className="font-mono font-bold tabular-nums text-[#3182F6]">{l.changePct.toFixed(2)}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>


      {/* === 종목 통계 === */}
      <div className="mb-4 flex items-end justify-between px-1">
        <div>
          <h3 className="text-[16px] font-extrabold text-white">
            {currentTab.flag} {currentTab.label} 구성 종목
          </h3>
          <p className="text-[12px] text-[#8E939D]">{stocks.length}개 종목 상장</p>
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
  const color = tone === "up" ? "text-[#00C805]" : tone === "down" ? "text-[#FF3B30]" : "text-white";
  return (
    <div>
      <div className="text-[10px] uppercase font-bold tracking-wider text-[#8E939D]">{label}</div>
      <div className={`font-mono text-[16px] font-black tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

