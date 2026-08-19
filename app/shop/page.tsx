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

import { useAuth } from "@/lib/auth/useAuth";

export default function ShopPage() {
  const [activeTab, setActiveTab] = useState<"shop" | "subscriptions">("shop");
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [cash, setCash] = useState<number>(0);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [hasOptionsLicense, setHasOptionsLicense] = useState<boolean>(false);
  const [hasCustomDashboard, setHasCustomDashboard] = useState<boolean>(false);
  const [loading, setLoading] = useState(false);
  const [userSubs, setUserSubs] = useState<Record<string, string>>({});

  const [category, setCategory] = useState<"ALL" | "PERMISSIONS" | "NEWS" | "ITEMS">("ALL");
  const [hasFeeBooster, setHasFeeBooster] = useState<boolean>(false);
  const [hasScanner, setHasScanner] = useState<boolean>(false);
  const [hasAiPredictor, setHasAiPredictor] = useState<boolean>(false);

  const [selectedOutlet, setSelectedOutlet] = useState<Outlet | null>(null);
  const [selectedDays, setSelectedDays] = useState<number>(30);

  const supabase = createClient();
  const { userId, isLoggedIn } = useAuth();

  useEffect(() => {
    const fetchData = async () => {
      if (isLoggedIn && userId) {
        const { data: profile } = await supabase.from('profiles').select('cash, is_admin, has_options_license, unlocked_features, news_subscriptions').eq('id', userId).single();
        if (profile) {
          setCash(Number(profile.cash || 0));
          const adminFlag = profile.is_admin || false;
          setIsAdmin(adminFlag);
          setHasOptionsLicense(adminFlag || profile.has_options_license || false);
          const unlocked = (profile.unlocked_features as string[]) || [];
          setHasCustomDashboard(adminFlag || unlocked.includes("custom_dashboard"));
          setHasFeeBooster(adminFlag || unlocked.includes("fee_booster"));
          setHasScanner(adminFlag || unlocked.includes("scanner_item"));
          setHasAiPredictor(adminFlag || unlocked.includes("ai_predictor"));
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
  }, [supabase, isLoggedIn, userId]);

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
      alert("⚠️ 예수금(골드)이 부족합니다.");
      return;
    }

    const months = selectedDays / 30;
    if (!confirm(`[${selectedOutlet.name}] ${months}개월 정보 구독권을 구매하시겠습니까?\n결제 금액: ₩${price.toLocaleString()}`)) return;

    setLoading(true);
    try {
      const { data: profile } = await supabase.from('profiles').select('cash, news_subscriptions').eq('id', userId).single();
      if (!profile || Number(profile.cash || 0) < price) {
        throw new Error("예수금이 부족합니다.");
      }

      const currentSubs = (profile.news_subscriptions as Record<string, string>) || {};
      const now = new Date();
      now.setDate(now.getDate() + selectedDays);
      const newExpiry = now.toISOString();
      currentSubs[String(selectedOutlet.id)] = newExpiry;

      const { error: profileErr } = await supabase
        .from('profiles')
        .update({
          cash: Number(profile.cash) - price,
          news_subscriptions: currentSubs
        })
        .eq('id', userId);

      if (profileErr) throw profileErr;

      setCash(prev => prev - price);
      setUserSubs(prev => ({ ...prev, [String(selectedOutlet.id)]: newExpiry }));

      alert(`성공적으로 ${selectedOutlet.name} 구독권을 결제했습니다.`);
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
    if (cash < price) { alert("⚠️ 예수금이 부족합니다. (필요 금액: ₩5,000,000)"); return; }

    if (!confirm(`[파생상품] 파생상품 옵션 거래 자격증을 결제하시겠습니까?\n결제 금액: ₩${price.toLocaleString()}`)) return;

    setLoading(true);
    try {
      const { data: profile } = await supabase.from('profiles').select('cash').eq('id', userId).single();
      if (!profile || Number(profile.cash || 0) < price) {
        throw new Error("예수금이 부족합니다.");
      }

      const { error: profileErr } = await supabase
        .from('profiles')
        .update({
          cash: Number(profile.cash) - price,
          has_options_license: true
        })
        .eq('id', userId);

      if (profileErr) throw profileErr;

      setCash(prev => prev - price);
      setHasOptionsLicense(true);
      alert("파생상품 옵션 거래 자격증을 정상 취득했습니다.");
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
    if (cash < price) { alert("⚠️ 예수금이 부족합니다. (필요 금액: ₩3,000,000)"); return; }

    if (!confirm(`[플랫폼] 메인 대시보드 커스텀 라이선스를 구매하시겠습니까?\n결제 금액: ₩${price.toLocaleString()}`)) return;

    setLoading(true);
    try {
      const { data: profile } = await supabase.from('profiles').select('cash, unlocked_features').eq('id', userId).single();
      if (!profile || Number(profile.cash || 0) < price) {
        throw new Error("예수금이 부족합니다.");
      }
      const currentUnlocked = (profile?.unlocked_features as string[]) || [];
      
      if (!currentUnlocked.includes("custom_dashboard")) {
        currentUnlocked.push("custom_dashboard");
      }

      const { error: profileErr } = await supabase
        .from('profiles')
        .update({ 
          cash: Number(profile.cash) - price,
          unlocked_features: currentUnlocked 
        })
        .eq('id', userId);

      if (profileErr) throw profileErr;

      setCash(prev => prev - price);
      setHasCustomDashboard(true);
      alert("메인 대시보드 커스텀 라이선스를 구매했습니다.");
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
    if (cash < price) { alert("⚠️ 예수금이 부족합니다."); return; }
    if (!confirm("[혜택] 거래 수수료 50% 감면 부스터(30일)를 활성화하시겠습니까?\n결제 금액: ₩1,000,000")) return;
    
    setLoading(true);
    try {
      const { data: profile } = await supabase.from('profiles').select('cash, unlocked_features').eq('id', userId).single();
      if (!profile || Number(profile.cash || 0) < price) {
        throw new Error("예수금이 부족합니다.");
      }
      const currentUnlocked = (profile?.unlocked_features as string[]) || [];
      if (!currentUnlocked.includes("fee_booster")) {
        currentUnlocked.push("fee_booster");
      }

      const { error: profileErr } = await supabase
        .from('profiles')
        .update({
          cash: Number(profile.cash) - price,
          unlocked_features: currentUnlocked
        })
        .eq('id', userId);

      if (profileErr) throw profileErr;

      setCash(prev => prev - price);
      setHasFeeBooster(true);
      alert("수수료 50% 감면 부스터가 활성화되었습니다.");
    } catch (e: any) {
      console.error(e);
      alert("구매 실패: " + (e.message || "알 수 없는 오류"));
    } finally {
      setLoading(false);
    }
  };

  const handleScannerPurchase = async () => {
    if (!userId || loading) return;
    const price = 2000000;
    if (cash < price) { alert("⚠️ 예수금이 부족합니다."); return; }
    if (!confirm("[분석] 기관 수급 실시간 스캐너(30일)를 구매하시겠습니까?\n결제 금액: ₩2,000,000")) return;
    
    setLoading(true);
    try {
      const { data: profile } = await supabase.from('profiles').select('cash, unlocked_features').eq('id', userId).single();
      if (!profile || Number(profile.cash || 0) < price) {
        throw new Error("예수금이 부족합니다.");
      }
      const currentUnlocked = (profile?.unlocked_features as string[]) || [];
      if (!currentUnlocked.includes("scanner_item")) {
        currentUnlocked.push("scanner_item");
      }

      const { error: profileErr } = await supabase
        .from('profiles')
        .update({
          cash: Number(profile.cash) - price,
          unlocked_features: currentUnlocked
        })
        .eq('id', userId);

      if (profileErr) throw profileErr;

      setCash(prev => prev - price);
      setHasScanner(true);
      alert("기관 수급 실시간 스캐너가 활성화되었습니다.");
    } catch (e: any) {
      console.error(e);
      alert("구매 실패: " + (e.message || "알 수 없는 오류"));
    } finally {
      setLoading(false);
    }
  };

  const handleAiPredictorPurchase = async () => {
    if (!userId || loading) return;
    const price = 1500000;
    if (cash < price) { alert("⚠️ 예수금이 부족합니다."); return; }
    if (!confirm("[분석] AI 시황 예측 신호 부스터(30일)를 구매하시겠습니까?\n결제 금액: ₩1,500,000")) return;
    
    setLoading(true);
    try {
      const { data: profile } = await supabase.from('profiles').select('cash, unlocked_features').eq('id', userId).single();
      if (!profile || Number(profile.cash || 0) < price) {
        throw new Error("예수금이 부족합니다.");
      }
      const currentUnlocked = (profile?.unlocked_features as string[]) || [];
      if (!currentUnlocked.includes("ai_predictor")) {
        currentUnlocked.push("ai_predictor");
      }

      const { error: profileErr } = await supabase
        .from('profiles')
        .update({
          cash: Number(profile.cash) - price,
          unlocked_features: currentUnlocked
        })
        .eq('id', userId);

      if (profileErr) throw profileErr;

      setCash(prev => prev - price);
      setHasAiPredictor(true);
      alert("AI 시황 예측 부스터가 활성화되었습니다.");
    } catch (e: any) {
      console.error(e);
      alert("구매 실패: " + (e.message || "알 수 없는 오류"));
    } finally {
      setLoading(false);
    }
  };

  // Purchased items list
  const purchasedItemsList = [];
  if (hasOptionsLicense) {
    purchasedItemsList.push({
      id: "options-license",
      name: "파생상품 옵션 거래 자격증",
      category: "권한 라이선스",
      desc: "콜/풋 옵션 매수·매도 시장 영구 접근",
      expiry: "영구 소장"
    });
  }
  if (hasCustomDashboard) {
    purchasedItemsList.push({
      id: "custom-dashboard",
      name: "메인 대시보드 커스텀 해금권",
      category: "권한 라이선스",
      desc: "지수 HUD 및 자유 위젯 배치 해금",
      expiry: "영구 소장"
    });
  }
  if (hasFeeBooster) {
    purchasedItemsList.push({
      id: "fee-booster",
      name: "거래 수수료 50% 감면권",
      category: "트레이딩 부스터",
      desc: "30일간 거래 수수료 50% 자동 할인",
      expiry: "30일 유효"
    });
  }
  if (hasScanner) {
    purchasedItemsList.push({
      id: "scanner-item",
      name: "기관 수급 실시간 스캐너",
      category: "분석 솔루션",
      desc: "세력/기관 순매수 수급 스캐너 모니터링",
      expiry: "30일 유효"
    });
  }
  if (hasAiPredictor) {
    purchasedItemsList.push({
      id: "ai-booster",
      name: "AI 시황 예측 부스터",
      category: "분석 솔루션",
      desc: "AI 호재/악재 사건 예측 신호 포착",
      expiry: "30일 유효"
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
          name: `${outlet.name} 미디어 터미널`,
          category: "정보 터미널",
          desc: outlet.description,
          expiry: isAdmin ? "SUPER ADMIN 영구" : `${expiryStr.split("T")[0]} (${dday}일 남음)`
        });
      }
    }
  });

  return (
    <div className="min-h-screen bg-[#0C0E12] text-[#F3F4F6] font-sans pb-20">
      
      {/* 1. MINIMAL FINTECH HEADER */}
      <header className="h-16 border-b border-white/10 bg-[#0C0E12] px-6 flex items-center justify-between sticky top-0 z-20 backdrop-blur-md">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-5 bg-[#3182F6] rounded-full"></div>
            <h1 className="text-lg font-bold text-white tracking-tight">
              트레이딩 솔루션 & 구독 상점
            </h1>
          </div>

          <nav className="flex items-center gap-2 bg-[#151821] p-1 rounded-xl border border-white/5">
            <button
              onClick={() => setActiveTab("shop")}
              className={`px-4 py-1.5 rounded-lg text-[13px] font-medium transition-all ${
                activeTab === "shop"
                  ? "bg-[#1C1C1E] text-white font-bold shadow-sm"
                  : "text-[#9CA3AF] hover:text-white"
              }`}
            >
              플랫폼 상품
            </button>
            <button
              onClick={() => setActiveTab("subscriptions")}
              className={`px-4 py-1.5 rounded-lg text-[13px] font-medium transition-all flex items-center gap-1.5 ${
                activeTab === "subscriptions"
                  ? "bg-[#1C1C1E] text-white font-bold shadow-sm"
                  : "text-[#9CA3AF] hover:text-white"
              }`}
            >
              보유 내역
              {purchasedItemsList.length > 0 && (
                <span className="px-1.5 py-0.2 text-[10px] bg-[#3182F6] text-white font-mono rounded-full font-bold">
                  {purchasedItemsList.length}
                </span>
              )}
            </button>
          </nav>
        </div>

        {/* Balance HUD */}
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-[#9CA3AF]">보유 예수금</span>
          <span className="font-mono font-bold text-[15px] text-white tabular-nums bg-[#151821] px-3 py-1 rounded-lg border border-white/5">
            ₩{cash.toLocaleString()}
          </span>
        </div>
      </header>

      {/* VIEW 1: SHOP TAB */}
      {activeTab === "shop" && (
        <div className="max-w-6xl mx-auto px-6 pt-8 space-y-8">
          
          {/* Header Description */}
          <div className="flex items-end justify-between border-b border-white/5 pb-5">
            <div>
              <h2 className="text-xl font-bold text-white tracking-tight">
                프리미엄 핀테크 플랜 & 터미널 구독
              </h2>
              <p className="text-[13px] text-[#9CA3AF] mt-1">
                기관급 파생상품 인프라부터 미디어 정보망 터미널까지 투명하고 미니멀한 요금으로 이용하세요.
              </p>
            </div>

            {/* Category Filter Pills */}
            <div className="flex items-center gap-1.5 bg-[#151821] p-1 rounded-xl border border-white/5">
              {[
                { id: "ALL", label: "전체" },
                { id: "PERMISSIONS", label: "거래 라이선스" },
                { id: "NEWS", label: "정보 터미널" },
                { id: "ITEMS", label: "트레이딩 부스터" }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setCategory(tab.id as any)}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                    category === tab.id
                      ? "bg-[#3182F6] text-white font-bold"
                      : "text-[#9CA3AF] hover:text-white"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Pricing Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">

            {/* PERMISSIONS */}
            {(category === "ALL" || category === "PERMISSIONS") && (
              <>
                <PricingCard
                  badge="영구 라이선스"
                  title="파생상품 옵션 거래 자격증"
                  desc="콜/풋 옵션 시장 100% 매수·매도 영구 접근권"
                  price={5000000}
                  isUnlocked={hasOptionsLicense}
                  onPurchase={handleOptionsLicensePurchase}
                  loading={loading}
                  features={[
                    "콜(Call) & 풋(Put) 옵션 거래소 접근",
                    "옵션 그리스(Delta, Gamma) 지표 실시간 제공",
                    "기관 월브레이커 감마 스퀴즈 전략 연동"
                  ]}
                />

                <PricingCard
                  badge="플랫폼 라이선스"
                  title="메인 대시보드 커스텀 해금"
                  desc="메인 화면 지수 HUD 및 자유 위젯 배치 지원"
                  price={3000000}
                  isUnlocked={hasCustomDashboard}
                  onPurchase={handleCustomDashboardPurchase}
                  loading={loading}
                  features={[
                    "글로벌 증시 지수 HUD 상단 고정",
                    "관심 종목 및 호가창 커스텀 레이아웃",
                    "기관 순매수 수급 파이프라인 연동"
                  ]}
                />
              </>
            )}

            {/* NEWS TERMINALS */}
            {(category === "ALL" || category === "NEWS") && (
              outlets.map(outlet => {
                const isSubscribed = isAdmin || !!userSubs[String(outlet.id)];
                return (
                  <PricingCard
                    key={outlet.id}
                    badge={outlet.type === "MACRO" ? "거시경제 터미널" : "기업 정보 터미널"}
                    title={outlet.name}
                    desc={`${outlet.description} (신뢰도 ${outlet.reliability}%)`}
                    price={outlet.subscription_fee}
                    isUnlocked={isSubscribed}
                    onPurchase={() => {
                      if (isSubscribed) return;
                      setSelectedOutlet(outlet);
                      setSelectedDays(30);
                    }}
                    loading={loading}
                    buttonText={isSubscribed ? "구독 중" : "구독 기간 선택"}
                    features={[
                      `신뢰도 ${outlet.reliability}% 정량 분석 데이터`,
                      `뉴스 & 찌라시 라운지 본문 블러 해금`,
                      `Gemini AI 실시간 속보 푸시 알림`
                    ]}
                  />
                );
              })
            )}

            {/* ITEMS / BOOSTERS */}
            {(category === "ALL" || category === "ITEMS") && (
              <>
                <PricingCard
                  badge="30일 부스터"
                  title="거래 수수료 50% 감면권"
                  desc="30일 동안 주식 매수/매도 수수료 50% 자동 할인"
                  price={1000000}
                  isUnlocked={hasFeeBooster}
                  onPurchase={handleFeeBoosterPurchase}
                  loading={loading}
                  features={[
                    "매수 / 매도 체결 수수료 50% 감면",
                    "고빈도 스캘핑 매매 시 수수료 절감 효과",
                    "30일간 자동 적용"
                  ]}
                />

                <PricingCard
                  badge="30일 부스터"
                  title="기관 수급 실시간 스캐너"
                  desc="세력/기관 순매수 포트폴리오 실시간 스캔"
                  price={2000000}
                  isUnlocked={hasScanner}
                  onPurchase={handleScannerPurchase}
                  loading={loading}
                  features={[
                    "연기금/헤지펀드 수급 흐름 실시간 포착",
                    "스마트머니 순매수 순위 대시보드 제공",
                    "30일간 모니터링 라이선스"
                  ]}
                />

                <PricingCard
                  badge="30일 부스터"
                  title="AI 시황 예측기"
                  desc="AI 호재/악재 사건 예측 타겟 신호 포착"
                  price={1500000}
                  isUnlocked={hasAiPredictor}
                  onPurchase={handleAiPredictorPurchase}
                  loading={loading}
                  features={[
                    "Gemini AI 호재/악재 수치화 타겟 신호",
                    "변동성 이벤트 사전 감지 레이더",
                    "30일간 예측 신호 활성화"
                  ]}
                />
              </>
            )}

          </div>
        </div>
      )}

      {/* VIEW 2: SUBSCRIPTION & PURCHASED ITEMS TAB */}
      {activeTab === "subscriptions" && (
        <div className="max-w-4xl mx-auto px-6 pt-8 space-y-6">
          <div className="border-b border-white/5 pb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-white">
                보유 라이선스 및 구독 현황
              </h2>
              <p className="text-[13px] text-[#9CA3AF] mt-0.5">
                현재 계정에서 이용 중인 영구 거래 라이선스 및 터미널 구독 내역입니다.
              </p>
            </div>
            <span className="text-[12px] font-mono font-bold text-[#3182F6] bg-[#151821] px-3 py-1 rounded-lg border border-white/5">
              총 {purchasedItemsList.length}개 보유
            </span>
          </div>

          {purchasedItemsList.length === 0 ? (
            <div className="p-12 text-center border border-white/5 bg-[#151821] rounded-2xl space-y-3">
              <h3 className="text-base font-bold text-white">보유 중인 상품이 없습니다</h3>
              <p className="text-[13px] text-[#9CA3AF] max-w-sm mx-auto">
                플랫폼 상품 탭에서 트레이딩 솔루션 및 미디어 터미널을 이용해보세요.
              </p>
              <button
                onClick={() => setActiveTab("shop")}
                className="mt-2 px-4 py-2 bg-[#3182F6] text-white font-bold text-[13px] rounded-xl hover:bg-[#3182F6]/90 transition"
              >
                상품 목록 둘러보기
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {purchasedItemsList.map((item) => (
                <div key={item.id} className="p-5 border border-white/10 bg-[#151821] rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-bold text-[#3182F6] bg-[#3182F6]/10 border border-[#3182F6]/20 px-2 py-0.5 rounded-md">
                      {item.category}
                    </span>
                    <span className="text-[11px] font-mono text-emerald-400 flex items-center gap-1 font-bold">
                      ● 활성화
                    </span>
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-white">{item.name}</h3>
                    <p className="text-[12.5px] text-[#9CA3AF] mt-1">{item.desc}</p>
                  </div>

                  <div className="pt-3 border-t border-white/5 flex items-center justify-between text-[12px] font-mono">
                    <span className="text-[#6B7280]">상태:</span>
                    <span className="text-white font-bold">{item.expiry}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* SUBSCRIPTION DURATION SELECTION MODAL */}
      {selectedOutlet && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#151821] border border-white/10 p-6 rounded-2xl space-y-5 shadow-2xl">
            
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div>
                <span className="text-[11px] font-mono font-bold text-[#3182F6]">
                  MEDIA TERMINAL SUBSCRIPTION
                </span>
                <h3 className="text-lg font-bold text-white mt-0.5">
                  {selectedOutlet.name}
                </h3>
              </div>
              <button 
                onClick={() => setSelectedOutlet(null)}
                className="text-[#6B7280] hover:text-white text-base"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5">
              <label className="block text-[12px] text-[#9CA3AF]">
                구독 기간 선택:
              </label>

              {[
                { days: 30, label: "1개월 (30일)", discount: null, price: selectedOutlet.subscription_fee },
                { days: 90, label: "3개월 (90일)", discount: "5% OFF", price: Math.round(selectedOutlet.subscription_fee * 3 * 0.95) },
                { days: 365, label: "1년 (365일)", discount: "20% OFF", price: Math.round(selectedOutlet.subscription_fee * 12 * 0.8) }
              ].map(opt => (
                <div 
                  key={opt.days}
                  onClick={() => setSelectedDays(opt.days)}
                  className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                    selectedDays === opt.days
                      ? "border-[#3182F6] bg-[#3182F6]/10 text-white font-bold"
                      : "border-white/5 bg-[#1C1C1E] text-[#9CA3AF] hover:border-white/20"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[13px]">{opt.label}</span>
                    {opt.discount && (
                      <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.2 rounded font-mono font-bold">
                        {opt.discount}
                      </span>
                    )}
                  </div>
                  <span className="font-mono font-bold text-white text-[14px] tabular-nums">
                    ₩{opt.price.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-white/10 pt-4">
              <button
                onClick={() => setSelectedOutlet(null)}
                className="px-4 py-2 text-[13px] text-[#9CA3AF] hover:text-white rounded-xl border border-white/10"
              >
                취소
              </button>
              <button
                onClick={executeNewsPurchase}
                disabled={loading}
                className="px-5 py-2 bg-[#3182F6] hover:bg-[#3182F6]/90 text-white font-bold text-[13px] rounded-xl transition shadow-md"
              >
                결제 진행하기
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

/* Minimal Fintech Pricing Card Component */
function PricingCard({
  badge,
  title,
  desc,
  price,
  isUnlocked,
  onPurchase,
  loading,
  buttonText = "구매하기",
  features = []
}: {
  badge: string;
  title: string;
  desc: string;
  price: number;
  isUnlocked: boolean;
  onPurchase: () => void;
  loading: boolean;
  buttonText?: string;
  features?: string[];
}) {
  return (
    <div className="bg-[#151821] border border-white/10 rounded-2xl p-6 flex flex-col justify-between transition-all hover:bg-[#181B26] hover:border-white/20">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold text-[#3182F6] bg-[#3182F6]/10 border border-[#3182F6]/20 px-2.5 py-0.5 rounded-md">
            {badge}
          </span>
          {isUnlocked && (
            <span className="text-[11px] font-mono text-emerald-400 font-bold">
              ● 보유 중
            </span>
          )}
        </div>

        <div>
          <h3 className="text-lg font-bold text-white tracking-tight">{title}</h3>
          <p className="text-[12.5px] text-[#9CA3AF] mt-1 leading-relaxed">{desc}</p>
        </div>

        <div className="pt-2 border-t border-white/5">
          <div className="text-[11px] text-[#6B7280] uppercase tracking-wider mb-1">이용 금액</div>
          <div className="font-mono text-2xl font-bold text-white tabular-nums">
            ₩{price.toLocaleString()}
          </div>
        </div>

        {features.length > 0 && (
          <ul className="space-y-2 pt-2 text-[12px] text-[#9CA3AF]">
            {features.map((f, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="text-[#3182F6] font-bold">✓</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pt-6">
        <button
          onClick={onPurchase}
          disabled={isUnlocked || loading}
          className={`w-full py-2.5 rounded-xl font-bold text-[13px] transition-all ${
            isUnlocked
              ? "bg-[#1C1C1E] text-[#6B7280] cursor-default border border-white/5"
              : "bg-[#3182F6] hover:bg-[#3182F6]/90 text-white cursor-pointer shadow-md"
          }`}
        >
          {isUnlocked ? "이미 이용 중" : buttonText}
        </button>
      </div>
    </div>
  );
}
