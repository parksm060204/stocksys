"use client";

/**
 * OrderbookV2.tsx
 *
 * V2 Robinhood-style 호가창.
 * ─ 백엔드 훅 `useOrderbookData`는 절대 수정하지 않음.
 * ─ 세로 border 완전 제거.
 * ─ 텍스트 정렬 + py-2 여백만으로 구분.
 * ─ 왼쪽: 매도잔량 배경 바 (파랑), 오른쪽: 매수잔량 배경 바 (빨강).
 */

import { useEffect, useRef, useState } from "react";
import { useOrderbookData } from "@/lib/hooks/useOrderbookData";

interface OrderbookLevel {
  price: number;
  totalSize: number;
}

export default function OrderbookV2({
  ticker,
  currentPrice,
  stockId,
}: {
  ticker: string;
  currentPrice: number;
  stockId?: string;
}) {
  /* ── 백엔드 연동 (원본 훅 그대로) ── */
  const { bids, asks, price: livePrice, source } = useOrderbookData(
    stockId ?? "__none__",
    ticker,
    currentPrice,
    800
  );

  const [flashType, setFlashType] = useState<"up" | "down" | null>(null);
  const prevPriceRef = useRef<number>(currentPrice);

  useEffect(() => {
    const p = livePrice || currentPrice;
    if (p !== prevPriceRef.current) {
      setFlashType(p > prevPriceRef.current ? "up" : "down");
      prevPriceRef.current = p;
      const t = setTimeout(() => setFlashType(null), 250);
      return () => clearTimeout(t);
    }
  }, [livePrice, currentPrice]);

  const maxSize = Math.max(
    ...bids.map((b) => b.totalSize),
    ...asks.map((a) => a.totalSize),
    1
  );
  const totalAskSize = asks.reduce((a, c) => a + c.totalSize, 0);
  const totalBidSize = bids.reduce((a, c) => a + c.totalSize, 0);
  const totalSum = totalAskSize + totalBidSize;
  const displayPrice = livePrice || currentPrice;

  /* ── 매도 행 (파랑) ── */
  const AskRow = ({ ask }: { ask: OrderbookLevel }) => {
    const pct = Math.min(100, (ask.totalSize / maxSize) * 100);
    const isCurrent = ask.price === displayPrice;
    return (
      <div
        className={`relative flex items-center justify-between py-[7px] px-3 transition-colors ${
          isCurrent ? "bg-[#3182F6]/10" : "hover:bg-white/[0.02]"
        }`}
      >
        {/* 배경 바 — 오른쪽에서 왼쪽으로 */}
        <div
          className="absolute right-0 top-0 bottom-0 bg-[#3182F6]/12 pointer-events-none"
          style={{ width: `${pct}%` }}
        />
        {/* 잔량 (좌) */}
        <span className="relative z-10 font-mono text-[11px] tabular-nums text-[#9CA3AF]">
          {ask.totalSize.toLocaleString()}
        </span>
        {/* 호가 (우) */}
        <span
          className={`relative z-10 font-mono text-[12px] tabular-nums font-semibold ${
            isCurrent ? "text-white" : "text-[#3182F6]"
          }`}
        >
          {ask.price.toLocaleString()}
        </span>
      </div>
    );
  };

  /* ── 매수 행 (빨강) ── */
  const BidRow = ({ bid }: { bid: OrderbookLevel }) => {
    const pct = Math.min(100, (bid.totalSize / maxSize) * 100);
    const isCurrent = bid.price === displayPrice;
    return (
      <div
        className={`relative flex items-center justify-between py-[7px] px-3 transition-colors ${
          isCurrent ? "bg-[#F04452]/10" : "hover:bg-white/[0.02]"
        }`}
      >
        {/* 배경 바 — 왼쪽에서 오른쪽으로 */}
        <div
          className="absolute left-0 top-0 bottom-0 bg-[#F04452]/12 pointer-events-none"
          style={{ width: `${pct}%` }}
        />
        {/* 호가 (좌) */}
        <span
          className={`relative z-10 font-mono text-[12px] tabular-nums font-semibold ${
            isCurrent ? "text-white" : "text-[#F04452]"
          }`}
        >
          {bid.price.toLocaleString()}
        </span>
        {/* 잔량 (우) */}
        <span className="relative z-10 font-mono text-[11px] tabular-nums text-[#9CA3AF]">
          {bid.totalSize.toLocaleString()}
        </span>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full bg-[#0D0F14]">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-widest">
            호가창
          </span>
          <span
            className={`w-1.5 h-1.5 rounded-full animate-pulse ${
              flashType === "up"
                ? "bg-[#F04452]"
                : flashType === "down"
                ? "bg-[#3182F6]"
                : "bg-[#374151]"
            }`}
          />
        </div>
        <span
          className={`text-[9px] font-bold px-1.5 py-px rounded tracking-widest ${
            source === "db"
              ? "text-emerald-400 bg-emerald-400/10"
              : "text-amber-400 bg-amber-400/10"
          }`}
        >
          {source === "db" ? "LIVE" : "SIM"}
        </span>
      </div>

      {/* 컬럼 레이블 (border 없이 텍스트만) */}
      <div className="flex items-center justify-between px-3 py-1 shrink-0">
        <span className="text-[9px] font-semibold text-[#6B7280] uppercase tracking-widest">
          잔량
        </span>
        <span className="text-[9px] font-semibold text-[#6B7280] uppercase tracking-widest">
          호가
        </span>
      </div>

      {/* 구분선 — 하나만, 매도/매수 경계 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 매도 호가 (내림차순 → 아래로 정렬) */}
        <div className="flex flex-col flex-1 overflow-y-auto no-scrollbar justify-end">
          {asks
            .slice()
            .reverse()
            .map((ask) => (
              <AskRow key={`ask-${ask.price}`} ask={ask} />
            ))}
        </div>

        {/* 현재가 중앙 구분 (플래시 효과) */}
        <div
          className={`flex items-center justify-between px-3 py-2 shrink-0 transition-colors duration-200 ${
            flashType === "up"
              ? "bg-[#F04452]/15"
              : flashType === "down"
              ? "bg-[#3182F6]/15"
              : "bg-[#151821]"
          }`}
        >
          <span className="text-[10px] text-[#6B7280] font-medium">현재가</span>
          <span
            className={`font-mono text-[15px] font-bold tabular-nums ${
              flashType === "up"
                ? "text-[#F04452]"
                : flashType === "down"
                ? "text-[#3182F6]"
                : "text-white"
            }`}
          >
            {displayPrice.toLocaleString()}
          </span>
        </div>

        {/* 매수 호가 (내림차순) */}
        <div className="flex flex-col flex-1 overflow-y-auto no-scrollbar">
          {bids.map((bid) => (
            <BidRow key={`bid-${bid.price}`} bid={bid} />
          ))}
        </div>
      </div>

      {/* 푸터 — 총잔량 요약 (border 없이) */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0 bg-[#0D0F14]">
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-[#6B7280]">매도</span>
          <span className="font-mono text-[11px] text-[#3182F6] tabular-nums font-bold">
            {totalAskSize.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span className="font-mono text-[11px] text-[#F04452] tabular-nums font-bold">
            {totalBidSize.toLocaleString()}
          </span>
          <span className="text-[9px] text-[#6B7280]">매수</span>
        </div>
      </div>
    </div>
  );
}
