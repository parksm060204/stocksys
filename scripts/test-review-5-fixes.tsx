/**
 * scripts/test-review-5-fixes.tsx
 *
 * Regression test suite for the 5 review items:
 * 1. Admin manual step clock persistence & commit boundary consistency
 * 2. EventDirector fake-rumor correction scheduling persistence, restore, retry & legacy compat
 * 3. HttpMemoryClient.channel polling + TickChart / StockChartV2 stock switch, unmount, dedup, OHLC
 * 4. OrderEntry limit-order UI & quick-quantity helper clarity
 * 5. Shared server-side stock order rate limiting across /api/orders and /api/local-db
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { JSDOM } from 'jsdom';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-review-5-'));
const tmpMainDir = path.join(tmpRoot, 'main-data');
const tmpEngineDir = path.join(tmpRoot, 'engine-data');
fs.mkdirSync(tmpMainDir, { recursive: true });
fs.mkdirSync(tmpEngineDir, { recursive: true });

process.env.STOCKSYS_DATA_DIR = tmpMainDir;
process.env.ALLOW_DEV_GUEST_AUTH = 'true';
process.env.ALLOW_DEV_ADMIN = 'true';

// ── JSDOM setup ──
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
Object.defineProperty(globalThis, 'localStorage', { value: dom.window.localStorage, configurable: true, writable: true });
if (!('matchMedia' in dom.window)) {
  (dom.window as any).matchMedia = () => ({
    matches: false,
    media: '',
    onchange: null,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent: () => false,
  });
}
if (!('ResizeObserver' in globalThis)) {
  (globalThis as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (!('IntersectionObserver' in globalThis)) {
  (globalThis as any).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// ── Intercept lightweight-charts with observable spy series ──
interface ChartSeriesSpy {
  kind: string;
  data: any[];
  updates: any[];
  setData: (d: any[]) => void;
  update: (item: any) => void;
  applyOptions: () => void;
  createPriceLine: () => void;
}
const createdSeriesSpies: ChartSeriesSpy[] = [];
const CandlestickSeriesToken = { __type: 'Candlestick' };
const LineSeriesToken = { __type: 'Line' };
const HistogramSeriesToken = { __type: 'Histogram' };

let currentMockAuthUserId: string | null = null;

const origLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: any, isMain: boolean) {
  if (request === 'next-auth') {
    const actual = origLoad.call(this, request, parent, isMain);
    return {
      ...actual,
      getServerSession: async () =>
        currentMockAuthUserId ? { user: { id: currentMockAuthUserId } } : null,
    };
  }
  if (request === 'lightweight-charts') {
    return {
      ColorType: { Solid: 'solid' },
      LineStyle: { Solid: 0, Dashed: 2 },
      CandlestickSeries: CandlestickSeriesToken,
      LineSeries: LineSeriesToken,
      HistogramSeries: HistogramSeriesToken,
      createChart: () => ({
        addSeries: (seriesType: any) => {
          const kind =
            seriesType === CandlestickSeriesToken
              ? 'Candlestick'
              : seriesType === HistogramSeriesToken
                ? 'Histogram'
                : 'Line';
          const spy: ChartSeriesSpy = {
            kind,
            data: [],
            updates: [],
            setData(d: any[]) {
              spy.data = Array.isArray(d) ? d.map((x) => ({ ...x })) : [];
            },
            update(item: any) {
              spy.updates.push({ ...item });
              const idx = spy.data.findIndex((x) => x.time === item.time);
              if (idx >= 0) spy.data[idx] = { ...item };
              else spy.data.push({ ...item });
            },
            applyOptions() {},
            createPriceLine() {},
          };
          createdSeriesSpies.push(spy);
          return spy;
        },
        applyOptions() {},
        priceScale: () => ({ applyOptions() {} }),
        timeScale: () => ({
          scrollToRealTime() {},
          fitContent() {},
          subscribeVisibleLogicalRangeChange() {},
          setVisibleLogicalRange() {},
        }),
        panes: () => [{ setHeight() {} }, { setHeight() {} }, { setHeight() {} }],
        remove() {},
      }),
    };
  }
  return origLoad.call(this, request, parent, isMain);
};

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionContext } from 'next-auth/react';

async function flushUi(ms: number = 30) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

async function test1AdminManualStepClockPersistence() {
  console.log('▶ [TEST 1] 관리자 수동 스텝 시계 영속화, 실패·재시도 및 락·커밋 경계 검증');

  const {
    ensureLocalStandaloneReady,
    getLocalStandaloneEngine,
    stopLocalStandaloneEngine,
  } = await import('../lib/engine/localStandaloneServer');
  const { POST: marketFlowPOST, GET: marketFlowGET } = await import('../app/api/market-flow/route');
  const { POST: ordersPOST } = await import('../app/api/orders/route');
  const { memoryDb, GUEST_USER_ID, STOCK_UUID_MAP } = await import('../lib/memoryDb/memoryStore');
  const { persistenceManager } = await import('../lib/memoryDb/PersistenceManager');

  stopLocalStandaloneEngine();
  fs.rmSync(path.join(tmpMainDir, 'snapshot.json'), { force: true });

  await ensureLocalStandaloneReady();
  const engine = getLocalStandaloneEngine()!;
  engine.stop();
  assert.equal(memoryDb.pendingAdminMarketEvents.length, 0);

  // 1A: 예약 뉴스 없이 전진 후 즉시 재시작해도 전진된 시각이 유지되어야 함
  const t0 = engine.getSimulationTime();
  const stepRes1 = await marketFlowPOST(
    new Request('http://localhost:3000/api/market-flow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'step', dt: 2.5 }),
    })
  );
  assert.equal(stepRes1.status, 200, 'Manual step without queued news must succeed');
  const stepJson1 = await stepRes1.json();
  const t1 = t0 + 2500;
  assert.equal(stepJson1.data.asOfTime, t1, 'Response asOfTime must advance by 2500ms');

  // 스냅샷에서 즉시 복원
  stopLocalStandaloneEngine();
  await ensureLocalStandaloneReady();
  const restored1 = getLocalStandaloneEngine()!;
  restored1.stop();
  assert.equal(
    restored1.getSimulationTime(),
    t1,
    'Restored engine immediately after manual step (no queued news) must keep T1 clock'
  );

  // 1B: 저장 실패 시 HTTP 500 반환, 시계·디스크 일관성 유지 및 재시도 시 정확히 1스텝만 전진
  const origSaveSnapshot = persistenceManager.saveSnapshot.bind(persistenceManager);
  persistenceManager.saveSnapshot = async () => false;
  try {
    const failRes = await marketFlowPOST(
      new Request('http://localhost:3000/api/market-flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'step', dt: 1.5 }),
      })
    );
    assert.equal(failRes.status, 500, 'Manual step must fail with 500 when persistence fails');
    assert.equal(
      restored1.getSimulationTime(),
      t1,
      'Failed unpersisted step must roll back in-memory simulation clock to T1'
    );
    const getAfterFail = await marketFlowGET(new Request('http://localhost:3000/api/market-flow'));
    const getAfterFailJson = await getAfterFail.json();
    assert.equal(getAfterFailJson.data.asOfTime, t1, 'GET after failed step must still report T1');
  } finally {
    persistenceManager.saveSnapshot = origSaveSnapshot;
  }

  // 재시도: 정확히 +1.5s (t1 + 1500)만 전진하고 영속화됨
  const retryRes = await marketFlowPOST(
    new Request('http://localhost:3000/api/market-flow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'step', dt: 1.5 }),
    })
  );
  assert.equal(retryRes.status, 200, 'Retry after persistence recovery must succeed');
  const retryJson = await retryRes.json();
  const t2 = t1 + 1500;
  assert.equal(retryJson.data.asOfTime, t2, 'Retried step must advance exactly once from T1 to T2');

  stopLocalStandaloneEngine();
  await ensureLocalStandaloneReady();
  const restored2 = getLocalStandaloneEngine()!;
  restored2.stop();
  assert.equal(restored2.getSimulationTime(), t2, 'Reload after retry must restore T2');

  // 1C: 전진 중 봇/LP 체결이 먼저 커밋·영속화되는 경우에도 시계가 장부와 어긋나지 않는지 검증
  const stockId = STOCK_UUID_MAP['0010'];
  const stk = memoryDb.stocks.get(stockId)!;
  const guest = memoryDb.profiles.get(GUEST_USER_ID)!;
  guest.cash = 100_000_000;
  // 봇/LP 매수 호가와 교차할 높은 가격에 1주 매도 주문 배치
  const sellerOrderId = 'test1c_cross_sell';
  memoryDb.holdings.set(`${GUEST_USER_ID}_${stockId}`, {
    id: `${GUEST_USER_ID}_${stockId}`,
    user_id: GUEST_USER_ID,
    stock_id: stockId,
    quantity: 100,
    avg_price: stk.current_price,
    created_at: memoryDb.getIsoTimestamp(),
  });
  memoryDb.rebuildIndexes();
  // 봇들이 즉시 교차하도록 아주 낮은 가격에 대기 매도 등록
  const lowSellOrd = {
    id: sellerOrderId,
    stock_id: stockId,
    user_id: GUEST_USER_ID,
    side: 'sell' as const,
    price: 100,
    size: 5,
    filled: 0,
    status: 'open' as const,
    is_lp: false,
    created_at: new Date(t2 - 1000).toISOString(),
  };
  memoryDb.orders.set(lowSellOrd.id, lowSellOrd);
  memoryDb.addOrderToIndex(lowSellOrd);

  // 첫 번째 save(스텝 내부 체결)는 성공시키고, 두 번째 save(스텝 종료 최종 저장)는 실패시키는 시나리오
  let saveCalls = 0;
  const savedClocksDuringStep: number[] = [];
  persistenceManager.saveSnapshot = async (dbArg) => {
    saveCalls++;
    savedClocksDuringStep.push(dbArg.localSimulationClock?.simulationTime ?? -1);
    if (saveCalls === 1) {
      return await origSaveSnapshot(dbArg);
    }
    return false;
  };
  let finalSaveRejected = false;
  try {
    await restored2.stepSimulation(1.0);
  } catch {
    finalSaveRejected = true;
  } finally {
    persistenceManager.saveSnapshot = origSaveSnapshot;
  }

  const expectedT3 = t2 + 1000;
  if (saveCalls >= 2) {
    // 스텝 내부에서 실제 체결이 발생해 saveCalls===1이 커밋된 경우:
    assert.equal(finalSaveRejected, true, 'Final save failure must still surface error');
    assert.equal(
      savedClocksDuringStep[0],
      expectedT3,
      'Snapshot saved by in-step fill must already record advanced T3 clock'
    );
    assert.equal(
      restored2.getSimulationTime(),
      expectedT3,
      'Clock must stay at T3 to remain consistent with already-committed T3 fill'
    );
    stopLocalStandaloneEngine();
    await ensureLocalStandaloneReady();
    const restored3 = getLocalStandaloneEngine()!;
    restored3.stop();
    assert.equal(restored3.getSimulationTime(), expectedT3, 'Disk snapshot must also have T3 clock');
  } else {
    // 체결이 일어나지 않은 경우: 롤백되어 t2 유지
    assert.equal(finalSaveRejected, true);
    assert.equal(restored2.getSimulationTime(), t2);
  }

  // 1D: 동시 실행 락 순서 검증 (수동 스텝 + /api/orders 병렬 실행 데드락 없음)
  const concurrentEngine = getLocalStandaloneEngine()!;
  concurrentEngine.stop();
  const concurrentResults = await Promise.race([
    Promise.all([
      marketFlowPOST(
        new Request('http://localhost:3000/api/market-flow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'step', dt: 1.0 }),
        })
      ),
      ordersPOST(
        new Request('http://localhost:3000/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stock_id: stockId, side: 'buy', price: 1000, size: 1 }),
        })
      ),
      marketFlowPOST(
        new Request('http://localhost:3000/api/market-flow', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'step', dt: 1.0 }),
        })
      ),
    ]),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Concurrent lock deadlock timeout')), 5000)),
  ]);
  assert.equal(concurrentResults[0].status, 200);
  assert.equal(concurrentResults[1].status, 200);
  assert.equal(concurrentResults[2].status, 200);

  stopLocalStandaloneEngine();
  console.log('  ✓ TEST 1 통과');
}

async function test2EventDirectorCorrectionPersistenceAndRestore() {
  console.log('▶ [TEST 2] EventDirector 가짜 뉴스 정정 예약 저장·복원·재시도·레거시 호환 검증');

  const { MemoryDatabase } = await import('../lib/memoryDb/memoryStore');
  const { PersistenceManager } = await import('../lib/memoryDb/PersistenceManager');
  const { FileStorageAdapter } = await import('../lib/memoryDb/StorageAdapter');
  const { createInMemoryRepositoryBundle } = await import('../lib/repositories/inMemory');
  const { createSimulationContext } = await import('../lib/engine/simulation/runtime');
  const { MarketEngine } = await import('../engine-server/src/MarketEngine');
  const { EventDirector } = await import('../engine-server/src/EventDirector');
  const { NewsGenerator } = await import('../engine-server/src/services/NewsGenerator');
  const { prepareEngineRestartRuntime } = await import('../engine-server/src/restartRuntime');

  const baseNow = 1776000000000;
  const clockNow = baseNow;
  const mutableClock = { now: () => clockNow };

  const db1 = new MemoryDatabase({ clock: mutableClock, idGenerator: { nextId: (() => { let i = 0; return (p = 'id') => `${p}_${++i}`; })() } });
  const pm1 = new PersistenceManager(new FileStorageAdapter(tmpEngineDir));
  const repos1 = createInMemoryRepositoryBundle(db1);
  const ctx1 = createSimulationContext({ seed: 77, clock: mutableClock, runId: 'run_ed_1' });
  const engine1 = new MarketEngine({ simulationContext: ctx1, repositories: repos1, persistence: pm1 });

  const fakeRumorProvider = {
    async generate() {
      return {
        type: 'MICRO' as const,
        category: 'RUMOR' as const,
        publisher: '가십 썬',
        title: '엔비디아스 기밀 인수설',
        content: '미확인 합병 루머',
        target_sector: '반도체',
        target_ticker: 'NVDA',
        impact_score: 8.5,
        is_fake: true,
      };
    },
  };
  const newsGen1 = new NewsGenerator(ctx1, fakeRumorProvider);
  const director1 = new EventDirector(engine1, ctx1, repos1.event, newsGen1, {
    onPersist: () => pm1.saveSnapshot(db1),
  });

  const published = await director1.triggerEndogenousNews();
  assert.ok(published?.id, 'Fake rumor must be assigned deterministic id');
  assert.equal(director1.getPendingCorrectionCount(), 1, 'Pending correction scheduled before restart');

  const savedRumor = db1.marketNews.find((n) => n.id === published!.id);
  assert.ok(savedRumor, 'Fake rumor saved in marketNews');
  assert.equal(
    savedRumor!.correction_due_simulation_time,
    baseNow + EventDirector.CORRECTION_DELAY_MS,
    'Original fake rumor must persist correction_due_simulation_time'
  );

  // 2A: 재시작 시뮬레이션
  const db2 = new MemoryDatabase();
  const pm2 = new PersistenceManager(new FileStorageAdapter(tmpEngineDir));
  const restarted = await prepareEngineRestartRuntime(db2, pm2, { seed: 77 });
  assert.equal(restarted.restoredFromSnapshot, true, 'Restart must load snapshot');

  let clockNow2 = baseNow + 60_000; // +1분 (만료 전)
  const ctx2 = createSimulationContext({ seed: 77, clock: { now: () => clockNow2 }, runId: restarted.runId });
  const repos2 = createInMemoryRepositoryBundle(db2);
  const engine2 = new MarketEngine({ simulationContext: ctx2, repositories: repos2, persistence: pm2 });

  let failCorrectionSave = false;
  const director2 = new EventDirector(engine2, ctx2, repos2.event, undefined, {
    onPersist: async () => {
      if (failCorrectionSave) return false;
      return await pm2.saveSnapshot(db2);
    },
  });
  await director2.restorePendingCorrections();
  assert.equal(director2.getPendingCorrectionCount(), 1, 'Restored EventDirector must recover pending correction');

  // 만료 전: 발행되지 않아야 함
  const earlyPublished = await director2.processDueCorrections();
  assert.equal(earlyPublished, 0, 'Restored correction must NOT publish before due time');
  assert.equal(db2.marketNews.filter((n) => n.category === 'CORRECTION').length, 0);

  // 2B: 만료 도달 + 저장 실패 시 재시도 가능 여부 검증
  clockNow2 = baseNow + EventDirector.CORRECTION_DELAY_MS;
  failCorrectionSave = true;
  const failedCount = await director2.processDueCorrections();
  assert.equal(failedCount, 0, 'Failed correction save must return 0 published');
  assert.equal(director2.getPendingCorrectionCount(), 1, 'Failed correction must stay queued for retry');
  assert.equal(db2.marketNews.filter((n) => n.category === 'CORRECTION').length, 0, 'Failed correction must not remain in feed');

  // 저장 복구 후 재시도 -> 정확히 1회 발행
  failCorrectionSave = false;
  const retryCount = await director2.processDueCorrections();
  assert.equal(retryCount, 1, 'Retried due correction must publish once');
  assert.equal(director2.getPendingCorrectionCount(), 0, 'Queue must clear after successful correction');
  const corrections = db2.marketNews.filter((n) => n.category === 'CORRECTION');
  assert.equal(corrections.length, 1, 'Exactly one CORRECTION must exist');
  assert.equal(corrections[0].original_rumor_id, published!.id, 'Correction must reference original rumor id');

  // 재호출 및 재시작 시 중복 발행 방지
  const dupCount = await director2.processDueCorrections();
  assert.equal(dupCount, 0, 'Subsequent processDueCorrections must not duplicate');

  // 2C: 기존(레거시) 스냅샷 호환성 검증 (correction_due_simulation_time / original_rumor_id 미포함)
  const legacySnap = db2.exportSnapshot();
  legacySnap.marketNews = [
    {
      id: 'legacy_corrected_rumor',
      type: 'MICRO',
      category: 'RUMOR',
      publisher: '가십 썬',
      title: '이미 정정된 레거시 루머',
      content: '구버전 원문',
      impact_score: 5,
      is_fake: true,
      simulation_time: baseNow,
      created_at: new Date(baseNow).toISOString(),
    },
    {
      id: 'legacy_corr_1',
      type: 'MICRO',
      category: 'CORRECTION',
      publisher: '기업 전자공시 (DART)',
      title: '[정정 공시] 이미 정정된 레거시 루머은 사실무근으로 확인',
      content: '구버전 정정',
      impact_score: -5,
      is_fake: false,
      simulation_time: baseNow + 240_000,
      created_at: new Date(baseNow + 240_000).toISOString(),
    },
    {
      id: 'legacy_pending_rumor',
      type: 'MICRO',
      category: 'RUMOR',
      publisher: '가십 썬',
      title: '미정정 레거시 루머',
      content: '구버전 미정정 원문',
      impact_score: 6,
      is_fake: true,
      simulation_time: baseNow + 10_000,
      created_at: new Date(baseNow + 10_000).toISOString(),
    },
  ];
  const dbLegacy = new MemoryDatabase();
  dbLegacy.importSnapshot(legacySnap);
  let legacyClockNow = baseNow + 10_000 + 60_000; // 만료 전
  const ctxLegacy = createSimulationContext({ seed: 88, clock: { now: () => legacyClockNow }, runId: 'run_legacy' });
  const reposLegacy = createInMemoryRepositoryBundle(dbLegacy);
  const engLegacy = new MarketEngine({ simulationContext: ctxLegacy, repositories: reposLegacy });
  const dirLegacy = new EventDirector(engLegacy, ctxLegacy, reposLegacy.event);
  await dirLegacy.restorePendingCorrections();
  assert.equal(dirLegacy.getPendingCorrectionCount(), 1, 'Legacy snapshot must restore only uncorrected fake rumor');
  assert.equal(await dirLegacy.processDueCorrections(), 0, 'Legacy pending correction waits until +4m');
  legacyClockNow = baseNow + 10_000 + EventDirector.CORRECTION_DELAY_MS;
  assert.equal(await dirLegacy.processDueCorrections(), 1, 'Legacy pending correction fires once at +4m');

  console.log('  ✓ TEST 2 통과');
}

async function test3RealtimeChannelAndChartComponents() {
  console.log('▶ [TEST 3] lib/db/client.ts 실시간 폴링 채널 및 TickChart · StockChartV2 회귀 검증');

  const { HttpMemoryClient, setBrowserClient } = await import('../lib/db/client');
  const { MemoryDatabase, STOCK_UUID_MAP } = await import('../lib/memoryDb/memoryStore');
  const { createMemoryDbClient } = await import('../lib/memoryDb/memoryDbClient');
  const TickChart = (await import('../app/components/TickChart')).default;
  const StockChartV2 = (await import('../app/components/v2/StockChartV2')).default;
  const { ThemeProvider } = await import('../app/components/ThemeProvider');

  // 3A: HttpMemoryClient.channel 직접 단위 검증 (베이스라인 미발행, 중복 제거, 종목 필터, 언구독 중지)
  const db = new MemoryDatabase();
  const idA = STOCK_UUID_MAP['0010'];
  const idB = STOCK_UUID_MAP['0015'];
  const memClient = createMemoryDbClient(db);
  const tBase = Date.now() - 60_000;
  db.trades.push({
    id: 'tr_baseline_a',
    stock_id: idA,
    price: 72000,
    size: 5,
    buyer_is_bot: false,
    seller_is_bot: true,
    created_at: new Date(tBase).toISOString(),
    sequence: 1,
  });
  db.rebuildIndexes();

  const originalFetch = globalThis.fetch;
  let pollCounter = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === '/api/local-db' && init?.body) {
      const parsed = JSON.parse(String(init.body));
      if (parsed.tableName === 'trades') pollCounter++;
      const qb = memClient.from(parsed.tableName);
      for (const f of parsed.query?.filters || []) {
        if (f.op === 'eq') qb.eq(f.col, f.val);
        if (f.op === 'neq') qb.neq(f.col, f.val);
        if (f.op === 'gt') qb.gt(f.col, f.val);
        if (f.op === 'gte') qb.gte(f.col, f.val);
        if (f.op === 'lt') qb.lt(f.col, f.val);
        if (f.op === 'lte') qb.lte(f.col, f.val);
        if (f.op === 'in') qb.in(f.col, f.val);
      }
      if (parsed.query?.orderSpecs?.length) {
        for (const spec of parsed.query.orderSpecs) {
          qb.order(spec.col, { ascending: spec.ascending });
        }
      } else if (parsed.query?.orderCol) {
        qb.order(parsed.query.orderCol, { ascending: parsed.query.orderAsc ?? true });
      }
      if (parsed.query?.limitCount !== undefined) qb.limit(parsed.query.limitCount);
      if (parsed.query?.isSingle) qb.single();
      if (parsed.query?.isMaybeSingle) qb.maybeSingle();
      const res = await qb.execute();
      return new Response(JSON.stringify(res), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
  }) as typeof fetch;

  try {
    const fastClient = new HttpMemoryClient({ channelPollIntervalMs: 30 });
    const receivedA: any[] = [];
    const chA = fastClient
      .channel('unit_trades_a')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trades', filter: `stock_id=eq.${idA}` },
        (payload: any) => receivedA.push(payload.new)
      )
      .subscribe();

    await new Promise((r) => setTimeout(r, 45));
    assert.equal(receivedA.length, 0, 'Initial baseline trade must not be emitted as new INSERT');

    // 다른 종목(idB) 체결 + 대상 종목(idA) 신규 체결 1건 삽입
    db.trades.push(
      {
        id: 'tr_other_b',
        stock_id: idB,
        price: 210000,
        size: 3,
        buyer_is_bot: false,
        seller_is_bot: true,
        created_at: new Date(tBase + 5000).toISOString(),
        sequence: 2,
      },
      {
        id: 'tr_new_a_1',
        stock_id: idA,
        price: 73500,
        size: 10,
        buyer_is_bot: false,
        seller_is_bot: true,
        created_at: new Date(tBase + 5000).toISOString(),
        sequence: 3,
      }
    );
    db.rebuildIndexes();

    await new Promise((r) => setTimeout(r, 90));
    assert.equal(receivedA.length, 1, 'New trade for subscribed stock must be delivered once');
    assert.equal(receivedA[0].id, 'tr_new_a_1');

    // 추가 폴링이 돌아도 동일 ID 중복 전달 없어야 함
    await new Promise((r) => setTimeout(r, 90));
    assert.equal(receivedA.length, 1, 'Repeated polls must deduplicate tr_new_a_1');

    // 언구독 후 추가 체결 미수신 & 폴링 중단 확인
    fastClient.removeChannel(chA);
    const pollsAtUnsub = pollCounter;
    db.trades.push({
      id: 'tr_after_unsub',
      stock_id: idA,
      price: 74000,
      size: 2,
      buyer_is_bot: false,
      seller_is_bot: true,
      created_at: new Date(tBase + 10000).toISOString(),
      sequence: 4,
    });
    db.rebuildIndexes();
    await new Promise((r) => setTimeout(r, 90));
    assert.equal(receivedA.length, 1, 'No trade callbacks after removeChannel');
    assert.equal(pollCounter, pollsAtUnsub, 'Polling must stop immediately on removeChannel');

    // 3B: TickChart React/JSDOM 마운트 -> 실시간 체결 반영 -> 중복 무시 -> 종목 전환 -> 언마운트
    setBrowserClient(fastClient);
    createdSeriesSpies.length = 0;
    const container = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(container);
    const root = createRoot(container);

    const nowMs = Date.now();
    // TickChart가 synthetic 분기를 타지 않도록 6건의 초기 체결 시드
    db.trades = [];
    for (let i = 0; i < 6; i++) {
      db.trades.push({
        id: `tr_init_tick_${i}`,
        stock_id: idA,
        price: 72000 + i * 100,
        size: 2,
        buyer_is_bot: false,
        seller_is_bot: true,
        created_at: new Date(nowMs - (10 - i) * 1000).toISOString(),
        sequence: i + 1,
      });
    }
    db.rebuildIndexes();

    await act(async () => {
      root.render(
        <ThemeProvider>
          <TickChart ticker="0010" currentPrice={72500} market="domestic" />
        </ThemeProvider>
      );
    });
    await flushUi(80);

    const tickCandleSpy = createdSeriesSpies.find((s) => s.kind === 'Candlestick')!;
    assert.ok(tickCandleSpy && tickCandleSpy.data.length >= 1, 'TickChart must render initial candles');

    // 신규 실시간 체결 삽입 (고가/종가 갱신)
    db.trades.push({
      id: 'tr_live_tick_1',
      stock_id: idA,
      price: 74800,
      size: 7,
      buyer_is_bot: false,
      seller_is_bot: true,
      created_at: new Date(nowMs + 1000).toISOString(),
      sequence: 7,
    });
    db.rebuildIndexes();
    await flushUi(90);

    assert.ok(tickCandleSpy.updates.some((u) => u.close === 74800 && u.high >= 74800), 'TickChart must reflect live trade via channel polling');
    assert.equal(container.textContent?.includes('74,800'), true, 'TickChart OHLC chip must update with live trade price');
    const updatesBeforeDup = tickCandleSpy.updates.length;
    await flushUi(80);
    assert.equal(tickCandleSpy.updates.length, updatesBeforeDup, 'Duplicate poll must not re-update TickChart');

    // 종목 전환 (0010 -> 0015)
    db.trades.push({
      id: 'tr_b_live_1',
      stock_id: idB,
      price: 215000,
      size: 4,
      buyer_is_bot: false,
      seller_is_bot: true,
      created_at: new Date(nowMs + 2000).toISOString(),
      sequence: 8,
    });
    db.rebuildIndexes();

    await act(async () => {
      root.render(
        <ThemeProvider>
          <TickChart ticker="0015" currentPrice={210000} market="domestic" />
        </ThemeProvider>
      );
    });
    await flushUi(90);

    db.trades.push({
      id: 'tr_b_live_2',
      stock_id: idB,
      price: 219000,
      size: 5,
      buyer_is_bot: false,
      seller_is_bot: true,
      created_at: new Date(nowMs + 3000).toISOString(),
      sequence: 9,
    });
    db.rebuildIndexes();
    await flushUi(90);
    assert.equal(container.textContent?.includes('219,000'), true, 'TickChart after stock switch must render new stock live trades');

    // 3C: StockChartV2 (Pro mode) OHLC & Volume 누적 보존 검증
    createdSeriesSpies.length = 0;
    const bucketBase = Math.floor(nowMs / (10 * 60 * 1000)) * (10 * 60 * 1000);
    db.trades = [
      {
        id: 'tr_v2_init_1',
        stock_id: idA,
        price: 72000,
        size: 10,
        buyer_is_bot: false,
        seller_is_bot: true,
        created_at: new Date(bucketBase + 1000).toISOString(),
        sequence: 10,
      },
      {
        id: 'tr_v2_init_2',
        stock_id: idA,
        price: 73000,
        size: 15,
        buyer_is_bot: false,
        seller_is_bot: true,
        created_at: new Date(bucketBase + 2000).toISOString(),
        sequence: 11,
      },
    ];
    db.rebuildIndexes();

    await act(async () => {
      root.render(<StockChartV2 ticker="0010" currentPrice={73000} isProMode={true} />);
    });
    await flushUi(80);

    const v2CandleSpy = createdSeriesSpies.find((s) => s.kind === 'Candlestick')!;
    const v2VolumeSpy = createdSeriesSpies.find((s) => s.kind === 'Histogram')!;
    assert.ok(v2CandleSpy && v2VolumeSpy);

    // 같은 10분 버킷 내 하락 체결 (71000, size 20) -> open(72000), high(73000) 보존 & low(71000), close(71000), volume(45) 갱신!
    db.trades.push({
      id: 'tr_v2_live_3',
      stock_id: idA,
      price: 71000,
      size: 20,
      buyer_is_bot: false,
      seller_is_bot: true,
      created_at: new Date(bucketBase + 5000).toISOString(),
      sequence: 12,
    });
    db.rebuildIndexes();
    await flushUi(90);

    const latestV2Candle = v2CandleSpy.updates[v2CandleSpy.updates.length - 1];
    assert.ok(latestV2Candle, 'StockChartV2 must emit candle update on live trade');
    assert.equal(latestV2Candle.open, 72000, 'StockChartV2 Pro must preserve bucket open price');
    assert.equal(latestV2Candle.high, 73000, 'StockChartV2 Pro must preserve bucket high price');
    assert.equal(latestV2Candle.low, 71000, 'StockChartV2 Pro must update bucket low price');
    assert.equal(latestV2Candle.close, 71000, 'StockChartV2 Pro must update bucket close price');
    const latestV2Vol = v2VolumeSpy.updates[v2VolumeSpy.updates.length - 1];
    assert.equal(latestV2Vol?.value, 45, 'StockChartV2 Pro must accumulate trade volume (10 + 15 + 20 = 45)');

    // 언마운트 후 추가 폴링 중단 확인
    await act(async () => {
      root.unmount();
    });
    container.remove();
    const pollsAfterUnmount = pollCounter;
    await new Promise((r) => setTimeout(r, 90));
    assert.equal(pollCounter, pollsAfterUnmount, 'Unmounted charts must not continue polling');
  } finally {
    globalThis.fetch = originalFetch;
    setBrowserClient(null);
  }

  console.log('  ✓ TEST 3 통과');
}

async function test4OrderEntryUiClarity() {
  console.log('▶ [TEST 4] OrderEntry 시장가/지정가 버튼 UI 명확화 및 기존 주문 동작 보존 검증');

  const { setBrowserClient, HttpMemoryClient } = await import('../lib/db/client');
  const { GUEST_USER_ID, STOCK_UUID_MAP } = await import('../lib/memoryDb/memoryStore');
  const { ToastProvider } = await import('../app/components/ToastProvider');
  const OrderEntry = (await import('../app/components/OrderEntry')).default;

  const originalFetch = globalThis.fetch;
  const originalDisableGuest = process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'true';
  setBrowserClient(new HttpMemoryClient());

  const submittedOrders: any[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === '/api/orders') {
      submittedOrders.push(JSON.parse(String(init?.body)));
      return new Response(
        JSON.stringify({ success: true, filledQty: 0, message: '접수 완료' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (url === '/api/local-db' && init?.body) {
      const parsed = JSON.parse(String(init.body));
      if (parsed.tableName === 'exchange_rates') {
        return new Response(JSON.stringify({ data: { rate_to_krw: 1380 }, error: null }), { status: 200 });
      }
      if (parsed.tableName === 'stocks') {
        const rows = parsed.query?.isMaybeSingle
          ? { id: STOCK_UUID_MAP['0010'] }
          : [{ id: STOCK_UUID_MAP['0010'], market: 'domestic', ticker: '0010' }];
        return new Response(JSON.stringify({ data: rows, error: null }), { status: 200 });
      }
      if (parsed.tableName === 'options_contracts') {
        return new Response(JSON.stringify({ data: [], error: null }), { status: 200 });
      }
      if (parsed.tableName === 'profiles') {
        return new Response(JSON.stringify({ data: { cash: 10_000_000, margin_debt_krw: 0 }, error: null }), { status: 200 });
      }
      if (parsed.tableName === 'holdings') {
        return new Response(JSON.stringify({ data: { quantity: 100 }, error: null }), { status: 200 });
      }
      if (parsed.tableName === 'orders') {
        return new Response(JSON.stringify({ data: [], error: null }), { status: 200 });
      }
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
  }) as typeof fetch;

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  const sampleStock: any = {
    id: STOCK_UUID_MAP['0010'],
    ticker: '0010',
    name: '오성전자',
    market: 'domestic',
    currentPrice: 50000,
    previousClose: 50000,
    openPrice: 50000,
    high: 51000,
    low: 49000,
    volume: 1000,
    changeRate: 0,
    marketCap: 1000000000,
    peRatio: 10,
    dividendYield: 1,
    sector: '반도체',
  };

  try {
    await act(async () => {
      root.render(
        <SessionContext.Provider
          value={{
            status: 'authenticated',
            data: { user: { id: GUEST_USER_ID, email: 'user@test.local' } },
            update: async () => null,
          } as any}
        >
          <ToastProvider>
            <OrderEntry stock={sampleStock} />
          </ToastProvider>
        </SessionContext.Provider>
      );
    });
    await flushUi(50);

    const text = container.textContent || '';
    assert.equal(text.includes('시장가'), false, 'OrderEntry must NOT label limit helper buttons as 시장가');
    assert.equal(text.includes('지정가'), true, 'OrderEntry must clearly indicate 지정가 order type');
    assert.equal(text.includes('지정가 매수 주문 제출'), true, 'Submit button must clarify 지정가 order');

    const buttons = Array.from(container.querySelectorAll('button'));
    const quickBuy10Btn = buttons.find((b) => b.textContent?.includes('10% 매수 수량 입력'));
    const quickSell10Btn = buttons.find((b) => b.textContent?.includes('10% 매도 수량 입력'));
    assert.ok(quickBuy10Btn && quickSell10Btn, 'Quick quantity helper buttons must exist');

    // 보조 버튼 클릭 시 주문이 바로 제출되지 않고 수량/방향만 채워짐
    await act(async () => {
      quickSell10Btn!.click();
    });
    await flushUi(20);
    assert.equal(submittedOrders.length, 0, 'Quick helper button must NOT submit order immediately');
    assert.equal(container.textContent?.includes('지정가 매도 주문 제출'), true, 'Quick sell helper switches form side to sell');
    const inputs = container.querySelectorAll('input');
    assert.equal(inputs[1]?.value, '10', '10% of 100 holding shares = 10');

    await act(async () => {
      quickBuy10Btn!.click();
    });
    await flushUi(20);
    assert.equal(submittedOrders.length, 0, 'Quick buy helper must NOT submit order immediately');
    assert.equal(container.textContent?.includes('지정가 매수 주문 제출'), true);
    const expectedBuyQty = Math.floor((10_000_000 * 0.1) / (50000 * 1.0025));
    assert.equal(inputs[1]?.value, String(expectedBuyQty), 'Quick buy helper fills 10% affordable qty');

    const submitBtn = Array.from(container.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('지정가 매수 주문 제출')
    )!;
    await act(async () => {
      submitBtn.click();
    });
    await flushUi(40);
    assert.equal(submittedOrders.length, 1, 'Explicit submit button posts limit order');
    assert.equal(submittedOrders[0].side, 'buy');
    assert.equal(submittedOrders[0].price, 50000);
    assert.equal(submittedOrders[0].size, expectedBuyQty);
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

  console.log('  ✓ TEST 4 통과');
}

async function test5SharedPublicStockOrderRateLimit() {
  console.log('▶ [TEST 5] /api/orders 및 /api/local-db(submit_and_match_order) 공유 속도 제한 검증');

  const { ensureLocalStandaloneReady, stopLocalStandaloneEngine } = await import('../lib/engine/localStandaloneServer');
  const { memoryDb, STOCK_UUID_MAP } = await import('../lib/memoryDb/memoryStore');
  const { __resetStockOrderRateLimiterForTesting } = await import('../lib/rateLimit/stockOrderLimiter');
  const sessionAuth = await import('../lib/auth/sessionAuth');
  const nextAuth = await import('next-auth');
  const { POST: ordersPOST } = await import('../app/api/orders/route');
  const { POST: localDbPOST } = await import('../app/api/local-db/route');

  // Avoid touching guest fallback by creating two distinct authenticated accounts
  stopLocalStandaloneEngine();
  await ensureLocalStandaloneReady();

  const userA = 'rate_limit_user_a';
  const userB = 'rate_limit_user_b';
  memoryDb.ensureUserProfile(userA, { cash: 100_000_000 });
  memoryDb.ensureUserProfile(userB, { cash: 100_000_000 });
  const stockId = STOCK_UUID_MAP['0010'];

  const prevDisableGuest = process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  const prevAllowGuest = process.env.ALLOW_DEV_GUEST_AUTH;
  process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'true';
  delete process.env.ALLOW_DEV_GUEST_AUTH;

  const makeOrderReq = () =>
    new Request('http://localhost:3000/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock_id: stockId, side: 'buy', price: 1000, size: 1 }),
    });
  const makeLocalDbOrderReq = () =>
    new Request('http://localhost:3000/api/local-db', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'rpc',
        fnName: 'submit_and_match_order',
        params: { p_stock_id: stockId, p_side: 'buy', p_price: 1000, p_size: 1 },
      }),
    });

  const { allowStockOrderRequest } = await import('../lib/rateLimit/stockOrderLimiter');
  __resetStockOrderRateLimiterForTesting();

  // 5A: 단위 수준 고정 윈도우 및 계정 분리 검증
  for (let i = 0; i < 15; i++) {
    assert.equal(allowStockOrderRequest(userA, 10_000), true, `User A request #${i + 1} allowed`);
  }
  assert.equal(allowStockOrderRequest(userA, 10_000), false, 'User A 16th request blocked');
  assert.equal(allowStockOrderRequest(userB, 10_000), true, 'User B has independent quota');
  assert.equal(allowStockOrderRequest(userA, 11_000), true, 'User A resets after 1000ms window');

  // 5B: Route 핸들러 통합 검증 (/api/orders + /api/local-db 동일 계정 15건 공유 한도)
  __resetStockOrderRateLimiterForTesting();
  currentMockAuthUserId = userA;

  // User A: /api/orders 10회 + /api/local-db 5회 = 15회 정상 통과
  for (let i = 0; i < 10; i++) {
    const res = await ordersPOST(makeOrderReq());
    assert.equal(res.status, 200, `User A /api/orders #${i + 1} must succeed`);
  }
  for (let i = 0; i < 5; i++) {
    const res = await localDbPOST(makeLocalDbOrderReq());
    assert.equal(res.status, 200, `User A /api/local-db #${i + 11} must succeed`);
  }
  // User A 16번째 (/api/local-db) -> 429 차단
  const blockedLocalDb = await localDbPOST(makeLocalDbOrderReq());
  assert.equal(blockedLocalDb.status, 429, '16th combined stock order via /api/local-db must return 429');

  // User A가 차단된 상태에서 별도 계정 User B는 양쪽 엔드포인트 모두 정상 통과
  currentMockAuthUserId = userB;
  const userBOrderRes = await ordersPOST(makeOrderReq());
  assert.equal(userBOrderRes.status, 200, 'Separate authenticated User B must succeed on /api/orders while User A is limited');
  const userBLocalDbRes = await localDbPOST(makeLocalDbOrderReq());
  assert.equal(userBLocalDbRes.status, 200, 'Separate authenticated User B must succeed on /api/local-db while User A is limited');

  // 역순 검증: User A 리셋 후 /api/local-db 10회 + /api/orders 5회 -> 16번째 /api/orders 429 차단
  __resetStockOrderRateLimiterForTesting();
  currentMockAuthUserId = userA;
  for (let i = 0; i < 10; i++) {
    const res = await localDbPOST(makeLocalDbOrderReq());
    assert.equal(res.status, 200);
  }
  for (let i = 0; i < 5; i++) {
    const res = await ordersPOST(makeOrderReq());
    assert.equal(res.status, 200);
  }
  const blockedOrders = await ordersPOST(makeOrderReq());
  assert.equal(blockedOrders.status, 429, '16th combined stock order via /api/orders must return 429');

  // 미인증 요청은 401 반환
  currentMockAuthUserId = null;
  const unauthOrderRes = await ordersPOST(makeOrderReq());
  assert.equal(unauthOrderRes.status, 401, 'Unauthenticated /api/orders must return 401');
  const unauthLocalDbRes = await localDbPOST(makeLocalDbOrderReq());
  assert.equal(unauthLocalDbRes.status, 401, 'Unauthenticated /api/local-db submit_and_match_order must return 401');

  // Cleanup env
  currentMockAuthUserId = null;
  if (prevDisableGuest === undefined) delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  else process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = prevDisableGuest;
  if (prevAllowGuest === undefined) delete process.env.ALLOW_DEV_GUEST_AUTH;
  else process.env.ALLOW_DEV_GUEST_AUTH = prevAllowGuest;
  void sessionAuth;
  void nextAuth;
  stopLocalStandaloneEngine();

  console.log('  ✓ TEST 5 통과');
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('🧪 REGRESSION TEST SUITE FOR 5 REVIEW FIXES');
  console.log('════════════════════════════════════════════════════════════════');
  try {
    await test1AdminManualStepClockPersistence();
    await test2EventDirectorCorrectionPersistenceAndRestore();
    await test3RealtimeChannelAndChartComponents();
    await test4OrderEntryUiClarity();
    await test5SharedPublicStockOrderRateLimit();
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('🎉 ALL 5 REVIEW REGRESSION TESTS PASSED!');
    console.log('════════════════════════════════════════════════════════════════');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Regression suite failed:', err);
    process.exit(1);
  });
