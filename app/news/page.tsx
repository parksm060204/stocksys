"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

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
  const [subs, setSubs] = useState<Record<string, string>>({});
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  const supabase = createClient();

  useEffect(() => {
    const fetchData = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.user) {
        setUserId(session.user.id);
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_admin, news_subscriptions')
          .eq('id', session.user.id)
          .single();
          
        if (profile) {
          setIsAdmin(profile.is_admin || false);
          if (profile.news_subscriptions) {
            setSubs(profile.news_subscriptions as Record<string, string>);
          }
        }
      }

      // Fetch from market_news (Primary Gemini AI Engine table)
      const { data: mNews } = await supabase
        .from('market_news')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      // Fetch from premium_news (Backwards compatibility)
      const { data: pNews } = await supabase
        .from('premium_news')
        .select('*, media_outlets(*)')
        .order('created_at', { ascending: false })
        .limit(50);
      
      const combined: CombinedNews[] = [];

      if (mNews && mNews.length > 0) {
        mNews.forEach((mn: any) => {
          combined.push({
            id: mn.id,
            created_at: mn.created_at,
            type: mn.type || 'MACRO',
            category: mn.category || 'OFFICIAL',
            publisher: mn.publisher || '블룸버그 터미널',
            title: mn.title,
            content: mn.content,
            target_sector: mn.target_sector,
            target_ticker: mn.target_ticker,
            impact_score: Number(mn.impact_score || 0),
            is_fake: mn.is_fake
          });
        });
      }

      if (pNews && pNews.length > 0) {
        pNews.forEach((pn: any) => {
          const outlet = pn.media_outlets || {};
          combined.push({
            id: pn.id,
            created_at: pn.created_at,
            type: outlet.type || 'MICRO',
            category: pn.is_quoted ? 'RUMOR' : 'OFFICIAL',
            publisher: outlet.name || '스트리트 리포트',
            title: pn.headline,
            content: pn.content_summary,
            impact_score: pn.is_quoted ? 5.0 : 0
          });
        });
      }

      // Sort combined array by created_at DESC
      combined.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setNewsList(combined.slice(0, 50));
    };

    fetchData();

    // Supabase Realtime Subscription for instant streaming updates
    const channel = supabase.channel('endogenous_news_feed')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'market_news' }, () => fetchData())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'premium_news' }, () => fetchData())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const getDday = (expiryDate?: string) => {
    if (!expiryDate) return -1;
    const diff = new Date(expiryDate).getTime() - new Date().getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));
    return days >= 0 ? days : -1;
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-6 font-sans">
      <div className="mb-6 border-b border-border/40 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-tx tracking-tight flex items-center gap-2">
            <span>📰</span>
            <span>Gemini AI 속보 & 찌라시 라운지</span>
          </h1>
          <p className="mt-1 text-[13px] text-muted">
            실시간 거시경제 지표 발표부터 독립 언론사의 미확인 찌라시 및 정정 공시까지
          </p>
        </div>
        <div className="flex gap-2">
          <span className="px-2.5 py-1 bg-[#161b26] border border-[#2a3042] text-[11px] font-mono text-emerald-400 rounded-md">
            ● LIVE STREAMING
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {newsList.map((n) => {
          const isOfficial = n.category === 'OFFICIAL';
          const isCorrection = n.category === 'CORRECTION';
          const isRumor = n.category === 'RUMOR';
          const isSubscribed = isAdmin || isOfficial || isCorrection;

          const impactColor = (n.impact_score || 0) > 0 ? "text-red-400" : (n.impact_score || 0) < 0 ? "text-blue-400" : "text-muted";

          return (
            <article
              key={n.id}
              className={`rounded-xl border p-5 transition-all relative overflow-hidden bg-[#12151e] ${
                isCorrection ? "border-red-500/40 bg-red-950/10" : isRumor ? "border-amber-500/30" : "border-[#222736]"
              }`}
            >
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`rounded px-2.5 py-0.5 text-[10px] font-bold ${
                    isCorrection ? "bg-red-500/20 text-red-400" : isRumor ? "bg-amber-500/20 text-amber-300" : "bg-emerald-500/20 text-emerald-400"
                  }`}>
                    {n.category}
                  </span>
                  <span className="rounded bg-[#1c202c] border border-[#262b3a] px-2 py-0.5 text-[11px] text-[#9ca3af] font-medium">
                    {n.publisher}
                  </span>
                  {n.target_ticker && (
                    <span className="rounded bg-blue-500/10 border border-blue-500/30 px-2 py-0.5 text-[11px] font-mono text-blue-300 font-bold">
                      ${n.target_ticker}
                    </span>
                  )}
                  {n.target_sector && (
                    <span className="rounded bg-purple-500/10 border border-purple-500/30 px-2 py-0.5 text-[11px] font-mono text-purple-300">
                      #{n.target_sector}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  {n.impact_score !== undefined && (
                    <span className={`font-mono text-[12px] font-bold ${impactColor}`}>
                      IMPACT: {n.impact_score > 0 ? `+${n.impact_score.toFixed(1)}` : n.impact_score.toFixed(1)}
                    </span>
                  )}
                  <span className="text-[11px] font-mono text-dim">
                    {new Date(n.created_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              </div>

              <h2 className="text-[16px] font-bold text-tx drop-shadow-sm flex items-center gap-2">
                {isCorrection && <span className="text-red-400">⚠️</span>}
                {n.title}
              </h2>

              <div className="mt-3 text-[13px] leading-relaxed relative">
                {isSubscribed ? (
                  <div className="text-[#9ca3af] whitespace-pre-line border-l-2 border-accent/50 pl-3 py-1 bg-[#171b26]/50 rounded-r-md">
                    {n.content}
                  </div>
                ) : (
                  <div className="relative">
                    <p className="text-muted/20 whitespace-pre-line blur-[5px] select-none pointer-events-none">
                      {n.content || "이 찌라시 기사의 세부 내용은 프리미엄 찌라시 구독자에게만 공개됩니다.\n본문 3줄 요약 블러 처리중..."}
                    </p>
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#12151e]/80 backdrop-blur-[2px] rounded-lg">
                      {userId ? (
                        <Link
                          href="/shop"
                          className="flex items-center gap-2 px-5 py-2 bg-emerald-500 text-black font-bold text-[12px] rounded-md hover:bg-emerald-400 transition shadow-lg"
                        >
                          <span>🔒</span>
                          <span>구독권 구매 후 본문 열람하기</span>
                        </Link>
                      ) : (
                        <button disabled className="px-4 py-2 bg-[#1c202c] text-dim border border-border rounded-lg font-medium text-[12px]">
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
          <div className="text-center py-12 text-muted border border-dashed border-[#222736] rounded-xl">
            <span className="text-2xl block mb-2">📡</span>
            새로운 AI 뉴스를 기다리는 중입니다... (엔진 5분 주기 발행)
          </div>
        )}
      </div>
    </div>
  );
}
