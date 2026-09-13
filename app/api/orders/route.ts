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
    // 1. 서버 세션 인증 (세션 사용자 ID 또는 로컬 게스트 ID)
    const session = await getServerSession(authOptions);
    const authenticatedUserId = session?.user?.id || GUEST_USER_ID;

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
