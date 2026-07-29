"use client";

/**
 * PriceHeroV2.tsx
 *
 * Default 모드 전용 거대 현재가 타이포그래피.
 * - Supabase 실시간 구독으로 가격 변동 수신
 * - text-7xl font-bold tracking-tight
 * - tabular-nums → 숫자 바뀔 때 레이아웃 흔들림 0
 * - 색상: 상승 #F04452 / 하락 #3182F6 / 보합 white
 * - 변동 시 플래시 애니메이션 (배경 순간 점등)
 */

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { change, fmtPrice, fmtSigned } from "@/lib/format";
import type { Stock } from "@/lib/types";

export default function PriceHeroV2({ stock }: { stock: Stock }) {
  const [price, setPrice] = useState(stock.currentPrice);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prevRef = useRef(stock.currentPrice);
  const supabase = createClient();

  /* ── 실시간 가격 구독 ── */
  useEffect(() => {
    const ch = supabase
      .channel(`price_hero_v2_${stock.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "stocks",
          filter: `id=eq.${stock.id}`,
        },
        (payload: { new: Record<string, unknown> }) => {
          const p = payload.new.current_price as number;
          if (p !== prevRef.current) {
            setFlash(p > prevRef.current ? "up" : "down");
            setPrice(p);
            prevRef.current = p;
            setTimeout(() => setFlash(null), 350);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [stock.id, supabase]);

  const { percent, amount, dir } = change(price, stock.previousClose);

  /* ── 색상 토큰 ── */
  const UP = "#F04452";
  const DOWN = "#3182F6";
  const NEUTRAL = "#FFFFFF";
  const priceColor =
    dir === "up" ? UP : dir === "down" ? DOWN : NEUTRAL;
  const flashBg =
    flash === "up"
      ? "rgba(240,68,82,0.08)"
      : flash === "down"
      ? "rgba(49,130,246,0.08)"
      : "transparent";

  const isUSD =
    stock.market === "overseas" ||
    stock.market === "europe" ||
    stock.market === "commodities";

  const priceFormatted = isUSD
    ? `$${price.toFixed(2)}`
    : `₩${Math.round(price).toLocaleString("ko-KR")}`;

  return (
    <div
      className="w-full flex flex-col items-center justify-center py-10 rounded-2xl transition-colors duration-300"
      style={{ background: flashBg }}
      id="v2-price-hero"
    >
      {/* ── 주 가격 (text-7xl) ── */}
      <span
        className="font-mono font-bold tracking-tight tabular-nums leading-none select-none transition-colors duration-200"
        style={{
          fontSize: "clamp(3rem, 8vw, 5.5rem)", // 48px ~ 88px
          color: priceColor,
        }}
      >
        {priceFormatted}
      </span>

      {/* ── 등락폭 + 등락률 ── */}
      <div className="flex items-center gap-3 mt-3">
        {/* 등락 방향 화살표 */}
        <span
          className="text-[22px] leading-none transition-colors duration-200"
          style={{ color: priceColor }}
        >
          {dir === "up" ? "▲" : dir === "down" ? "▼" : "–"}
        </span>

        {/* 등락률 */}
        <span
          className="font-mono font-bold tabular-nums text-[18px] tracking-tight transition-colors duration-200"
          style={{ color: priceColor }}
        >
          {fmtSigned(percent)}%
        </span>

        {/* 구분 */}
        <span className="text-[#374151] text-[14px]">|</span>

        {/* 등락폭 (절대금액) */}
        <span
          className="font-mono tabular-nums text-[15px] font-semibold transition-colors duration-200"
          style={{ color: `${priceColor}CC` }} // 약간 연하게
        >
          {dir === "up" ? "+" : dir === "down" ? "-" : ""}
          {fmtPrice(Math.abs(amount), stock.market)}
        </span>
      </div>

      {/* ── 전일 종가 기준선 레이블 ── */}
      <div className="flex items-center gap-1.5 mt-3">
        <span className="text-[11px] text-[#4B5563]">전일종가</span>
        <span className="font-mono text-[12px] tabular-nums text-[#6B7280] font-semibold">
          {fmtPrice(stock.previousClose, stock.market)}
        </span>
      </div>

      {/* ── 플래시 인디케이터 (미니 점) ── */}
      <div className="flex items-center gap-1.5 mt-4">
        <span
          className={`w-1.5 h-1.5 rounded-full transition-all duration-200 ${
            flash ? "scale-125 opacity-100" : "opacity-30"
          }`}
          style={{ background: priceColor }}
        />
        <span className="text-[9px] text-[#374151] font-mono uppercase tracking-widest">
          실시간 · {stock.ticker}
        </span>
      </div>
    </div>
  );
}
