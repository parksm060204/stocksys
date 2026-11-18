"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/db/client";
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
  locked?: boolean;
};

export default function NewsPage() {
  const [newsList, setNewsList] = useState<CombinedNews[]>([]);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [hasActiveSub, setHasActiveSub] = useState<boolean>(false);

  const db = createClient();
  const { userId, isLoggedIn } = useAuth();

  useEffect(() => {
    let cancelled = false;

    const fetchData = async () => {
      if (isLoggedIn && userId) {
        const { data: profile } = await db
          .from('profiles')
          .select('is_admin, news_subscriptions')
          .eq('id', userId)
          .single();

        if (!cancelled && profile) {
          setIsAdmin(Boolean(profile.is_admin));
          const subs = profile.news_subscriptions && typeof profile.news_subscriptions === 'object'
            ? Object.values(profile.news_subscriptions as Record<string, string>)
            : [];
          const nowMs = Date.now();
          setHasActiveSub(subs.some((exp) => {
            const expMs = Date.parse(String(exp || ''));
            return Number.isFinite(expMs) && expMs > nowMs;
          }));
        }
      } else if (!cancelled) {
        setIsAdmin(false);
        setHasActiveSub(false);
      }

      const { data: mNews } = await db
        .from('market_news')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (cancelled) return;

      const combined: CombinedNews[] = [];

      if (mNews) {
        mNews.forEach((row: any) => {
          combined.push({
            id: row.id,
            created_at: row.created_at,
            type: 'MARKET',
            category: row.category || row.news_type || (row.sentiment === 'positive' ? 'OFFICIAL' : row.sentiment === 'negative' ? 'RUMOR' : 'CORRECTION'),
            publisher: row.publisher || 'AI 터미널',
            title: row.title || row.headline,
            content: row.content || row.summary || row.title || row.headline,
            target_sector: row.target_sector || row.related_sector,
            target_ticker: row.target_ticker || row.related_ticker,
            impact_score: row.impact_score || 5,
            locked: Boolean(row.locked),
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
  }, [db, isLoggedIn, userId]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-6 font-sans space-y-6">
      {/* Header Banner */}
      <div className="bg-[#0E1117] border border-border p-6 rounded-3xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-2xl">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#F04452]/40 bg-up/10 px-3.5 py-1 text-xs font-mono font-bold text-up mb-2">
            <span className="inline-block h-2 w-2 rounded-full bg-up animate-pulse" />
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
          <span className="px-3 py-1.5 bg-up/10 border border-[#F04452]/30 text-xs font-bold text-up rounded-full flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-up animate-pulse" />
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
          const isSubscribed = !n.locked && (isAdmin || isOfficial || isCorrection || hasActiveSub);

          const impactColor = (n.impact_score || 0) > 0 ? "text-up" : (n.impact_score || 0) < 0 ? "text-down" : "text-[#8E939D]";

          return (
            <article
              key={n.id}
              className={`rounded-2xl border p-5 transition-all relative overflow-hidden bg-[#0E1117] shadow-xl ${
                isCorrection ? "border-[#F04452]/60 bg-up/5" : isRumor ? "border-[#F59E0B]/40" : "border-border"
              }`}
            >
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`rounded-full px-3 py-0.5 text-[10.5px] font-black border ${
                    isCorrection ? "bg-up/15 text-up border-[#F04452]/30" : isRumor ? "bg-[#F59E0B]/15 text-[#F59E0B] border-[#F59E0B]/30" : "bg-down/15 text-down border-[#3182F6]/30"
                  }`}>
                    {n.category}
                  </span>
                  <span className="rounded-full bg-[#161B22] border border-border px-3 py-0.5 text-xs text-[#8E939D] font-bold">
                    {n.publisher}
                  </span>
                  {n.target_ticker && (
                    <span className="rounded-full bg-up/10 border border-[#F04452]/30 px-2.5 py-0.5 text-xs text-up font-black">
                      ${n.target_ticker}
                    </span>
                  )}
                  {n.target_sector && (
                    <span className="rounded-full bg-down/10 border border-[#3182F6]/30 px-2.5 py-0.5 text-xs text-down font-bold">
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
                  <span className="text-xs font-mono text-[#565A63] font-bold">
                    {new Date(n.created_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>

              <h2 className="text-[15.5px] font-black text-white flex items-center gap-2 tracking-tight font-sans">
                {isCorrection && <span className="text-up">⚠️</span>}
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
                          className="flex items-center gap-2 px-5 py-2.5 bg-up text-white font-black text-[12px] rounded-full hover:bg-[#ff5252] transition shadow-lg cursor-pointer"
                        >
                          <span>🔒</span>
                          <span>구독권 구매 후 본문 열람하기</span>
                        </Link>
                      ) : (
                        <button disabled className="px-4 py-2 bg-[#161B22] text-[#8E939D] border border-border rounded-full font-bold text-[12px]">
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
          <div className="text-center py-12 text-[#8E939D] border border-dashed border-border rounded-3xl bg-[#0E1117] font-mono">
            새로운 AI 뉴스를 기다리는 중입니다... (엔진 5분 주기 발행)
          </div>
        )}
      </div>
    </div>
  );
}
