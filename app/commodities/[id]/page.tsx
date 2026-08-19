import { notFound } from "next/navigation";
import CommodityDetailClient from "./CommodityDetailClient";
import { commodityEngineInstance } from "@/app/api/commodities/route";
import { COMMODITY_DEFINITIONS } from "@/lib/commodities/definitions";

export const revalidate = 0;

export default async function CommodityDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // 1. 엔진 또는 마스터 정의에서 해당 종목 검색
  let commodity = commodityEngineInstance.getCommodity(id);

  if (!commodity) {
    // Ticker로 검색 시도
    const def = COMMODITY_DEFINITIONS.find(
      (d) => d.id.toLowerCase() === id.toLowerCase() || d.ticker.toLowerCase() === id.toLowerCase()
    );
    if (def) {
      commodity = commodityEngineInstance.getCommodity(def.id);
    }
  }

  if (!commodity) {
    notFound();
  }

  const activeEvents = commodityEngineInstance.getActiveEvents();
  const newsFeed = commodityEngineInstance.getNewsFeed();

  return (
    <CommodityDetailClient
      initialCommodity={commodity}
      initialEvents={activeEvents}
      initialNews={newsFeed}
    />
  );
}
