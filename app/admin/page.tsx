"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import ScenarioController from "./ScenarioController";

interface StockItem {
  id: string;
  ticker: string;
  name: string;
  market: string;
  current_price: number;
  target_price: number;
}

type AdminTab = "scenarios" | "listing" | "events" | "emergency";

export default function AdminPage() {
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [unlockedFeatures, setUnlockedFeatures] = useState<string[]>([]);
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<AdminTab>("scenarios");

  // AI Event Trigger State
  const [eventTitle, setEventTitle] = useState<string>("");
  const [eventRawText, setEventRawText] = useState<string>("");

  // Emergency Market Control State
  const [tradingHalt, setTradingHalt] = useState<boolean>(false);
  const [lpInfiniteLiquidity, setLpInfiniteLiquidity] = useState<boolean>(true);

  // New Stock Listing Form State
  const [newTicker, setNewTicker] = useState<string>("");
  const [newName, setNewName] = useState<string>("");
  const [newMarket, setNewMarket] = useState<string>("domestic");
  const [newSector, setNewSector] = useState<string>("반도체");
  const [newPrice, setNewPrice] = useState<string>("50000");

  const supabase = createClient();
  const { userId, isLoggedIn } = useAuth();

  const fetchAdminStatus = useCallback(async () => {
    if (isLoggedIn && userId) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin, unlocked_features")
        .eq("id", userId)
        .single();

      if (profile) {
        setIsAdmin(profile.is_admin || false);
        setUnlockedFeatures((profile.unlocked_features as string[]) || []);
      }
    } else {
      // 로컬 개발 환경 편의상 기본 관리자 활성화
      setIsAdmin(true);
    }
  }, [supabase, isLoggedIn, userId]);

  const fetchStocks = useCallback(async () => {
    const { data } = await supabase
      .from("stocks")
      .select("id, ticker, name, market, current_price, target_price")
      .eq("is_listed", true)
      .order("ticker");
    if (data) {
      setStocks(data as StockItem[]);
    }
  }, [supabase]);

  useEffect(() => {
    fetchAdminStatus();
    fetchStocks();
  }, [fetchAdminStatus, fetchStocks]);

  // Trigger AI Event
  const handleAIEventTrigger = async () => {
    if (!eventTitle || !eventRawText || loading) {
      alert("이벤트 제목과 원문 텍스트를 입력해 주세요.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.from("novel_events").insert({
        title: eventTitle,
        raw_text: eventRawText,
        impact_summary: "관리자에 의해 시스템에 강제 적용된 이벤트입니다.",
        sector_impacts: [
          { sector: "반도체", impact: "positive", score: 0.8 },
          { sector: "2차전지", impact: "negative", score: -0.5 },
        ],
      });

      if (error) throw error;

      alert(`📰 AI 시황/웹소설 이벤트 [${eventTitle}] 강제 등록 완료!`);
      setEventTitle("");
      setEventRawText("");
    } catch (e: any) {
      console.error(e);
      alert("AI 이벤트 등록 실패: " + (e.message || e));
    } finally {
      setLoading(false);
    }
  };

  // Handle New Stock Listing
  const handleListStock = async () => {
    if (!newTicker || !newName || loading) {
      alert("티커 및 종목명을 입력해 주세요.");
      return;
    }
    setLoading(true);
    try {
      const initPrice = Number(newPrice) || 50000;
      const { error } = await supabase.from("stocks").insert({
        ticker: newTicker.toUpperCase(),
        name: newName,
        market: newMarket,
        sector: newSector,
        current_price: initPrice,
        open_price: initPrice,
        previous_close: initPrice,
        high: initPrice,
        low: initPrice,
        target_price: initPrice * 1.2,
        is_listed: true,
      });

      if (error) throw error;

      alert(`🎉 신규 종목 [${newTicker.toUpperCase()}] ${newName} 상장 완료!`);
      setNewTicker("");
      setNewName("");
      fetchStocks();
    } catch (e: any) {
      console.error(e);
      alert("상장 실패: " + (e.message || e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-8 space-y-6 font-mono">
      {/* ── 1. 헤더 ── */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-[#212631] pb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black text-white tracking-tight">👑 ADMIN COMMAND CENTER</h1>
            <span className="px-3 py-1 rounded-full text-[11px] font-black bg-[#F04452]/10 text-[#F04452] border border-[#F04452]/30">
              {isAdmin ? "SYSTEM ADMIN ACTIVE" : "DEVELOPER PREVIEW"}
            </span>
          </div>
          <p className="text-[12.5px] text-[#8E939D] mt-1 font-sans">
            가상 거래소 전체 시장 제어 · 세력 작전 주입기 · 거시경제 충격 발동 · 긴급 롤백(Halt)
          </p>
        </div>

        <div className="flex items-center gap-4 bg-[#0E1117] px-4 py-2.5 rounded-2xl border border-[#212631] text-xs">
          <div>
            <span className="text-[#565A63] font-bold block text-[10px]">상장 주식</span>
            <span className="font-black text-white">{stocks.length}개</span>
          </div>
          <div className="border-l border-[#212631] pl-4">
            <span className="text-[#565A63] font-bold block text-[10px]">활성 모듈</span>
            <span className="font-black text-emerald-400">
              {unlockedFeatures.length > 0 ? `${unlockedFeatures.length}개` : "ALL ACTIVE"}
            </span>
          </div>
        </div>
      </div>

      {/* ── 2. 네비게이션 탭 ── */}
      <div className="flex border-b border-[#212631] gap-2 overflow-x-auto no-scrollbar">
        {[
          { id: "scenarios" as AdminTab, label: "🎛️ 시나리오 제어기 (작전/거시충격)", primary: true },
          { id: "listing" as AdminTab, label: "📝 신규 종목 상장", primary: false },
          { id: "events" as AdminTab, label: "📰 AI 시황/웹소설 이벤트", primary: false },
          { id: "emergency" as AdminTab, label: "🚨 시스템 긴급 제어", primary: false },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-3 rounded-t-xl font-bold text-xs transition-all cursor-pointer whitespace-nowrap border-t border-x ${
              activeTab === tab.id
                ? "bg-[#0E1117] border-[#212631] text-[#F04452] font-black border-b-transparent"
                : "border-transparent text-[#8E939D] hover:text-white bg-[#05070A]"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── 3. 탭별 컨텐츠 ── */}
      {activeTab === "scenarios" && (
        <ScenarioController stocks={stocks} />
      )}

      {activeTab === "listing" && (
        <div className="rounded-2xl border border-[#212631] bg-[#0E1117] p-6 space-y-4 max-w-2xl shadow-xl">
          <div className="flex items-center justify-between border-b border-[#212631] pb-3">
            <h2 className="text-sm font-black text-white flex items-center gap-2">
              <span>📝 신규 종목 즉시 상장 (IPO)</span>
            </h2>
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
              MARKET EXPANSION
            </span>
          </div>

          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] text-[#8E939D] mb-1">티커 심볼 (Ticker)</label>
                <input
                  type="text"
                  placeholder="예: 005930, AAPL"
                  value={newTicker}
                  onChange={(e) => setNewTicker(e.target.value)}
                  className="w-full rounded-xl border border-[#212631] bg-[#05070A] px-3.5 py-2 text-white font-mono outline-none focus:border-[#3182F6]"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#8E939D] mb-1">종목명 (Company Name)</label>
                <input
                  type="text"
                  placeholder="예: 삼성전자, 애플"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full rounded-xl border border-[#212631] bg-[#05070A] px-3.5 py-2 text-white outline-none focus:border-[#3182F6]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[11px] text-[#8E939D] mb-1">시장 구분</label>
                <select
                  value={newMarket}
                  onChange={(e) => setNewMarket(e.target.value)}
                  className="w-full rounded-xl border border-[#212631] bg-[#05070A] px-3.5 py-2 text-white outline-none focus:border-[#3182F6]"
                >
                  <option value="domestic">국내 코스피/코스닥</option>
                  <option value="overseas">미국 나스닥/NYSE</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] text-[#8E939D] mb-1">섹터 분류</label>
                <input
                  type="text"
                  placeholder="예: 반도체, AI, 2차전지"
                  value={newSector}
                  onChange={(e) => setNewSector(e.target.value)}
                  className="w-full rounded-xl border border-[#212631] bg-[#05070A] px-3.5 py-2 text-white outline-none focus:border-[#3182F6]"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-[#8E939D] mb-1">공모/시초가 (KRW)</label>
              <input
                type="number"
                placeholder="50000"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                className="w-full rounded-xl border border-[#212631] bg-[#05070A] px-3.5 py-2 text-white font-mono outline-none focus:border-[#3182F6]"
              />
            </div>

            <button
              onClick={handleListStock}
              disabled={loading}
              className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs transition-colors cursor-pointer disabled:opacity-40"
            >
              {loading ? "상장 처리 중..." : "🎉 신규 종목 거래소 상장 승인"}
            </button>
          </div>
        </div>
      )}

      {activeTab === "events" && (
        <div className="rounded-2xl border border-[#212631] bg-[#0E1117] p-6 space-y-4 max-w-2xl shadow-xl">
          <div className="flex items-center justify-between border-b border-[#212631] pb-3">
            <h2 className="text-sm font-black text-white flex items-center gap-2">
              <span>📰 AI 시황/웹소설 이벤트 강제 생성</span>
            </h2>
            <span className="text-[10px] font-mono text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
              STORY ENGINE
            </span>
          </div>

          <div className="space-y-4 text-xs">
            <div>
              <label className="block text-[11px] text-[#8E939D] mb-1">이벤트 제목 (Headline)</label>
              <input
                type="text"
                placeholder="예: [단독] 정부, 차세대 AI 반도체 10조원 전폭 지원 발표"
                value={eventTitle}
                onChange={(e) => setEventTitle(e.target.value)}
                className="w-full rounded-xl border border-[#212631] bg-[#05070A] px-3.5 py-2 text-white outline-none focus:border-[#3182F6]"
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#8E939D] mb-1">상세 원문 기사</label>
              <textarea
                rows={4}
                placeholder="시장에 전파될 상세 뉴스 및 웹소설 스토리 텍스트를 입력하세요..."
                value={eventRawText}
                onChange={(e) => setEventRawText(e.target.value)}
                className="w-full rounded-xl border border-[#212631] bg-[#05070A] px-3.5 py-2 text-white font-sans outline-none focus:border-[#3182F6] resize-none"
              />
            </div>

            <button
              onClick={handleAIEventTrigger}
              disabled={loading}
              className="w-full py-3.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-black text-xs transition-colors cursor-pointer disabled:opacity-40"
            >
              {loading ? "이벤트 전파 중..." : "🚀 이벤트 전 시장 강제 브로드캐스팅"}
            </button>
          </div>
        </div>
      )}

      {activeTab === "emergency" && (
        <div className="rounded-2xl border border-[#212631] bg-[#0E1117] p-6 space-y-4 max-w-2xl shadow-xl">
          <div className="flex items-center justify-between border-b border-[#212631] pb-3">
            <h2 className="text-sm font-black text-white flex items-center gap-2">
              <span>🚨 시스템 긴급 서킷브레이커</span>
            </h2>
            <span className="text-[10px] font-mono text-red-400 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">
              CIRCUIT BREAKER
            </span>
          </div>

          <div className="space-y-4 text-xs">
            <div className="flex items-center justify-between p-4 rounded-xl bg-[#05070A] border border-[#212631]">
              <div>
                <div className="font-bold text-white">거래 전면 중단 (Trading Halt)</div>
                <div className="text-[11px] text-[#565A63]">주문 매칭 및 봇 거래를 일시 동결합니다.</div>
              </div>
              <button
                onClick={() => setTradingHalt(!tradingHalt)}
                className={`px-4 py-2 rounded-xl font-bold text-xs transition-colors cursor-pointer ${
                  tradingHalt ? "bg-red-600 text-white" : "bg-[#161B22] text-[#8E939D] border border-[#212631]"
                }`}
              >
                {tradingHalt ? "🔴 동결 해제" : "⚪ 거래 동결"}
              </button>
            </div>

            <div className="flex items-center justify-between p-4 rounded-xl bg-[#05070A] border border-[#212631]">
              <div>
                <div className="font-bold text-white">LP 무한 유동성 공급 (Infinite Liquidity)</div>
                <div className="text-[11px] text-[#565A63]">호가 공백 발생 시 자동 마켓메이커 개입</div>
              </div>
              <button
                onClick={() => setLpInfiniteLiquidity(!lpInfiniteLiquidity)}
                className={`px-4 py-2 rounded-xl font-bold text-xs transition-colors cursor-pointer ${
                  lpInfiniteLiquidity ? "bg-emerald-600 text-white" : "bg-[#161B22] text-[#8E939D] border border-[#212631]"
                }`}
              >
                {lpInfiniteLiquidity ? "🟢 LP 가동 중" : "⚪ LP 중단됨"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
