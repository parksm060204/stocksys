"use client";

import React from 'react';

interface OptionChainMatrixProps {
  currentTicker: string;
  onSelectTicker: (ticker: string) => void;
}

export const OptionChainMatrix: React.FC<OptionChainMatrixProps> = ({ currentTicker, onSelectTicker }) => {
  const sampleTickers = [
    { ticker: "IDX-K200-2607-C352.5", type: "CALL", strike: 352.5, price: 4200, oi: 14200, iv: "24%" },
    { ticker: "IDX-K200-2607-C350.0", type: "CALL", strike: 350.0, price: 5800, oi: 22000, iv: "22%" },
    { ticker: "IDX-K200-2607-P350.0", type: "PUT", strike: 350.0, price: 3100, oi: 18500, iv: "23%" },
    { ticker: "IDX-K200-2607-P347.5", type: "PUT", strike: 347.5, price: 2100, oi: 9400, iv: "25%" },
    { ticker: "STK-SAMSUNG-2607-C80000", type: "CALL", strike: 80000, price: 3500, oi: 15000, iv: "28%" },
    { ticker: "FUT-CRUDE-2607-C85", type: "FUT", strike: 85, price: 1800, oi: 8800, iv: "31%" }
  ];

  return (
    <div className="flex flex-col h-full text-xs font-mono select-none">
      {/* Header */}
      <div className="bg-[#1e222d] px-3 py-1.5 border-b border-[#2a2e39] flex justify-between items-center">
        <span className="font-bold text-gray-300 flex items-center gap-1.5">
          <span>🏛️</span>
          <span>옵션 체인 행사가 스위처 (Option Chain Matrix)</span>
        </span>
        <span className="text-[10px] text-gray-400 font-bold">KOSPI 200 / STK / FUT</span>
      </div>

      {/* Grid List */}
      <div className="flex-1 overflow-y-auto p-3 bg-[#0d0e12] space-y-2">
        <div className="text-[11px] font-bold text-gray-400 mb-2 flex items-center justify-between">
          <span>종목 선택 시 X-Ray 호가창 및 실시간 체결피드가 즉시 스위칭됩니다:</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {sampleTickers.map((item) => {
            const isSelected = currentTicker === item.ticker;
            const isCall = item.type === "CALL";
            return (
              <div
                key={item.ticker}
                onClick={() => onSelectTicker(item.ticker)}
                className={`p-3 rounded border cursor-pointer transition-all flex flex-col justify-between space-y-1.5 ${
                  isSelected
                    ? "border-yellow-400 bg-yellow-500/10 text-white shadow-[0_0_15px_rgba(245,197,24,0.2)]"
                    : "border-[#222736] bg-[#141721] text-gray-400 hover:border-gray-500 hover:text-white"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[12px] text-white">{item.ticker}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                    isCall ? "bg-red-500/20 text-[#ef5350]" : "bg-blue-500/20 text-[#42a5f5]"
                  }`}>
                    {item.type}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11px] font-mono text-gray-300">
                  <span>행사가: ₩{item.strike.toLocaleString()}</span>
                  <span className="text-amber-300 font-bold">프리미엄: ₩{item.price.toLocaleString()}</span>
                </div>

                <div className="flex items-center justify-between text-[10px] text-gray-500 pt-1 border-t border-[#1a1d27]">
                  <span>미결제약정(OI): {item.oi.toLocaleString()}</span>
                  <span>IV: {item.iv}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
