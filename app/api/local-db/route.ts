import { NextResponse } from 'next/server';
import { memoryDb, type ProfileRecord } from '@/lib/memoryDb/memoryStore';
import { createMemoryDbClient } from '@/lib/memoryDb/memoryDbClient';
import { ensureLocalStandaloneReady, getLocalStandaloneEngine, persistConfirmedState, resetStandaloneMarketAtomically } from '@/lib/engine/localStandaloneServer';
import { LocalMarketService } from '@/lib/engine/marketService';
import { verifyAdminSession } from '@/lib/auth/adminAuth';
import { resolveAuthenticatedUserId } from '@/lib/auth/sessionAuth';
import { authorizeNewsRecord, canReadRumor } from '@/lib/news/accessPolicy';
import { pruneExpiredProfileEntitlements } from '@/lib/shop/catalog';
import { executeCurrencyExchange } from '@/lib/exchange/exchangeService';
import { withResolvedAccountLocks } from '@/lib/memoryDb/accountLocks';
import { persistenceManager, runWithCommitGate } from '@/lib/memoryDb/PersistenceManager';
import { allowStockOrderRequest } from '@/lib/rateLimit/stockOrderLimiter';

// 공개 시장 데이터 테이블 (SELECT 전용)
const PUBLIC_READ_TABLES = new Set([
  'stocks',
  'stock_price_history',
  'commodities',
  'options_contracts',
  'bonds',
  'exchange_rates',
  'media_outlets',
  'market_news',
  'news',
  'news_v2',
  'player_events',
  'institutional_portfolios',
  'trades',
]);
const ADMIN_ONLY_READ_TABLES = new Set(['active_manipulations', 'admin_settings']);
const PUBLIC_STOCK_COLUMNS = new Set([
  'id',
  'ticker',
  'name',
  'market',
  'currency',
  'current_price',
  'previous_close',
  'open_price',
  'high',
  'low',
  'high_price',
  'low_price',
  'volume',
  'change_rate',
  'market_cap',
  'pe_ratio',
  'dividend_yield',
  'sector',
  'sector_id',
  'theme_ids',
  'is_listed',
  'is_core',
  'shares_outstanding',
  'floating_shares',
  'base_liquidity',
  'base_spread_bps',
  'base_depth_shares',
  'institutional_fit',
  'macro_exposure',
  'description',
  'listed_at',
  'financials',
  'relevance_weight',
  'created_at',
  'updated_at',
]);
const PUBLIC_TRADE_COLUMNS = new Set([
  'id',
  'stock_id',
  'price',
  'size',
  'buyer_is_bot',
  'seller_is_bot',
  'created_at',
  'sequence',
  'cursor',
]);
const NEWS_TABLES = new Set(['market_news', 'news', 'news_v2']);
const PUBLIC_NEWS_COLUMNS = new Set([
  'id',
  'type',
  'category',
  'news_type',
  'eventType',
  'publisher',
  'title',
  'headline',
  'target_sector',
  'related_sector',
  'sector_id',
  'target_ticker',
  'related_ticker',
  'stock_id',
  'impact_score',
  'sentiment',
  'sentiment_score',
  'simulation_time',
  'sequence',
  'created_at',
  'publishedAt',
  'effectiveFrom',
  'scope',
  'sectorId',
]);
const SUBSCRIBER_NEWS_COLUMNS = new Set([
  ...PUBLIC_NEWS_COLUMNS,
  'content',
  'summary',
  'body',
]);
const USER_SCOPED_READ_TABLES = new Set(['option_settlements', 'bond_coupon_payments', 'active_player_events']);
const ALLOWED_PROFILE_UPDATE_FIELDS = new Set(['username', 'nickname']);
const PUBLIC_PROFILE_COLUMNS = new Set([
  'id',
  'user_id',
  'username',
  'nickname',
  'rank_tier',
  'created_at',
]);
const SUPPORTED_PROFILE_FILTER_COLUMNS = new Set(['id', 'user_id', 'userId']);

function findProfileByAuthId(userId: string | null): ProfileRecord | undefined {
  if (!userId) return undefined;
  return memoryDb.resolveProfileByUserId(userId);
}

function hasDisallowedQueryColumns(query: any, allowedCols: Set<string>): boolean {
  if (query?.filters !== undefined) {
    if (!Array.isArray(query.filters)) return true;
    if (query.filters.some((f: any) => typeof f?.col !== 'string' || !allowedCols.has(f.col))) {
      return true;
    }
  }
  if (query?.orFilterGroups?.some((group: string) => group.split(',').some((clause) => !allowedCols.has(clause.split('.', 1)[0].trim())))) {
    return true;
  }
  if (query?.orderCol !== undefined && query?.orderCol !== null && query?.orderCol !== '') {
    if (typeof query.orderCol !== 'string' || !allowedCols.has(query.orderCol)) {
      return true;
    }
  }
  if (query?.orderSpecs !== undefined) {
    if (!Array.isArray(query.orderSpecs)) return true;
    if (query.orderSpecs.some((s: any) => typeof s?.col !== 'string' || !allowedCols.has(s.col))) {
      return true;
    }
  }
  return false;
}

function sanitizePublicStockRecord(stock: any) {
  if (!stock || typeof stock !== 'object') return stock;
  const safeStock: Record<string, any> = {};
  for (const col of PUBLIC_STOCK_COLUMNS) {
    if (stock[col] !== undefined) {
      safeStock[col] = stock[col];
    }
  }
  return safeStock;
}

function sanitizePublicTradeRecord(trade: any) {
  if (!trade || typeof trade !== 'object') return trade;
  const safeTrade: Record<string, any> = {
    id: trade.id,
    stock_id: trade.stock_id,
    price: trade.price,
    size: trade.size,
    buyer_is_bot: trade.buyer_is_bot,
    seller_is_bot: trade.seller_is_bot,
    created_at: trade.created_at,
  };
  if (trade.sequence !== undefined) {
    safeTrade.sequence = trade.sequence;
  }
  if (trade.cursor !== undefined) {
    safeTrade.cursor = trade.cursor;
  }
  return safeTrade;
}

// 외부 클라이언트가 직접 호출할 수 없는 내부 정산/유지보수 RPC 목록
const FORBIDDEN_INTERNAL_RPCS = new Set([
  'bulk_settle_trades',
  'update_cash_balance',
  'trim_old_market_data',
]);

export async function POST(request: Request) {
  try {
    await ensureLocalStandaloneReady();

    // 1. 서버 세션 기반 사용자 식별
    const authenticatedUserId = await resolveAuthenticatedUserId();

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

        if (!allowStockOrderRequest(authenticatedUserId)) {
          return NextResponse.json(
            { data: null, error: { message: '주문 요청이 너무 빈번합니다. 잠시 후 다시 시도해주세요.' } },
            { status: 429 }
          );
        }

        const stockId = params?.p_stock_id || params?.stock_id;
        const side = params?.p_side || params?.side;
        const price = Number(params?.p_price ?? params?.price);
        const size = Number(params?.p_size ?? params?.size);

        if (!stockId || typeof stockId !== 'string' || (side !== 'buy' && side !== 'sell') || !Number.isFinite(price) || price <= 0 || !Number.isInteger(size) || size <= 0) {
          return NextResponse.json(
            { data: null, error: { message: '올바르지 않은 주문 파라미터입니다.' } },
            { status: 400 }
          );
        }

        if (memoryDb.optionsContracts.has(stockId)) {
          return NextResponse.json(
            { data: null, error: { message: '옵션 계약은 옵션 전용 주문 API(/api/options/order)를 이용해 주세요.' } },
            { status: 400 }
          );
        }

        if (memoryDb.commodities.has(stockId) || memoryDb.bonds.has(stockId)) {
          return NextResponse.json(
            { data: null, error: { message: '해당 자산군은 일반 주식 주문 경로로 거래할 수 없습니다.' } },
            { status: 400 }
          );
        }
        const targetStock = memoryDb.stocks.get(stockId);
        if (!targetStock) {
          return NextResponse.json(
            { data: null, error: { message: '등록되지 않은 주식/ETF 종목입니다.' } },
            { status: 404 }
          );
        }
        if (targetStock.is_listed === false) {
          return NextResponse.json(
            { data: null, error: { message: '상장 폐지되었거나 거래가 중단된 종목입니다.' } },
            { status: 400 }
          );
        }

        const res = await LocalMarketService.submitOrder({
          userId: authenticatedUserId,
          stockId,
          side,
          price,
          size,
          onPersist: persistConfirmedState,
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

      if (fnName === 'exchange_currency') {
        if (!authenticatedUserId) {
          return NextResponse.json(
            { data: null, error: { message: '로그인이 필요한 서비스입니다.' } },
            { status: 401 }
          );
        }

        const requestedUserId = params?.p_user_id ?? params?.user_id;
        if (requestedUserId !== undefined && requestedUserId !== null && String(requestedUserId) !== authenticatedUserId) {
          return NextResponse.json(
            { data: null, error: { message: '다른 사용자의 계좌로 환전할 수 없습니다.' } },
            { status: 403 }
          );
        }

        const exRes = await executeCurrencyExchange({
          db: memoryDb,
          userId: authenticatedUserId,
          fromCur: params?.p_from_cur ?? params?.from_cur,
          toCur: params?.p_to_cur ?? params?.to_cur,
          amount: Number(params?.p_amount ?? params?.amount),
          onPersist: persistConfirmedState,
        });

        if (!exRes.success) {
          return NextResponse.json(
            { data: null, error: { message: exRes.message } },
            { status: exRes.statusCode }
          );
        }

        return NextResponse.json({ data: exRes.data, error: null });
      }

      if (fnName === 'get_my_recent_trades') {
        if (!authenticatedUserId) {
          return NextResponse.json(
            { data: null, error: { message: '로그인이 필요한 서비스입니다.' } },
            { status: 401 }
          );
        }
        const mockClient = createMemoryDbClient();
        const result = await persistenceManager.withCommitGate(() =>
          mockClient.rpc(fnName, {
            ...params,
            p_user_id: authenticatedUserId,
          })
        );
        return NextResponse.json(result);
      }

      // 기타 허용된 RPC 실행 (체결/호가 스냅샷 조회도 커밋 게이트 직렬화로 미확정 행 노출 차단)
      const mockClient = createMemoryDbClient();
      const result =
        fnName === 'get_authoritative_orderbook'
          ? await persistenceManager.withCommitGate(() => mockClient.rpc(fnName, params))
          : await mockClient.rpc(fnName, params);
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

      const engine = getLocalStandaloneEngine();
      const saved = engine
        ? await engine.resetSimulation(persistConfirmedState)
        : await resetStandaloneMarketAtomically(persistConfirmedState);

      if (!saved) {
        return NextResponse.json(
          { data: null, error: { message: '초기화 스냅샷 저장에 실패했습니다.' } },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, message: 'Market reset successfully' });
    }

    // ── 4. 테이블 쿼리 실행 제어 (action === 'execute') ──
    if (action === 'execute') {
      if (!tableName || typeof tableName !== 'string') {
        return NextResponse.json({ data: null, error: { message: 'tableName이 필요합니다.' } }, { status: 400 });
      }

      const qAction = query?.action || 'select';
      const orGroups: unknown = query?.orFilterGroups;
      if (orGroups !== undefined && (
        !Array.isArray(orGroups) || orGroups.some((group) =>
          typeof group !== 'string' || !group.split(',').every((clause) =>
            /^\s*\w+\.(?:eq|neq|gt|gte|lt|lte|is|like|ilike)\..+$/i.test(clause)
          )
        )
      )) {
        return NextResponse.json({ data: null, error: { message: 'Invalid OR filter.' } }, { status: 400 });
      }
      if (Array.isArray(orGroups) && orGroups.length > 0 && (
        qAction !== 'select' || !PUBLIC_READ_TABLES.has(tableName)
      )) {
        return NextResponse.json({ data: null, error: { message: 'OR filters are unavailable for this query.' } }, { status: 403 });
      }

      // ── [A] 공개 시장 테이블 (SELECT 전용) ──
      if (PUBLIC_READ_TABLES.has(tableName)) {
        if (qAction !== 'select') {
          return NextResponse.json(
            { data: null, error: { message: `공개 시장 테이블(${tableName})은 수정할 수 없습니다.` } },
            { status: 403 }
          );
        }

        let isStockAdmin = false;
        if (tableName === 'stocks') {
          const adminAuth = await verifyAdminSession(request);
          isStockAdmin = adminAuth.isAdmin;
          if (!isStockAdmin && hasDisallowedQueryColumns(query, PUBLIC_STOCK_COLUMNS)) {
            return NextResponse.json(
              { data: null, error: { message: '공개 종목 조회에서는 허용된 공개 컬럼 외의 필터/정렬(target_price 등)을 사용할 수 없습니다.' } },
              { status: 403 }
            );
          }
        }

        if (tableName === 'trades' && hasDisallowedQueryColumns(query, PUBLIC_TRADE_COLUMNS)) {
          return NextResponse.json(
            { data: null, error: { message: '공개 체결 조회에서는 허용된 공개 컬럼(id, stock_id, price, size, buyer_is_bot, seller_is_bot, created_at, sequence) 외의 필터/정렬을 사용할 수 없습니다.' } },
            { status: 403 }
          );
        }

        let hasRumorAccess = false;
        if (NEWS_TABLES.has(tableName)) {
          const viewerProfile = findProfileByAuthId(authenticatedUserId);
          hasRumorAccess = canReadRumor(viewerProfile);
          const allowedNewsColumns = hasRumorAccess
            ? SUBSCRIBER_NEWS_COLUMNS
            : PUBLIC_NEWS_COLUMNS;
          if (hasDisallowedQueryColumns(query, allowedNewsColumns)) {
            return NextResponse.json(
              {
                data: null,
                error: {
                  message: hasRumorAccess
                    ? '뉴스 조회에서는 내부 진실 필드 등 허용되지 않은 컬럼으로 필터/정렬할 수 없습니다.'
                    : '공개 뉴스 조회에서는 허용된 공개 컬럼 외의 필터/정렬(is_fake, 본문 등)을 사용할 수 없습니다.',
                },
              },
              { status: 403 }
            );
          }
        }

        const executeRead = async () => {
          const qb = createMemoryDbClient().from(tableName);
          applyQueryOptions(qb, query);
          if (Array.isArray(orGroups)) for (const group of orGroups) qb.or(group);
          return await qb.execute();
        };
        const result =
          tableName === 'trades'
            ? await persistenceManager.withCommitGate(executeRead)
            : await executeRead();
        if (tableName === 'stocks' && result.data && !isStockAdmin) {
          return NextResponse.json({
            ...result,
            data: Array.isArray(result.data)
              ? result.data.map(sanitizePublicStockRecord)
              : sanitizePublicStockRecord(result.data),
          });
        }
        if (NEWS_TABLES.has(tableName) && result.data) {
          return NextResponse.json({
            ...result,
            data: Array.isArray(result.data)
              ? result.data.map((r: any) => authorizeNewsRecord(r, hasRumorAccess))
              : authorizeNewsRecord(result.data, hasRumorAccess),
          });
        }
        if (tableName === 'trades' && result.data) {
          return NextResponse.json({
            ...result,
            data: Array.isArray(result.data)
              ? result.data.map(sanitizePublicTradeRecord)
              : sanitizePublicTradeRecord(result.data),
          });
        }
        return NextResponse.json(result);
      }

      // ── [A-1] 공개 기관 명칭 디렉터리 (bots_config: 최소 안전 프로젝션 { id, name } 전용) ──
      if (tableName === 'bots_config') {
        if (qAction !== 'select') {
          return NextResponse.json(
            { data: null, error: { message: 'bots_config는 수정할 수 없습니다.' } },
            { status: 403 }
          );
        }
        const ALLOWED_BOT_DIR_COLS = new Set(['id', 'name']);
        if (hasDisallowedQueryColumns(query, ALLOWED_BOT_DIR_COLS)) {
          return NextResponse.json(
            { data: null, error: { message: '공개 기관 디렉터리에서는 id, name 이외의 필터/정렬을 사용할 수 없습니다.' } },
            { status: 403 }
          );
        }
        const qb = createMemoryDbClient().from('bots_config');
        applyQueryOptions(qb, query);
        const result = await qb.execute();
        const projectBotPublic = (row: any) => (row && typeof row === 'object' ? { id: row.id, name: row.name } : row);
        return NextResponse.json({
          ...result,
          data: Array.isArray(result.data) ? result.data.map(projectBotPublic) : projectBotPublic(result.data),
        });
      }

      // ── [A-1b] 관리자 전용 내부 설정/시나리오 테이블 ──
      if (ADMIN_ONLY_READ_TABLES.has(tableName)) {
        const auth = await verifyAdminSession(request);
        if (!auth.isAdmin) {
          return NextResponse.json(
            { data: null, error: { message: `내부 테이블(${tableName}) 조회는 관리자 권한이 필요합니다.` } },
            { status: 403 }
          );
        }
        if (qAction !== 'select') {
          return NextResponse.json(
            { data: null, error: { message: `${tableName}은 직접 수정할 수 없습니다.` } },
            { status: 403 }
          );
        }
        const qb = createMemoryDbClient().from(tableName);
        applyQueryOptions(qb, query);
        const result = await qb.execute();
        return NextResponse.json(result);
      }

      // ── [A-2] 본인 전용 정산 이력 테이블 (SELECT 전용, 세션 user_id 강제) ──
      if (USER_SCOPED_READ_TABLES.has(tableName)) {
        if (!authenticatedUserId) {
          return NextResponse.json(
            { data: null, error: { message: '로그인이 필요한 서비스입니다.' } },
            { status: 401 }
          );
        }
        if (qAction !== 'select') {
          return NextResponse.json(
            { data: null, error: { message: `정산 기록 테이블(${tableName})은 직접 수정할 수 없습니다.` } },
            { status: 403 }
          );
        }

        const safeQuery = { ...query };
        const otherFilters = (safeQuery.filters || []).filter(
          (f: any) => f.col !== 'user_id' && f.col !== 'userId'
        );
        safeQuery.filters = [...otherFilters, { col: 'user_id', op: 'eq', val: authenticatedUserId }];

        const qb = createMemoryDbClient().from(tableName);
        applyQueryOptions(qb, safeQuery);
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
          if (query?.filters !== undefined && !Array.isArray(query.filters)) {
            return NextResponse.json(
              { data: null, error: { message: '올바르지 않은 프로필 조회 필터 형식입니다.' } },
              { status: 400 }
            );
          }
          if (query?.orFilterGroups !== undefined) {
            if (!Array.isArray(query.orFilterGroups) || query.orFilterGroups.some((g: any) => typeof g !== 'string')) {
              return NextResponse.json(
                { data: null, error: { message: '올바르지 않은 OR 조건 형식입니다.' } },
                { status: 400 }
              );
            }
            if (query.orFilterGroups.some((g: any) => g.trim().length > 0)) {
              return NextResponse.json(
                { data: null, error: { message: '프로필 조회에서는 OR 조건 그룹을 지원하지 않습니다.' } },
                { status: 403 }
              );
            }
          }
          if (query?.or !== undefined && query?.or !== null) {
            if (typeof query.or === 'string') {
              if (query.or.trim().length > 0) {
                return NextResponse.json(
                  { data: null, error: { message: '프로필 조회에서는 OR 조건 그룹을 지원하지 않습니다.' } },
                  { status: 403 }
                );
              }
            } else if (Array.isArray(query.or)) {
              if (query.or.length > 0) {
                return NextResponse.json(
                  { data: null, error: { message: '프로필 조회에서는 OR 조건 그룹을 지원하지 않습니다.' } },
                  { status: 403 }
                );
              }
            } else {
              return NextResponse.json(
                { data: null, error: { message: '올바르지 않은 OR 조건 형식입니다.' } },
                { status: 400 }
              );
            }
          }
          if (hasDisallowedQueryColumns({ orderCol: query?.orderCol, orderSpecs: query?.orderSpecs }, PUBLIC_PROFILE_COLUMNS)) {
            return NextResponse.json(
              { data: null, error: { message: '프로필 조회에서는 허용된 공개 컬럼 외의 정렬을 사용할 수 없습니다.' } },
              { status: 403 }
            );
          }
          if (
            query?.limitCount !== undefined &&
            (typeof query.limitCount !== 'number' || !Number.isFinite(query.limitCount) || query.limitCount < 0)
          ) {
            return NextResponse.json(
              { data: null, error: { message: '올바르지 않은 limitCount 값입니다.' } },
              { status: 400 }
            );
          }

          const filters = Array.isArray(query?.filters) ? query.filters : [];
          for (const f of filters) {
            if (!f || typeof f !== 'object' || Array.isArray(f) || typeof f.col !== 'string' || typeof f.op !== 'string') {
              return NextResponse.json(
                { data: null, error: { message: '올바르지 않은 프로필 필터 항목입니다.' } },
                { status: 400 }
              );
            }
            if (!SUPPORTED_PROFILE_FILTER_COLUMNS.has(f.col)) {
              return NextResponse.json(
                { data: null, error: { message: '프로필 조회에서는 id 또는 user_id 필터만 사용할 수 있습니다. 민감한 속성이나 지원되지 않는 컬럼 조회는 허용되지 않습니다.' } },
                { status: 403 }
              );
            }
            if (f.op !== 'eq') {
              return NextResponse.json(
                { data: null, error: { message: '프로필 조회에서는 eq 연산자만 지원됩니다.' } },
                { status: 403 }
              );
            }
            if (
              f.val === null ||
              f.val === undefined ||
              (typeof f.val !== 'string' && typeof f.val !== 'number') ||
              String(f.val).trim().length === 0
            ) {
              return NextResponse.json(
                { data: null, error: { message: '프로필 조회 필터 값이 비어 있거나 올바르지 않습니다.' } },
                { status: 400 }
              );
            }
          }

          // 조회: row PK(id)와 인증 계정 키(user_id) 의미를 명확히 분리하여 교차 fallback 차단
          const idEqFilters = filters.filter((f: any) => f.col === 'id' && f.op === 'eq');
          const userIdEqFilters = filters.filter((f: any) => (f.col === 'user_id' || f.col === 'userId') && f.op === 'eq');

          let profile: ProfileRecord | undefined;
          if (idEqFilters.length > 0 && userIdEqFilters.length > 0) {
            const pks = Array.from(new Set<string>(idEqFilters.map((f: any) => String(f.val))));
            const uids = Array.from(new Set<string>(userIdEqFilters.map((f: any) => String(f.val))));
            if (pks.length === 1 && uids.length === 1) {
              const byPk = memoryDb.profiles.get(pks[0]!);
              const byUid = memoryDb.resolveProfileByUserId(uids[0]!);
              if (
                byPk &&
                byUid &&
                byPk.id === byUid.id &&
                (byPk.user_id === uids[0] || (!byPk.user_id && byPk.id === uids[0]))
              ) {
                profile = byPk;
              }
            }
          } else if (userIdEqFilters.length > 0) {
            const uids = Array.from(new Set<string>(userIdEqFilters.map((f: any) => String(f.val))));
            if (uids.length === 1) {
              profile = memoryDb.resolveProfileByUserId(uids[0]!);
            }
          } else if (idEqFilters.length > 0) {
            const pks = Array.from(new Set<string>(idEqFilters.map((f: any) => String(f.val))));
            // 명시적 profiles.id 필터는 행 기본 키(PK)로만 해석
            if (pks.length === 1) {
              profile = memoryDb.profiles.get(pks[0]!);
            }
          } else {
            // 필터와 OR 그룹이 실제로 전혀 없을 때만 기본 본인 조회로 해석
            if (!authenticatedUserId) {
              return NextResponse.json({ data: null, error: { message: '인증이 필요합니다.' } }, { status: 401 });
            }
            profile = memoryDb.resolveProfileByUserId(authenticatedUserId);
          }

          if (query?.limitCount === 0) {
            profile = undefined;
          }

          if (!profile) {
            return NextResponse.json({
              data: query?.isSingle || query?.isMaybeSingle ? null : [],
              error: query?.isSingle ? { message: 'Row not found (PGRST116)' } : null,
            });
          }

          // 본인이 아닌 경우 민감 자산 정보(cash 등) 보호 및 SELECT 경로 무잠금 상태 변이 금지(복제본 기준 만료 정리)
          const canonicalOwnProfile = authenticatedUserId ? memoryDb.resolveProfileByUserId(authenticatedUserId) : undefined;
          const isOwner = Boolean(canonicalOwnProfile && canonicalOwnProfile.id === profile.id);
          let safeData: Record<string, any>;
          if (isOwner) {
            const ownerProfileCopy = { ...profile };
            pruneExpiredProfileEntitlements(ownerProfileCopy);
            safeData = ownerProfileCopy;
          } else {
            safeData = {
              id: profile.id,
              user_id: profile.user_id,
              username: profile.username,
              nickname: profile.nickname,
              rank_tier: profile.rank_tier,
              created_at: profile.created_at,
            };
          }

          return NextResponse.json({
            data: query?.isSingle || query?.isMaybeSingle ? safeData : [safeData],
            error: null,
          });
        }

        if (qAction === 'update') {
          if (!authenticatedUserId) {
            return NextResponse.json({ data: null, error: { message: '인증이 필요합니다.' } }, { status: 401 });
          }

          // 명시적 허용 목록(username, nickname) 외 모든 필드 수정 원천 차단
          const payload = query?.payloadData;
          if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return NextResponse.json(
              { data: null, error: { message: '올바른 프로필 수정 요청 형식이 아닙니다.' } },
              { status: 400 }
            );
          }

          const keys = Object.keys(payload);
          if (keys.length === 0) {
            return NextResponse.json(
              { data: null, error: { message: '수정할 프로필 필드가 없습니다.' } },
              { status: 400 }
            );
          }

          const hasDisallowed = keys.some((k) => !ALLOWED_PROFILE_UPDATE_FIELDS.has(k));
          if (hasDisallowed) {
            return NextResponse.json(
              { data: null, error: { message: '자산, 권한, 구독 정보 등 허용되지 않은 필드는 직접 수정할 수 없습니다.' } },
              { status: 403 }
            );
          }

          const sanitizedUpdate: Record<string, string> = {};
          for (const key of keys) {
            const val = payload[key];
            if (typeof val !== 'string' || val.trim().length === 0 || val.trim().length > 40) {
              return NextResponse.json(
                { data: null, error: { message: `${key}은(는) 1~40자의 문자열이어야 합니다.` } },
                { status: 400 }
              );
            }
            sanitizedUpdate[key] = val.trim();
          }

          return await withResolvedAccountLocks(() => [memoryDb.resolveAccountLockKey(authenticatedUserId)], async () => {
            return await runWithCommitGate(persistConfirmedState, async () => {
              const existing = memoryDb.resolveProfileByUserId(authenticatedUserId);
              if (!existing) {
                return NextResponse.json({ data: null, error: { message: '프로필을 찾을 수 없습니다.' } }, { status: 404 });
              }

              const updated: ProfileRecord = { ...existing, ...sanitizedUpdate };
              memoryDb.profiles.set(existing.id, updated);
              let saved = false;
              let persistError: unknown = null;
              try {
                saved = await persistConfirmedState();
              } catch (err) {
                persistError = err;
              }
              if (!saved) {
                if (memoryDb.profiles.get(existing.id) === updated) {
                  memoryDb.profiles.set(existing.id, existing);
                }
                memoryDb.addProfileToIndex(existing);
                return NextResponse.json(
                  {
                    data: null,
                    error: {
                      message:
                        persistError instanceof Error && persistError.message
                          ? persistError.message
                          : '프로필 저장에 실패했습니다.',
                    },
                  },
                  { status: 500 }
                );
              }
              return NextResponse.json({ data: updated, error: null });
            });
          });
        }

        return NextResponse.json(
          { data: null, error: { message: '프로필에 대한 해당 작업은 허용되지 않습니다.' } },
          { status: 403 }
        );
      }

      // ── [D] Orders 테이블 ──
      if (tableName === 'orders') {
        if (qAction === 'select') {
          if (!authenticatedUserId) {
            return NextResponse.json({ data: null, error: { message: '인증이 필요합니다.' } }, { status: 401 });
          }

          // 개인 주문 조회는 필터 유무와 관계없이 항상 세션 사용자로 제한
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

          const requestedUidFilter = query?.filters?.find((f: any) => (f.col === 'user_id' || f.col === 'userId') && f.op === 'eq')?.val;
          if (requestedUidFilter !== undefined && String(requestedUidFilter) !== authenticatedUserId) {
            return NextResponse.json(
              { data: null, error: { message: '다른 사용자의 주문은 취소할 수 없습니다.' } },
              { status: 403 }
            );
          }

          const inOrderIds = query?.filters?.find((f: any) => f.col === 'id' && f.op === 'in')?.val;
          if (Array.isArray(inOrderIds)) {
            const batchRes = await LocalMarketService.cancelOrdersBatch({
              orderIds: inOrderIds.map((v: any) => String(v)),
              userId: authenticatedUserId,
              onPersist: persistConfirmedState,
            });
            if (!batchRes.success) {
              return NextResponse.json(
                { data: null, error: { message: batchRes.message } },
                { status: batchRes.statusCode }
              );
            }
            return NextResponse.json({ data: batchRes.orders, error: null });
          }

          const targetOrderId = query?.filters?.find((f: any) => f.col === 'id' && f.op === 'eq')?.val;
          if (!targetOrderId) {
            return NextResponse.json({ data: null, error: { message: '주문 ID가 필요합니다.' } }, { status: 400 });
          }

          const cancelRes = await LocalMarketService.cancelOrder({
            orderId: String(targetOrderId),
            userId: authenticatedUserId,
            onPersist: persistConfirmedState,
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
