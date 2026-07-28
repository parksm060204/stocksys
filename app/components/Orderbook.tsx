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

  const displayPrice = livePrice || currentPrice;
  const totalSum = totalAskSize + totalBidSize;

  const AskRow = ({ ask }: { ask: OrderbookLevel }) => {
    const pct = Math.min(100, (ask.totalSize / maxSize) * 100);
    const isCurrentPrice = ask.price === displayPrice;

    return (
      <div className={`grid grid-cols-[1fr_90px_1fr] w-full h-[30px] items-center border-b border-[#1c202c] hover:bg-[#0A84FF]/10 transition-colors ${
        isCurrentPrice ? 'bg-[#0A84FF]/15' : ''
      }`}>
        {/* 매도잔량 (좌측) */}
        <div className="relative h-full flex items-center justify-end px-3 overflow-hidden">
          <div
            className="absolute right-0 top-0.5 bottom-0.5 bg-[#0A84FF]/25 rounded-none transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
          <span className="z-10 font-mono text-[12px] tabular-nums text-gray-200 truncate font-medium">
            {ask.totalSize.toLocaleString()}
          </span>
        </div>

        {/* 매도 호가 (중앙 - 현재가일 경우 하이라이트 박스) */}
        <div className={`h-full flex items-center justify-center border-x border-[#1c202c] cursor-pointer hover:bg-[#0A84FF]/25 transition-colors ${
          isCurrentPrice ? 'border-2 border-[#0A84FF] font-black bg-[#0A84FF]/30' : 'bg-[#0A84FF]/10'
        }`}>
          <span className="font-mono text-[13px] font-bold tabular-nums text-[#0A84FF]">
            {ask.price.toLocaleString()}
          </span>
        </div>

        {/* 우측 빈 공간 */}
        <div className="h-full" />
      </div>
    );
  };

  const BidRow = ({ bid }: { bid: OrderbookLevel }) => {
    const pct = Math.min(100, (bid.totalSize / maxSize) * 100);
    const isCurrentPrice = bid.price === displayPrice;

    return (
      <div className={`grid grid-cols-[1fr_90px_1fr] w-full h-[30px] items-center border-b border-[#1c202c] hover:bg-[#FF453A]/10 transition-colors ${
        isCurrentPrice ? 'bg-[#FF453A]/15' : ''
      }`}>
        {/* 좌측 빈 공간 */}
        <div className="h-full" />

        {/* 매수 호가 (중앙 - 현재가일 경우 하이라이트 박스) */}
        <div className={`h-full flex items-center justify-center border-x border-[#1c202c] cursor-pointer hover:bg-[#FF453A]/25 transition-colors ${
          isCurrentPrice ? 'border-2 border-[#FF453A] font-black bg-[#FF453A]/30' : 'bg-[#FF453A]/10'
        }`}>
          <span className="font-mono text-[13px] font-bold tabular-nums text-[#FF453A]">
            {bid.price.toLocaleString()}
          </span>
        </div>

        {/* 매수잔량 (우측) */}
        <div className="relative h-full flex items-center justify-start px-3 overflow-hidden">
          <div
            className="absolute left-0 top-0.5 bottom-0.5 bg-[#FF453A]/25 rounded-none transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
          <span className="z-10 font-mono text-[12px] tabular-nums text-gray-200 truncate font-medium">
            {bid.totalSize.toLocaleString()}
          </span>
        </div>
      </div>
    );
  };

  return (
    <StrictWidget className="h-full flex flex-col" overflowClass="overflow-hidden">
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

      {/* 호가 리스트 (상단 10 매도호가 + 하단 10 매수호가) */}
      <div className="flex flex-col flex-1 overflow-hidden bg-[#090a0f]">
        {/* 매도 호가 (10단계 내림차순) */}
        <div className="flex flex-col flex-1 overflow-y-auto no-scrollbar justify-end border-b border-[#222736]/60">
          {asks.slice().reverse().map((ask) => (
            <AskRow key={`ask-${ask.price}`} ask={ask} />
          ))}
        </div>

        {/* 매수 호가 (10단계 내림차순) */}
        <div className="flex flex-col flex-1 overflow-y-auto no-scrollbar">
          {bids.map((bid) => (
            <BidRow key={`bid-${bid.price}`} bid={bid} />
          ))}
        </div>
      </div>

      {/* 호가창 맨 아래 정답지 스타일 표준 푸터 (총매도 / 총잔량 / 총매수) */}
      <div className="grid grid-cols-[1fr_auto_1fr] w-full bg-[#141721] border-t border-[#222736] py-2 px-3 items-center shrink-0 font-mono text-[12px] font-bold">
        <div className="flex items-center justify-start gap-1.5 text-[#0A84FF]">
          <span className="text-[10px] bg-[#0A84FF]/15 px-1 py-0.5 rounded text-[#0A84FF]">총매도</span>
          <span>{totalAskSize.toLocaleString()}</span>
        </div>
        <div className="text-center text-[11px] text-gray-400 font-semibold px-2">
          <span>총잔량</span> <span className="text-gray-200">{totalSum.toLocaleString()}</span>
        </div>
        <div className="flex items-center justify-end gap-1.5 text-[#FF453A]">
          <span>{totalBidSize.toLocaleString()}</span>
          <span className="text-[10px] bg-[#FF453A]/15 px-1 py-0.5 rounded text-[#FF453A]">총매수</span>
        </div>
      </div>
    </StrictWidget>
  );
}