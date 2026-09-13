'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { useOrderbookData } from '@/lib/hooks/useOrderbookData';
import StrictWidget from './StrictWidget';

interface OrderbookLevel {
  price: number;
  totalSize: number;
}

// 매도 호가 행 (키움 MTS 스타일 직사각형 테두리 박스 & 시작가 흑백 분기)
const AskRow = memo(({
  ask,
  maxSize,
  basePrice,
  openPrice,
  isLastTraded,
}: {
  ask: OrderbookLevel;
  maxSize: number;
  basePrice: number;
  openPrice?: number;
  isLastTraded: boolean;
}) => {
  const pct = Math.min(100, Math.max(2, (ask.totalSize / Math.max(maxSize, 1)) * 100));
  const prevSizeRef = useRef(ask.totalSize);
  const [delta, setDelta] = useState<number | null>(null);

  const refPrice = openPrice && openPrice > 0 ? openPrice : basePrice;
  const changeRate = refPrice > 0 ? ((ask.price - refPrice) / refPrice) * 100 : 0;
  const isZero = ask.price === refPrice || Math.abs(changeRate) < 0.0001;
  const isUp = ask.price > refPrice;

  // 시작가(보합)는 라이트모드 검정, 다크모드 하양 / 상승은 빨강 / 하락은 파랑
  const priceColorClass = isZero
    ? 'text-black dark:text-white'
    : isUp
    ? 'text-up'
    : 'text-down';

  const rateColorClass = isZero
    ? 'text-neutral-700 dark:text-neutral-300'
    : isUp
    ? 'text-up/85'
    : 'text-down/85';

  const borderBoxClass = isZero
    ? 'border-2 border-neutral-900 dark:border-white bg-neutral-900/10 dark:bg-white/10 z-10 shadow-sm'
    : isUp
    ? 'border-2 border-[#F04452] bg-up/10 z-10 shadow-sm'
    : 'border-2 border-[#3182F6] bg-down/10 z-10 shadow-sm';

  useEffect(() => {
    const diff = ask.totalSize - prevSizeRef.current;
    if (diff !== 0 && Math.abs(diff) >= 5) {
      setDelta(diff);
      const timer = setTimeout(() => setDelta(null), 400); // 0.3~0.4초 후 자동 소멸
      prevSizeRef.current = ask.totalSize;
      return () => clearTimeout(timer);
    }
    prevSizeRef.current = ask.totalSize;
  }, [ask.totalSize]);

  return (
    <div className="grid grid-cols-[1.1fr_108px_1.1fr] w-full h-full items-center border-b border-[#1e2230]/40 transition-colors font-mono select-none hover:bg-down/10">
      {/* 매도 잔량 열 (좌측 끝 증감 델타 + 우측 잔량) */}
      <div className="relative h-full flex items-center justify-between px-2 overflow-hidden">
        {/* 좌측 증감 델타 (+-n) */}
        <div className="w-[45px] text-left z-10">
          {delta !== null && (
            <span
              className={`text-[9.5px] font-bold tracking-tight animate-fade-in ${
                delta > 0 ? 'text-up' : 'text-down'
              }`}
            >
              {delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString()}
            </span>
          )}
        </div>

        {/* 잔량 막대 게이지 */}
        <div
          className="absolute right-0 top-0.5 bottom-0.5 bg-down/15 rounded-l-xs pointer-events-none"
          style={{ width: `${pct}%` }}
        />
        {/* 잔량 수치 */}
        <span className="z-10 text-[10.5px] tabular-nums text-[#8E939D] truncate font-medium">
          {ask.totalSize.toLocaleString()}
        </span>
      </div>

      {/* 호가 가격 열 (시작가 흑백 / 체결가 사각 테두리 박스) */}
      <div
        className={`h-full flex items-center justify-center border-x cursor-pointer transition-all px-1 relative ${
          isLastTraded
            ? borderBoxClass
            : isZero
            ? 'bg-neutral-500/10 border-[#1e2230]/70'
            : 'bg-down/5 border-[#1e2230]/70 hover:bg-down/20'
        }`}
      >
        <div className="flex items-center justify-between w-full px-1">
          <span className={`text-xs font-bold tabular-nums flex-1 text-right pr-1.5 ${priceColorClass}`}>
            {ask.price.toLocaleString()}
          </span>
          <span className={`text-[10px] font-medium tabular-nums w-[38px] text-right tracking-tight shrink-0 ${rateColorClass}`}>
            {isZero ? '0.00%' : changeRate > 0 ? `+${changeRate.toFixed(2)}%` : `${changeRate.toFixed(2)}%`}
          </span>
        </div>
      </div>

      {/* 매수측 빈칸 */}
      <div className="h-full bg-bg" />
    </div>
  );
});
AskRow.displayName = 'AskRow';

// 매수 호가 행 (키움 MTS 스타일 직사각형 테두리 박스 & 시작가 흑백 분기)
const BidRow = memo(({
  bid,
  maxSize,
  basePrice,
  openPrice,
  isLastTraded,
}: {
  bid: OrderbookLevel;
  maxSize: number;
  basePrice: number;
  openPrice?: number;
  isLastTraded: boolean;
}) => {
  const pct = Math.min(100, Math.max(2, (bid.totalSize / Math.max(maxSize, 1)) * 100));
  const prevSizeRef = useRef(bid.totalSize);
  const [delta, setDelta] = useState<number | null>(null);

  const refPrice = openPrice && openPrice > 0 ? openPrice : basePrice;
  const changeRate = refPrice > 0 ? ((bid.price - refPrice) / refPrice) * 100 : 0;
  const isZero = bid.price === refPrice || Math.abs(changeRate) < 0.0001;
  const isUp = bid.price > refPrice;

  // 시작가(보합)는 라이트모드 검정, 다크모드 하양 / 상승은 빨강 / 하락은 파랑
  const priceColorClass = isZero
    ? 'text-tx'
    : isUp
    ? 'text-up'
    : 'text-down';

  const rateColorClass = isZero
    ? 'text-muted'
    : isUp
    ? 'text-up/85'
    : 'text-down/85';

  const borderBoxClass = isZero
    ? 'border-2 border-border bg-panel z-10 shadow-sm'
    : isUp
    ? 'border-2 border-[#F04452] bg-up/10 z-10 shadow-sm'
    : 'border-2 border-[#3182F6] bg-down/10 z-10 shadow-sm';

  useEffect(() => {
    const diff = bid.totalSize - prevSizeRef.current;
    if (diff !== 0 && Math.abs(diff) >= 5) {
      setDelta(diff);
      const timer = setTimeout(() => setDelta(null), 400);
      prevSizeRef.current = bid.totalSize;
      return () => clearTimeout(timer);
    }
    prevSizeRef.current = bid.totalSize;
  }, [bid.totalSize]);

  return (
    <div className="grid grid-cols-[1.1fr_108px_1.1fr] w-full h-full items-center border-b border-border/40 transition-colors font-mono select-none hover:bg-up/10">
      {/* 매도측 빈칸 */}
      <div className="h-full bg-bg" />

      {/* 호가 가격 열 (시작가 흑백 / 체결가 사각 테두리 박스) */}
      <div
        className={`h-full flex items-center justify-center border-x cursor-pointer transition-all px-1 relative ${
          isLastTraded
            ? borderBoxClass
            : isZero
            ? 'bg-neutral-500/10 border-[#1e2230]/70'
            : 'bg-up/5 border-[#1e2230]/70 hover:bg-up/20'
        }`}
      >
        <div className="flex items-center justify-between w-full px-1">
          <span className={`text-xs font-bold tabular-nums flex-1 text-right pr-1.5 ${priceColorClass}`}>
            {bid.price.toLocaleString()}
          </span>
          <span className={`text-[10px] font-medium tabular-nums w-[38px] text-right tracking-tight shrink-0 ${rateColorClass}`}>
            {isZero ? '0.00%' : changeRate > 0 ? `+${changeRate.toFixed(2)}%` : `${changeRate.toFixed(2)}%`}
          </span>
        </div>
      </div>

      {/* 매수 잔량 열 (좌측 잔량 + 우측 끝 증감 델타) */}
      <div className="relative h-full flex items-center justify-between px-2 overflow-hidden">
        {/* 잔량 막대 게이지 */}
        <div
          className="absolute left-0 top-0.5 bottom-0.5 bg-up/15 rounded-r-xs pointer-events-none"
          style={{ width: `${pct}%` }}
        />
        {/* 잔량 수치 */}
        <span className="z-10 text-[10.5px] tabular-nums text-[#8E939D] truncate font-medium">
          {bid.totalSize.toLocaleString()}
        </span>

        {/* 우측 끝 증감 델타 (+-n) */}
        <div className="w-[45px] text-right z-10">
          {delta !== null && (
            <span
              className={`text-[9.5px] font-bold tracking-tight animate-fade-in ${
                delta > 0 ? 'text-up' : 'text-down'
              }`}
            >
              {delta > 0 ? `+${delta.toLocaleString()}` : delta.toLocaleString()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
});
BidRow.displayName = 'BidRow';

export default function Orderbook({
  ticker,
  currentPrice,
  stockId,
  openPrice,
}: {
  ticker: string;
  currentPrice: number;
  stockId?: string;
  openPrice?: number;
}) {
  const { bids, asks, trades, price, source } = useOrderbookData(
    stockId ?? '__none__',
    ticker,
    currentPrice,
    800,
  );
  const liveCurrentPrice = price > 0 ? price : currentPrice;
  const lastTradedPrice = trades[0]?.price ?? liveCurrentPrice;
  const effectiveOpenPrice = openPrice && openPrice > 0 ? openPrice : liveCurrentPrice;

  const maxRaw = Math.max(...bids.map((b) => b.totalSize), ...asks.map((a) => a.totalSize), 5000);
  const maxSize = Math.max(10000, Math.ceil(maxRaw / 1000) * 1000);
  const totalAskSize = asks.reduce((acc, a) => acc + a.totalSize, 0);
  const totalBidSize = bids.reduce((acc, b) => acc + b.totalSize, 0);
  const totalSum = totalAskSize + totalBidSize;

  return (
    <StrictWidget className="h-full flex flex-col font-sans" overflowClass="overflow-hidden">
      {/* 헤더 (실시간 현재가 외부 표기 연동) */}
      <div className="flex items-center justify-between px-3 py-2 bg-panel border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-black text-tx tracking-tight flex items-center gap-1.5 font-sans">
            <span>호가창</span>
            <span className="text-[9.5px] font-mono text-muted font-normal uppercase">10 Depths</span>
            <span className="w-2 h-2 rounded-full bg-up animate-pulse shadow-[0_0_8px_#F04452]" />
          </span>

          {/* 현재가 실시간 외부 뱃지 */}
          <div className="flex items-center gap-1 bg-panel2 border border-border px-2 py-0.5 rounded-md shadow-inner font-mono">
            <span className="text-[10px] text-muted uppercase tracking-wider">현재가</span>
            <span className="text-[11.5px] font-black text-amber-500 tabular-nums">
              {liveCurrentPrice.toLocaleString()} <span className="text-[10px] text-muted font-normal">KRW</span>
            </span>
          </div>
        </div>

        <span className={`text-[9.5px] font-mono font-bold px-2 py-0.5 rounded-full border ${source === 'db' ? 'text-up bg-up/10 border-[#F04452]/30' : 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30'}`}>
          {source === 'db' ? 'LIVE DB' : 'LIVE FEED'}
        </span>
      </div>

      {/* 컬럼 헤더 */}
      <div className="grid grid-cols-[1.1fr_108px_1.1fr] w-full border-b border-border bg-panel2 py-1 font-sans shrink-0 text-muted">
        <span className="text-center text-[10.5px] text-down font-bold">매도잔량</span>
        <span className="text-center text-[10.5px] text-muted font-bold">호가 (KRW)</span>
        <span className="text-center text-[10.5px] text-up font-bold">매수잔량</span>
      </div>

      {/* 호가 20단계 리스트 (스크롤 없이 완벽히 핏되는 10x2 그리드) */}
      <div className="flex flex-col flex-1 overflow-hidden bg-panel">
        {/* 매도 10호가 */}
        <div className="flex-1 grid grid-rows-10 overflow-hidden border-b border-border/40">
          {asks.slice(0, 10).reverse().map((ask) => (
            <AskRow
              key={`ask-${ask.price}`}
              ask={ask}
              maxSize={maxSize}
              basePrice={liveCurrentPrice}
              openPrice={effectiveOpenPrice}
              isLastTraded={ask.price === lastTradedPrice}
            />
          ))}
        </div>

        {/* 매수 10호가 */}
        <div className="flex-1 grid grid-rows-10 overflow-hidden">
          {bids.slice(0, 10).map((bid) => (
            <BidRow
              key={`bid-${bid.price}`}
              bid={bid}
              maxSize={maxSize}
              basePrice={liveCurrentPrice}
              openPrice={effectiveOpenPrice}
              isLastTraded={bid.price === lastTradedPrice}
            />
          ))}
        </div>
      </div>

      {/* 푸터 (총 잔량) */}
      <div className="grid grid-cols-[1.1fr_108px_1.1fr] w-full bg-panel2 border-t border-border py-1.5 font-mono tabular-nums text-[10.5px] shrink-0">
        <span className="text-center text-down font-black">{totalAskSize.toLocaleString()}</span>
        <span className="text-center text-muted font-bold text-[9.5px]">총 {totalSum.toLocaleString()}</span>
        <span className="text-center text-up font-black">{totalBidSize.toLocaleString()}</span>
      </div>
    </StrictWidget>
  );
}