"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/db/client";
import StockTable from "@/app/components/StockTable";
import type { Stock } from "@/lib/types";

const db = createClient();

export default function V2StocksPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    db
      .from("stocks")
      .select("*")
      .neq("is_listed", false)
      .order("market_cap", { ascending: false })
      .then(({ data }: { data: any[] | null }) => {
        if (data) {
          setStocks(
            data
              .filter((row) => row.is_listed !== false)
              .map((row) => ({
              id: row.id,
              name: row.name,
              ticker: row.ticker,
              market: row.market,
              sector: row.sector,
              currentPrice: Number(row.current_price ?? row.currentPrice ?? 0),
              previousClose: Number(row.previous_close ?? row.previousClose ?? 0),
              openPrice: Number(row.open_price ?? row.openPrice ?? row.previous_close ?? 0),
              high: Number(row.high ?? row.current_price ?? 0),
              low: Number(row.low ?? row.current_price ?? 0),
              volume: Number(row.volume ?? 0),
              marketCap: Number(row.market_cap ?? row.marketCap ?? 0),
              isCore: Boolean(row.is_core ?? row.isCore ?? false),
            })) as Stock[]
          );
        }
        setLoading(false);
      });
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-white/5 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <span>📈</span> V2 주식 시장종목 (Stocks Market)
          </h1>
          <p className="text-[13px] text-muted mt-1">
            KRX 국내주식 상/하한가(±30%) 및 해외주식 틱 실시간 시세 (V2 미니멀 뷰)
          </p>
        </div>
        <div className="font-mono text-[12px] text-dim">
          총 {stocks.length}개 종목 상장 중
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-dim font-mono bg-[#151821] rounded-2xl border border-white/5">
          실시간 주식 데이터를 로딩 중입니다...
        </div>
      ) : (
        <StockTable stocks={stocks} />
      )}
    </div>
  );
}
