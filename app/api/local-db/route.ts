import { NextResponse } from 'next/server';
import { memoryDb } from '@/lib/memoryDb/memoryStore';
import { createMemoryDbClient } from '@/lib/memoryDb/memoryDbClient';
import { ensureLocalStandaloneEngine } from '@/lib/engine/localStandaloneServer';
import { isLocalStandaloneMode } from '@/lib/engine/localDevMode';
import { LocalMarketService } from '@/lib/engine/marketService';

export async function POST(request: Request) {
  // Production 또는 외부 DB 환경에서는 로컬 개발 API 접근을 원천 차단 (404 Not Found)
  if (!isLocalStandaloneMode()) {
    return new NextResponse(null, { status: 404 });
  }

  try {
    // Next.js dev process 내부 단일 MarketEngine 가동 보장
    ensureLocalStandaloneEngine();

    const body = await request.json();
    const { action, tableName, query, fnName, params } = body;

    // [Serialization Safety] submit_and_match_order는 반드시 LocalMarketService를 통해야 한다.
    // generic mockClient.rpc()로 직접 라우팅하면 per-stock mutex가 우회되어 race condition 발생 가능.
    if (action === 'rpc' && fnName === 'submit_and_match_order') {
      const userId = params?.p_user_id || params?.user_id;
      const stockId = params?.p_stock_id || params?.stock_id;
      const side = params?.p_side || params?.side;
      const price = Number(params?.p_price ?? params?.price);
      const size = Number(params?.p_size ?? params?.size);

      const res = await LocalMarketService.submitOrder({
        userId,
        stockId,
        side,
        price,
        size,
      });

      return NextResponse.json({
        data: {
          success: res.success,
          order_id: res.orderId,
          orderId: res.orderId,
          filled_qty: res.filledQty,
          filledQty: res.filledQty,
          exec_price: res.execPrice,
          execPrice: res.execPrice,
          status: res.status,
          message: res.message,
        },
        error: res.success ? null : { message: res.message },
      });
    }

    const mockClient = createMemoryDbClient();

    if (action === 'rpc') {
      const result = await mockClient.rpc(fnName, params);
      return NextResponse.json(result);
    }

    if (action === 'reset_market') {
      memoryDb.resetToSeedData();
      return NextResponse.json({ success: true, message: 'Market reset successfully' });
    }

    if (action === 'execute') {
      const qb = mockClient.from(tableName);
      // 필터 및 설정 복원
      if (query?.filters && Array.isArray(query.filters)) {
        for (const f of query.filters) {
          if (f.op === 'eq') qb.eq(f.col, f.val);
          else if (f.op === 'neq') qb.neq(f.col, f.val);
          else if (f.op === 'gt') qb.gt(f.col, f.val);
          else if (f.op === 'gte') qb.gte(f.col, f.val);
          else if (f.op === 'lt') qb.lt(f.col, f.val);
          else if (f.op === 'lte') qb.lte(f.col, f.val);
          else if (f.op === 'in') qb.in(f.col, f.val);
        }
      }

      if (query?.orderCol) {
        qb.order(query.orderCol, { ascending: query.orderAsc ?? true });
      }
      if (query?.limitCount !== undefined) {
        qb.limit(query.limitCount);
      }
      if (query?.isSingle) {
        qb.single();
      }
      if (query?.isMaybeSingle) {
        qb.maybeSingle();
      }

      if (query?.action === 'insert') {
        qb.insert(query.payloadData);
      } else if (query?.action === 'update') {
        qb.update(query.payloadData);
      } else if (query?.action === 'delete') {
        qb.delete();
      } else if (query?.action === 'upsert') {
        qb.upsert(query.payloadData, query.upsertOptions);
      } else {
        qb.select();
      }

      const result = await qb.execute();
      return NextResponse.json(result);
    }

    return NextResponse.json({ data: null, error: { message: 'Invalid action' } }, { status: 400 });
  } catch (err: any) {
    console.error('[API local-db] Error processing request:', err);
    return NextResponse.json({ data: null, error: { message: err?.message || String(err) } }, { status: 500 });
  }
}
