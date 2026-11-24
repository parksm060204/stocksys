"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/db/client";

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
import { hasActiveFeeBooster } from "@/lib/shop/catalog";

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
  const [featureExpiries, setFeatureExpiries] = useState<Record<string, string>>({});
  const [acquiredPassives, setAcquiredPassives] = useState<string[]>([]);

  const [selectedOutlet, setSelectedOutlet] = useState<Outlet | null>(null);
  const [selectedDays, setSelectedDays] = useState<number>(30);

  const db = createClient();
  const { userId, isLoggedIn } = useAuth();
  const fetchSeqRef = useRef<number>(0);
  const activeAccountRef = useRef<string | null>(isLoggedIn && userId ? userId : null);

  useEffect(() => {
    const reqSeq = ++fetchSeqRef.current;
    const nextAccountKey = isLoggedIn && userId ? userId : null;
    activeAccountRef.current = nextAccountKey;

    const resetUserShopState = () => {
      setCash(0);
      setIsAdmin(false);
      setHasOptionsLicense(false);
      setHasCustomDashboard(false);
      setHasFeeBooster(false);
      setHasScanner(false);
      setHasAiPredictor(false);
      setFeatureExpiries({});
      setAcquiredPassives([]);
      setUserSubs({});
      setSelectedOutlet(null);
    };

    // 로그아웃 또는 계정 전환 시 이전 계정의 보유·잔액·권한 상태가 남지 않도록 즉시 초기화
    resetUserShopState();

    const fetchData = async () => {
      if (nextAccountKey) {
        const { data: profile } = await db
          .from('profiles')
          .select('cash, is_admin, has_options_license, unlocked_features, feature_expiries, acquired_passives, news_subscriptions')
          .eq('user_id', nextAccountKey)
          .maybeSingle();
        if (reqSeq !== fetchSeqRef.current || activeAccountRef.current !== nextAccountKey) return;
        if (profile) {
          setCash(Number(profile.cash || 0));
          const adminFlag = Boolean(profile.is_admin);
          setIsAdmin(adminFlag);
          setHasOptionsLicense(adminFlag || Boolean(profile.has_options_license));
          const unlocked = (profile.unlocked_features as string[]) || [];
          const expiries = (profile.feature_expiries as Record<string, string>) || {};
          const nowMs = Date.now();
          const isFeatureValid = (key: string) => {
            if (adminFlag) return true;
            if (!unlocked.includes(key)) return false;
            const exp = expiries[key];
            if (!exp) return true;
            const t = Date.parse(exp);
            return Number.isFinite(t) && t > nowMs;
          };
          setFeatureExpiries(expiries);
          setAcquiredPassives(Array.isArray(profile.acquired_passives) ? profile.acquired_passives : []);
          setHasCustomDashboard(isFeatureValid("custom_dashboard"));
          setHasFeeBooster(adminFlag || hasActiveFeeBooster(profile, nowMs));
          setHasScanner(isFeatureValid("scanner_item"));
          setHasAiPredictor(isFeatureValid("ai_predictor"));
          setUserSubs((profile.news_subscriptions as Record<string, string>) || {});
        } else {
          resetUserShopState();
        }
      }

      const { data: outletData } = await db
        .from('media_outlets')
        .select('*')
        .neq('subscription_fee', 0)
        .order('subscription_fee', { ascending: false });

      if (reqSeq !== fetchSeqRef.current) return;
      if (outletData) {
        setOutlets(outletData as Outlet[]);
      }
    };
    void fetchData();

    return () => {
      fetchSeqRef.current += 1;
    };
  }, [db, isLoggedIn, userId]);

  // Handle News Purchase Execution
  const executeNewsPurchase = async () => {
    if (!selectedOutlet || !isLoggedIn || !userId || loading) return;
    const purchaseAccount = userId;
    const purchaseSeq = fetchSeqRef.current;

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
      const res = await fetch('/api/shop/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemType: 'news_subscription',
          outletId: selectedOutlet.id,
          days: selectedDays,
        }),
      });
      const data = await res.json();
      if (activeAccountRef.current !== purchaseAccount || fetchSeqRef.current !== purchaseSeq) return;
      if (!res.ok || !data.success) {
        throw new Error(data.message || '구매에 실패했습니다.');
      }

      setCash(Number(data.cash));
      if (data.news_subscriptions) {
        setUserSubs(data.news_subscriptions as Record<string, string>);
      }

      alert(`성공적으로 ${selectedOutlet.name} 구독권을 결제했습니다.`);
      setSelectedOutlet(null);
    } catch (e: any) {
      if (activeAccountRef.current !== purchaseAccount || fetchSeqRef.current !== purchaseSeq) return;
      console.error(e);
      alert("구매 실패: " + (e.message || "알 수 없는 오류"));
    } finally {
      setLoading(false);
    }
  };

  const purchaseServerProduct = async (
    productId: 'options_license' | 'custom_dashboard' | 'fee_booster' | 'scanner_item' | 'ai_predictor',
    onSuccess: (data: any) => void
  ) => {
    if (!isLoggedIn || !userId) return;
    const purchaseAccount = userId;
    const purchaseSeq = fetchSeqRef.current;
    setLoading(true);
    try {
      const res = await fetch('/api/shop/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemType: 'product', productId }),
      });
      const data = await res.json();
      if (activeAccountRef.current !== purchaseAccount || fetchSeqRef.current !== purchaseSeq) return;
      if (!res.ok || !data.success) {
        throw new Error(data.message || '구매에 실패했습니다.');
      }
      setCash(Number(data.cash));
      if (data.feature_expiries && typeof data.feature_expiries === 'object') {
        setFeatureExpiries(data.feature_expiries as Record<string, string>);
      }
      onSuccess(data);
    } catch (e: any) {
      if (activeAccountRef.current !== purchaseAccount || fetchSeqRef.current !== purchaseSeq) return;
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

    await purchaseServerProduct('options_license', () => {
      setHasOptionsLicense(true);
      alert("파생상품 옵션 거래 자격증을 정상 취득했습니다.");
    });
  };

  const handleCustomDashboardPurchase = async () => {
    if (!userId || loading) return;
    const price = 3000000;
    if (cash < price) { alert("⚠️ 예수금이 부족합니다. (필요 금액: ₩3,000,000)"); return; }

    if (!confirm(`[플랫폼] 메인 대시보드 커스텀 라이선스를 구매하시겠습니까?\n결제 금액: ₩${price.toLocaleString()}`)) return;

    await purchaseServerProduct('custom_dashboard', () => {
      setHasCustomDashboard(true);
      alert("메인 대시보드 커스텀 라이선스를 구매했습니다.");
    });
  };

  const handleFeeBoosterPurchase = async () => {
    if (!userId || loading) return;
    const price = 1000000;
    if (cash < price) { alert("⚠️ 예수금이 부족합니다."); return; }
    if (!confirm("[혜택] 거래 수수료 50% 감면 부스터(30일)를 활성화하시겠습니까?\n결제 금액: ₩1,000,000")) return;

    await purchaseServerProduct('fee_booster', () => {
      setHasFeeBooster(true);
      alert("수수료 50% 감면 부스터가 활성화되었습니다.");
    });
  };

  const handleScannerPurchase = async () => {
    if (!userId || loading) return;
    const price = 2000000;
    if (cash < price) { alert("⚠️ 예수금이 부족합니다."); return; }
    if (!confirm("[분석] 기관 수급 실시간 스캐너(30일)를 구매하시겠습니까?\n결제 금액: ₩2,000,000")) return;

    await purchaseServerProduct('scanner_item', () => {
      setHasScanner(true);
      alert("기관 수급 실시간 스캐너가 활성화되었습니다.");
    });
  };

  const handleAiPredictorPurchase = async () => {
    if (!userId || loading) return;
    const price = 1500000;
    if (cash < price) { alert("⚠️ 예수금이 부족합니다."); return; }
    if (!confirm("[분석] AI 시황 예측 신호 부스터(30일)를 구매하시겠습니까?\n결제 금액: ₩1,500,000")) return;

    await purchaseServerProduct('ai_predictor', () => {
      setHasAiPredictor(true);
      alert("AI 시황 예측 부스터가 활성화되었습니다.");
    });
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
  const formatFeatureExpiry = (key: string) => {
    if (isAdmin) return "관리자 무제한";
    if (key === "fee_booster" && (acquiredPassives.includes("fee_discount_50") || acquiredPassives.includes("fee_booster"))) {
      return "패시브 영구 보유";
    }
    const exp = featureExpiries[key];
    if (!exp) return "만료일 정보 없음";
    const dday = getDday(exp);
    const dateStr = exp.slice(0, 10);
    return dday >= 0 ? `D-${dday} (${dateStr})` : `만료 (${dateStr})`;
  };
  for (const passive of acquiredPassives) {
    if (passive === "fee_discount_50" || passive === "fee_booster") continue;
    purchasedItemsList.push({
      id: `passive-${passive}`,
      name: `패시브 특전 (${passive})`,
      category: "획득 패시브",
      desc: "이벤트 보상으로 획득한 영구 패시브 효과",
      expiry: "패시브 영구 보유",
    });
  }
  if (hasFeeBooster) {
    purchasedItemsList.push({
      id: "fee-booster",
      name: "거래 수수료 50% 감면권",
      category: "트레이딩 부스터",
      desc: "거래 수수료 50% 자동 할인",
      expiry: formatFeatureExpiry("fee_booster")
    });
  }
  if (hasScanner) {
    purchasedItemsList.push({
      id: "scanner-item",
      name: "기관 수급 실시간 스캐너",
      category: "분석 솔루션",
      desc: "세력/기관 순매수 수급 스캐너 모니터링",
      expiry: formatFeatureExpiry("scanner_item")
    });
  }
  if (hasAiPredictor) {
    purchasedItemsList.push({
      id: "ai-booster",
      name: "AI 시황 예측 부스터",
      category: "분석 솔루션",
      desc: "AI 호재/악재 사건 예측 신호 포착",
      expiry: formatFeatureExpiry("ai_predictor")
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
    <div className="min-h-screen bg-panel text-[#F3F4F6] font-sans pb-20">
      
      {/* 1. MINIMAL FINTECH HEADER */}
      <header className="h-16 border-b border-white/10 bg-panel px-6 flex items-center justify-between sticky top-0 z-20 backdrop-blur-md">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-2.5">
            <div className="w-2 h-5 bg-down rounded-full"></div>
            <h1 className="text-lg font-bold text-white tracking-tight">
              트레이딩 솔루션 & 구독 상점
            </h1>
          </div>

          <nav className="flex items-center gap-2 bg-[#151821] p-1 rounded-xl border border-white/5">
            <button
              onClick={() => setActiveTab("shop")}
              className={`px-4 py-1.5 rounded-lg text-[13px] font-medium transition-all ${
                activeTab === "shop"
                  ? "bg-panel2 text-white font-bold shadow-sm"
                  : "text-muted hover:text-white"
              }`}
            >
              플랫폼 상품
            </button>
            <button
              onClick={() => setActiveTab("subscriptions")}
              className={`px-4 py-1.5 rounded-lg text-[13px] font-medium transition-all flex items-center gap-1.5 ${
                activeTab === "subscriptions"
                  ? "bg-panel2 text-white font-bold shadow-sm"
                  : "text-muted hover:text-white"
              }`}
            >
              보유 내역
              {purchasedItemsList.length > 0 && (
                <span className="px-1.5 py-0.2 text-[10px] bg-down text-white font-mono rounded-full font-bold">
                  {purchasedItemsList.length}
                </span>
              )}
            </button>
          </nav>
        </div>

        {/* Balance HUD */}
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-muted">보유 예수금</span>
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
              <p className="text-[13px] text-muted mt-1">
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
                      ? "bg-down text-white font-bold"
                      : "text-muted hover:text-white"
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
                  badge="준비 중"
                  title="기관 수급 실시간 스캐너"
                  desc="기능 개편으로 신규 판매가 일시 중단되었습니다 (기존 보유 권리 유지)"
                  price={2000000}
                  isUnlocked={hasScanner}
                  onPurchase={handleScannerPurchase}
                  loading={false}
                  disabled={!hasScanner}
                  buttonText={hasScanner ? "보유 중" : "판매 일시 중단"}
                  features={[
                    "연기금/헤지펀드 수급 흐름 실시간 포착",
                    "스마트머니 순매수 순위 대시보드 제공",
                    "기능 연동 완료 후 재오픈 예정"
                  ]}
                />

                <PricingCard
                  badge="준비 중"
                  title="AI 시황 예측기"
                  desc="기능 개편으로 신규 판매가 일시 중단되었습니다 (기존 보유 권리 유지)"
                  price={1500000}
                  isUnlocked={hasAiPredictor}
                  onPurchase={handleAiPredictorPurchase}
                  loading={false}
                  disabled={!hasAiPredictor}
                  buttonText={hasAiPredictor ? "보유 중" : "판매 일시 중단"}
                  features={[
                    "Gemini AI 호재/악재 수치화 타겟 신호",
                    "변동성 이벤트 사전 감지 레이더",
                    "기능 연동 완료 후 재오픈 예정"
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
              <p className="text-[13px] text-muted mt-0.5">
                현재 계정에서 이용 중인 영구 거래 라이선스 및 터미널 구독 내역입니다.
              </p>
            </div>
            <span className="text-[12px] font-mono font-bold text-down bg-[#151821] px-3 py-1 rounded-lg border border-white/5">
              총 {purchasedItemsList.length}개 보유
            </span>
          </div>

          {purchasedItemsList.length === 0 ? (
            <div className="p-12 text-center border border-white/5 bg-[#151821] rounded-2xl space-y-3">
              <h3 className="text-base font-bold text-white">보유 중인 상품이 없습니다</h3>
              <p className="text-[13px] text-muted max-w-sm mx-auto">
                플랫폼 상품 탭에서 트레이딩 솔루션 및 미디어 터미널을 이용해보세요.
              </p>
              <button
                onClick={() => setActiveTab("shop")}
                className="mt-2 px-4 py-2 bg-down text-white font-bold text-[13px] rounded-xl hover:bg-down/90 transition"
              >
                상품 목록 둘러보기
              </button>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {purchasedItemsList.map((item) => (
                <div key={item.id} className="p-5 border border-white/10 bg-[#151821] rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-down bg-down/10 border border-[#3182F6]/20 px-2 py-0.5 rounded-md">
                      {item.category}
                    </span>
                    <span className="text-xs font-mono text-emerald-400 flex items-center gap-1 font-bold">
                      ● 활성화
                    </span>
                  </div>

                  <div>
                    <h3 className="text-base font-bold text-white">{item.name}</h3>
                    <p className="text-[12.5px] text-muted mt-1">{item.desc}</p>
                  </div>

                  <div className="pt-3 border-t border-white/5 flex items-center justify-between text-[12px] font-mono">
                    <span className="text-dim">상태:</span>
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
                <span className="text-xs font-mono font-bold text-down">
                  MEDIA TERMINAL SUBSCRIPTION
                </span>
                <h3 className="text-lg font-bold text-white mt-0.5">
                  {selectedOutlet.name}
                </h3>
              </div>
              <button 
                onClick={() => setSelectedOutlet(null)}
                className="text-dim hover:text-white text-base"
              >
                ✕
              </button>
            </div>

            <div className="space-y-2.5">
              <label className="block text-[12px] text-muted">
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
                      ? "border-[#3182F6] bg-down/10 text-white font-bold"
                      : "border-white/5 bg-panel2 text-muted hover:border-white/20"
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
                className="px-4 py-2 text-[13px] text-muted hover:text-white rounded-xl border border-white/10"
              >
                취소
              </button>
              <button
                onClick={executeNewsPurchase}
                disabled={loading}
                className="px-5 py-2 bg-down hover:bg-down/90 text-white font-bold text-[13px] rounded-xl transition shadow-md"
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

/* Premium Minimal Fintech Pricing Card */
function PricingCard({
  badge,
  title,
  desc,
  price,
  isUnlocked,
  onPurchase,
  loading,
  disabled = false,
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
  disabled?: boolean;
  buttonText?: string;
  features?: string[];
}) {
  return (
    <div className="bg-panel2 border border-white/[0.08] rounded-2xl p-6 flex flex-col justify-between transition-all duration-200 hover:bg-[#13161d] hover:border-white/[0.14]">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-bold text-white/35 bg-white/[0.05] border border-white/[0.07] px-2.5 py-0.5 rounded-md tracking-widest uppercase font-mono">
            {badge}
          </span>
          {isUnlocked && (
            <span className="text-[10.5px] font-mono text-white/45 font-bold flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500/60" />
              활성화됨
            </span>
          )}
        </div>

        <div>
          <h3 className="text-[15px] font-bold text-white tracking-tight leading-snug">{title}</h3>
          <p className="text-[12px] text-white/35 mt-1.5 leading-relaxed">{desc}</p>
        </div>

        <div className="pt-3 border-t border-white/[0.06]">
          <div className="text-[9.5px] text-white/20 uppercase tracking-widest mb-1.5 font-mono">이용 금액</div>
          <div className="font-mono text-[22px] font-bold text-white tabular-nums">
            ₩{price.toLocaleString()}
          </div>
        </div>

        {features.length > 0 && (
          <ul className="space-y-1.5 pt-0.5 text-[11.5px] text-white/35">
            {features.map((f, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="text-white/20 font-bold mt-px shrink-0">—</span>
                <span className="leading-relaxed">{f}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pt-5">
        <button
          onClick={onPurchase}
          disabled={isUnlocked || loading || disabled}
          className={`w-full py-2.5 rounded-xl font-bold text-[13px] transition-all active:scale-[0.98] ${
            isUnlocked || disabled
              ? "bg-white/[0.04] text-white/20 cursor-default border border-white/[0.06]"
              : "bg-white text-black hover:bg-white/90 cursor-pointer"
          }`}
        >
          {isUnlocked ? "이용 중" : loading ? "처리 중..." : buttonText}
        </button>
      </div>
    </div>
  );
}
