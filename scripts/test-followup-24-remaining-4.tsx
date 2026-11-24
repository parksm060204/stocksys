/**
 * scripts/test-followup-24-remaining-4.tsx
 *
 * Regression test suite for the remaining 4 integrity fixes from #24 2nd follow-up review:
 * 1. P2-1: LocalMarketEngineInstance runTick() & stepSimulation() scheduled news save boundary + mid-step sync.
 * 2. P2-2: HttpMemoryClient + /api/local-db tradeGeneration & resync contract on lower/reused cursors,
 *    mid-incremental transitions, reconnects, and minimal mocks without metadata.
 * 3. P3-1: /api/local-db public trades SELECT serialized behind commit gate (no uncommitted/rolled-back rows).
 * 4. P3-2: TickChart 0..5 real trades rendering and placeholder replacement on wall-clock & sim-clock axes.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { JSDOM } from 'jsdom';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-followup24-4fixes-'));
const tmpMainDir = path.join(tmpRoot, 'main-data');
fs.mkdirSync(tmpMainDir, { recursive: true });

process.env.STOCKSYS_DATA_DIR = tmpMainDir;
process.env.ALLOW_DEV_GUEST_AUTH = 'true';
process.env.ALLOW_DEV_ADMIN = 'true';

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

interface ChartSeriesSpy {
  kind: string;
  data: any[];
  updates: any[];
  setDataCalls: any[][];
  setData: (d: any[]) => void;
  update: (item: any) => void;
  applyOptions: () => void;
  createPriceLine: () => void;
}
const createdSeriesSpies: ChartSeriesSpy[] = [];
const CandlestickSeriesToken = { __type: 'Candlestick' };
const LineSeriesToken = { __type: 'Line' };
const HistogramSeriesToken = { __type: 'Histogram' };

const origLoad = (Module as any)._load;
(Module as any)._load = function (request: string, parent: any, isMain: boolean) {
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
            setDataCalls: [],
            setData(d: any[]) {
              const copy = Array.isArray(d) ? d.map((x) => ({ ...x })) : [];
              spy.data = copy;
              spy.setDataCalls.push(copy);
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

async function flushUi(ms: number = 40) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout (${ms}ms): ${label}`)), ms)
    ),
  ]);
}

async function test1AutoTickAndMidStepScheduledNewsBoundary() {
  console.log('▶ [TEST 1] P2-1: runTick() 예약 뉴스 복원(false/throw)·스텝 중 동시 주문 정합·재시작 충격 단회성 검증');

  const {
    ensureLocalStandaloneReady,
    getLocalStandaloneEngine,
    stopLocalStandaloneEngine,
  } = await import('../lib/engine/localStandaloneServer');
  const { POST: ordersPOST } = await import('../app/api/orders/route');
  const { memoryDb, GUEST_USER_ID, STOCK_UUID_MAP } = await import('../lib/memoryDb/memoryStore');
  const { persistenceManager } = await import('../lib/memoryDb/PersistenceManager');

  stopLocalStandaloneEngine();
  fs.rmSync(path.join(tmpMainDir, 'snapshot.json'), { force: true });
  await ensureLocalStandaloneReady();
  const engine = getLocalStandaloneEngine()!;
  engine.stop();

  const stockId = STOCK_UUID_MAP['0010'];
  const agentMgr = engine.__getAgentManagerForTesting();
  const t0 = engine.getSimulationTime();
  const t1 = t0 + 1000;
  const origAtt = agentMgr.attentionMap.get(stockId);
  const origUnc = agentMgr.uncertaintyMap.get(stockId);

  const scheduledAutoEvt = {
    eventId: 'evt_auto_tick_rollback',
    eventType: 'OFFICIAL' as const,
    title: '자동 틱 예약 뉴스 저장 실패 복원 검증',
    content: '본문',
    publisher: '로이터',
    scope: 'stock' as const,
    targetStockIds: [stockId],
    valuationSignal: 0.4,
    attentionShock: 0.25,
    uncertaintyShock: 0.2,
    confidence: 0.9,
    halfLife: 60,
    publishedAt: t1,
    effectiveFrom: t1,
  };
  memoryDb.pendingAdminMarketEvents = [scheduledAutoEvt as any];
  await persistenceManager.saveSnapshot(memoryDb);

  const origSaveSnapshot = persistenceManager.saveSnapshot.bind(persistenceManager);

  // 1A-1: runTick() when saveSnapshot returns false
  persistenceManager.saveSnapshot = async () => false;
  try {
    await withTimeout(engine.tick(), 3000, 'auto tick false');
  } finally {
    persistenceManager.saveSnapshot = origSaveSnapshot;
  }
  assert.equal(engine.lastPersistOk, false, 'runTick must mark lastPersistOk=false on save false');
  assert.equal(engine.getSimulationTime(), t0, 'runTick must restore clock to T0 on save false');
  assert.equal(memoryDb.localSimulationClock?.simulationTime, t0, 'memoryDb clock must remain T0');
  assert.equal(memoryDb.marketNews.some((n) => n.id === scheduledAutoEvt.eventId), false, 'marketNews must roll back');
  assert.equal(memoryDb.pendingAdminMarketEvents.length, 1, 'pendingAdminMarketEvents must retain event');
  assert.equal(agentMgr.publishedEventIds.has(scheduledAutoEvt.eventId), false, 'publishedEventIds must roll back');
  assert.equal(agentMgr.effectiveEventIds.has(scheduledAutoEvt.eventId), false, 'effectiveEventIds must roll back');
  assert.equal(agentMgr.attentionMap.get(stockId), origAtt, 'attentionMap must roll back');
  assert.equal(agentMgr.uncertaintyMap.get(stockId), origUnc, 'uncertaintyMap must roll back');

  // 1A-2: runTick() when saveSnapshot throws
  persistenceManager.saveSnapshot = async () => {
    throw new Error('Injected auto-tick throw');
  };
  try {
    await withTimeout(engine.tick(), 3000, 'auto tick throw');
  } finally {
    persistenceManager.saveSnapshot = origSaveSnapshot;
  }
  assert.equal(engine.lastPersistOk, false, 'runTick must mark lastPersistOk=false on save throw');
  assert.equal(engine.getSimulationTime(), t0, 'runTick must restore clock to T0 on save throw');
  assert.equal(memoryDb.marketNews.some((n) => n.id === scheduledAutoEvt.eventId), false, 'marketNews must roll back on throw');
  assert.equal(memoryDb.pendingAdminMarketEvents.length, 1, 'pendingAdminMarketEvents must remain on throw');
  assert.equal(agentMgr.effectiveEventIds.has(scheduledAutoEvt.eventId), false, 'effectiveEventIds must roll back on throw');
  assert.equal(agentMgr.uncertaintyMap.get(stockId), origUnc, 'uncertaintyMap must roll back on throw');

  // 1A-3: Recover persistence and runTick() -> publishes & shocks once
  await withTimeout(engine.tick(), 3000, 'auto tick recovery');
  assert.equal(engine.lastPersistOk, true);
  assert.equal(engine.getSimulationTime(), t1);
  assert.equal(memoryDb.marketNews.filter((n) => n.id === scheduledAutoEvt.eventId).length, 1);
  assert.equal(memoryDb.pendingAdminMarketEvents.length, 0);
  assert.equal(agentMgr.effectiveEventIds.has(scheduledAutoEvt.eventId), true);

  // 1B: stepSimulation mid-step concurrent /api/orders save succeeds + final step save fails
  const t2 = t1 + 1000;
  const midStepEvt = {
    eventId: 'evt_midstep_concurrent_order_sync',
    eventType: 'OFFICIAL' as const,
    title: '중간 동시 주문 저장 시 예약 뉴스 큐 일관성 검증',
    content: '본문',
    publisher: '블룸버그',
    scope: 'stock' as const,
    targetStockIds: [stockId],
    valuationSignal: 0.35,
    attentionShock: 0.2,
    uncertaintyShock: 0.25,
    confidence: 0.9,
    halfLife: 60,
    publishedAt: t2,
    effectiveFrom: t2,
  };
  memoryDb.pendingAdminMarketEvents = [midStepEvt as any];
  memoryDb.profiles.get(GUEST_USER_ID)!.cash = 100_000_000;
  await origSaveSnapshot(memoryDb);

  const origStep = agentMgr.step.bind(agentMgr);
  let releaseConcurrentOrderDone!: () => void;
  const concurrentOrderDone = new Promise<void>((res) => {
    releaseConcurrentOrderDone = res;
  });

  // Pause inside agentManager.step AFTER processDuePublications/processDueEffects (by wrapping submitBotOrder/step tail)
  let injectedStepDelay = false;
  (agentMgr as any).step = async (dt: number) => {
    await origStep(dt);
    if (!injectedStepDelay) {
      injectedStepDelay = true;
      await concurrentOrderDone;
    }
  };

  let stepSaveCalls = 0;
  const failingStepPersist = async () => {
    stepSaveCalls++;
    return false;
  };

  const stepPromise = engine.stepSimulation(1.0, failingStepPersist);
  // Let step() advance clock & publish/apply news, then submit concurrent user order using real persistenceManager
  await new Promise((r) => setTimeout(r, 25));
  const orderRes = await withTimeout(
    ordersPOST(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_id: stockId, side: 'buy', price: 1000, size: 1 }),
      })
    ),
    4000,
    'concurrent user order during step'
  );
  assert.equal(orderRes.status, 200, 'Concurrent /api/orders must succeed cleanly');
  releaseConcurrentOrderDone();

  let stepRejected = false;
  try {
    await withTimeout(stepPromise, 4000, 'stepSimulation final fail');
  } catch {
    stepRejected = true;
  } finally {
    (agentMgr as any).step = origStep;
  }
  assert.equal(stepRejected, true, 'Failed final step save must reject');
  assert.ok(stepSaveCalls >= 1);

  const diskSnap = JSON.parse(fs.readFileSync(path.join(tmpMainDir, 'snapshot.json'), 'utf8'));
  const diskHasNews = diskSnap.marketNews.some((n: any) => n.id === midStepEvt.eventId);
  const diskHasPending = (diskSnap.pendingAdminMarketEvents || []).some((e: any) => e.eventId === midStepEvt.eventId);
  assert.equal(diskHasNews, true, 'Disk snapshot saved by concurrent order must contain published news');
  assert.equal(diskHasPending, false, 'Disk snapshot must NOT contain already-effective news in pendingAdminMarketEvents');
  assert.equal(diskSnap.localSimulationClock?.simulationTime, t2, 'Disk snapshot clock must be T2');
  assert.equal(memoryDb.pendingAdminMarketEvents.length, 0, 'In-memory pending queue must match disk');

  // Restart from disk and verify shock is NOT re-applied a tick late
  stopLocalStandaloneEngine();
  await ensureLocalStandaloneReady();
  const restarted = getLocalStandaloneEngine()!;
  restarted.stop();
  assert.equal(restarted.getSimulationTime(), t2);
  assert.equal(memoryDb.marketNews.filter((n) => n.id === midStepEvt.eventId).length, 1);
  assert.equal(memoryDb.pendingAdminMarketEvents.length, 0);

  const restartedMgr = restarted.__getAgentManagerForTesting();
  const uncBeforeRestartStep = restartedMgr.uncertaintyMap.get(stockId) ?? 0.05;
  await withTimeout(restarted.stepSimulation(1.0), 4000, 'restarted stepSimulation');
  const uncAfterRestartStep = restartedMgr.uncertaintyMap.get(stockId) ?? 0.05;
  assert.ok(
    uncAfterRestartStep <= uncBeforeRestartStep + 1e-9,
    `Restarted step must NOT re-apply shock (before=${uncBeforeRestartStep}, after=${uncAfterRestartStep})`
  );
  assert.equal(memoryDb.marketNews.filter((n) => n.id === midStepEvt.eventId).length, 1);

  stopLocalStandaloneEngine();
  console.log('  ✓ TEST 1 통과');
}

async function test2SharedSubscriptionGenerationAndResync() {
  console.log('▶ [TEST 2] P2-2: 공유 구독 세대·재동기화 계약 (낮은 커서·동일 커서 재사용·스냅샷 롤백·중간 전환·재접속·무메타 목)');

  const { HttpMemoryClient, setBrowserClient } = await import('../lib/db/client');
  const { MemoryDatabase, STOCK_UUID_MAP } = await import('../lib/memoryDb/memoryStore');
  const { createMemoryDbClient } = await import('../lib/memoryDb/memoryDbClient');
  const TickChart = (await import('../app/components/TickChart')).default;
  const StockChartV2 = (await import('../app/components/v2/StockChartV2')).default;
  const StockChart = (await import('../app/components/StockChart')).default;
  const ParticipantFlowWidget = (await import('../app/components/ParticipantFlowWidget')).default;
  const { ThemeProvider } = await import('../app/components/ThemeProvider');

  const idA = STOCK_UUID_MAP['0010'];
  const simBaseMs = 1773500000000;

  let activeDb = new MemoryDatabase();
  activeDb.trades = [];
  activeDb.rebuildIndexes();
  let simulateError = false;
  let omitMeta = false;
  let onAfterTradesResponse: ((parsed: any, res: any) => void) | null = null;

  const sanitizeTrade = (t: any) => ({
    id: t.id,
    stock_id: t.stock_id,
    price: t.price,
    size: t.size,
    buyer_is_bot: t.buyer_is_bot,
    seller_is_bot: t.seller_is_bot,
    created_at: t.created_at,
    ...(t.sequence !== undefined ? { sequence: t.sequence } : {}),
    ...(t.cursor !== undefined ? { cursor: t.cursor } : {}),
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === '/api/local-db' && init?.body) {
      const parsed = JSON.parse(String(init.body));
      if (parsed.tableName === 'trades' && simulateError) {
        return new Response(JSON.stringify({ data: null, error: { message: 'Simulated disconnect' } }), { status: 500 });
      }
      const client = createMemoryDbClient(activeDb);
      const qb = client.from(parsed.tableName);
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
        for (const spec of parsed.query.orderSpecs) qb.order(spec.col, { ascending: spec.ascending });
      } else if (parsed.query?.orderCol) {
        qb.order(parsed.query.orderCol, { ascending: parsed.query.orderAsc ?? true });
      }
      if (parsed.query?.limitCount !== undefined) qb.limit(parsed.query.limitCount);
      if (parsed.query?.isSingle) qb.single();
      if (parsed.query?.isMaybeSingle) qb.maybeSingle();

      const res = await qb.execute();
      if (parsed.tableName === 'trades' && Array.isArray(res.data)) {
        res.data = res.data.map(sanitizeTrade);
        if (omitMeta) {
          delete res.meta;
        }
        onAfterTradesResponse?.(parsed, res);
      }
      return new Response(JSON.stringify(res), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
  }) as typeof fetch;

  try {
    // Seed G1 with 10 trades (cursor 1..10)
    for (let i = 1; i <= 10; i++) {
      activeDb.appendTrade({
        id: `g1_tr_${i}`,
        stock_id: idA,
        price: 70000 + i * 100,
        size: 100,
        buyer_is_bot: true,
        seller_is_bot: false,
        created_at: new Date(simBaseMs + i * 1000).toISOString(),
        sequence: i,
      });
    }
    const g1Snapshot = activeDb.exportSnapshot();

    const fastClient = new HttpMemoryClient({ channelPollIntervalMs: 25 });
    setBrowserClient(fastClient);

    const rawEvents: any[] = [];
    const rawCh = fastClient
      .channel('raw_gen_probe')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trades', filter: `stock_id=eq.${idA}` }, (p) => {
        rawEvents.push(p.new);
      })
      .subscribe();

    const stockA: any = {
      id: idA,
      ticker: '0010',
      name: '오성전자',
      market: 'domestic',
      currentPrice: 71000,
      previousClose: 70000,
      openPrice: 70000,
      high: 72000,
      low: 70000,
      volume: 1000,
      changeRate: 1.4,
      marketCap: 1e12,
      peRatio: 10,
      dividendYield: 1,
      sector: '반도체',
    };

    createdSeriesSpies.length = 0;
    const container = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ThemeProvider>
          <TickChart ticker="0010" currentPrice={71000} market="domestic" />
          <StockChartV2 ticker="0010" currentPrice={71000} isProMode={true} />
          <StockChart stock={stockA} />
          <ParticipantFlowWidget stockId={idA} />
        </ThemeProvider>
      );
    });
    await flushUi(90);

    // 2A: Restart server with fresh DB & lower cursor (2 trades, cursor 1..2 < 10)
    const freshDb2 = new MemoryDatabase();
    freshDb2.trades = [];
    freshDb2.rebuildIndexes();
    freshDb2.appendTrade({
      id: 'g2_tr_1',
      stock_id: idA,
      price: 81000,
      size: 1000,
      buyer_is_bot: true,
      seller_is_bot: false,
      created_at: new Date(simBaseMs + 20_000).toISOString(),
    });
    freshDb2.appendTrade({
      id: 'g2_tr_2',
      stock_id: idA,
      price: 82000,
      size: 1000,
      buyer_is_bot: true,
      seller_is_bot: false,
      created_at: new Date(simBaseMs + 21_000).toISOString(),
    });
    activeDb = freshDb2;

    await flushUi(110);
    // Append 1 live trade in G2 after resync
    activeDb.appendTrade({
      id: 'g2_tr_3_live',
      stock_id: idA,
      price: 83000,
      size: 1000,
      buyer_is_bot: true,
      seller_is_bot: false,
      created_at: new Date(simBaseMs + 22_000).toISOString(),
    });
    await flushUi(90);

    assert.equal(rawEvents.some((r) => r.id === 'g2_tr_1'), true, 'Raw channel must deliver lower-cursor trade after restart');
    assert.equal(rawEvents.some((r) => r.id === 'g2_tr_3_live'), true, 'Raw channel must continue receiving live trades in G2');
    assert.equal(container.textContent?.includes('83,000'), true, 'Charts must render new generation live price 83,000');
    assert.equal(container.textContent?.includes('LIVE (3건)'), true, 'StockChart must reset to 3 trades of G2 (not 10+3)');
    const expectedG2Eok = (81000 * 1000 + 82000 * 1000 + 83000 * 1000) / 1e8; // 2.46억
    assert.equal(
      container.textContent?.includes(expectedG2Eok.toLocaleString()),
      true,
      `ParticipantFlowWidget must reset & accumulate G2 net flow (${expectedG2Eok.toLocaleString()})`
    );

    // 2B: Fresh server restart reusing EXACT same cursor count (cursor 1..3 matching old cursor 3!)
    const freshDb3 = new MemoryDatabase();
    freshDb3.trades = [];
    freshDb3.rebuildIndexes();
    for (let i = 1; i <= 3; i++) {
      freshDb3.appendTrade({
        id: `g3_reused_cursor_${i}`,
        stock_id: idA,
        price: 91000 + i * 1000,
        size: 500,
        buyer_is_bot: false,
        seller_is_bot: true,
        created_at: new Date(simBaseMs + 40_000 + i * 1000).toISOString(),
      });
    }
    activeDb = freshDb3;
    await flushUi(110);
    assert.equal(rawEvents.some((r) => r.id === 'g3_reused_cursor_3'), true, 'Generation change must detect reused identical cursor numbers');
    assert.equal(container.textContent?.includes('94,000'), true, 'Charts must update even when new DB reuses exact same cursor numbers');

    // 2C: Past snapshot restore (importSnapshot with fewer trades)
    const freshDb4 = new MemoryDatabase();
    freshDb4.importSnapshot(g1Snapshot);
    activeDb = freshDb4;
    await flushUi(110);
    assert.equal(container.textContent?.includes('LIVE (10건)'), true, 'Restoring past snapshot must resync widgets to snapshot trade count');

    // 2D: Mid-incremental-request transition (250 trades -> page 1 of 200 -> switch DB mid-cycle) + reconnect
    const raw2D: any[] = [];
    const ch2D = fastClient
      .channel('mid_poll_transition')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trades', filter: `stock_id=eq.${idA}` }, (p) => {
        raw2D.push(p.new);
      })
      .subscribe();
    await flushUi(60); // baseline initialized at G4 cursor 10

    for (let i = 1; i <= 250; i++) {
      activeDb.appendTrade({
        id: `g4_burst_${i}`,
        stock_id: idA,
        price: 75000,
        size: 1,
        buyer_is_bot: true,
        seller_is_bot: true,
        created_at: new Date(simBaseMs + 60_000).toISOString(),
        sequence: i,
      });
    }
    let switchedMidBurst = false;
    onAfterTradesResponse = (parsed, res) => {
      if (!switchedMidBurst && Array.isArray(res.data) && res.data.length === 200) {
        switchedMidBurst = true;
        // Mid-incremental-request server restart with 4 trades!
        const nextDb = new MemoryDatabase();
        nextDb.trades = [];
        nextDb.rebuildIndexes();
        for (let k = 1; k <= 4; k++) {
          nextDb.appendTrade({
            id: `g5_after_mid_${k}`,
            stock_id: idA,
            price: 88000,
            size: 1,
            buyer_is_bot: true,
            seller_is_bot: true,
            created_at: new Date(simBaseMs + 70_000).toISOString(),
          });
        }
        activeDb = nextDb;
      }
    };
    await flushUi(120);
    onAfterTradesResponse = null;
    assert.equal(switchedMidBurst, true);
    const g5Delivered = raw2D.filter((r) => String(r.id).startsWith('g5_after_mid_'));
    assert.equal(g5Delivered.length, 4, 'Mid-incremental generation transition must deliver all 4 new-gen trades');
    assert.equal(new Set(g5Delivered.map((r) => r.id)).size, 4, 'Zero duplicate deliveries across mid-incremental transition');

    // Reconnect after transient 500 error (same gen)
    simulateError = true;
    await flushUi(60);
    activeDb.appendTrade({
      id: 'g5_during_outage_1',
      stock_id: idA,
      price: 89000,
      size: 1,
      buyer_is_bot: true,
      seller_is_bot: true,
      created_at: new Date(simBaseMs + 75_000).toISOString(),
    });
    await flushUi(60);
    simulateError = false;
    await flushUi(90);
    assert.equal(raw2D.filter((r) => r.id === 'g5_during_outage_1').length, 1, 'Normal reconnect must deliver missed trade exactly once');

    // 2E: Fallback without `meta` (custom mock omitting metadata, including shared multi-listener partial page)
    omitMeta = true;
    const noMetaReceived: any[] = [];
    const noMetaLowCursorReceived: any[] = [];
    const chNoMetaLow = fastClient
      .channel('no_meta_fallback_low')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trades', filter: `stock_id=eq.${idA}`, afterCursor: 0 },
        (p) => noMetaLowCursorReceived.push(p.new)
      )
      .subscribe();
    const chNoMeta = fastClient
      .channel('no_meta_fallback')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trades', filter: `stock_id=eq.${idA}`, afterCursor: 100 },
        (p) => noMetaReceived.push(p.new)
      )
      .subscribe();
    const fallbackDb = new MemoryDatabase();
    fallbackDb.trades = [];
    fallbackDb.rebuildIndexes();
    fallbackDb.appendTrade({
      id: 'nometa_tr_1',
      stock_id: idA,
      price: 65000,
      size: 1,
      buyer_is_bot: true,
      seller_is_bot: true,
      created_at: new Date(simBaseMs + 80_000).toISOString(),
    });
    activeDb = fallbackDb;
    await flushUi(120);
    assert.equal(noMetaReceived.length, 1, 'Fallback probe without meta must detect cursor regression even with lower-cursor peer');
    assert.equal(noMetaReceived[0].id, 'nometa_tr_1');
    assert.equal(noMetaLowCursorReceived.some((r) => r.id === 'nometa_tr_1'), true);

    fastClient.removeChannel(rawCh);
    fastClient.removeChannel(ch2D);
    fastClient.removeChannel(chNoMetaLow);
    fastClient.removeChannel(chNoMeta);
    await act(async () => {
      root.unmount();
    });
    container.remove();
  } finally {
    globalThis.fetch = originalFetch;
    setBrowserClient(null);
  }

  console.log('  ✓ TEST 2 통과');
}

async function test3LocalDbTradesReadCommitGateIsolation() {
  console.log('▶ [TEST 3] P3-1: /api/local-db 공개 체결 읽기 커밋 게이트 직렬화(주문 저장 실패/성공 동시성) 검증');

  const {
    ensureLocalStandaloneReady,
    getLocalStandaloneEngine,
    stopLocalStandaloneEngine,
  } = await import('../lib/engine/localStandaloneServer');
  const { POST: localDbPOST } = await import('../app/api/local-db/route');
  const { POST: ordersPOST } = await import('../app/api/orders/route');
  const { memoryDb, GUEST_USER_ID, STOCK_UUID_MAP } = await import('../lib/memoryDb/memoryStore');
  const { persistenceManager } = await import('../lib/memoryDb/PersistenceManager');

  stopLocalStandaloneEngine();
  fs.rmSync(path.join(tmpMainDir, 'snapshot.json'), { force: true });
  await ensureLocalStandaloneReady();
  const engine = getLocalStandaloneEngine()!;
  engine.stop();

  const stockId = STOCK_UUID_MAP['0010'];
  memoryDb.trades = [];
  memoryDb.orders.clear();
  memoryDb.rebuildIndexes();
  memoryDb.profiles.get(GUEST_USER_ID)!.cash = 100_000_000;
  memoryDb.ensureUserProfile('maker_seller_p3', { cash: 100_000_000 });
  const stk = memoryDb.stocks.get(stockId)!;
  memoryDb.holdings.set(`maker_seller_p3_${stockId}`, {
    id: `maker_seller_p3_${stockId}`,
    user_id: 'maker_seller_p3',
    stock_id: stockId,
    quantity: 100,
    avg_price: stk.current_price,
    created_at: memoryDb.getIsoTimestamp(),
  });
  memoryDb.orders.set('maker_ask_1', {
    id: 'maker_ask_1',
    stock_id: stockId,
    user_id: 'maker_seller_p3',
    side: 'sell',
    price: stk.current_price,
    size: 10,
    filled: 0,
    status: 'open',
    is_lp: false,
    created_at: new Date(1773500000000).toISOString(),
  });
  memoryDb.rebuildIndexes();

  const readPublicTrades = async () => {
    const res = await localDbPOST(
      new Request('http://localhost:3000/api/local-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          tableName: 'trades',
          query: {
            action: 'select',
            filters: [{ col: 'stock_id', op: 'eq', val: stockId }],
            orderSpecs: [{ col: 'cursor', ascending: true }],
            limitCount: 200,
          },
        }),
      })
    );
    return { status: res.status, body: await res.json() };
  };

  const origSaveSnapshot = persistenceManager.saveSnapshot.bind(persistenceManager);

  // 3A: Order persist delayed then FAILS -> concurrent public trades read must wait for commitGate & see 0 rows!
  let saveEntered!: () => void;
  const saveEnteredPromise = new Promise<void>((res) => { saveEntered = res; });
  let resolveSave!: (ok: boolean) => void;
  const saveDecisionPromise = new Promise<boolean>((res) => { resolveSave = res; });

  persistenceManager.saveSnapshot = async () => {
    saveEntered();
    return await saveDecisionPromise;
  };

  const failingOrderPromise = ordersPOST(
    new Request('http://localhost:3000/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock_id: stockId, side: 'buy', price: stk.current_price, size: 2 }),
    })
  );

  await withTimeout(saveEnteredPromise, 3000, 'order enters saveSnapshot (fail case)');
  // At this exact instant, memoryDb.trades temporarily holds the uncommitted trade awaiting saveDecisionPromise!
  assert.equal(memoryDb.trades.length, 1, 'Sanity: trade is temporarily in memoryDb before persist finishes');

  const concurrentReadPromise = readPublicTrades();
  resolveSave(false);

  const [orderFailRes, readAfterFail] = await withTimeout(
    Promise.all([failingOrderPromise, concurrentReadPromise]),
    4000,
    '3A fail race'
  );
  assert.equal(orderFailRes.status, 500, 'Failed save must fail order');
  assert.equal(readAfterFail.status, 200);
  assert.equal(readAfterFail.body.data.length, 0, 'Public trades SELECT must NEVER expose rolled-back trade');

  // 3B: Order persist delayed then SUCCEEDS -> concurrent public trades read waits and receives committed trade (public cols only)
  let saveEntered2!: () => void;
  const saveEnteredPromise2 = new Promise<void>((res) => { saveEntered2 = res; });
  let resolveSave2!: (ok: boolean) => void;
  const saveDecisionPromise2 = new Promise<boolean>((res) => { resolveSave2 = res; });

  persistenceManager.saveSnapshot = async (dbArg) => {
    saveEntered2();
    const ok = await saveDecisionPromise2;
    if (!ok) return false;
    return await origSaveSnapshot(dbArg);
  };

  const succeedingOrderPromise = ordersPOST(
    new Request('http://localhost:3000/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock_id: stockId, side: 'buy', price: stk.current_price, size: 2 }),
    })
  );

  await withTimeout(saveEnteredPromise2, 3000, 'order enters saveSnapshot (success case)');
  const concurrentReadPromise2 = readPublicTrades();
  resolveSave2(true);

  const [orderOkRes, readAfterOk] = await withTimeout(
    Promise.all([succeedingOrderPromise, concurrentReadPromise2]),
    4000,
    '3B success race'
  );
  persistenceManager.saveSnapshot = origSaveSnapshot;

  assert.equal(orderOkRes.status, 200, 'Successful save must confirm order');
  assert.equal(readAfterOk.status, 200);
  assert.equal(readAfterOk.body.data.length, 1, 'Public trades SELECT must return the committed trade');
  assert.equal('buyer_id' in readAfterOk.body.data[0], false, 'Public trade response must omit buyer_id');
  assert.equal('seller_id' in readAfterOk.body.data[0], false, 'Public trade response must omit seller_id');
  assert.equal(typeof readAfterOk.body.meta?.tradeGeneration, 'string', 'Public trades response must include meta.tradeGeneration');

  stopLocalStandaloneEngine();
  console.log('  ✓ TEST 3 통과');
}

async function test4TickChartSmallTradesAndPlaceholderReplacement() {
  console.log('▶ [TEST 4] P3-2: TickChart 0~5건 실체결 우선·임시 캔들 교체·벽시계/가상시계 시간축 검증');

  const { HttpMemoryClient, setBrowserClient } = await import('../lib/db/client');
  const { MemoryDatabase, STOCK_UUID_MAP } = await import('../lib/memoryDb/memoryStore');
  const { createMemoryDbClient } = await import('../lib/memoryDb/memoryDbClient');
  const TickChart = (await import('../app/components/TickChart')).default;
  const { ThemeProvider } = await import('../app/components/ThemeProvider');

  const idA = STOCK_UUID_MAP['0010'];
  const simBaseMs = 1773500000000;
  const wallBaseMs = Date.now();

  const db = new MemoryDatabase();
  db.trades = [];
  db.rebuildIndexes();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === '/api/local-db' && init?.body) {
      const parsed = JSON.parse(String(init.body));
      const qb = createMemoryDbClient(db).from(parsed.tableName);
      for (const f of parsed.query?.filters || []) {
        if (f.op === 'eq') qb.eq(f.col, f.val);
        if (f.op === 'gte') qb.gte(f.col, f.val);
      }
      if (parsed.query?.orderSpecs?.length) {
        for (const s of parsed.query.orderSpecs) qb.order(s.col, { ascending: s.ascending });
      } else if (parsed.query?.orderCol) {
        qb.order(parsed.query.orderCol, { ascending: parsed.query.orderAsc ?? true });
      }
      if (parsed.query?.limitCount !== undefined) qb.limit(parsed.query.limitCount);
      if (parsed.query?.isSingle) qb.single();
      if (parsed.query?.isMaybeSingle) qb.maybeSingle();
      return new Response(JSON.stringify(await qb.execute()), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
  }) as typeof fetch;

  const fastClient = new HttpMemoryClient({ channelPollIntervalMs: 25 });
  setBrowserClient(fastClient);

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  try {
    // 4A: 0 trades -> synthetic placeholder -> first real simTime trade replaces placeholder completely
    createdSeriesSpies.length = 0;
    await act(async () => {
      root.render(
        <ThemeProvider>
          <TickChart ticker="0010" currentPrice={72000} market="domestic" />
        </ThemeProvider>
      );
    });
    await flushUi(70);
    const spy0 = createdSeriesSpies.find((s) => s.kind === 'Candlestick')!;
    assert.equal(spy0.data.length, 30, '0-trade state should show 30 placeholder candles');

    db.appendTrade({
      id: 'tc_first_sim_1',
      stock_id: idA,
      price: 73500,
      size: 10,
      buyer_is_bot: true,
      seller_is_bot: false,
      created_at: new Date(simBaseMs + 60_000).toISOString(),
    });
    await flushUi(90);

    assert.equal(spy0.data.length, 1, 'First real trade must replace all 30 placeholder candles');
    assert.equal(spy0.data[0].close, 73500);
    assert.ok(
      spy0.data[0].time < Math.floor(wallBaseMs / 1000) - 86400,
      'Replaced candle must be on simTime axis, not Date.now()'
    );

    // 4B: Small counts (1..5 trades) on simTime axis + live insert -> no 254-day distortion
    for (const count of [1, 3, 5]) {
      db.trades = [];
      db.rebuildIndexes();
      for (let i = 0; i < count; i++) {
        db.appendTrade({
          id: `tc_sim_${count}_${i}`,
          stock_id: idA,
          price: 74000 + i * 100,
          size: 5,
          buyer_is_bot: true,
          seller_is_bot: true,
          created_at: new Date(simBaseMs + i * 600_000).toISOString(),
        });
      }
      await act(async () => {
        root.unmount();
      });
      const subContainer = dom.window.document.createElement('div');
      dom.window.document.body.appendChild(subContainer);
      const subRoot = createRoot(subContainer);
      createdSeriesSpies.length = 0;

      await act(async () => {
        subRoot.render(
          <ThemeProvider>
            <TickChart ticker="0010" currentPrice={74000} market="domestic" />
          </ThemeProvider>
        );
      });
      await flushUi(70);

      const spy = createdSeriesSpies.find((s) => s.kind === 'Candlestick')!;
      assert.equal(spy.data.length, count, `Initial ${count} simTime trade(s) must render directly without synthetic candles`);

      db.appendTrade({
        id: `tc_sim_${count}_live`,
        stock_id: idA,
        price: 76000,
        size: 5,
        buyer_is_bot: true,
        seller_is_bot: true,
        created_at: new Date(simBaseMs + count * 600_000).toISOString(),
      });
      await flushUi(80);
      const times = spy.data.map((d) => d.time);
      const spanSeconds = Math.max(...times) - Math.min(...times);
      assert.ok(spanSeconds < 86400, `Span for ${count} simTime trades + live trade must stay < 1 day (got ${spanSeconds}s)`);
      assert.equal(spy.data.length, count + 1);

      await act(async () => {
        subRoot.unmount();
      });
      subContainer.remove();
    }

    // 4C: Wall-clock (Date.now) 2 trades + live 3rd trade
    db.trades = [];
    db.rebuildIndexes();
    db.appendTrade({
      id: 'tc_wall_1',
      stock_id: idA,
      price: 78000,
      size: 2,
      buyer_is_bot: false,
      seller_is_bot: true,
      created_at: new Date(wallBaseMs - 1_200_000).toISOString(),
    });
    db.appendTrade({
      id: 'tc_wall_2',
      stock_id: idA,
      price: 78500,
      size: 2,
      buyer_is_bot: false,
      seller_is_bot: true,
      created_at: new Date(wallBaseMs - 600_000).toISOString(),
    });
    const wallContainer = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(wallContainer);
    const wallRoot = createRoot(wallContainer);
    createdSeriesSpies.length = 0;
    await act(async () => {
      wallRoot.render(
        <ThemeProvider>
          <TickChart ticker="0010" currentPrice={78500} market="domestic" />
        </ThemeProvider>
      );
    });
    await flushUi(70);
    const wallSpy = createdSeriesSpies.find((s) => s.kind === 'Candlestick')!;
    assert.equal(wallSpy.data.length, 2, 'Wall-clock 2 trades must render directly');

    db.appendTrade({
      id: 'tc_wall_3_live',
      stock_id: idA,
      price: 79000,
      size: 2,
      buyer_is_bot: false,
      seller_is_bot: true,
      created_at: new Date(wallBaseMs).toISOString(),
    });
    await flushUi(80);
    assert.equal(wallSpy.data.length, 3);
    assert.equal(wallSpy.data[2].close, 79000);

    await act(async () => {
      wallRoot.unmount();
    });
    wallContainer.remove();
  } finally {
    globalThis.fetch = originalFetch;
    setBrowserClient(null);
    container.remove();
  }

  console.log('  ✓ TEST 4 통과');
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('🧪 REGRESSION TEST SUITE FOR #24 REMAINING 4 FIXES (P2 x2 + P3 x2)');
  console.log('════════════════════════════════════════════════════════════════');
  try {
    await test1AutoTickAndMidStepScheduledNewsBoundary();
    await test2SharedSubscriptionGenerationAndResync();
    await test3LocalDbTradesReadCommitGateIsolation();
    await test4TickChartSmallTradesAndPlaceholderReplacement();
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('🎉 ALL 4 REMAINING #24 REGRESSION TESTS PASSED!');
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
