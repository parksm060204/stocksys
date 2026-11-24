/**
 * scripts/test-loop1-p1-p2-fixes.tsx
 *
 * 반복 디버깅 1차 P1·P2 결함 6건(P1-01, P1-02, P1-03, P2-01, P2-02, P2-03) 회귀 검증 스위트.
 * - 격리된 임시 STOCKSYS_DATA_DIR 및 JSDOM 환경만 사용합니다.
 * - 운영 .data/ 또는 실제 계정·설정을 변경하지 않습니다.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-loop1-'));
const tmpDataDir = path.join(tmpRoot, 'data');
fs.mkdirSync(tmpDataDir, { recursive: true });
process.env.STOCKSYS_DATA_DIR = tmpDataDir;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:3000',
  pretendToBeVisual: true,
});

Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true, writable: true });
Object.defineProperty(globalThis, 'self', { value: dom.window, configurable: true, writable: true });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true, writable: true });
Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, configurable: true, writable: true });
Object.defineProperty(globalThis, 'HTMLButtonElement', { value: dom.window.HTMLButtonElement, configurable: true, writable: true });
Object.defineProperty(globalThis, 'HTMLInputElement', { value: dom.window.HTMLInputElement, configurable: true, writable: true });
Object.defineProperty(globalThis, 'Node', { value: dom.window.Node, configurable: true, writable: true });
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true, writable: true });
if (!('IntersectionObserver' in globalThis)) {
  (globalThis as any).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!('ResizeObserver' in globalThis)) {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
(dom.window.document as any).oninput = null;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import type { createRoot as CreateRootFn } from 'react-dom/client';
import { SessionContext } from 'next-auth/react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext, SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';

let createRoot: typeof CreateRootFn;

let GUEST_USER_ID: typeof import('../lib/memoryDb/memoryStore').GUEST_USER_ID;
let MemoryDatabase: typeof import('../lib/memoryDb/memoryStore').MemoryDatabase;
let memoryDb: typeof import('../lib/memoryDb/memoryStore').memoryDb;
let createMemoryDbClient: typeof import('../lib/memoryDb/memoryDbClient').createMemoryDbClient;
let ensureLocalStandaloneReady: typeof import('../lib/engine/localStandaloneServer').ensureLocalStandaloneReady;
let getLocalStandaloneEngine: typeof import('../lib/engine/localStandaloneServer').getLocalStandaloneEngine;
let stopLocalStandaloneEngine: typeof import('../lib/engine/localStandaloneServer').stopLocalStandaloneEngine;
let LocalMarketService: typeof import('../lib/engine/marketService').LocalMarketService;
let submitAndMatchOrder: typeof import('../lib/engine/dbMatching').submitAndMatchOrder;
let calculateUserReservedCashKrw: typeof import('../lib/engine/orderRisk').calculateUserReservedCashKrw;
let sweepUnencumberedCashToMarginDebt: typeof import('../lib/engine/orderRisk').sweepUnencumberedCashToMarginDebt;
let applyCashDeltaWithMarginDebt: typeof import('../lib/commodities/commodityLedger').applyCashDeltaWithMarginDebt;
let reserveMarginAndSubmitCommodityOrder: typeof import('../lib/commodities/commodityLedger').reserveMarginAndSubmitCommodityOrder;
let settleCommodityTradeForUsers: typeof import('../lib/commodities/commodityLedger').settleCommodityTradeForUsers;
let COMMODITY_DEFINITIONS: typeof import('../lib/commodities/definitions').COMMODITY_DEFINITIONS;
let localDbPost: typeof import('../app/api/local-db/route').POST;
let ordersPost: typeof import('../app/api/orders/route').POST;
let ordersDelete: typeof import('../app/api/orders/route').DELETE;
let adminScenariosPost: typeof import('../app/api/admin/scenarios/route').POST;
let setBrowserClient: typeof import('../lib/db/client').setBrowserClient;
let OptionsPanel: typeof import('../app/components/OptionsPanel').default;
let TopBar: typeof import('../app/components/TopBar').default;
let StocksPage: typeof import('../app/stocks/page').default;
let V2StocksPage: typeof import('../app/v2/stocks/page').default;
let DashboardGate: typeof import('../app/components/DashboardGate').default;
let ToastProvider: typeof import('../app/components/ToastProvider').ToastProvider;

async function loadModules() {
  ({ createRoot } = await import('react-dom/client'));
  ({ GUEST_USER_ID, MemoryDatabase, memoryDb } = await import('../lib/memoryDb/memoryStore'));
  ({ createMemoryDbClient } = await import('../lib/memoryDb/memoryDbClient'));
  ({
    ensureLocalStandaloneReady,
    getLocalStandaloneEngine,
    stopLocalStandaloneEngine,
  } = await import('../lib/engine/localStandaloneServer'));
  ({ LocalMarketService } = await import('../lib/engine/marketService'));
  ({ submitAndMatchOrder } = await import('../lib/engine/dbMatching'));
  ({ calculateUserReservedCashKrw, sweepUnencumberedCashToMarginDebt } = await import('../lib/engine/orderRisk'));
  ({
    applyCashDeltaWithMarginDebt,
    reserveMarginAndSubmitCommodityOrder,
    settleCommodityTradeForUsers,
  } = await import('../lib/commodities/commodityLedger'));
  ({ COMMODITY_DEFINITIONS } = await import('../lib/commodities/definitions'));
  ({ POST: localDbPost } = await import('../app/api/local-db/route'));
  ({ POST: ordersPost, DELETE: ordersDelete } = await import('../app/api/orders/route'));
  ({ POST: adminScenariosPost } = await import('../app/api/admin/scenarios/route'));
  ({ setBrowserClient } = await import('../lib/db/client'));
  OptionsPanel = (await import('../app/components/OptionsPanel')).default;
  TopBar = (await import('../app/components/TopBar')).default;
  StocksPage = (await import('../app/stocks/page')).default;
  V2StocksPage = (await import('../app/v2/stocks/page')).default;
  DashboardGate = (await import('../app/components/DashboardGate')).default;
  ({ ToastProvider } = await import('../app/components/ToastProvider'));
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeMockRouter() {
  return {
    back: () => {},
    forward: () => {},
    refresh: () => {},
    push: () => {},
    prefetch: async () => {},
    replace: () => {},
  };
}

async function flushUi(ms: number = 30) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function renderWithProviders(
  root: ReturnType<typeof createRoot>,
  ui: React.ReactNode,
  sessionVal: { status: 'authenticated' | 'unauthenticated'; data: any }
) {
  return act(async () => {
    root.render(
      <SearchParamsContext.Provider value={new URLSearchParams()}>
        <PathnameContext.Provider value="/">
          <AppRouterContext.Provider value={makeMockRouter() as any}>
            <SessionContext.Provider
              value={{
                ...sessionVal,
                update: async () => sessionVal.data,
              } as any}
            >
              <ToastProvider>{ui}</ToastProvider>
            </SessionContext.Provider>
          </AppRouterContext.Provider>
        </PathnameContext.Provider>
      </SearchParamsContext.Provider>
    );
  });
}

async function testP1_01_CommodityLegacyProfileSettlement(): Promise<void> {
  console.log('▶ [P1-01] 레거시 프로필(id !== user_id) 원자재 양측 신규/청산 및 증거금·손익 정산 검증');

  const db = new MemoryDatabase();
  const oil = COMMODITY_DEFINITIONS.find((c) => c.id === 'CRUDE_OIL')!;
  assert.ok(oil, 'CRUDE_OIL commodity definition must exist');

  const buyerAuthId = 'auth_comm_buyer_1';
  const buyerLegacyPk = 'legacy_comm_buyer_pk';
  const sellerAuthId = 'auth_comm_seller_1';
  const sellerLegacyPk = 'legacy_comm_seller_pk';

  db.profiles.set(buyerLegacyPk, {
    id: buyerLegacyPk,
    user_id: buyerAuthId,
    username: '레거시매수',
    nickname: '레거시매수',
    cash: 20_000_000,
    net_worth: 20_000_000,
    rank_tier: 'Gold',
    created_at: db.getIsoTimestamp(),
  });
  db.profiles.set(sellerLegacyPk, {
    id: sellerLegacyPk,
    user_id: sellerAuthId,
    username: '레거시매도',
    nickname: '레거시매도',
    cash: 20_000_000,
    net_worth: 20_000_000,
    rank_tier: 'Gold',
    created_at: db.getIsoTimestamp(),
  });
  // 의도적 PK 충돌 프로필 배치 (authId와 동일한 id, 다른 user_id)
  db.profiles.set(buyerAuthId, {
    id: buyerAuthId,
    user_id: 'other_buyer_colliding',
    username: '충돌타인1',
    nickname: '충돌타인1',
    cash: 111,
    net_worth: 111,
    rank_tier: 'Bronze',
    created_at: db.getIsoTimestamp(),
  });
  db.profiles.set(sellerAuthId, {
    id: sellerAuthId,
    user_id: 'other_seller_colliding',
    username: '충돌타인2',
    nickname: '충돌타인2',
    cash: 222,
    net_worth: 222,
    rank_tier: 'Bronze',
    created_at: db.getIsoTimestamp(),
  });
  db.rebuildIndexes();

  let orderSeq = 0;
  const openBuyRes = await reserveMarginAndSubmitCommodityOrder({
    db,
    commodity: oil,
    userId: buyerAuthId,
    side: 'buy',
    type: 'limit',
    price: 70,
    size: 1,
    submitToEngine: () => ({
      id: `cmd_ord_${++orderSeq}`,
      commodityId: oil.id,
      userId: buyerAuthId,
      side: 'buy',
      type: 'limit',
      price: 70,
      size: 1,
      filled: 0,
      createdAtTick: 1,
      createdAtTime: 1000,
    }),
    rollbackFromEngine: () => {},
  });
  const openSellRes = await reserveMarginAndSubmitCommodityOrder({
    db,
    commodity: oil,
    userId: sellerAuthId,
    side: 'sell',
    type: 'limit',
    price: 70,
    size: 1,
    submitToEngine: () => ({
      id: `cmd_ord_${++orderSeq}`,
      commodityId: oil.id,
      userId: sellerAuthId,
      side: 'sell',
      type: 'limit',
      price: 70,
      size: 1,
      filled: 0,
      createdAtTick: 1,
      createdAtTime: 1001,
    }),
    rollbackFromEngine: () => {},
  });
  assert.equal(openBuyRes.success, true, openBuyRes.message);
  assert.equal(openSellRes.success, true, openSellRes.message);

  // 1. 양측 신규 진입 체결 정산 (조기 종료 금지)
  await settleCommodityTradeForUsers(
    db,
    {
      id: 'cmd_tr_open_1',
      commodityId: oil.id,
      buyOrderId: openBuyRes.order!.id,
      sellOrderId: openSellRes.order!.id,
      buyerId: buyerAuthId,
      sellerId: sellerAuthId,
      price: 70,
      size: 1,
      tick: 1,
      timestamp: 1002,
    },
    oil
  );

  assert.equal(db.isCommodityTradeSettled('cmd_tr_open_1'), true, 'Opening trade must be marked settled');
  assert.equal(db.commodityMarginReservations.get(openBuyRes.order!.id)?.status, 'filled');
  assert.equal(db.commodityMarginReservations.get(openSellRes.order!.id)?.status, 'filled');
  const buyerPos = db.commodityPositions.get(`${buyerAuthId}_${oil.id}`);
  const sellerPos = db.commodityPositions.get(`${sellerAuthId}_${oil.id}`);
  assert.equal(buyerPos?.side, 'long');
  assert.equal(buyerPos?.quantity, 1);
  assert.equal(sellerPos?.side, 'short');
  assert.equal(sellerPos?.quantity, 1);

  // 2. 양측 청산 체결 정산 (가격 75로 상승 -> 매수자 익절, 매도자 손절)
  const closeSellRes = await reserveMarginAndSubmitCommodityOrder({
    db,
    commodity: oil,
    userId: buyerAuthId,
    side: 'sell',
    type: 'limit',
    price: 75,
    size: 1,
    submitToEngine: () => ({
      id: `cmd_ord_${++orderSeq}`,
      commodityId: oil.id,
      userId: buyerAuthId,
      side: 'sell',
      type: 'limit',
      price: 75,
      size: 1,
      filled: 0,
      createdAtTick: 2,
      createdAtTime: 2000,
    }),
    rollbackFromEngine: () => {},
  });
  const closeBuyRes = await reserveMarginAndSubmitCommodityOrder({
    db,
    commodity: oil,
    userId: sellerAuthId,
    side: 'buy',
    type: 'limit',
    price: 75,
    size: 1,
    submitToEngine: () => ({
      id: `cmd_ord_${++orderSeq}`,
      commodityId: oil.id,
      userId: sellerAuthId,
      side: 'buy',
      type: 'limit',
      price: 75,
      size: 1,
      filled: 0,
      createdAtTick: 2,
      createdAtTime: 2001,
    }),
    rollbackFromEngine: () => {},
  });
  assert.equal(closeSellRes.success, true, closeSellRes.message);
  assert.equal(closeBuyRes.success, true, closeBuyRes.message);
  assert.equal(closeSellRes.reservation?.reserved_krw, 0, 'Closing sell must waive new entry margin');
  assert.equal(closeBuyRes.reservation?.reserved_krw, 0, 'Closing buy must waive new entry margin');

  await settleCommodityTradeForUsers(
    db,
    {
      id: 'cmd_tr_close_2',
      commodityId: oil.id,
      buyOrderId: closeBuyRes.order!.id,
      sellOrderId: closeSellRes.order!.id,
      buyerId: sellerAuthId,
      sellerId: buyerAuthId,
      price: 75,
      size: 1,
      tick: 2,
      timestamp: 2002,
    },
    oil
  );

  assert.equal(db.commodityPositions.get(`${buyerAuthId}_${oil.id}`)?.side, 'flat');
  assert.equal(db.commodityPositions.get(`${sellerAuthId}_${oil.id}`)?.side, 'flat');
  assert.ok(db.profiles.get(buyerLegacyPk)!.cash > 20_000_000, 'Long closer must realize profit into legacy profile');
  assert.ok(db.profiles.get(sellerLegacyPk)!.cash < 20_000_000, 'Short closer must realize loss on legacy profile');
  assert.equal(db.profiles.get(buyerAuthId)!.cash, 111, 'Colliding profile 1 must remain untouched');
  assert.equal(db.profiles.get(sellerAuthId)!.cash, 222, 'Colliding profile 2 must remain untouched');

  console.log('  ✓ P1-01 통과');
}

async function testP1_02_MemoryDbClientPkVsUserIdAndSsrQueries(): Promise<void> {
  console.log('▶ [P1-02] MemoryDbClient PK/user_id 분리, SSR user_id 식별 및 교차계정 경계 검증');

  const db = new MemoryDatabase();
  const legacyPk = 'legacy_ssr_pk_01';
  const authUid1 = 'auth_ssr_user_1';
  const authUid2 = 'auth_ssr_user_2';

  db.profiles.set(legacyPk, {
    id: legacyPk,
    user_id: authUid1,
    username: '레거시1',
    nickname: '레거시1',
    cash: 77_000_000,
    net_worth: 77_000_000,
    rank_tier: 'Platinum',
    is_admin: true,
    created_at: db.getIsoTimestamp(),
  });
  db.profiles.set(authUid1, {
    id: authUid1,
    user_id: authUid2,
    username: '충돌유저2',
    nickname: '충돌유저2',
    cash: 999,
    net_worth: 999,
    rank_tier: 'Bronze',
    is_admin: false,
    created_at: db.getIsoTimestamp(),
  });
  db.rebuildIndexes();

  const client = createMemoryDbClient(db);

  // 1. user_id 조회는 정확히 authUid1 소유의 legacyPk 행을 반환해야 함
  const byUserRes = await client
    .from('profiles')
    .select('id, user_id, cash, is_admin')
    .eq('user_id', authUid1)
    .maybeSingle();
  assert.equal(byUserRes.error, null);
  assert.equal(byUserRes.data?.id, legacyPk);
  assert.equal(byUserRes.data?.cash, 77_000_000);
  assert.equal(byUserRes.data?.is_admin, true);

  // 2. PK(id) 조회는 primary key 일치 행만 반환 (user_id fallback과 충돌 금지)
  const byPkRes = await client
    .from('profiles')
    .select('id, user_id, cash')
    .eq('id', authUid1)
    .maybeSingle();
  assert.equal(byPkRes.data?.id, authUid1);
  assert.equal(byPkRes.data?.user_id, authUid2);
  assert.equal(byPkRes.data?.cash, 999);

  // 3. 존재하지 않는 PK 조회 시 user_id로 fallback 되어 필터와 모순되지 않고 null 반환
  db.profiles.set('legacy_only_pk', {
    id: 'legacy_only_pk',
    user_id: 'auth_only_uid',
    username: '단독레거시',
    nickname: '단독레거시',
    cash: 55_000,
    net_worth: 55_000,
    rank_tier: 'Bronze',
    created_at: db.getIsoTimestamp(),
  });
  db.rebuildIndexes();
  const missingPkRes = await client
    .from('profiles')
    .select('*')
    .eq('id', 'auth_only_uid')
    .maybeSingle();
  assert.equal(missingPkRes.data, null, 'eq("id", auth_only_uid) must not return row whose PK is legacy_only_pk');

  const foundByUserIdRes = await client
    .from('profiles')
    .select('*')
    .eq('user_id', 'auth_only_uid')
    .single();
  assert.equal(foundByUserIdRes.error, null);
  assert.equal(foundByUserIdRes.data?.id, 'legacy_only_pk');
  assert.equal(foundByUserIdRes.data?.cash, 55_000);

  // 4. Minimal legacy fixture without user_id field still works with eq('user_id', id)
  db.profiles.set('minimal_uid', {
    id: 'minimal_uid',
    username: 'minimal',
    nickname: 'minimal',
    cash: 12_345,
    net_worth: 12_345,
    rank_tier: 'Bronze',
    created_at: db.getIsoTimestamp(),
  } as any);
  const minimalRes = await client.from('profiles').select('cash').eq('user_id', 'minimal_uid').maybeSingle();
  assert.equal(minimalRes.data?.cash, 12_345);

  // 5. SSR 코드(mypage, stocks/[id], v2/stocks/[id])가 user_id 컬럼으로 조회하는지 검증
  const mypageSrc = fs.readFileSync(path.join(process.cwd(), 'app/mypage/page.tsx'), 'utf8');
  const stockDetailSrc = fs.readFileSync(path.join(process.cwd(), 'app/stocks/[id]/page.tsx'), 'utf8');
  const stockDetailV2Src = fs.readFileSync(path.join(process.cwd(), 'app/v2/stocks/[id]/page.tsx'), 'utf8');
  assert.equal(mypageSrc.includes('.eq("user_id", userId)'), true, 'MyPage SSR must query profiles by user_id');
  assert.equal(stockDetailSrc.includes(".eq('user_id', viewerId)"), true, 'StockDetail SSR must query profiles by user_id');
  assert.equal(stockDetailV2Src.includes('.eq("user_id", viewerId)'), true, 'StockDetailV2 SSR must query profiles by user_id');

  console.log('  ✓ P1-02 통과');
}

async function testP1_03_ReservedCashAuthUserKeyProtection(): Promise<void> {
  console.log('▶ [P1-03] 레거시 프로필 마진 스윕 및 원자재 손실 시 미체결 매수 예약금 보호 검증');

  const db = new MemoryDatabase();
  const stock = Array.from(db.stocks.values()).find((s) => s.market === 'domestic')!;
  const legacyPk = 'legacy_risk_pk';
  const authUid = 'auth_risk_user';
  const otherAuthUid = 'auth_risk_other';

  const legacyProfile: {
    id: string;
    user_id: string;
    username: string;
    nickname: string;
    cash: number;
    net_worth: number;
    rank_tier: string;
    margin_debt_krw?: number;
    created_at: string;
  } = {
    id: legacyPk,
    user_id: authUid,
    username: '리스크유저',
    nickname: '리스크유저',
    cash: 1_000_000,
    net_worth: 1_000_000,
    rank_tier: 'Silver',
    margin_debt_krw: 200_000,
    created_at: db.getIsoTimestamp(),
  };
  db.profiles.set(legacyPk, legacyProfile);
  // PK 충돌 타계정
  db.profiles.set(authUid, {
    id: authUid,
    user_id: otherAuthUid,
    username: '충돌유저',
    nickname: '충돌유저',
    cash: 100,
    net_worth: 100,
    rank_tier: 'Bronze',
    created_at: db.getIsoTimestamp(),
  });
  db.rebuildIndexes();

  // 미체결 주식 매수 주문 등록 (authUid 기준 orderUserIndex에 등록됨)
  // 가격 80,000 * 10주 = 800,000 + 0.25% 수수료(2,000) = 802,000원 예약
  const openBuyOrder = {
    id: 'ord_res_protect_1',
    stock_id: stock.id,
    user_id: authUid,
    side: 'buy' as const,
    price: 80_000,
    size: 10,
    filled: 0,
    status: 'open' as const,
    is_lp: false,
    created_at: db.getIsoTimestamp(),
  };
  db.orders.set(openBuyOrder.id, openBuyOrder);
  db.addOrderToIndex(openBuyOrder);

  const reserved = calculateUserReservedCashKrw(db, authUid);
  assert.equal(reserved, 802_000);

  // 1. sweepUnencumberedCashToMarginDebt: 미예약 현금 198,000원만 상환, 예약금 802,000원 침범 금지
  const swept = sweepUnencumberedCashToMarginDebt(db, legacyProfile);
  assert.equal(swept, 198_000);
  assert.equal(legacyProfile.cash, 802_000, 'Sweep must preserve open buy reserved cash');
  assert.equal(legacyProfile.margin_debt_krw, 2_000, 'Remaining unpaid debt must stay recorded');

  // 2. applyCashDeltaWithMarginDebt (원자재 손실): 미예약 현금 초과 손실 시 예약금 침범 금지 + 부채 기록
  delete legacyProfile.margin_debt_krw;
  legacyProfile.cash = 1_000_000;
  applyCashDeltaWithMarginDebt(db, legacyProfile, -500_000);
  assert.equal(legacyProfile.cash, 802_000, 'Commodity loss must not invade stock/option open buy reserved cash');
  assert.equal(legacyProfile.margin_debt_krw, 302_000, 'Shortfall beyond unencumbered cash must become margin debt');

  console.log('  ✓ P1-03 통과');
}

async function testP2_01_OptionsPanelAccountBinding(): Promise<void> {
  console.log('▶ [P2-01] OptionsPanel 계정 바인딩·로그아웃 초기화·지연 구계정 응답 무시 검증');

  const originalFetch = globalThis.fetch;
  const originalDisableGuest = process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  setBrowserClient(null);
  process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'true';

  let currentUser = 'opt_user_A';
  let deferredA: ReturnType<typeof createDeferred<Response>> | null = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === '/api/local-db' && init?.body) {
      const parsed = JSON.parse(String(init.body));
      if (parsed.tableName === 'profiles') {
        if (currentUser === 'opt_user_A' && deferredA) {
          return await deferredA.promise;
        }
        return new Response(
          JSON.stringify({
            data:
              currentUser === 'opt_user_A'
                ? { is_admin: false, has_options_license: true }
                : { is_admin: false, has_options_license: false },
            error: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (parsed.tableName === 'stocks') {
        return new Response(
          JSON.stringify({ data: { current_price: 72000, ticker: '0010', name: '오성전자' }, error: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (parsed.tableName === 'options_contracts') {
        return new Response(JSON.stringify({ data: [], error: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
  }) as typeof fetch;

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  try {
    // 1. User A (자격증 보유) -> 잠금 해제 화면 표시
    await renderWithProviders(root, <OptionsPanel stockId="00000000-0000-4000-8000-000000000101" ticker="0010" />, {
      status: 'authenticated',
      data: { user: { id: 'opt_user_A', name: 'A', email: 'a@test.local' } },
    });
    await flushUi(40);
    assert.equal(container.textContent?.includes('파생상품 시장 접근 권한 없음'), false, 'User A with license must unlock OptionsPanel');
    assert.equal(container.textContent?.includes('D-DAY 옵션 만기일 비상 결제령'), true);

    // 2. 로그아웃 -> 즉시 잠금 초기화
    await renderWithProviders(root, <OptionsPanel stockId="00000000-0000-4000-8000-000000000101" ticker="0010" />, {
      status: 'unauthenticated',
      data: null,
    });
    await flushUi(30);
    assert.equal(container.textContent?.includes('파생상품 시장 접근 권한 없음'), true, 'Logout must reset OptionsPanel license state');

    // 3. User A 지연 요청 중 User B(미보유)로 전환 후 User A 응답 뒤늦게 도착 -> 무시 검증
    deferredA = createDeferred<Response>();
    currentUser = 'opt_user_A';
    await renderWithProviders(root, <OptionsPanel stockId="00000000-0000-4000-8000-000000000101" ticker="0010" />, {
      status: 'authenticated',
      data: { user: { id: 'opt_user_A', name: 'A', email: 'a@test.local' } },
    });
    await flushUi(15);

    currentUser = 'opt_user_B';
    await renderWithProviders(root, <OptionsPanel stockId="00000000-0000-4000-8000-000000000101" ticker="0010" />, {
      status: 'authenticated',
      data: { user: { id: 'opt_user_B', name: 'B', email: 'b@test.local' } },
    });
    await flushUi(30);
    assert.equal(container.textContent?.includes('파생상품 시장 접근 권한 없음'), true, 'User B without license must see locked panel');

    deferredA.resolve(
      new Response(JSON.stringify({ data: { is_admin: true, has_options_license: true }, error: null }), { status: 200 })
    );
    await flushUi(30);
    assert.equal(container.textContent?.includes('파생상품 시장 접근 권한 없음'), true, 'Stale User A response must NOT unlock User B OptionsPanel');
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
    globalThis.fetch = originalFetch;
    setBrowserClient(null);
    if (originalDisableGuest === undefined) delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
    else process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = originalDisableGuest;
  }

  console.log('  ✓ P2-01 통과');
}

async function testP2_02_DelistedExclusionListOrderAndAdminMarkets(): Promise<void> {
  console.log('▶ [P2-02] is_listed=false 종목 목록/신규주문 제외, 취소/레거시 보존, list_stock 시장 검증');

  memoryDb.resetToSeedData({ suppressPublish: true });
  const prevDisableGuest = process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  const prevAllowDevAdmin = process.env.ALLOW_DEV_ADMIN;
  delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  process.env.ALLOW_DEV_ADMIN = 'true';

  const delistedStock = Array.from(memoryDb.stocks.values()).find((s) => s.ticker === '0020')!;
  const legacyUndefinedStock = Array.from(memoryDb.stocks.values()).find((s) => s.ticker === '0025')!;
  const listedStock = Array.from(memoryDb.stocks.values()).find((s) => s.ticker === '0010')!;

  const guestProfile = memoryDb.ensureUserProfile(GUEST_USER_ID, { cash: 100_000_000 });
  guestProfile.cash = 100_000_000;

  // 기존 미체결 주문 1건을 상장폐지 전 등록해 취소 가능 여부 검증
  const preDelistOrderRes = await LocalMarketService.submitOrder({
    userId: GUEST_USER_ID,
    stockId: delistedStock.id,
    side: 'buy',
    price: 100,
    size: 1,
    onPersist: async () => true,
  });
  assert.equal(preDelistOrderRes.success, true, preDelistOrderRes.message);

  // 명시적 상장폐지 + 레거시 undefined 상태 설정
  delistedStock.is_listed = false;
  delete legacyUndefinedStock.is_listed;
  listedStock.is_listed = true;

  try {
    // 1. 신규 주문 차단 (POST /api/orders, submitAndMatchOrder, /api/local-db submit_and_match_order)
    const apiOrderRes = await ordersPost(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_id: delistedStock.id, side: 'buy', price: 1000, size: 1 }),
      })
    );
    assert.equal(apiOrderRes.status, 400, 'POST /api/orders must reject is_listed=false stock');

    const dbMatchRes = await submitAndMatchOrder(createMemoryDbClient(memoryDb), {
      stock_id: delistedStock.id,
      user_id: GUEST_USER_ID,
      side: 'buy',
      price: 1000,
      size: 1,
    });
    assert.equal(dbMatchRes.success, false, 'submitAndMatchOrder must reject is_listed=false stock');

    const rpcOrderRes = await localDbPost(
      new Request('http://localhost:3000/api/local-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'rpc',
          fnName: 'submit_and_match_order',
          params: { p_stock_id: delistedStock.id, p_side: 'buy', p_price: 1000, p_size: 1 },
        }),
      })
    );
    const rpcOrderJson = await rpcOrderRes.json();
    assert.equal(rpcOrderRes.status, 400, 'RPC submit_and_match_order must reject is_listed=false stock');
    assert.equal(rpcOrderJson.data, null);

    // 2. 레거시 is_listed === undefined 종목은 신규 주문 허용
    const legacyApiRes = await ordersPost(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_id: legacyUndefinedStock.id, side: 'buy', price: 100, size: 1 }),
      })
    );
    assert.equal(legacyApiRes.status, 200, 'Legacy is_listed=undefined stock must still allow new orders');

    // 3. 상장폐지 이전 미체결 주문 취소는 계속 허용되어야 함
    const cancelRes = await ordersDelete(
      new Request(`http://localhost:3000/api/orders?order_id=${encodeURIComponent(preDelistOrderRes.orderId!)}`, {
        method: 'DELETE',
      })
    );
    assert.equal(cancelRes.status, 200, 'Cancelling existing open order on delisted stock must succeed');

    // 4. 공개 가용 종목 목록 UI 진입점 (StocksPage, V2StocksPage, TopBar, DashboardGate)에서
    //    is_listed=false(에코에너지) 제외, is_listed=undefined(NVC) & is_listed=true(오성전자) 유지 검증
    const origFetch = globalThis.fetch;
    setBrowserClient(null);
    const testClient = createMemoryDbClient(memoryDb);
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === '/api/local-db' && init?.body) {
        const parsed = JSON.parse(String(init.body));
        if (parsed.tableName === 'profiles') {
          return new Response(
            JSON.stringify({ data: { is_admin: true, unlocked_features: ['custom_dashboard'], cash: 1000000 }, error: null }),
            { status: 200 }
          );
        }
        if (parsed.tableName === 'market_news') {
          return new Response(JSON.stringify({ data: [], error: null }), { status: 200 });
        }
        if (parsed.tableName === 'stocks') {
          const qb = testClient.from('stocks');
          for (const f of parsed.query?.filters || []) {
            if (f.op === 'neq') qb.neq(f.col, f.val);
            if (f.op === 'eq') qb.eq(f.col, f.val);
          }
          if (parsed.query?.orderCol) qb.order(parsed.query.orderCol, { ascending: parsed.query.orderAsc ?? true });
          const r = await qb.execute();
          return new Response(JSON.stringify(r), { status: 200 });
        }
      }
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }) as typeof fetch;

    const container = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(container);
    const root = createRoot(container);
    try {
      await renderWithProviders(root, <StocksPage />, {
        status: 'authenticated',
        data: { user: { id: GUEST_USER_ID, name: 'U', email: 'u@test.local' } },
      });
      await flushUi(40);
      assert.equal(container.textContent?.includes('에코에너지'), false, 'StocksPage must exclude is_listed=false');
      assert.equal(container.textContent?.includes('NVC'), true, 'StocksPage must preserve legacy undefined');
      assert.equal(container.textContent?.includes('오성전자'), true, 'StocksPage must show listed stock');

      await renderWithProviders(root, <V2StocksPage />, {
        status: 'authenticated',
        data: { user: { id: GUEST_USER_ID, name: 'U', email: 'u@test.local' } },
      });
      await flushUi(40);
      assert.equal(container.textContent?.includes('에코에너지'), false, 'V2StocksPage must exclude is_listed=false');
      assert.equal(container.textContent?.includes('NVC'), true, 'V2StocksPage must preserve legacy undefined');

      await renderWithProviders(root, <DashboardGate><div>INTRO</div></DashboardGate>, {
        status: 'authenticated',
        data: { user: { id: GUEST_USER_ID, name: 'U', email: 'u@test.local' } },
      });
      await flushUi(40);
      assert.equal(container.textContent?.includes('에코에너지'), false, 'DashboardGate must exclude is_listed=false');
      assert.equal(container.textContent?.includes('오성전자'), true);

      // TopBar 검색 목록에서도 is_listed=false 제외, undefined & true 유지 검증
      await renderWithProviders(root, <TopBar />, {
        status: 'authenticated',
        data: { user: { id: GUEST_USER_ID, name: 'U', email: 'u@test.local' } },
      });
      await flushUi(40);
      const searchInput = container.querySelector('input')!;
      await act(async () => {
        searchInput.dispatchEvent(new dom.window.FocusEvent('focusin', { bubbles: true }));
        searchInput.focus();
      });
      const nativeSet = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!;
      await act(async () => {
        nativeSet.call(searchInput, '0020');
        searchInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
      await flushUi(20);
      assert.equal(container.textContent?.includes('에코에너지'), false, 'TopBar search must exclude is_listed=false');
      await act(async () => {
        nativeSet.call(searchInput, 'NVC');
        searchInput.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
      await flushUi(20);
      assert.equal(container.textContent?.includes('NVC'), true, 'TopBar search must preserve legacy undefined stock');
    } finally {
      await act(async () => { root.unmount(); });
      container.remove();
      globalThis.fetch = origFetch;
      setBrowserClient(null);
    }

    // 5. 관리자 list_stock 시장 값 검증
    const badMarkets = ['bonds', 'commodities', 'options', 'crypto', '', 123];
    for (const badMarket of badMarkets) {
      const badRes = await adminScenariosPost(
        new Request('http://localhost:3000/api/admin/scenarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'list_stock',
            ticker: `BAD_${String(badMarket).toUpperCase() || 'EMPTY'}`,
            name: '불량시장종목',
            market: badMarket,
            sector: '기타',
            initialPrice: 10000,
          }),
        })
      );
      assert.equal(badRes.status, 400, `Unsupported market ${String(badMarket)} must return 400`);
    }

    const okRes = await adminScenariosPost(
      new Request('http://localhost:3000/api/admin/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'list_stock',
          ticker: 'EU_NEW_01',
          name: '유럽신규주',
          market: 'europe',
          sector: '반도체',
          initialPrice: 150,
        }),
      })
    );
    assert.equal(okRes.status, 200, 'Supported market "europe" must succeed');
  } finally {
    if (prevDisableGuest === undefined) delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
    else process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = prevDisableGuest;
    if (prevAllowDevAdmin === undefined) delete process.env.ALLOW_DEV_ADMIN;
    else process.env.ALLOW_DEV_ADMIN = prevAllowDevAdmin;
  }

  console.log('  ✓ P2-02 통과');
}

async function testP2_03_StocksTargetPriceAuthorization(): Promise<void> {
  console.log('▶ [P2-03] /api/local-db stocks.target_price 공개 컬럼 정책 및 관리자 권한 경계 검증');

  memoryDb.resetToSeedData({ suppressPublish: true });
  const targetStock = Array.from(memoryDb.stocks.values())[0]!;
  (targetStock as any).target_price = 987_654;

  const prevDisableGuest = process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  const prevAllowDevAdmin = process.env.ALLOW_DEV_ADMIN;
  const prevAdminEmails = process.env.ADMIN_EMAILS;
  delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  delete process.env.ALLOW_DEV_ADMIN;
  delete process.env.ADMIN_EMAILS;

  const guestProfile = memoryDb.ensureUserProfile(GUEST_USER_ID);
  guestProfile.is_admin = false;

  try {
    // 1. 일반 사용자 조회: 배열 및 single/maybeSingle 결과에서 target_price 제거
    const pubListRes = await localDbPost(
      new Request('http://localhost:3000/api/local-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          tableName: 'stocks',
          query: {
            action: 'select',
            filters: [{ col: 'is_listed', op: 'neq', val: false }],
            orderCol: 'ticker',
          },
        }),
      })
    );
    assert.equal(pubListRes.status, 200);
    const pubListJson = await pubListRes.json();
    assert.ok(Array.isArray(pubListJson.data) && pubListJson.data.length > 0);
    for (const row of pubListJson.data) {
      assert.equal('target_price' in row, false, 'Public stocks list must omit target_price');
    }

    const pubSingleRes = await localDbPost(
      new Request('http://localhost:3000/api/local-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          tableName: 'stocks',
          query: {
            action: 'select',
            filters: [{ col: 'id', op: 'eq', val: targetStock.id }],
            isSingle: true,
          },
        }),
      })
    );
    assert.equal(pubSingleRes.status, 200);
    const pubSingleJson = await pubSingleRes.json();
    assert.equal('target_price' in pubSingleJson.data, false, 'Public single stock query must omit target_price');

    // 2. 일반 사용자: target_price 필터/정렬 연산 차단 (403)
    const filterBlockedRes = await localDbPost(
      new Request('http://localhost:3000/api/local-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          tableName: 'stocks',
          query: {
            action: 'select',
            filters: [{ col: 'target_price', op: 'gt', val: 100 }],
          },
        }),
      })
    );
    assert.equal(filterBlockedRes.status, 403, 'Non-admin filter on target_price must return 403');

    const sortBlockedRes = await localDbPost(
      new Request('http://localhost:3000/api/local-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          tableName: 'stocks',
          query: {
            action: 'select',
            orderCol: 'target_price',
            orderAsc: false,
          },
        }),
      })
    );
    assert.equal(sortBlockedRes.status, 403, 'Non-admin orderCol on target_price must return 403');

    const orderSpecBlockedRes = await localDbPost(
      new Request('http://localhost:3000/api/local-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          tableName: 'stocks',
          query: {
            action: 'select',
            orderSpecs: [{ col: 'target_price', ascending: true }],
          },
        }),
      })
    );
    assert.equal(orderSpecBlockedRes.status, 403, 'Non-admin orderSpecs on target_price must return 403');

    // 3. 서버 검증 관리자 권한: AdminPage 쿼리 및 target_price 조회 정상 동작
    process.env.ALLOW_DEV_ADMIN = 'true';
    const adminListRes = await localDbPost(
      new Request('http://localhost:3000/api/local-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          tableName: 'stocks',
          query: {
            action: 'select',
            filters: [{ col: 'id', op: 'eq', val: targetStock.id }],
            orderCol: 'target_price',
            isSingle: true,
          },
        }),
      })
    );
    assert.equal(adminListRes.status, 200);
    const adminListJson = await adminListRes.json();
    assert.equal(adminListJson.data?.target_price, 987_654, 'Verified admin must receive stocks.target_price');
  } finally {
    if (prevDisableGuest === undefined) delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
    else process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = prevDisableGuest;
    if (prevAllowDevAdmin === undefined) delete process.env.ALLOW_DEV_ADMIN;
    else process.env.ALLOW_DEV_ADMIN = prevAllowDevAdmin;
    if (prevAdminEmails === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = prevAdminEmails;
  }

  console.log('  ✓ P2-03 통과');
}

async function main() {
  console.log('================================================================');
  console.log('  반복 디버깅 1차 P1·P2 결함 6건 회귀 검증 스위트');
  console.log('================================================================\n');

  try {
    await loadModules();
    await ensureLocalStandaloneReady();
    getLocalStandaloneEngine()?.stop();

    await testP1_01_CommodityLegacyProfileSettlement();
    await testP1_02_MemoryDbClientPkVsUserIdAndSsrQueries();
    await testP1_03_ReservedCashAuthUserKeyProtection();
    await testP2_01_OptionsPanelAccountBinding();
    await testP2_02_DelistedExclusionListOrderAndAdminMarkets();
    await testP2_03_StocksTargetPriceAuthorization();

    console.log('\n✅ ALL 6 P1/P2 FIX VERIFICATION TESTS PASSED!');
  } finally {
    stopLocalStandaloneEngine();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ 테스트 실패:', err);
    process.exit(1);
  });
