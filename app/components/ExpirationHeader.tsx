"use client";

import React, { useEffect, useState } from 'react';

interface ExpirationHeaderProps {
  ticker: string;
  optionFilter?: 'ALL' | 'CALL' | 'PUT';
  onFilterChange?: (filter: 'ALL' | 'CALL' | 'PUT') => void;
  onOpenConfig?: () => void;
}

export const ExpirationHeader: React.FC<ExpirationHeaderProps> = ({
  ticker,
  optionFilter = 'ALL',
  onFilterChange,
  onOpenConfig,
}) => {
  const [countdownStr, setCountdownStr] = useState("01:24:05");

  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const h = String(15 - now.getHours()).padStart(2, '0');
      const m = String(59 - now.getMinutes()).padStart(2, '0');
      const s = String(59 - now.getSeconds()).padStart(2, '0');
      setCountdownStr(`${Math.max(0, parseInt(h))}:${m}:${s}`);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="bg-[#090B0F] border-b border-[#212631] px-5 py-3.5 flex flex-col gap-3 font-sans select-none">
      {/* 1. 상단 지수 현황 및 베이시스 (Basis) 툴바 */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs border-b border-[#212631]/60 pb-2.5">
        <div className="flex flex-wrap items-center gap-3 font-mono">
          {/* KOSPI 200 현물 / 선물 / 베이시스 */}
          <div className="flex items-center gap-1.5 bg-[#161B22] px-3 py-1 rounded-xl border border-[#212631]">
            <span className="text-[10.5px] text-[#8E939D] font-bold">K200 현물:</span>
            <span className="text-[#F04452] font-black tabular-nums text-[12.5px]">350.20</span>
          </div>

          <div className="flex items-center gap-1.5 bg-[#161B22] px-3 py-1 rounded-xl border border-[#212631]">
            <span className="text-[10.5px] text-[#8E939D] font-bold">K200 선물:</span>
            <span className="text-[#F04452] font-black tabular-nums text-[12.5px]">350.50</span>
          </div>

          <div className="flex items-center gap-1.5 bg-[#F04452]/10 px-3 py-1 rounded-xl border border-[#F04452]/30">
            <span className="text-[10.5px] text-[#8E939D] font-bold">베이시스(Basis):</span>
            <span className="text-[#F04452] font-black tabular-nums text-[12.5px]">+0.30</span>
          </div>

          {/* USD 현물 / 선물 */}
          <div className="hidden lg:flex items-center gap-1.5 bg-[#161B22] px-3 py-1 rounded-xl border border-[#212631]">
            <span className="text-[10.5px] text-[#8E939D] font-bold">USD 현물:</span>
            <span className="text-white font-black tabular-nums text-[12.5px]">1,339.8</span>
          </div>
          <div className="hidden lg:flex items-center gap-1.5 bg-[#161B22] px-3 py-1 rounded-xl border border-[#212631]">
            <span className="text-[10.5px] text-[#8E939D] font-bold">USD 선물:</span>
            <span className="text-white font-black tabular-nums text-[12.5px]">1,340.5</span>
          </div>
        </div>

        {/* 콜/풋 조회 필터 & 환경설정 (⚙️) 버튼 */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-[#161B22] p-1 rounded-xl border border-[#212631]">
            {(['ALL', 'CALL', 'PUT'] as const).map((f) => (
              <button
                key={f}
                onClick={() => onFilterChange?.(f)}
                className={`px-3 py-0.5 text-[11px] font-black rounded-lg transition-all cursor-pointer ${
                  optionFilter === f
                    ? 'bg-[#F04452] text-white shadow-[0_0_8px_rgba(240,68,82,0.4)]'
                    : 'text-[#8E939D] hover:text-white'
                }`}
              >
                {f === 'ALL' ? '콜/풋 전체' : f === 'CALL' ? '콜옵션' : '풋옵션'}
              </button>
            ))}
          </div>

          <button
            onClick={onOpenConfig}
            className="flex items-center gap-1.5 bg-[#161B22] hover:bg-[#212631] text-white border border-[#212631] px-3 py-1 rounded-xl text-[11px] font-bold transition-all cursor-pointer"
          >
            <span>⚙️ 환경설정</span>
          </button>
        </div>
      </div>

      {/* 2. 하단 선택 티커, 기관 롤오버 진행률 및 D-DAY 만기 타이머 */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="flex items-center space-x-3">
          <h1 className="text-xs font-black text-white tracking-wider flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#F04452] animate-pulse shadow-[0_0_8px_#F04452]" />
            <span className="text-[#F04452]">F&O OPTIONS TERMINAL</span>
          </h1>
          <span className="text-xs text-[#8E939D] font-bold">
            선택 옵션: <strong className="text-white font-mono text-[13px]">{ticker}</strong>
          </span>
        </div>

        {/* 롤오버 진행률 게이지 */}
        <div className="flex items-center space-x-3 w-full sm:w-1/3">
          <span className="text-[11px] text-[#8E939D] whitespace-nowrap font-bold">기관 롤오버 진행률:</span>
          <div className="flex-1 bg-[#161B22] h-2.5 rounded-full overflow-hidden border border-[#212631]">
            <div className="bg-gradient-to-r from-[#3182F6] to-[#F04452] h-full w-[68%] transition-all duration-500" />
          </div>
          <span className="text-[11px] text-[#F04452] font-black font-mono">68%</span>
        </div>

        {/* 만기일 타이머 경고 태그 */}
        <div className="flex items-center space-x-2 bg-[#F04452]/15 px-3 py-1 border border-[#F04452]/40 rounded-full animate-pulse shadow-[0_0_12px_rgba(240,68,82,0.2)]">
          <span className="text-[#F04452] text-[11px] font-bold">D-DAY 만기 마감:</span>
          <span className="text-white font-mono font-black text-xs tabular-nums">{countdownStr}</span>
        </div>
      </div>
    </div>
  );
};
