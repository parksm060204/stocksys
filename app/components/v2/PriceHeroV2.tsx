"use client";

import { useState, useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { change, fmtPrice, fmtSigned } from "@/lib/format";
import type { Stock } from "@/lib/types";

export default function PriceHeroV2({ stock }: { stock: Stock }) {
  const [price, setPrice] = useState(stock.currentPrice);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const prevRef = useRef(stock.currentPrice);
  const supabase = createClient();

  useEffect(() => {
    const ch = supabase
      .channel(`price_hero_v2_${stock.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "stocks", filter: `id=eq.${stock.id}` },
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
  const priceColor = dir === "up" ? "text-bid" : dir === "down" ? "text-ask" : "text-tx";
  const flashBg =
    flash === "up" ? "bg-bid/8" : flash === "down" ? "bg-ask/8" : "";

  const isUSD = stock.market === "overseas" || stock.market === "europe" || stock.market === "commodities";
  const priceFormatted = isUSD
    ? `$${price.toFixed(2)}`
    : `₩${Math.round(price).toLocaleString("ko-KR")}`;

  return (
    <div
      className={`w-full flex flex-col items-center justify-center py-10 rounded-2xl transition-colors duration-300 ${flashBg}`}
      id="v2-price-hero"
    >
      <span
        className={`font-mono font-bold tracking-tight tabular-nums leading-none select-none transition-colors duration-200 ${priceColor}`}
        style={{ fontSize: "clamp(3rem, 8vw, 5.5rem)" }}
      >
        {priceFormatted}
      </span>

      <div className="flex items-center gap-3 mt-3">
        <span className={`text-[22px] leading-none transition-colors duration-200 ${priceColor}`}>
          {dir === "up" ? "▲" : dir === "down" ? "▼" : "–"}
        </span>
        <span className={`font-mono font-bold tabular-nums text-[18px] tracking-tight transition-colors duration-200 ${priceColor}`}>
          {fmtSigned(percent)}%
        </span>
        <span className="text-dim text-[14px]">|</span>
        <span className={`font-mono tabular-nums text-[15px] font-semibold transition-colors duration-200 opacity-80 ${priceColor}`}>
          {dir === "up" ? "+" : dir === "down" ? "-" : ""}
          {fmtPrice(Math.abs(amount), stock.market)}
        </span>
      </div>

      <div className="flex items-center gap-1.5 mt-3">
        <span className="text-[11px] text-dim">전일종가</span>
        <span className="font-mono text-[12px] tabular-nums text-muted font-semibold">
          {fmtPrice(stock.previousClose, stock.market)}
        </span>
      </div>

      <div className="flex items-center gap-1.5 mt-4">
        <span
          className={`w-1.5 h-1.5 rounded-full transition-all duration-200 ${priceColor} ${flash ? "scale-125 opacity-100" : "opacity-30"}`}
        />
        <span className="text-[9px] text-dim font-mono uppercase tracking-widest">
          실시간 · {stock.ticker}
        </span>
      </div>
    </div>
  );
}