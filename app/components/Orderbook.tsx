'use client';

import { memo } from 'react';
import { useOrderbookData } from '@/lib/hooks/useOrderbookData';
import StrictWidget from './StrictWidget';

interface OrderbookLevel {
  price: number;
  totalSize: number;
}

const AskRow = memo(({ ask, maxSize }: { ask: OrderbookLevel; maxSize: number }) => {
  const pct = Math.min(100, (ask.totalSize / maxSize) * 100);
  return (
    <div className="grid grid-cols-[1fr_90px_1fr] w-full h-[32px] items-center border-b border-[#212631]/60 hover:bg-[#3182F6]/10 transition-colors font-mono">
      <div className="relative h-full flex items-center justify-end px-3 overflow-hidden">
        <div className="absolute right-0 top-0.5 bottom-0.5 bg-[#3182F6]/20 transition-all duration-300" style={{ width: `${pct}%` }} />
        <span className="z-10 text-[12px] tabular-nums text-[#8E939D] truncate font-bold">
          {ask.totalSize.toLocaleString()}
        </span>
      </div>
      <div className="h-full flex items-center justify-center bg-[#3182F6]/10 border-x border-[#212631] cursor-pointer hover:bg-[#3182F6]/25 transition-colors">
        <span className="text-[13px] font-black tabular-nums text-[#3182F6]">
          {ask.price.toLocaleString()}
        </span>
      </div>
      <div className="h-full bg-[#05070A]" />
    </div>
  );
});
AskRow.displayName = 'AskRow';

const BidRow = memo(({ bid, maxSize }: { bid: OrderbookLevel; maxSize: number }) => {
  const pct = Math.min(100, (bid.totalSize / maxSize) * 100);
  return (
    <div className="grid grid-cols-[1fr_90px_1fr] w-full h-[32px] items-center border-b border-[#212631]/60 hover:bg-[#F04452]/10 transition-colors font-mono">
      <div className="h-full bg-[#05070A]" />
      <div className="h-full flex items-center justify-center bg-[#F04452]/10 border-x border-[#212631] cursor-pointer hover:bg-[#F04452]/25 transition-colors">
        <span className="text-[13px] font-black tabular-nums text-[#F04452]">
          {bid.price.toLocaleString()}
        </span>
      </div>
      <div className="relative h-full flex items-center justify-start px-3 overflow-hidden">
        <div className="absolute left-0 top-0.5 bottom-0.5 bg-[#F04452]/20 transition-all duration-300" style={{ width: `${pct}%` }} />
        <span className="z-10 text-[12px] tabular-nums text-[#8E939D] truncate font-bold">
          {bid.totalSize.toLocaleString()}
        </span>
      </div>
    </div>
  );
});
BidRow.displayName = 'BidRow';

export default function Orderbook({
  ticker,
  currentPrice,
  stockId,
}: {
  ticker: string;
  currentPrice: number;
  stockId?: string;
}) {
  const { bids, asks, source } = useOrderbookData(
    stockId ?? '__none__',
    ticker,
    currentPrice,
    2000,
  );
  const maxSize = Math.max(...bids.map((b) => b.totalSize), ...asks.map((a) => a.totalSize), 1);
  const totalAskSize = asks.reduce((acc, a) => acc + a.totalSize, 0);
  const totalBidSize = bids.reduce((acc, b) => acc + b.totalSize, 0);
  const totalSum = totalAskSize + totalBidSize;

  return (
    <StrictWidget className="h-full" overflowClass="overflow-hidden">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#090B0F] border-b border-[#212631]">
        <span className="text-[13.5px] font-mono font-black text-white tracking-wide flex items-center gap-2">
          <span>호가창 (ORDER BOOK)</span>
          <span className="w-2 h-2 rounded-full bg-[#F04452] animate-pulse shadow-[0_0_8px_#F04452]" />
        </span>
        <span className={`text-[10px] font-mono font-black px-2.5 py-0.5 rounded-full border ${source === 'db' ? 'text-[#F04452] bg-[#F04452]/10 border-[#F04452]/30' : 'text-amber-400 bg-amber-400/10 border-amber-400/30'}`}>
          {source === 'db' ? 'LIVE DB' : 'SIM'}
        </span>
      </div>

      {/* 컬럼 헤더 */}
      <div className="grid grid-cols-[1fr_90px_1fr] w-full border-b border-[#212631] bg-[#0E1117] py-2 font-mono">
        <span className="text-center text-[11.5px] text-[#3182F6] font-black tracking-wider">매도잔량</span>
        <span className="text-center text-[11.5px] text-white font-black tracking-wider">호가</span>
        <span className="text-center text-[11.5px] text-[#F04452] font-black tracking-wider">매수잔량</span>
      </div>

      {/* 호가 리스트 */}
      <div className="flex flex-col flex-1 overflow-hidden bg-[#05070A]">
        <div className="flex flex-col flex-1 overflow-y-auto no-scrollbar justify-end">
          {asks.slice().reverse().map((ask) => <AskRow key={`ask-${ask.price}`} ask={ask} maxSize={maxSize} />)}
        </div>

        <div className="flex flex-col flex-1 overflow-y-auto no-scrollbar">
          {bids.map((bid) => <BidRow key={`bid-${bid.price}`} bid={bid} maxSize={maxSize} />)}
        </div>
      </div>

      {/* 푸터 */}
      <div className="grid grid-cols-3 w-full bg-[#0E1117] border-t border-[#212631] py-2 font-mono tabular-nums text-[11.5px]">
        <span className="text-center text-[#3182F6] font-black">{totalAskSize.toLocaleString()}</span>
        <span className="text-center text-[#8E939D] font-bold">{totalSum.toLocaleString()}</span>
        <span className="text-center text-[#F04452] font-black">{totalBidSize.toLocaleString()}</span>
      </div>

    </StrictWidget>
  );
}