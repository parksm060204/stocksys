"use client";

import React, { useEffect, useState } from 'react';

interface ExpirationHeaderProps {
  ticker: string;
}

export const ExpirationHeader: React.FC<ExpirationHeaderProps> = ({ ticker }) => {
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
    <div className="bg-[#181a20] border-b border-[#2a2e39] px-4 py-2 flex flex-col sm:flex-row justify-between items-center gap-2 font-sans select-none">
      {/* 종목 및 현물 지수 정보 */}
      <div className="flex items-center space-x-4">
        <h1 className="text-sm font-bold text-yellow-500 tracking-wider flex items-center gap-1.5">
          <span>⚡</span>
          <span>OPTIONS TERMINAL</span>
        </h1>
        <div className="h-4 w-[1px] bg-gray-700 hidden sm:block" />
        <span className="text-xs text-gray-300 hidden sm:inline">
          선택 옵션: <strong className="text-amber-400 font-mono">{ticker}</strong>
        </span>
      </div>

      {/* 롤오버 진행률 게이지 (중앙) */}
      <div className="flex items-center space-x-3 w-full sm:w-1/3">
        <span className="text-[11px] text-gray-400 whitespace-nowrap font-bold">기관 롤오버 진행률:</span>
        <div className="flex-1 bg-[#2a2e39] h-2.5 rounded-full overflow-hidden border border-[#363c4e]">
          <div className="bg-gradient-to-r from-cyan-500 to-blue-500 h-full w-[68%] transition-all duration-500" />
        </div>
        <span className="text-[11px] text-cyan-400 font-bold font-mono">68%</span>
      </div>

      {/* 만기일 타이머 경고 태그 (우측) */}
      <div className="flex items-center space-x-2 bg-[#3a1518] px-3 py-1 border border-red-800 rounded animate-pulse">
        <span className="text-red-400 text-xs font-bold">⚠️ D-DAY 만기 마감까지:</span>
        <span className="text-amber-300 font-mono font-black text-sm">{countdownStr}</span>
      </div>
    </div>
  );
};
