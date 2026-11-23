'use client';

import React from 'react';

interface DepthLevel {
  price: number;
  totalSize?: number;
  size?: number;
  orderCount?: number;
}

interface SpreadInfo {
  bestBid?: number | null;
  bestAsk?: number | null;
  spread?: number | null;
  spreadPct?: number | null;
}

interface CommodityOrderbookPanelProps {
  ticker: string;
  currentPrice: number;
  bids: DepthLevel[];
  asks: DepthLevel[];
  spread?: number | SpreadInfo | null;
}

function getLevelSize(level?: DepthLevel | null): number {
  const raw = Number(level?.totalSize ?? level?.size ?? 0);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

function resolveSpreadValue(spread?: number | SpreadInfo | null): number | null {
  const raw = typeof spread === 'object' && spread !== null ? spread.spread : spread;
  if (raw === null || raw === undefined) return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

export default function CommodityOrderbookPanel({
  ticker,
  currentPrice,
  bids,
  asks,
  spread,
}: CommodityOrderbookPanelProps) {
  const safeBids = Array.isArray(bids) ? bids : [];
  const safeAsks = Array.isArray(asks) ? asks : [];
  const maxSize = Math.max(
    1,
    ...safeBids.map((b) => getLevelSize(b)),
    ...safeAsks.map((a) => getLevelSize(a))
  );

  const sortedAsks = [...safeAsks].sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
  const sortedBids = [...safeBids].sort((a, b) => Number(b.price || 0) - Number(a.price || 0));
  const resolvedSpread = resolveSpreadValue(spread);
  const safeCurrentPrice = Number.isFinite(Number(currentPrice)) ? Number(currentPrice) : 0;

  return (
    <div className="flex flex-col h-full bg-[#0E1117] text-xs font-mono select-none">
      <div className="px-4 py-2.5 border-b border-border bg-[#090B0F] flex items-center justify-between shrink-0">
        <span className="font-black text-white">실시간 선물 호가창 ({ticker})</span>
        <span className="text-[11px] text-[#8E939D]">
          스프레드: {resolvedSpread !== null ? `$${resolvedSpread.toFixed(2)}` : '—'}
        </span>
      </div>

      <div className="grid grid-cols-2 px-4 py-1.5 border-b border-border text-[10.5px] font-bold text-[#8E939D] bg-[#090B0F]/60">
        <span>호가 (USD)</span>
        <span className="text-right">잔량 (계약)</span>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-border/30">
        {sortedAsks.length === 0 && sortedBids.length === 0 ? (
          <div className="h-full flex items-center justify-center text-[#8E939D] py-12">
            대기 중인 원자재 선물 호가가 없습니다.
          </div>
        ) : (
          <>
            {sortedAsks.map((ask, idx) => {
              const levelSize = getLevelSize(ask);
              const askPrice = Number.isFinite(Number(ask.price)) ? Number(ask.price) : 0;
              const pct = Math.min(100, (levelSize / maxSize) * 100);
              return (
                <div key={`ask-${idx}-${askPrice}`} className="relative grid grid-cols-2 px-4 py-1.5 items-center">
                  <div className="absolute right-0 top-0 bottom-0 bg-down/15 pointer-events-none" style={{ width: `${pct}%` }} />
                  <span className="relative z-10 text-down font-bold tabular-nums">${askPrice.toFixed(2)}</span>
                  <span className="relative z-10 text-right text-white tabular-nums">{levelSize.toLocaleString()}</span>
                </div>
              );
            })}

            <div className="px-4 py-2 bg-[#161B22] border-y border-border flex items-center justify-between font-black">
              <span className="text-[#8E939D]">현재 체결 기준</span>
              <span className="text-white text-sm tabular-nums">${safeCurrentPrice.toFixed(2)}</span>
            </div>

            {sortedBids.map((bid, idx) => {
              const levelSize = getLevelSize(bid);
              const bidPrice = Number.isFinite(Number(bid.price)) ? Number(bid.price) : 0;
              const pct = Math.min(100, (levelSize / maxSize) * 100);
              return (
                <div key={`bid-${idx}-${bidPrice}`} className="relative grid grid-cols-2 px-4 py-1.5 items-center">
                  <div className="absolute right-0 top-0 bottom-0 bg-up/15 pointer-events-none" style={{ width: `${pct}%` }} />
                  <span className="relative z-10 text-up font-bold tabular-nums">${bidPrice.toFixed(2)}</span>
                  <span className="relative z-10 text-right text-white tabular-nums">{levelSize.toLocaleString()}</span>
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
