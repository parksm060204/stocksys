/**
 * scripts/test-r2-01-to-07-fixes.tsx
 *
 * R2-01 ~ R2-07 전체 회귀 및 통합 검증 스위트.
 * - 별도 임시 STOCKSYS_DATA_DIR / ENGINE_SERVER_DATA_DIR 및 격리된 MemoryDatabase만 사용합니다.
 * - 운영 .data/ 또는 원격 DB를 변경하지 않습니다.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { JSDOM } from 'jsdom';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-r2-fixes-'));
const tmpDataDir = path.join(tmpRoot, 'data');
const tmpEngineDataDir = path.join(tmpRoot, 'engine-data');
const tmpEngineDistDir = path.join(tmpRoot, 'engine-dist');
fs.mkdirSync(tmpDataDir, { recursive: true });
fs.mkdirSync(tmpEngineDataDir, { recursive: true });
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
if (!('IntersectionObserver' in globalThis)) {
  (globalThis as any).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionContext } from 'next-auth/react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';

import { GUEST_USER_ID, MemoryDatabase, memoryDb } from '../lib/memoryDb/memoryStore';
import { persistenceManager } from '../lib/memoryDb/PersistenceManager';
import { CommodityMarketEngine } from '../lib/commodities/CommodityMarketEngine';
import { reserveMarginAndSubmitCommodityOrder } from '../lib/commodities/commodityLedger';
import { ensureLocalStandaloneReady, getLocalStandaloneEngine, resetStandaloneMarketAtomically, stopLocalStandaloneEngine } from '../lib/engine/localStandaloneServer';
import { POST as shopPurchasePost } from '../app/api/shop/purchase/route';
import { POST as localDbPost } from '../app/api/local-db/route';
import { submitAuthoritativeOptionOrder } from '../lib/options/optionOrderService';
import { withStockLock } from '../lib/engine/marketService';
import { computeMyPagePortfolioSummary } from '../lib/portfolio/mypageSummary';
import { getUsdFxRateFromDb } from '../lib/engine/currency';
import { setBrowserClient } from '../lib/db/client';
import ETFPage from '../app/etf/page';
import CurrencyExchangePage from '../app/exchange/page';
import V2ExchangePage from '../app/v2/exchange/page';

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

async function flushUi(ms: number = 15) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close();
        reject(new Error('Failed to allocate free port'));
        return;
      }
      const port = addr.port;
      srv.close((err) => (err ? reject(err) : resolve(port)));
    });
  });
}

async function testR201CommodityResetReconcile(): Promise<void> {
  console.log('▶ [R2-01] 시장 초기화 후 원자재 구주문 잔존·반복 실패 및 영속 롤백 검증');

  // 1. 별도 MemoryDatabase + 기본 50봇 엔진
  const db = new MemoryDatabase();
  const user = db.ensureUserProfile('r201_user', { cash: 100_000_000 });
  const engine = new CommodityMarketEngine({ totalBots: 50, db });
  await engine.reconcileWithDatabase(db);

  const crudeOil = engine.getCommodity('CRUDE_OIL')!;
  assert.ok(crudeOil, 'CRUDE_OIL definition must exist');

  const submitRes = await reserveMarginAndSubmitCommodityOrder({
    db,
    commodity: crudeOil,
    userId: user.id,
    side: 'buy',
    type: 'limit',
    price: 1_000_000,
    size: 1,
    submitToEngine: () =>
      engine.submitUserOrder({
        commodityId: 'CRUDE_OIL',
        userId: user.id,
        side: 'buy',
        type: 'limit',
        price: 1_000_000,
        size: 1,
      }),
    rollbackFromEngine: (oid) => engine.removeUserOrder('CRUDE_OIL', oid),
    runWithEngineLock: (fn) => engine.runWithTickLock(fn),
  });
  assert.equal(submitRes.success, true, 'Initial CRUDE_OIL order must succeed');
  assert.equal(db.commodityOpenOrders.size, 1);

  // 2. 초기화 전 스냅샷 보관 (정상 restart 복원 회귀용)
  const preResetSnapshot = db.exportSnapshot();

  // 3. 동일 DB 객체 초기화 -> 동일 DB/엔진 reconcile -> 2회 이상 stepTickAsync 모두 성공
  db.resetToSeedData();
  assert.equal(db.commodityOpenOrders.size, 0);
  assert.equal(db.commodityMarginReservations.size, 0);

  await engine.reconcileWithDatabase(db);
  assert.equal(engine.currentTick, 0, 'Tick counter must reset to 0 after resetToSeedData');
  assert.equal(
    engine.getOrderBook('CRUDE_OIL')!.bids.some((o) => o.id === submitRes.order!.id),
    false,
    'Old user order must be purged from commodity orderbook'
  );

  await engine.stepTickAsync();
  await engine.stepTickAsync();
  assert.equal(engine.currentTick, 2, 'Two ticks after reset must complete cleanly');
  assert.equal(db.commodityOpenOrders.size, 0, 'No old open orders may reappear');
  assert.equal(db.commodityMarginReservations.size, 0, 'No old reservations may reappear');

  // 4. 스냅샷 import 복원은 reset과 구분되어 미체결 주문을 정상 복원
  const restartDb = new MemoryDatabase();
  restartDb.importSnapshot(preResetSnapshot);
  const restartEngine = new CommodityMarketEngine({ totalBots: 50, db: restartDb });
  await restartEngine.reconcileWithDatabase(restartDb);
  assert.equal(
    restartEngine.getOrderBook('CRUDE_OIL')!.bids.some((o) => o.id === submitRes.order!.id),
    true,
    'Normal restart importSnapshot must preserve open orders'
  );

  // 5. 글로벌 memoryDb 관리자 reset_market + 영속 실패 시 원복 + 성공 시 원자재 엔진 동시 초기화
  memoryDb.resetToSeedData();
  const globalCommEngine = new CommodityMarketEngine({ totalBots: 50, db: memoryDb });
  await globalCommEngine.reconcileWithDatabase(memoryDb);
  const guest = memoryDb.ensureUserProfile(GUEST_USER_ID, { cash: 100_000_000, is_admin: true });
  guest.cash = 100_000_000;
  guest.is_admin = true;

  // 1틱 진행 후 비-마켓메이커 봇 휴면 주문 등록 (롤백 후 다음 틱에서 재조정으로 삭제되지 않는지 검증용)
  await globalCommEngine.stepTickAsync();
  const nonMmBot = globalCommEngine.bots.find((b) => b.type !== 'market_maker');
  assert.ok(nonMmBot, 'Non-MM commodity bot must exist');
  const restingBotOrderId = `test_resting_bot_ord_${globalCommEngine.currentTick}`;
  const restingAdded = globalCommEngine.getOrderBook('CRUDE_OIL')!.addOrder({
    id: restingBotOrderId,
    commodityId: 'CRUDE_OIL',
    botId: nonMmBot.id,
    side: 'buy',
    type: 'limit',
    price: 10,
    size: 1,
    filled: 0,
    createdAtTick: globalCommEngine.currentTick,
    createdAtTime: globalCommEngine.clock.now(),
  });
  assert.equal(restingAdded, true, 'Resting non-MM bot order must be registered');

  const globalSubmit = await reserveMarginAndSubmitCommodityOrder({
    db: memoryDb,
    commodity: globalCommEngine.getCommodity('CRUDE_OIL')!,
    userId: GUEST_USER_ID,
    side: 'buy',
    type: 'limit',
    price: 10,
    size: 1,
    submitToEngine: () =>
      globalCommEngine.submitUserOrder({
        commodityId: 'CRUDE_OIL',
        userId: GUEST_USER_ID,
        side: 'buy',
        type: 'limit',
        price: 10,
        size: 1,
      }),
    rollbackFromEngine: (oid) => globalCommEngine.removeUserOrder('CRUDE_OIL', oid),
    runWithEngineLock: (fn) => globalCommEngine.runWithTickLock(fn),
  });
  assert.equal(globalSubmit.success, true, globalSubmit.message);

  const preResetSnapshotVersion = memoryDb.commoditySnapshotVersion;
  const preResetVersion = memoryDb.commodityResetVersion;
  const preScenarioResetVersion = memoryDb.scenarioResetVersion;
  const preNextEpoch = memoryDb.commodityNextEpoch;
  const preRecMeta = globalCommEngine.getReconcileMetadata();

  // 영속 실패(false 반환) 시 DB 버전·엔진 버전·오더북 롤백 확인
  const failResetOk = await resetStandaloneMarketAtomically(async () => false);
  assert.equal(failResetOk, false, 'Reset must fail cleanly when persistence fails');
  assert.equal(memoryDb.commoditySnapshotVersion, preResetSnapshotVersion, 'DB commoditySnapshotVersion must roll back on false');
  assert.equal(memoryDb.commodityResetVersion, preResetVersion, 'DB commodityResetVersion must roll back on false');
  assert.equal(memoryDb.scenarioResetVersion, preScenarioResetVersion, 'DB scenarioResetVersion must roll back on false');
  assert.deepEqual(
    globalCommEngine.getReconcileMetadata(),
    preRecMeta,
    'Engine reconcile metadata must roll back on false'
  );
  assert.equal(memoryDb.commodityOpenOrders.has(globalSubmit.order!.id), true, 'Failed reset must restore DB open orders');
  assert.equal(
    globalCommEngine.getOrderBook('CRUDE_OIL')!.bids.some((o) => o.id === globalSubmit.order!.id),
    true,
    'Failed reset must restore commodity orderbook'
  );

  // 영속 예외(throw) 시에도 DB 버전·엔진 버전·오더북 롤백 확인
  await assert.rejects(
    () =>
      resetStandaloneMarketAtomically(async () => {
        throw new Error('Injected reset persist exception');
      }),
    /Injected reset persist exception/
  );
  assert.equal(memoryDb.commoditySnapshotVersion, preResetSnapshotVersion, 'DB commoditySnapshotVersion must roll back on throw');
  assert.equal(memoryDb.commodityResetVersion, preResetVersion, 'DB commodityResetVersion must roll back on throw');
  assert.equal(memoryDb.scenarioResetVersion, preScenarioResetVersion, 'DB scenarioResetVersion must roll back on throw');
  assert.deepEqual(
    globalCommEngine.getReconcileMetadata(),
    preRecMeta,
    'Engine reconcile metadata must roll back on throw'
  );
  assert.equal(memoryDb.commodityOpenOrders.has(globalSubmit.order!.id), true, 'Thrown reset must restore DB open orders');
  assert.equal(
    globalCommEngine.getOrderBook('CRUDE_OIL')!.bids.some((o) => o.id === restingBotOrderId),
    true,
    'Thrown reset must preserve resting non-MM bot order'
  );

  // 롤백 직후 다음 틱에서 추가 재조정 및 봇 휴면 주문 삭제가 발생하지 않는지 검증
  let extraReconcileCalls = 0;
  const origReconcile = globalCommEngine.reconcileWithDatabase.bind(globalCommEngine);
  globalCommEngine.reconcileWithDatabase = async (dbArg: MemoryDatabase) => {
    extraReconcileCalls += 1;
    return origReconcile(dbArg);
  };
  try {
    await globalCommEngine.stepTickAsync();
  } finally {
    globalCommEngine.reconcileWithDatabase = origReconcile;
  }
  assert.equal(extraReconcileCalls, 0, 'Next tick after failed reset rollback must not trigger extra reconcileWithDatabase');
  assert.equal(memoryDb.commodityNextEpoch, preNextEpoch, 'Next tick after rollback must not bump commodityNextEpoch');
  assert.equal(
    globalCommEngine.getOrderBook('CRUDE_OIL')!.bids.some((o) => o.id === restingBotOrderId),
    true,
    'Resting non-MM bot order must survive next tick after failed reset rollback'
  );

  assert.equal(memoryDb.commodityOpenOrders.has(globalSubmit.order!.id), true, 'Open user order must remain before admin reset');

  await ensureLocalStandaloneReady();
  getLocalStandaloneEngine()?.stop();

  // 실제 관리자 reset_market 핸들러 성공 경로
  const prevDevAdmin = process.env.ALLOW_DEV_ADMIN;
  process.env.ALLOW_DEV_ADMIN = 'true';
  try {
    const resetRes = await localDbPost(
      new Request('http://localhost:3000/api/local-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reset_market' }),
      })
    );
    assert.equal(resetRes.status, 200, 'Admin reset_market must succeed');
  } finally {
    if (prevDevAdmin === undefined) delete process.env.ALLOW_DEV_ADMIN;
    else process.env.ALLOW_DEV_ADMIN = prevDevAdmin;
  }

  assert.equal(memoryDb.commodityOpenOrders.size, 0, 'Global DB open orders cleared after admin reset');
  assert.equal(
    globalCommEngine.getOrderBook('CRUDE_OIL')!.bids.some((o) => o.id === globalSubmit.order!.id),
    false,
    'Attached CommodityMarketEngine must clear old order on admin reset'
  );
  await globalCommEngine.stepTickAsync();
  await globalCommEngine.stepTickAsync();
  assert.equal(globalCommEngine.currentTick, 2);

  console.log('  ✓ R2-01 통과');
}

async function testR202ShopPurchasePrototypeAndRollback(): Promise<void> {
  console.log('▶ [R2-02] 상점 상속 속성 상품ID 차단 및 영속 실패·예외 트랜잭션 롤백 검증');

  memoryDb.resetToSeedData();
  const profile = memoryDb.ensureUserProfile(GUEST_USER_ID, { cash: 100_000_000 });
  profile.cash = 100_000_000;
  profile.has_options_license = false;
  profile.unlocked_features = [] as string[];
  profile.feature_expiries = {};
  profile.news_subscriptions = {};

  // 1. 상속 속성 및 변형 payload 모두 4xx + 현금 불변·유한값·권한 불변
  for (const badProductId of ['__proto__', 'constructor', 'toString', 'valueOf', 'hasOwnProperty', '', null, 123]) {
    const res = await shopPurchasePost(
      new Request('http://localhost:3000/api/shop/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemType: 'product', productId: badProductId }),
      })
    );
    assert.ok(res.status >= 400 && res.status < 500, `Expected 4xx for productId=${String(badProductId)}, got ${res.status}`);
    assert.equal(Number.isFinite(profile.cash), true, 'Cash must remain finite');
    assert.equal(profile.cash, 100_000_000, 'Cash must remain unchanged');
    assert.equal(profile.has_options_license, false);
    assert.deepEqual(profile.unlocked_features, []);
  }

  // 뉴스 구독 타입 위조 차단 (Number(true) === 1 방어)
  const badSubRes = await shopPurchasePost(
    new Request('http://localhost:3000/api/shop/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemType: 'news_subscription', outletId: true, days: 30 }),
    })
  );
  assert.ok(badSubRes.status >= 400 && badSubRes.status < 500, `Expected 4xx for boolean outletId, got ${badSubRes.status}`);
  assert.equal(profile.cash, 100_000_000);

  // 2. 잔액 부족 400
  profile.cash = 100_000;
  const lowCashRes = await shopPurchasePost(
    new Request('http://localhost:3000/api/shop/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemType: 'product', productId: 'fee_booster' }),
    })
  );
  assert.equal(lowCashRes.status, 400);
  assert.equal(profile.cash, 100_000);
  assert.deepEqual(profile.unlocked_features, []);

  // 3. 저장 실패(false 반환) 및 중간 예외(throw) 모두 현금/권한 롤백
  profile.cash = 10_000_000;
  const origSave = persistenceManager.saveSnapshot.bind(persistenceManager);
  persistenceManager.saveSnapshot = async () => false;
  try {
    const saveFailRes = await shopPurchasePost(
      new Request('http://localhost:3000/api/shop/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemType: 'product', productId: 'fee_booster' }),
      })
    );
    assert.equal(saveFailRes.status, 500);
    assert.equal(profile.cash, 10_000_000, 'Cash must roll back when saveSnapshot returns false');
    assert.deepEqual(profile.unlocked_features, [], 'Unlocked features must roll back on save failure');
    assert.deepEqual(profile.feature_expiries, {}, 'Expiries must roll back on save failure');
  } finally {
    persistenceManager.saveSnapshot = origSave;
  }

  persistenceManager.saveSnapshot = async () => {
    throw new Error('Disk write error injected');
  };
  try {
    const throwRes = await shopPurchasePost(
      new Request('http://localhost:3000/api/shop/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemType: 'product', productId: 'options_license' }),
      })
    );
    assert.equal(throwRes.status, 500);
    assert.equal(profile.cash, 10_000_000, 'Cash must roll back when saveSnapshot throws');
    assert.equal(profile.has_options_license, false, 'Options license must roll back when saveSnapshot throws');
  } finally {
    persistenceManager.saveSnapshot = origSave;
  }

  // 4. 정상 구매 성공
  const okRes = await shopPurchasePost(
    new Request('http://localhost:3000/api/shop/purchase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemType: 'product', productId: 'fee_booster' }),
    })
  );
  assert.equal(okRes.status, 200);
  const okJson = await okRes.json();
  assert.equal(okJson.success, true);
  assert.equal(profile.cash, 9_000_000);
  assert.equal((okJson.unlocked_features as string[])?.includes('fee_booster'), true);
  assert.equal((profile.unlocked_features as string[] | undefined)?.includes('fee_booster'), true);

  console.log('  ✓ R2-02 통과');
}

async function testR203EtfSelectionRace(): Promise<void> {
  console.log('▶ [R2-03] ETF 전환 로딩 중 오주문 차단·지연 응답 방어·매수/매도 검증');

  const originalFetch = globalThis.fetch;
  const originalDisableGuest = process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  setBrowserClient(null);
  process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'true';

  const submittedOrders: Array<{ stock_id: string; side: string; price: number; size: number }> = [];
  let spyDeferred: ReturnType<typeof createDeferred<Response>> | null = null;
  let kodexSlowDeferred: ReturnType<typeof createDeferred<Response>> | null = null;
  let orderbookDeferred: ReturnType<typeof createDeferred<Response>> | null = null;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === '/api/orders' && init?.body) {
      const payload = JSON.parse(String(init.body));
      submittedOrders.push(payload);
      return new Response(JSON.stringify({ success: true, message: 'OK' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === '/api/local-db' && init?.body) {
      const parsed = JSON.parse(String(init.body));
      if (parsed.action === 'rpc' && parsed.fnName === 'get_authoritative_orderbook') {
        if (orderbookDeferred) {
          return await orderbookDeferred.promise;
        }
        return new Response(JSON.stringify({ data: { bids: [], asks: [] }, error: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (parsed.tableName === 'exchange_rates') {
        return new Response(JSON.stringify({ data: { currency_code: 'USD', rate_to_krw: 1400 }, error: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (parsed.tableName === 'profiles') {
        return new Response(JSON.stringify({ data: { cash: 50_000_000 }, error: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (parsed.tableName === 'holdings') {
        return new Response(JSON.stringify({ data: { quantity: 20 }, error: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
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
            { status: 200, headers: { 'Content-Type': 'application/json' } }
          );
        }
        if (tickerFilter.val === 'SPY' && spyDeferred) {
          return await spyDeferred.promise;
        }
        if (tickerFilter.val === 'KODEX200' && kodexSlowDeferred) {
          return await kodexSlowDeferred.promise;
        }
        const row =
          tickerFilter.val === 'SPY'
            ? { id: 'etf_SPY', ticker: 'SPY', current_price: 500 }
            : { id: 'etf_KODEX200', ticker: 'KODEX200', current_price: 35000 };
        return new Response(JSON.stringify({ data: row, error: null }), {
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

  const clickEtfCard = async (ticker: string) => {
    const spans = Array.from(container.querySelectorAll('span'));
    const targetSpan = spans.find((s) => s.textContent?.trim() === ticker);
    assert.ok(targetSpan, `ETF card for ${ticker} must exist`);
    let card: HTMLElement | null = targetSpan.parentElement;
    while (card && !card.className.includes('cursor-pointer')) {
      card = card.parentElement;
    }
    assert.ok(card, `Clickable card container for ${ticker} must exist`);
    await act(async () => {
      card!.click();
    });
  };

  const getOrderButton = (labelFragment: string): HTMLButtonElement => {
    const btns = Array.from(container.querySelectorAll('button'));
    const btn = btns.find((b) => b.textContent?.includes(labelFragment));
    assert.ok(btn, `Button containing "${labelFragment}" must exist`);
    return btn as HTMLButtonElement;
  };

  try {
    await act(async () => {
      root.render(
        <AppRouterContext.Provider value={makeMockRouter() as any}>
          <SessionContext.Provider
            value={{
              status: 'authenticated',
              data: { user: { id: 'etf_user_1', name: 'ETF Tester', email: 'etf@test.local' } },
              update: async () => null,
            } as any}
          >
            <ETFPage />
          </SessionContext.Provider>
        </AppRouterContext.Provider>
      );
    });
    await flushUi();

    // 1. KODEX200 로드 후 매수 -> etf_KODEX200 / 35000 확인
    const buyBtnInitial = getOrderButton('BUY');
    assert.equal(buyBtnInitial.disabled, false);
    await act(async () => {
      buyBtnInitial.click();
    });
    await flushUi();
    assert.equal(submittedOrders.length, 1);
    assert.equal(submittedOrders[0].stock_id, 'etf_KODEX200');
    assert.equal(submittedOrders[0].price, 35000);

    // 2. SPY로 전환하되 SPY 응답을 Promise로 보류 -> BUY/SELL 모두 비활성 & 클릭해도 전송 0건
    spyDeferred = createDeferred<Response>();
    await clickEtfCard('SPY');
    await flushUi(5);

    const buyWhilePending = getOrderButton('BUY');
    const sellWhilePending = getOrderButton('SELL');
    assert.equal(buyWhilePending.disabled, true, 'BUY button must be disabled while SPY is loading');
    assert.equal(sellWhilePending.disabled, true, 'SELL button must be disabled while SPY is loading');
    await act(async () => {
      buyWhilePending.click();
      sellWhilePending.click();
    });
    await flushUi(5);
    assert.equal(submittedOrders.length, 1, 'No order may be sent while SPY stock response is pending');

    // 3. SPY 응답 완료 후 -> BUY/SELL 모두 SPY ID/가격으로만 전송
    spyDeferred.resolve(
      new Response(JSON.stringify({ data: { id: 'etf_SPY', ticker: 'SPY', current_price: 500 }, error: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    spyDeferred = null;
    await flushUi();

    const buyAfterSpy = getOrderButton('BUY');
    const sellAfterSpy = getOrderButton('SELL');
    assert.equal(buyAfterSpy.disabled, false);
    await act(async () => {
      buyAfterSpy.click();
    });
    await flushUi();
    await act(async () => {
      sellAfterSpy.click();
    });
    await flushUi();

    assert.equal(submittedOrders.length, 3);
    assert.deepEqual(
      { stock_id: submittedOrders[1].stock_id, side: submittedOrders[1].side, price: submittedOrders[1].price },
      { stock_id: 'etf_SPY', side: 'buy', price: 500 }
    );
    assert.deepEqual(
      { stock_id: submittedOrders[2].stock_id, side: submittedOrders[2].side, price: submittedOrders[2].price },
      { stock_id: 'etf_SPY', side: 'sell', price: 500 }
    );

    // 4. 빠른 재선택 지연 응답 경합: KODEX200(지연) -> SPY(즉시 완료) -> KODEX200 늦게 도착해도 SPY 유지
    kodexSlowDeferred = createDeferred<Response>();
    await clickEtfCard('KODEX200');
    await flushUi(5);
    await clickEtfCard('SPY');
    await flushUi();

    kodexSlowDeferred.resolve(
      new Response(JSON.stringify({ data: { id: 'etf_KODEX200', ticker: 'KODEX200', current_price: 35000 }, error: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    kodexSlowDeferred = null;
    await flushUi();

    await act(async () => {
      getOrderButton('BUY').click();
    });
    await flushUi();
    assert.equal(submittedOrders[submittedOrders.length - 1].stock_id, 'etf_SPY', 'Late KODEX200 response must not overwrite SPY');
    assert.equal(submittedOrders[submittedOrders.length - 1].price, 500);

    // 5. 동일 ETF/계정에서 주문 진행(orderbook RPC 대기) 중 수동/주기적 동기화가 겹쳐도 주문은 정확히 1번 제출
    const countBeforeOverlap = submittedOrders.length;
    orderbookDeferred = createDeferred<Response>();
    await act(async () => {
      getOrderButton('BUY').click();
    });
    await flushUi(5);

    const syncButton = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('서버 시세 동기화')
    );
    assert.ok(syncButton, 'Manual sync button must exist');
    await act(async () => {
      syncButton.click();
    });
    await flushUi();
    await act(async () => {
      syncButton.click();
    });
    await flushUi();

    orderbookDeferred.resolve(
      new Response(JSON.stringify({ data: { bids: [], asks: [{ price: 505 }] }, error: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    orderbookDeferred = null;
    await flushUi();
    assert.equal(
      submittedOrders.length,
      countBeforeOverlap + 1,
      'Overlapping same-ETF/same-account sync must still submit the in-flight order exactly once'
    );
    assert.deepEqual(
      {
        stock_id: submittedOrders[submittedOrders.length - 1].stock_id,
        side: submittedOrders[submittedOrders.length - 1].side,
        price: submittedOrders[submittedOrders.length - 1].price,
      },
      { stock_id: 'etf_SPY', side: 'buy', price: 505 }
    );

    // 6. 주문 대기 중 실제 종목 전환(SPY -> KODEX200 -> SPY 왕복 포함) 시 오래된 주문은 전송되지 않아야 함
    const countBeforeSwitchAbort = submittedOrders.length;
    orderbookDeferred = createDeferred<Response>();
    await act(async () => {
      getOrderButton('BUY').click();
    });
    await flushUi(5);
    await clickEtfCard('KODEX200');
    await clickEtfCard('SPY');
    await flushUi();

    orderbookDeferred.resolve(
      new Response(JSON.stringify({ data: { bids: [], asks: [{ price: 510 }] }, error: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    orderbookDeferred = null;
    await flushUi();
    assert.equal(
      submittedOrders.length,
      countBeforeSwitchAbort,
      'Stale order must not be submitted after an ETF switch (even if switched back)'
    );

    // 7. 주문 대기 중 계정 전환(etf_user_1 -> etf_user_2) 및 로그아웃 시 오래된 주문 차단
    const countBeforeAccountSwitch = submittedOrders.length;
    orderbookDeferred = createDeferred<Response>();
    await act(async () => {
      getOrderButton('BUY').click();
    });
    await flushUi(5);

    await act(async () => {
      root.render(
        <AppRouterContext.Provider value={makeMockRouter() as any}>
          <SessionContext.Provider
            value={{
              status: 'authenticated',
              data: { user: { id: 'etf_user_2', name: 'ETF Tester 2', email: 'etf2@test.local' } },
              update: async () => null,
            } as any}
          >
            <ETFPage />
          </SessionContext.Provider>
        </AppRouterContext.Provider>
      );
    });
    await flushUi();

    orderbookDeferred.resolve(
      new Response(JSON.stringify({ data: { bids: [], asks: [{ price: 515 }] }, error: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    orderbookDeferred = null;
    await flushUi();
    assert.equal(
      submittedOrders.length,
      countBeforeAccountSwitch,
      'Stale order from previous account must not be submitted after account switch'
    );

    // 로그아웃 전환 시에도 진행 중 주문 차단
    const countBeforeLogout = submittedOrders.length;
    orderbookDeferred = createDeferred<Response>();
    await act(async () => {
      getOrderButton('BUY').click();
    });
    await flushUi(5);

    await act(async () => {
      root.render(
        <AppRouterContext.Provider value={makeMockRouter() as any}>
          <SessionContext.Provider
            value={{
              status: 'unauthenticated',
              data: null,
              update: async () => null,
            } as any}
          >
            <ETFPage />
          </SessionContext.Provider>
        </AppRouterContext.Provider>
      );
    });
    await flushUi();

    orderbookDeferred.resolve(
      new Response(JSON.stringify({ data: { bids: [], asks: [{ price: 520 }] }, error: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    orderbookDeferred = null;
    await flushUi();
    assert.equal(
      submittedOrders.length,
      countBeforeLogout,
      'Stale order must not be submitted after logout'
    );
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    globalThis.fetch = originalFetch;
    setBrowserClient(null);
    if (originalDisableGuest === undefined) delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
    else process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = originalDisableGuest;
  }

  console.log('  ✓ R2-03 통과');
}

async function testR204OptionExpiryDuringLockWait(): Promise<void> {
  console.log('▶ [R2-04] 종목 락 대기 중 만기된 옵션 주문 commitGate 거절 및 자산 불변 검증');

  const db = new MemoryDatabase();
  const user = db.ensureUserProfile('r204_opt_user', { cash: 50_000_000 });
  user.has_options_license = true;

  const contract = Array.from(db.optionsContracts.values())[0];
  assert.ok(contract, 'Seed option contract must exist');

  const t0 = 1_800_000_000_000;
  contract.expiry_date = new Date(t0 + 1000).toISOString();
  contract.current_price = 2.5;

  const originalDateNow = Date.now;
  let fakeNow = t0;
  Date.now = () => fakeNow;

  try {
    const lockEntered = createDeferred<void>();
    const releaseLock = createDeferred<void>();
    const lockHolder = withStockLock(contract.id, async () => {
      lockEntered.resolve();
      await releaseLock.promise;
    });

    await lockEntered.promise;

    const cashBefore = user.cash;
    const holdingsBefore = db.holdings.size;
    const ordersBefore = db.orders.size;
    const lpLiabBefore = db.lpLiabilities.size;

    const orderPromise = submitAuthoritativeOptionOrder({
      db,
      userId: user.id,
      contractId: contract.id,
      side: 'BUY',
      orderType: 'MARKET',
      qty: 1,
    });

    // 락 대기 중에 시간만 만기 후(+2초)로 전진 (계약 날짜는 변경하지 않음)
    await new Promise((r) => setTimeout(r, 10));
    fakeNow = t0 + 2000;
    releaseLock.resolve();

    const [, orderRes] = await Promise.all([lockHolder, orderPromise]);
    assert.equal(orderRes.success, false, 'Option order must fail when contract expires while waiting on lock');
    assert.ok(orderRes.statusCode >= 400 && orderRes.statusCode < 500, `Expected 4xx, got ${orderRes.statusCode}`);
    assert.equal(user.cash, cashBefore, 'Cash must remain unchanged');
    assert.equal(db.holdings.size, holdingsBefore, 'Holdings must remain unchanged');
    assert.equal(db.orders.size, ordersBefore, 'Orders must remain unchanged');
    assert.equal(db.lpLiabilities.size, lpLiabBefore, 'LP liabilities must remain unchanged');

    // 정상(만기 전) 주문은 여전히 성공
    fakeNow = t0;
    const okRes = await submitAuthoritativeOptionOrder({
      db,
      userId: user.id,
      contractId: contract.id,
      side: 'BUY',
      orderType: 'MARKET',
      qty: 1,
      now: () => fakeNow,
    });
    assert.equal(okRes.success, true, 'Non-expired option order must still succeed');
    assert.equal(okRes.statusCode, 200);
    assert.equal(db.holdings.get(`${user.id}_${contract.id}`)?.quantity, 1);
  } finally {
    Date.now = originalDateNow;
  }

  console.log('  ✓ R2-04 통과');
}

async function testR205EngineServerBuildAndStart(): Promise<void> {
  console.log('▶ [R2-05] 독립 engine-server 실제 tsc 빌드 + alias rewrite + 일반 Node 기동/health 검증');

  const tscBin = path.resolve(process.cwd(), 'node_modules', 'typescript', 'bin', 'tsc');
  const rewriteBin = path.resolve(process.cwd(), 'engine-server', 'scripts', 'rewrite-aliases.mjs');
  const engineTsconfig = path.resolve(process.cwd(), 'engine-server', 'tsconfig.json');

  execFileSync(process.execPath, [tscBin, '-p', engineTsconfig, '--outDir', tmpEngineDistDir], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });
  execFileSync(process.execPath, [rewriteBin, tmpEngineDistDir], {
    cwd: process.cwd(),
    stdio: 'pipe',
  });

  const entryJs = path.join(tmpEngineDistDir, 'engine-server', 'src', 'index.js');
  assert.equal(fs.existsSync(entryJs), true, 'Compiled engine-server/src/index.js must exist');

  // 컴파일된 JS에 미해석 require("@/...")가 남아있지 않은지 확인
  const checkLedgerJs = fs.readFileSync(path.join(tmpEngineDistDir, 'lib', 'commodities', 'commodityLedger.js'), 'utf8');
  assert.equal(checkLedgerJs.includes('require("@/') || checkLedgerJs.includes("require('@/"), false, 'All @/ imports must be rewritten');

  const port = await getFreePort();
  const child = spawn(process.execPath, [entryJs], {
    cwd: path.resolve(process.cwd(), 'engine-server'),
    env: {
      ...process.env,
      PORT: String(port),
      ENGINE_SERVER_DATA_DIR: tmpEngineDataDir,
      NODE_PATH: [
        path.resolve(process.cwd(), 'node_modules'),
        path.resolve(process.cwd(), 'engine-server', 'node_modules'),
      ].join(path.delimiter),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutBuf = '';
  let stderrBuf = '';
  child.stdout?.on('data', (chunk) => {
    stdoutBuf += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    stderrBuf += String(chunk);
  });

  try {
    let healthStatus = 0;
    let healthBody = '';
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) {
        throw new Error(`engine-server exited prematurely (code=${child.exitCode})\nSTDOUT:\n${stdoutBuf}\nSTDERR:\n${stderrBuf}`);
      }
      try {
        const res = await fetch(`http://127.0.0.1:${port}/`);
        healthStatus = res.status;
        healthBody = await res.text();
        if (healthStatus === 200) break;
      } catch {
        // retry until listening
      }
      await new Promise((r) => setTimeout(r, 150));
    }

    assert.equal(healthStatus, 200, `Expected HTTP 200 healthcheck, got ${healthStatus}. STDERR: ${stderrBuf}`);
    assert.ok(healthBody.includes('STOCKSYS Market Engine is running'), `Unexpected health body: ${healthBody}`);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL');
          resolve();
        }, 3000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  console.log('  ✓ R2-05 통과');
}

function testR206MyPageUsdRate(): void {
  console.log('▶ [R2-06] 마이페이지 USD 평가 환율(2000원) 및 국내 자산 분리 계산 검증');

  const ratesData = [{ currency_code: 'USD', rate_to_krw: 2000 }];
  assert.equal(getUsdFxRateFromDb({ exchangeRates: ratesData }), 2000);
  assert.equal(getUsdFxRateFromDb({ exchangeRates: [] }), 1380);

  const summary = computeMyPagePortfolioSummary({
    profile: {
      cash: 1_000_000,
      usd_balance: 100,
      eur_balance: 0,
      jpy_balance: 0,
      cny_balance: 0,
      gbp_balance: 0,
      margin_debt_krw: 0,
    },
    holdingsData: [
      {
        stock_id: 'us_aapl',
        quantity: 1,
        avg_price: 80,
        stocks: { id: 'us_aapl', ticker: 'AAPL', name: '파인애플', market: 'overseas', current_price: 100 },
      },
      {
        stock_id: 'etf_spy',
        quantity: 1,
        avg_price: 90,
        stocks: { id: 'etf_spy', ticker: 'SPY', name: 'SPDR S&P 500', market: 'etf', current_price: 100 },
      },
      {
        stock_id: 'kr_005930',
        quantity: 2,
        avg_price: 70000,
        stocks: { id: 'kr_005930', ticker: '005930', name: '삼성전자', market: 'domestic', current_price: 75000 },
      },
    ],
    ratesData,
    optionsContractsData: [],
    bondsData: [],
  });

  assert.equal(summary.usdToKrw, 2000);
  const aaplRow = summary.rows.find((r) => r.ticker === 'AAPL')!;
  const spyRow = summary.rows.find((r) => r.ticker === 'SPY')!;
  const krRow = summary.rows.find((r) => r.ticker === '005930')!;

  assert.equal(aaplRow.valueKrw, 200_000, '$100 US stock must evaluate to ₩200,000 (not ₩138,000)');
  assert.equal(aaplRow.costKrw, 160_000);
  assert.equal(aaplRow.pnlKrw, 40_000);

  assert.equal(spyRow.valueKrw, 200_000, '$100 USD ETF must evaluate to ₩200,000 (not ₩138,000)');
  assert.equal(spyRow.pnlKrw, 20_000);

  assert.equal(krRow.valueKrw, 150_000, 'Domestic KRW stock must stay 1:1 KRW');
  assert.equal(summary.usdInKrw, 200_000, '$100 USD cash must use same 2000 rate');
  assert.equal(summary.totalValue, 550_000);
  assert.equal(summary.totalPnl, 70_000);
  assert.equal(summary.totalAssetsKrw, 1_750_000);

  console.log('  ✓ R2-06 통과');
}

async function testR207ExchangeLogoutAndAccountSwitch(): Promise<void> {
  console.log('▶ [R2-07] 환전 화면 로그아웃 초기화·계정전환 지연 응답 경합·V2 래퍼 검증');

  const originalFetch = globalThis.fetch;
  const originalDisableGuest = process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  setBrowserClient(null);
  process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'true';

  let profileResponder: (uid: string | undefined) => Promise<Response> = async () =>
    new Response(JSON.stringify({ data: null, error: null }), { status: 200 });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === '/api/local-db' && init?.body) {
      const parsed = JSON.parse(String(init.body));
      if (parsed.tableName === 'exchange_rates') {
        return new Response(
          JSON.stringify({
            data: [{ currency_code: 'USD', currency_name: '미국 달러', rate_to_krw: 1400, updated_at: '' }],
            error: null,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (parsed.tableName === 'profiles') {
        const eqFilter = parsed.query?.filters?.find((f: any) => f.col === 'id' && f.op === 'eq');
        return await profileResponder(eqFilter?.val);
      }
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
  }) as typeof fetch;

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  const renderExchange = async (
    Component: React.ComponentType,
    sessionState: { status: 'authenticated' | 'unauthenticated'; data: any }
  ) => {
    await act(async () => {
      root.render(
        <AppRouterContext.Provider value={makeMockRouter() as any}>
          <SessionContext.Provider value={{ ...sessionState, update: async () => null } as any}>
            <Component />
          </SessionContext.Provider>
        </AppRouterContext.Provider>
      );
    });
  };

  try {
    // 1. 로그인 후 User A 잔액(123,456,789) 표시 -> 로그아웃 시 즉시 미표시
    profileResponder = async (uid) =>
      new Response(
        JSON.stringify({
          data: {
            id: uid,
            cash: 123_456_789,
            usd_balance: 500,
            eur_balance: 0,
            jpy_balance: 0,
            cny_balance: 0,
            gbp_balance: 0,
          },
          error: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );

    await renderExchange(CurrencyExchangePage, {
      status: 'authenticated',
      data: { user: { id: 'ex_user_a', name: 'User A', email: 'a@test.local' } },
    });
    await flushUi();
    assert.equal(container.textContent?.includes('123,456,789'), true, 'Logged-in balance must render');

    await renderExchange(CurrencyExchangePage, {
      status: 'unauthenticated',
      data: null,
    });
    await flushUi();
    assert.equal(container.textContent?.includes('123,456,789'), false, 'Logged-out screen must not retain User A balance');

    // 2. 계정 전환 지연 응답 경합 (A 요청 보류 -> B 요청 먼저 완료 -> A 지연 응답 도착)
    const userADeferred = createDeferred<Response>();
    profileResponder = async (uid) => {
      if (uid === 'ex_user_a') return await userADeferred.promise;
      return new Response(
        JSON.stringify({
          data: {
            id: uid,
            cash: 777_000,
            usd_balance: 10,
            eur_balance: 0,
            jpy_balance: 0,
            cny_balance: 0,
            gbp_balance: 0,
          },
          error: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };

    await renderExchange(CurrencyExchangePage, {
      status: 'authenticated',
      data: { user: { id: 'ex_user_a', name: 'User A', email: 'a@test.local' } },
    });
    await flushUi(5);

    // A가 응답하기 전에 B로 전환
    await renderExchange(CurrencyExchangePage, {
      status: 'authenticated',
      data: { user: { id: 'ex_user_b', name: 'User B', email: 'b@test.local' } },
    });
    await flushUi();
    assert.equal(container.textContent?.includes('777,000'), true, 'User B balance must render');

    // 뒤늦게 A 응답 도착 -> B 화면을 덮어쓰면 안 됨
    userADeferred.resolve(
      new Response(
        JSON.stringify({
          data: {
            id: 'ex_user_a',
            cash: 123_456_789,
            usd_balance: 500,
            eur_balance: 0,
            jpy_balance: 0,
            cny_balance: 0,
            gbp_balance: 0,
          },
          error: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    await flushUi();
    assert.equal(container.textContent?.includes('777,000'), true, 'User B balance must remain after stale A response');
    assert.equal(container.textContent?.includes('123,456,789'), false, 'Stale User A balance must not overwrite User B');

    // 3. 비정상 잔액 응답(NaN/문자열) 안전 차단
    profileResponder = async (uid) =>
      new Response(
        JSON.stringify({ data: { id: uid, cash: 'invalid' }, error: null }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    await renderExchange(CurrencyExchangePage, {
      status: 'authenticated',
      data: { user: { id: 'ex_user_bad', name: 'Bad', email: 'bad@test.local' } },
    });
    await flushUi();
    assert.equal(container.textContent?.includes('NaN'), false);
    assert.equal(container.textContent?.includes('777,000'), false);

    // 4. V2ExchangePage 래퍼도 로그아웃 시 동일하게 잔액 제거
    profileResponder = async (uid) =>
      new Response(
        JSON.stringify({ data: { id: uid, cash: 99_888_777, usd_balance: 0 }, error: null }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    await renderExchange(V2ExchangePage, {
      status: 'authenticated',
      data: { user: { id: 'ex_user_v2', name: 'V2 User', email: 'v2@test.local' } },
    });
    await flushUi();
    assert.equal(container.textContent?.includes('99,888,777'), true);

    await renderExchange(V2ExchangePage, {
      status: 'unauthenticated',
      data: null,
    });
    await flushUi();
    assert.equal(container.textContent?.includes('99,888,777'), false, 'V2ExchangePage must clear balance on logout');
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    globalThis.fetch = originalFetch;
    setBrowserClient(null);
    if (originalDisableGuest === undefined) delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
    else process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = originalDisableGuest;
  }

  console.log('  ✓ R2-07 통과');
}

async function main() {
  console.log('================================================================');
  console.log('  R2-01 ~ R2-07 재리뷰 수정 회귀 테스트');
  console.log('================================================================\n');

  try {
    await testR201CommodityResetReconcile();
    await testR202ShopPurchasePrototypeAndRollback();
    await testR203EtfSelectionRace();
    await testR204OptionExpiryDuringLockWait();
    await testR205EngineServerBuildAndStart();
    testR206MyPageUsdRate();
    await testR207ExchangeLogoutAndAccountSwitch();

    console.log('\n================================================================');
    console.log('  ✅ R2-01 ~ R2-07 전체 회귀 테스트 통과!');
    console.log('================================================================');
  } finally {
    stopLocalStandaloneEngine();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
