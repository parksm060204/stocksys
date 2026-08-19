"use client";

import { useState, useEffect } from "react";
import { change, fmtPrice, fmtSigned } from "@/lib/format";
import type { Stock } from "@/lib/types";
import { PriceTag } from "@/app/components/PriceTag";

export default function RealtimePriceHeader({ stock }: { stock: Stock }) {
  const [currentPrice, setCurrentPrice] = useState(stock.currentPrice);

  useEffect(() => {
    setCurrentPrice(stock.currentPrice);
  }, [stock.currentPrice]);

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
