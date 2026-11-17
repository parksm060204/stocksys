import { NextResponse } from 'next/server';
import { resolveAuthenticatedUserId } from '@/lib/auth/sessionAuth';
import { ensureLocalStandaloneReady, persistConfirmedState } from '@/lib/engine/localStandaloneServer';
import { memoryDb } from '@/lib/memoryDb/memoryStore';
import { submitAuthoritativeOptionOrder } from '@/lib/options/optionOrderService';

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

    const { contractId, ticker, side, orderType, price, qty } = body;

    const result = await submitAuthoritativeOptionOrder({
      db: memoryDb,
      userId: authenticatedUserId,
      contractId: typeof contractId === 'string' ? contractId : undefined,
      ticker: typeof ticker === 'string' ? ticker : undefined,
      side,
      orderType,
      price,
      qty,
      onPersist: persistConfirmedState,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, message: result.message },
        { status: result.statusCode }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      order: result.order,
    });
  } catch (err: any) {
    console.error('[POST /api/options/order Error]', err);
    return NextResponse.json(
      { success: false, message: err?.message || '옵션 주문 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
