'use client';

import { useEffect, useState, useRef } from 'react';
import { useOrderbookData } from '@/lib/hooks/useOrderbookData';
import StrictWidget from './StrictWidget';

interface OrderbookLevel {
  price: number;
  totalSize: number;
}

export default function Orderbook({
  ticker,
  currentPrice,
  stockId,
}: {
  ticker: string;
  currentPrice: number;
  stockId?: string;
}) {
  const { bids, asks, price: livePrice, source } = useOrderbookData(
    stockId ?? '__none__',
    ticker,
    currentPrice,
    800,
  );
  const [flashType, setFlashType] = useState<'up' | 'down' | null>(null);
  const prevPriceRef = useRef<number>(currentPrice);

  // 틱 플래시 감지
  useEffect(() => {
    const p = livePrice || currentPrice;
    if (p !== prevPriceRef.current) {
      const isUp = p > prevPriceRef.current;
      setFlashType(isUp ? 'up' : 'down');
      prevPriceRef.current = p;
      const timer = setTimeout(() => setFlashType(null), 200);
      return () => clearTimeout(timer);
    }
  }, [livePrice, currentPrice]);

  const maxSize = Math.max(...bids.map((b) => b.totalSize), ...asks.map((a) => a.totalSize), 1);
  const totalAskSize = asks.reduce((acc, a) => acc + a.totalSize, 0);
  const totalBidSize = bids.reduce((acc, b) => acc + b.totalSize, 0);

  const AskRow = ({ ask }: { ask: OrderbookLevel }) => {
    const pct = Math.min(100, (ask.totalSize / maxSize) * 100);
    return (
      <div className="grid grid-cols-[1fr_90px_1fr] w-full h-[30px] items-center border-b border-[#1c202c] hover:bg-[#0A84FF]/10 transition-colors">
        {/* 매도잔량 (좌측) */}
        <div className="relative h-full flex items-center justify-end px-3 overflow-hidden">
          <div
            className="absolute right-0 top-0.5 bottom-0.5 bg-[#0A84FF]/20 rounded-none transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
          <span className="z-10 font-mono text-[12px] tabular-nums text-gray-300 truncate font-medium">
            {ask.totalSize.toLocaleString()}
          </span>
        </div>
        {/* 호가 (중앙) */}
        <div className="h-full flex items-center justify-center bg-[#0A84FF]/10 border-x border-[#1c202c] cursor-pointer hover:bg-[#0A84FF]/25 transition-colors">
          <span className="font-mono text-[13px] font-bold tabular-nums text-[#0A84FF]">
            {ask.price.toLocaleString()}
          </span>
        </div>
        {/* 매수잔량 (우측 빈 공간) */}
        <div className="h-full" />
      </div>
    );
  };

  const BidRow = ({ bid }: { bid: OrderbookLevel }) => {
    const pct = Math.min(100, (bid.totalSize / maxSize) * 100);
    return (
      <div className="grid grid-cols-[1fr_90px_1fr] w-full h-[30px] items-center border-b border-[#1c202c] hover:bg-[#FF453A]/10 transition-colors">
        {/* 매도잔량 (좌측 빈 공간) */}
        <div className="h-full" />
        {/* 호가 (중앙) */}
        <div className="h-full flex items-center justify-center bg-[#FF453A]/10 border-x border-[#1c202c] cursor-pointer hover:bg-[#FF453A]/25 transition-colors">
          <span className="font-mono text-[13px] font-bold tabular-nums text-[#FF453A]">
            {bid.price.toLocaleString()}
          </span>
        </div>
        {/* 매수잔량 (우측) */}
        <div className="relative h-full flex items-center justify-start px-3 overflow-hidden">
          <div
            className="absolute left-0 top-0.5 bottom-0.5 bg-[#FF453A]/20 rounded-none transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
          <span className="z-10 font-mono text-[12px] tabular-nums text-gray-300 truncate font-medium">
            {bid.totalSize.toLocaleString()}
          </span>
        </div>
      </div>
    );
  };

  const displayPrice = livePrice || currentPrice;

  return (
    <StrictWidget className="h-full" overflowClass="overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#090a0f] border-b border-[#222736]">
        <span className="text-[13px] font-bold text-[#f3f4f6] tracking-wide flex items-center gap-2">
          <span>호가창</span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#FF453A] animate-pulse" />
        </span>
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
            source === 'db'
              ? 'text-emerald-400/90 bg-emerald-400/10'
              : 'text-amber-400/80 bg-amber-400/10'
          }`}
        >
          {source === 'db' ? 'LIVE (DB)' : 'SIM'}
        </span>
      </div>

      {/* 컬럼 헤더 */}
      <div className="grid grid-cols-[1fr_90px_1fr] w-full border-b border-[#222736] bg-[#141721] py-1.5">
        <span className="text-center text-[11px] text-[#0A84FF] font-semibold tracking-wider">매도잔량</span>
        <span className="text-center text-[11px] text-[#f3f4f6] font-semibold tracking-wider">호가</span>
        <span className="text-center text-[11px] text-[#FF453A] font-semibold tracking-wider">매수잔량</span>
      </div>

      {/* 호가 리스트 */}
      <div className="flex flex-col flex-1 overflow-hidden bg-[#090a0f]">
        {/* 매도 호가 */}
        <div className="flex flex-col flex-1 overflow-y-auto no-scrollbar justify-end">
          {asks.slice().reverse().map((ask) => <AskRow key={`ask-${ask.price}`} ask={ask} />)}
        </div>

        {/* 현재가 앵커 */}
        <div
          className={`grid grid-cols-[1fr_90px_1fr] w-full h-[36px] items-center bg-[#1c202c] border-y-2 border-white/20 z-20 transition-all ${
            flashType === 'up' ? 'flash-up' : flashType === 'down' ? 'flash-down' : ''
          }`}
        >
          <div className="px-3 text-right font-mono text-[11px] text-gray-400 font-medium truncate">
            {totalAskSize.toLocaleString()}
          </div>
          <div className="h-full flex flex-col items-center justify-center bg-[#141721] border-x border-white/20 px-1">
            <span className="text-[9px] text-gray-400 uppercase tracking-widest font-semibold leading-none">현재가</span>
            <span className="font-mono text-[13px] font-black tabular-nums text-[#f3f4f6] leading-tight">
              {displayPrice.toLocaleString()}
            </span>
          </div>
          <div className="px-3 text-left font-mono text-[11px] text-gray-400 font-medium truncate">
            {totalBidSize.toLocaleString()}
          </div>
        </div>

        {/* 매수 호가 */}
        <div className="flex flex-col flex-1 overflow-y-auto no-scrollbar">
          {bids.map((bid) => <BidRow key={`bid-${bid.price}`} bid={bid} />)}
        </div>
      </div>
    </StrictWidget>
  );
}