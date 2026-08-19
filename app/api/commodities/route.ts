import { NextResponse } from 'next/server';
import { CommodityMarketEngine } from '@/lib/commodities/CommodityMarketEngine';
import { COMMODITY_DEFINITIONS } from '@/lib/commodities/definitions';

// 글로벌 싱글톤 인스턴스 (Next.js HMR 안전)
const globalForCommodities = globalThis as unknown as {
  commodityEngine?: CommodityMarketEngine;
};

export const commodityEngineInstance: CommodityMarketEngine =
  globalForCommodities.commodityEngine ||
  new CommodityMarketEngine({
    totalBots: 50,
    eventProbability: 0.02,
  });

if (!globalForCommodities.commodityEngine) {
  globalForCommodities.commodityEngine = commodityEngineInstance;
  // 1.5초 주기로 엔진 자동 틱 가동
  commodityEngineInstance.start(1500);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const commodityId = searchParams.get('id');

  const commodities = commodityEngineInstance.getAllCommodities();
  const activeEvents = commodityEngineInstance.getActiveEvents();
  const newsFeed = commodityEngineInstance.getNewsFeed();

  if (commodityId) {
    const commodity = commodityEngineInstance.getCommodity(commodityId);
    const orderBook = commodityEngineInstance.getOrderBook(commodityId);
    const depth = orderBook ? orderBook.getDepth(10) : { bids: [], asks: [] };
    const spread = orderBook && commodity ? orderBook.getSpread(commodity.currentPrice) : null;

    return NextResponse.json({
      success: true,
      tick: commodityEngineInstance.currentTick,
      commodity,
      depth,
      spread,
      activeEvents,
      newsFeed: newsFeed.slice(0, 10),
    });
  }

  return NextResponse.json({
    success: true,
    tick: commodityEngineInstance.currentTick,
    commodities,
    activeEvents,
    newsFeed: newsFeed.slice(0, 10),
    definitions: COMMODITY_DEFINITIONS,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { action, templateId, order } = body;

    if (action === 'trigger_event' && templateId) {
      const event = commodityEngineInstance.eventSystem.triggerEventById(
        templateId,
        commodityEngineInstance.currentTick
      );
      return NextResponse.json({ success: true, event });
    }

    if (action === 'submit_order' && order) {
      const placedOrder = commodityEngineInstance.submitUserOrder(order);
      return NextResponse.json({ success: true, order: placedOrder });
    }

    return NextResponse.json({ success: false, message: 'Invalid action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e.message }, { status: 500 });
  }
}
