"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Outlet = {
  id: number;
  name: string;
  type: string;
  reliability: number;
  subscription_fee: number;
  description: string;
};

// Helper for D-day calculation
function getDday(expiryStr: string) {
  const expiry = new Date(expiryStr);
  const now = new Date();
  const diffTime = expiry.getTime() - now.getTime();
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
}

export default function ShopPage() {
  const [activeTab, setActiveTab] = useState<"shop" | "subscriptions">("shop");
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [cash, setCash] = useState<number>(0);
  const [userId, setUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [hasOptionsLicense, setHasOptionsLicense] = useState<boolean>(false);
  const [hasCustomDashboard, setHasCustomDashboard] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [userSubs, setUserSubs] = useState<Record<string, string>>({});

  // Countdown timer state
  const [timerStr, setTimerStr] = useState("04:12:09");

  const [category, setCategory] = useState<"ALL" | "PERMISSIONS" | "NEWS" | "ITEMS">("ALL");
  const [hasFeeBooster, setHasFeeBooster] = useState<boolean>(false);
  const [hasScanner, setHasScanner] = useState<boolean>(false);
  const [hasAiPredictor, setHasAiPredictor] = useState<boolean>(false);

  const [selectedOutlet, setSelectedOutlet] = useState<Outlet | null>(null);
  const [selectedDays, setSelectedDays] = useState<number>(30); // Default 30 days

  const supabase = createClient();

  useEffect(() => {
    const fetchData = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUserId(session.user.id);
        const { data: portfolio } = await supabase.from('portfolios').select('cash_balance').eq('user_id', session.user.id).single();
        if (portfolio) {
          setCash(portfolio.cash_balance || 0);
        }
        const { data: profile } = await supabase.from('profiles').select('is_admin, has_options_license, unlocked_features, news_subscriptions').eq('id', session.user.id).single();
        if (profile) {
          const adminFlag = profile.is_admin || false;
          setIsAdmin(adminFlag);
          setHasOptionsLicense(adminFlag || profile.has_options_license || false);
          const unlocked = (profile.unlocked_features as string[]) || [];
          setHasCustomDashboard(adminFlag || unlocked.includes("custom_dashboard"));
          if (profile.news_subscriptions) {
            setUserSubs(profile.news_subscriptions as Record<string, string>);
          }
        }
      }

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

    // Timer interval
    const interval = setInterval(() => {
      const now = new Date();
      const h = String(23 - now.getHours()).padStart(2, '0');
      const m = String(59 - now.getMinutes()).padStart(2, '0');
      const s = String(59 - now.getSeconds()).padStart(2, '0');
      setTimerStr(`${h}:${m}:${s}`);
    }, 1000);

    return () => clearInterval(interval);
  }, [supabase]);

  // Handle News Purchase Execution
  const executeNewsPurchase = async () => {
    if (!selectedOutlet || !userId || loading) return;

    let price = selectedOutlet.subscription_fee;
    if (selectedDays === 90) {
      price = Math.round(selectedOutlet.subscription_fee * 3 * 0.95);
    } else if (selectedDays === 365) {
      price = Math.round(selectedOutlet.subscription_fee * 12 * 0.8);
    }

    if (cash < price) {
      alert("⚠️ 보유 골드(예수금)가 부족합니다.");
      return;
    }

    const months = selectedDays / 30;
    if (!confirm(`[${selectedOutlet.name}] ${months}개월 구독 주문서를 구매하시겠습니까?\n결제 금액: ₩${price.toLocaleString()}`)) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('purchase_news_subscription_v2', {
        user_uuid: userId,
        agency_id: String(selectedOutlet.id),
        total_price: price,
        add_days: selectedDays
      });

      if (error) throw error;
      if (!data) throw new Error("잔액 부족 또는 결제 실패");

      setCash(prev => prev - price);
      
      // Update local subs state
      const now = new Date();
      now.setDate(now.getDate() + selectedDays);
      const newExpiry = now.toISOString();
      setUserSubs(prev => ({ ...prev, [String(selectedOutlet.id)]: newExpiry }));

      alert(`성공적으로 ${selectedOutlet.name} 구독권을 구매했습니다! 뉴스 탭에서 확인하세요.`);
      setSelectedOutlet(null);
    } catch (e: any) {
      console.error(e);
      alert("구매 실패: " + (e.message || "알 수 없는 오류"));
    } finally {
      setLoading(false);
    }
  };

  const handleOptionsLicensePurchase = async () => {
    if (!userId || loading) return;
    const price = 5000000;
    if (cash < price) {
      alert("⚠️ 보유 골드가 부족합니다. (필요 골드: ₩5,000,000)");
      return;
    }

    if (!confirm(`[전설] 파생상품 옵션 거래 자격증을 구매하시겠습니까?\n결제 금액: ₩${price.toLocaleString()}`)) return;

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('purchase_options_license', {
        user_uuid: userId,
        price: price
      });

      if (error) throw error;
      if (!data) throw new Error("잔액 부족 또는 결제 실패");

      setCash(prev => prev - price);
      setHasOptionsLicense(true);
      alert("🎉 파생상품 옵션 거래 자격증을 성공적으로 취득했습니다!");
    } catch (e: any) {
      console.error(e);
      alert("구매 실패: " + (e.message || "알 수 없는 오류"));
    } finally {
      setLoading(false);
    }
  };

  const handleCustomDashboardPurchase = async () => {
    if (!userId || loading) return;
    const price = 3000000;
    if (cash < price) {
      alert("⚠️ 보유 골드가 부족합니다. (필요 골드: ₩3,000,000)");
      return;
    }

    if (!confirm(`[희귀] 메인 대시보드 커스텀 해금권을 구매하시겠습니까?\n결제 금액: ₩${price.toLocaleString()}`)) return;

    setLoading(true);
    try {
      const { data: profile } = await supabase.from('profiles').select('unlocked_features').eq('id', userId).single();
      const currentUnlocked = (profile?.unlocked_features as string[]) || [];
      
      if (!currentUnlocked.includes("custom_dashboard")) {
        currentUnlocked.push("custom_dashboard");
      }

      const { error: portfolioErr } = await supabase
        .from('portfolios')
        .update({ cash_balance: cash - price })
        .eq('user_id', userId);
      
      if (portfolioErr) throw portfolioErr;

      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ unlocked_features: currentUnlocked })
        .eq('id', userId);

      if (profileErr) throw profileErr;

      setCash(prev => prev - price);
      setHasCustomDashboard(true);
      alert("🎉 메인 대시보드 커스텀 해금권을 성공적으로 구매했습니다!");
    } catch (e: any) {
      console.error(e);
      alert("구매 실패: " + (e.message || "알 수 없는 오류"));
    } finally {
      setLoading(false);
    }
  };

  const handleFeeBoosterPurchase = async () => {
    if (!userId || loading) return;
    const price = 1000000;
    if (cash < price) { alert("⚠️ 보유 골드가 부족합니다."); return; }
    if (!confirm("[아이템] 수수료 50% 감면 부스터(30일)를 구매하시겠습니까?\n결제 금액: ₩1,000,000")) return;
    setCash(prev => prev - price);
    setHasFeeBooster(true);
    alert("🎉 수수료 50% 감면 부스터가 활성화되었습니다!");
  };

  const handleScannerPurchase = async () => {
    if (!userId || loading) return;
    const price = 2000000;
    if (cash < price) { alert("⚠️ 보유 골드가 부족합니다."); return; }
    if (!confirm("[아이템] 기관 수급 실시간 스캐너(30일)를 구매하시겠습니까?\n결제 금액: ₩2,000,000")) return;
    setCash(prev => prev - price);
    setHasScanner(true);
    alert("🎉 기관 수급 실시간 스캐너가 활성화되었습니다!");
  };

  const handleAiPredictorPurchase = async () => {
    if (!userId || loading) return;
    const price = 1500000;
    if (cash < price) { alert("⚠️ 보유 골드가 부족합니다."); return; }
    if (!confirm("[아이템] AI 시황 예측 부스터(30일)를 구매하시겠습니까?\n결제 금액: ₩1,500,000")) return;
    setCash(prev => prev - price);
    setHasAiPredictor(true);
    alert("🎉 AI 시황 예측 부스터가 활성화되었습니다!");
  };

  // Purchased items list calculation
  const purchasedItemsList = [];
  if (hasOptionsLicense) {
    purchasedItemsList.push({
      id: "options-license",
      name: "파생상품 옵션 거래 자격증",
      type: "권한 (라이선스)",
      desc: "콜/풋 옵션 매수·매도 시장 100% 영구 접근 권한",
      icon: "⭐",
      expiry: "영구 소장",
      status: "ACTIVE"
    });
  }
  if (hasCustomDashboard) {
    purchasedItemsList.push({
      id: "custom-dashboard",
      name: "메인 대시보드 커스텀 해금권",
      type: "권한 (라이선스)",
      desc: "메인 화면 지수 HUD 및 자유 위젯 배치 해금",
      icon: "🪄",
      expiry: "영구 소장",
      status: "ACTIVE"
    });
  }
  if (hasFeeBooster) {
    purchasedItemsList.push({
      id: "fee-booster",
      name: "수수료 50% 감면 부스터",
      type: "아이템 (부스터)",
      desc: "30일간 거래 수수료 50% 감면 혜택 적용",
      icon: "⚡",
      expiry: "30일 활성화 중",
      status: "ACTIVE"
    });
  }
  if (hasScanner) {
    purchasedItemsList.push({
      id: "scanner-item",
      name: "기관 수급 실시간 스캐너",
      type: "아이템 (부스터)",
      desc: "30일간 기관/세력 순매수 실시간 모니터링 해금",
      icon: "📡",
      expiry: "30일 활성화 중",
      status: "ACTIVE"
    });
  }
  if (hasAiPredictor) {
    purchasedItemsList.push({
      id: "ai-booster",
      name: "AI 시황 예측 부스터",
      type: "아이템 (부스터)",
      desc: "30일간 AI 호재/악재 예측 타겟 신호 포착",
      icon: "🔮",
      expiry: "30일 활성화 중",
      status: "ACTIVE"
    });
  }
  outlets.forEach(outlet => {
    const outletIdStr = String(outlet.id);
    const expiryStr = userSubs[outletIdStr];
    if (isAdmin || expiryStr) {
      const dday = expiryStr ? getDday(expiryStr) : -1;
      if (isAdmin || dday >= 0) {
        purchasedItemsList.push({
          id: `sub-${outlet.id}`,
          name: `${outlet.name} 미디어 구독권`,
          type: "뉴스 (정보망)",
          desc: outlet.description,
          icon: outlet.type === "MACRO" ? "💎" : "📦",
          expiry: isAdmin ? "무제한 (SUPER ADMIN)" : `만료일: ${expiryStr.split("T")[0]} (${dday}일 남음)`,
          status: "ACTIVE"
        });
      }
    }
  });

  return (
    <div className="min-h-screen bg-[#060608] text-gray-200 font-sans select-none pb-20">
      
      {/* 1. TOP HEADER NAVIGATION BAR */}
      <header className="h-16 border-b border-[#1f2128] bg-[#090a0d] px-6 flex items-center justify-between">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏪</span>
            <h1 className="text-xl font-black tracking-widest text-[#f5c518] uppercase drop-shadow-[0_0_10px_rgba(245,197,24,0.4)]">
              상점
            </h1>
          </div>
          {/* Navigation Tabs: 상점 & 구독 내역 */}
          <nav className="flex items-center gap-6 text-[14px] font-bold">
            <button
              onClick={() => setActiveTab("shop")}
              className={`flex items-center gap-1.5 pb-1 cursor-pointer transition-all ${
                activeTab === "shop"
                  ? "text-[#f5c518] border-b-2 border-[#f5c518]"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <span>🛒</span>
              <span>상점</span>
            </button>
            
            <button
              onClick={() => setActiveTab("subscriptions")}
              className={`flex items-center gap-1.5 pb-1 cursor-pointer transition-all ${
                activeTab === "subscriptions"
                  ? "text-[#f5c518] border-b-2 border-[#f5c518]"
                  : "text-gray-400 hover:text-white"
              }`}
            >
              <span>📜</span>
              <span>구독 내역</span>
              {purchasedItemsList.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 text-[10px] bg-[#f5c518] text-black font-black rounded-full">
                  {purchasedItemsList.length}
                </span>
              )}
            </button>
          </nav>
        </div>

        {/* Top Right Gold HUD */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 bg-[#12141a] border border-[#2b2e3a] px-4 py-1.5 rounded-full shadow-inner">
            <span className="text-amber-400 font-bold text-xs">💰 보유 예수금</span>
            <span className="font-mono font-black text-[14px] text-[#f5c518] tabular-nums">
              ₩{cash.toLocaleString()}
            </span>
          </div>
        </div>
      </header>

      {/* VIEW 1: SHOP TAB */}
      {activeTab === "shop" && (
        <>
          {/* 2. SUB-BANNER: PREMIUM SHOP & TIMER */}
          <div className="max-w-[1600px] mx-auto px-6 pt-8 pb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#1a1d27] mb-6">
            <div>
              <h2 className="text-2xl md:text-3xl font-black text-[#f5c518] tracking-tight flex items-center gap-2 drop-shadow-[0_0_10px_rgba(245,197,24,0.3)]">
                <span>✨ 프리미엄 정보 상점</span>
              </h2>
              <p className="text-[13px] text-gray-400 mt-1">
                정보의 비대칭이 곧 수급 권력입니다. 파생상품 거래 자격증 및 찌라시 미디어 정보망을 해금하세요.
              </p>
            </div>

            <div className="shrink-0 text-[12px] font-bold text-[#ff44aa] tracking-wider flex items-center gap-2 bg-[#ff44aa]/10 border border-[#ff44aa]/30 px-3.5 py-2 rounded-lg">
              <span>⏱️ 실시간 시황 재입고:</span>
              <span className="text-white font-mono font-black text-[13px]">{timerStr}</span>
            </div>
          </div>

          {/* 3. CATEGORY FILTER BAR */}
          <div className="max-w-[1600px] mx-auto px-6 mb-6">
            <div className="flex items-center gap-2 border-b border-[#1f2230] pb-3 font-bold text-[13px]">
              <button
                onClick={() => setCategory("ALL")}
                className={`px-4 py-2 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 ${
                  category === "ALL"
                    ? "bg-[#f5c518] text-black font-black shadow-[0_0_10px_rgba(245,197,24,0.3)]"
                    : "bg-[#12141a] text-gray-400 hover:text-white border border-[#222736]"
                }`}
              >
                <span>🌐</span>
                <span>전체 상품</span>
              </button>

              <button
                onClick={() => setCategory("PERMISSIONS")}
                className={`px-4 py-2 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 ${
                  category === "PERMISSIONS"
                    ? "bg-[#f5c518] text-black font-black shadow-[0_0_10px_rgba(245,197,24,0.3)]"
                    : "bg-[#12141a] text-gray-400 hover:text-white border border-[#222736]"
                }`}
              >
                <span>🔑</span>
                <span>권한 (라이선스)</span>
              </button>

              <button
                onClick={() => setCategory("NEWS")}
                className={`px-4 py-2 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 ${
                  category === "NEWS"
                    ? "bg-[#f5c518] text-black font-black shadow-[0_0_10px_rgba(245,197,24,0.3)]"
                    : "bg-[#12141a] text-gray-400 hover:text-white border border-[#222736]"
                }`}
              >
                <span>📰</span>
                <span>뉴스 (정보망)</span>
              </button>

              <button
                onClick={() => setCategory("ITEMS")}
                className={`px-4 py-2 rounded-lg cursor-pointer transition-all flex items-center gap-1.5 ${
                  category === "ITEMS"
                    ? "bg-[#f5c518] text-black font-black shadow-[0_0_10px_rgba(245,197,24,0.3)]"
                    : "bg-[#12141a] text-gray-400 hover:text-white border border-[#222736]"
                }`}
              >
                <span>🎒</span>
                <span>아이템 (부스터)</span>
              </button>
            </div>
          </div>

          {/* 4. CARD GRID SYSTEM */}
          <main className="max-w-[1600px] mx-auto px-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-3.5">

              {/* CATEGORY 1: PERMISSIONS (권한) */}
              {(category === "ALL" || category === "PERMISSIONS") && (
                <>
                  <RogueCard
                    rarity="전설"
                    rarityColor="#ffd700"
                    iconSymbol="⭐"
                    title="옵션 거래 자격증"
                    subtitle="파생상품 영구 자격증"
                    description="콜/풋 옵션 매수·매도 시장 100% 영구 해금"
                    price={5000000}
                    rating="⭐⭐⭐"
                    isUnlocked={hasOptionsLicense}
                    onPurchase={handleOptionsLicensePurchase}
                    loading={loading}
                    buttonText={hasOptionsLicense ? "보유 중" : "구매하기"}
                  />

                  <RogueCard
                    rarity="희귀"
                    rarityColor="#00e5ff"
                    iconSymbol="🪄"
                    title="대시보드 해금권"
                    subtitle="대시보드 라이선스"
                    description="메인 화면 위젯 배치 및 시장 지수 HUD 해금"
                    price={3000000}
                    rating="⭐⭐☆"
                    isUnlocked={hasCustomDashboard}
                    onPurchase={handleCustomDashboardPurchase}
                    loading={loading}
                    buttonText={hasCustomDashboard ? "보유 중" : "구매하기"}
                  />
                </>
              )}

              {/* CATEGORY 2: NEWS (뉴스) */}
              {(category === "ALL" || category === "NEWS") && (
                outlets.map((outlet) => {
                  const isEpic = outlet.type === "MACRO";
                  const isSubscribed = isAdmin || !!userSubs[String(outlet.id)];

                  const rarity = isEpic ? "영웅" : "일반";
                  const rarityColor = isEpic ? "#d000ff" : "#383b48";
                  const iconSymbol = isEpic ? "💎" : "📦";

                  return (
                    <RogueCard
                      key={outlet.id}
                      rarity={rarity}
                      rarityColor={rarityColor}
                      iconSymbol={iconSymbol}
                      title={outlet.name}
                      subtitle="미디어 정보망"
                      description={`${outlet.description} (신뢰도: ${outlet.reliability}%)`}
                      price={outlet.subscription_fee}
                      rating={isEpic ? "⭐⭐⭐" : "⭐☆☆"}
                      isUnlocked={isSubscribed}
                      onPurchase={() => {
                        if (isSubscribed) return;
                        setSelectedOutlet(outlet);
                        setSelectedDays(30);
                      }}
                      loading={loading}
                      buttonText={isSubscribed ? "구독 중" : "구독 기간 선택"}
                    />
                  );
                })
              )}

              {/* CATEGORY 3: ITEMS (아이템/부스터) */}
              {(category === "ALL" || category === "ITEMS") && (
                <>
                  <RogueCard
                    rarity="희귀"
                    rarityColor="#3182F6"
                    iconSymbol="⚡"
                    title="수수료 50% 감면권"
                    subtitle="트레이딩 부스터"
                    description="30일 동안 주식 매수/매도 수수료 50% 자동 감면"
                    price={1000000}
                    rating="⭐⭐☆"
                    isUnlocked={hasFeeBooster}
                    onPurchase={handleFeeBoosterPurchase}
                    loading={loading}
                    buttonText={hasFeeBooster ? "보유 중" : "구매하기"}
                  />

                  <RogueCard
                    rarity="영웅"
                    rarityColor="#d000ff"
                    iconSymbol="📡"
                    title="기관 수급 스캐너"
                    subtitle="수급 분석 부스터"
                    description="30일간 세력/기관 LP의 실시간 순매수 수급 스캐너 해금"
                    price={2000000}
                    rating="⭐⭐⭐"
                    isUnlocked={hasScanner}
                    onPurchase={handleScannerPurchase}
                    loading={loading}
                    buttonText={hasScanner ? "보유 중" : "구매하기"}
                  />

                  <RogueCard
                    rarity="희귀"
                    rarityColor="#00e5ff"
                    iconSymbol="🔮"
                    title="AI 시황 예측기"
                    subtitle="시황 타겟 부스터"
                    description="30일간 AI 호재/악재 사건 타겟 분석 신호 포착"
                    price={1500000}
                    rating="⭐⭐☆"
                    isUnlocked={hasAiPredictor}
                    onPurchase={handleAiPredictorPurchase}
                    loading={loading}
                    buttonText={hasAiPredictor ? "보유 중" : "구매하기"}
                  />
                </>
              )}
            </div>
          </main>
        </>
      )}

      {/* VIEW 2: SUBSCRIPTION & PURCHASED ITEMS TAB */}
      {activeTab === "subscriptions" && (
        <main className="max-w-5xl mx-auto px-6 pt-8 space-y-6">
          <div className="border-b border-[#1a1d27] pb-4 flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-black text-[#f5c518] flex items-center gap-2">
                <span>📜 보유 라이선스 및 구독 내역</span>
              </h2>
              <p className="text-[13px] text-gray-400 mt-1">
                현재 계정에 활성화되어 있는 영구 거래 라이선스 및 미디어 정보망 구독 목록입니다.
              </p>
            </div>
            <div className="px-4 py-2 bg-[#12141a] border border-[#2b2e3a] rounded-lg text-[13px] text-amber-300 font-bold">
              총 {purchasedItemsList.length}개 보유 중
            </div>
          </div>

          {purchasedItemsList.length === 0 ? (
            <div className="p-12 text-center border border-[#222736] bg-[#0d0e14] rounded-xl space-y-3">
              <div className="text-4xl">🛒</div>
              <h3 className="text-lg font-bold text-white">구매한 상품이나 구독 내역이 없습니다</h3>
              <p className="text-[13px] text-gray-400 max-w-sm mx-auto">
                상점 탭에서 필요한 파생상품 자격증 및 미디어 정보망을 해금하여 트레이딩 우위를 확보하세요.
              </p>
              <button
                onClick={() => setActiveTab("shop")}
                className="mt-2 px-5 py-2.5 bg-[#f5c518] text-black font-bold text-[13px] rounded cursor-pointer"
              >
                상점으로 이동하기
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {purchasedItemsList.map((item) => (
                <div key={item.id} className="p-5 border border-[#222736] bg-[#0c0e14] hover:border-[#f5c518]/50 rounded-xl transition-all space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="px-2.5 py-1 text-[10px] font-bold tracking-widest bg-[#f5c518]/10 text-[#f5c518] border border-[#f5c518]/30 rounded">
                      {item.type}
                    </span>
                    <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                      <span>✅</span>
                      <span>활성화</span>
                    </span>
                  </div>

                  <div className="flex items-start gap-3">
                    <span className="text-3xl p-2 bg-[#141722] rounded border border-[#232a3a]">{item.icon}</span>
                    <div>
                      <h3 className="text-lg font-bold text-white">{item.name}</h3>
                      <p className="text-[12px] text-gray-400 leading-relaxed mt-0.5">{item.desc}</p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-[#1f2330] flex items-center justify-between text-[11.5px] text-gray-300 font-mono">
                    <span className="text-gray-400">구독/소장 정보:</span>
                    <span className="font-bold text-amber-300">{item.expiry}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      )}

      {/* 4. NEWS SUBSCRIPTION DURATION SELECTION MODAL */}
      {selectedOutlet && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0d0e14] border-2 border-[#f5c518] p-6 rounded-lg shadow-[0_0_30px_rgba(245,197,24,0.3)] space-y-6">
            
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-[#222736] pb-3">
              <div>
                <span className="text-[10px] font-black tracking-widest text-[#f5c518] uppercase">
                  INTELLIGENCE SUBSCRIPTION
                </span>
                <h3 className="text-xl font-black text-white mt-0.5">
                  📜 {selectedOutlet.name}
                </h3>
              </div>
              <button 
                onClick={() => setSelectedOutlet(null)}
                className="text-gray-400 hover:text-white text-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            {/* Duration Options */}
            <div className="space-y-3 font-sans">
              <label className="block text-[12px] font-bold text-gray-400 mb-2">
                구독 기간 및 할인 혜택을 선택하세요:
              </label>

              {/* 1 Month Option */}
              <div 
                onClick={() => setSelectedDays(30)}
                className={`p-3.5 rounded border cursor-pointer transition-all flex items-center justify-between ${
                  selectedDays === 30
                    ? "border-[#f5c518] bg-[#f5c518]/10 text-white"
                    : "border-[#222736] bg-[#06070a] text-gray-400 hover:border-gray-500"
                }`}
              >
                <div>
                  <div className="font-bold text-[14px]">📜 1개월 (30일) 이용권</div>
                  <div className="text-[11px] text-gray-400">기본 미디어 정보망 구독</div>
                </div>
                <div className="font-mono font-bold text-amber-300">
                  ₩{selectedOutlet.subscription_fee.toLocaleString()}
                </div>
              </div>

              {/* 3 Months Option */}
              <div 
                onClick={() => setSelectedDays(90)}
                className={`p-3.5 rounded border cursor-pointer transition-all flex items-center justify-between ${
                  selectedDays === 90
                    ? "border-[#f5c518] bg-[#f5c518]/10 text-white"
                    : "border-[#222736] bg-[#06070a] text-gray-400 hover:border-gray-500"
                }`}
              >
                <div>
                  <div className="font-bold text-[14px] flex items-center gap-2">
                    <span>📜 3개월 (90일) 이용권</span>
                    <span className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/40 px-1.5 py-0.5 rounded">5% OFF</span>
                  </div>
                  <div className="text-[11px] text-gray-400">실속 중기 뉴스 트래킹</div>
                </div>
                <div className="font-mono font-bold text-purple-300">
                  ₩{Math.round(selectedOutlet.subscription_fee * 3 * 0.95).toLocaleString()}
                </div>
              </div>

              {/* 1 Year Option */}
              <div 
                onClick={() => setSelectedDays(365)}
                className={`p-3.5 rounded border cursor-pointer transition-all flex items-center justify-between ${
                  selectedDays === 365
                    ? "border-[#f5c518] bg-[#f5c518]/10 text-white"
                    : "border-[#222736] bg-[#06070a] text-gray-400 hover:border-gray-500"
                }`}
              >
                <div>
                  <div className="font-bold text-[14px] flex items-center gap-2">
                    <span>📜 1년 (365일) 비전서</span>
                    <span className="text-[10px] bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 px-1.5 py-0.5 rounded">20% OFF</span>
                  </div>
                  <div className="text-[11px] text-gray-400">최대 할인 영구 전용 수급 비전</div>
                </div>
                <div className="font-mono font-bold text-emerald-300">
                  ₩{Math.round(selectedOutlet.subscription_fee * 12 * 0.8).toLocaleString()}
                </div>
              </div>
            </div>

            {/* Modal Action Buttons */}
            <div className="flex items-center justify-end gap-3 border-t border-[#222736] pt-4">
              <button
                onClick={() => setSelectedOutlet(null)}
                className="px-4 py-2 text-[13px] font-bold text-gray-400 hover:text-white rounded border border-[#222736] cursor-pointer"
              >
                취소
              </button>
              <button
                onClick={executeNewsPurchase}
                disabled={loading}
                className="px-6 py-2 bg-[#ffe500] hover:bg-[#fff000] text-black font-black text-[13px] uppercase rounded cursor-pointer shadow-[0_0_15px_rgba(255,229,0,0.4)]"
              >
                💳 구독 결제 진행
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

{/* TALL VERTICAL ROGUE CARD COMPONENT IN KOREAN & CLEAN PRICE FORMAT */}
function RogueCard({
  rarity,
  rarityColor,
  iconSymbol,
  title,
  subtitle,
  description,
  price,
  rating,
  isUnlocked,
  onPurchase,
  loading,
  buttonText
}: {
  rarity: string;
  rarityColor: string;
  iconSymbol: string;
  title: string;
  subtitle: string;
  description: string;
  price: number;
  rating: string;
  isUnlocked: boolean;
  onPurchase: () => void;
  loading: boolean;
  buttonText: string;
}) {
  return (
    <div 
      className="bg-[#090a0d] border-2 flex flex-col justify-between transition-all hover:-translate-y-1 group relative p-3 rounded-xs overflow-hidden"
      style={{ borderColor: rarityColor }}
    >
      {/* Top Bar: Rarity Label + Symbol Icon */}
      <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: rarityColor }}>
        <span>{rarity}</span>
        <span className="text-[11px] opacity-80">{iconSymbol}</span>
      </div>

      {/* Thumbnail Container Frame */}
      <div className="w-full aspect-square bg-[#050608] border border-[#1f222e] rounded-xs mb-3 flex items-center justify-center relative overflow-hidden group-hover:border-white/20 transition-all">
        {/* Ambient Glow */}
        <div 
          className="absolute inset-0 opacity-20 blur-md pointer-events-none"
          style={{ backgroundColor: rarityColor }}
        />
        
        {/* Center Symbol Icon */}
        <div className="relative text-3xl drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]">
          {iconSymbol}
        </div>
      </div>

      {/* Content Info */}
      <div className="space-y-1 mb-3 flex-1 flex flex-col justify-start">
        <h3 className="text-[13px] font-bold text-white tracking-tight leading-tight line-clamp-1 group-hover:text-amber-300 transition-colors">
          {title}
        </h3>
        <p className="text-[10px] text-[#3182F6] font-semibold line-clamp-1">{subtitle}</p>
        <p className="text-[10px] text-gray-400 line-clamp-2 leading-relaxed font-sans mt-0.5">
          {description}
        </p>
      </div>

      {/* Price & Rating Row (Clean ₩ format, No 'O' or '0') */}
      <div className="flex items-center justify-between text-[11px] font-bold mb-3 border-t border-[#1a1c26] pt-2">
        <div className="font-mono text-amber-300 font-bold tabular-nums">
          ₩{price.toLocaleString()}
        </div>
        <div className="text-[9px] text-amber-400/80 font-mono tracking-tighter">
          {rating}
        </div>
      </div>

      {/* Bottom Full-Width Purchase Button */}
      {isUnlocked ? (
        <button 
          disabled
          className="w-full py-2 bg-[#121620] border border-[#232a3a] text-emerald-400 text-[10px] font-bold uppercase tracking-wider rounded-xs cursor-default text-center"
        >
          ✓ {buttonText}
        </button>
      ) : (
        <button
          onClick={onPurchase}
          disabled={loading}
          className="w-full py-2 bg-[#171a24] hover:bg-[#252a3a] active:bg-[#3182F6] border border-[#30364a] hover:border-amber-400/60 text-gray-200 hover:text-white text-[10px] font-bold tracking-widest transition-all cursor-pointer rounded-xs text-center shadow-sm"
        >
          {buttonText}
        </button>
      )}
    </div>
  );
}
