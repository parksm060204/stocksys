"use client";

import React from 'react';

interface OrderBookProps {
  ticker: string;
  orderBook: { bids: [number, number][]; asks: [number, number][] };
}

export const OptionOrderBook: React.FC<OrderBookProps> = ({ ticker, orderBook }) => {
  const defaultAsks: [number, number][] = orderBook.asks.length > 0 
    ? orderBook.asks 
    : [[3600, 1200], [3550, 2400], [3500, 1800], [3450, 950], [3400, 3100]];

  const defaultBids: [number, number][] = orderBook.bids.length > 0 
    ? orderBook.bids 
    : [[3350, 4200], [3300, 1900], [3250, 2800], [3200, 1500], [3150, 3900]];

  const maxAskVolume = Math.max(...defaultAsks.map(([, qty]) => qty), 1);
  const maxBidVolume = Math.max(...defaultBids.map(([, qty]) => qty), 1);

  return (
    <div className="flex flex-col h-full text-xs font-mono select-none">
      {/* 헤더 */}
      <div className="bg-[#1e222d] px-3 py-1.5 border-b border-[#2a2e39] flex justify-between items-center">
        <span className="font-bold text-gray-300 flex items-center gap-1.5">
          <span>📊</span>
          <span>X-Ray 10호가창</span>
        </span>
        <span className="text-[10px] text-amber-400 font-bold">{ticker}</span>
      </div>

      {/* 호가 그리드 테이블 */}
      <div className="flex-1 flex flex-col justify-between overflow-hidden p-1 bg-[#0d0e12]">
        {/* 매도 호가 (Asks) - 역순 출력 */}
        <div className="flex flex-col justify-end space-y-0.5 flex-1">
          {defaultAsks.slice().reverse().map(([price, qty], idx) => {
            const fillWidth = `${(qty / maxAskVolume) * 100}%`;
            return (
              <div key={`ask-${idx}`} className="relative flex justify-between items-center h-5 px-2 bg-[#1a1315] rounded-xs overflow-hidden">
                {/* 물량 잔량 막대 (파란색 계열) */}
                <div className="absolute right-0 top-0 bottom-0 bg-[#263238] opacity-60 z-0" style={{ width: fillWidth }} />
                <span className="z-10 text-[#42a5f5] font-semibold tabular-nums">₩{price.toFixed(0)}</span>
                <span className="z-10 text-gray-300 font-bold tabular-nums">{qty.toLocaleString()}</span>
              </div>
            );
          })}
        </div>

        {/* 현재가 경계선 */}
        <div className="my-1 py-1 bg-[#1e222d] text-center font-bold text-amber-300 border-y border-[#363c4e] text-[11px]">
          ⚖️ 체결 중앙선 (Spread Equilibrium)
        </div>

        {/* 매수 호가 (Bids) */}
        <div className="flex flex-col justify-start space-y-0.5 flex-1">
          {defaultBids.map(([price, qty], idx) => {
            const fillWidth = `${(qty / maxBidVolume) * 100}%`;
            return (
              <div key={`bid-${idx}`} className="relative flex justify-between items-center h-5 px-2 bg-[#1c1416] rounded-xs overflow-hidden">
                {/* 물량 잔량 막대 (빨간색 계열) */}
                <div className="absolute right-0 top-0 bottom-0 bg-[#3e2723] opacity-60 z-0" style={{ width: fillWidth }} />
                <span className="z-10 text-[#ef5350] font-semibold tabular-nums">₩{price.toFixed(0)}</span>
                <span className="z-10 text-gray-300 font-bold tabular-nums">{qty.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
