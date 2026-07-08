"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

type Outlet = {
  id: number;
  name: string;
  type: string;
  subscription_fee: number;
};

type PremiumNews = {
  id: string;
  media_outlet_id: number;
  headline: string;
  content_summary: string;
  created_at: string;
  media_outlets: Outlet;
};

export default function NewsPage() {
  const [newsList, setNewsList] = useState<PremiumNews[]>([]);
  const [cash, setCash] = useState<number>(0);
  const [subs, setSubs] = useState<number[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  useEffect(() => {
    const fetchData = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (session?.user) {
        setUserId(session.user.id);
        const { data: profile } = await supabase.from('profiles').select('cash, subscriptions').eq('id', session.user.id).single();
        if (profile) {
          setCash(profile.cash);
          setSubs(profile.subscriptions || []);
        }
      }

      // Fetch news joined with media_outlets
      const { data: news } = await supabase
        .from('premium_news')
        .select('*, media_outlets(*)')
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (news) {
        setNewsList(news as any[]);
      }
    };

    fetchData();

    const channel = supabase.channel('news_changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'premium_news' }, () => {
        fetchData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const handleSubscribe = async (outletId: number, fee: number, name: string) => {
    if (!userId || loading) return;
    if (cash < fee) {
      alert("예수금이 부족합니다.");
      return;
    }

    if (!confirm(`[${name}] 매체를 구독하시겠습니까?\n월 구독료: ₩${fee.toLocaleString()}`)) return;

    setLoading(true);
    try {
      const newCash = cash - fee;
      const newSubs = [...subs, outletId];
      
      await supabase.from('profiles').update({ cash: newCash, subscriptions: newSubs }).eq('id', userId);
      setCash(newCash);
      setSubs(newSubs);
      alert("구독이 완료되었습니다!");
    } catch (e) {
      console.error(e);
      alert("구독 실패");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl px-6 py-6">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-tx">뉴스 · 찌라시</h1>
        <p className="text-[13px] text-muted">공신력 있는 거시경제 뉴스부터 익명 찌라시까지</p>
      </div>

      <div className="space-y-4">
        {newsList.map((n) => {
          const isSubscribed = subs.includes(n.media_outlet_id);
          const outlet = n.media_outlets;

          return (
            <article
              key={n.id}
              className="rounded-xl border border-border bg-panel p-5 transition-colors hover:border-border/80 relative overflow-hidden"
            >
              <div className="mb-2 flex items-center gap-2">
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-semibold ${
                    outlet.type === 'MACRO' ? "bg-accent/15 text-accent" : "bg-warn/15 text-warn"
                  }`}
                >
                  {outlet.name}
                </span>
                <span className="ml-auto text-[11px] text-dim">
                  {new Date(n.created_at).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              
              <h2 className="text-[16px] font-bold text-tx">{n.headline}</h2>
              
              <div className="mt-3 text-[13px] leading-relaxed relative">
                {isSubscribed ? (
                  <p className="text-muted whitespace-pre-line border-l-2 border-accent/50 pl-3 py-1">
                    {n.content_summary}
                  </p>
                ) : (
                  <div className="relative">
                    <p className="text-muted/30 whitespace-pre-line blur-[3px] select-none">
                      이 기사의 내용은 프리미엄 구독자에게만 공개됩니다.<br/>
                      이 기사의 내용은 프리미엄 구독자에게만 공개됩니다.<br/>
                      이 기사의 내용은 프리미엄 구독자에게만 공개됩니다.
                    </p>
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-panel/60 backdrop-blur-[1px]">
                      {userId ? (
                        <button
                          onClick={() => handleSubscribe(outlet.id, outlet.subscription_fee, outlet.name)}
                          disabled={loading}
                          className="px-4 py-2 bg-accent text-white rounded-lg font-medium text-[13px] hover:bg-accent/90 transition"
                        >
                          본문 보기 (구독료: ₩{outlet.subscription_fee.toLocaleString()})
                        </button>
                      ) : (
                        <button disabled className="px-4 py-2 bg-panel2 text-dim border border-border rounded-lg font-medium text-[13px]">
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
          <div className="text-center py-10 text-muted">아직 발행된 뉴스가 없습니다.</div>
        )}
      </div>
    </div>
  );
}
