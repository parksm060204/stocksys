"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CrossAssetLinkageWidget } from "@/app/components/CrossAssetLinkageWidget";
import { InstitutionalSectorPortfolioWidget } from "@/app/components/InstitutionalSectorPortfolioWidget";
import { MacroRegimeRebalanceWidget } from "@/app/components/MacroRegimeRebalanceWidget";
import { MacroRegimeType } from "@/lib/engine/macroRegimeEngine";

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
  const [activeRegime, setActiveRegime] = useState<MacroRegimeType>('NORMAL');

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

    const fetchPortfolios = () => {
      supabase
        .from("institutional_portfolios")
        .select("*")
        .order("total_capital", { ascending: false })
        .then(({ data, error }: { data: PortfolioData[] | null; error: { message: string } | null }) => {
          if (data) setPortfolios(data);
          if (error) console.error("Error fetching portfolios:", error);
        });
    };

    fetchPortfolios();

    // 3초 주기 폴링으로 기관 포트폴리오 업데이트
    const interval = setInterval(fetchPortfolios, 3000);

    return () => {
      clearInterval(interval);
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
    <div className="min-h-screen bg-[#05070A] text-[#F4F5F6] font-sans p-6 max-w-7xl mx-auto space-y-6">
      {/* Header Banner */}
      <header className="bg-[#0E1117] border border-[#212631] p-6 rounded-3xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-2xl">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#F04452]/40 bg-[#F04452]/10 px-3.5 py-1 text-[11px] font-bold text-[#F04452] mb-2 font-mono">
            <span className="inline-block h-2 w-2 rounded-full bg-[#F04452] animate-pulse" />
            INSTITUTIONAL PORTFOLIOS · 기관 프롭데스크
          </div>
          <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">
            기관 투자자 실시간 포트폴리오 터미널
          </h1>
          <p className="text-[12.5px] text-[#8E939D] mt-1 font-medium leading-relaxed">
            가상 자산 운용사, 연기금 및 IB 프롭데스크 50개 봇의 실시간 자산 구성 현황 및 델타를 모니터링합니다.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[12px] font-mono shrink-0">
          <span className="inline-flex items-center gap-2 rounded-full bg-[#F04452]/10 px-3.5 py-1 text-[#F04452] font-bold border border-[#F04452]/30">
            <span className="h-2 w-2 rounded-full bg-[#F04452] animate-pulse" />
            실시간 DB 연동 중
          </span>
        </div>
      </header>

      {/* 거시경제(Macro) & AI 뉴스 패러다임 시프트 장기 자산배분(SAA) 터미널 위젯 */}
      <MacroRegimeRebalanceWidget onRegimeChange={setActiveRegime} />

      {/* 마스터 기관 3원 연계(파생-채권-현물) 통합 엔진 위젯 */}
      <CrossAssetLinkageWidget />

      {/* 기관별 구체적 7대 섹터 주식 포트폴리오 터미널 위젯 */}
      <InstitutionalSectorPortfolioWidget activeRegime={activeRegime} />

      <div className="grid grid-cols-1 gap-5">
        {portfolios.length === 0 ? (
          <div className="p-12 text-center text-[#8E939D] bg-[#0E1117] rounded-3xl border border-[#212631] font-mono">
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
              <div key={p.bot_id} className="bg-[#0E1117] border border-[#212631] p-6 rounded-3xl space-y-4 shadow-xl">
                <div className="flex items-center justify-between border-b border-[#212631] pb-3">
                  <h3 className="text-[15px] font-black text-white flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#F04452]" />
                    <span>{displayName}</span>
                  </h3>
                  <span className="text-[11px] font-mono font-bold text-[#8E939D]">
                    최종 동기화 시각: {new Date(p.updated_at).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>

                <div className="text-[12.5px] font-mono">
                  {/* Table Header */}
                  <div className="grid grid-cols-5 border-b border-[#212631] pb-2.5 mb-2 font-extrabold text-[#8E939D] text-[11px] uppercase tracking-wider bg-[#090B0F] p-3 rounded-xl">
                    <div>자산군 (ASSET CLASS)</div>
                    <div className="text-right">평가 금액 (원)</div>
                    <div className="text-right">현재 비중</div>
                    <div className="text-right">목표 비중</div>
                    <div className="text-right">괴리율 (현재-목표)</div>
                  </div>

                  {/* Cash */}
                  <div className="grid grid-cols-5 py-2 items-center hover:bg-[#161B22] rounded-xl transition-colors px-3">
                    <div className="text-[#8E939D] font-bold flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#565A63]" />
                      현금 자산 (CASH)
                    </div>
                    <div className="text-right tabular-nums text-white font-black">{formatNumber(p.current_cash)}</div>
                    <div className="text-right tabular-nums font-black text-white">{formatPercent(cashRatio)}</div>
                    <div className="text-right tabular-nums text-[#8E939D] font-bold">{formatPercent(targetCash)}</div>
                    <div className={`text-right tabular-nums font-black ${cashRatio - targetCash > 0.001 ? "text-[#F04452]" : cashRatio - targetCash < -0.001 ? "text-[#3182F6]" : "text-[#565A63]"}`}>
                      {formatPercent(cashRatio - targetCash)}
                    </div>
                  </div>

                  {/* Stock */}
                  <div className="grid grid-cols-5 py-2 items-center hover:bg-[#161B22] rounded-xl transition-colors px-3">
                    <div className="text-[#3182F6] font-bold flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#3182F6]" />
                      주식 자산 (EQUITY)
                    </div>
                    <div className="text-right tabular-nums text-white font-black">{formatNumber(p.current_stock)}</div>
                    <div className="text-right tabular-nums font-black text-white">{formatPercent(stockRatio)}</div>
                    <div className="text-right tabular-nums text-[#8E939D] font-bold">{formatPercent(targetStock)}</div>
                    <div className={`text-right tabular-nums font-black ${stockRatio - targetStock > 0.001 ? "text-[#F04452]" : stockRatio - targetStock < -0.001 ? "text-[#3182F6]" : "text-[#565A63]"}`}>
                      {formatPercent(stockRatio - targetStock)}
                    </div>
                  </div>

                  {/* Bond */}
                  <div className="grid grid-cols-5 py-2 items-center hover:bg-[#161B22] rounded-xl transition-colors px-3">
                    <div className="text-[#00C805] font-bold flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#00C805]" />
                      채권 자산 (BOND)
                    </div>
                    <div className="text-right tabular-nums text-white font-black">{formatNumber(p.current_bond)}</div>
                    <div className="text-right tabular-nums font-black text-white">{formatPercent(bondRatio)}</div>
                    <div className="text-right tabular-nums text-[#8E939D] font-bold">{formatPercent(targetBond)}</div>
                    <div className={`text-right tabular-nums font-black ${bondRatio - targetBond > 0.001 ? "text-[#F04452]" : bondRatio - targetBond < -0.001 ? "text-[#3182F6]" : "text-[#565A63]"}`}>
                      {formatPercent(bondRatio - targetBond)}
                    </div>
                  </div>

                  {/* Commodity */}
                  <div className="grid grid-cols-5 py-2 items-center hover:bg-[#161B22] rounded-xl transition-colors px-3">
                    <div className="text-[#F59E0B] font-bold flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-[#F59E0B]" />
                      원자재 자산 (COMMODITY)
                    </div>
                    <div className="text-right tabular-nums text-white font-black">{formatNumber(p.current_commodity)}</div>
                    <div className="text-right tabular-nums font-black text-white">{formatPercent(commodityRatio)}</div>
                    <div className="text-right tabular-nums text-[#8E939D] font-bold">{formatPercent(targetCommodity)}</div>
                    <div className={`text-right tabular-nums font-black ${commodityRatio - targetCommodity > 0.001 ? "text-[#F04452]" : commodityRatio - targetCommodity < -0.001 ? "text-[#3182F6]" : "text-[#565A63]"}`}>
                      {formatPercent(commodityRatio - targetCommodity)}
                    </div>
                  </div>

                  {/* Total */}
                  <div className="grid grid-cols-5 border-t border-[#212631] mt-3 pt-3 font-black text-[13.5px] bg-[#161B22] p-3 rounded-xl">
                    <div className="text-white">총 운용 자산 (AUM)</div>
                    <div className="text-right text-[#F04452] tabular-nums font-black">{formatNumber(total)} 원</div>
                    <div className="text-right text-white tabular-nums">100.0%</div>
                    <div className="text-right text-white tabular-nums">100.0%</div>
                    <div className="text-right text-[#565A63] tabular-nums">0.0%</div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

