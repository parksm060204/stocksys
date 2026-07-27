'use client';

import React from 'react';

interface LeverageRebalanceWidgetProps {
  etfTicker: string;
  leverage: number;
  nav: number;
  currentExposure: number;
  expectedRebalanceQty: number;
  rebalanceSide: 'BUY' | 'SELL';
}

export const LeverageRebalanceWidget: React.FC<LeverageRebalanceWidgetProps> = ({
  etfTicker,
  leverage,
  nav,
  currentExposure,
  expectedRebalanceQty,
  rebalanceSide
}) => {
  const targetExposure = nav * leverage;
  const exposureRatio = targetExposure !== 0 ? ((currentExposure / targetExposure) * 100).toFixed(1) : "100.0";
  const isBuy = rebalanceSide === 'BUY';

  return (
    <div className="bg-[#0d0e12] border border-[#2a2e39] p-3 text-xs font-mono rounded text-gray-200 select-none">
      <div className="flex justify-between items-center mb-2 pb-1 border-b border-[#1e222d]">
        <span className="font-bold text-yellow-400 flex items-center gap-1.5">
          <span>⚙️</span>
          <span>{etfTicker} ({leverage > 0 ? `+${leverage}` : leverage}X)</span>
        </span>
        <span className="text-[10px] text-gray-400 font-bold">일단위 리밸런싱 현황</span>
      </div>
      
      <div className="space-y-1.5 mb-3 bg-[#141720] p-2.5 rounded border border-[#222736]">
        <div className="flex justify-between">
          <span className="text-gray-400">목표 노출액:</span>
          <span className="font-bold text-white tabular-nums">{(targetExposure / 1e8).toFixed(1)} 억원</span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-400">현재 노출액:</span>
          <span className="font-bold text-amber-300 tabular-nums">
            {(currentExposure / 1e8).toFixed(1)} 억원 ({exposureRatio}%)
          </span>
        </div>
      </div>

      {/* 리밸런싱 예상 알림 */}
      <div className="bg-[#181b22] p-2 border border-[#2a2e39] rounded flex justify-between items-center text-[11px]">
        <span className="text-gray-400 font-semibold">장 마감 예상 리밸런싱:</span>
        <span className={`font-black tracking-wide tabular-nums ${isBuy ? 'text-red-400' : 'text-blue-400'}`}>
          {rebalanceSide} {Math.abs(expectedRebalanceQty).toLocaleString()} 계약
        </span>
      </div>
    </div>
  );
};
