import { NextResponse } from 'next/server';
import { resolveAuthenticatedUserId } from '@/lib/auth/sessionAuth';
import { ensureLocalStandaloneReady, persistConfirmedState } from '@/lib/engine/localStandaloneServer';
import { memoryDb } from '@/lib/memoryDb/memoryStore';
import {
  getOptionAccountSummary,
  cancelOptionOrder,
  cancelAllOptionOrders,
  liquidateAllOptionPositions,
} from '@/lib/options/optionOrderService';

export async function GET() {
  try {
    await ensureLocalStandaloneReady();
    const authenticatedUserId = await resolveAuthenticatedUserId();
    if (!authenticatedUserId) {
      return NextResponse.json(
        { success: false, message: '로그인이 필요한 서비스입니다.' },
        { status: 401 }
      );
    }

    const summary = getOptionAccountSummary(memoryDb, authenticatedUserId);
    return NextResponse.json({ success: true, account: summary });
  } catch (err: any) {
    console.error('[GET /api/options/account Error]', err);
    return NextResponse.json(
      { success: false, message: err?.message || '옵션 계좌 조회 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    await ensureLocalStandaloneReady();
    const authenticatedUserId = await resolveAuthenticatedUserId();
    if (!authenticatedUserId) {
      return NextResponse.json(
        { success: false, message: '로그인이 필요한 서비스입니다.' },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: '올바른 요청 형식이 아닙니다.' },
        { status: 400 }
      );
    }

    const { action, orderId } = body as { action?: unknown; orderId?: unknown };

    if (action === 'cancel_one') {
      if (typeof orderId !== 'string' || !orderId.trim()) {
        return NextResponse.json(
          { success: false, message: '취소할 주문 ID가 필요합니다.' },
          { status: 400 }
        );
      }
      const res = await cancelOptionOrder({
        db: memoryDb,
        userId: authenticatedUserId,
        orderId: orderId.trim(),
        onPersist: persistConfirmedState,
      });
      const summary = getOptionAccountSummary(memoryDb, authenticatedUserId);
      return NextResponse.json(
        { success: res.success, message: res.message, account: summary },
        { status: res.statusCode }
      );
    }

    if (action === 'cancel_all') {
      const res = await cancelAllOptionOrders({
        db: memoryDb,
        userId: authenticatedUserId,
        onPersist: persistConfirmedState,
      });
      const summary = getOptionAccountSummary(memoryDb, authenticatedUserId);
      return NextResponse.json(
        {
          success: res.success,
          message: res.message,
          cancelledCount: res.cancelledCount,
          account: summary,
        },
        { status: res.statusCode }
      );
    }

    if (action === 'liquidate_all') {
      const res = await liquidateAllOptionPositions({
        db: memoryDb,
        userId: authenticatedUserId,
        onPersist: persistConfirmedState,
      });
      const summary = getOptionAccountSummary(memoryDb, authenticatedUserId);
      return NextResponse.json(
        {
          success: res.success,
          message: res.message,
          liquidatedCount: res.liquidatedCount,
          failures: res.failures,
          account: summary,
        },
        { status: res.statusCode }
      );
    }

    return NextResponse.json(
      { success: false, message: '지원하지 않는 옵션 계좌 액션입니다.' },
      { status: 400 }
    );
  } catch (err: any) {
    console.error('[POST /api/options/account Error]', err);
    return NextResponse.json(
      { success: false, message: err?.message || '옵션 계좌 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
