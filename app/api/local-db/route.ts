import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { memoryDb, GUEST_USER_ID, OrderRecord } from '@/lib/memoryDb/memoryStore';
import { createMemoryDbClient } from '@/lib/memoryDb/memoryDbClient';
import { ensureLocalStandaloneEngine } from '@/lib/engine/localStandaloneServer';
import { LocalMarketService, withStockLock, withAllStockLocks } from '@/lib/engine/marketService';
import { verifyAdminSession } from '@/lib/auth/adminAuth';

// 공개 시장 데이터 테이블 (SELECT 전용)
const PUBLIC_READ_TABLES = new Set([
  'stocks',
  'stock_price_history',
  'commodities',
  'options_contracts',
  'bonds',
  'exchange_rates',
  'market_news',
  'news',
  'news_v2',
  'player_events',
  'active_player_events',
  'active_manipulations',
  'institutional_portfolios',
  'bots_config',
  'admin_settings',
  'option_settlements',
  'bond_coupon_payments',
  'trades',
]);

// 외부 클라이언트가 직접 호출할 수 없는 내부 정산/유지보수 RPC 목록
const FORBIDDEN_INTERNAL_RPCS = new Set([
  'bulk_settle_trades',
  'update_cash_balance',
  'trim_old_market_data',
]);

export async function POST(request: Request) {
  try {
    ensureLocalStandaloneEngine();

    // 1. 서버 세션 기반 사용자 식별
    let session: any = null;
    try {
      session = await getServerSession(authOptions);
    } catch {
      session = null;
    }

    const isProd = process.env.NODE_ENV === 'production';
    const authenticatedUserId = session?.user?.id || (!isProd ? GUEST_USER_ID : null);

    const body = await request.json();
    const { action, tableName, query, fnName, params } = body;

    // ── 2. RPC 호출 제어 ──
    if (action === 'rpc') {
      if (!fnName || typeof fnName !== 'string') {
        return NextResponse.json({ data: null, error: { message: '함수 이름이 누락되었습니다.' } }, { status: 400 });
      }

      // 내부 정산/장부 조작 RPC는 클라이언트 호출 원천 차단 (403 Forbidden)
      if (FORBIDDEN_INTERNAL_RPCS.has(fnName)) {
        return NextResponse.json(
          { data: null, error: { message: `내부 시스템 RPC (${fnName})는 직접 호출할 수 없습니다.` } },
          { status: 403 }
        );
      }

      // 주문 제출 RPC: 요청 body의 user_id/is_bot을 신뢰하지 않고 서버 세션의 ID로 강제 주입
      if (fnName === 'submit_and_match_order') {
        if (!authenticatedUserId) {
          return NextResponse.json(
            { data: null, error: { message: '로그인이 필요한 서비스입니다.' } },
            { status: 401 }
          );
        }

        const stockId = params?.p_stock_id || params?.stock_id;
        const side = params?.p_side || params?.side;
        const price = Number(params?.p_price ?? params?.price);
        const size = Number(params?.p_size ?? params?.size);

        if (!stockId || (side !== 'buy' && side !== 'sell') || !Number.isFinite(price) || price <= 0 || !Number.isInteger(size) || size <= 0) {
          return NextResponse.json(
            { data: null, error: { message: '올바르지 않은 주문 파라미터입니다.' } },
            { status: 400 }
          );
        }

        const res = await LocalMarketService.submitOrder({
          userId: authenticatedUserId,
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

      // 기타 허용된 RPC 실행
      const mockClient = createMemoryDbClient();
      const result = await mockClient.rpc(fnName, params);
      return NextResponse.json(result);
    }

    // ── 3. 시장 리셋 (관리자 권한 필수) ──
    if (action === 'reset_market') {
      const auth = await verifyAdminSession(request);
      if (!auth.isAdmin) {
        return NextResponse.json(
          { data: null, error: { message: '시장 리셋은 관리자 권한이 필요합니다.' } },
          { status: 403 }
        );
      }

      // 모든 종목의 락을 획득하여 진행 중인 모든 거래가 완료된 후 안전하게 리셋
      const allStockIds = Array.from(memoryDb.stocks.keys());
      await withAllStockLocks(allStockIds, async () => {
        memoryDb.resetToSeedData();
      });

      return NextResponse.json({ success: true, message: 'Market reset successfully' });
    }

    // ── 4. 테이블 쿼리 실행 제어 (action === 'execute') ──
    if (action === 'execute') {
      if (!tableName || typeof tableName !== 'string') {
        return NextResponse.json({ data: null, error: { message: 'tableName이 필요합니다.' } }, { status: 400 });
      }

      const qAction = query?.action || 'select';

      // ── [A] 공개 시장 테이블 (SELECT 전용) ──
      if (PUBLIC_READ_TABLES.has(tableName)) {
        if (qAction !== 'select') {
          return NextResponse.json(
            { data: null, error: { message: `공개 시장 테이블(${tableName})은 수정할 수 없습니다.` } },
            { status: 403 }
          );
        }

        const qb = createMemoryDbClient().from(tableName);
        applyQueryOptions(qb, query);
        const result = await qb.execute();
        return NextResponse.json(result);
      }

      // ── [B] Holdings 테이블 (개인 자산 조회 전용) ──
      if (tableName === 'holdings') {
        if (!authenticatedUserId) {
          return NextResponse.json(
            { data: null, error: { message: '로그인이 필요한 서비스입니다.' } },
            { status: 401 }
          );
        }

        if (qAction !== 'select') {
          return NextResponse.json(
            { data: null, error: { message: '보유 주식 장부는 직접 수정할 수 없습니다.' } },
            { status: 403 }
          );
        }

        // 본인 소유의 holdings만 조회하도록 필터 강제 교체
        const safeQuery = { ...query };
        const otherFilters = (safeQuery.filters || []).filter(
          (f: any) => f.col !== 'user_id' && f.col !== 'userId'
        );
        safeQuery.filters = [...otherFilters, { col: 'user_id', op: 'eq', val: authenticatedUserId }];

        const qb = createMemoryDbClient().from('holdings');
        applyQueryOptions(qb, safeQuery);
        const result = await qb.execute();
        return NextResponse.json(result);
      }

      // ── [C] Profiles 테이블 (개인 프로필 조회 및 안전한 갱신) ──
      if (tableName === 'profiles') {
        if (qAction === 'select') {
          // 조회: 특정 유저 ID 필터 확인
          const eqId = query?.filters?.find((f: any) => (f.col === 'id' || f.col === 'user_id') && f.op === 'eq')?.val;
          const targetId = eqId ? String(eqId) : authenticatedUserId;

          if (!targetId) {
            return NextResponse.json({ data: null, error: { message: '인증이 필요합니다.' } }, { status: 401 });
          }

          const profile = memoryDb.profiles.get(targetId);
          if (!profile) {
            return NextResponse.json({ data: null, error: null });
          }

          // 본인이 아닌 경우 민감 자산 정보(cash 등) 보호
          const isOwner = authenticatedUserId && targetId === authenticatedUserId;
          const safeData = isOwner
            ? profile
            : {
                id: profile.id,
                user_id: profile.user_id,
                username: profile.username,
                nickname: profile.nickname,
                rank_tier: profile.rank_tier,
                created_at: profile.created_at,
              };

          return NextResponse.json({
            data: query?.isSingle || query?.isMaybeSingle ? safeData : [safeData],
            error: null,
          });
        }

        if (qAction === 'update') {
          if (!authenticatedUserId) {
            return NextResponse.json({ data: null, error: { message: '인증이 필요합니다.' } }, { status: 401 });
          }

          // cash, is_admin, net_worth 등 민감 장부/권한 필드 수정 원천 차단
          const payload = query?.payloadData || {};
          const forbiddenFields = ['cash', 'is_admin', 'net_worth', 'id', 'user_id'];
          const hasForbidden = Object.keys(payload).some((k) => forbiddenFields.includes(k));

          if (hasForbidden) {
            return NextResponse.json(
              { data: null, error: { message: '자산 및 권한 정보는 클라이언트에서 직접 수정할 수 없습니다.' } },
              { status: 403 }
            );
          }

          const existing = memoryDb.profiles.get(authenticatedUserId);
          if (!existing) {
            return NextResponse.json({ data: null, error: { message: '프로필을 찾을 수 없습니다.' } }, { status: 404 });
          }

          const updated = { ...existing, ...payload };
          memoryDb.profiles.set(authenticatedUserId, updated);
          return NextResponse.json({ data: updated, error: null });
        }

        return NextResponse.json(
          { data: null, error: { message: '프로필에 대한 해당 작업은 허용되지 않습니다.' } },
          { status: 403 }
        );
      }

      // ── [D] Orders 테이블 ──
      if (tableName === 'orders') {
        if (qAction === 'select') {
          const isUserQuery = query?.filters?.some((f: any) => f.col === 'user_id' || f.col === 'userId');

          if (isUserQuery) {
            if (!authenticatedUserId) {
              return NextResponse.json({ data: null, error: { message: '인증이 필요합니다.' } }, { status: 401 });
            }

            // 본인 주문만 조회하도록 user_id 강제 고정
            const safeQuery = { ...query };
            const otherFilters = (safeQuery.filters || []).filter(
              (f: any) => f.col !== 'user_id' && f.col !== 'userId'
            );
            safeQuery.filters = [...otherFilters, { col: 'user_id', op: 'eq', val: authenticatedUserId }];

            const qb = createMemoryDbClient().from('orders');
            applyQueryOptions(qb, safeQuery);
            const result = await qb.execute();
            return NextResponse.json(result);
          }

          // 시장 오더북 조회 (status in ['open', 'partial'])
          const qb = createMemoryDbClient().from('orders');
          applyQueryOptions(qb, query);
          const result = await qb.execute();
          return NextResponse.json(result);
        }

        // 주문 취소 처리 (status: 'cancelled' 업데이트)
        if (qAction === 'update') {
          if (!authenticatedUserId) {
            return NextResponse.json({ data: null, error: { message: '인증이 필요합니다.' } }, { status: 401 });
          }

          const payload = query?.payloadData || {};
          if (payload.status !== 'cancelled') {
            return NextResponse.json(
              { data: null, error: { message: '주문 상태는 취소(cancelled)로만 변경할 수 있습니다.' } },
              { status: 403 }
            );
          }

          const targetOrderId = query?.filters?.find((f: any) => f.col === 'id' && f.op === 'eq')?.val;
          if (!targetOrderId) {
            return NextResponse.json({ data: null, error: { message: '주문 ID가 필요합니다.' } }, { status: 400 });
          }

          const cancelRes = await LocalMarketService.cancelOrder({
            orderId: String(targetOrderId),
            userId: authenticatedUserId,
          });

          if (!cancelRes.success) {
            return NextResponse.json(
              { data: null, error: { message: cancelRes.message } },
              { status: cancelRes.statusCode }
            );
          }

          return NextResponse.json({ data: [cancelRes.order], error: null });
        }

        // orders에 대한 직접 insert / upsert / delete는 원천 차단
        return NextResponse.json(
          { data: null, error: { message: '주문 생성은 주문 제출 API(/api/orders)를 통해서만 가능합니다.' } },
          { status: 403 }
        );
      }

      return NextResponse.json(
        { data: null, error: { message: `테이블 ${tableName}에 대한 접근 권한이 없습니다.` } },
        { status: 403 }
      );
    }

    return NextResponse.json({ data: null, error: { message: '유효하지 않은 요청 액션입니다.' } }, { status: 400 });
  } catch (err: any) {
    console.error('[API local-db] Error processing request:', err);
    return NextResponse.json({ data: null, error: { message: err?.message || String(err) } }, { status: 500 });
  }
}

/**
 * 쿼리 빌더에 필터, 다중 정렬, 페이징 설정 복원
 */
function applyQueryOptions(qb: any, query: any): void {
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

  // 다단계 정렬 (orderSpecs) 우선 적용, 없으면 orderCol 하위 호환
  if (query?.orderSpecs && Array.isArray(query.orderSpecs) && query.orderSpecs.length > 0) {
    for (const spec of query.orderSpecs) {
      qb.order(spec.col, { ascending: spec.ascending ?? true });
    }
  } else if (query?.orderCol) {
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
}
