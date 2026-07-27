import Link from "next/link";
import { change, fmtSigned } from "@/lib/format";
import { getKOSPIIndex, getSP50Index, getEuroStoxx50Index, type MarketIndex } from "@/lib/index";
import MoverCard from "@/app/components/MoverCard";
import { createClient } from "@/lib/supabase/server";
import type { Stock } from "@/lib/types";

export const revalidate = 0; // Disable caching to fetch live data from Supabase

export default async function Home() {
  const supabase = await createClient();
  
  // Check user session & profile unlocked_features
  const { data: { session } } = await supabase.auth.getSession();
  let hasCustomDashboard = false;

  if (session?.user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin, unlocked_features')
      .eq('id', session.user.id)
      .single();
    
    if (profile) {
      const unlocked = (profile.unlocked_features as string[]) || [];
      hasCustomDashboard = profile.is_admin || unlocked.includes("custom_dashboard");
    }
  }

  // Fetch stocks, news, and market indices
  const [{ data: stocksData }, { data: newsData }, { data: indicesData }] = await Promise.all([
    supabase.from('stocks').select('id, name, ticker, market, sector, current_price, previous_close'),
    supabase.from('news_v2').select('*').order('created_at', { ascending: false }).limit(5),
    supabase.from('market_indices').select('market, index_value')
  ]);
    
  const indicesMap: Record<string, number> = {};
  if (indicesData) {
    indicesData.forEach(row => { indicesMap[row.market] = row.index_value; });
  }
    
  const STOCKS: Stock[] = (stocksData || []).map(row => ({
    id: row.id,
    name: row.name,
    ticker: row.ticker,
    market: row.market,
    sector: row.sector,
    currentPrice: row.current_price,
    previousClose: row.previous_close,
    marketCap: row.current_price * 1000000,
  } as Stock));

  const NEWS = newsData || [];

  const kospi = getKOSPIIndex(STOCKS, indicesMap['kospi'] || 2500);
  const sp50 = getSP50Index(STOCKS, indicesMap['sp50'] || 5000);
  const euroStoxx50 = getEuroStoxx50Index(STOCKS, indicesMap['eurostoxx50'] || 4000);

  const sorted = [...STOCKS].sort(
    (a, b) => change(b.currentPrice, b.previousClose).percent - change(a.currentPrice, a.previousClose).percent,
  );
  const gainers = sorted.slice(0, 5);
  const losers = sorted.slice(-5).reverse();

  // If user has unlocked custom dashboard, render full custom dashboard widgets
  if (hasCustomDashboard) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-tx">메인홈 커스텀 대시보드</h1>
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-[#3182F6]/20 text-[#3182F6] border border-[#3182F6]/30">
                UNLOCKED
              </span>
            </div>
            <p className="text-[13px] text-muted">가상 주식 시장 전체 현황 · 거래시간 18:00–22:30</p>
          </div>
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

          <div className="rounded-xl border border-[#222736] bg-[#151821] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between border-b border-[#222736] px-4 py-3 bg-[#12151e]">
              <h3 className="text-[13px] font-semibold text-tx">최신 뉴스</h3>
              <Link href="/news" className="text-[11px] text-[#3182F6] hover:underline font-medium">
                전체 보기
              </Link>
            </div>
            <div className="divide-y divide-[#222736] flex-1 flex flex-col">
              {NEWS.length > 0 ? NEWS.map((n: any) => (
                <Link key={n.id} href="/news" className="block px-4 py-3 hover:bg-[#1a1e29] transition-colors">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        n.publisher?.includes("스트리트 리포트") || n.publisher?.includes("피드 터미널") || n.publisher?.includes("와이어 넷")
                          ? "bg-[#3182F6]/15 text-[#3182F6]"
                          : "bg-[#f04452]/15 text-[#f04452]"
                      }`}
                    >
                      {n.publisher || "언론사"}
                    </span>
                    <span
                      className={`text-[10px] font-medium ${
                        n.sentiment === "positive" ? "text-up" : n.sentiment === "negative" ? "text-down" : "text-dim"
                      }`}
                    >
                      {n.sentiment === "positive" ? "호재" : n.sentiment === "negative" ? "악재" : "중립"}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[12px] text-tx leading-snug">{n.headline}</p>
                </Link>
              )) : (
                <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
                  <p className="text-[12px] text-dim font-medium">시장을 수집 분석 중입니다.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // DEFAULT GAME INTRO PAGE (For non-unlocked users)
  return (
    <div className="mx-auto max-w-7xl px-6 py-10 space-y-12">
      {/* Hero Game Banner */}
      <div className="relative overflow-hidden rounded-2xl border border-[#222736] bg-[#151821] p-8 md:p-12 shadow-xl">
        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#3182F6]/40 bg-[#3182F6]/10 px-3 py-1 text-[11px] font-bold text-[#3182F6]">
            SYSTEM OVERVIEW · 가상 금융 시장
          </div>
          <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white leading-tight">
            무명 가상 주식 거래소<br />
            <span className="text-[#3182F6]">
              실시간 자산 시장 시뮬레이션
            </span>
          </h1>
          <p className="text-[14px] text-[#8b95a1] leading-relaxed">
            국민연금, 블랙록, 시타델 등 50개 기관 봇들이 호가창을 주고받는 자산 시장입니다. 주식, 채권, 원자재, 파생상품 옵션 시장의 가격 흐름과 체결을 실시간으로 관측할 수 있습니다.
          </p>
          <div className="pt-2 flex flex-wrap items-center gap-3">
            <Link
              href="/stocks"
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl bg-[#3182F6] hover:bg-[#2b72d6] text-white font-bold text-[13px] transition-all"
            >
              주식 시장 바로가기
            </Link>
            <Link
              href="/shop"
              className="inline-flex items-center justify-center px-5 py-2.5 rounded-xl border border-[#353c52] bg-[#1a1e2a] hover:bg-[#232838] text-white font-bold text-[13px] transition-all"
            >
              상점 기능 해금
            </Link>
          </div>
        </div>

        {/* Decorative Grid Light Pattern */}
        <div className="absolute right-0 top-0 h-full w-1/3 opacity-10 bg-[radial-gradient(#3182F6_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />
      </div>

      {/* System Tutorial Guide */}
      <div className="space-y-4">
        <div>
          <h2 className="text-base font-bold text-tx">거래소 이용 가이드</h2>
          <p className="text-[12px] text-muted">기초 사용 방법 및 거래 순서</p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-[#222736] bg-[#151821] p-5 space-y-2">
            <div className="text-[11px] font-mono font-bold text-[#3182F6]">STEP 01</div>
            <h3 className="text-[14px] font-bold text-white">시장의 흐름과 종목 탐색</h3>
            <p className="text-[12.5px] text-[#8b95a1] leading-relaxed">
              상단 메뉴의 주식, 채권, 원자재, 옵션 탭에서 다양한 자산군의 실시간 체결가와 호가창을 확인할 수 있습니다.
            </p>
          </div>

          <div className="rounded-xl border border-[#222736] bg-[#151821] p-5 space-y-2">
            <div className="text-[11px] font-mono font-bold text-emerald-400">STEP 02</div>
            <h3 className="text-[14px] font-bold text-white">50개 기관 봇과의 실시간 거래</h3>
            <p className="text-[12.5px] text-[#8b95a1] leading-relaxed">
              호가창에서 매수/매도 지정가 및 시장가 주문을 제출하면 50개 기관 봇들의 알고리즘 주문과 체결됩니다.
            </p>
          </div>

          <div className="rounded-xl border border-[#222736] bg-[#151821] p-5 space-y-2">
            <div className="text-[11px] font-mono font-bold text-purple-400">STEP 03</div>
            <h3 className="text-[14px] font-bold text-white">뉴스 탐색 및 기능 해금</h3>
            <p className="text-[12.5px] text-[#8b95a1] leading-relaxed">
              뉴스 탭에서 시장 호재/악재 이슈를 확인하거나, 상점 페이지에서 다양한 라이선스와 기능을 해금할 수 있습니다.
            </p>
          </div>
        </div>
      </div>



      {/* Shop Custom Dashboard Unlock Banner */}
      <div className="rounded-xl border border-[#222736] bg-[#151821] p-6 flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-1 text-center md:text-left">
          <div className="text-[11px] font-bold text-muted">
            FEATURE UNLOCK
          </div>
          <h3 className="text-lg font-bold text-white">메인 대시보드 커스텀 기능</h3>
          <p className="text-[13px] text-[#8b95a1] max-w-xl">
            상점에서 해금 기능을 획득하면 주요 시장 지수, TOP 5 상승/하락 종목, 최신 뉴스 위젯으로 구성된 메인 대시보드를 사용할 수 있습니다.
          </p>
        </div>
        <Link
          href="/shop"
          className="shrink-0 px-6 py-3 rounded-xl bg-[#222736] hover:bg-[#2c3246] text-white font-bold text-[13px] transition-all border border-[#353c52]"
        >
          상점 페이지로 이동
        </Link>
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
      className="fintech-card p-5 flex flex-col justify-between h-full"
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{flag}</span>
          <span className="text-[16px] font-bold text-tx tracking-tight">{index.nameKo}</span>
        </div>
        <span className="text-[11px] font-medium text-dim bg-[#12151e] px-2 py-0.5 rounded border border-[#222736]">
          {index.constituentCount}종목
        </span>
      </div>

      <div className="flex items-baseline justify-between">
        <div className={`font-mono text-[26px] font-extrabold tabular-nums tracking-tight ${color}`}>
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
