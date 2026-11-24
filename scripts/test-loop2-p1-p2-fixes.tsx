/**
 * scripts/test-loop2-p1-p2-fixes.tsx
 *
 * 반복 디버깅 2차 P1·P2 결함 5건(B-01, B-02, B-03, R-01, R-02) 회귀 검증 스위트.
 * - 격리된 임시 STOCKSYS_DATA_DIR, 합성 계정·종목 데이터 및 JSDOM 환경만 사용합니다.
 * - 운영 .data/ 또는 실제 계정·설정을 변경하지 않습니다.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-loop2-'));
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

let MemoryDatabase: typeof import('../lib/memoryDb/memoryStore').MemoryDatabase;
let memoryDb: typeof import('../lib/memoryDb/memoryStore').memoryDb;
let computeK200IndexPrice: typeof import('../lib/memoryDb/memoryStore').computeK200IndexPrice;
let K200_INDEX_UNDERLYING_ID: typeof import('../lib/memoryDb/memoryStore').K200_INDEX_UNDERLYING_ID;
let createInMemoryRepositoryBundle: typeof import('../lib/repositories/inMemory').createInMemoryRepositoryBundle;
let createMemoryDbClient: typeof import('../lib/memoryDb/memoryDbClient').createMemoryDbClient;
let ensureLocalStandaloneReady: typeof import('../lib/engine/localStandaloneServer').ensureLocalStandaloneReady;
let getLocalStandaloneEngine: typeof import('../lib/engine/localStandaloneServer').getLocalStandaloneEngine;
let stopLocalStandaloneEngine: typeof import('../lib/engine/localStandaloneServer').stopLocalStandaloneEngine;
let LocalMarketService: typeof import('../lib/engine/marketService').LocalMarketService;
let MarketEngine: typeof import('../engine-server/src/MarketEngine').MarketEngine;
let createSimulationContext: typeof import('../lib/engine/simulation/runtime').createSimulationContext;
let StaticTimeSource: typeof import('../lib/engine/simulation/runtime').StaticTimeSource;
let toPublicStockDto: typeof import('../lib/stocks/publicStockDto').toPublicStockDto;
let PUBLIC_STOCK_SELECT_COLUMNS: typeof import('../lib/stocks/publicStockDto').PUBLIC_STOCK_SELECT_COLUMNS;
let setBrowserClient: typeof import('../lib/db/client').setBrowserClient;
let ToastProvider: typeof import('../app/components/ToastProvider').ToastProvider;
let ActiveOrdersPanel: typeof import('../app/components/ActiveOrdersPanel').default;
let CommodityActiveOrdersPanel: typeof import('../app/components/commodities/CommodityActiveOrdersPanel').default;
let CommodityOrderEntry: typeof import('../app/components/commodities/CommodityOrderEntry').default;
let NewsPage: typeof import('../app/news/page').default;
let ETFPage: typeof import('../app/etf/page').default;
let Sidebar: typeof import('../app/components/Sidebar').default;
let DashboardGate: typeof import('../app/components/DashboardGate').default;
let TopBar: typeof import('../app/components/TopBar').default;
let ExchangePage: typeof import('../app/exchange/page').default;
let ShopPage: typeof import('../app/shop/page').default;
let AdminPage: typeof import('../app/admin/page').default;

function createDeferred<T>() {
  let resolve!: (val: T) => void;
  let reject!: (err: any) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushUi(ms: number = 25): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function makeMockRouter() {
  return {
    back: () => {},
    forward: () => {},
    refresh: () => {},
    push: () => {},
    replace: () => {},
    prefetch: async () => {},
  };
}

async function renderWithProviders(
  root: ReturnType<typeof CreateRootFn>,
  node: React.ReactElement,
  sessionValue: { status: 'authenticated' | 'unauthenticated' | 'loading'; data: any }
): Promise<void> {
  await act(async () => {
    root.render(
      <AppRouterContext.Provider value={makeMockRouter() as any}>
        <PathnameContext.Provider value="/">
          <SearchParamsContext.Provider value={new URLSearchParams()}>
            <SessionContext.Provider value={{ ...sessionValue, update: async () => sessionValue.data } as any}>
              <ToastProvider>{node}</ToastProvider>
            </SessionContext.Provider>
          </SearchParamsContext.Provider>
        </PathnameContext.Provider>
      </AppRouterContext.Provider>
    );
  });
}

async function testB01_RouteExportsAndSharedSingletons(): Promise<void> {
  console.log('▶ [B-01] route.ts 비지원 런타임 export 제거·동적 params 계약·공유 싱글턴 보존 검증');

  const routeExpectations: Array<{ file: string; allowed: string[] }> = [
    { file: 'app/api/analyze/route.ts', allowed: ['POST'] },
    { file: 'app/api/auth/[...nextauth]/route.ts', allowed: ['GET', 'POST'] },
    { file: 'app/api/market-flow/route.ts', allowed: ['dynamic', 'GET', 'POST'] },
    { file: 'app/api/commodities/route.ts', allowed: ['GET', 'POST'] },
  ];

  const analyzeMod = await import('../app/api/analyze/route');
  const authMod = await import('../app/api/auth/[...nextauth]/route');
  const marketFlowMod = await import('../app/api/market-flow/route');
  const commoditiesMod = await import('../app/api/commodities/route');

  const loadedModules: Record<string, Record<string, unknown>> = {
    'app/api/analyze/route.ts': analyzeMod,
    'app/api/auth/[...nextauth]/route.ts': authMod,
    'app/api/market-flow/route.ts': marketFlowMod,
    'app/api/commodities/route.ts': commoditiesMod,
  };

  for (const { file, allowed } of routeExpectations) {
    const keys = Object.keys(loadedModules[file]).filter((k) => k !== 'default' && k !== '__esModule').sort();
    assert.deepEqual(keys, [...allowed].sort(), `${file} must only export supported Next route keys`);
  }

  const authRouteSrc = fs.readFileSync(path.join(process.cwd(), 'app/api/auth/[...nextauth]/route.ts'), 'utf8');
  assert.equal(
    authRouteSrc.includes('params: Promise<{ nextauth: string[] }>'),
    true,
    'NextAuth RouteContext params must be Promise<{ nextauth: string[] }>'
  );
  assert.equal(
    authRouteSrc.includes('| { nextauth: string[] }'),
    false,
    'NextAuth RouteContext params must not use non-Promise union'
  );

  // 공유 싱글턴 보존 검증: commodityEngineInstance === globalThis.commodityEngine
  const { commodityEngineInstance } = await import('../lib/commodities/commodityEngineInstance');
  assert.equal(
    commodityEngineInstance,
    (globalThis as any).commodityEngine,
    'Shared commodityEngineInstance must preserve globalThis singleton'
  );

  // 공유 헬퍼로 parseMarketFlowStepBody 및 analyze test hooks 정상 동작 확인
  const { parseMarketFlowStepBody } = await import('../lib/engine/marketFlowHelper');
  assert.deepEqual(parseMarketFlowStepBody({ action: 'step', dt: 1.5 }), { ok: true, dt: 1.5 });
  assert.equal(parseMarketFlowStepBody({ action: 'invalid', dt: 1.5 }).ok, false);

  const { setSessionGetter, resetRateLimits } = await import('../lib/ai/analyzeRouteHelper');
  resetRateLimits();
  setSessionGetter(async () => null);
  const unauthRes = await analyzeMod.POST(
    new Request('http://localhost/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '반도체 상승' }),
    }) as any
  );
  assert.equal(unauthRes.status, 401);
  setSessionGetter(null);

  console.log('  ✓ B-01 통과');
}

async function testB02_StockDetailPublicDtoOmitsTargetPrice(): Promise<void> {
  console.log('▶ [B-02] stock 상세 서버 컴포넌트 공개 DTO target_price 직렬화 제외 검증');

  const syntheticRow = {
    id: 'stk_synth_001',
    name: '합성전자',
    ticker: 'SYNTH1',
    market: 'domestic',
    sector: '반도체',
    current_price: 52_000,
    previous_close: 50_000,
    open_price: 50_500,
    high: 53_000,
    low: 49_800,
    volume: 120_000,
    market_cap: 52_000_000_000,
    relevance_weight: 1.2,
    target_price: 999_999,
    is_core: true,
    is_listed: true,
    description: '합성 단위 검증용 종목',
    financials: null,
  };

  const publicDto = toPublicStockDto(syntheticRow, { listedAt: '2020-01-01' });
  const serialized = JSON.stringify(publicDto);

  assert.equal('target_price' in publicDto, false, 'Public DTO must omit target_price');
  assert.equal('targetPrice' in publicDto, false, 'Public DTO must omit targetPrice');
  assert.equal(serialized.includes('target_price'), false, 'Serialized DTO must not contain target_price');
  assert.equal(serialized.includes('targetPrice'), false, 'Serialized DTO must not contain targetPrice');
  assert.equal(serialized.includes('999999'), false, 'Serialized DTO must not contain internal target price value');
  assert.equal(publicDto.currentPrice, 52_000, 'Public currentPrice must be preserved');
  assert.equal(publicDto.previousClose, 50_000, 'Public previousClose must be preserved');
  assert.equal(PUBLIC_STOCK_SELECT_COLUMNS.includes('target_price'), false, 'Public stock select list must exclude target_price');

  const pageSrc = fs.readFileSync(path.join(process.cwd(), 'app/stocks/[id]/page.tsx'), 'utf8');
  const v2PageSrc = fs.readFileSync(path.join(process.cwd(), 'app/v2/stocks/[id]/page.tsx'), 'utf8');
  assert.equal(pageSrc.includes('toPublicStockDto'), true);
  assert.equal(v2PageSrc.includes('toPublicStockDto'), true);
  assert.equal(pageSrc.includes('target_price'), false);
  assert.equal(v2PageSrc.includes('target_price'), false);

  // 관리자 화면 쿼리는 target_price 유지 검증
  const adminSrc = fs.readFileSync(path.join(process.cwd(), 'app/admin/page.tsx'), 'utf8');
  assert.equal(adminSrc.includes('target_price'), true, 'AdminPage must preserve target_price management');

  console.log('  ✓ B-02 통과');
}

async function testB03_SessionProfileUserIdAndPkSeparation(): Promise<void> {
  console.log('▶ [B-03] 세션 프로필 조회 user_id 통일 및 local-db/InMemoryRepo PK·계정 키 분리 검증');

  // 1. UI 호출처가 모두 profiles 조회 시 user_id를 사용하는지 정적 확인
  const uiFiles = [
    'app/admin/page.tsx',
    'app/components/DashboardGate.tsx',
    'app/components/Sidebar.tsx',
    'app/components/TopBar.tsx',
    'app/etf/page.tsx',
    'app/exchange/page.tsx',
    'app/news/page.tsx',
    'app/shop/page.tsx',
  ];
  for (const rel of uiFiles) {
    const src = fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    const profileMatches = src.match(/from\(['"]profiles['"]\)[\s\S]{0,220}?\.eq\(['"]([^'"]+)['"]/g) || [];
    assert.ok(profileMatches.length > 0, `${rel} must query profiles`);
    for (const m of profileMatches) {
      assert.equal(m.includes('user_id'), true, `${rel} profiles query must filter by user_id: ${m}`);
    }
  }

  // 2. local-db PK vs user_id 분리 검증
  await ensureLocalStandaloneReady();
  getLocalStandaloneEngine()?.stop();
  memoryDb.resetToSeedData();
  memoryDb.profiles.clear();
  memoryDb.profileUserIdIndex.clear();

  memoryDb.profiles.set('legacy_row_alice', {
    id: 'legacy_row_alice',
    user_id: 'auth_alice',
    username: 'AliceLegacy',
    nickname: 'AliceLegacy',
    cash: 77_000_000,
    net_worth: 77_000_000,
    rank_tier: 'Diamond',
    is_admin: true,
    unlocked_features: ['custom_dashboard'],
    created_at: memoryDb.getIsoTimestamp(),
  });
  memoryDb.profiles.set('auth_alice', {
    id: 'auth_alice',
    user_id: 'auth_bob',
    username: 'BobCollision',
    nickname: 'BobCollision',
    cash: 111,
    net_worth: 111,
    rank_tier: 'Bronze',
    is_admin: false,
    created_at: memoryDb.getIsoTimestamp(),
  });
  memoryDb.profiles.set('auth_charlie', {
    id: 'auth_charlie',
    user_id: 'auth_dave',
    username: 'DaveCollision',
    nickname: 'DaveCollision',
    cash: 222,
    net_worth: 222,
    rank_tier: 'Bronze',
    created_at: memoryDb.getIsoTimestamp(),
  });
  memoryDb.rebuildIndexes();

  const { POST: localDbPost } = await import('../app/api/local-db/route');
  const { setSessionGetter } = await import('../lib/ai/analyzeRouteHelper');
  void setSessionGetter;

  // PK('auth_alice') 조회는 정확히 Bob 행(id==='auth_alice')만 반환해야 하며, Alice(user_id==='auth_alice')와 섞이지 않음
  const byPkRes = await localDbPost(
    new Request('http://localhost/api/local-db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'execute',
        tableName: 'profiles',
        query: {
          action: 'select',
          filters: [{ col: 'id', op: 'eq', val: 'auth_alice' }],
          isMaybeSingle: true,
        },
      }),
    })
  );
  const byPkJson = await byPkRes.json();
  assert.equal(byPkJson.data?.id, 'auth_alice');
  assert.equal(byPkJson.data?.user_id, 'auth_bob');
  assert.equal('cash' in (byPkJson.data || {}), false, 'Non-owner PK select must mask private fields');

  // user_id('auth_alice') 조회는 정확히 Alice 행(legacy_row_alice)만 반환
  const byUidRes = await localDbPost(
    new Request('http://localhost/api/local-db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'execute',
        tableName: 'profiles',
        query: {
          action: 'select',
          filters: [{ col: 'user_id', op: 'eq', val: 'auth_alice' }],
          isMaybeSingle: true,
        },
      }),
    })
  );
  const byUidJson = await byUidRes.json();
  assert.equal(byUidJson.data?.id, 'legacy_row_alice');
  assert.equal(byUidJson.data?.user_id, 'auth_alice');

  // 존재하지 않는 PK('legacy_missing_pk') 조회 시 null 반환
  const missingPkRes = await localDbPost(
    new Request('http://localhost/api/local-db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'execute',
        tableName: 'profiles',
        query: {
          action: 'select',
          filters: [{ col: 'id', op: 'eq', val: 'legacy_missing_pk' }],
          isMaybeSingle: true,
        },
      }),
    })
  );
  const missingPkJson = await missingPkRes.json();
  assert.equal(missingPkJson.data, null);

  // 3. InMemoryParticipantRepository & InMemorySettlementRepository PK/계정 키 분리 검증
  const db = new MemoryDatabase();
  db.profiles.set('legacy_pk_1', {
    id: 'legacy_pk_1',
    user_id: 'uid_alice',
    username: 'Alice',
    nickname: 'Alice',
    cash: 5_000_000,
    net_worth: 5_000_000,
    rank_tier: 'Gold',
    created_at: db.getIsoTimestamp(),
  });
  db.profiles.set('uid_charlie', {
    id: 'uid_charlie',
    user_id: 'uid_dave',
    username: 'Dave',
    nickname: 'Dave',
    cash: 900_000,
    net_worth: 900_000,
    rank_tier: 'Bronze',
    created_at: db.getIsoTimestamp(),
  });
  db.rebuildIndexes();

  const bundle = createInMemoryRepositoryBundle(db);
  const aliceRepoProfile = await bundle.participants.getProfile('uid_alice');
  assert.equal(aliceRepoProfile?.id, 'legacy_pk_1');
  assert.equal(aliceRepoProfile?.cash, 5_000_000);

  // uid_charlie 계정이 없을 때, PK가 'uid_charlie'인 Dave 프로필과 절대 충돌 금지
  assert.equal(await bundle.participants.getProfile('uid_charlie'), null);
  await bundle.participants.updateProfile('uid_charlie', { cash: 300_000, username: 'Charlie' });
  const charlieProfile = await bundle.participants.getProfile('uid_charlie');
  const daveProfile = await bundle.participants.getProfile('uid_dave');
  assert.equal(charlieProfile?.user_id, 'uid_charlie');
  assert.equal(charlieProfile?.cash, 300_000);
  assert.notEqual(charlieProfile?.id, 'uid_charlie', 'New profile must avoid colliding PK occupied by Dave');
  assert.equal(daveProfile?.id, 'uid_charlie');
  assert.equal(daveProfile?.cash, 900_000, 'Dave profile must remain untouched');

  // InMemorySettlementRepository: expireOrdersForExpiredOption + settleOptionExpiryAtomically on legacy profile
  const expIso = new Date(1_700_000_000_000 - 60_000).toISOString();
  const stk = Array.from(db.stocks.values()).find((s) => s.market === 'domestic')!;
  stk.current_price = 75_000;
  db.optionsContracts.set('opt_b03', {
    id: 'opt_b03',
    underlying_stock_id: stk.id,
    ticker: 'OPT_B03',
    asset_class: 'STK',
    type: 'CALL',
    option_type: 'CALL',
    strike_price: 70_000,
    current_price: 5_000,
    multiplier: 1,
    expiry_date: expIso,
    open_interest: 10,
    volume: 0,
    created_at: db.getIsoTimestamp(),
  });
  db.holdings.set(`uid_alice_opt_b03`, {
    id: `uid_alice_opt_b03`,
    user_id: 'uid_alice',
    stock_id: 'opt_b03',
    quantity: 2,
    avg_price: 1000,
    created_at: db.getIsoTimestamp(),
  });
  db.addHoldingToIndex(db.holdings.get(`uid_alice_opt_b03`)!);
  const settleOptRes = await bundle.settlement.settleOptionExpiryAtomically({
    idempotencyKey: 'opt_exp_b03_alice',
    userId: 'uid_alice',
    optionId: 'opt_b03',
    underlyingClosePrice: 75_000,
    now: 1_700_000_000_000,
  });
  assert.equal(settleOptRes.success, true);
  assert.equal(db.profiles.get('legacy_pk_1')?.cash, 5_010_000, 'Option payout must credit legacy profile via user_id');

  // 4. UI 컴포넌트(Sidebar, DashboardGate, TopBar, Exchange, Shop, Admin, ETF, News) 실제 JSDOM 호출 검증 (eq user_id 전달)
  const recordedProfileFilters: Array<{ component: string; col: string; val: string }> = [];
  const origFetch = globalThis.fetch;
  const origDisableGuest = process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'true';
  setBrowserClient(null);

  const installMockFetch = (compName: string) => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === '/api/local-db' && init?.body) {
        const parsed = JSON.parse(String(init.body));
        if (parsed.tableName === 'profiles') {
          for (const f of parsed.query?.filters || []) {
            recordedProfileFilters.push({ component: compName, col: f.col, val: String(f.val) });
          }
          return new Response(
            JSON.stringify({
              data: {
                is_admin: true,
                unlocked_features: ['custom_dashboard'],
                cash: 12_345_000,
                usd_balance: 100,
                eur_balance: 0,
                jpy_balance: 0,
                cny_balance: 0,
                gbp_balance: 0,
                news_subscriptions: {},
              },
              error: null,
            }),
            { status: 200 }
          );
        }
        return new Response(JSON.stringify({ data: [], error: null }), { status: 200 });
      }
      return new Response(JSON.stringify({ success: true, data: {} }), { status: 200 });
    }) as typeof fetch;
  };

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  const aliceSession = {
    status: 'authenticated' as const,
    data: { user: { id: 'auth_alice', name: 'Alice', email: 'alice@test.local' } },
  };

  try {
    const comps: Array<[string, React.ReactElement]> = [
      ['AdminPage', <AdminPage key="adm" />],
      ['DashboardGate', <DashboardGate key="dg"><div>INTRO</div></DashboardGate>],
      ['Sidebar', <Sidebar key="sb" />],
      ['TopBar', <TopBar key="tb" />],
      ['ETFPage', <ETFPage key="etf" />],
      ['ExchangePage', <ExchangePage key="ex" />],
      ['NewsPage', <NewsPage key="nw" />],
      ['ShopPage', <ShopPage key="sh" />],
    ];
    for (const [name, elem] of comps) {
      installMockFetch(name);
      await renderWithProviders(root, elem, aliceSession);
      await flushUi(30);
    }
    for (const [name] of comps) {
      const hits = recordedProfileFilters.filter((r) => r.component === name);
      assert.ok(hits.length > 0, `${name} must issue profiles query`);
      assert.equal(hits.every((h) => h.col === 'user_id' && h.val === 'auth_alice'), true, `${name} must query profiles by user_id`);
    }
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
    globalThis.fetch = origFetch;
    setBrowserClient(null);
    if (origDisableGuest === undefined) delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
    else process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = origDisableGuest;
  }

  console.log('  ✓ B-03 통과');
}

async function testR01_ActiveOrdersCommoditiesAndNewsAccountBinding(): Promise<void> {
  console.log('▶ [R-01] ActiveOrdersPanel·원자재 주문/미체결·뉴스 계정 바인딩·로그아웃/전환·언마운트 검증');

  const origFetch = globalThis.fetch;
  const origDisableGuest = process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'true';
  setBrowserClient(null);

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  let root = createRoot(container);

  // 1) ActiveOrdersPanel: 지연 응답 무시, 로그아웃 즉시 초기화, 진행중 취소 중 계정 전환 격리, 언마운트 안전
  try {
    const deferredFetchA = createDeferred<Response>();
    const deferredCancelA = createDeferred<Response>();
    let currentUser = 'user_r01_a';

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === '/api/local-db' && init?.body) {
        const parsed = JSON.parse(String(init.body));
        if (parsed.tableName === 'orders' && parsed.query?.action === 'select') {
          const uidFilter = (parsed.query?.filters || []).find((f: any) => f.col === 'user_id')?.val;
          if (uidFilter === 'user_r01_a') {
            return await deferredFetchA.promise;
          }
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'ord_b_1',
                  stock_id: 'stk_b',
                  side: 'sell',
                  price: 88000,
                  size: 3,
                  filled: 0,
                  status: 'open',
                  created_at: '2026-11-23T09:00:00Z',
                  stocks: { id: 'stk_b', ticker: '0025', name: 'B종목', market: 'domestic', current_price: 88000 },
                },
              ],
              error: null,
            }),
            { status: 200 }
          );
        }
        if (parsed.tableName === 'orders' && parsed.query?.action === 'update') {
          return await deferredCancelA.promise;
        }
      }
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }) as typeof fetch;

    const orderCountHistory: number[] = [];
    await renderWithProviders(
      root,
      <ActiveOrdersPanel onOrderCountChange={(c) => orderCountHistory.push(c)} />,
      { status: 'authenticated', data: { user: { id: 'user_r01_a', name: 'A', email: 'a@test.local' } } }
    );
    await flushUi(20);

    // User A가 아직 응답 대기 중일 때 User B로 전환
    currentUser = 'user_r01_b';
    await renderWithProviders(
      root,
      <ActiveOrdersPanel onOrderCountChange={(c) => orderCountHistory.push(c)} />,
      { status: 'authenticated', data: { user: { id: 'user_r01_b', name: 'B', email: 'b@test.local' } } }
    );
    await flushUi(30);
    assert.equal(container.textContent?.includes('B종목'), true, 'User B orders must render');

    // User A의 뒤늦은 응답 도착 -> 무시되어야 함
    deferredFetchA.resolve(
      new Response(
        JSON.stringify({
          data: [
            {
              id: 'ord_a_1',
              stock_id: 'stk_a',
              side: 'buy',
              price: 70000,
              size: 5,
              filled: 0,
              status: 'open',
              created_at: '2026-11-23T09:00:00Z',
              stocks: { id: 'stk_a', ticker: '0010', name: 'A종목', market: 'domestic', current_price: 70000 },
            },
          ],
          error: null,
        }),
        { status: 200 }
      )
    );
    await flushUi(30);
    assert.equal(container.textContent?.includes('A종목'), false, 'Stale User A response must be ignored');
    assert.equal(container.textContent?.includes('B종목'), true);

    // 진행 중 취소 요청 도중 계정 전환 시 B 상태/버튼 잠금이 오염되지 않아야 함
    (globalThis as any).confirm = () => true;
    const cancelBtn = Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.trim() === '취소');
    assert.ok(cancelBtn);
    await act(async () => {
      cancelBtn!.click();
    });
    await flushUi(10);
    // 로그아웃 -> 즉시 미체결 잠금 화면 전환
    await renderWithProviders(
      root,
      <ActiveOrdersPanel onOrderCountChange={(c) => orderCountHistory.push(c)} />,
      { status: 'unauthenticated', data: null }
    );
    await flushUi(20);
    assert.equal(container.textContent?.includes('로그인이 필요한 메뉴입니다'), true);
    deferredCancelA.resolve(new Response(JSON.stringify({ data: [], error: null }), { status: 200 }));
    await flushUi(20);
    assert.equal(container.textContent?.includes('로그인이 필요한 메뉴입니다'), true);
    void currentUser;

    // 2) CommodityActiveOrdersPanel & CommodityOrderEntry: 계정 전환·지연 응답·언마운트 안전성
    let deferredCommA = createDeferred<Response>();
    let commAccount = 'comm_user_a';
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url.startsWith('/api/commodities')) {
        if (commAccount === 'comm_user_a') {
          return await deferredCommA.promise;
        }
        return new Response(
          JSON.stringify({
            success: true,
            usdToKrwRate: 1400,
            availableCashKrw: 2_500_000,
            myPosition: { side: 'short', quantity: 2, avg_entry_price: 2400 },
            myOrders: [
              { id: 'cord_b_1', commodityId: 'GOLD', side: 'sell', type: 'limit', price: 2500, size: 1, filled: 0, status: 'open', reserved_krw: 420000 },
            ],
          }),
          { status: 200 }
        );
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }) as typeof fetch;

    await renderWithProviders(
      root,
      <CommodityActiveOrdersPanel commodityId="GOLD" commodityName="금" />,
      { status: 'authenticated', data: { user: { id: 'comm_user_a', name: 'A', email: 'a@test.local' } } }
    );
    await flushUi(15);

    commAccount = 'comm_user_b';
    await renderWithProviders(
      root,
      <CommodityActiveOrdersPanel commodityId="GOLD" commodityName="금" />,
      { status: 'authenticated', data: { user: { id: 'comm_user_b', name: 'B', email: 'b@test.local' } } }
    );
    await flushUi(25);
    assert.equal(container.textContent?.includes('숏 -2계약'), true);

    deferredCommA.resolve(
      new Response(
        JSON.stringify({
          success: true,
          usdToKrwRate: 1400,
          availableCashKrw: 99_000_000,
          myPosition: { side: 'long', quantity: 99, avg_entry_price: 2100 },
          myOrders: [
            { id: 'cord_a_1', commodityId: 'GOLD', side: 'buy', type: 'limit', price: 2100, size: 9, filled: 0, status: 'open', reserved_krw: 999000 },
          ],
        }),
        { status: 200 }
      )
    );
    await flushUi(25);
    assert.equal(container.textContent?.includes('롱 +99'), false, 'CommodityActiveOrdersPanel must ignore stale User A response');
    assert.equal(container.textContent?.includes('숏 -2계약'), true);

    // CommodityOrderEntry 테스트
    deferredCommA = createDeferred<Response>();
    commAccount = 'comm_user_a';
    const goldDef = {
      id: 'GOLD',
      ticker: 'GC',
      name: 'Gold',
      nameKo: '금',
      category: 'precious_metals' as const,
      unit: 'oz',
      tickSize: 0.1,
      tickValue: 10,
      marginRequirement: 3000,
      basePrice: 2400,
      currentPrice: 2400,
      baseVolatility: 0.01,
      drift: 0,
      eventSensitivity: 1,
      averageVolume: 1000,
      seasonality: { period: 365, amplitude: 0, phase: 0 },
      description: 'Gold',
    };
    await renderWithProviders(
      root,
      <CommodityOrderEntry commodity={goldDef} />,
      { status: 'authenticated', data: { user: { id: 'comm_user_a', name: 'A', email: 'a@test.local' } } }
    );
    await flushUi(15);

    commAccount = 'comm_user_b';
    await renderWithProviders(
      root,
      <CommodityOrderEntry commodity={goldDef} />,
      { status: 'authenticated', data: { user: { id: 'comm_user_b', name: 'B', email: 'b@test.local' } } }
    );
    await flushUi(25);
    assert.equal(container.textContent?.includes('₩2,500,000'), true);
    deferredCommA.resolve(
      new Response(
        JSON.stringify({
          success: true,
          usdToKrwRate: 1400,
          availableCashKrw: 99_000_000,
          myPosition: { side: 'long', quantity: 77, avg_entry_price: 2100 },
          myOrders: [],
        }),
        { status: 200 }
      )
    );
    await flushUi(25);
    assert.equal(container.textContent?.includes('₩99,000,000'), false, 'CommodityOrderEntry must ignore stale User A response');

    // 로그아웃 -> 즉시 로그인 필요 표시
    await renderWithProviders(
      root,
      <CommodityOrderEntry commodity={goldDef} />,
      { status: 'unauthenticated', data: null }
    );
    await flushUi(20);
    assert.equal(container.textContent?.includes('로그인 필요'), true);

    // 3) NewsPage: 관리자/구독자(A) -> 비구독 일반유저(B) 전환 시 즉시 권한/해금 뉴스 초기화 & 지연 응답 무시
    const deferredNewsA = createDeferred<Response>();
    let activeNewsUser = 'news_admin_a';
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (url === '/api/local-db' && init?.body) {
        const parsed = JSON.parse(String(init.body));
        if (parsed.tableName === 'profiles') {
          const uid = (parsed.query?.filters || []).find((f: any) => f.col === 'user_id')?.val;
          if (uid === 'news_admin_a') return await deferredNewsA.promise;
          return new Response(JSON.stringify({ data: { is_admin: false, news_subscriptions: {} }, error: null }), { status: 200 });
        }
        if (parsed.tableName === 'market_news') {
          return new Response(
            JSON.stringify({
              data: [
                {
                  id: 'nw_rumor_1',
                  created_at: '2026-11-23T09:00:00Z',
                  category: 'RUMOR',
                  publisher: '찌라시',
                  title: '비밀 루머 제목',
                  content: activeNewsUser === 'news_admin_a' ? '비밀 본문 A' : '',
                  locked: activeNewsUser !== 'news_admin_a',
                },
              ],
              error: null,
            }),
            { status: 200 }
          );
        }
      }
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    }) as typeof fetch;

    await renderWithProviders(
      root,
      <NewsPage />,
      { status: 'authenticated', data: { user: { id: 'news_admin_a', name: 'Admin', email: 'admin@test.local' } } }
    );
    await flushUi(15);

    activeNewsUser = 'news_user_b';
    await renderWithProviders(
      root,
      <NewsPage />,
      { status: 'authenticated', data: { user: { id: 'news_user_b', name: 'B', email: 'b@test.local' } } }
    );
    await flushUi(25);
    assert.equal(container.textContent?.includes('구독권 구매 후 본문 열람하기'), true);

    deferredNewsA.resolve(
      new Response(JSON.stringify({ data: { is_admin: true, news_subscriptions: { all: '2099-01-01T00:00:00Z' } }, error: null }), { status: 200 })
    );
    await flushUi(25);
    assert.equal(container.textContent?.includes('구독권 구매 후 본문 열람하기'), true, 'Stale admin profile must not unlock NewsPage for User B');
    assert.equal(container.textContent?.includes('비밀 본문 A'), false);

    // 언마운트 뒤 지연 응답 도착해도 에러 미발생
    await act(async () => { root.unmount(); });
    root = createRoot(container);
    await flushUi(15);
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
    globalThis.fetch = origFetch;
    setBrowserClient(null);
    if (origDisableGuest === undefined) delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
    else process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = origDisableGuest;
  }

  console.log('  ✓ R-01 통과');
}

async function testR02_ConsistentIsListedExclusion(): Promise<void> {
  console.log('▶ [R-02] K200·독립/로컬 엔진 LP/봇/매칭·ETF 동기화 is_listed=false 일관 제외 및 레거시/취소/정산 보존 검증');

  await ensureLocalStandaloneReady();
  const singletonEngine = getLocalStandaloneEngine();
  singletonEngine?.stop();

  memoryDb.resetToSeedData();
  const domesticStocks = Array.from(memoryDb.stocks.values()).filter((s) => s.market === 'domestic');
  assert.ok(domesticStocks.length >= 3);

  const listedStk = domesticStocks[0]!;
  const legacyStk = domesticStocks[1]!;
  const delistedStk = domesticStocks[2]!;

  listedStk.is_listed = true;
  delete legacyStk.is_listed;
  delistedStk.is_listed = false;

  // 1. K200 권위 산정에서 is_listed=false 제외 & legacy undefined 포함 & InMemoryMarketRepository 일치
  delistedStk.previous_close = 10_000;
  delistedStk.current_price = 100_000; // 극단적 상승이지만 상장폐지이므로 K200에 반영되면 안 됨
  delistedStk.shares_outstanding = 1_000_000_000;

  const k200WithDelisted = computeK200IndexPrice(memoryDb.stocks.values());
  const k200WithoutDelisted = computeK200IndexPrice(
    Array.from(memoryDb.stocks.values()).filter((s) => s.id !== delistedStk.id)
  );
  assert.equal(k200WithDelisted, k200WithoutDelisted, 'computeK200IndexPrice must exclude is_listed=false');

  const k200WithoutLegacy = computeK200IndexPrice(
    Array.from(memoryDb.stocks.values()).filter((s) => s.id !== legacyStk.id)
  );
  legacyStk.previous_close = 10_000;
  legacyStk.current_price = 12_000;
  legacyStk.shares_outstanding = 500_000_000;
  const k200WithLegacyMoved = computeK200IndexPrice(memoryDb.stocks.values());
  assert.notEqual(k200WithLegacyMoved, k200WithoutLegacy, 'computeK200IndexPrice must include legacy undefined stock');

  const repoBundle = createInMemoryRepositoryBundle(memoryDb);
  const underlyingPrices = repoBundle.markets.getUnderlyingPrices([K200_INDEX_UNDERLYING_ID]);
  assert.equal(underlyingPrices[K200_INDEX_UNDERLYING_ID], k200WithLegacyMoved, 'InMemoryMarketRepository K200 must match computeK200IndexPrice');

  // 2. 로컬 엔진 refreshLpOrders / processMatching / AgentManager:
  //    delistedStk에 대한 LP/봇 주문 생성 및 신규 매칭 제외, 기존 미체결 주문 취소 가능 & legacyStk 유지
  memoryDb.orders.clear();
  memoryDb.rebuildIndexes();

  // 기존 미체결 사용자 매수 주문 (delistedStk 상장폐지 이전 주문 가정)
  const traderUid = 'usr_r02_trader';
  memoryDb.ensureUserProfile(traderUid, { cash: 10_000_000 });
  const existingUserOrd = {
    id: 'ord_r02_existing_delisted',
    stock_id: delistedStk.id,
    user_id: traderUid,
    side: 'buy' as const,
    price: 10_000,
    size: 5,
    filled: 0,
    status: 'open' as const,
    is_lp: false,
    created_at: memoryDb.getIsoTimestamp(),
  };
  memoryDb.orders.set(existingUserOrd.id, existingUserOrd);
  memoryDb.addOrderToIndex(existingUserOrd);

  const localEngine = singletonEngine!;
  await localEngine.refreshLpOrders();
  const delistedLpOrders = Array.from(memoryDb.orders.values()).filter(
    (o) => o.stock_id === delistedStk.id && o.is_lp
  );
  const listedLpOrders = Array.from(memoryDb.orders.values()).filter(
    (o) => o.stock_id === listedStk.id && o.is_lp
  );
  const legacyLpOrders = Array.from(memoryDb.orders.values()).filter(
    (o) => o.stock_id === legacyStk.id && o.is_lp
  );
  assert.equal(delistedLpOrders.length, 0, 'Local engine refreshLpOrders must skip is_listed=false');
  assert.ok(listedLpOrders.length > 0, 'Local engine refreshLpOrders must populate listed stock');
  assert.ok(legacyLpOrders.length > 0, 'Local engine refreshLpOrders must preserve legacy undefined stock');

  // processMatching에 상장폐지 매도 봇 주문을 넣어도 기존 매수 주문과 매칭되지 않아야 함
  await localEngine.processMatching([
    {
      stock_id: delistedStk.id,
      user_id: null,
      side: 'sell',
      price: 10_000,
      size: 5,
      filled: 0,
      status: 'open',
      is_lp: false,
      created_at: memoryDb.getIsoTimestamp(),
    },
  ]);
  assert.equal(memoryDb.orders.get(existingUserOrd.id)?.status, 'open', 'Delisted stock resting order must not be matched');

  // 기존 미체결 주문은 취소 가능해야 함
  const cancelRes = await LocalMarketService.cancelOrder({ orderId: existingUserOrd.id, userId: traderUid });
  assert.equal(cancelRes.success, true, 'Existing open order on delisted stock must still be cancellable');
  assert.equal(memoryDb.orders.get(existingUserOrd.id)?.status, 'cancelled');

  // AgentManager.step 실행 시 상장폐지 종목으로 LP/봇 주문이 생성되지 않아야 함
  const ordersCountBeforeStep = memoryDb.orders.size;
  await localEngine.stepSimulation(1.0);
  const newDelistedOrdersAfterStep = Array.from(memoryDb.orders.values()).filter(
    (o) => o.stock_id === delistedStk.id && o.id !== existingUserOrd.id
  );
  assert.equal(newDelistedOrdersAfterStep.length, 0, 'AgentManager.step must not submit LP or bot orders for is_listed=false');
  void ordersCountBeforeStep;

  // 3. 독립 엔진(MarketEngine): fetchMarketState / runTick / validateSingleOrder에서 is_listed=false 제외
  const simDb = new MemoryDatabase();
  const simDomestic = Array.from(simDb.stocks.values()).filter((s) => s.market === 'domestic');
  const simListed = simDomestic[0]!;
  const simDelisted = simDomestic[1]!;
  const simLegacy = simDomestic[2]!;
  simListed.is_listed = true;
  simDelisted.is_listed = false;
  delete simLegacy.is_listed;
  simDb.orders.clear();

  // 상장폐지 종목에 기존 사용자 주문과 반대 주문을 넣어두어도 매칭되지 않고 보존되어야 함
  simDb.ensureUserProfile('sim_u1', { cash: 10_000_000 });
  simDb.ensureUserProfile('sim_u2', { cash: 10_000_000 });
  simDb.holdings.set(`sim_u2_${simDelisted.id}`, {
    id: `sim_u2_${simDelisted.id}`,
    user_id: 'sim_u2',
    stock_id: simDelisted.id,
    quantity: 10,
    avg_price: 50_000,
    created_at: simDb.getIsoTimestamp(),
  });
  simDb.addHoldingToIndex(simDb.holdings.get(`sim_u2_${simDelisted.id}`)!);
  simDb.orders.set('sim_delisted_buy', {
    id: 'sim_delisted_buy',
    stock_id: simDelisted.id,
    user_id: 'sim_u1',
    side: 'buy',
    price: 50_000,
    size: 2,
    filled: 0,
    status: 'open',
    is_lp: false,
    created_at: simDb.getIsoTimestamp(),
  });
  simDb.orders.set('sim_delisted_sell', {
    id: 'sim_delisted_sell',
    stock_id: simDelisted.id,
    user_id: 'sim_u2',
    side: 'sell',
    price: 50_000,
    size: 2,
    filled: 0,
    status: 'open',
    is_lp: false,
    created_at: simDb.getIsoTimestamp(),
  });
  simDb.rebuildIndexes();

  const simRepos = createInMemoryRepositoryBundle(simDb);
  const simClock = new StaticTimeSource(1774483200000);
  const simCtx = createSimulationContext({ seed: 101, clock: simClock });
  const indEngine = new MarketEngine({
    simulationContext: simCtx,
    repositories: simRepos,
  });
  const ms = await (indEngine as any).fetchMarketState(null);
  assert.equal(ms.stocks.some((s: any) => s.id === simDelisted.id), false, 'MarketEngine.fetchMarketState must exclude is_listed=false');
  assert.equal(ms.stocks.some((s: any) => s.id === simLegacy.id), true, 'MarketEngine.fetchMarketState must preserve legacy undefined');
  assert.equal(ms.stocks.some((s: any) => s.id === simListed.id), true);

  const tickRes = await indEngine.tick();
  assert.equal(tickRes.success, true);
  assert.equal(simDb.orders.get('sim_delisted_buy')?.status, 'open', 'MarketEngine must not match resting orders of delisted stock');
  assert.equal(simDb.orders.get('sim_delisted_sell')?.status, 'open');
  const delistedOrdersAfterTick = Array.from(simDb.orders.values()).filter(
    (o) => o.stock_id === simDelisted.id && o.id !== 'sim_delisted_buy' && o.id !== 'sim_delisted_sell'
  );
  assert.equal(delistedOrdersAfterTick.length, 0, 'MarketEngine must not insert LP or bot orders for delisted stock');

  // 4. ETF 동기화 (syncServerMarketData)에서 is_listed=false 제외 & legacy undefined 유지 검증
  const origFetch = globalThis.fetch;
  setBrowserClient(null);
  const etfSrc = fs.readFileSync(path.join(process.cwd(), 'app/etf/page.tsx'), 'utf8');
  assert.equal(
    etfSrc.includes(".select('id, ticker, current_price, is_listed')"),
    true,
    'ETF syncServerMarketData must select is_listed'
  );
  assert.equal(
    etfSrc.includes("neq('is_listed', false)"),
    true,
    'ETF syncServerMarketData must filter is_listed != false'
  );

  const origDisableGuest = process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'true';
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === '/api/local-db' && init?.body) {
      const parsed = JSON.parse(String(init.body));
      if (parsed.tableName === 'stocks') {
        const hasNeqFilter = (parsed.query?.filters || []).some(
          (f: any) => f.col === 'is_listed' && f.op === 'neq' && f.val === false
        );
        if (hasNeqFilter) {
          return new Response(
            JSON.stringify({
              data: [
                { id: 's1', ticker: '005930', current_price: 88_000, is_listed: true },
                { id: 's2', ticker: '000660', current_price: 222_000 }, // legacy undefined
              ],
              error: null,
            }),
            { status: 200 }
          );
        }
        return new Response(
          JSON.stringify({
            data: [{ id: 's3', ticker: '005930', current_price: 999_999, is_listed: false }],
            error: null,
          }),
          { status: 200 }
        );
      }
      if (parsed.tableName === 'exchange_rates') {
        return new Response(JSON.stringify({ data: { rate_to_krw: 1380 }, error: null }), { status: 200 });
      }
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
  }) as typeof fetch;

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await renderWithProviders(root, <ETFPage />, { status: 'unauthenticated', data: null });
    await flushUi(40);
    // KODEXSEMI ETF PDF는 SAMSUNG_ELEC(005930)과 SK_HYNIX(000660) 사용 — 999,999(delisted)가 아니라 88,000 & 222,000만 반영되어야 함
    assert.equal(container.textContent?.includes('999,999'), false, 'ETF sync must exclude is_listed=false');
  } finally {
    await act(async () => { root.unmount(); });
    container.remove();
    globalThis.fetch = origFetch;
    setBrowserClient(null);
    if (origDisableGuest === undefined) delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
    else process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = origDisableGuest;
  }

  console.log('  ✓ R-02 통과');
}

async function main() {
  console.log('================================================================');
  console.log('🧪 Loop 2 P1·P2 결함 5건(B-01~03, R-01~02) 격리 회귀 검증');
  console.log('================================================================');

  ({ createRoot } = await import('react-dom/client'));
  ({
    MemoryDatabase,
    memoryDb,
    computeK200IndexPrice,
    K200_INDEX_UNDERLYING_ID,
  } = await import('../lib/memoryDb/memoryStore'));
  ({ createInMemoryRepositoryBundle } = await import('../lib/repositories/inMemory'));
  ({ createMemoryDbClient } = await import('../lib/memoryDb/memoryDbClient'));
  ({
    ensureLocalStandaloneReady,
    getLocalStandaloneEngine,
    stopLocalStandaloneEngine,
  } = await import('../lib/engine/localStandaloneServer'));
  ({ LocalMarketService } = await import('../lib/engine/marketService'));
  ({ MarketEngine } = await import('../engine-server/src/MarketEngine'));
  ({ createSimulationContext, StaticTimeSource } = await import('../lib/engine/simulation/runtime'));
  ({ toPublicStockDto, PUBLIC_STOCK_SELECT_COLUMNS } = await import('../lib/stocks/publicStockDto'));
  ({ setBrowserClient } = await import('../lib/db/client'));
  ({ ToastProvider } = await import('../app/components/ToastProvider'));
  ActiveOrdersPanel = (await import('../app/components/ActiveOrdersPanel')).default;
  CommodityActiveOrdersPanel = (await import('../app/components/commodities/CommodityActiveOrdersPanel')).default;
  CommodityOrderEntry = (await import('../app/components/commodities/CommodityOrderEntry')).default;
  NewsPage = (await import('../app/news/page')).default;
  ETFPage = (await import('../app/etf/page')).default;
  Sidebar = (await import('../app/components/Sidebar')).default;
  DashboardGate = (await import('../app/components/DashboardGate')).default;
  TopBar = (await import('../app/components/TopBar')).default;
  ExchangePage = (await import('../app/exchange/page')).default;
  ShopPage = (await import('../app/shop/page')).default;
  AdminPage = (await import('../app/admin/page')).default;

  try {
    await testB01_RouteExportsAndSharedSingletons();
    await testB02_StockDetailPublicDtoOmitsTargetPrice();
    await testB03_SessionProfileUserIdAndPkSeparation();
    await testR01_ActiveOrdersCommoditiesAndNewsAccountBinding();
    await testR02_ConsistentIsListedExclusion();
    console.log('\n🎉 ALL LOOP 2 P1/P2 REGRESSION CHECKS PASSED!');
  } finally {
    stopLocalStandaloneEngine();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ LOOP 2 TEST FAILED:', err);
    process.exit(1);
  });
