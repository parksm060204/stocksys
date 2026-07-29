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
    stock?: number;
    kr_equity?: number;
    us_equity?: number;
    eu_equity?: number;
    bond?: number;
    commodity?: number;
    cash?: number;
  };
  updated_at: string;
}

export default function InstitutionsDashboard() {
  const [portfolios, setPortfolios] = useState<PortfolioData[]>([]);
  const [botNameMap, setBotNameMap] = useState<Record<string, string>>({});

  useEffect(() => {
    // 1. Fetch real bot names from bots_config table
    supabase
      .from("bots_config")
      .select("id, name")
      .then(({ data }: { data: Array<{ id: string; name: string }> | null }) => {
        if (data) {
          const map: Record<string, string> = {};
          data.forEach((b: { id: string; name: string }) => {
            if (b.name) map[b.id] = b.name;
          });
          setBotNameMap(map);
        }
      });

    // 2. Fetch initial portfolios
    supabase
      .from("institutional_portfolios")
      .select("*")
      .order("total_capital", { ascending: false })
      .then(({ data, error }: { data: PortfolioData[] | null; error: { message: string } | null }) => {
        if (data) setPortfolios(data);
        if (error) console.error("Error fetching portfolios:", error);
      });

    // 3. Realtime subscription
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
    return new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 }).format(num);
  };

  const formatPercent = (num: number) => {
    return (num * 100).toFixed(1) + "%";
  };

  // UUID 여부 판별 헬퍼
  const isUUID = (str: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);

  return (
    <div className="min-h-screen bg-[#0C0E12] text-[#F3F4F6] font-sans p-4 max-w-7xl mx-auto">
      {/* Header */}
      <header className="mb-6 pb-4 border-b border-white/10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <span>🏛️</span>
            기관 투자자 실시간 포트폴리오 터미널
          </h1>
          <p className="text-[13px] text-[#9CA3AF] mt-1">
            가상 자산 운용사, 연기금 및 IB 프롭데스크의 실시간 자산 구성 현황 및 델타를 모니터링합니다.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[12px] font-mono">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-400 font-bold border border-emerald-500/20">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            실시간 연동 중
          </span>
          <span className="text-[#6B7280]">
            {new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" })}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-4">
        {portfolios.length === 0 ? (
          <div className="p-8 text-center text-[#6B7280] bg-[#151821] rounded-2xl border border-white/5 font-mono">
            엔진으로부터 기관 포트폴리오 데이터를 동기화하는 중...
          </div>
        ) : (
          portfolios.map((p) => {
            const total = p.current_cash + p.current_stock + p.current_bond + p.current_commodity;
            const cashRatio = p.current_cash / total || 0;
            const stockRatio = p.current_stock / total || 0;
            const bondRatio = p.current_bond / total || 0;
            const commodityRatio = p.current_commodity / total || 0;

            const tw = (p.target_weights || {}) as any;
            const targetStock = Number(tw.stock || 0) + Number(tw.kr_equity || 0) + Number(tw.us_equity || 0) + Number(tw.eu_equity || 0);
            const targetBond = Number(tw.bond || 0);
            const targetCommodity = Number(tw.commodity || 0);
            const targetCash = tw.cash !== undefined ? Number(tw.cash) : Math.max(0, 1.0 - targetStock - targetBond - targetCommodity);

            // Display Name Resolution: botNameMap -> p.name -> fallback
            let displayName = botNameMap[p.bot_id] || p.name;
            if (isUUID(displayName)) {
              displayName = `기관 펀드 (ID: ${p.bot_id.slice(0, 8)})`;
            }

            return (
              <StrictWidget key={p.bot_id} title={`🏛️ ${displayName}`}>
                <div className="text-[12px] font-mono">
                  {/* Table Header */}
                  <div className="grid grid-cols-5 border-b border-white/10 pb-2 mb-2 font-bold text-[#9CA3AF] text-[11px] uppercase tracking-wider">
                    <div>자산군 (ASSET CLASS)</div>
                    <div className="text-right">평가 금액 (원)</div>
                    <div className="text-right">현재 비중</div>
                    <div className="text-right">목표 비중</div>
                    <div className="text-right">괴리율 (현재-목표)</div>
                  </div>

                  {/* Cash */}
                  <div className="grid grid-cols-5 py-1.5 items-center hover:bg-white/5 rounded transition-colors px-1">
                    <div className="text-[#9CA3AF] font-bold flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-gray-400" />
                      현금 자산 (CASH)
                    </div>
                    <div className="text-right tabular-nums text-white">{formatNumber(p.current_cash)}</div>
                    <div className="text-right tabular-nums font-bold text-white">{formatPercent(cashRatio)}</div>
                    <div className="text-right tabular-nums text-[#9CA3AF]">{formatPercent(targetCash)}</div>
                    <div className={`text-right tabular-nums font-bold ${cashRatio - targetCash > 0.001 ? "text-[#F04452]" : cashRatio - targetCash < -0.001 ? "text-[#3182F6]" : "text-[#6B7280]"}`}>
                      {formatPercent(cashRatio - targetCash)}
                    </div>
                  </div>

                  {/* Stock */}
                  <div className="grid grid-cols-5 py-1.5 items-center hover:bg-white/5 rounded transition-colors px-1">
                    <div className="text-[#60A5FA] font-bold flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-blue-400" />
                      주식 자산 (EQUITY)
                    </div>
                    <div className="text-right tabular-nums text-white">{formatNumber(p.current_stock)}</div>
                    <div className="text-right tabular-nums font-bold text-white">{formatPercent(stockRatio)}</div>
                    <div className="text-right tabular-nums text-[#9CA3AF]">{formatPercent(targetStock)}</div>
                    <div className={`text-right tabular-nums font-bold ${stockRatio - targetStock > 0.001 ? "text-[#F04452]" : stockRatio - targetStock < -0.001 ? "text-[#3182F6]" : "text-[#6B7280]"}`}>
                      {formatPercent(stockRatio - targetStock)}
                    </div>
                  </div>

                  {/* Bond */}
                  <div className="grid grid-cols-5 py-1.5 items-center hover:bg-white/5 rounded transition-colors px-1">
                    <div className="text-[#34D399] font-bold flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-emerald-400" />
                      채권 자산 (BOND)
                    </div>
                    <div className="text-right tabular-nums text-white">{formatNumber(p.current_bond)}</div>
                    <div className="text-right tabular-nums font-bold text-white">{formatPercent(bondRatio)}</div>
                    <div className="text-right tabular-nums text-[#9CA3AF]">{formatPercent(targetBond)}</div>
                    <div className={`text-right tabular-nums font-bold ${bondRatio - targetBond > 0.001 ? "text-[#F04452]" : bondRatio - targetBond < -0.001 ? "text-[#3182F6]" : "text-[#6B7280]"}`}>
                      {formatPercent(bondRatio - targetBond)}
                    </div>
                  </div>

                  {/* Commodity */}
                  <div className="grid grid-cols-5 py-1.5 items-center hover:bg-white/5 rounded transition-colors px-1">
                    <div className="text-[#FBBF24] font-bold flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-amber-400" />
                      원자재 자산 (COMMODITY)
                    </div>
                    <div className="text-right tabular-nums text-white">{formatNumber(p.current_commodity)}</div>
                    <div className="text-right tabular-nums font-bold text-white">{formatPercent(commodityRatio)}</div>
                    <div className="text-right tabular-nums text-[#9CA3AF]">{formatPercent(targetCommodity)}</div>
                    <div className={`text-right tabular-nums font-bold ${commodityRatio - targetCommodity > 0.001 ? "text-[#F04452]" : commodityRatio - targetCommodity < -0.001 ? "text-[#3182F6]" : "text-[#6B7280]"}`}>
                      {formatPercent(commodityRatio - targetCommodity)}
                    </div>
                  </div>

                  {/* Total */}
                  <div className="grid grid-cols-5 border-t border-white/10 mt-2 pt-2 font-bold text-[13px]">
                    <div className="text-white">총 운용 자산 (AUM)</div>
                    <div className="text-right text-white tabular-nums">{formatNumber(total)} 원</div>
                    <div className="text-right text-white tabular-nums">100.0%</div>
                    <div className="text-right text-white tabular-nums">100.0%</div>
                    <div className="text-right text-[#6B7280] tabular-nums">0.0%</div>
                  </div>
                  
                  <div className="text-right text-[10px] text-[#6B7280] mt-2">
                    최종 동기화 시각: {new Date(p.updated_at).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
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
