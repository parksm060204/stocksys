import { NextResponse } from 'next/server';
import { memoryDb } from '@/lib/memoryDb/memoryStore';
import { createMockSupabaseClient } from '@/lib/memoryDb/mockSupabaseClient';
import { ensureLocalStandaloneEngine } from '@/lib/engine/localStandaloneServer';

export async function POST(request: Request) {
  try {
    // Next.js dev process 내부 단일 MarketEngine 가동 보장
    ensureLocalStandaloneEngine();

    const body = await request.json();
    const { action, tableName, query, fnName, params } = body;

    const mockClient = createMockSupabaseClient();

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
