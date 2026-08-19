'use client';

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { change, fmtSigned } from "@/lib/format";
import { getKOSPIIndex, getSP50Index, getEuroStoxx50Index, type MarketIndex } from "@/lib/index";
import MoverCard from "@/app/components/MoverCard";
import type { Stock } from "@/lib/types";

import { useAuth } from "@/lib/auth/useAuth";

/**
 * Renders children (static intro) immediately.
 * In background, checks if user has dashboard access.
 * If unlocked, fetches data and swaps to the live dashboard.
 */
export default function DashboardGate({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<'intro' | 'loading' | 'dashboard'>('intro');

  const supabase = createClient();
  const { userId, isLoggedIn } = useAuth();

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!isLoggedIn || !userId || cancelled) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin, unlocked_features')
        .eq('id', userId)
        .single();

      if (cancelled) return;
      if (!profile) return;

      const unlocked = (profile.unlocked_features as string[]) || [];
      if (profile.is_admin || unlocked.includes("custom_dashboard")) {
        setMode('dashboard');
      }
    })();

    return () => { cancelled = true; };
  }, [supabase, isLoggedIn, userId]);

  if (mode === 'intro') return <>{children}</>;
  if (mode === 'loading') return <DashboardSkeleton />;
  return <DashboardContent />;
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-6 animate-pulse">
      <div className="mb-6 space-y-2">
        <div className="h-6 w-56 rounded-lg bg-[#161B22]" />
        <div className="h-3 w-72 rounded-lg bg-[#12161F]" />
      </div>
      <div className="mb-8 grid gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-28 rounded-2xl border border-[#212631] bg-[#0E1117]" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-64 rounded-2xl border border-[#212631] bg-[#0E1117]" />
        ))}
      </div>
    </div>
  );
}

function DashboardContent() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [news, setNews] = useState<any[]>([]);
  const [indicesMap, setIndicesMap] = useState<Record<string, number>>({});
  const [ready, setReady] = useState(false);

  const supabase = createClient();

  useEffect(() => {
    (async () => {
      const [{ data: stocksData }, { data: newsData }, { data: indicesData }] = await Promise.all([
        supabase.from('stocks').select('id, name, ticker, market, sector, current_price, previous_close'),
        supabase.from('market_news').select('*').order('created_at', { ascending: false }).limit(5),
        supabase.from('market_indices').select('code, current_value')
      ]);

      const map: Record<string, number> = {};
      if (indicesData) indicesData.forEach((row: { code: string; current_value: number }) => { map[row.code ? row.code.toLowerCase() : ''] = Number(row.current_value); });
      setIndicesMap(map);

      if (stocksData) {
        setStocks(stocksData.map((row: { id: string; name: string; ticker: string; market: string; sector: string; current_price: number; previous_close: number }) => ({
          id: row.id, name: row.name, ticker: row.ticker, market: row.market,
          sector: row.sector, currentPrice: row.current_price, previousClose: row.previous_close,
          marketCap: row.current_price * 1000000,
        } as Stock)));
      }
      setNews(newsData || []);
      setReady(true);
    })();
  }, [supabase]);

  if (!ready) return <DashboardSkeleton />;

  const kospi = getKOSPIIndex(stocks, indicesMap['kospi'] || 2500);
  const sp50 = getSP50Index(stocks, indicesMap['sp50'] || 5000);
  const euroStoxx50 = getEuroStoxx50Index(stocks, indicesMap['eurostoxx50'] || 4000);

  const sorted = [...stocks].sort(
    (a, b) => change(b.currentPrice, b.previousClose).percent - change(a.currentPrice, a.previousClose).percent,
  );
  const gainers = sorted.slice(0, 5);
  const losers = sorted.slice(-5).reverse();

  return (
    <div className="mx-auto max-w-7xl px-6 py-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black text-white tracking-tight">포트폴리오 & 대시보드</h1>
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-[#F04452]/15 text-[#F04452] border border-[#F04452]/30 tracking-wide">
              UNLOCKED
            </span>
          </div>
          <p className="text-[13px] text-[#8E939D] mt-0.5">가상 주식 시장 전체 현황 · 정규장 18:00–22:30</p>
        </div>
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-3">
        <IndexCard index={kospi} />
        <IndexCard index={sp50} />
        <IndexCard index={euroStoxx50} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <MoverCard title="상승 TOP 5" stocks={gainers} />
        <MoverCard title="하락 TOP 5" stocks={losers} />

        <div className="rounded-2xl border border-[#212631] bg-[#0E1117] flex flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b border-[#212631] px-5 py-3.5 bg-[#090B0F]">
            <h3 className="text-[13.5px] font-extrabold text-white">최신 시황 뉴스</h3>
            <Link href="/news" className="text-[11px] text-[#F04452] hover:underline font-bold">
              전체 보기
            </Link>
          </div>
          <div className="divide-y divide-[#212631] flex-1 flex flex-col">
            {news.length > 0 ? news.map((n: any) => (
              <Link key={n.id} href="/news" className="block px-5 py-3.5 hover:bg-[#161B22] transition-colors group">
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-[#161B22] border border-[#212631] px-2 py-0.5 text-[10px] font-bold text-[#8E939D]">
                    {n.publisher || "언론사"}
                  </span>
                  <span className={`text-[10px] font-bold ${
                    n.sentiment === "positive" ? "text-[#F04452]" : n.sentiment === "negative" ? "text-[#3182F6]" : "text-[#8E939D]"
                  }`}>
                    {n.sentiment === "positive" ? "호재" : n.sentiment === "negative" ? "악재" : "중립"}
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-2 text-[12.5px] text-white font-medium group-hover:text-[#F04452] transition-colors leading-snug">{n.headline}</p>
              </Link>
            )) : (
              <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                <p className="text-[12px] text-[#8E939D] font-medium">시장을 수집 분석 중입니다.</p>
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
  const color = dir === "up" ? "text-[#F04452]" : dir === "down" ? "text-[#3182F6]" : "text-[#8E939D]";
  const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "–";
  const flag = index.market === "domestic" ? "🇰🇷" : index.market === "europe" ? "🇪🇺" : "🇺🇸";
  const href = index.market === "domestic" ? "/stocks?tab=kospi" : index.market === "europe" ? "/stocks?tab=eurostoxx50" : "/stocks?tab=sp50";

  return (
    <Link href={href} className="fintech-card p-5 flex flex-col justify-between h-full group hover:border-[#F04452]/40 transition-all">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{flag}</span>
          <span className="text-[16px] font-extrabold text-white tracking-tight group-hover:text-[#F04452] transition-colors">{index.nameKo}</span>
        </div>
        <span className="text-[11px] font-mono font-bold text-[#8E939D] bg-[#161B22] px-2.5 py-0.5 rounded-full border border-[#212631]">
          {index.constituentCount}종목
        </span>
      </div>
      <div className="flex items-baseline justify-between">
        <div className={`font-mono text-[26px] font-black tabular-nums tracking-tight ${color}`}>
          {index.market === 'domestic'
            ? Math.round(index.currentValue).toLocaleString("ko-KR")
            : index.currentValue.toLocaleString("ko-KR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
        <div className={`font-mono text-[13px] font-bold tabular-nums ${color}`}>
          {arrow} {index.changeAmount >= 0 ? "+" : ""}{index.market === 'domestic' ? Math.round(index.changeAmount) : index.changeAmount.toFixed(2)} ({fmtSigned(index.changePct)}%)
        </div>
      </div>
    </Link>
  );
}


