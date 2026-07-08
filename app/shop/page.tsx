"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

type Outlet = {
  id: number;
  name: string;
  type: string;
  reliability: number;
  subscription_fee: number;
  description: string;
};

export default function ShopPage() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [cash, setCash] = useState<number>(0);
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
        const { data: portfolio } = await supabase.from('portfolios').select('cash_balance').eq('user_id', session.user.id).single();
        if (portfolio) {
          setCash(portfolio.cash_balance || 0);
        }
      }

      // Fetch all media outlets (excluding DART which is free)
      const { data: outletData } = await supabase
        .from('media_outlets')
        .select('*')
        .neq('subscription_fee', 0)
        .order('subscription_fee', { ascending: false });

      if (outletData) {
        setOutlets(outletData as Outlet[]);
      }
    };
    fetchData();
  }, [supabase]);

  const handlePurchase = async (outlet: Outlet, days: number, price: number) => {
    if (!userId || loading) return;
    if (cash < price) {
      alert("보유 예수금이 부족합니다.");
      return;
    }

    const months = days / 30;
    if (!confirm(`[${outlet.name}] ${months}개월권을 구독하시겠습니까?\n결제 금액: ₩${price.toLocaleString()}`)) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('purchase_news_subscription_v2', {
        user_uuid: userId,
        agency_id: String(outlet.id),
        total_price: price,
        add_days: days
      });

      if (error) throw error;
      if (!data) throw new Error("잔액 부족 또는 결제 실패");

      // Update local cash
      setCash(prev => prev - price);
      alert("성공적으로 구독되었습니다! 뉴스 탭에서 확인하세요.");
    } catch (e: any) {
      console.error(e);
      alert("결제에 실패했습니다: " + (e.message || "알 수 없는 오류"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <div className="mb-8 flex items-end justify-between border-b border-border pb-4">
        <div>
          <h1 className="text-2xl font-bold text-tx tracking-tight">구독 상점</h1>
          <p className="mt-1 text-[13px] text-muted">정보가 곧 돈입니다. 최고급 시장 정보를 가장 먼저 받아보세요.</p>
        </div>
        <div className="text-right">
          <div className="text-[11px] text-dim font-medium mb-1 uppercase tracking-wider">보유 예수금</div>
          <div className="text-xl font-mono font-bold text-accent drop-shadow-sm">
            ₩{cash.toLocaleString()}
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {outlets.map((outlet) => {
          const m1_price = outlet.subscription_fee;
          const m3_price = outlet.subscription_fee * 3 * 0.95; // 5% discount
          const m12_price = outlet.subscription_fee * 12 * 0.8; // 20% discount

          return (
            <div key={outlet.id} className="rounded-xl border border-border bg-panel glass-card flex flex-col relative overflow-hidden transition-all duration-300 hover:border-accent/30 hover:shadow-[0_0_20px_rgba(52,211,153,0.1)]">
              {/* Header */}
              <div className="p-5 border-b border-border/50 bg-panel2/30 relative">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${
                    outlet.type === 'MACRO' ? 'bg-accent/20 text-accent' : 'bg-warn/20 text-warn'
                  }`}>
                    {outlet.type === 'MACRO' ? '1티어 글로벌' : '사설 찌라시'}
                  </span>
                  <span className="text-[11px] text-dim ml-auto font-mono">신뢰도: {outlet.reliability}%</span>
                </div>
                <h2 className="text-lg font-bold text-tx drop-shadow-sm leading-tight">{outlet.name}</h2>
                <p className="mt-2 text-[12px] text-muted line-clamp-2 min-h-[36px]">{outlet.description}</p>
              </div>

              {/* Pricing Options */}
              <div className="p-5 flex-1 flex flex-col gap-3">
                
                {/* 1 Month */}
                <button 
                  onClick={() => handlePurchase(outlet, 30, m1_price)}
                  disabled={loading}
                  className="w-full flex items-center justify-between p-3 rounded-lg border border-border bg-bg/50 hover:bg-panel2/80 transition-colors text-left group cursor-pointer disabled:opacity-50"
                >
                  <span className="text-[13px] font-semibold text-muted group-hover:text-tx">1개월권</span>
                  <span className="font-mono text-[14px] text-tx group-hover:text-accent">₩{m1_price.toLocaleString()}</span>
                </button>

                {/* 3 Months */}
                <button 
                  onClick={() => handlePurchase(outlet, 90, m3_price)}
                  disabled={loading}
                  className="relative w-full flex items-center justify-between p-3 rounded-lg border border-accent/30 bg-accent/5 hover:bg-accent/10 transition-colors text-left group cursor-pointer disabled:opacity-50"
                >
                  <span className="absolute -top-2 -left-1 px-1.5 py-0.5 bg-accent text-bg text-[9px] font-black tracking-wider rounded-sm rotate-[-3deg] shadow-sm">효율적!</span>
                  <span className="text-[13px] font-semibold text-tx">3개월권</span>
                  <div className="flex flex-col items-end">
                    <span className="text-[10px] text-dim line-through decoration-warn/50">₩{(m1_price * 3).toLocaleString()}</span>
                    <span className="font-mono text-[14px] font-bold text-accent">₩{m3_price.toLocaleString()}</span>
                  </div>
                </button>

                {/* 1 Year */}
                <button 
                  onClick={() => handlePurchase(outlet, 365, m12_price)}
                  disabled={loading}
                  className="relative w-full flex items-center justify-between p-3.5 rounded-lg border border-up/40 bg-up/10 hover:bg-up/20 transition-all duration-300 text-left group overflow-hidden cursor-pointer disabled:opacity-50"
                >
                  {/* Glass Shimmer Effect */}
                  <div className="absolute inset-0 translate-x-[-100%] group-hover:animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-[-20deg]"></div>
                  
                  <span className="absolute -top-2 -right-1 px-2 py-0.5 bg-gradient-to-r from-up to-accent text-white text-[9px] font-black tracking-wider rounded shadow-md z-10">BEST! 20% OFF</span>
                  
                  <span className="text-[14px] font-bold text-white z-10">1년권</span>
                  <div className="flex flex-col items-end z-10">
                    <span className="text-[10px] text-up/60 line-through">₩{(m1_price * 12).toLocaleString()}</span>
                    <span className="font-mono text-[16px] font-black text-up drop-shadow-md">₩{m12_price.toLocaleString()}</span>
                  </div>
                </button>

              </div>
            </div>
          );
        })}
      </div>
      
      {outlets.length === 0 && (
        <div className="text-center py-20 text-muted">
          <p>구독 가능한 언론사가 없습니다.</p>
        </div>
      )}
    </div>
  );
}
