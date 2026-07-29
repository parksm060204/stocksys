"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import StockTable from "@/app/components/StockTable";
import type { Stock } from "@/lib/types";

const supabase = createClient();

export default function V2StocksPage() {
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("stocks")
      .select("*")
      .order("market_cap", { ascending: false })
      .then(({ data }: { data: Stock[] | null }) => {
        if (data) setStocks(data);
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
          <p className="text-[13px] text-[#9CA3AF] mt-1">
            KRX 국내주식 상/하한가(±30%) 및 해외주식 틱 실시간 시세 (V2 미니멀 뷰)
          </p>
        </div>
        <div className="font-mono text-[12px] text-[#6B7280]">
          총 {stocks.length}개 종목 상장 중
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-[#6B7280] font-mono bg-[#151821] rounded-2xl border border-white/5">
          실시간 주식 데이터를 로딩 중입니다...
        </div>
      ) : (
        <StockTable stocks={stocks} />
      )}
    </div>
  );
}
