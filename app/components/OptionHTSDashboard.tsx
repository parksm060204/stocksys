'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { OptionMonthChainGrid } from './OptionMonthChainGrid';
import { OptionOrderEntry } from './OptionOrderEntry';
import { OptionAccountPanel } from './OptionAccountPanel';
import { TradeFeed } from './TradeFeed';
import { useOptionMarketData } from '@/lib/hooks/useOptionMarketData';

export default function OptionHTSDashboard() {
  const [selectedTicker, setSelectedTicker] = useState<string>('IDX-K200-2608-C260.0');
  const [selectedPrice, setSelectedPrice] = useState<number>(2.15);
  const [selectedType, setSelectedType] = useState<'CALL' | 'PUT'>('CALL');

  const { trades, rolloverEvents } = useOptionMarketData(selectedTicker);

  const handleSelectContract = (ticker: string, price: number, type: 'CALL' | 'PUT') => {
    setSelectedTicker(ticker);
    setSelectedPrice(price);
    setSelectedType(type);
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-6 space-y-6 select-none">
      {/* Breadcrumb Navigation */}
      <nav className="flex items-center gap-2 text-[12px] text-[#8E939D]">
        <Link href="/" className="hover:text-white font-medium">
          메인홈
        </Link>
        <span>/</span>
        <span className="text-white font-bold">옵션 & 파생상품 터미널 ([0513] 선물옵션월물별)</span>
      </nav>

      {/* Header Banner */}
      <div className="bg-[#0E1117] border border-[#212631] p-6 rounded-3xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-2xl">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#F04452]/40 bg-[#F04452]/10 px-3.5 py-1 text-[11px] font-bold text-[#F04452] mb-2 font-mono">
            <span className="inline-block h-2 w-2 rounded-full bg-[#F04452] animate-pulse" />
            LIVE OPTIONS TERMINAL · [0513] 선물옵션월물별
          </div>
          <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">
            HTS 선물옵션 월물별 행사가 매트릭스
          </h1>
          <p className="text-[12.5px] text-[#8E939D] mt-1 font-medium">
            3단 대칭 행사가 그리드 (콜옵션 - 행사가 - 풋옵션), ATM 등가격 골드 하이라이팅 & 원클릭 HTS 주문 연동
          </p>
        </div>

        <div className="flex gap-6 text-right bg-[#161B22] px-5 py-3 rounded-2xl border border-[#212631] shrink-0 font-mono">
          <div>
            <div className="text-[10px] uppercase font-bold tracking-wider text-[#8E939D]">선택 계약</div>
            <div className={`text-[14px] font-black ${selectedType === 'CALL' ? 'text-[#F04452]' : 'text-[#3182F6]'}`}>
              {selectedTicker}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold tracking-wider text-[#8E939D]">선택가</div>
            <div className="text-[14px] font-black text-white tabular-nums">₩{selectedPrice.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* HTS 메인 2열 레이아웃: 좌측 [0513] 월물별 행사가 매트릭스 (8컬럼) + 우측 HTS 주문/계좌 (4컬럼) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 min-h-[640px]">
        {/* 좌측: [0513] 선물옵션월물별 행사가 매트릭스 (8컬럼 차지) */}
        <div className="col-span-12 md:col-span-8 flex flex-col min-h-[640px]">
          <OptionMonthChainGrid
            selectedTicker={selectedTicker}
            onSelectContract={handleSelectContract}
          />
        </div>

        {/* 우측: HTS 주문 실행 패널 & 계좌 잔고/미체결 (4컬럼 차지) */}
        <div className="col-span-12 md:col-span-4 flex flex-col gap-6">
          <OptionOrderEntry
            ticker={selectedTicker}
            currentPrice={selectedPrice}
          />

          <div className="flex-1">
            <OptionAccountPanel />
          </div>
        </div>
      </div>

      {/* 하단 실시간 체결 & 기관 롤오버 피드 */}
      <div className="bg-[#0E1117] border border-[#212631] rounded-2xl p-4 shadow-2xl">
        <h3 className="text-xs font-black text-white mb-3 flex items-center justify-between font-mono">
          <span>실시간 옵션 체결 & 기관 롤오버 라이브 피드</span>
          <span className="text-[10px] text-[#F04452] font-bold">LIVE FEED</span>
        </h3>
        <TradeFeed trades={trades} rolloverEvents={rolloverEvents} />
      </div>
    </div>
  );
}
