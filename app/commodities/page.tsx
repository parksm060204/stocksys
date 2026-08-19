import Link from "next/link";
import { COMMODITY_DEFINITIONS } from "@/lib/commodities/definitions";
import CommoditiesClientList from "./CommoditiesClientList";
import { commodityEngineInstance } from "@/app/api/commodities/route";

export const revalidate = 0;

export default async function CommoditiesPage() {
  const commodities = commodityEngineInstance.getAllCommodities().map((c) => ({
    id: c.id,
    ticker: c.ticker,
    name: c.name,
    nameKo: c.nameKo,
    category: c.category,
    unit: c.unit,
    currentPrice: c.currentPrice,
    previousPrice: c.previousPrice,
    openPrice: c.openPrice,
    high: c.high,
    low: c.low,
    volume: c.volume,
    priceHistory: c.priceHistory,
    marginRequirement: c.marginRequirement,
  }));

  const activeEvents = commodityEngineInstance.getActiveEvents().map((ev) => ({
    id: ev.id,
    title: ev.title,
    headline: ev.headline,
    magnitude: ev.magnitude,
    remainingTicks: ev.remainingTicks,
    totalTicks: ev.totalTicks,
  }));

  return (
    <div className="mx-auto max-w-7xl px-6 py-6 space-y-6">
      {/* ── 브레드크럼 ── */}
      <nav className="flex items-center gap-2 text-[12px] text-[#8E939D] font-mono">
        <Link href="/" className="hover:text-white font-medium transition-colors">
          메인홈
        </Link>
        <span>/</span>
        <span className="text-white font-bold">원자재 선물 (Commodities)</span>
      </nav>

      {/* ── 헤더 배너 ── */}
      <div className="bg-[#0E1117] border border-[#212631] p-6 rounded-3xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-2xl">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#F04452]/40 bg-[#F04452]/10 px-3.5 py-1 text-[11px] font-bold text-[#F04452] mb-2">
            <span className="inline-block h-2 w-2 rounded-full bg-[#F04452] animate-pulse" />
            COMMODITIES DERIVATIVES MARKET · 5대 카테고리 12개 선물 시장
          </div>
          <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">
            원자재 선물 시장 (Commodities Market)
          </h1>
          <p className="text-[12.5px] text-[#8E939D] mt-1 font-medium leading-relaxed">
            에너지, 귀금속, 산업금속, 농산물(계절성 곡선), 축산물 등 글로벌 거시경제와 수급 압력에 반응하는 실시간 원자재 선물 시장입니다.
          </p>
        </div>

        <div className="flex gap-6 text-right bg-[#161B22] px-5 py-3 rounded-2xl border border-[#212631] shrink-0 font-mono text-xs">
          <div>
            <div className="text-[10.5px] text-[#565A63] font-bold">상장 상품</div>
            <div className="text-white font-black text-[15px]">{COMMODITY_DEFINITIONS.length} 종목</div>
          </div>
          <div className="border-l border-[#212631] pl-6">
            <div className="text-[10.5px] text-[#565A63] font-bold">거래 메커니즘</div>
            <div className="text-[#F04452] font-black text-[15px]">5종 기관 봇</div>
          </div>
        </div>
      </div>

      {/* ── 인터랙티브 목록 클라이언트 컴포넌트 ── */}
      <CommoditiesClientList
        initialCommodities={commodities}
        initialEvents={activeEvents}
      />
    </div>
  );
}
