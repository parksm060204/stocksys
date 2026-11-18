import { NextResponse } from 'next/server';
import { CommodityMarketEngine } from '@/lib/commodities/CommodityMarketEngine';
import { COMMODITY_DEFINITIONS } from '@/lib/commodities/definitions';
import { verifyAdminSession } from '@/lib/auth/adminAuth';
import { resolveAuthenticatedUserId } from '@/lib/auth/sessionAuth';
import { memoryDb } from '@/lib/memoryDb/memoryStore';
import { ensureLocalStandaloneReady, persistConfirmedState } from '@/lib/engine/localStandaloneServer';
import {
  cancelCommodityOrders,
  getUsdToKrwRate,
  reserveMarginAndSubmitCommodityOrder,
} from '@/lib/commodities/commodityLedger';
import { getAvailableCashKrw } from '@/lib/engine/orderRisk';

// 글로벌 싱글톤 인스턴스 (Next.js HMR 안전)
const globalForCommodities = globalThis as unknown as {
  commodityEngine?: CommodityMarketEngine;
};

export const commodityEngineInstance: CommodityMarketEngine =
  globalForCommodities.commodityEngine ||
  new CommodityMarketEngine({
    totalBots: 50,
    eventProbability: 0.02,
    db: memoryDb,
  });

commodityEngineInstance.attachDatabase(memoryDb);

if (!globalForCommodities.commodityEngine) {
  globalForCommodities.commodityEngine = commodityEngineInstance;
}

async function ensureCommodityEngineReady(): Promise<void> {
  await ensureLocalStandaloneReady();
  await commodityEngineInstance.reconcileWithDatabase(memoryDb);
  commodityEngineInstance.start(1500, persistConfirmedState);
}

export async function GET(req: Request) {
  await ensureCommodityEngineReady();
  const { searchParams } = new URL(req.url);
  const commodityId = searchParams.get('id');

  const commodities = commodityEngineInstance.getAllCommodities();
  const activeEvents = commodityEngineInstance.getActiveEvents();
  const newsFeed = commodityEngineInstance.getNewsFeed();
  const usdToKrwRate = getUsdToKrwRate(memoryDb);
  const authenticatedUserId = await resolveAuthenticatedUserId();

  if (commodityId) {
    const commodity = commodityEngineInstance.getCommodity(commodityId);
    const orderBook = commodityEngineInstance.getOrderBook(commodityId);
    const depth = orderBook ? orderBook.getDepth(10) : { bids: [], asks: [] };
    const spread = orderBook && commodity ? orderBook.getSpread(commodity.currentPrice) : null;

    const myOrders: any[] = [];
    let myPosition: any = null;
    let availableCashKrw: number | null = null;
    if (authenticatedUserId) {
      for (const ord of memoryDb.commodityOpenOrders.values()) {
        if (ord.userId === authenticatedUserId && ord.commodityId === commodityId) {
          const res = memoryDb.commodityMarginReservations.get(ord.id);
          myOrders.push({
            ...ord,
            status: res?.status ?? 'open',
            reserved_krw: res?.reserved_krw ?? 0,
            margin_per_contract_krw: res?.margin_per_contract_krw ?? 0,
          });
        }
      }
      myOrders.sort((a, b) => (b.createdAtTime || 0) - (a.createdAtTime || 0));
      myPosition = memoryDb.commodityPositions.get(`${authenticatedUserId}_${commodityId}`) || null;
      availableCashKrw = getAvailableCashKrw(memoryDb, authenticatedUserId).availableCash;
    }

    return NextResponse.json({
      success: true,
      tick: commodityEngineInstance.currentTick,
      usdToKrwRate,
      commodity,
      depth,
      spread,
      activeEvents,
      newsFeed: newsFeed.slice(0, 10),
      myOrders,
      myPosition,
      availableCashKrw,
    });
  }

  return NextResponse.json({
    success: true,
    tick: commodityEngineInstance.currentTick,
    usdToKrwRate,
    commodities,
    activeEvents,
    newsFeed: newsFeed.slice(0, 10),
    definitions: COMMODITY_DEFINITIONS,
  });
}

export async function POST(req: Request) {
  try {
    await ensureCommodityEngineReady();
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, message: '올바른 JSON 요청 본문이 필요합니다.' }, { status: 400 });
    }

    const { action, templateId, order } = body;

    if (action === 'trigger_event') {
      const auth = await verifyAdminSession(req);
      if (!auth.isAdmin) {
        return NextResponse.json(
          { success: false, message: auth.error || '원자재 이벤트 주입은 관리자 권한이 필요합니다.' },
          { status: 403 }
        );
      }

      if (!templateId || typeof templateId !== 'string') {
        return NextResponse.json({ success: false, message: '유효한 templateId가 필요합니다.' }, { status: 400 });
      }

      const event = commodityEngineInstance.eventSystem.triggerEventById(
        templateId,
        commodityEngineInstance.currentTick
      );
      if (!event) {
        return NextResponse.json({ success: false, message: '존재하지 않는 이벤트 템플릿입니다.' }, { status: 404 });
      }
      return NextResponse.json({ success: true, event });
    }

    if (action === 'submit_order') {
      const authenticatedUserId = await resolveAuthenticatedUserId();
      if (!authenticatedUserId) {
        return NextResponse.json(
          { success: false, message: '로그인이 필요한 서비스입니다.' },
          { status: 401 }
        );
      }

      if (!order || typeof order !== 'object' || Array.isArray(order)) {
        return NextResponse.json({ success: false, message: '유효한 주문 객체(order)가 필요합니다.' }, { status: 400 });
      }

      // 참여자 위조(botId 또는 타인의 userId) 거절
      if (order.botId !== undefined && order.botId !== null) {
        return NextResponse.json({ success: false, message: '클라이언트는 botId를 지정할 수 없습니다.' }, { status: 403 });
      }
      if (order.userId !== undefined && order.userId !== null && order.userId !== authenticatedUserId) {
        return NextResponse.json({ success: false, message: '다른 사용자의 식별자로 주문할 수 없습니다.' }, { status: 403 });
      }

      const { commodityId, side, type, price, size } = order;
      const commodity = typeof commodityId === 'string' ? commodityEngineInstance.getCommodity(commodityId) : undefined;
      if (!commodity) {
        return NextResponse.json({ success: false, message: '존재하지 않는 원자재 종목(commodityId)입니다.' }, { status: 400 });
      }
      if (side !== 'buy' && side !== 'sell') {
        return NextResponse.json({ success: false, message: '주문 방향(side)은 buy 또는 sell이어야 합니다.' }, { status: 400 });
      }
      if (type !== 'limit' && type !== 'market') {
        return NextResponse.json({ success: false, message: '주문 유형(type)은 limit 또는 market이어야 합니다.' }, { status: 400 });
      }
      if (typeof size !== 'number' || !Number.isFinite(size) || !Number.isInteger(size) || size <= 0) {
        return NextResponse.json({ success: false, message: '주문 수량(size)은 1 이상의 정수여야 합니다.' }, { status: 400 });
      }
      if (type === 'limit') {
        if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
          return NextResponse.json({ success: false, message: '지정가 주문 가격(price)은 0보다 큰 유한한 숫자여야 합니다.' }, { status: 400 });
        }
      }

      const reserveResult = await reserveMarginAndSubmitCommodityOrder({
        db: memoryDb,
        commodity,
        userId: authenticatedUserId,
        side,
        type,
        price: type === 'limit' ? price : commodity.currentPrice,
        size,
        submitToEngine: () =>
          commodityEngineInstance.submitUserOrder({
            commodityId,
            userId: authenticatedUserId,
            side,
            type,
            price: type === 'limit' ? price : commodity.currentPrice,
            size,
          }),
        rollbackFromEngine: (orderId) => {
          commodityEngineInstance.removeUserOrder(commodityId, orderId);
        },
        onPersist: persistConfirmedState,
        runWithEngineLock: (fn) => commodityEngineInstance.runWithTickLock(fn),
      });

      if (!reserveResult.success || !reserveResult.order) {
        return NextResponse.json(
          { success: false, message: reserveResult.message },
          { status: reserveResult.statusCode }
        );
      }

      return NextResponse.json({
        success: true,
        order: reserveResult.order,
        reservedMarginKrw: reserveResult.reservation?.reserved_krw ?? 0,
        remainingCash: reserveResult.remainingCash,
      });
    }

    if (action === 'cancel_order' || action === 'cancel_all_orders') {
      const authenticatedUserId = await resolveAuthenticatedUserId();
      if (!authenticatedUserId) {
        return NextResponse.json(
          { success: false, message: '로그인이 필요한 서비스입니다.' },
          { status: 401 }
        );
      }

      const orderIds =
        action === 'cancel_order'
          ? (typeof body.orderId === 'string'
              ? [body.orderId]
              : Array.isArray(body.orderIds)
                ? body.orderIds.map(String)
                : [])
          : undefined;

      if (action === 'cancel_order' && (!orderIds || orderIds.length === 0)) {
        return NextResponse.json({ success: false, message: '취소할 주문 ID(orderId)가 필요합니다.' }, { status: 400 });
      }

      const cancelRes = await cancelCommodityOrders({
        db: memoryDb,
        userId: authenticatedUserId,
        orderIds,
        commodityId: typeof body.commodityId === 'string' ? body.commodityId : undefined,
        removeFromBook: (cid, oid) => commodityEngineInstance.removeUserOrder(cid, oid),
        restoreToBook: (cid, ord) => commodityEngineInstance.restoreUserOrder(cid, ord),
        onPersist: persistConfirmedState,
        runWithEngineLock: (fn) => commodityEngineInstance.runWithTickLock(fn),
      });

      if (!cancelRes.success) {
        return NextResponse.json(
          { success: false, message: cancelRes.message },
          { status: cancelRes.statusCode }
        );
      }

      return NextResponse.json({
        success: true,
        message: cancelRes.message,
        cancelledOrderIds: cancelRes.cancelledOrderIds,
        refundedKrw: cancelRes.refundedKrw,
        remainingCash: cancelRes.remainingCash,
      });
    }

    return NextResponse.json({ success: false, message: 'Invalid action' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ success: false, message: e?.message || 'Internal Server Error' }, { status: 500 });
  }
}
