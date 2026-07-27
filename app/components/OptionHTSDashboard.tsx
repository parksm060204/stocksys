'use client';

import React, { useState } from 'react';
import { OptionOrderBook } from './OptionOrderBook';
import { OptionChainMatrix } from './OptionChainMatrix';
import { TradeFeed } from './TradeFeed';
import { ExpirationHeader } from './ExpirationHeader';
import { useOptionMarketData } from '@/lib/hooks/useOptionMarketData';

export default function OptionHTSDashboard() {
  const [selectedTicker, setSelectedTicker] = useState<string>('IDX-K200-2607-C352.5');
  const { orderBook, trades, rolloverEvents } = useOptionMarketData(selectedTicker);

  return (
    <div className="w-full h-screen bg-[#0d0e12] text-gray-200 flex flex-col font-mono select-none overflow-hidden">
      {/* 1. 상단 만기일 / 롤오버 모니터링 헤더 */}
      <ExpirationHeader ticker={selectedTicker} />

      {/* 2. 메인 3단 그리드 레이아웃 */}
      <div className="flex-1 grid grid-cols-12 gap-1 p-1 bg-[#16181d] overflow-hidden">
        {/* 좌측: X-Ray 호가창 (3컬럼 차지) */}
        <div className="col-span-12 md:col-span-3 bg-[#0d0e12] border border-[#2a2e39] flex flex-col rounded-sm">
          <OptionOrderBook ticker={selectedTicker} orderBook={orderBook} />
        </div>

        {/* 중앙: 옵션 체인 행사가 스위처 & 차트 (6컬럼 차지) */}
        <div className="col-span-12 md:col-span-6 bg-[#0d0e12] border border-[#2a2e39] flex flex-col rounded-sm">
          <OptionChainMatrix 
            currentTicker={selectedTicker} 
            onSelectTicker={setSelectedTicker} 
          />
        </div>

        {/* 우측: 실시간 체결 / 강제청산 / 롤오버 라이브 피드 (3컬럼 차지) */}
        <div className="col-span-12 md:col-span-3 bg-[#0d0e12] border border-[#2a2e39] flex flex-col rounded-sm">
          <TradeFeed trades={trades} rolloverEvents={rolloverEvents} />
        </div>
      </div>
    </div>
  );
}
