"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

import { useAuth } from "@/lib/auth/useAuth";

export type CombinedNews = {
  id: string;
  created_at: string;
  type: string;
  category: 'OFFICIAL' | 'RUMOR' | 'CORRECTION';
  publisher: string;
  title: string;
  content: string;
  target_sector?: string | null;
  target_ticker?: string | null;
  impact_score?: number;
  is_fake?: boolean;
};

export default function NewsPage() {
  const [newsList, setNewsList] = useState<CombinedNews[]>([]);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  const supabase = createClient();
  const { userId, isLoggedIn } = useAuth();

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      if (isLoggedIn && userId) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_admin, news_subscriptions')
          .eq('id', userId)
          .single();
          
        if (!cancelled && profile) {
          setIsAdmin(profile.is_admin || false);
        }
      }

      // Fetch news in parallel via Promise.all
      const [{ data: mNews }, { data: pNews }] = await Promise.all([
        supabase.from('market_news').select('*').order('created_at', { ascending: false }).limit(50),
        supabase.from('premium_news').select('*, media_outlets(*)').order('created_at', { ascending: false }).limit(50),
      ]);
      
      if (cancelled) return;

      const combined: CombinedNews[] = [];

      if (mNews) {
        mNews.forEach((row: any) => {
          combined.push({
            id: row.id,
            created_at: row.created_at,
            type: 'MARKET',
            category: row.sentiment === 'positive' ? 'OFFICIAL' : row.sentiment === 'negative' ? 'RUMOR' : 'CORRECTION',
            publisher: row.publisher || 'AI 터미널',
            title: row.headline,
            content: row.summary || row.headline,
            target_sector: row.related_sector,
            target_ticker: row.related_ticker,
            impact_score: row.impact_score || 5,
            is_fake: false,
          });
        });
      }

      if (pNews) {
        pNews.forEach((row: any) => {
          combined.push({
            id: row.id,
            created_at: row.created_at,
            type: 'PREMIUM',
            category: row.category || 'OFFICIAL',
            publisher: row.media_outlets?.name || '프리미엄 언론',
            title: row.title,
            content: row.content,
            target_sector: row.target_sector,
            target_ticker: row.target_ticker,
            impact_score: row.impact_score || 5,
            is_fake: row.is_fake || false,
          });
        });
      }

      combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      if (!cancelled) {
        setNewsList(combined.slice(0, 50));
      }
    };

    fetchData();

    // 15초 주기 폴링으로 최신 뉴스 갱신
    const interval = setInterval(fetchData, 15000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [supabase, isLoggedIn, userId]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-6 font-sans space-y-6">
      {/* Header Banner */}
      <div className="bg-[#0E1117] border border-[#212631] p-6 rounded-3xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-2xl">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#F04452]/40 bg-[#F04452]/10 px-3.5 py-1 text-[11px] font-mono font-bold text-[#F04452] mb-2">
            <span className="inline-block h-2 w-2 rounded-full bg-[#F04452] animate-pulse" />
            AI NEWS LOUNGE · 글로벌 속보 & 찌라시
          </div>
          <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">
            Gemini AI 속보 & 찌라시 라운지
          </h1>
          <p className="text-[12.5px] text-[#8E939D] mt-1 font-medium leading-relaxed">
            실시간 거시경제 지표 발표부터 독립 언론사의 미확인 찌라시 및 정정 공시까지 모니터링합니다.
          </p>
        </div>
        <div className="flex items-center gap-2 font-mono shrink-0">
          <span className="px-3 py-1.5 bg-[#F04452]/10 border border-[#F04452]/30 text-[11px] font-bold text-[#F04452] rounded-full flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#F04452] animate-pulse" />
            LIVE STREAMING
          </span>
        </div>
      </div>

      {/* News Cards */}
      <div className="space-y-4 font-mono">
        {newsList.map((n) => {
          const isOfficial = n.category === 'OFFICIAL';
          const isCorrection = n.category === 'CORRECTION';
          const isRumor = n.category === 'RUMOR';
          const isSubscribed = isAdmin || isOfficial || isCorrection;

          const impactColor = (n.impact_score || 0) > 0 ? "text-[#F04452]" : (n.impact_score || 0) < 0 ? "text-[#3182F6]" : "text-[#8E939D]";

          return (
            <article
              key={n.id}
              className={`rounded-2xl border p-5 transition-all relative overflow-hidden bg-[#0E1117] shadow-xl ${
                isCorrection ? "border-[#F04452]/60 bg-[#F04452]/5" : isRumor ? "border-[#F59E0B]/40" : "border-[#212631]"
              }`}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-3 py-0.5 text-[10.5px] font-black border ${
                    isCorrection ? "bg-[#F04452]/15 text-[#F04452] border-[#F04452]/30" : isRumor ? "bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/30" : "bg-[#3182F6]/15 text-[#3182F6] border-[#3182F6]/30"
                  }`}>
                    {n.category}
                  </span>
                  <span className="rounded-full bg-[#161B22] border border-[#212631] px-3 py-0.5 text-[11px] text-[#8E939D] font-bold">
                    {n.publisher}
                  </span>
                  {n.target_ticker && (
                    <span className="rounded-full bg-[#F04452]/10 border border-[#F04452]/30 px-2.5 py-0.5 text-[11px] text-[#F04452] font-black">
                      ${n.target_ticker}
                    </span>
                  )}
                  {n.target_sector && (
                    <span className="rounded-full bg-[#3182F6]/10 border border-[#3182F6]/30 px-2.5 py-0.5 text-[11px] text-[#3182F6] font-bold">
                      #{n.target_sector}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {n.impact_score !== undefined && (
                    <span className={`font-mono text-[12px] font-black tabular-nums ${impactColor}`}>
                      IMPACT: {n.impact_score > 0 ? `+${n.impact_score.toFixed(1)}` : n.impact_score.toFixed(1)}
                    </span>
                  )}
                  <span className="text-[11px] font-mono text-[#565A63] font-bold">
                    {new Date(n.created_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>

              <h2 className="text-[15.5px] font-black text-white flex items-center gap-2 tracking-tight font-sans">
                {isCorrection && <span className="text-[#F04452]">⚠️</span>}
                {n.title}
              </h2>

              <div className="mt-3 text-[13px] leading-relaxed relative">
                {isSubscribed ? (
                  <div className="text-[#8E939D] whitespace-pre-line border-l-2 border-[#F04452] pl-4 py-2 bg-[#05070A] rounded-r-xl font-sans font-medium">
                    {n.content}
                  </div>
                ) : (
                  <div className="relative">
                    <p className="text-[#8E939D]/20 whitespace-pre-line blur-[5px] select-none pointer-events-none font-sans">
                      {n.content || "이 찌라시 기사의 세부 내용은 프리미엄 찌라시 구독자에게만 공개됩니다.\n본문 3줄 요약 블러 처리중..."}
                    </p>
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#05070A]/80 backdrop-blur-[2px] rounded-xl">
                      {userId ? (
                        <Link
                          href="/shop"
                          className="flex items-center gap-2 px-5 py-2.5 bg-[#F04452] text-white font-black text-[12px] rounded-full hover:bg-[#ff5252] transition shadow-lg cursor-pointer"
                        >
                          <span>🔒</span>
                          <span>구독권 구매 후 본문 열람하기</span>
                        </Link>
                      ) : (
                        <button disabled className="px-4 py-2 bg-[#161B22] text-[#8E939D] border border-[#212631] rounded-full font-bold text-[12px]">
                          로그인 후 구독 가능
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </article>
          );
        })}

        {newsList.length === 0 && (
          <div className="text-center py-12 text-[#8E939D] border border-dashed border-[#212631] rounded-3xl bg-[#0E1117] font-mono">
            새로운 AI 뉴스를 기다리는 중입니다... (엔진 5분 주기 발행)
          </div>
        )}
      </div>
    </div>
  );
}

