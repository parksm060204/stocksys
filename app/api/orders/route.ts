import { NextResponse } from 'next/server';
import { LocalMarketService } from '@/lib/engine/marketService';
import { resolveAuthenticatedUserId } from '@/lib/auth/sessionAuth';
import { ensureLocalStandaloneReady, persistConfirmedState } from '@/lib/engine/localStandaloneServer';
import { memoryDb } from '@/lib/memoryDb/memoryStore';
import { WindowRateLimiter } from '@/lib/rateLimit/windowLimiter';

// 인메모리 윈도우 Rate Limiter (유저당 1초 최대 15회 요청 허용 + 만료 엔트리 주기 정리)
const orderRateLimiter = new WindowRateLimiter(15, 1000);

function checkRateLimit(userId: string): boolean {
  return orderRateLimiter.allow(userId);
}

export async function POST(request: Request) {
  try {
    await ensureLocalStandaloneReady();
    // 1. 서버 세션 인증 (프로덕션 미인증은 거절, 개발 환경만 로컬 게스트 ID 허용)
    const authenticatedUserId = await resolveAuthenticatedUserId();

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

    if (memoryDb.optionsContracts.has(stock_id)) {
      return NextResponse.json(
        { success: false, filledQty: 0, message: '옵션 계약은 옵션 전용 주문 API(/api/options/order)를 이용해 주세요.' },
        { status: 400 }
      );
    }

    if (memoryDb.commodities.has(stock_id) || memoryDb.bonds.has(stock_id)) {
      return NextResponse.json(
        { success: false, filledQty: 0, message: '해당 자산군은 일반 주식 주문 경로로 거래할 수 없습니다.' },
        { status: 400 }
      );
    }

    if (!memoryDb.stocks.has(stock_id)) {
      return NextResponse.json(
        { success: false, filledQty: 0, message: '등록되지 않은 주식/ETF 종목입니다.' },
        { status: 404 }
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

    // 4. LocalMarketService를 통한 주문 검증, 매칭, 정산 및 락 내부 영속 저장 처리
    const result = await LocalMarketService.submitOrder({
      userId: authenticatedUserId,
      stockId: stock_id,
      side,
      price: numPrice,
      size: numSize,
      onPersist: persistConfirmedState,
    });

    if (!result.success) {
      const isSaveErr = String(result.message || '').includes('영속 저장');
      return NextResponse.json(
        { success: false, filledQty: 0, message: result.message },
        { status: isSaveErr ? 500 : 400 }
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
    await ensureLocalStandaloneReady();
    const authenticatedUserId = await resolveAuthenticatedUserId();

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

    const res = await LocalMarketService.cancelOrder({
      orderId,
      userId: authenticatedUserId,
      onPersist: persistConfirmedState,
    });

    return NextResponse.json(
      { success: res.success, message: res.message, orderId: res.order?.id || orderId },
      { status: res.statusCode }
    );
  } catch (err: any) {
    console.error('[DELETE /api/orders Error]', err);
    return NextResponse.json(
      { success: false, message: err?.message || '주문 취소 중 서버 내부 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
