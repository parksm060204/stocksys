"use client";

import { useState, useEffect, useRef } from "react";
import { change, fmtPrice, fmtSigned } from "@/lib/format";
import type { Stock } from "@/lib/types";
import { PriceTag } from "@/app/components/PriceTag";
import { createClient } from "@/lib/supabase/client";

export default function RealtimePriceHeader({ stock }: { stock: Stock }) {
  const [currentPrice, setCurrentPrice] = useState(stock.currentPrice);
  const lastDisplayedPrice = useRef(stock.currentPrice);
  const supabase = createClient();

  useEffect(() => {
    const channel = supabase
      .channel(`realtime_price_${stock.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'stocks', filter: `id=eq.${stock.id}` },
        (payload) => {
          const newPrice = payload.new.current_price;
          if (newPrice !== lastDisplayedPrice.current) {
            setCurrentPrice(newPrice);
            lastDisplayedPrice.current = newPrice;
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [stock.id, supabase]);

  const { percent, amount, dir } = change(currentPrice, stock.previousClose);
  const color = dir === "up" ? "text-up" : dir === "down" ? "text-down" : "text-muted";

  return (
    <div className="text-right">
      <PriceTag current={currentPrice} prev={stock.previousClose} market={stock.market} size="lg" />
      <div className="mt-1 transition-colors duration-300">
        <span className={`font-mono text-[14px] font-semibold tabular-nums ${color}`}>
          {dir === "up" ? "▲" : dir === "down" ? "▼" : "–"} {fmtSigned(percent)}%
        </span>
        <span className={`ml-2 font-mono text-[12px] tabular-nums ${color}`}>
          {fmtPrice(Math.abs(amount), stock.market)}
        </span>
      </div>
    </div>
  );
}
