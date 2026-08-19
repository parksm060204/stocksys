'use client';

import React from 'react';
import { SeasonalityCurve } from '@/lib/commodities/types';
import { calculateSeasonalityLevel } from '@/lib/commodities/priceEngine';

interface SeasonalityPanelProps {
  name: string;
  seasonality?: SeasonalityCurve;
  currentTick: number;
}

export default function CommoditySeasonalityPanel({
  name,
  seasonality,
  currentTick,
}: SeasonalityPanelProps) {
  if (!seasonality || seasonality.period <= 0) {
    return (
      <div className="flex flex-col h-full bg-[#0E1117] border border-[#212631] rounded-2xl p-5 font-mono text-xs shadow-xl">
        <div className="border-b border-[#212631] pb-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">📅</span>
            <h3 className="font-extrabold text-white text-[13.5px]">계절성 분석 (Seasonality Cycle)</h3>
          </div>
          <span className="text-[10px] text-[#8E939D] bg-[#161B22] px-2 py-0.5 rounded border border-[#212631]">
            연중 비계절 상품
          </span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6 text-[#8E939D] space-y-2">
          <div className="text-2xl opacity-40">📊</div>
          <p className="text-[12px] font-medium text-white">{name} 상품은 계절성 영향이 적은 상시 생산/소비 품목입니다.</p>
          <p className="text-[11px] text-[#565A63]">거시경제 지표, 지정학적 이슈, 재고 및 수급 압력에 주로 반응합니다.</p>
        </div>
      </div>
    );
  }

  const { period, amplitude, phase } = seasonality;
  const currentVal = calculateSeasonalityLevel(currentTick, seasonality);
  const currentPhaseTick = currentTick % period;
  const currentPct = (currentPhaseTick / period) * 100;

  // SVG 곡선 생성 (0부터 period까지 샘플링)
  const width = 460;
  const height = 110;
  const padding = 20;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;

  const points: { x: number; y: number }[] = [];
  const steps = 60;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * period;
    const val = amplitude * Math.sin(((2 * Math.PI * t) / period) + phase);
    // val (-amplitude ~ +amplitude) ➔ y (plotHeight ~ 0)
    const normY = (val + amplitude) / (2 * amplitude); // 0 ~ 1
    const x = padding + (i / steps) * plotWidth;
    const y = padding + (1 - normY) * plotHeight;
    points.push({ x, y });
  }

  const pathD = points.reduce((acc, p, idx) => {
    return idx === 0 ? `M ${p.x} ${p.y}` : `${acc} L ${p.x} ${p.y}`;
  }, '');

  // 현재 위상 좌표
  const currentNormY = (currentVal + amplitude) / (2 * amplitude);
  const currentX = padding + (currentPhaseTick / period) * plotWidth;
  const currentY = padding + (1 - currentNormY) * plotHeight;

  const isHighSeason = currentVal > 0.02;
  const isLowSeason = currentVal < -0.02;

  return (
    <div className="flex flex-col h-full bg-[#0E1117] border border-[#212631] rounded-2xl p-5 font-mono text-xs shadow-xl space-y-3.5 select-none">
      <div className="border-b border-[#212631] pb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-base">📅</span>
          <h3 className="font-extrabold text-white text-[13.5px]">계절성 사이클 (Seasonality Cycle)</h3>
        </div>
        <span
          className={`text-[10.5px] font-bold px-2.5 py-0.5 rounded-full border ${
            isHighSeason
              ? 'bg-[#F04452]/10 text-[#F04452] border-[#F04452]/30'
              : isLowSeason
              ? 'bg-[#3182F6]/10 text-[#3182F6] border-[#3182F6]/30'
              : 'bg-[#161B22] text-[#8E939D] border-[#212631]'
          }`}
        >
          {isHighSeason ? '🔥 성수기 (상방 압력)' : isLowSeason ? '❄️ 비수기/수확기 (저점 형성)' : '⚖️ 중립 국면'}
        </span>
      </div>

      {/* SVG 그래프 */}
      <div className="relative bg-[#05070A] rounded-xl border border-[#212631]/60 p-2 overflow-hidden flex items-center justify-center">
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-28 overflow-visible">
          {/* 중앙 기준선 (0% 레벨) */}
          <line
            x1={padding}
            y1={height / 2}
            x2={width - padding}
            y2={height / 2}
            stroke="#212631"
            strokeDasharray="3 3"
            strokeWidth="1"
          />

          {/* 사인함수 계절성 커브 */}
          <path d={pathD} fill="none" stroke="#3182F6" strokeWidth="2.5" strokeLinecap="round" />

          {/* 현재 틱 위상 마커 수직선 */}
          <line
            x1={currentX}
            y1={padding}
            x2={currentX}
            y2={height - padding}
            stroke="#F04452"
            strokeDasharray="2 2"
            strokeWidth="1.5"
          />

          {/* 현재 틱 위상 포인트 */}
          <circle cx={currentX} cy={currentY} r="5" fill="#F04452" className="animate-pulse" />
          <circle cx={currentX} cy={currentY} r="9" fill="none" stroke="#F04452" strokeWidth="1.5" opacity="0.6" />
        </svg>

        {/* 좌우 라벨 */}
        <div className="absolute top-2 left-3 text-[9.5px] text-[#565A63] font-bold">
          고점 (+{(amplitude * 100).toFixed(0)}%)
        </div>
        <div className="absolute bottom-2 left-3 text-[9.5px] text-[#565A63] font-bold">
          저점 (-{(amplitude * 100).toFixed(0)}%)
        </div>
      </div>

      {/* 지표 수치 요약 바 */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="bg-[#161B22] p-2.5 rounded-xl border border-[#212631]/60">
          <div className="text-[10px] text-[#565A63] font-bold mb-0.5">사이클 주기</div>
          <div className="font-black text-white">{period} 틱 (Cycle)</div>
        </div>
        <div className="bg-[#161B22] p-2.5 rounded-xl border border-[#212631]/60">
          <div className="text-[10px] text-[#565A63] font-bold mb-0.5">현재 계절 기여도</div>
          <div className={`font-black ${currentVal >= 0 ? 'text-[#F04452]' : 'text-[#3182F6]'}`}>
            {currentVal >= 0 ? '+' : ''}
            {(currentVal * 100).toFixed(2)}%
          </div>
        </div>
        <div className="bg-[#161B22] p-2.5 rounded-xl border border-[#212631]/60">
          <div className="text-[10px] text-[#565A63] font-bold mb-0.5">사이클 진행률</div>
          <div className="font-black text-white">{currentPct.toFixed(0)}%</div>
        </div>
      </div>
    </div>
  );
}
