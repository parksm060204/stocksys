/**
 * scripts/test-rereview-2026-11-23-fixes.tsx
 *
 * 전체 재리뷰 결함(P1, P2, P3, 성능) 수정 회귀 테스트 스위트.
 * - 격리된 임시 STOCKSYS_DATA_DIR 및 JSDOM 환경만 사용합니다.
 * - 운영 .data/ 또는 원격 DB를 변경하지 않습니다.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-rereview-23-'));
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
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionContext } from 'next-auth/react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';

let GUEST_USER_ID: typeof import('../lib/memoryDb/memoryStore').GUEST_USER_ID;
let MemoryDatabase: typeof import('../lib/memoryDb/memoryStore').MemoryDatabase;
let memoryDb: typeof import('../lib/memoryDb/memoryStore').memoryDb;
let createMemoryDbClient: typeof import('../lib/memoryDb/memoryDbClient').createMemoryDbClient;
let persistenceManager: typeof import('../lib/memoryDb/PersistenceManager').persistenceManager;
let withAccountLocks: typeof import('../lib/memoryDb/accountLocks').withAccountLocks;
let LocalMarketEngineInstance: typeof import('../lib/engine/localStandaloneServer').LocalMarketEngineInstance;
let ensureLocalStandaloneReady: typeof import('../lib/engine/localStandaloneServer').ensureLocalStandaloneReady;
let getLocalStandaloneEngine: typeof import('../lib/engine/localStandaloneServer').getLocalStandaloneEngine;
let resetStandaloneMarketAtomically: typeof import('../lib/engine/localStandaloneServer').resetStandaloneMarketAtomically;
let stopLocalStandaloneEngine: typeof import('../lib/engine/localStandaloneServer').stopLocalStandaloneEngine;
let LocalMarketService: typeof import('../lib/engine/marketService').LocalMarketService;
let OPTIONS_LP_ID: typeof import('../lib/options/optionOrderService').OPTIONS_LP_ID;
let submitAuthoritativeOptionOrder: typeof import('../lib/options/optionOrderService').submitAuthoritativeOptionOrder;
let createInMemoryRepositoryBundle: typeof import('../lib/repositories/inMemory').createInMemoryRepositoryBundle;
let OptionSettlementEngine: typeof import('../engine-server/src/settlement/OptionSettlementEngine').OptionSettlementEngine;
let StaticTimeSource: typeof import('../lib/engine/simulation/runtime/simulationTimeSource').StaticTimeSource;
let resolvePlayerEventChoice: typeof import('../lib/events/playerEventService').resolvePlayerEventChoice;
let executeCurrencyExchange: typeof import('../lib/exchange/exchangeService').executeCurrencyExchange;
let CommodityMarketEngine: typeof import('../lib/commodities/CommodityMarketEngine').CommodityMarketEngine;
let reserveMarginAndSubmitCommodityOrder: typeof import('../lib/commodities/commodityLedger').reserveMarginAndSubmitCommodityOrder;
let WindowRateLimiter: typeof import('../lib/rateLimit/windowLimiter').WindowRateLimiter;
let localDbPost: typeof import('../app/api/local-db/route').POST;
let shopPurchasePost: typeof import('../app/api/shop/purchase/route').POST;
let setBrowserClient: typeof import('../lib/db/client').setBrowserClient;

let AdminPage: typeof import('../app/admin/page').default;
let ToastProvider: typeof import('../app/components/ToastProvider').ToastProvider;
let OrderEntry: typeof import('../app/components/OrderEntry').default;
let ShopPage: typeof import('../app/shop/page').default;
let Sidebar: typeof import('../app/components/Sidebar').default;
let DashboardGate: typeof import('../app/components/DashboardGate').default;
let RandomEventModal: typeof import('../app/components/RandomEventModal').default;
let ETFPage: typeof import('../app/etf/page').default;
let OptionHTSDashboard: typeof import('../app/components/OptionHTSDashboard').default;
let TradeNotifier: typeof import('../app/components/TradeNotifier').default;
let getStockTickSize: typeof import('../lib/chart/tickSize').getStockTickSize;
let isUsdTickChartAsset: typeof import('../lib/chart/tickSize').isUsdTickChartAsset;

async function loadTestModules() {
  ({ GUEST_USER_ID, MemoryDatabase, memoryDb } = await import('../lib/memoryDb/memoryStore'));
  ({ createMemoryDbClient } = await import('../lib/memoryDb/memoryDbClient'));
  ({ persistenceManager } = await import('../lib/memoryDb/PersistenceManager'));
  ({ withAccountLocks } = await import('../lib/memoryDb/accountLocks'));
  ({
    LocalMarketEngineInstance,
    ensureLocalStandaloneReady,
    getLocalStandaloneEngine,
    resetStandaloneMarketAtomically,
    stopLocalStandaloneEngine,
  } = await import('../lib/engine/localStandaloneServer'));
  ({ LocalMarketService } = await import('../lib/engine/marketService'));
  ({ OPTIONS_LP_ID, submitAuthoritativeOptionOrder } = await import('../lib/options/optionOrderService'));
  ({ createInMemoryRepositoryBundle } = await import('../lib/repositories/inMemory'));
  ({ OptionSettlementEngine } = await import('../engine-server/src/settlement/OptionSettlementEngine'));
  ({ StaticTimeSource } = await import('../lib/engine/simulation/runtime/simulationTimeSource'));
  ({ resolvePlayerEventChoice } = await import('../lib/events/playerEventService'));
  ({ executeCurrencyExchange } = await import('../lib/exchange/exchangeService'));
  ({ CommodityMarketEngine } = await import('../lib/commodities/CommodityMarketEngine'));
  ({ reserveMarginAndSubmitCommodityOrder } = await import('../lib/commodities/commodityLedger'));
  ({ WindowRateLimiter } = await import('../lib/rateLimit/windowLimiter'));
  ({ POST: localDbPost } = await import('../app/api/local-db/route'));
  ({ POST: shopPurchasePost } = await import('../app/api/shop/purchase/route'));
  ({ setBrowserClient } = await import('../lib/db/client'));
  AdminPage = (await import('../app/admin/page')).default;
  ({ ToastProvider } = await import('../app/components/ToastProvider'));
  OrderEntry = (await import('../app/components/OrderEntry')).default;
  ShopPage = (await import('../app/shop/page')).default;
  Sidebar = (await import('../app/components/Sidebar')).default;
  DashboardGate = (await import('../app/components/DashboardGate')).default;
  RandomEventModal = (await import('../app/components/RandomEventModal')).default;
  ETFPage = (await import('../app/etf/page')).default;
  OptionHTSDashboard = (await import('../app/components/OptionHTSDashboard')).default;
  TradeNotifier = (await import('../app/components/TradeNotifier')).default;
  ({ getStockTickSize, isUsdTickChartAsset } = await import('../lib/chart/tickSize'));
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

async function flushUi(ms: number = 25) {
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
    );
  });
}

async function testP1Admin33StocksDelistAndLegacyCompat(): Promise<void> {
  console.log('▶ [P1-1] 관리자 33종목 복구·상장폐지 제외·구 스냅샷 호환 및 AdminPage UI 검증');

  // 1. 신규 MemoryDatabase 기본 시드 33종목 is_listed === true
  const freshDb = new MemoryDatabase();
  assert.equal(freshDb.stocks.size, 33, 'Seed database must contain 33 stocks');
  for (const s of freshDb.stocks.values()) {
    assert.equal(s.is_listed, true, `Seed stock ${s.ticker} must have is_listed === true`);
  }

  // 2. 구버전 스냅샷(is_listed 미포함) + 명시적 상장폐지(is_listed: false) 호환 검증
  const legacySnap = freshDb.exportSnapshot();
  legacySnap.stocks = legacySnap.stocks.map(([id, rec]: [string, any]) => {
    const copy = { ...rec };
    if (copy.ticker === '0020') {
      copy.is_listed = false; // 명시적 상장 폐지 종목
    } else {
      delete copy.is_listed; // 구 스냅샷: 필드 누락
    }
    return [id, copy];
  });

  const restoredDb = new MemoryDatabase();
  restoredDb.importSnapshot(legacySnap);
  assert.equal(restoredDb.stocks.size, 33);
  const delisted = Array.from(restoredDb.stocks.values()).find((s) => s.ticker === '0020')!;
  assert.equal(delisted.is_listed, false, 'Explicitly delisted stock must preserve is_listed === false');
  for (const s of restoredDb.stocks.values()) {
    if (s.ticker !== '0020') {
      assert.equal(s.is_listed, true, `Legacy stock ${s.ticker} must migrate undefined is_listed to true`);
    }
  }

  // 3. AdminPage JSDOM 렌더링: .neq('is_listed', false)로 32종목 노출 (0020 제외)
  const originalFetch = globalThis.fetch;
  const originalDisableGuest = process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  setBrowserClient(null);
  process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'true';
  const client = createMemoryDbClient(restoredDb);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === '/api/admin/scenarios') {
      return new Response(
        JSON.stringify({ success: true, activeScenarios: [], activeMacroShocks: [], logs: [], emergencyControl: { tradingHalt: false } }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url === '/api/local-db' && init?.body) {
      const parsed = JSON.parse(String(init.body));
      if (parsed.tableName === 'profiles') {
        return new Response(
          JSON.stringify({ data: { is_admin: true, unlocked_features: ['custom_dashboard'] }, error: null }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (parsed.tableName === 'stocks') {
        const qb = client.from('stocks');
        for (const f of parsed.query?.filters || []) {
          if (f.op === 'neq') qb.neq(f.col, f.val);
          if (f.op === 'eq') qb.eq(f.col, f.val);
        }
        if (parsed.query?.orderCol) qb.order(parsed.query.orderCol, { ascending: true });
        const res = await qb.execute();
        return new Response(JSON.stringify(res), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
  }) as typeof fetch;

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  try {
    await renderWithProviders(root, <AdminPage />, {
      status: 'authenticated',
      data: { user: { id: GUEST_USER_ID, name: 'Admin', email: 'admin@test.local' } },
    });
    await flushUi(40);
    assert.equal(container.textContent?.includes('32개'), true, 'Admin header must show 32 listed stocks (excluding 1 delisted)');
    assert.equal(container.textContent?.includes('32종목'), true, 'ScenarioController must receive 32 stocks');
    assert.equal(container.textContent?.includes('에코에너지'), false, 'Delisted stock 0020 must be excluded');
    assert.equal(container.textContent?.includes('오성전자'), true, 'Seed stock 0010 must be listed');
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
    globalThis.fetch = originalFetch;
    setBrowserClient(null);
    if (originalDisableGuest === undefined) delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
    else process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = originalDisableGuest;
  }

  console.log('  ✓ P1-1 통과');
}

async function testP1OptionLpLiabilityNettingAndExpiry(): Promise<void> {
  console.log('▶ [P1-2] 옵션 LP 부채 재매수 상계(부분·전량·초과), 만기 정리, 저장실패·재시도 일관성 검증');

  const db = new MemoryDatabase();
  const simNow = 1775000000000;
  const futureExpiry = new Date(simNow + 10 * 24 * 60 * 60 * 1000).toISOString();
  const contractId = 'opt_p1_liab_test';
  db.optionsContracts.set(contractId, {
    id: contractId,
    underlying_stock_id: 'idx_k200',
    ticker: 'IDX-K200-TEST-C260',
    asset_class: 'IDX',
    type: 'CALL',
    option_type: 'CALL',
    strike_price: 260,
    current_price: 2.0,
    multiplier: 250000,
    expiry_date: futureExpiry,
  });

  const userA = db.ensureUserProfile('opt_user_a', { cash: 50_000_000 });
  userA.has_options_license = true;
  const userB = db.ensureUserProfile('opt_user_b', { cash: 50_000_000 });
  userB.has_options_license = true;
  const lpProfile = db.resolveProfileByUserId(OPTIONS_LP_ID)!;
  const lpHoldingKey = `${OPTIONS_LP_ID}_${contractId}`;
  const liabKey = `${OPTIONS_LP_ID}:${contractId}`;

  // 1. User A가 LP로부터 5계약 매수 -> lpLiabilities = 5, LP 보유 = 0
  const buyRes = await submitAuthoritativeOptionOrder({
    db,
    userId: userA.id,
    contractId,
    side: 'BUY',
    orderType: 'MARKET',
    qty: 5,
    nowMs: simNow,
  });
  assert.equal(buyRes.success, true);
  assert.equal(db.lpLiabilities.get(liabKey), 5);
  assert.equal(db.holdings.get(lpHoldingKey), undefined);
  assert.equal(db.holdings.get(`${userA.id}_${contractId}`)?.quantity, 5);

  // 2. 부분 상계: User A가 LP에게 2계약 재매도 -> lpLiabilities = 3, LP 보유 = 0
  const partialSell = await submitAuthoritativeOptionOrder({
    db,
    userId: userA.id,
    contractId,
    side: 'SELL',
    orderType: 'MARKET',
    qty: 2,
    nowMs: simNow,
  });
  assert.equal(partialSell.success, true);
  assert.equal(db.lpLiabilities.get(liabKey), 3);
  assert.equal(db.holdings.get(lpHoldingKey), undefined);
  assert.equal(db.holdings.get(`${userA.id}_${contractId}`)?.quantity, 3);

  // 3. 저장 실패(false 반환) 및 예외(throw) 시 상계 롤백 + 재시도 일관성
  const lpCashBeforeFail = lpProfile.cash;
  const userACashBeforeFail = userA.cash;
  const failFalseSell = await submitAuthoritativeOptionOrder({
    db,
    userId: userA.id,
    contractId,
    side: 'SELL',
    orderType: 'MARKET',
    qty: 2,
    nowMs: simNow,
    onPersist: async () => false,
  });
  assert.equal(failFalseSell.success, false);
  assert.equal(db.lpLiabilities.get(liabKey), 3, 'lpLiabilities must roll back on persist false');
  assert.equal(db.holdings.get(`${userA.id}_${contractId}`)?.quantity, 3);
  assert.equal(userA.cash, userACashBeforeFail);
  assert.equal(lpProfile.cash, lpCashBeforeFail);

  const failThrowSell = await submitAuthoritativeOptionOrder({
    db,
    userId: userA.id,
    contractId,
    side: 'SELL',
    orderType: 'MARKET',
    qty: 2,
    nowMs: simNow,
    onPersist: async () => { throw new Error('persist error'); },
  });
  assert.equal(failThrowSell.success, false);
  assert.equal(db.lpLiabilities.get(liabKey), 3, 'lpLiabilities must roll back on persist throw');

  // 재시도 성공: 2계약 매도 -> lpLiabilities = 1, LP 보유 = 0
  const retrySell = await submitAuthoritativeOptionOrder({
    db,
    userId: userA.id,
    contractId,
    side: 'SELL',
    orderType: 'MARKET',
    qty: 2,
    nowMs: simNow,
    onPersist: async () => true,
  });
  assert.equal(retrySell.success, true);
  assert.equal(db.lpLiabilities.get(liabKey), 1);
  assert.equal(db.holdings.get(lpHoldingKey), undefined);

  // 4. 전량 상계 + 초과 재매수 검증 (User B에게 3계약 직접 보유 부여 후 LP에게 매도 -> 1계약 부채 상계, 2계약 LP 보유 적립)
  db.holdings.set(`${userB.id}_${contractId}`, {
    id: `${userB.id}_${contractId}`,
    user_id: userB.id,
    stock_id: contractId,
    quantity: 3,
    avg_price: 2.0,
    created_at: db.getIsoTimestamp(),
  });
  db.addHoldingToIndex(db.holdings.get(`${userB.id}_${contractId}`)!);

  const overBuySell = await submitAuthoritativeOptionOrder({
    db,
    userId: userB.id,
    contractId,
    side: 'SELL',
    orderType: 'MARKET',
    qty: 3,
    nowMs: simNow,
  });
  assert.equal(overBuySell.success, true);
  assert.equal(db.lpLiabilities.has(liabKey), false, 'lpLiabilities key must be deleted when fully netted');
  assert.equal(db.holdings.get(lpHoldingKey)?.quantity, 2, 'Excess LP buyback above liability must add to LP holdings');

  // 5. 만기 정산 시 미확정(보류/부분실패) 유지 및 확정 시 정리 검증
  const expContractId = 'opt_p1_exp_test';
  const otherUnexpiredId = 'opt_p1_unexpired';
  const expiredAt = new Date(simNow - 1000).toISOString();
  db.optionsContracts.set(expContractId, {
    id: expContractId,
    underlying_stock_id: 'idx_k200',
    ticker: 'IDX-K200-EXP-C260',
    asset_class: 'IDX',
    type: 'CALL',
    option_type: 'CALL',
    strike_price: 260,
    current_price: 5.0,
    multiplier: 250000,
    expiry_date: expiredAt,
  });
  db.optionsContracts.set(otherUnexpiredId, {
    id: otherUnexpiredId,
    underlying_stock_id: 'idx_k200',
    ticker: 'IDX-K200-FUT-C260',
    asset_class: 'IDX',
    type: 'CALL',
    option_type: 'CALL',
    strike_price: 260,
    current_price: 3.0,
    multiplier: 250000,
    expiry_date: futureExpiry,
  });
  db.lpLiabilities.set(`${OPTIONS_LP_ID}:${expContractId}`, 5);
  db.lpLiabilities.set(`${OPTIONS_LP_ID}:${otherUnexpiredId}`, 7);
  db.holdings.set(`${userA.id}_${expContractId}`, {
    id: `${userA.id}_${expContractId}`,
    user_id: userA.id,
    stock_id: expContractId,
    quantity: 3,
    avg_price: 1.0,
    created_at: db.getIsoTimestamp(),
  });
  db.addHoldingToIndex(db.holdings.get(`${userA.id}_${expContractId}`)!);
  db.holdings.set(`${userB.id}_${expContractId}`, {
    id: `${userB.id}_${expContractId}`,
    user_id: userB.id,
    stock_id: expContractId,
    quantity: 2,
    avg_price: 1.0,
    created_at: db.getIsoTimestamp(),
  });
  db.addHoldingToIndex(db.holdings.get(`${userB.id}_${expContractId}`)!);

  const repoBundle = createInMemoryRepositoryBundle(db);
  const optEngine = new OptionSettlementEngine(repoBundle, new StaticTimeSource(simNow));

  // 5a. 기초자산 가격 누락 -> 정산 보류, lpLiabilities 유지
  const heldBatch = await optEngine.executeSettlementBatch({
    contracts: [db.optionsContracts.get(expContractId) as any],
    positions: [
      { userId: userA.id, optionId: expContractId, quantity: 3, avgPrice: 1.0 },
      { userId: userB.id, optionId: expContractId, quantity: 2, avgPrice: 1.0 },
    ],
    underlyingPrices: {},
    now: simNow,
  });
  assert.equal(heldBatch.heldResults.length, 2);
  assert.equal(db.lpLiabilities.get(`${OPTIONS_LP_ID}:${expContractId}`), 5, 'Held expiry must preserve lpLiabilities');

  // 5b. userA 단독 정산 시 FAIL_AT_LEDGER 실패 -> 롤백 후 userA 정산 성공해도 userB 미정산이므로 lpLiabilities 유지
  const failLedger = await repoBundle.settlement.settleOptionExpiryAtomically({
    userId: userA.id,
    optionId: expContractId,
    underlyingClosePrice: 270,
    expectedQuantity: 3,
    now: simNow,
    idempotencyKey: optEngine.generateIdempotencyKey(expContractId, userA.id, expiredAt),
    faultInjection: 'FAIL_AT_LEDGER',
  });
  assert.equal(failLedger.success, false);
  assert.equal(failLedger.rollbackOccurred, true);
  assert.equal(db.lpLiabilities.get(`${OPTIONS_LP_ID}:${expContractId}`), 5);
  assert.equal(db.holdings.get(`${userA.id}_${expContractId}`)?.quantity, 3);

  // userA만 정산 성공 (userB 남음) -> lpLiabilities 유지
  const userACashBefore = userA.cash;
  const settleA = await repoBundle.settlement.settleOptionExpiryAtomically({
    userId: userA.id,
    optionId: expContractId,
    underlyingClosePrice: 270,
    expectedQuantity: 3,
    now: simNow,
    idempotencyKey: optEngine.generateIdempotencyKey(expContractId, userA.id, expiredAt),
  });
  assert.equal(settleA.success, true);
  assert.equal(userA.cash, userACashBefore + 10 * 3 * 250000);
  assert.equal(db.lpLiabilities.get(`${OPTIONS_LP_ID}:${expContractId}`), 5, 'lpLiabilities must stay while userB remains unsettled');

  // 5c. 배치 재실행으로 userB 정산 확정 -> 해당 계약 lpLiabilities 삭제, 타 미만기 계약 부채 유지
  const finishBatch = await optEngine.executeSettlementBatch({
    contracts: [db.optionsContracts.get(expContractId) as any],
    positions: [
      { userId: userA.id, optionId: expContractId, quantity: 3, avgPrice: 1.0 },
      { userId: userB.id, optionId: expContractId, quantity: 2, avgPrice: 1.0 },
    ],
    underlyingPrices: { idx_k200: 270 },
    now: simNow,
  });
  assert.equal(finishBatch.settledCount, 1);
  assert.equal(db.lpLiabilities.has(`${OPTIONS_LP_ID}:${expContractId}`), false, 'Expired settled contract lpLiabilities must be cleared');
  assert.equal(db.lpLiabilities.get(`${OPTIONS_LP_ID}:${otherUnexpiredId}`), 7, 'Unexpired contract lpLiabilities must stay intact');

  // 6. LocalMarketEngineInstance 정기 정산 배치 영속 실패 시 lpLiabilities 롤백 검증
  memoryDb.resetToSeedData({ suppressPublish: true });
  const eng = new LocalMarketEngineInstance();
  const globalExpId = 'opt_global_exp_rollback';
  const pastIso = new Date(memoryDb.getNowMs() - 60_000).toISOString();
  memoryDb.optionsContracts.set(globalExpId, {
    id: globalExpId,
    underlying_stock_id: 'idx_k200',
    ticker: 'IDX-K200-GLOB-C260',
    asset_class: 'IDX',
    type: 'CALL',
    option_type: 'CALL',
    strike_price: 260,
    current_price: 2.0,
    multiplier: 250000,
    expiry_date: pastIso,
  });
  const gUser = memoryDb.ensureUserProfile('global_opt_holder', { cash: 10_000_000 });
  gUser.has_options_license = true;
  memoryDb.holdings.set(`${gUser.id}_${globalExpId}`, {
    id: `${gUser.id}_${globalExpId}`,
    user_id: gUser.id,
    stock_id: globalExpId,
    quantity: 2,
    avg_price: 1.0,
    created_at: memoryDb.getIsoTimestamp(),
  });
  memoryDb.addHoldingToIndex(memoryDb.holdings.get(`${gUser.id}_${globalExpId}`)!);
  memoryDb.lpLiabilities.set(`${OPTIONS_LP_ID}:${globalExpId}`, 2);

  await (eng as any).runPeriodicSettlementBatch(async () => false);
  assert.equal(memoryDb.lpLiabilities.get(`${OPTIONS_LP_ID}:${globalExpId}`), 2, 'Periodic settlement rollback must restore lpLiabilities');
  assert.equal(memoryDb.holdings.get(`${gUser.id}_${globalExpId}`)?.quantity, 2, 'Periodic settlement rollback must restore holdings');

  await (eng as any).runPeriodicSettlementBatch(async () => true);
  assert.equal(memoryDb.lpLiabilities.has(`${OPTIONS_LP_ID}:${globalExpId}`), false, 'Periodic settlement retry commit must clear lpLiabilities');
  assert.equal(memoryDb.holdings.has(`${gUser.id}_${globalExpId}`), false, 'Periodic settlement retry commit must clear expired holding');

  console.log('  ✓ P1-2 통과');
}

async function testP2UiLogoutAccountSwitchAndStaleIgnore(): Promise<void> {
  console.log('▶ [P2-1] 주문창·상점·사이드바·대시보드·이벤트 모달 로그아웃/계정전환/지연응답 차단 검증');

  const originalFetch = globalThis.fetch;
  const originalDisableGuest = process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  setBrowserClient(null);
  process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'true';

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  try {
    // 1. OrderEntry: A 잔액/미수 -> 로그아웃 초기화 -> A 지연 응답이 B를 덮어쓰지 않음
    let orderProfileDeferred: ReturnType<typeof createDeferred<Response>> | null = null;
    let currentOrderUser = 'user_A';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === '/api/local-db' && init?.body) {
        const parsed = JSON.parse(String(init.body));
        if (parsed.tableName === 'exchange_rates') {
          return new Response(JSON.stringify({ data: { rate_to_krw: 1380 }, error: null }), { status: 200 });
        }
        if (parsed.tableName === 'stocks') {
          const isSingle = parsed.query?.isMaybeSingle || parsed.query?.isSingle;
          const row = { id: 'stk_0010', ticker: '0010', market: 'domestic' };
          return new Response(JSON.stringify({ data: isSingle ? row : [row], error: null }), { status: 200 });
        }
        if (parsed.tableName === 'options_contracts' || parsed.tableName === 'orders') {
          return new Response(JSON.stringify({ data: [], error: null }), { status: 200 });
        }
        if (parsed.tableName === 'holdings') {
          const qty = currentOrderUser === 'user_A' ? 77 : 5;
          return new Response(JSON.stringify({ data: { quantity: qty }, error: null }), { status: 200 });
        }
        if (parsed.tableName === 'profiles') {
          if (currentOrderUser === 'user_A' && orderProfileDeferred) {
            return await orderProfileDeferred.promise;
          }
          const cash = currentOrderUser === 'user_A' ? 88_888_000 : 12_345_000;
          const debt = currentOrderUser === 'user_A' ? 500_000 : 0;
          return new Response(
            JSON.stringify({ data: { cash, margin_debt_krw: debt, unlocked_features: [] }, error: null }),
            { status: 200 }
          );
        }
      }
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }) as typeof fetch;

    const sampleStock = {
      id: 'stk_0010',
      ticker: '0010',
      name: '오성전자',
      market: 'domestic',
      sector: '반도체',
      currentPrice: 72000,
      previousClose: 71500,
      marketCap: 1000000,
    } as any;

    await renderWithProviders(root, <OrderEntry stock={sampleStock} />, {
      status: 'authenticated',
      data: { user: { id: 'user_A', name: 'A', email: 'a@test.local' } },
    });
    await flushUi(30);
    assert.equal(container.textContent?.includes('미수 부채(₩500,000)'), true, 'OrderEntry must render User A debt');
    assert.equal(container.textContent?.includes('가용 예수금'), true);

    await renderWithProviders(root, <OrderEntry stock={sampleStock} />, {
      status: 'unauthenticated',
      data: null,
    });
    await flushUi(30);
    assert.equal(container.textContent?.includes('미수 부채'), false, 'OrderEntry must clear margin debt on logout');
    assert.equal(container.textContent?.includes('가용 예수금'), false, 'OrderEntry must clear cash display on logout');

    // A 지연 중 B 전환
    orderProfileDeferred = createDeferred<Response>();
    currentOrderUser = 'user_A';
    await renderWithProviders(root, <OrderEntry stock={sampleStock} />, {
      status: 'authenticated',
      data: { user: { id: 'user_A', name: 'A', email: 'a@test.local' } },
    });
    await flushUi(15);
    currentOrderUser = 'user_B';
    await renderWithProviders(root, <OrderEntry stock={sampleStock} />, {
      status: 'authenticated',
      data: { user: { id: 'user_B', name: 'B', email: 'b@test.local' } },
    });
    await flushUi(30);
    assert.equal(container.textContent?.includes('12,345,000'), true, 'OrderEntry must show User B cash');
    orderProfileDeferred.resolve(
      new Response(JSON.stringify({ data: { cash: 88_888_000, margin_debt_krw: 900_000, unlocked_features: [] }, error: null }), { status: 200 })
    );
    await flushUi(25);
    assert.equal(container.textContent?.includes('12,345,000'), true, 'Stale User A response must not overwrite User B in OrderEntry');
    assert.equal(container.textContent?.includes('900,000'), false);

    // 2. ShopPage: A 보유/권한 -> 로그아웃 초기화 -> A 지연 응답 무시
    let shopProfileDeferred: ReturnType<typeof createDeferred<Response>> | null = null;
    let currentShopUser = 'shop_A';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === '/api/local-db' && init?.body) {
        const parsed = JSON.parse(String(init.body));
        if (parsed.tableName === 'media_outlets') {
          return new Response(JSON.stringify({ data: [], error: null }), { status: 200 });
        }
        if (parsed.tableName === 'profiles') {
          if (currentShopUser === 'shop_A' && shopProfileDeferred) {
            return await shopProfileDeferred.promise;
          }
          const data =
            currentShopUser === 'shop_A'
              ? {
                  cash: 44_444_000,
                  is_admin: true,
                  has_options_license: true,
                  unlocked_features: ['custom_dashboard'],
                  feature_expiries: {},
                  acquired_passives: ['insider_edge'],
                  news_subscriptions: { '1': new Date(Date.now() + 86400000).toISOString() },
                }
              : {
                  cash: 3_333_000,
                  is_admin: false,
                  has_options_license: false,
                  unlocked_features: [],
                  feature_expiries: {},
                  acquired_passives: [],
                  news_subscriptions: {},
                };
          return new Response(JSON.stringify({ data, error: null }), { status: 200 });
        }
      }
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }) as typeof fetch;

    await renderWithProviders(root, <ShopPage />, {
      status: 'authenticated',
      data: { user: { id: 'shop_A', name: 'A', email: 'a@test.local' } },
    });
    await flushUi(30);
    assert.equal(container.textContent?.includes('44,444,000'), true, 'ShopPage must show User A cash');

    await renderWithProviders(root, <ShopPage />, {
      status: 'unauthenticated',
      data: null,
    });
    await flushUi(30);
    assert.equal(container.textContent?.includes('44,444,000'), false, 'ShopPage must clear User A cash on logout');
    assert.equal(container.textContent?.includes('보유 중'), false, 'ShopPage must clear User A entitlements on logout');

    shopProfileDeferred = createDeferred<Response>();
    currentShopUser = 'shop_A';
    await renderWithProviders(root, <ShopPage />, {
      status: 'authenticated',
      data: { user: { id: 'shop_A', name: 'A', email: 'a@test.local' } },
    });
    await flushUi(15);
    currentShopUser = 'shop_B';
    await renderWithProviders(root, <ShopPage />, {
      status: 'authenticated',
      data: { user: { id: 'shop_B', name: 'B', email: 'b@test.local' } },
    });
    await flushUi(30);
    assert.equal(container.textContent?.includes('3,333,000'), true);
    shopProfileDeferred.resolve(
      new Response(JSON.stringify({ data: { cash: 44_444_000, is_admin: true, has_options_license: true, unlocked_features: ['custom_dashboard'] }, error: null }), { status: 200 })
    );
    await flushUi(25);
    assert.equal(container.textContent?.includes('3,333,000'), true, 'Stale ShopPage response must not overwrite User B');
    assert.equal(container.textContent?.includes('44,444,000'), false);

    // 3. Sidebar: 관리자/해금 상태 로그아웃 초기화 및 지연 응답 무시
    let sidebarDeferred: ReturnType<typeof createDeferred<Response>> | null = null;
    let currentSidebarUser = 'side_A';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === '/api/local-db' && init?.body) {
        const parsed = JSON.parse(String(init.body));
        if (parsed.tableName === 'profiles') {
          if (currentSidebarUser === 'side_A' && sidebarDeferred) {
            return await sidebarDeferred.promise;
          }
          return new Response(
            JSON.stringify({
              data:
                currentSidebarUser === 'side_A'
                  ? { is_admin: true, unlocked_features: ['custom_dashboard'] }
                  : { is_admin: false, unlocked_features: [] },
              error: null,
            }),
            { status: 200 }
          );
        }
      }
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }) as typeof fetch;

    await renderWithProviders(root, <Sidebar />, {
      status: 'authenticated',
      data: { user: { id: 'side_A', name: 'Admin', email: 'a@test.local' } },
    });
    await flushUi(25);
    assert.equal(container.textContent?.includes('슈퍼 관리자 모드'), true, 'Sidebar must show admin badge for admin user');

    await renderWithProviders(root, <Sidebar />, {
      status: 'unauthenticated',
      data: null,
    });
    await flushUi(25);
    assert.equal(container.textContent?.includes('슈퍼 관리자 모드'), false, 'Sidebar must clear admin badge on logout');

    sidebarDeferred = createDeferred<Response>();
    currentSidebarUser = 'side_A';
    await renderWithProviders(root, <Sidebar />, {
      status: 'authenticated',
      data: { user: { id: 'side_A', name: 'Admin', email: 'a@test.local' } },
    });
    await flushUi(10);
    currentSidebarUser = 'side_B';
    await renderWithProviders(root, <Sidebar />, {
      status: 'authenticated',
      data: { user: { id: 'side_B', name: 'User', email: 'b@test.local' } },
    });
    await flushUi(25);
    sidebarDeferred.resolve(
      new Response(JSON.stringify({ data: { is_admin: true, unlocked_features: ['custom_dashboard'] }, error: null }), { status: 200 })
    );
    await flushUi(25);
    assert.equal(container.textContent?.includes('슈퍼 관리자 모드'), false, 'Stale Sidebar response must not restore admin badge for User B');

    // 4. DashboardGate + P3-2 (market_indices 403 미발생 확인)
    const queriedTables: string[] = [];
    let dashDeferred: ReturnType<typeof createDeferred<Response>> | null = null;
    let currentDashUser = 'dash_A';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === '/api/local-db' && init?.body) {
        const parsed = JSON.parse(String(init.body));
        queriedTables.push(parsed.tableName);
        if (parsed.tableName === 'market_indices') {
          return new Response(JSON.stringify({ data: null, error: { message: '403' } }), { status: 403 });
        }
        if (parsed.tableName === 'profiles') {
          if (currentDashUser === 'dash_A' && dashDeferred) {
            return await dashDeferred.promise;
          }
          return new Response(
            JSON.stringify({
              data:
                currentDashUser === 'dash_A'
                  ? { is_admin: false, unlocked_features: ['custom_dashboard'] }
                  : { is_admin: false, unlocked_features: [] },
              error: null,
            }),
            { status: 200 }
          );
        }
        if (parsed.tableName === 'stocks') {
          return new Response(
            JSON.stringify({
              data: [{ id: 's1', name: '오성전자', ticker: '0010', market: 'domestic', sector: '반도체', current_price: 72000, previous_close: 71500 }],
              error: null,
            }),
            { status: 200 }
          );
        }
        if (parsed.tableName === 'market_news') {
          return new Response(JSON.stringify({ data: [], error: null }), { status: 200 });
        }
      }
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }) as typeof fetch;

    await renderWithProviders(
      root,
      <DashboardGate><div data-testid="intro-view">INTRO_CHILD</div></DashboardGate>,
      { status: 'authenticated', data: { user: { id: 'dash_A', name: 'A', email: 'a@test.local' } } }
    );
    await flushUi(40);
    assert.equal(container.textContent?.includes('INTRO_CHILD'), false, 'Unlocked user must see DashboardContent');
    assert.equal(queriedTables.includes('market_indices'), false, 'P3-2: DashboardContent must not query nonexistent market_indices table');

    await renderWithProviders(
      root,
      <DashboardGate><div data-testid="intro-view">INTRO_CHILD</div></DashboardGate>,
      { status: 'unauthenticated', data: null }
    );
    await flushUi(25);
    assert.equal(container.textContent?.includes('INTRO_CHILD'), true, 'DashboardGate must reset to intro on logout');

    dashDeferred = createDeferred<Response>();
    currentDashUser = 'dash_A';
    await renderWithProviders(
      root,
      <DashboardGate><div data-testid="intro-view">INTRO_CHILD</div></DashboardGate>,
      { status: 'authenticated', data: { user: { id: 'dash_A', name: 'A', email: 'a@test.local' } } }
    );
    await flushUi(10);
    currentDashUser = 'dash_B';
    await renderWithProviders(
      root,
      <DashboardGate><div data-testid="intro-view">INTRO_CHILD</div></DashboardGate>,
      { status: 'authenticated', data: { user: { id: 'dash_B', name: 'B', email: 'b@test.local' } } }
    );
    await flushUi(25);
    dashDeferred.resolve(
      new Response(JSON.stringify({ data: { is_admin: false, unlocked_features: ['custom_dashboard'] }, error: null }), { status: 200 })
    );
    await flushUi(25);
    assert.equal(container.textContent?.includes('INTRO_CHILD'), true, 'Stale DashboardGate response must not flip User B to dashboard');

    // 5. RandomEventModal: 로그아웃 즉시 닫힘 + 지연 응답 무시
    let eventDeferred: ReturnType<typeof createDeferred<Response>> | null = null;
    let currentEventUser = 'ev_A';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === '/api/local-db' && init?.body) {
        const parsed = JSON.parse(String(init.body));
        if (parsed.tableName === 'active_player_events') {
          if (currentEventUser === 'ev_A' && eventDeferred) {
            return await eventDeferred.promise;
          }
          return new Response(
            JSON.stringify({
              data:
                currentEventUser === 'ev_A'
                  ? [{ id: 'ae_1', user_id: 'ev_A', event_id: 'pe_1', status: 'pending' }]
                  : [],
              error: null,
            }),
            { status: 200 }
          );
        }
        if (parsed.tableName === 'player_events') {
          return new Response(
            JSON.stringify({
              data: {
                id: 'pe_1',
                stage: 1,
                title: '특수 정보 제보',
                description: '유저 A 전용 이벤트',
                choice_a_text: '선택 A',
                choice_a_cost: 0,
                choice_a_passive: null,
                choice_b_text: '선택 B',
                choice_b_cost: 0,
                choice_b_passive: null,
              },
              error: null,
            }),
            { status: 200 }
          );
        }
      }
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }) as typeof fetch;

    // useFakeTimers 대신 실제 2초 대기 대신 delayTimer가 2000ms이므로 잠시 대기하거나 테스트
    await renderWithProviders(root, <RandomEventModal />, {
      status: 'authenticated',
      data: { user: { id: 'ev_A', name: 'A', email: 'a@test.local' } },
    });
    await flushUi(2150);
    assert.equal(container.textContent?.includes('돌발 이벤트 발생!'), true, 'RandomEventModal must open for User A');

    await renderWithProviders(root, <RandomEventModal />, {
      status: 'unauthenticated',
      data: null,
    });
    await flushUi(25);
    assert.equal(container.textContent?.includes('돌발 이벤트 발생!'), false, 'RandomEventModal must close immediately on logout');

    eventDeferred = createDeferred<Response>();
    currentEventUser = 'ev_A';
    await renderWithProviders(root, <RandomEventModal />, {
      status: 'authenticated',
      data: { user: { id: 'ev_A', name: 'A', email: 'a@test.local' } },
    });
    await flushUi(2100);
    currentEventUser = 'ev_B';
    await renderWithProviders(root, <RandomEventModal />, {
      status: 'authenticated',
      data: { user: { id: 'ev_B', name: 'B', email: 'b@test.local' } },
    });
    await flushUi(25);
    eventDeferred.resolve(
      new Response(JSON.stringify({ data: [{ id: 'ae_1', user_id: 'ev_A', event_id: 'pe_1', status: 'pending' }], error: null }), { status: 200 })
    );
    await flushUi(25);
    assert.equal(container.textContent?.includes('돌발 이벤트 발생!'), false, 'Stale RandomEventModal response must not appear for User B');
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
    globalThis.fetch = originalFetch;
    setBrowserClient(null);
    if (originalDisableGuest === undefined) delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
    else process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = originalDisableGuest;
  }

  console.log('  ✓ P2-1 통과');
}

async function testP2LegacyProfileLookupUpdateLockAndIsolation(): Promise<void> {
  console.log('▶ [P2-2] 레거시 프로필(id !== user_id) 조회·갱신·잠금 범위·교차계정 격리 검증');

  memoryDb.resetToSeedData({ suppressPublish: true });
  const legacyId = 'legacy_prof_001';
  const authUid1 = GUEST_USER_ID;
  const authUid2 = 'auth_user_colliding_2';

  // 기존 GUEST_USER_ID 시드 프로필 제거 후 레거시 프로필(id !== user_id) + 의도적 ID 충돌 타계정 프로필(id === authUid1, user_id === authUid2) 배치
  memoryDb.profiles.delete(GUEST_USER_ID);
  memoryDb.profiles.set(legacyId, {
    id: legacyId,
    user_id: authUid1,
    username: '레거시유저1',
    nickname: '레거시유저1',
    cash: 100_000_000,
    net_worth: 100_000_000,
    rank_tier: 'Diamond',
    is_admin: true,
    has_options_license: true,
    created_at: memoryDb.getIsoTimestamp(),
  });
  memoryDb.profiles.set(authUid1, {
    id: authUid1,
    user_id: authUid2,
    username: '타인충돌계정2',
    nickname: '타인충돌계정2',
    cash: 777,
    net_worth: 777,
    rank_tier: 'Bronze',
    is_admin: false,
    has_options_license: false,
    created_at: memoryDb.getIsoTimestamp(),
  });
  memoryDb.rebuildIndexes();

  assert.equal(memoryDb.resolveProfileByUserId(authUid1)?.id, legacyId, 'Must resolve to legacyId by user_id, not colliding id');
  assert.equal(memoryDb.resolveProfileByUserId(authUid2)?.id, authUid1, 'Must resolve authUid2 to its own profile');
  assert.equal(memoryDb.resolveAccountLockKey(authUid1), legacyId, 'Canonical lock key must be profile.id');

  // 1. /api/local-db SELECT 교차 계정 격리 및 본인 조회/수정 확인 (게스트 개발 세션 = authUid1)
  const prevDisableGuest = process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  try {
    // 1a. authUid1이 .eq('user_id', authUid1)로 본인 프로필 조회 -> legacyId의 cash 반환
    //     반면 명시적 .eq('id', authUid1)은 행 PK(id)로만 해석되어 타인(authUid2) 행을 마스킹 반환해야 함
    const ownSelectRes = await localDbPost(
      new Request('http://localhost:3000/api/local-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          tableName: 'profiles',
          query: {
            action: 'select',
            filters: [{ col: 'user_id', op: 'eq', val: authUid1 }],
            isSingle: true,
          },
        }),
      })
    );
    const ownSelectJson = await ownSelectRes.json();
    assert.equal(ownSelectJson.data?.id, legacyId);
    assert.equal(ownSelectJson.data?.cash, 100_000_000);

    const pkSelectRes = await localDbPost(
      new Request('http://localhost:3000/api/local-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          tableName: 'profiles',
          query: {
            action: 'select',
            filters: [{ col: 'id', op: 'eq', val: authUid1 }],
            isSingle: true,
          },
        }),
      })
    );
    const pkSelectJson = await pkSelectRes.json();
    assert.equal(pkSelectJson.data?.id, authUid1);
    assert.equal(pkSelectJson.data?.user_id, authUid2);
    assert.equal(pkSelectJson.data?.cash, undefined, 'Explicit id filter must not fall back to authUid1 profile');

    // 1b. authUid1이 타인(authUid2) 프로필을 id 또는 user_id로 조회 -> cash/is_admin 비노출
    const crossRes = await localDbPost(
      new Request('http://localhost:3000/api/local-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          tableName: 'profiles',
          query: {
            action: 'select',
            filters: [{ col: 'user_id', op: 'eq', val: authUid2 }],
            isSingle: true,
          },
        }),
      })
    );
    const crossJson = await crossRes.json();
    assert.equal(crossJson.data?.id, authUid1);
    assert.equal(crossJson.data?.cash, undefined, 'Cross-account query must NOT expose cash');
    assert.equal(crossJson.data?.is_admin, undefined, 'Cross-account query must NOT expose is_admin');

    // 1c. authUid1으로 nickname update -> legacyId 갱신 (충돌 id authUid1 미변조)
    const updRes = await localDbPost(
      new Request('http://localhost:3000/api/local-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          tableName: 'profiles',
          query: {
            action: 'update',
            payloadData: { nickname: '갱신닉네임' },
          },
        }),
      })
    );
    assert.equal(updRes.status, 200);
    assert.equal(memoryDb.profiles.get(legacyId)?.nickname, '갱신닉네임');
    assert.equal(memoryDb.profiles.get(authUid1)?.nickname, '타인충돌계정2', 'Colliding other user profile must remain untouched');

    // 1d. shop/purchase 정상 처리 및 legacyId 차감
    const origSave = persistenceManager.saveSnapshot.bind(persistenceManager);
    persistenceManager.saveSnapshot = async () => true;
    try {
      const shopRes = await shopPurchasePost(
        new Request('http://localhost:3000/api/shop/purchase', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemType: 'product', productId: 'fee_booster' }),
        })
      );
      assert.equal(shopRes.status, 200);
      assert.equal(memoryDb.profiles.get(legacyId)?.cash, 99_000_000);
      assert.equal(memoryDb.profiles.get(authUid1)?.cash, 777);
    } finally {
      persistenceManager.saveSnapshot = origSave;
    }
  } finally {
    if (prevDisableGuest === undefined) delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
    else process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = prevDisableGuest;
  }

  // 2. 주식 주문/취소, 옵션 주문, 환전, 이벤트, 원자재(중첩 락 포함) 모두 legacyId 정상 갱신 + 잠금 일치 검증
  const stock = Array.from(memoryDb.stocks.values())[0]!;
  const stockOrderRes = await LocalMarketService.submitOrder({
    userId: authUid1,
    stockId: stock.id,
    side: 'buy',
    price: 10,
    size: 1,
    onPersist: async () => true,
  });
  assert.equal(stockOrderRes.success, true, stockOrderRes.message);
  const cancelRes = await LocalMarketService.cancelOrder({
    orderId: stockOrderRes.orderId!,
    userId: authUid1,
    onPersist: async () => true,
  });
  assert.equal(cancelRes.success, true, cancelRes.message);

  const optContract = Array.from(memoryDb.optionsContracts.values())[0]!;
  const cashBeforeOpt = memoryDb.profiles.get(legacyId)!.cash;
  const optRes = await submitAuthoritativeOptionOrder({
    db: memoryDb,
    userId: authUid1,
    contractId: optContract.id,
    side: 'BUY',
    orderType: 'MARKET',
    qty: 1,
    onPersist: async () => true,
  });
  assert.equal(optRes.success, true, optRes.message);
  assert.equal(memoryDb.profiles.get(legacyId)!.cash < cashBeforeOpt, true);

  const cashBeforeEx = memoryDb.profiles.get(legacyId)!.cash;
  const exRes = await executeCurrencyExchange({
    db: memoryDb,
    userId: authUid1,
    fromCur: 'KRW',
    toCur: 'USD',
    amount: 138000,
    onPersist: async () => true,
  });
  assert.equal(exRes.success, true, exRes.message);
  assert.equal(memoryDb.profiles.get(legacyId)!.cash, cashBeforeEx - 138000);

  // 원자재 엔진 중첩 락 및 정산 호환
  const commEngine = new CommodityMarketEngine({ totalBots: 10, db: memoryDb });
  await commEngine.reconcileWithDatabase(memoryDb);
  const oil = commEngine.getCommodity('CRUDE_OIL')!;
  const commOrder = await reserveMarginAndSubmitCommodityOrder({
    db: memoryDb,
    commodity: oil,
    userId: authUid1,
    side: 'buy',
    type: 'limit',
    price: 10,
    size: 1,
    submitToEngine: () => commEngine.submitUserOrder({ commodityId: 'CRUDE_OIL', userId: authUid1, side: 'buy', type: 'limit', price: 10, size: 1 }),
    rollbackFromEngine: (oid) => commEngine.removeUserOrder('CRUDE_OIL', oid),
    runWithEngineLock: (fn) => commEngine.runWithTickLock(fn),
  });
  assert.equal(commOrder.success, true, commOrder.message);
  await commEngine.stepTickAsync(); // outer withAccountLocks + inner settle/release must not throw lock ordering violation

  // 동일 계좌 잠금 범위 보존: legacyId 락과 resolveAccountLockKey(authUid1) 락이 상호 배제됨을 검증
  const lockOrderLog: string[] = [];
  let releaseBarrier!: () => void;
  const barrier = new Promise<void>((r) => { releaseBarrier = r; });
  const holder = withAccountLocks([legacyId], async () => {
    lockOrderLog.push('holder_enter');
    await barrier;
    lockOrderLog.push('holder_exit');
  });
  await new Promise((r) => setTimeout(r, 10));
  const waiter = executeCurrencyExchange({
    db: memoryDb,
    userId: authUid1,
    fromCur: 'KRW',
    toCur: 'USD',
    amount: 13800,
    onPersist: async () => true,
  }).then((r) => {
    lockOrderLog.push('waiter_done');
    return r;
  });
  await new Promise((r) => setTimeout(r, 15));
  assert.deepEqual(lockOrderLog, ['holder_enter'], 'Exchange for authUid1 must wait on legacyId lock');
  releaseBarrier();
  await holder;
  const waiterRes = await waiter;
  assert.equal(waiterRes.success, true);
  assert.deepEqual(lockOrderLog, ['holder_enter', 'holder_exit', 'waiter_done']);

  console.log('  ✓ P2-2 통과');
}

async function testP2PlayerEventCatchMarginDebtRollback(): Promise<void> {
  console.log('▶ [P2-3] playerEventService 저장 예외(catch) 시 margin_debt_krw 롤백 검증');

  const db = new MemoryDatabase();
  const profile = db.ensureUserProfile('ev_debt_user', { cash: 100_000, margin_debt_krw: 250_000 });
  profile.margin_debt_krw = 250_000;
  profile.acquired_passives = [];
  db.playerEvents.push({
    id: 'pe_debt_test',
    stage: 1,
    title: '보상 이벤트',
    description: '보상 지급',
    choice_a_text: '수령',
    choice_a_cost: -400_000, // 40만원 지급 -> 부채 25만원 전액 상환 + 현금 15만원 증가
    choice_a_passive: 'lucky_buff',
    choice_b_text: '거절',
    choice_b_cost: 0,
    choice_b_passive: null,
  });
  db.activePlayerEvents.push({
    id: 'ae_debt_1',
    user_id: profile.user_id,
    event_id: 'pe_debt_test',
    status: 'pending',
  });

  const throwRes = await resolvePlayerEventChoice({
    db,
    userId: profile.user_id,
    activeEventId: 'ae_debt_1',
    choice: 'A',
    onPersist: async () => {
      throw new Error('Injected DB throw');
    },
  });

  assert.equal(throwRes.success, false);
  assert.equal(throwRes.statusCode, 500);
  assert.equal(profile.cash, 100_000, 'Cash must roll back on catch');
  assert.equal(profile.margin_debt_krw, 250_000, 'margin_debt_krw must roll back on catch');
  assert.deepEqual(profile.acquired_passives, [], 'acquired_passives must roll back on catch');
  assert.equal(db.activePlayerEvents[0].status, 'pending');

  // 정상 재시도 시 부채 전액 상환 + 현금 증가 확인
  const okRes = await resolvePlayerEventChoice({
    db,
    userId: profile.user_id,
    activeEventId: 'ae_debt_1',
    choice: 'A',
    onPersist: async () => true,
  });
  assert.equal(okRes.success, true);
  assert.equal(profile.margin_debt_krw, undefined, 'margin_debt_krw must be cleared when repaid');
  assert.equal(profile.cash, 250_000);

  console.log('  ✓ P2-3 통과');
}

async function testP2EtfSameBatchABAReselection(): Promise<void> {
  console.log('▶ [P2-4] ETF 같은 렌더 배치 A → B → A 재선택 정상 동작 검증');

  const originalFetch = globalThis.fetch;
  const originalDisableGuest = process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  setBrowserClient(null);
  process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'true';

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === '/api/local-db' && init?.body) {
      const parsed = JSON.parse(String(init.body));
      if (parsed.tableName === 'exchange_rates') {
        return new Response(JSON.stringify({ data: { rate_to_krw: 1380 }, error: null }), { status: 200 });
      }
      if (parsed.tableName === 'stocks') {
        const tickerFilter = parsed.query?.filters?.find((f: any) => f.col === 'ticker' && f.op === 'eq');
        if (!tickerFilter) {
          return new Response(
            JSON.stringify({
              data: [
                { id: 'etf_KODEX200', ticker: 'KODEX200', current_price: 35000 },
                { id: 'etf_SPY', ticker: 'SPY', current_price: 500 },
              ],
              error: null,
            }),
            { status: 200 }
          );
        }
        const row = tickerFilter.val === 'SPY'
          ? { id: 'etf_SPY', ticker: 'SPY', current_price: 500 }
          : { id: 'etf_KODEX200', ticker: 'KODEX200', current_price: 35000 };
        return new Response(JSON.stringify({ data: row, error: null }), { status: 200 });
      }
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
  }) as typeof fetch;

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  const findCard = (ticker: string): HTMLElement => {
    const spans = Array.from(container.querySelectorAll('span'));
    const targetSpan = spans.find((s) => s.textContent?.trim() === ticker);
    assert.ok(targetSpan, `ETF card span ${ticker} must exist`);
    let el: HTMLElement | null = targetSpan.parentElement;
    while (el && !el.className.includes('cursor-pointer')) el = el.parentElement;
    assert.ok(el, `ETF clickable card ${ticker} must exist`);
    return el;
  };

  try {
    await renderWithProviders(root, <ETFPage />, { status: 'unauthenticated', data: null });
    await flushUi(30);

    // 같은 act() 배치 내에서 KODEX200(A) -> SPY(B) -> KODEX200(A) 연속 클릭
    await act(async () => {
      findCard('SPY').click();
      findCard('KODEX200').click();
    });
    await flushUi(30);

    const bodyText = container.textContent || '';
    assert.equal(bodyText.includes('서버 현재가: ₩35,000'), true, 'Selected ETF after A->B->A batch must return to KODEX200 (₩35,000)');
    assert.equal(bodyText.includes('서버 현재가: $500.00'), false, 'Selected ETF must not remain stuck on SPY ($500.00)');
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
    globalThis.fetch = originalFetch;
    setBrowserClient(null);
    if (originalDisableGuest === undefined) delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
    else process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = originalDisableGuest;
  }

  console.log('  ✓ P2-4 통과');
}

async function testP3AndPerformanceFixes(): Promise<void> {
  console.log('▶ [P3 & 성능] StrictMode 옵션 대시보드·틱 단위·체결 알림·리셋 이벤트·레이트리미터 정리 검증');

  // P3-3: 틱 차트 통화/호가는 USD $1,200와 KRW 800원을 정확히 구분해야 함
  assert.equal(isUsdTickChartAsset('NVDA', { market: 'overseas' }), true);
  assert.equal(getStockTickSize(1250, 'NVDA', { market: 'overseas' }), 0.01, '$1250 USD stock must have 0.01 tick');
  assert.equal(isUsdTickChartAsset('0010', { market: 'domestic' }), false);
  assert.equal(getStockTickSize(800, '0010', { market: 'domestic' }), 1, '800 KRW 4-digit stock must have 1 KRW tick');
  assert.equal(getStockTickSize(72000, '0010', { market: 'domestic' }), 100);
  assert.equal(getStockTickSize(500, 'SPY', { market: 'etf' }), 0.01);
  assert.equal(getStockTickSize(900, 'KODEX200', { market: 'etf' }), 1);

  // P3-5: 저장 실패한 시장 리셋은 market_reset 이벤트를 선발행하지 않음
  memoryDb.resetToSeedData({ suppressPublish: true });
  let resetEventsCount = 0;
  const unsub = memoryDb.subscribe('market_reset', () => {
    resetEventsCount += 1;
  });
  try {
    const failOk = await resetStandaloneMarketAtomically(async () => false);
    assert.equal(failOk, false);
    assert.equal(resetEventsCount, 0, 'Failed market reset must NOT publish market_reset event');

    await assert.rejects(
      () => resetStandaloneMarketAtomically(async () => { throw new Error('disk err'); }),
      /disk err/
    );
    assert.equal(resetEventsCount, 0, 'Throwing market reset must NOT publish market_reset event');

    const successOk = await resetStandaloneMarketAtomically(async () => true);
    assert.equal(successOk, true);
    assert.equal(resetEventsCount, 1, 'Committed market reset must publish market_reset event once');
  } finally {
    unsub();
  }

  // P3-6: WindowRateLimiter 만료 정리 검증
  const limiter = new WindowRateLimiter(15, 1000, 1000, 100);
  for (let i = 0; i < 50; i++) {
    assert.equal(limiter.allow(`user_${i}`, 1000), true);
  }
  assert.equal(limiter.size, 50);
  // 2초 뒤 요청 시 만료 엔트리 50건 정리되어 size === 1 유지
  assert.equal(limiter.allow('fresh_user', 3000), true);
  assert.equal(limiter.size, 1, 'Expired rate limit entries must be pruned');

  // P3-1 (OptionHTSDashboard StrictMode) & P3-4 (TradeNotifier 옵션/채권 알림 라벨)
  const originalFetch = globalThis.fetch;
  const originalDisableGuest = process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  setBrowserClient(null);
  process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'true';

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  try {
    // P3-1: StrictMode에서 OptionHTSDashboard 업데이터 부수효과 없이 정상 렌더링
    const futureExp = new Date(Date.now() + 30 * 86400000).toISOString();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === '/api/local-db' && init?.body) {
        const parsed = JSON.parse(String(init.body));
        if (parsed.tableName === 'options_contracts') {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'opt_c_260',
                  ticker: 'IDX-K200-2612-C260.0',
                  asset_class: 'IDX',
                  type: 'CALL',
                  option_type: 'CALL',
                  strike_price: 260,
                  current_price: 2.15,
                  multiplier: 250000,
                  expiry_date: futureExp,
                },
              ],
              error: null,
            }),
            { status: 200 }
          );
        }
        if (parsed.tableName === 'stocks') {
          return new Response(
            JSON.stringify({
              data: [{ market: 'domestic', current_price: 72000, previous_close: 72000, shares_outstanding: 1000000, volume: 100 }],
              error: null,
            }),
            { status: 200 }
          );
        }
        if (parsed.tableName === 'trades') {
          return new Response(JSON.stringify({ data: [], error: null }), { status: 200 });
        }
      }
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }) as typeof fetch;

    await renderWithProviders(
      root,
      <StrictMode><OptionHTSDashboard /></StrictMode>,
      { status: 'unauthenticated', data: null }
    );
    await flushUi(30);
    assert.equal(container.textContent?.includes('IDX-K200-2612-C260.0'), true, 'OptionHTSDashboard must select front 260 CALL under StrictMode');

    // P3-4: TradeNotifier 옵션/채권 체결 알림 라벨
    let pollStep = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === '/api/local-db' && init?.body) {
        const parsed = JSON.parse(String(init.body));
        if (parsed.action === 'rpc' && parsed.fnName === 'get_my_recent_trades') {
          pollStep += 1;
          if (pollStep === 1) {
            return new Response(JSON.stringify({ data: [], error: null }), { status: 200 });
          }
          return new Response(
            JSON.stringify({
              data: [
                { id: 'opt_tr_1', stock_id: 'opt_c_720', is_buyer: true, price: 2.5, size: 3, created_at: new Date().toISOString() },
                { id: 'bond_tr_1', stock_id: 'bond_kr_2y', is_buyer: false, price: 99.8, size: 10, created_at: new Date().toISOString() },
              ],
              error: null,
            }),
            { status: 200 }
          );
        }
        if (parsed.tableName === 'stocks') {
          return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
        }
        if (parsed.tableName === 'options_contracts') {
          const idVal = parsed.query?.filters?.find((f: any) => f.col === 'id' && f.op === 'eq')?.val;
          const optRow = idVal === 'opt_c_720' ? { ticker: 'IDX-K200-C260.0', multiplier: 250000 } : null;
          return new Response(JSON.stringify({ data: optRow, error: null }), { status: 200 });
        }
        if (parsed.tableName === 'bonds') {
          const idVal = parsed.query?.filters?.find((f: any) => f.col === 'id' && f.op === 'eq')?.val;
          const bondRow = idVal === 'bond_kr_2y' ? { name: '한국 국고채 2년', ticker: 'KR_GVT_2Y', face_value: 10000, quote_base: 100, current_price: 99.8 } : null;
          return new Response(JSON.stringify({ data: bondRow, error: null }), { status: 200 });
        }
      }
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }) as typeof fetch;

    await renderWithProviders(root, <TradeNotifier />, {
      status: 'authenticated',
      data: { user: { id: 'notif_user', name: 'N', email: 'n@test.local' } },
    });
    await flushUi(2700);
    const toastText = dom.window.document.body.textContent || '';
    assert.equal(toastText.includes('IDX-K200-C260.0 3계약 매수 체결'), true, `Option trade notification must show ticker+계약, got "${toastText}"`);
    assert.equal(toastText.includes('한국 국고채 2년 10좌 매도 체결'), true, `Bond trade notification must show bond name+좌, got "${toastText}"`);
    assert.equal(toastText.includes('주식 3주'), false);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
    globalThis.fetch = originalFetch;
    setBrowserClient(null);
    if (originalDisableGuest === undefined) delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
    else process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = originalDisableGuest;
  }

  console.log('  ✓ P3 & 성능 통과');
}

async function main() {
  console.log('================================================================');
  console.log('  2026-11-23 전체 재리뷰 결함 수정 회귀 테스트');
  console.log('================================================================\n');

  try {
    await loadTestModules();
    await ensureLocalStandaloneReady();
    getLocalStandaloneEngine()?.stop();
    await testP1Admin33StocksDelistAndLegacyCompat();
    await testP1OptionLpLiabilityNettingAndExpiry();
    await testP2UiLogoutAccountSwitchAndStaleIgnore();
    await testP2LegacyProfileLookupUpdateLockAndIsolation();
    await testP2PlayerEventCatchMarginDebtRollback();
    await testP2EtfSameBatchABAReselection();
    await testP3AndPerformanceFixes();

    console.log('\n================================================================');
    console.log('  ✅ 재리뷰 결함 수정 전체 회귀 테스트 통과!');
    console.log('================================================================');
  } finally {
    stopLocalStandaloneEngine();
    dom.window.close();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
