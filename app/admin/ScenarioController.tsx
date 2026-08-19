'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  ManipulationScenario,
  MacroShockEvent,
  MacroShockType,
  AdminActionLog,
  ScenarioPhase,
  AssetType,
} from '@/lib/scenario/types';
import { COMMODITY_DEFINITIONS } from '@/lib/commodities/definitions';
import { fmtSigned, fmtKSTTime } from '@/lib/format';
import { useToast } from '@/app/components/ToastProvider';

interface StockItem {
  id: string;
  ticker: string;
  name: string;
  market: string;
  current_price: number;
}

export default function ScenarioController({
  stocks = [],
}: {
  stocks: StockItem[];
}) {
  const { showToast } = useToast();

  // 1. 타겟 선택 상태
  const [assetType, setAssetType] = useState<AssetType>('stock');
  const [selectedAssetId, setSelectedAssetId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // 2. 작전 세력 파라미터 상태
  const [scenarioMode, setScenarioMode] = useState<ScenarioPhase>('full_cycle');
  const [durationTicks, setDurationTicks] = useState<number>(60);
  const [targetChangePct, setTargetChangePct] = useState<number>(50);
  const [volumeMultiplier, setVolumeMultiplier] = useState<number>(3);
  const [loading, setLoading] = useState<boolean>(false);

  // 3. 서버 실시간 상태
  const [activeScenarios, setActiveScenarios] = useState<ManipulationScenario[]>([]);
  const [activeShocks, setActiveShocks] = useState<MacroShockEvent[]>([]);
  const [actionLogs, setActionLogs] = useState<AdminActionLog[]>([]);

  // 초기 기본값 선택
  useEffect(() => {
    if (assetType === 'stock' && stocks.length > 0 && !selectedAssetId) {
      const defaultStock = stocks[0];
      if (defaultStock) setSelectedAssetId(defaultStock.id);
    } else if (assetType === 'commodity' && COMMODITY_DEFINITIONS.length > 0 && !selectedAssetId) {
      const defaultCommodity = COMMODITY_DEFINITIONS[0];
      if (defaultCommodity) setSelectedAssetId(defaultCommodity.id);
    }
  }, [assetType, stocks, selectedAssetId]);

  // 실시간 상태 폴링 (1.5초)
  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/scenarios');
      const data = await res.json();
      if (data.success) {
        setActiveScenarios(data.activeScenarios || []);
        setActiveShocks(data.activeMacroShocks || []);
        setActionLogs(data.logs || []);
      }
    } catch {
      // 폴링 에러 무시
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 1500);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // 선택 가능한 종목 목록 필터링
  const filteredStocks = stocks.filter(
    (s) =>
      s.ticker.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredCommodities = COMMODITY_DEFINITIONS.filter(
    (c) =>
      c.ticker.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.nameKo.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // 현재 선택된 자산 정보
  const currentSelectedStock = stocks.find((s) => s.id === selectedAssetId);
  const currentSelectedCommodity = COMMODITY_DEFINITIONS.find((c) => c.id === selectedAssetId);

  const currentPrice =
    assetType === 'stock'
      ? currentSelectedStock?.current_price ?? 50000
      : currentSelectedCommodity?.basePrice ?? 100;

  const currentTicker =
    assetType === 'stock'
      ? currentSelectedStock?.ticker ?? ''
      : currentSelectedCommodity?.ticker ?? '';

  const currentName =
    assetType === 'stock'
      ? currentSelectedStock?.name ?? ''
      : currentSelectedCommodity?.nameKo ?? '';

  // 1. 작전 세력 주입 실행
  const handleInjectScenario = async () => {
    if (!selectedAssetId || loading) return;
    setLoading(true);

    try {
      const res = await fetch('/api/admin/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'inject_scenario',
          assetType,
          assetId: selectedAssetId,
          ticker: currentTicker,
          name: currentName,
          mode: scenarioMode,
          durationTicks,
          targetChangePct,
          volumeMultiplier,
          initialPrice: currentPrice,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.message || '작전 주입 실패');

      showToast({
        type: 'buy',
        title: `⚡ [${currentTicker}] ${currentName} 작전 주입 완료`,
        description: `모드: ${scenarioMode.toUpperCase()} · 지속: ${durationTicks}틱 · 목표: ${fmtSigned(targetChangePct)}%`,
      });

      fetchStatus();
    } catch (e: any) {
      showToast({
        type: 'error',
        title: '작전 주입 오류',
        description: e.message,
      });
    } finally {
      setLoading(false);
    }
  };

  // 2. 거시경제 충격 발동
  const handleTriggerMacroShock = async (shockType: MacroShockType) => {
    if (loading) return;
    setLoading(true);

    try {
      const res = await fetch('/api/admin/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'trigger_macro_shock',
          shockType,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.message || '충격 발동 실패');

      showToast({
        type: 'warn',
        title: `🚨 ${data.shock?.title || '거시경제 충격 발동'}`,
        description: data.shock?.headline || '전체 시장에 파급효과가 전파됩니다.',
      });

      fetchStatus();
    } catch (e: any) {
      showToast({
        type: 'error',
        title: '거시경제 충격 오류',
        description: e.message,
      });
    } finally {
      setLoading(false);
    }
  };

  // 3. 단일 시나리오 롤백
  const handleRollbackScenario = async (scenarioId: string, ticker: string) => {
    try {
      const res = await fetch('/api/admin/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rollback_scenario',
          scenarioId,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error('롤백 실패');

      showToast({
        type: 'info',
        title: `🔄 [${ticker}] 작전 강제 롤백 완료`,
        description: '해당 종목의 봇 바이어스가 제거되고 정상 시장 로직으로 복귀했습니다.',
      });

      fetchStatus();
    } catch (e: any) {
      showToast({
        type: 'error',
        title: '롤백 실패',
        description: e.message,
      });
    }
  };

  // 4. 전체 긴급 정지 (EMERGENCY HALT ALL)
  const handleEmergencyHaltAll = async () => {
    if (!confirm('🚨 경고: 전체 활성 작전 세력과 거시경제 충격을 즉시 강제 종료하고 시장을 완전 정상화하시겠습니까?')) {
      return;
    }

    try {
      const res = await fetch('/api/admin/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'emergency_halt',
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error('긴급 정지 실패');

      showToast({
        type: 'warn',
        title: '🚨 EMERGENCY HALT ALL: 전체 시장 긴급 롤백 완료',
        description: `작전 ${data.result?.cancelledScenarios}건, 거시충격 ${data.result?.cancelledShocks}건이 즉시 해제되었습니다.`,
      });

      fetchStatus();
    } catch (e: any) {
      showToast({
        type: 'error',
        title: '긴급 정지 실패',
        description: e.message,
      });
    }
  };

  return (
    <div className="space-y-6 font-mono text-xs select-none">
      {/* ── 1. 탑 컨트롤 바: 긴급 전체 정지 버튼 & 상태 요약 ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-[#0E1117] border border-[#212631] shadow-xl">
        <div className="flex items-center gap-3">
          <span className="text-xl">🎛️</span>
          <div>
            <h2 className="text-sm font-black text-white">시나리오 제어기 (Scenario Controller)</h2>
            <p className="text-[11px] text-[#8E939D]">
              작전 세력(매집·펌핑·덤핑) 실시간 주입 및 거시경제 원클릭 충격 발동
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-[#161B22] px-3.5 py-1.5 rounded-xl border border-[#212631]">
            <span className="text-[10px] text-[#565A63] font-bold">활성 작전:</span>
            <span className="font-black text-[#F04452] tabular-nums">{activeScenarios.length}건</span>
            <span className="text-[#565A63]">|</span>
            <span className="text-[10px] text-[#565A63] font-bold">거시 충격:</span>
            <span className="font-black text-amber-400 tabular-nums">{activeShocks.length}건</span>
          </div>

          <button
            onClick={handleEmergencyHaltAll}
            disabled={activeScenarios.length === 0 && activeShocks.length === 0}
            className="px-4 py-2 rounded-xl bg-red-600/20 hover:bg-red-600/40 text-red-400 border border-red-500/40 font-black text-[11px] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-lg active:scale-95"
          >
            🚨 전체 긴급 롤백 (EMERGENCY HALT)
          </button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* ── 2. 좌측 (7): 작전 세력 주입 제어 패널 ── */}
        <div className="col-span-12 lg:col-span-7 space-y-6">
          <div className="bg-[#0E1117] border border-[#212631] rounded-2xl p-5 shadow-xl space-y-4">
            <div className="border-b border-[#212631] pb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">🎯</span>
                <h3 className="font-extrabold text-white text-[13.5px]">작전 세력(Manipulator) 주입기</h3>
              </div>
              <span className="text-[10px] font-bold text-[#F04452] bg-[#F04452]/10 px-2 py-0.5 rounded border border-[#F04452]/30">
                MARKET OVERRIDE
              </span>
            </div>

            {/* 자산 분류 선택 탭 (주식 vs 원자재) */}
            <div className="grid grid-cols-2 gap-2 bg-[#05070A] p-1 rounded-xl border border-[#212631]">
              <button
                onClick={() => {
                  setAssetType('stock');
                  const firstStock = stocks[0];
                  if (firstStock) setSelectedAssetId(firstStock.id);
                }}
                className={`py-2 rounded-lg font-bold text-[11.5px] transition-all cursor-pointer ${
                  assetType === 'stock' ? 'bg-[#212631] text-white shadow' : 'text-[#8E939D] hover:text-white'
                }`}
              >
                📊 국내/해외 주식 ({stocks.length}종목)
              </button>
              <button
                onClick={() => {
                  setAssetType('commodity');
                  const firstCommodity = COMMODITY_DEFINITIONS[0];
                  if (firstCommodity) setSelectedAssetId(firstCommodity.id);
                }}
                className={`py-2 rounded-lg font-bold text-[11.5px] transition-all cursor-pointer ${
                  assetType === 'commodity' ? 'bg-[#212631] text-white shadow' : 'text-[#8E939D] hover:text-white'
                }`}
              >
                🌾 원자재 선물 ({COMMODITY_DEFINITIONS.length}종목)
              </button>
            </div>

            {/* 타겟 종목 검색 & 셀렉트 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-[#8E939D]">
                <span>타겟 종목 선택</span>
                <input
                  type="text"
                  placeholder="티커 / 종목명 검색..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="bg-[#05070A] border border-[#212631] rounded-lg px-2.5 py-1 text-white text-[11px] outline-none focus:border-[#3182F6] w-44"
                />
              </div>

              <select
                value={selectedAssetId}
                onChange={(e) => setSelectedAssetId(e.target.value)}
                className="w-full bg-[#05070A] border border-[#212631] rounded-xl px-3.5 py-2.5 text-white font-mono text-xs outline-none focus:border-[#3182F6]"
              >
                {assetType === 'stock'
                  ? filteredStocks.map((s) => (
                      <option key={s.id} value={s.id}>
                        [{s.ticker}] {s.name} (현재가: ₩{s.current_price.toLocaleString()})
                      </option>
                    ))
                  : filteredCommodities.map((c) => (
                      <option key={c.id} value={c.id}>
                        [{c.ticker}] {c.nameKo} ({c.name}) (기준가: ${c.basePrice.toLocaleString()})
                      </option>
                    ))}
              </select>
            </div>

            {/* 세력 작전 모드 4가지 */}
            <div className="space-y-2">
              <label className="text-[11px] text-[#8E939D] font-bold">작전 세력 운용 모드</label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  { id: 'accumulation', label: '매집 (Accumulation)', icon: '📦', color: 'text-emerald-400' },
                  { id: 'pump', label: '펌핑 (Pump)', icon: '🚀', color: 'text-[#F04452]' },
                  { id: 'dump', label: '덤핑 (Dump)', icon: '💥', color: 'text-[#3182F6]' },
                  { id: 'full_cycle', label: '풀사이클 (Combo)', icon: '🔄', color: 'text-amber-400' },
                ].map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      setScenarioMode(m.id as ScenarioPhase);
                      if (m.id === 'pump') setTargetChangePct(60);
                      else if (m.id === 'dump') setTargetChangePct(-40);
                      else if (m.id === 'accumulation') setTargetChangePct(5);
                      else setTargetChangePct(80);
                    }}
                    className={`p-2.5 rounded-xl border flex flex-col items-center justify-center gap-1 transition-all cursor-pointer ${
                      scenarioMode === m.id
                        ? 'bg-[#161B22] border-[#F04452] shadow-[0_0_12px_rgba(240,68,82,0.3)] font-black text-white'
                        : 'bg-[#05070A] border-[#212631] text-[#8E939D] hover:text-white'
                    }`}
                  >
                    <span className="text-base">{m.icon}</span>
                    <span className={`text-[10.5px] ${m.color}`}>{m.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 슬라이더 제어 파라미터 (지속 틱, 목표 변동률, 거래량 배수) */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2">
              <div className="p-3 bg-[#05070A] rounded-xl border border-[#212631] space-y-1.5">
                <div className="flex justify-between text-[10.5px] text-[#8E939D]">
                  <span>단계별 지속 틱</span>
                  <span className="font-black text-white">{durationTicks} 틱</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="180"
                  step="10"
                  value={durationTicks}
                  onChange={(e) => setDurationTicks(Number(e.target.value))}
                  className="w-full accent-[#F04452] cursor-pointer"
                />
              </div>

              <div className="p-3 bg-[#05070A] rounded-xl border border-[#212631] space-y-1.5">
                <div className="flex justify-between text-[10.5px] text-[#8E939D]">
                  <span>목표 변동률</span>
                  <span
                    className={`font-black ${
                      targetChangePct >= 0 ? 'text-[#F04452]' : 'text-[#3182F6]'
                    }`}
                  >
                    {fmtSigned(targetChangePct)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="-80"
                  max="150"
                  step="5"
                  value={targetChangePct}
                  onChange={(e) => setTargetChangePct(Number(e.target.value))}
                  className="w-full accent-[#F04452] cursor-pointer"
                />
              </div>

              <div className="p-3 bg-[#05070A] rounded-xl border border-[#212631] space-y-1.5">
                <div className="flex justify-between text-[10.5px] text-[#8E939D]">
                  <span>거래량 증폭 배수</span>
                  <span className="font-black text-amber-400">{volumeMultiplier}x</span>
                </div>
                <input
                  type="range"
                  min="1.5"
                  max="8"
                  step="0.5"
                  value={volumeMultiplier}
                  onChange={(e) => setVolumeMultiplier(Number(e.target.value))}
                  className="w-full accent-amber-400 cursor-pointer"
                />
              </div>
            </div>

            {/* 작전 개시 실행 버튼 */}
            <button
              onClick={handleInjectScenario}
              disabled={loading || !selectedAssetId}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-[#F04452] to-[#ff5252] text-white font-black text-xs transition-all cursor-pointer shadow-[0_0_20px_rgba(240,68,82,0.4)] active:scale-[0.99] disabled:opacity-40"
            >
              {loading
                ? '작전 주입 중...'
                : `⚡ [${currentTicker}] ${currentName} 작전 세력 주입 (EXECUTE)`}
            </button>
          </div>

          {/* ── 거시경제 원클릭 충격 발동 패널 ── */}
          <div className="bg-[#0E1117] border border-[#212631] rounded-2xl p-5 shadow-xl space-y-4">
            <div className="border-b border-[#212631] pb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">🌍</span>
                <h3 className="font-extrabold text-white text-[13.5px]">거시경제 충격 원클릭 발동</h3>
              </div>
              <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/30">
                MACRO SHOCK
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[
                {
                  type: 'GEOPOLITICAL_CRISIS' as MacroShockType,
                  title: '💥 지정학적 전쟁 위기',
                  sub: '원유·금·가스 폭등 / 증시 급락',
                  color: 'border-red-500/40 bg-red-500/10 text-red-400',
                },
                {
                  type: 'RATE_HIKE_SHOCK' as MacroShockType,
                  title: '⚡ 기준금리 +100bp 인상',
                  sub: '성장주 폭락 / 채권 금리 폭등',
                  color: 'border-blue-500/40 bg-blue-500/10 text-blue-400',
                },
                {
                  type: 'LIQUIDITY_BOOM' as MacroShockType,
                  title: '🚀 글로벌 유동성 랠리',
                  sub: '전 자산군 동반 신고가 폭등',
                  color: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400',
                },
                {
                  type: 'STAGFLATION_CRACK' as MacroShockType,
                  title: '❄️ 스태그플레이션 위기',
                  sub: '원자재 급등 속 실물 경기 침체',
                  color: 'border-purple-500/40 bg-purple-500/10 text-purple-400',
                },
              ].map((shock) => (
                <button
                  key={shock.type}
                  onClick={() => handleTriggerMacroShock(shock.type)}
                  disabled={loading}
                  className={`p-3.5 rounded-xl border text-left flex flex-col justify-between gap-1.5 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98] ${shock.color}`}
                >
                  <div className="font-extrabold text-[12.5px] text-white">{shock.title}</div>
                  <div className="text-[10px] opacity-80">{shock.sub}</div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── 3. 우측 (5): 실시간 활성 시나리오 모니터 & 롤백 & 감사 로그 ── */}
        <div className="col-span-12 lg:col-span-5 space-y-6">
          {/* 활성 시나리오 모니터링 */}
          <div className="bg-[#0E1117] border border-[#212631] rounded-2xl p-5 shadow-xl space-y-4">
            <div className="border-b border-[#212631] pb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base animate-pulse">📡</span>
                <h3 className="font-extrabold text-white text-[13px]">진행 중인 작전 시나리오</h3>
              </div>
              <span className="text-[10.5px] font-bold text-[#F04452] tabular-nums">
                {activeScenarios.length}개 활성
              </span>
            </div>

            {activeScenarios.length === 0 ? (
              <div className="p-6 bg-[#05070A] rounded-xl border border-[#212631]/60 text-center text-[#565A63] text-[11px] space-y-1">
                <div>현재 시장에 주입된 작전 세력이 없습니다.</div>
                <div className="text-[10px]">시장 자율 균형 및 봇 생태계 정상 가동 중</div>
              </div>
            ) : (
              <div className="space-y-3 max-h-72 overflow-y-auto no-scrollbar">
                {activeScenarios.map((scen) => {
                  const progressPct = ((scen.totalTicks - scen.remainingTicks) / scen.totalTicks) * 100;

                  return (
                    <div
                      key={scen.id}
                      className="p-3.5 rounded-xl bg-[#05070A] border border-[#212631] space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[11px] font-black text-[#F04452] font-mono">{scen.ticker}</span>
                            <span className="font-extrabold text-white text-xs">{scen.name}</span>
                          </div>
                          <div className="text-[10px] text-[#8E939D] mt-0.5">
                            모드: <strong className="text-amber-400 uppercase">{scen.currentStep}</strong> ({scen.mode})
                            · 목표: <strong className="text-white">{fmtSigned(scen.targetChangePct)}%</strong>
                          </div>
                        </div>

                        {/* 개별 롤백 버튼 */}
                        <button
                          onClick={() => handleRollbackScenario(scen.id, scen.ticker)}
                          className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 text-[10px] font-bold transition-colors cursor-pointer shrink-0"
                        >
                          롤백 (Stop)
                        </button>
                      </div>

                      {/* 진행률 바 */}
                      <div className="space-y-1">
                        <div className="flex justify-between text-[9.5px] text-[#565A63]">
                          <span>진행률: {progressPct.toFixed(0)}%</span>
                          <span>잔여 {scen.remainingTicks} / {scen.durationTicks}틱</span>
                        </div>
                        <div className="w-full bg-[#161B22] h-1.5 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-amber-500 to-[#F04452] rounded-full transition-all duration-300"
                            style={{ width: `${Math.max(5, progressPct)}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 감사 로그 (Audit Trail) */}
          <div className="bg-[#0E1117] border border-[#212631] rounded-2xl p-5 shadow-xl space-y-3">
            <div className="border-b border-[#212631] pb-2 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className="text-sm">📜</span>
                <h4 className="font-extrabold text-white text-[12.5px]">관리자 시나리오 실행 감사 로그</h4>
              </div>
              <span className="text-[9.5px] text-[#565A63]">최근 {actionLogs.length}건</span>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto no-scrollbar pr-1">
              {actionLogs.length === 0 ? (
                <div className="p-4 text-center text-[#565A63] text-[11px]">기록된 관리자 작업 이력이 없습니다.</div>
              ) : (
                actionLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-2.5 rounded-xl bg-[#05070A] border border-[#212631]/60 text-[10.5px] space-y-1"
                  >
                    <div className="flex items-center justify-between text-[#565A63]">
                      <span>{fmtKSTTime(new Date(log.timestamp).toISOString())}</span>
                      <span className="font-bold text-white">{log.adminUser}</span>
                    </div>
                    <div className="font-black text-white">{log.targetName || log.actionType}</div>
                    <div className="text-[#8E939D] text-[9.5px] font-sans truncate">
                      {JSON.stringify(log.details)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
