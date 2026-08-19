"use client";

import React, { useState } from 'react';

export interface OptionChainRow {
  strike: number;
  isATM?: boolean;
  // Call option data
  callTicker: string;
  callPrice: number;
  callChange: number;
  callVolume: number;
  callOI: number;
  // Put option data
  putTicker: string;
  putPrice: number;
  putChange: number;
  putVolume: number;
  putOI: number;
}

interface OptionMonthChainGridProps {
  selectedTicker: string;
  onSelectContract: (ticker: string, price: number, type: 'CALL' | 'PUT') => void;
}

export const OptionMonthChainGrid: React.FC<OptionMonthChainGridProps> = ({
  selectedTicker,
  onSelectContract,
}) => {
  const [selectedMonth, setSelectedMonth] = useState<string>("202608");
  const futuresPrice = 260.45;
  const futuresChange = 0.20;
  const futuresChangePct = 0.08;
  const futuresVolume = 126293;

  // HTS [0513] 선물옵션월물별 행가지수 샘플 데이터셋 (290.00 ~ 237.50)
  const rows: OptionChainRow[] = [
    { strike: 290.00, callTicker: "IDX-K200-2608-C290.0", callPrice: 0.01, callChange: 0.00, callVolume: 1, callOI: 1500, putTicker: "IDX-K200-2608-P290.0", putPrice: 30.90, putChange: 0.75, putVolume: 1, putOI: 890 },
    { strike: 287.50, callTicker: "IDX-K200-2608-C287.5", callPrice: 0.01, callChange: 0.00, callVolume: 3, callOI: 2100, putTicker: "IDX-K200-2608-P287.5", putPrice: 28.35, putChange: 0.80, putVolume: 1, putOI: 1040 },
    { strike: 285.00, callTicker: "IDX-K200-2608-C285.0", callPrice: 0.01, callChange: 0.00, callVolume: 62, callOI: 4500, putTicker: "IDX-K200-2608-P285.0", putPrice: 25.35, putChange: -0.15, putVolume: 2, putOI: 1280 },
    { strike: 282.50, callTicker: "IDX-K200-2608-C282.5", callPrice: 0.01, callChange: 0.00, callVolume: 9159, callOI: 18200, putTicker: "IDX-K200-2608-P282.5", putPrice: 23.40, putChange: 0.80, putVolume: 1, putOI: 3100 },
    { strike: 280.00, callTicker: "IDX-K200-2608-C280.0", callPrice: 0.02, callChange: 0.01, callVolume: 2241, callOI: 9400, putTicker: "IDX-K200-2608-P280.0", putPrice: 20.85, putChange: 0.35, putVolume: 1, putOI: 4200 },
    { strike: 277.50, callTicker: "IDX-K200-2608-C277.5", callPrice: 0.02, callChange: -0.01, callVolume: 22630, callOI: 31000, putTicker: "IDX-K200-2608-P277.5", putPrice: 17.90, putChange: 0.50, putVolume: 1, putOI: 5800 },
    { strike: 275.00, callTicker: "IDX-K200-2608-C275.0", callPrice: 0.05, callChange: 0.00, callVolume: 48215, callOI: 54000, putTicker: "IDX-K200-2608-P275.0", putPrice: 16.10, putChange: 0.25, putVolume: 1, putOI: 9100 },
    { strike: 272.50, callTicker: "IDX-K200-2608-C272.5", callPrice: 0.09, callChange: 0.01, callVolume: 74851, callOI: 82000, putTicker: "IDX-K200-2608-P272.5", putPrice: 13.00, putChange: -0.40, putVolume: 22, putOI: 14200 },
    { strike: 270.00, callTicker: "IDX-K200-2608-C270.0", callPrice: 0.16, callChange: 0.01, callVolume: 97090, callOI: 110000, putTicker: "IDX-K200-2608-P270.0", putPrice: 10.50, putChange: -0.40, putVolume: 23, putOI: 21000 },
    { strike: 267.50, callTicker: "IDX-K200-2608-C267.5", callPrice: 0.31, callChange: 0.00, callVolume: 115698, callOI: 125000, putTicker: "IDX-K200-2608-P267.5", putPrice: 8.30, putChange: -0.10, putVolume: 24, putOI: 28400 },
    { strike: 265.00, callTicker: "IDX-K200-2608-C265.0", callPrice: 0.60, callChange: 0.00, callVolume: 157544, callOI: 142000, putTicker: "IDX-K200-2608-P265.0", putPrice: 5.90, putChange: -0.25, putVolume: 513, putOI: 39100 },
    { strike: 262.50, callTicker: "IDX-K200-2608-C262.5", callPrice: 1.18, callChange: -0.05, callVolume: 164637, callOI: 151000, putTicker: "IDX-K200-2608-P262.5", putPrice: 4.05, putChange: -0.25, putVolume: 4787, putOI: 52000 },
    // ATM (등가격 260.00)
    { strike: 260.00, isATM: true, callTicker: "IDX-K200-2608-C260.0", callPrice: 2.15, callChange: -0.01, callVolume: 134673, callOI: 168000, putTicker: "IDX-K200-2608-P260.0", putPrice: 2.57, putChange: -0.19, putVolume: 38744, putOI: 98000 },
    { strike: 257.50, callTicker: "IDX-K200-2608-C257.5", callPrice: 3.60, callChange: 0.05, callVolume: 14239, callOI: 45000, putTicker: "IDX-K200-2608-P257.5", putPrice: 1.51, putChange: -0.15, putVolume: 114615, putOI: 124000 },
    { strike: 255.00, callTicker: "IDX-K200-2608-C255.0", callPrice: 5.45, callChange: 0.05, callVolume: 3705, callOI: 23000, putTicker: "IDX-K200-2608-P255.0", putPrice: 0.85, putChange: -0.11, putVolume: 131403, putOI: 145000 },
    { strike: 252.50, callTicker: "IDX-K200-2608-C252.5", callPrice: 7.50, callChange: 0.05, callVolume: 789, callOI: 12000, putTicker: "IDX-K200-2608-P252.5", putPrice: 0.43, putChange: -0.10, putVolume: 111634, putOI: 118000 },
    { strike: 250.00, callTicker: "IDX-K200-2608-C250.0", callPrice: 9.80, callChange: 0.00, callVolume: 75, callOI: 8500, putTicker: "IDX-K200-2608-P250.0", putPrice: 0.23, putChange: -0.05, putVolume: 88583, putOI: 92000 },
    { strike: 247.50, callTicker: "IDX-K200-2608-C247.5", callPrice: 12.10, callChange: -0.50, callVolume: 27, callOI: 4200, putTicker: "IDX-K200-2608-P247.5", putPrice: 0.14, putChange: -0.03, putVolume: 52450, putOI: 64000 },
    { strike: 245.00, callTicker: "IDX-K200-2608-C245.0", callPrice: 13.85, callChange: -0.55, callVolume: 2, callOI: 1100, putTicker: "IDX-K200-2608-P245.0", putPrice: 0.09, putChange: -0.03, putVolume: 32686, putOI: 41000 },
    { strike: 242.50, callTicker: "IDX-K200-2608-C242.5", callPrice: 16.65, callChange: 0.00, callVolume: 1, callOI: 650, putTicker: "IDX-K200-2608-P242.5", putPrice: 0.07, putChange: -0.01, putVolume: 33685, putOI: 38000 },
    { strike: 240.00, callTicker: "IDX-K200-2608-C240.0", callPrice: 19.15, callChange: -0.10, callVolume: 1, callOI: 420, putTicker: "IDX-K200-2608-P240.0", putPrice: 0.05, putChange: 0.00, putVolume: 28436, putOI: 31000 },
    { strike: 237.50, callTicker: "IDX-K200-2608-C237.5", callPrice: 21.45, callChange: -0.90, callVolume: 1, callOI: 190, putTicker: "IDX-K200-2608-P237.5", putPrice: 0.04, putChange: 0.00, putVolume: 25676, putOI: 26000 },
  ];

  return (
    <div className="flex flex-col h-full bg-[#0E1117] border border-[#212631] rounded-2xl overflow-hidden font-mono select-none shadow-2xl">
      {/* 1. 상단 HTS [0513] 헤더 툴바 */}
      <div className="bg-[#090B0F] px-4 py-2.5 border-b border-[#212631] flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <span className="font-extrabold text-white text-[13px] tracking-wide flex items-center gap-1.5">
            <span className="text-[#F04452] font-black">[0513]</span>
            <span>선물옵션 월물별 행사가 매트릭스</span>
          </span>

          {/* 월물 선택 드롭다운 */}
          <div className="flex items-center gap-1 bg-[#161B22] border border-[#212631] px-2.5 py-1 rounded-lg">
            <select
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="bg-transparent text-white font-extrabold font-mono outline-none cursor-pointer text-xs"
            >
              <option value="202608">202608월물</option>
              <option value="202609">202609월물</option>
              <option value="202610">202610월물</option>
              <option value="202612">202612월물</option>
            </select>
          </div>
        </div>

        {/* 기초 선물 시세 현황 (260.45 ▲ 0.20 +0.08% 126,293) */}
        <div className="flex items-center gap-3 text-[12px] bg-[#161B22] px-3.5 py-1 rounded-xl border border-[#212631] font-mono tabular-nums">
          <span className="text-[#8E939D] font-bold">기초 선물:</span>
          <span className="text-[#F04452] font-black text-[13px]">{futuresPrice.toFixed(2)}</span>
          <span className="text-[#F04452] font-bold">▲ {futuresChange.toFixed(2)}</span>
          <span className="text-[#F04452] font-bold">+{futuresChangePct}%</span>
          <span className="text-[#8E939D] text-[11px]">거래량 {futuresVolume.toLocaleString()}</span>
        </div>
      </div>

      {/* 2. HTS 상단 카테고리 헤더 (콜옵션 / 선물 / 풋옵션) */}
      <div className="grid grid-cols-7 bg-[#090B0F] border-b border-[#212631] text-center font-bold text-[11px]">
        <div className="col-span-3 py-1.5 bg-[#F04452]/10 text-[#F04452] border-r border-[#212631]">
          콜옵션 (CALL OPTION)
        </div>
        <div className="col-span-1 py-1.5 bg-[#161B22] text-amber-400 border-r border-[#212631]">
          선물 / 행사가
        </div>
        <div className="col-span-3 py-1.5 bg-[#3182F6]/10 text-[#3182F6]">
          풋옵션 (PUT OPTION)
        </div>
      </div>

      {/* 3. 세부 7개 서브 컬럼 헤더 */}
      <div className="grid grid-cols-7 bg-[#161B22] border-b border-[#212631] text-[11px] font-extrabold text-[#8E939D] text-center py-1.5">
        <div className="px-2 text-right">거래량</div>
        <div className="px-2 text-right">대비</div>
        <div className="px-2 text-right border-r border-[#212631]">현재가</div>
        <div className="px-2 text-center text-white border-r border-[#212631]">행사가</div>
        <div className="px-2 text-left border-r border-[#212631]">현재가</div>
        <div className="px-2 text-left">대비</div>
        <div className="px-2 text-left">거래량</div>
      </div>

      {/* 4. 선물옵션월물별 메인 3단 대칭 행가 그리드 */}
      <div className="flex-1 overflow-y-auto no-scrollbar divide-y divide-[#212631]/40 bg-[#05070A] text-[12px]">
        {rows.map((row) => {
          const isATM = row.isATM;
          const isCallSelected = selectedTicker === row.callTicker;
          const isPutSelected = selectedTicker === row.putTicker;

          // Call ITM (strike < futuresPrice) vs Put ITM (strike > futuresPrice)
          const isCallITM = row.strike < futuresPrice && !isATM;
          const isPutITM = row.strike > futuresPrice && !isATM;

          return (
            <div
              key={`row-${row.strike}`}
              className={`grid grid-cols-7 items-center h-[30px] font-mono tabular-nums transition-colors ${
                isATM
                  ? 'bg-[#3A3215] border-y-2 border-amber-500/60 font-bold'
                  : 'hover:bg-[#161B22]'
              }`}
            >
              {/* === [콜옵션 영역] 거래량 | 대비 | 현재가 === */}
              <div
                onClick={() => onSelectContract(row.callTicker, row.callPrice, 'CALL')}
                className={`col-span-3 grid grid-cols-3 h-full items-center cursor-pointer border-r border-[#212631] px-1 transition-all ${
                  isCallSelected ? 'bg-[#F04452]/25 ring-1 ring-[#F04452]' : isCallITM ? 'bg-[#F04452]/5' : ''
                }`}
              >
                {/* 1. 콜 거래량 */}
                <div className="text-right text-[#8E939D] text-[11px] pr-2 truncate">
                  {row.callVolume.toLocaleString()}
                </div>

                {/* 2. 콜 대비 */}
                <div className={`text-right text-[11.5px] pr-2 font-bold ${
                  row.callChange > 0 ? 'text-[#F04452]' : row.callChange < 0 ? 'text-[#3182F6]' : 'text-[#8E939D]'
                }`}>
                  {row.callChange > 0 ? `▲ ${row.callChange.toFixed(2)}` : row.callChange < 0 ? `▼ ${Math.abs(row.callChange).toFixed(2)}` : '0'}
                </div>

                {/* 3. 콜 현재가 (프리미엄) */}
                <div className={`text-right text-[12.5px] font-black pr-2 ${
                  row.callChange > 0 ? 'text-[#F04452]' : row.callChange < 0 ? 'text-[#3182F6]' : 'text-white'
                }`}>
                  {row.callPrice.toFixed(2)}
                </div>
              </div>

              {/* === [중앙 앵커] 행사가 (Strike Price) === */}
              <div className={`col-span-1 h-full flex items-center justify-center text-center font-black text-[12.5px] border-r border-[#212631] ${
                isATM ? 'text-amber-400 bg-amber-500/20' : 'text-white bg-[#0E1117]'
              }`}>
                {row.strike.toFixed(2)}
              </div>

              {/* === [풋옵션 영역] 현재가 | 대비 | 거래량 === */}
              <div
                onClick={() => onSelectContract(row.putTicker, row.putPrice, 'PUT')}
                className={`col-span-3 grid grid-cols-3 h-full items-center cursor-pointer px-1 transition-all ${
                  isPutSelected ? 'bg-[#3182F6]/25 ring-1 ring-[#3182F6]' : isPutITM ? 'bg-[#3182F6]/5' : ''
                }`}
              >
                {/* 5. 풋 현재가 (프리미엄) */}
                <div className={`text-left text-[12.5px] font-black pl-2 ${
                  row.putChange > 0 ? 'text-[#F04452]' : row.putChange < 0 ? 'text-[#3182F6]' : 'text-white'
                }`}>
                  {row.putPrice.toFixed(2)}
                </div>

                {/* 6. 풋 대비 */}
                <div className={`text-left text-[11.5px] pl-2 font-bold ${
                  row.putChange > 0 ? 'text-[#F04452]' : row.putChange < 0 ? 'text-[#3182F6]' : 'text-[#8E939D]'
                }`}>
                  {row.putChange > 0 ? `▲ ${row.putChange.toFixed(2)}` : row.putChange < 0 ? `▼ ${Math.abs(row.putChange).toFixed(2)}` : '0'}
                </div>

                {/* 7. 풋 거래량 */}
                <div className="text-left text-[#8E939D] text-[11px] pl-2 truncate">
                  {row.putVolume.toLocaleString()}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 푸터 범례 */}
      <div className="bg-[#090B0F] border-t border-[#212631] px-4 py-2 flex items-center justify-between text-[11px] text-[#8E939D]">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-[#3A3215] border border-amber-500 inline-block" />
            <span className="text-amber-400 font-bold">ATM (등가격 260.00)</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-[#F04452]/20 border border-[#F04452]/40 inline-block" />
            <span>콜 내가격(ITM)</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-[#3182F6]/20 border border-[#3182F6]/40 inline-block" />
            <span>풋 내가격(ITM)</span>
          </span>
        </div>
        <span>원클릭 셀 선택 시 주문 가격이 연동됩니다.</span>
      </div>
    </div>
  );
};
