import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { LocalMarketService } from '@/lib/engine/marketService';
import { GUEST_USER_ID } from '@/lib/memoryDb/memoryStore';

// 인메모리 슬라이딩 윈도우 Rate Limiter (유저당 1초 최대 15회 요청 허용)
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(userId);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(userId, { count: 1, resetAt: now + 1000 });
    return true;
  }

  if (entry.count >= 15) {
    return false;
  }

  entry.count++;
  return true;
}

export async function POST(request: Request) {
  try {
    // 1. 서버 세션 인증 (프로덕션 미인증은 거절, 개발 환경만 로컬 게스트 ID 허용)
    let session: any = null;
    try {
      session = await getServerSession(authOptions);
    } catch {
      session = null;
    }

    const isProd = process.env.NODE_ENV === 'production';
    const authenticatedUserId = session?.user?.id || (!isProd ? GUEST_USER_ID : null);

    if (!authenticatedUserId) {
      return NextResponse.json(
        { success: false, filledQty: 0, message: '로그인이 필요한 서비스입니다. 로그인 후 다시 시도해주세요.' },
        { status: 401 }
      );
    }

    // 2. Abuse 방지 Rate Limit 체크
    if (!checkRateLimit(authenticatedUserId)) {
      return NextResponse.json(
        { success: false, filledQty: 0, message: '주문 요청이 너무 빈번합니다. 잠시 후 다시 시도해주세요.' },
        { status: 429 }
      );
    }

    // 3. 입력값 엄격 검증
    const body = await request.json();
    const { stock_id, side, price, size } = body;

    if (!stock_id || typeof stock_id !== 'string') {
      return NextResponse.json(
        { success: false, filledQty: 0, message: '올바른 종목 식별자(stock_id)가 필요합니다.' },
        { status: 400 }
      );
    }

    if (side !== 'buy' && side !== 'sell') {
      return NextResponse.json(
        { success: false, filledQty: 0, message: 'side는 buy 또는 sell이어야 합니다.' },
        { status: 400 }
      );
    }

    const numPrice = Number(price);
    const numSize = Number(size);

    if (!Number.isFinite(numPrice) || numPrice <= 0) {
      return NextResponse.json(
        { success: false, filledQty: 0, message: '주문 가격은 0보다 큰 유한한 숫자여야 합니다.' },
        { status: 400 }
      );
    }

    if (!Number.isInteger(numSize) || numSize <= 0) {
      return NextResponse.json(
        { success: false, filledQty: 0, message: '주문 수량은 1주 이상의 정수여야 합니다.' },
        { status: 400 }
      );
    }

    // 4. LocalMarketService를 통한 주문 검증, 매칭, 정산 처리
    const result = await LocalMarketService.submitOrder({
      userId: authenticatedUserId,
      stockId: stock_id,
      side,
      price: numPrice,
      size: numSize,
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, filledQty: 0, message: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        orderId: result.orderId,
        filledQty: result.filledQty,
        execPrice: result.execPrice,
        status: result.status,
        message: result.message,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[POST /api/orders Error]', error);
    return NextResponse.json(
      { success: false, filledQty: 0, message: error?.message || '주문 처리 중 서버 내부 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    let session: any = null;
    try {
      session = await getServerSession(authOptions);
    } catch {
      session = null;
    }

    const isProd = process.env.NODE_ENV === 'production';
    const authenticatedUserId = session?.user?.id || (!isProd ? GUEST_USER_ID : null);

    if (!authenticatedUserId) {
      return NextResponse.json(
        { success: false, message: '로그인이 필요한 서비스입니다.' },
        { status: 401 }
      );
    }

    const { searchParams } = new URL(request.url);
    const orderId = searchParams.get('order_id') || searchParams.get('id');

    if (!orderId) {
      return NextResponse.json(
        { success: false, message: '취소할 주문 식별자(order_id)가 필요합니다.' },
        { status: 400 }
      );
    }

    const { memoryDb } = await import('@/lib/memoryDb/memoryStore');
    const { withStockLock } = await import('@/lib/engine/marketService');

    const order = memoryDb.orders.get(orderId);
    if (!order) {
      return NextResponse.json(
        { success: false, message: '주문을 찾을 수 없습니다.' },
        { status: 404 }
      );
    }

    if (order.user_id !== authenticatedUserId) {
      return NextResponse.json(
        { success: false, message: '본인의 주문만 취소할 수 있습니다.' },
        { status: 403 }
      );
    }

    let cancelled = false;
    await withStockLock(order.stock_id, async () => {
      if (order.status === 'open' || order.status === 'partial') {
        order.status = 'cancelled';
        memoryDb.orders.set(order.id, order);
        memoryDb.publish('orders_changes', { eventType: 'UPDATE', new: order });
        cancelled = true;
      }
    });

    if (!cancelled) {
      return NextResponse.json(
        { success: false, message: `이미 ${order.status} 상태인 주문은 취소할 수 없습니다.` },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, message: '주문이 정상적으로 취소되었습니다.', orderId });
  } catch (err: any) {
    console.error('[DELETE /api/orders Error]', err);
    return NextResponse.json(
      { success: false, message: err?.message || '주문 취소 중 서버 내부 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
