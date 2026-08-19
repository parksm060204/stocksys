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
    <div className="bg-[#0E1117] border border-[#212631] p-4 text-xs font-mono rounded-2xl text-white select-none shadow-xl">
      <div className="flex justify-between items-center mb-3 pb-2 border-b border-[#212631]">
        <span className="font-extrabold text-[#F04452] flex items-center gap-1.5 text-[13px]">
          <span>{etfTicker} ({leverage > 0 ? `+${leverage}` : leverage}X)</span>
        </span>
        <span className="text-[10.5px] text-[#8E939D] font-bold">일단위 리밸런싱 현황</span>
      </div>
      
      <div className="space-y-2 mb-3 bg-[#05070A] p-3 rounded-xl border border-[#212631]">
        <div className="flex justify-between">
          <span className="text-[#8E939D] font-medium">목표 노출액:</span>
          <span className="font-bold text-white tabular-nums">{(targetExposure / 1e8).toFixed(1)} 억원</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[#8E939D] font-medium">현재 노출액:</span>
          <span className="font-black text-[#F04452] tabular-nums">
            {(currentExposure / 1e8).toFixed(1)} 억원 ({exposureRatio}%)
          </span>
        </div>
      </div>

      {/* 리밸런싱 예상 알림 */}
      <div className="bg-[#161B22] p-2.5 border border-[#212631] rounded-xl flex justify-between items-center text-[11.5px]">
        <span className="text-[#8E939D] font-bold">장 마감 예상 리밸런싱:</span>
        <span className={`font-black tracking-wide tabular-nums ${isBuy ? 'text-[#F04452]' : 'text-[#3182F6]'}`}>
          {rebalanceSide} {Math.abs(expectedRebalanceQty).toLocaleString()} 계약
        </span>
      </div>
    </div>
  );
};

