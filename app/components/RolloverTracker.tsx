"use client";

import { RolloverTrackerState } from "@/lib/engine/optionBotEngine";

interface RolloverTrackerProps {
  data: RolloverTrackerState | null;
  onExecuteUserRollover?: () => void;
}

export default function RolloverTracker({ data, onExecuteUserRollover }: RolloverTrackerProps) {
  if (!data) return null;

  const isContango = data.spreadState === 'CONTANGO';

  return (
    <div className="p-4 bg-[#0d0e14] border border-[#222736] rounded-xl space-y-4 font-sans text-gray-200">
      
      {/* 1. SPREAD MATRIX & CONTANGO / BACKWARDATION BADGE */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1a1d27] pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-lg">🏛️</span>
            <h4 className="text-[14px] font-bold text-white tracking-tight">
              기관 옵션 롤오버 (Rollover Tracker)
            </h4>
          </div>
          <p className="text-[11px] text-gray-400 mt-0.5">
            근월물 청산과 차월물 이월 동시 체결(Combo Order) 수급 현황입니다.
          </p>
        </div>

        {/* Spread Badge */}
        <div className="shrink-0 flex items-center gap-2 font-mono">
          <span className="text-[11px] text-gray-400 font-bold">롤오버 스프레드:</span>
          <span className={`px-2.5 py-1 rounded text-[11px] font-black border flex items-center gap-1.5 ${
            isContango 
              ? "bg-[#FF453A]/10 text-[#FF453A] border-[#FF453A]/40" 
              : "bg-[#0A84FF]/10 text-[#0A84FF] border-[#0A84FF]/40"
          }`}>
            <span>{isContango ? "🔴 CONTANGO" : "🔵 BACKWARDATION"}</span>
            <span>({isContango ? "+" : ""}{data.spread.toLocaleString()}원)</span>
          </span>
        </div>
      </div>

      {/* 2. INSTITUTION ROLLOVER PROGRESS BARS */}
      <div className="space-y-3 bg-[#06070a] p-3.5 rounded-lg border border-[#1a1d27]">
        <div className="text-[11px] font-bold text-amber-400 flex items-center justify-between">
          <span>📊 세력별 롤오버 이월 진행률 (D-Day)</span>
          <span className="text-gray-500 font-mono text-[10px]">실시간 TWAP 집계</span>
        </div>

        {/* Institution 1: 국민연금 (NPS) */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="font-bold text-gray-200">국민연금 (NPS)</span>
            <span className="font-mono text-amber-300 font-bold">{data.npsProgress}% ({data.npsContracts})</span>
          </div>
          <div className="w-full h-2.5 bg-[#141722] rounded-full overflow-hidden border border-[#232a3a]">
            <div 
              className="h-full bg-gradient-to-r from-amber-500 to-yellow-300 rounded-full transition-all duration-500"
              style={{ width: `${data.npsProgress}%` }}
            />
          </div>
        </div>

        {/* Institution 2: 블랙록 (BlackRock) */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="font-bold text-gray-200">블랙록 (BlackRock)</span>
            <span className="font-mono text-emerald-400 font-bold">{data.blackrockProgress}% ({data.blackrockContracts})</span>
          </div>
          <div className="w-full h-2.5 bg-[#141722] rounded-full overflow-hidden border border-[#232a3a]">
            <div 
              className="h-full bg-gradient-to-r from-emerald-500 to-green-300 rounded-full transition-all duration-500"
              style={{ width: `${data.blackrockProgress}%` }}
            />
          </div>
        </div>

        {/* Institution 3: 시타델 (Citadel) */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11.5px]">
            <span className="font-bold text-gray-200">시타델 (Citadel)</span>
            <span className="font-mono text-gray-400 font-bold">{data.citadelProgress}% ({data.citadelContracts})</span>
          </div>
          <div className="w-full h-2.5 bg-[#141722] rounded-full overflow-hidden border border-[#232a3a]">
            <div 
              className="h-full bg-gradient-to-r from-purple-600 to-indigo-400 rounded-full transition-all duration-500"
              style={{ width: `${data.citadelProgress}%` }}
            />
          </div>
        </div>

        <div className="pt-1 text-[11px] text-gray-400 bg-amber-500/5 p-2 rounded border border-amber-500/20">
          💡 <span className="font-bold text-amber-300">TIP:</span> 연기금의 70% 롤오버 진행은 다음 달에도 강세 상승 뷰를 지속 이월하겠다는 세력 신호입니다.
        </div>
      </div>

      {/* 3. LIVE ROLLOVER FEED */}
      <div className="space-y-2">
        <div className="text-[11px] font-bold text-gray-400 flex items-center gap-1.5">
          <span>🔄</span>
          <span>실시간 롤오버 체결 피드 (Live Feed)</span>
        </div>

        <div className="space-y-1.5 font-mono text-[11px]">
          {data.rolloverFeeds.map((feed) => (
            <div key={feed.id} className="p-2 bg-[#06070a] border border-[#1f2330] rounded flex flex-col sm:flex-row sm:items-center justify-between gap-1">
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.2 text-[9.5px] bg-[#3182F6]/20 text-[#3182F6] font-bold rounded border border-[#3182F6]/40">
                  ROLLOVER
                </span>
                <span className="font-bold text-white">[{feed.institution}]</span>
                <span className="text-gray-400">{feed.currTicker}</span>
                <span className="text-amber-400 font-bold">🔄</span>
                <span className="text-white">{feed.nextTicker}</span>
              </div>

              <div className="text-right text-amber-300 font-bold">
                {feed.quantity.toLocaleString()}계약 체결 ({feed.timestamp})
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 4. USER ROLLOVER ACTION BUTTON */}
      {onExecuteUserRollover && (
        <div className="pt-2 border-t border-[#1a1d27] flex items-center justify-between">
          <span className="text-[11px] text-gray-400">내 보유 파생상품 포지션 차월물 원자적 이월</span>
          <button
            onClick={onExecuteUserRollover}
            className="px-4 py-2 bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-400 hover:to-yellow-400 text-black font-black text-[12px] rounded cursor-pointer transition-all shadow-[0_0_10px_rgba(245,197,24,0.3)]"
          >
            🔄 롤오버 원자적 결합 주문 실행
          </button>
        </div>
      )}

    </div>
  );
}
