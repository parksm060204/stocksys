import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { createClient as createSupabaseJsClient } from '@supabase/supabase-js';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { isLocalStandaloneMode } from '@/lib/engine/localDevMode';
import { getLocalStandaloneClient, ensureLocalStandaloneEngine } from '@/lib/engine/localStandaloneServer';
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

function getOrderServiceClient() {
  if (isLocalStandaloneMode()) {
    ensureLocalStandaloneEngine();
    return getLocalStandaloneClient();
  }

  const url = process.env.NEXT_PUBLIC_ENGINE_DB_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  // 보안 강화: anon key fallback 완전 제거 및 ENGINE_DB_SERVICE_ROLE_KEY 명칭 통일
  const serviceKey =
    process.env.ENGINE_DB_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error('❌ [Order API] Missing ENGINE_DB_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY) or DB URL.');
  }

  return createSupabaseJsClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: Request) {
  try {
    // 1. 서버 세션 인증 (클라이언트 body.user_id는 절대 신뢰하지 않고 무시)
    let authenticatedUserId: string | null = null;

    if (isLocalStandaloneMode()) {
      authenticatedUserId = GUEST_USER_ID;
    } else {
      const session = await getServerSession(authOptions);
      authenticatedUserId = session?.user?.id || null;
    }

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

    // 4. 단일 DB 트랜잭션 RPC(submit_and_match_order) 호출
    const client = getOrderServiceClient();
    const { data, error } = await client.rpc('submit_and_match_order', {
      p_user_id: authenticatedUserId,
      p_stock_id: stock_id,
      p_side: side,
      p_price: numPrice,
      p_size: numSize,
    });

    if (error) {
      console.warn('[Order RPC Warning]', error.message || error);
      return NextResponse.json(
        { success: false, filledQty: 0, message: error.message || '주문 처리 중 오류가 발생했습니다.' },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        orderId: data?.order_id,
        filledQty: data?.filled_qty ?? 0,
        execPrice: data?.exec_price,
        status: data?.status,
        message: data?.message || '주문이 처리되었습니다.',
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
