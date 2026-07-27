"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import StrictWidget from "@/app/components/StrictWidget";

const supabase = createClient();

interface PortfolioData {
  bot_id: string;
  name: string;
  total_capital: number;
  current_cash: number;
  current_stock: number;
  current_bond: number;
  current_commodity: number;
  target_weights: {
    stock: number;
    bond: number;
    commodity: number;
    cash: number;
  };
  updated_at: string;
}

export default function InstitutionsDashboard() {
  const [portfolios, setPortfolios] = useState<PortfolioData[]>([]);

  useEffect(() => {
    // Initial fetch
    supabase
      .from("institutional_portfolios")
      .select("*")
      .order("total_capital", { ascending: false })
      .then(({ data, error }: { data: PortfolioData[] | null; error: { message: string } | null }) => {
        if (data) setPortfolios(data);
        if (error) console.error("Error fetching portfolios:", error);
      });

    // Realtime subscription
    const channel = supabase
      .channel("realtime:institutional_portfolios")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "institutional_portfolios" },
        (payload: { new: Record<string, unknown>; old: Record<string, unknown> | null }) => {
          setPortfolios((prev) => {
            const newRecord = payload.new as unknown as PortfolioData;
            const index = prev.findIndex((p) => p.bot_id === newRecord.bot_id);
            if (index > -1) {
              const updated = [...prev];
              updated[index] = newRecord;
              return updated.sort((a, b) => b.total_capital - a.total_capital);
            } else {
              return [...prev, newRecord].sort((a, b) => b.total_capital - a.total_capital);
            }
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(num);
  };

  const formatPercent = (num: number) => {
    return (num * 100).toFixed(1) + "%";
  };

  return (
    <div className="min-h-screen bg-black text-[#d1d5db] font-mono p-1">
      <header className="mb-2 px-2 py-1 border-b border-[#333] flex justify-between items-center text-xs">
        <h1 className="font-bold text-[#e5e7eb]">INSTITUTIONAL PORTFOLIO TERMINAL</h1>
        <div className="flex gap-4">
          <span className="text-[#a1a1aa]">STATUS: ONLINE</span>
          <span className="text-[#a1a1aa]">{new Date().toISOString().split("T")[0]}</span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-1">
        {portfolios.length === 0 ? (
          <div className="p-4 text-center text-[#555]">Waiting for engine data...</div>
        ) : (
          portfolios.map((p) => {
            const total = p.current_cash + p.current_stock + p.current_bond + p.current_commodity;
            const cashRatio = p.current_cash / total || 0;
            const stockRatio = p.current_stock / total || 0;
            const bondRatio = p.current_bond / total || 0;
            const commodityRatio = p.current_commodity / total || 0;

            return (
              <StrictWidget key={p.bot_id} title={`[${p.bot_id}] ${p.name.toUpperCase()}`}>
                <div className="text-[10px] sm:text-xs">
                  <div className="grid grid-cols-5 border-b border-[#333] pb-1 mb-1 font-bold text-[#9ca3af]">
                    <div>ASSET CLASS</div>
                    <div className="text-right">NOTIONAL VALUE</div>
                    <div className="text-right">ACTUAL WGT</div>
                    <div className="text-right">TARGET WGT</div>
                    <div className="text-right">DELTA (ACT-TGT)</div>
                  </div>

                  {/* Cash */}
                  <div className="grid grid-cols-5 py-0.5">
                    <div className="text-[#a1a1aa]">CASH</div>
                    <div className="text-right">{formatNumber(p.current_cash)}</div>
                    <div className="text-right">{formatPercent(cashRatio)}</div>
                    <div className="text-right">{formatPercent(p.target_weights.cash)}</div>
                    <div className={`text-right ${cashRatio - p.target_weights.cash > 0.001 ? "text-red-400" : cashRatio - p.target_weights.cash < -0.001 ? "text-green-400" : ""}`}>
                      {formatPercent(cashRatio - p.target_weights.cash)}
                    </div>
                  </div>

                  {/* Stock */}
                  <div className="grid grid-cols-5 py-0.5">
                    <div className="text-[#60a5fa]">EQUITY</div>
                    <div className="text-right">{formatNumber(p.current_stock)}</div>
                    <div className="text-right">{formatPercent(stockRatio)}</div>
                    <div className="text-right">{formatPercent(p.target_weights.stock)}</div>
                    <div className={`text-right ${stockRatio - p.target_weights.stock > 0.001 ? "text-red-400" : stockRatio - p.target_weights.stock < -0.001 ? "text-green-400" : ""}`}>
                      {formatPercent(stockRatio - p.target_weights.stock)}
                    </div>
                  </div>

                  {/* Bond */}
                  <div className="grid grid-cols-5 py-0.5">
                    <div className="text-[#34d399]">FIXED INCOME</div>
                    <div className="text-right">{formatNumber(p.current_bond)}</div>
                    <div className="text-right">{formatPercent(bondRatio)}</div>
                    <div className="text-right">{formatPercent(p.target_weights.bond)}</div>
                    <div className={`text-right ${bondRatio - p.target_weights.bond > 0.001 ? "text-red-400" : bondRatio - p.target_weights.bond < -0.001 ? "text-green-400" : ""}`}>
                      {formatPercent(bondRatio - p.target_weights.bond)}
                    </div>
                  </div>

                  {/* Commodity */}
                  <div className="grid grid-cols-5 py-0.5">
                    <div className="text-[#fbbf24]">COMMODITY</div>
                    <div className="text-right">{formatNumber(p.current_commodity)}</div>
                    <div className="text-right">{formatPercent(commodityRatio)}</div>
                    <div className="text-right">{formatPercent(p.target_weights.commodity)}</div>
                    <div className={`text-right ${commodityRatio - p.target_weights.commodity > 0.001 ? "text-red-400" : commodityRatio - p.target_weights.commodity < -0.001 ? "text-green-400" : ""}`}>
                      {formatPercent(commodityRatio - p.target_weights.commodity)}
                    </div>
                  </div>

                  {/* Total */}
                  <div className="grid grid-cols-5 border-t border-[#333] mt-1 pt-1 font-bold">
                    <div>TOTAL AUM</div>
                    <div className="text-right text-white">{formatNumber(total)}</div>
                    <div className="text-right">100.0%</div>
                    <div className="text-right">100.0%</div>
                    <div className="text-right">0.0%</div>
                  </div>
                  
                  <div className="text-right text-[9px] text-[#555] mt-1">
                    LAST SYNC: {new Date(p.updated_at).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit', fractionalSecondDigits: 3 })}
                  </div>
                </div>
              </StrictWidget>
            );
          })
        )}
      </div>
    </div>
  );
}
