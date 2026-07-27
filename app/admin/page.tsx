"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface StockItem {
  id: string;
  ticker: string;
  name: string;
  market: string;
  current_price: number;
  target_price: number;
}

export default function AdminPage() {
  const [isAdmin, setIsAdmin] = useState<boolean>(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [unlockedFeatures, setUnlockedFeatures] = useState<string[]>([]);
  const [stocks, setStocks] = useState<StockItem[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  // Manipulator Control Form State
  const [selectedStockId, setSelectedStockId] = useState<string>("");
  const [manipulationMode, setManipulationMode] = useState<string>("ACCUMULATION");
  const [targetPriceInput, setTargetPriceInput] = useState<string>("");

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

  useEffect(() => {
    fetchAdminStatus();
    fetchStocks();
  }, []);

  const fetchAdminStatus = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setUserId(session.user.id);
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin, unlocked_features")
        .eq("id", session.user.id)
        .single();
      
      if (profile) {
        setIsAdmin(profile.is_admin || false);
        setUnlockedFeatures((profile.unlocked_features as string[]) || []);
      }
    }
  };

  const fetchStocks = async () => {
    const { data } = await supabase
      .from("stocks")
      .select("id, ticker, name, market, current_price, target_price")
      .eq("is_listed", true)
      .order("ticker");
    if (data) {
      setStocks(data as StockItem[]);
      if (data.length > 0) setSelectedStockId(data[0].id);
    }
  };

  // Trigger Manipulator Mode
  const handleManipulatorTrigger = async () => {
    if (!selectedStockId || loading) return;
    setLoading(true);
    try {
      const targetStock = stocks.find((s) => s.id === selectedStockId);
      const targetPrice = Number(targetPriceInput) || (targetStock ? targetStock.current_price * 1.5 : 100000);

      const { error } = await supabase
        .from("stocks")
        .update({ target_price: targetPrice })
        .eq("id", selectedStockId);

      if (error) throw error;

      alert(`⚡ [${targetStock?.name || selectedStockId}] 세력 작전 (${manipulationMode}) 발동 완료!\n목표가: ₩${targetPrice.toLocaleString()}`);
      fetchStocks();
    } catch (e: any) {
      console.error(e);
      alert("세력 작전 실행 실패: " + (e.message || e));
    } finally {
      setLoading(false);
    }
  };

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
    <div className="mx-auto max-w-6xl px-6 py-8 space-y-8 font-sans">
      {/* Header */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-[#222736] pb-6">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-black text-white tracking-tight">👑 ADMIN COMMAND CENTER</h1>
            <span className="px-2.5 py-1 rounded text-[11px] font-black bg-blue-500/20 text-blue-400 border border-blue-500/40">
              시스템 관리자 커맨드 센터
            </span>
          </div>
          <p className="text-[13px] text-gray-400 mt-1">
            가상 거래소 전체 시장 관리 · 세력 작전 발동 · AI 이벤트 강제 생성 · 시스템 모니터링
          </p>
        </div>
      </div>

      {/* Admin Status Card */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-xl border border-[#222736] bg-[#141721] p-5">
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">ADMIN STATUS</div>
          <div className="text-lg font-black text-blue-400 flex items-center gap-2">
            <span>{isAdmin ? "👑 SYSTEM ADMIN ACTIVE" : "STANDARD USER"}</span>
          </div>
        </div>

        <div className="rounded-xl border border-[#222736] bg-[#141721] p-5">
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-1">UNLOCKED SYSTEM MODULES</div>
          <div className="text-sm font-bold text-emerald-400">
            {unlockedFeatures.length > 0 ? unlockedFeatures.join(", ") : "ALL MODULES ACTIVE"}
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Module 1: 세력(Manipulator) 작전 조종기 */}
        <div className="rounded-xl border border-[#222736] bg-[#141721] p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-[#222736] pb-3">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>🎯 세력(Manipulator) 작전 주입기</span>
            </h2>
            <span className="text-[10px] font-mono text-red-400 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">
              MARKET OVERRIDE
            </span>
          </div>

          <div className="space-y-3 text-[13px]">
            <div>
              <label className="block text-[11px] text-gray-400 mb-1">작전 타겟 종목 선택</label>
              <select
                value={selectedStockId}
                onChange={(e) => setSelectedStockId(e.target.value)}
                className="w-full rounded-lg border border-[#222736] bg-[#090a0f] px-3 py-2 text-white font-mono text-[13px] outline-none"
              >
                {stocks.map((s) => (
                  <option key={s.id} value={s.id}>
                    [{s.ticker}] {s.name} (현재가: ₩{s.current_price.toLocaleString()})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-gray-400 mb-1">세력 운용 모드</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "ACCUMULATION", label: "매집 (눌림목)" },
                  { id: "PUMP", label: "시세조종 (급등)" },
                  { id: "DISTRIBUTION", label: "분배 (매도)" },
                ].map((mode) => (
                  <button
                    key={mode.id}
                    onClick={() => setManipulationMode(mode.id)}
                    className={`py-2 text-[12px] font-bold rounded border transition-all cursor-pointer ${
                      manipulationMode === mode.id
                        ? "border-red-500 bg-red-500/20 text-red-400"
                        : "border-[#222736] bg-[#090a0f] text-gray-400 hover:text-white"
                    }`}
                  >
                    {mode.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-gray-400 mb-1">목표 주가 설정 (원)</label>
              <input
                type="number"
                placeholder="예: 150000"
                value={targetPriceInput}
                onChange={(e) => setTargetPriceInput(e.target.value)}
                className="w-full rounded-lg border border-[#222736] bg-[#090a0f] px-3 py-2 text-white font-mono text-[13px] outline-none focus:border-red-500"
              />
            </div>

            <button
              onClick={handleManipulatorTrigger}
              disabled={loading}
              className="w-full py-3 rounded-lg bg-red-600 hover:bg-red-500 text-white font-bold text-[13px] shadow-[0_0_15px_rgba(239,68,68,0.4)] transition-all cursor-pointer mt-2"
            >
              🚀 선택 종목 세력 작전 발동
            </button>
          </div>
        </div>

        {/* Module 2: AI 웹소설 사건 & 시황 강제 발생기 */}
        <div className="rounded-xl border border-[#222736] bg-[#141721] p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-[#222736] pb-3">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>📰 AI 웹소설 사건 강제 판정기</span>
            </h2>
            <span className="text-[10px] font-mono text-purple-400 bg-purple-500/10 px-2 py-0.5 rounded border border-purple-500/20">
              AI ENGINE
            </span>
          </div>

          <div className="space-y-3 text-[13px]">
            <div>
              <label className="block text-[11px] text-gray-400 mb-1">이벤트 제목 / 헤드라인</label>
              <input
                type="text"
                placeholder="예: 오성전자, 차세대 3나노 파운드리 양산 성공 호재"
                value={eventTitle}
                onChange={(e) => setEventTitle(e.target.value)}
                className="w-full rounded-lg border border-[#222736] bg-[#090a0f] px-3 py-2 text-white text-[13px] outline-none focus:border-purple-500"
              />
            </div>

            <div>
              <label className="block text-[11px] text-gray-400 mb-1">웹소설 사건 원문 텍스트</label>
              <textarea
                rows={4}
                placeholder="웹소설 속 사건 본문 텍스트를 입력하면 AI 판정기가 섹터별 목표가를 갱신하고 기관 LP를 동원합니다..."
                value={eventRawText}
                onChange={(e) => setEventRawText(e.target.value)}
                className="w-full rounded-lg border border-[#222736] bg-[#090a0f] p-3 text-white text-[12px] outline-none focus:border-purple-500 resize-none"
              />
            </div>

            <button
              onClick={handleAIEventTrigger}
              disabled={loading}
              className="w-full py-3 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-bold text-[13px] shadow-[0_0_15px_rgba(168,85,247,0.4)] transition-all cursor-pointer"
            >
              🤖 AI 뉴스 및 목표가 갱신 실행
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Module 3: 신규 종목 상장 관리 */}
        <div className="rounded-xl border border-[#222736] bg-[#141721] p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-[#222736] pb-3">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>🏛️ 신규 주식 종목 상장</span>
            </h2>
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
              NEW LISTING
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-[13px]">
            <div>
              <label className="block text-[11px] text-gray-400 mb-1">티커 (Ticker)</label>
              <input
                type="text"
                placeholder="0060"
                value={newTicker}
                onChange={(e) => setNewTicker(e.target.value)}
                className="w-full rounded-lg border border-[#222736] bg-[#090a0f] px-3 py-2 text-white font-mono text-[13px] outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] text-gray-400 mb-1">종목명 (Company)</label>
              <input
                type="text"
                placeholder="미래바이오"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full rounded-lg border border-[#222736] bg-[#090a0f] px-3 py-2 text-white text-[13px] outline-none"
              />
            </div>

            <div>
              <label className="block text-[11px] text-gray-400 mb-1">소속 시장</label>
              <select
                value={newMarket}
                onChange={(e) => setNewMarket(e.target.value)}
                className="w-full rounded-lg border border-[#222736] bg-[#090a0f] px-3 py-2 text-white text-[13px] outline-none"
              >
                <option value="domestic">국내주식 (KOSPI)</option>
                <option value="overseas">미국주식 (S&P 50)</option>
                <option value="europe">유럽주식 (EURO STOXX)</option>
              </select>
            </div>

            <div>
              <label className="block text-[11px] text-gray-400 mb-1">공모가 (원)</label>
              <input
                type="number"
                value={newPrice}
                onChange={(e) => setNewPrice(e.target.value)}
                className="w-full rounded-lg border border-[#222736] bg-[#090a0f] px-3 py-2 text-white font-mono text-[13px] outline-none"
              />
            </div>
          </div>

          <button
            onClick={handleListStock}
            disabled={loading}
            className="w-full py-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[13px] shadow-[0_0_15px_rgba(16,185,129,0.4)] transition-all cursor-pointer"
          >
            ✨ 신규 종목 주식시장 상장 승인
          </button>
        </div>

        {/* Module 4: 비상 시장 제어기 */}
        <div className="rounded-xl border border-[#222736] bg-[#141721] p-6 space-y-4">
          <div className="flex items-center justify-between border-b border-[#222736] pb-3">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span>🚨 비상 시장 제어 (Emergency Operations)</span>
            </h2>
            <span className="text-[10px] font-mono text-yellow-400 bg-yellow-500/10 px-2 py-0.5 rounded border border-yellow-500/20">
              SYSTEM CONTROL
            </span>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg border border-[#222736] bg-[#090a0f]">
              <div>
                <div className="text-[13px] font-bold text-white">전 종목 거래 정지 (Trading Halt)</div>
                <div className="text-[11px] text-gray-400">모든 시장의 매수/매도 주문 접수를 서킷브레이크 처리합니다.</div>
              </div>
              <button
                onClick={() => setTradingHalt(!tradingHalt)}
                className={`px-4 py-2 text-[12px] font-bold rounded cursor-pointer transition-all ${
                  tradingHalt ? "bg-red-600 text-white" : "bg-[#1c202c] text-gray-400 hover:text-white"
                }`}
              >
                {tradingHalt ? "🔴 비상정지 ON" : "⚪ 정상운영"}
              </button>
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border border-[#222736] bg-[#090a0f]">
              <div>
                <div className="text-[13px] font-bold text-white">LP 무제한 유동성 방어 모드</div>
                <div className="text-[11px] text-gray-400">50개 기관 LP가 하방 지지 호가창을 무한대로 방어합니다.</div>
              </div>
              <button
                onClick={() => setLpInfiniteLiquidity(!lpInfiniteLiquidity)}
                className={`px-4 py-2 text-[12px] font-bold rounded cursor-pointer transition-all ${
                  lpInfiniteLiquidity ? "bg-blue-600 text-white" : "bg-[#1c202c] text-gray-400 hover:text-white"
                }`}
              >
                {lpInfiniteLiquidity ? "🔵 방어모드 ACTIVE" : "⚪ 일반 모드"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
