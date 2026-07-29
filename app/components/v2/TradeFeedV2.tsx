"use client";

/**
 * TradeFeedV2.tsx
 *
 * V2 Robinhood-style 실시간 체결 피드.
 * ─ 백엔드 훅 `useOrderbookData`는 절대 수정하지 않음.
 * ─ 세로 border 완전 제거.
 * ─ 텍스트 정렬 + py-2 여백만으로 행 구분.
 * ─ BUY: 빨강(#F04452), SELL: 파랑(#3182F6), LIQUIDATION: 보라 강조.
 */

import React from "react";
import { useOrderbookData } from "@/lib/hooks/useOrderbookData";
import type { TradeRecord } from "@/lib/hooks/useOrderbookData";
import type { SimTrade } from "@/lib/hooks/useStockBotSimulation";
import type { Stock } from "@/lib/types";

interface TradeFeedV2Props {
  stock?: Stock;
  trades?: SimTrade[];
}

export default function TradeFeedV2({ stock, trades: externalTrades }: TradeFeedV2Props) {
  /* ── 백엔드 연동 (원본 훅 그대로) ── */
  const { trades: dbTrades, source } = useOrderbookData(
    stock?.id ?? "__none__",
    stock?.ticker ?? "__none__",
    stock?.currentPrice ?? 0,
    800
  );

  const externalMapped: TradeRecord[] = externalTrades?.map((t: SimTrade) => ({
    tradeId: t.tradeId,
    price: t.price,
    quantity: t.quantity,
    side: t.side,
    isLiquidation: t.isLiquidation,
    timestamp: t.timestamp,
  })) ?? [];

  const trades =
    externalMapped.length > 0 ? externalMapped : stock ? dbTrades : [];

  const isUSD =
    stock?.market === "overseas" ||
    stock?.market === "europe" ||
    stock?.market === "commodities";

  const fmtPrice = (p: number) =>
    isUSD ? `$${p.toFixed(2)}` : `₩${Math.round(p).toLocaleString()}`;

  return (
    <div className="flex flex-col h-full bg-[#0D0F14]">
      {/* 헤더 */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-widest">
            실시간 체결
          </span>
          <span className="w-1.5 h-1.5 rounded-full bg-[#F04452] animate-ping opacity-75" />
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

      {/* 컬럼 레이블 (border 없이, 텍스트만) */}
      <div className="grid grid-cols-3 px-3 py-1 shrink-0">
        <span className="text-[9px] font-semibold text-[#6B7280] uppercase tracking-widest">
          시간
        </span>
        <span className="text-[9px] font-semibold text-[#6B7280] uppercase tracking-widest text-right">
          체결가
        </span>
        <span className="text-[9px] font-semibold text-[#6B7280] uppercase tracking-widest text-right">
          수량
        </span>
      </div>

      {/* 체결 피드 — 스크롤 영역 */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        {trades.length === 0 ? (
          <div className="py-8 text-center text-[11px] text-[#4B5563]">
            체결 대기 중...
          </div>
        ) : (
          trades.map((t) => {
            /* ── 청산 특수 행 ── */
            if (t.isLiquidation) {
              return (
                <div
                  key={t.tradeId}
                  className="flex items-center justify-between px-3 py-2 bg-purple-500/8 border-l-2 border-purple-500/60"
                >
                  <span className="text-[10px] font-black text-purple-400">
                    🚨 LIQD
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-purple-300 font-bold">
                    {fmtPrice(t.price)}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums text-purple-300 font-bold text-right">
                    {t.quantity.toLocaleString()}
                  </span>
                </div>
              );
            }

            const isUp = t.side === "BUY";
            return (
              <div
                key={t.tradeId}
                className="grid grid-cols-3 items-center px-3 py-2 hover:bg-white/[0.02] transition-colors"
              >
                {/* 시간 */}
                <span className="text-[10px] text-[#4B5563] tabular-nums">
                  {new Date(t.timestamp).toLocaleTimeString("ko-KR", {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                {/* 체결가 */}
                <span
                  className={`text-right font-mono text-[12px] tabular-nums font-semibold ${
                    isUp ? "text-[#F04452]" : "text-[#3182F6]"
                  }`}
                >
                  {fmtPrice(t.price)}
                </span>
                {/* 수량 */}
                <span
                  className={`text-right font-mono text-[11px] tabular-nums ${
                    isUp ? "text-[#F04452]/70" : "text-[#3182F6]/70"
                  }`}
                >
                  {t.quantity.toLocaleString()}
                </span>
              </div>
            );
          })
        )}
      </div>

      {/* 푸터 — 체결 건수 요약 */}
      <div className="flex items-center justify-between px-3 py-2 shrink-0">
        <span className="text-[9px] text-[#4B5563] uppercase tracking-widest">
          체결 {trades.length}건
        </span>
        <div className="flex items-center gap-2 text-[9px]">
          <span className="text-[#F04452]">
            매수 {trades.filter((t) => t.side === "BUY").length}
          </span>
          <span className="text-[#374151]">/</span>
          <span className="text-[#3182F6]">
            매도 {trades.filter((t) => t.side === "SELL").length}
          </span>
        </div>
      </div>
    </div>
  );
}
