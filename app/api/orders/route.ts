import { NextResponse } from 'next/server';
import { createClient as createSupabaseJsClient } from '@supabase/supabase-js';
import { isLocalStandaloneMode } from '@/lib/engine/localDevMode';
import { getLocalStandaloneClient, ensureLocalStandaloneEngine } from '@/lib/engine/localStandaloneServer';
import { submitAndMatchOrder, OrderInput } from '@/lib/engine/dbMatching';

function getOrderServiceClient() {
  if (isLocalStandaloneMode()) {
    ensureLocalStandaloneEngine();
    return getLocalStandaloneClient();
  }

  const url = process.env.NEXT_PUBLIC_ENGINE_DB_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.ENGINE_DB_SERVICE_KEY ||
    process.env.NEXT_PUBLIC_ENGINE_DB_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !serviceKey) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('[Order API] Missing Supabase URL or Service Role Key in production');
    }
    ensureLocalStandaloneEngine();
    return getLocalStandaloneClient();
  }

  return createSupabaseJsClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { stock_id, user_id, side, price, size } = body;

    if (!stock_id || !side || !price || !size) {
      return NextResponse.json(
        { success: false, filledQty: 0, message: '필수 주문 정보가 누락되었습니다.' },
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

    if (numPrice <= 0 || numSize <= 0 || isNaN(numPrice) || isNaN(numSize)) {
      return NextResponse.json(
        { success: false, filledQty: 0, message: '가격과 수량은 0보다 큰 숫자여야 합니다.' },
        { status: 400 }
      );
    }

    const orderInput: OrderInput = {
      stock_id: String(stock_id),
      user_id: user_id ? String(user_id) : '',
      side,
      price: numPrice,
      size: Math.floor(numSize),
    };

    const client = getOrderServiceClient();
    const result = await submitAndMatchOrder(client as any, orderInput);

    return NextResponse.json(result, { status: result.success ? 200 : 400 });
  } catch (error: any) {
    console.error('[POST /api/orders Error]', error);
    return NextResponse.json(
      { success: false, filledQty: 0, message: error?.message || '주문 처리 중 서버 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
