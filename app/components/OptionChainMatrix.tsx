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
      <div className="bg-[#090B0F] px-4 py-3 border-b border-[#212631] flex justify-between items-center">
        <span className="font-extrabold text-white text-[13px] tracking-wide">
          옵션 체인 행사가 스위처 (OPTION MATRIX)
        </span>
        <span className="text-[10.5px] text-[#8E939D] font-bold">KOSPI 200 / STK / FUT</span>
      </div>

      {/* Grid List */}
      <div className="flex-1 overflow-y-auto p-4 bg-[#05070A] space-y-3">
        <div className="text-[11px] font-bold text-[#8E939D] flex items-center justify-between">
          <span>종목 클릭 시 X-Ray 호가창 및 실시간 체결피드가 즉시 스위칭됩니다:</span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {sampleTickers.map((item) => {
            const isSelected = currentTicker === item.ticker;
            const isCall = item.type === "CALL";
            return (
              <div
                key={item.ticker}
                onClick={() => onSelectTicker(item.ticker)}
                className={`p-3.5 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between space-y-2 ${
                  isSelected
                    ? "border-[#F04452] bg-[#F04452]/10 text-white shadow-[0_0_15px_rgba(240,68,82,0.2)]"
                    : "border-[#212631] bg-[#0E1117] text-[#8E939D] hover:border-white/20 hover:bg-[#161B22]"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-extrabold text-[12.5px] text-white tracking-tight">{item.ticker}</span>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
                    isCall ? "bg-[#F04452]/15 text-[#F04452] border-[#F04452]/30" : "bg-[#3182F6]/15 text-[#3182F6] border-[#3182F6]/30"
                  }`}>
                    {item.type}
                  </span>
                </div>

                <div className="flex items-center justify-between text-[11.5px] font-mono">
                  <span className="text-[#8E939D]">행사가: ₩{item.strike.toLocaleString()}</span>
                  <span className="text-[#F04452] font-black">프리미엄: ₩{item.price.toLocaleString()}</span>
                </div>

                <div className="flex items-center justify-between text-[10.5px] text-[#565A63] pt-1.5 border-t border-[#212631] font-medium">
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

