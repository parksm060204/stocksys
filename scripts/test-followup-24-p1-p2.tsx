/**
 * scripts/test-followup-24-p1-p2.tsx
 *
 * Regression test suite for #24 follow-up fixes (P1 3 + P2 3):
 * 1. Server-side trade cursor, shared bounded polling, initial-load/subscription handoff,
 *    and TickChart / StockChartV2 / StockChart / ParticipantFlowWidget consistency.
 * 2. EventDirector concurrency serialization, shared commit-gate isolation, legacy 1:1 rumor matching,
 *    fixed runId restart ID collision prevention, and retry single-broadcast/shock guarantees.
 * 3. LocalMarketEngineInstance queued admin news rollback, mid-step committed fill vs final save failure,
 *    concurrent same-stock /api/orders overlap, restart idempotency, and deadlock-free lock ordering.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import Module from 'node:module';
import { JSDOM } from 'jsdom';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-followup-24-'));
const tmpMainDir = path.join(tmpRoot, 'main-data');
const tmpEngineDir = path.join(tmpRoot, 'engine-data');
fs.mkdirSync(tmpMainDir, { recursive: true });
fs.mkdirSync(tmpEngineDir, { recursive: true });

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

import React, { act, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

async function flushUi(ms: number = 35) {
  await act(async () => {
    await new Promise((r) => setTimeout(r, ms));
  });
}

function createMemoryFetchMock(
  memClient: any,
  hooks?: {
    onTradesQuery?: (parsed: any, res: any) => void | Promise<void>;
    onStocksQuery?: (parsed: any, res: any) => Promise<any> | any;
    failTradesQuery?: () => boolean;
  }
) {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === '/api/local-db' && init?.body) {
      const parsed = JSON.parse(String(init.body));
      if (parsed.tableName === 'trades' && hooks?.failTradesQuery?.()) {
        return new Response(
          JSON.stringify({ data: null, error: { message: 'Simulated trades query error' } }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

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

      let res = await qb.execute();
      if (parsed.tableName === 'trades' && hooks?.onTradesQuery) {
        await hooks.onTradesQuery(parsed, res);
      }
      if (parsed.tableName === 'stocks' && hooks?.onStocksQuery) {
        res = await hooks.onStocksQuery(parsed, res);
      }
      return new Response(JSON.stringify(res), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
  }) as typeof fetch;
}

async function test1RealtimeCursorSubscriptionAndConsumers() {
  console.log('▶ [TEST 1] 실시간 체결 커서·링버퍼/대량폭주/시계혼합 및 V1/V2/StockChart/ParticipantFlowWidget 검증');

  const { HttpMemoryClient, setBrowserClient } = await import('../lib/db/client');
  const { MemoryDatabase, STOCK_UUID_MAP } = await import('../lib/memoryDb/memoryStore');
  const { createMemoryDbClient } = await import('../lib/memoryDb/memoryDbClient');
  const TickChart = (await import('../app/components/TickChart')).default;
  const StockChartV2 = (await import('../app/components/v2/StockChartV2')).default;
  const StockChart = (await import('../app/components/StockChart')).default;
  const ParticipantFlowWidget = (await import('../app/components/ParticipantFlowWidget')).default;
  const { ThemeProvider } = await import('../app/components/ThemeProvider');

  const idA = STOCK_UUID_MAP['0010'];
  const idB = STOCK_UUID_MAP['0015'];
  const simBaseMs = 1773500000000; // 2026-03-14 (simulation clock)
  const wallBaseMs = Date.now();     // 2026-11-24 (wall clock)

  // 1A: Mixed wall-clock + sim-clock trades + 6050 ring-buffer + 450 burst with identical timestamps
  const db = new MemoryDatabase();
  db.trades = [];
  db.rebuildIndexes();
  const memClient = createMemoryDbClient(db);

  // Wall-clock baseline trade (future relative to simTime!)
  db.appendTrade({
    id: 'tr_wall_1',
    stock_id: idA,
    price: 72000,
    size: 5,
    buyer_is_bot: false,
    seller_is_bot: true,
    created_at: new Date(wallBaseMs).toISOString(),
  });

  // Seed 6050 trades (> MAX_SEEN_KEYS=6000) with same timestamps to test ring buffer + eviction safety
  const sameTsIso = new Date(simBaseMs).toISOString();
  for (let i = 0; i < 6050; i++) {
    db.appendTrade({
      id: `tr_bulk_seed_${i}`,
      stock_id: i % 2 === 0 ? idA : idB,
      price: 72100,
      size: 1,
      buyer_is_bot: true,
      seller_is_bot: true,
      created_at: sameTsIso,
      sequence: i + 1,
    });
  }
  await memClient.rpc('trim_old_market_data', { p_max_trades: 5000, p_max_history: 3000 });
  assert.equal(db.trades.length, 5000, 'Ring buffer trims trades to 5000');

  const originalFetch = globalThis.fetch;
  let maxBatchObserved = 0;
  let pollFetchCount = 0;
  let injectDuringInitialHandoff = false;

  globalThis.fetch = createMemoryFetchMock(memClient, {
    onTradesQuery: (parsed, res) => {
      pollFetchCount++;
      if (Array.isArray(res?.data)) {
        maxBatchObserved = Math.max(maxBatchObserved, res.data.length);
      }
      if (injectDuringInitialHandoff && parsed.query?.limitCount === 2000) {
        injectDuringInitialHandoff = false;
        // Inject a trade AFTER initial load snapshot was computed, BEFORE subscription starts!
        db.appendTrade({
          id: 'tr_race_window_1',
          stock_id: idA,
          price: 75500,
          size: 10,
          buyer_is_bot: false,
          seller_is_bot: true,
          created_at: new Date(simBaseMs + 10_000).toISOString(),
        });
      }
    },
  });

  try {
    const fastClient = new HttpMemoryClient({ channelPollIntervalMs: 25 });
    const received1A: any[] = [];
    const ch = fastClient
      .channel('probe_mixed_clock')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'trades', filter: `stock_id=eq.${idA}` },
        (payload) => received1A.push(payload.new)
      )
      .subscribe();

    await new Promise((r) => setTimeout(r, 50));
    assert.equal(received1A.length, 0, 'Baseline poll must not emit existing trades');

    // Insert 450 bot trades at simulationTime (much older than wallBaseMs!) with identical created_at
    for (let i = 0; i < 450; i++) {
      db.appendTrade({
        id: `tr_sim_burst_${i}`,
        stock_id: idA,
        price: 73000 + (i % 5) * 100,
        size: 2,
        buyer_is_bot: true,
        seller_is_bot: true,
        created_at: new Date(simBaseMs + 5000).toISOString(),
        sequence: i + 1,
      });
    }

    await new Promise((r) => setTimeout(r, 90));
    assert.equal(received1A.length, 450, 'All 450 sim-clock burst trades must arrive despite prior wall-clock trade & >200 batch limit');
    assert.equal(new Set(received1A.map((r) => r.id)).size, 450, 'Zero duplicate INSERT deliveries');
    assert.ok(maxBatchObserved <= 200, `Each poll batch must be bounded <= 200 (observed ${maxBatchObserved})`);

    // Additional polls must NOT replay any evicted or old trades
    await new Promise((r) => setTimeout(r, 70));
    assert.equal(received1A.length, 450, 'Repeated polls after ring-buffer trim must not replay old trades');
    fastClient.removeChannel(ch);

    // 1B: Shared polling + initial-load race handoff + ParticipantFlowWidget StrictMode accuracy
    db.trades = [];
    db.rebuildIndexes();
    for (let i = 0; i < 6; i++) {
      db.appendTrade({
        id: `tr_sim_init_${i}`,
        stock_id: idA,
        price: 72000 + i * 100,
        size: 100,
        buyer_is_bot: true, // bot buys from retail -> inst +vol, retail -vol
        seller_is_bot: false,
        created_at: new Date(simBaseMs + i * 1000).toISOString(),
      });
    }

    setBrowserClient(fastClient);
    createdSeriesSpies.length = 0;
    const container = dom.window.document.createElement('div');
    dom.window.document.body.appendChild(container);
    const root = createRoot(container);

    injectDuringInitialHandoff = true;
    pollFetchCount = 0;
    await act(async () => {
      root.render(
        <StrictMode>
          <ThemeProvider>
            <TickChart ticker="0010" currentPrice={72500} market="domestic" />
            <ParticipantFlowWidget stockId={idA} />
          </ThemeProvider>
        </StrictMode>
      );
    });
    await flushUi(110);

    // Confirm TickChart loaded simTime candles AND received the race-window trade (75,500)
    assert.equal(container.textContent?.includes('75,500'), true, 'TickChart must load simTime trades and catch initial-load race trade');
    // Confirm TickChart currentPrice prop did NOT inject a Date.now() candle into simTime series
    const tickCandleSpy = createdSeriesSpies.find((s) => s.kind === 'Candlestick')!;
    const maxCandleTime = Math.max(...tickCandleSpy.data.map((d) => d.time));
    assert.ok(
      maxCandleTime < Math.floor(wallBaseMs / 1000) - 86400,
      'TickChart must NOT inject Date.now() candle into simTime series'
    );

    // Insert 1 live trade and check ParticipantFlowWidget cumulative calculation (no StrictMode doubling, no dupes)
    db.appendTrade({
      id: 'tr_flow_live_1',
      stock_id: idA,
      price: 100000,
      size: 1000, // 100,000,000 KRW = 1억
      buyer_is_bot: true,
      seller_is_bot: false,
      created_at: new Date(simBaseMs + 15_000).toISOString(),
    });
    await flushUi(80);
    const pollsAfterFirstLive = pollFetchCount;
    await flushUi(60);
    const pollsDelta = pollFetchCount - pollsAfterFirstLive;
    // With 25ms interval over 60ms (~2 cycles), shared polling emits <= 3 polls (not 6!)
    assert.ok(pollsDelta <= 4, `Shared client polling must coalesce identical stock subscriptions (delta=${pollsDelta})`);

    const expectedInstInitial =
      [72000, 72100, 72200, 72300, 72400, 72500].reduce((acc, p) => acc + (p * 100) / 1e8, 0);
    // race_window_1 (75500*10) had buyer=retail, seller=bot -> inst -= 0.00755
    const expectedInstTotal = expectedInstInitial - (75500 * 10) / 1e8 + 1;
    assert.ok(
      container.textContent?.includes(expectedInstTotal.toLocaleString()),
      `ParticipantFlowWidget must reflect exact cumulative net amount (${expectedInstTotal.toLocaleString()})`
    );

    // 1C: StockChartV2 ticker switch ghosting + error handling + placeholder replacement + NaN timestamp guard
    createdSeriesSpies.length = 0;
    let delayStockBResolve: (() => void) | null = null;
    let shouldFailTrades = false;

    globalThis.fetch = createMemoryFetchMock(memClient, {
      failTradesQuery: () => shouldFailTrades,
      onStocksQuery: async (parsed, res) => {
        const tickerFilter = parsed.query?.filters?.find((f: any) => f.col === 'ticker')?.val;
        if (tickerFilter === '0015') {
          await new Promise<void>((resolve) => {
            delayStockBResolve = resolve;
          });
        }
        return res;
      },
    });

    await act(async () => {
      root.render(<StockChartV2 ticker="0010" currentPrice={73000} isProMode={true} />);
    });
    await flushUi(70);

    const v2CandleSpy = createdSeriesSpies.find((s) => s.kind === 'Candlestick')!;
    assert.ok(v2CandleSpy.data.length > 0, 'StockChartV2 must render ticker 0010 data');

    // Switch to 0015 while stocks lookup is still pending -> previous 0010 bars must be cleared immediately!
    await act(async () => {
      root.render(<StockChartV2 ticker="0015" currentPrice={210000} isProMode={true} />);
    });
    await flushUi(20);
    assert.equal(v2CandleSpy.data.length, 0, 'StockChartV2 must clear previous ticker candles immediately while new stockId loads');

    // Finish 0015 stock lookup while trades query fails -> must NOT overwrite with flat candle and set isFallback=false
    shouldFailTrades = true;
    const resolveStockB = delayStockBResolve as (() => void) | null;
    if (resolveStockB) resolveStockB();
    await flushUi(50);
    assert.equal(v2CandleSpy.data.length, 0, 'StockChartV2 must not inject bogus flat candle on trades query error');

    // Now test placeholder replacement when 0015 genuinely has 0 trades, followed by a simTime trade + NaN trade
    shouldFailTrades = false;
    db.trades = [];
    db.rebuildIndexes();
    await act(async () => {
      root.render(<StockChartV2 ticker="0010" currentPrice={73000} isProMode={true} />);
    });
    await flushUi(60);
    // Insert invalid NaN timestamp trade + valid simTime trade
    db.appendTrade({
      id: 'tr_invalid_ts',
      stock_id: idA,
      price: 99999,
      size: 1,
      buyer_is_bot: true,
      seller_is_bot: true,
      created_at: 'not-a-date',
    });
    db.appendTrade({
      id: 'tr_sim_first_real',
      stock_id: idA,
      price: 74100,
      size: 5,
      buyer_is_bot: true,
      seller_is_bot: true,
      created_at: new Date(simBaseMs + 20_000).toISOString(),
    });
    await flushUi(80);
    assert.equal(v2CandleSpy.data.length, 1, 'Placeholder Date.now() candle must be replaced cleanly by first simTime trade');
    assert.equal(v2CandleSpy.data[0].close, 74100, 'First simTime trade must be rendered without NaN trade');

    // 1D: StockChart (legacy SVG chart) simTime load + live update + fast switch cancelled guard
    const stockA: any = {
      id: idA,
      ticker: '0010',
      name: '오성전자',
      market: 'domestic',
      currentPrice: 73000,
      previousClose: 72000,
      openPrice: 72000,
      high: 75000,
      low: 71000,
      volume: 100,
      changeRate: 1.39,
      marketCap: 1e12,
      peRatio: 10,
      dividendYield: 1,
      sector: '반도체',
    };
    const stockB: any = { ...stockA, id: idB, ticker: '0015', name: '삼정바이오', currentPrice: 210000 };
    db.appendTrade({
      id: 'tr_stockchart_b',
      stock_id: idB,
      price: 215000,
      size: 3,
      buyer_is_bot: true,
      seller_is_bot: true,
      created_at: new Date(simBaseMs + 25_000).toISOString(),
    });

    await act(async () => {
      root.render(<StockChart stock={stockA} />);
    });
    await flushUi(70);
    assert.equal(container.textContent?.includes('LIVE (1건)'), true, 'StockChart must load simTime trade and ignore NaN trade');

    await act(async () => {
      root.render(<StockChart stock={stockB} />);
    });
    await flushUi(70);
    assert.equal(container.textContent?.includes('215,000'), true, 'StockChart must reflect new stock after switch');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  } finally {
    globalThis.fetch = originalFetch;
    setBrowserClient(null);
  }

  console.log('  ✓ TEST 1 통과');
}

async function test2EventDirectorConcurrencyIsolationLegacyAndRunId() {
  console.log('▶ [TEST 2] EventDirector 동시성 직렬화·커밋게이트 격리·레거시 1:1 매칭·고정 runId 재시작 충돌 방지 검증');

  const { MemoryDatabase, SequentialIdGenerator } = await import('../lib/memoryDb/memoryStore');
  const { PersistenceManager } = await import('../lib/memoryDb/PersistenceManager');
  const { FileStorageAdapter } = await import('../lib/memoryDb/StorageAdapter');
  const { createInMemoryRepositoryBundle } = await import('../lib/repositories/inMemory');
  const { createSimulationContext } = await import('../lib/engine/simulation/runtime');
  const { MarketEngine } = await import('../engine-server/src/MarketEngine');
  const { EventDirector } = await import('../engine-server/src/EventDirector');
  const { NewsGenerator } = await import('../engine-server/src/services/NewsGenerator');
  const { EventBus } = await import('../engine-server/src/EventBus');
  const { prepareEngineRestartRuntime } = await import('../engine-server/src/restartRuntime');

  // 2A: Concurrent processDueCorrections + commit-gate snapshot isolation + single broadcast/shock
  const baseNow = 1776000000000;
  let clockNow = baseNow;
  const db1 = new MemoryDatabase({ clock: { now: () => clockNow }, idGenerator: new SequentialIdGenerator(101) });
  const pm1 = new PersistenceManager(new FileStorageAdapter(tmpEngineDir));
  const repos1 = createInMemoryRepositoryBundle(db1);
  const ctx1 = createSimulationContext({ seed: 101, clock: { now: () => clockNow }, runId: 'fixed_run' });
  const engine1 = new MarketEngine({ simulationContext: ctx1, repositories: repos1, persistence: pm1 });

  const rumorProvider = {
    async generate() {
      return {
        type: 'MICRO' as const,
        category: 'RUMOR' as const,
        publisher: '가십 썬',
        title: '대형 테크 기업 엠앤에이(M&A) 비공식 타진설',
        content: '동일 제목 루머',
        target_sector: '테크',
        target_ticker: 'NVDA',
        impact_score: 7.8,
        is_fake: true,
      };
    },
  };

  let persistDelayMs = 0;
  let forcePersistFail = false;
  const director1 = new EventDirector(engine1, ctx1, repos1.event, new NewsGenerator(ctx1, rumorProvider), {
    persistence: pm1,
    onPersist: async () => {
      if (persistDelayMs > 0) await new Promise((r) => setTimeout(r, persistDelayMs));
      if (forcePersistFail) {
        return false;
      }
      return await pm1.saveSnapshot(db1);
    },
  });

  // Trigger news with failure -> commit-gate isolated, no leftover temp news
  forcePersistFail = true;
  const failedNews = await director1.triggerEndogenousNews();
  assert.equal(failedNews, null, 'Failed triggerEndogenousNews must return null');
  assert.equal(db1.marketNews.length, 0, 'Temporary uncommitted news must be removed on persist failure');
  forcePersistFail = false;

  // Succeed publishing fake rumor #1 (`news_fixed_run_gen_2` or `_1` - distinct and persisted)
  const published1 = await director1.triggerEndogenousNews();
  assert.ok(published1?.id, 'Rumor #1 must be published');
  await new Promise((r) => setImmediate(r)); // drain EventBus setImmediate from rumor #1

  // Advance clock to correction due time and fire concurrent processDueCorrections + concurrent snapshot save!
  clockNow = baseNow + EventDirector.CORRECTION_DELAY_MS;
  persistDelayMs = 45;

  let busCount = 0;
  const origInject = engine1.injectEvent.bind(engine1);
  let injectCount = 0;
  (engine1 as any).injectEvent = (ev: any) => {
    injectCount++;
    return origInject(ev);
  };
  const unsubscribeBus = EventBus.subscribe('news_published', () => {
    busCount++;
  });

  // First test failed persist mid-delay while another saveSnapshot waits on the shared commit gate!
  forcePersistFail = true;
  const concurrentSnapPromise = pm1.saveSnapshot(db1);
  const failedParallel = await Promise.all([
    director1.processDueCorrections(),
    director1.processDueCorrections(),
    concurrentSnapPromise,
  ]);
  forcePersistFail = false;
  await new Promise((r) => setImmediate(r));
  assert.equal(failedParallel[0] + failedParallel[1], 0, 'Failed correction save must publish 0');
  assert.equal(busCount, 0, 'Failed correction save must emit 0 EventBus broadcasts');
  assert.equal(injectCount, 0, 'Failed correction save must inject 0 market shocks');
  const snapshotAfterFail = JSON.parse(fs.readFileSync(path.join(tmpEngineDir, 'snapshot.json'), 'utf8'));
  assert.equal(
    snapshotAfterFail.marketNews.filter((n: any) => n.category === 'CORRECTION').length,
    0,
    'Concurrent snapshot via shared commitGate must NEVER capture temporary uncommitted correction news'
  );

  // Now recover persistence and call processDueCorrections concurrently!
  const [c1, c2] = await Promise.all([
    director1.processDueCorrections(),
    director1.processDueCorrections(),
  ]);
  await new Promise((r) => setImmediate(r));
  unsubscribeBus();
  assert.equal(c1 + c2, 1, 'Concurrent processDueCorrections must publish exactly once');
  assert.equal(busCount, 1, 'Exactly 1 EventBus broadcast per correction');
  assert.equal(injectCount, 1, 'Exactly 1 MarketEngine shock per correction');
  assert.equal(director1.getPendingCorrectionCount(), 0, 'Pending correction queue cleared');

  // 2B: Legacy identical-title rumors -> strict 1:1 matching
  const legacyDb = new MemoryDatabase();
  const snapLegacy = db1.exportSnapshot();
  snapLegacy.marketNews = [
    {
      id: 'leg_r1',
      type: 'MICRO',
      category: 'RUMOR',
      publisher: '가십 썬',
      title: '대형 테크 기업 엠앤에이(M&A) 비공식 타진설',
      content: '루머 1',
      impact_score: 7.8,
      is_fake: true,
      simulation_time: baseNow,
      created_at: new Date(baseNow).toISOString(),
    },
    {
      id: 'leg_r2',
      type: 'MICRO',
      category: 'RUMOR',
      publisher: '가십 썬',
      title: '대형 테크 기업 엠앤에이(M&A) 비공식 타진설',
      content: '루머 2',
      impact_score: 7.8,
      is_fake: true,
      simulation_time: baseNow + 120_000,
      created_at: new Date(baseNow + 120_000).toISOString(),
    },
    {
      id: 'leg_c1',
      type: 'MICRO',
      category: 'CORRECTION',
      publisher: '기업 전자공시 (DART)',
      title: '[정정 공시] 대형 테크 기업 엠앤에이(M&A) 비공식 타진설은 사실무근으로 확인',
      content: '정정 1',
      impact_score: -7.8,
      is_fake: false,
      simulation_time: baseNow + 240_000,
      created_at: new Date(baseNow + 240_000).toISOString(),
    },
  ];
  legacyDb.importSnapshot(snapLegacy);
  let legClock = baseNow + 250_000;
  const ctxLeg = createSimulationContext({ seed: 202, clock: { now: () => legClock }, runId: 'leg_run' });
  const reposLeg = createInMemoryRepositoryBundle(legacyDb);
  const engLeg = new MarketEngine({ simulationContext: ctxLeg, repositories: reposLeg });
  const dirLeg = new EventDirector(engLeg, ctxLeg, reposLeg.event);
  await dirLeg.restorePendingCorrections();
  assert.equal(dirLeg.getPendingCorrectionCount(), 1, 'Second identical-title legacy rumor must remain scheduled (1:1 consumption)');
  assert.equal(await dirLeg.processDueCorrections(), 0, 'Second rumor correction waits until +4m from t=120_000');
  legClock = baseNow + 120_000 + EventDirector.CORRECTION_DELAY_MS;
  assert.equal(await dirLeg.processDueCorrections(), 1, 'Second rumor correction fires once at due time');

  // 2C: Fixed runId restart must NEVER overwrite previous news ID (both with & without prepareEngineRestartRuntime)
  const freshDir = path.join(tmpRoot, 'engine-fixed-runid');
  fs.mkdirSync(freshDir, { recursive: true });
  const dbFixed1 = new MemoryDatabase({ clock: { now: () => baseNow }, idGenerator: new SequentialIdGenerator(55) });
  const pmFixed1 = new PersistenceManager(new FileStorageAdapter(freshDir));
  const boot1 = await prepareEngineRestartRuntime(dbFixed1, pmFixed1, { seed: 55, runId: 'fixed_run' });
  const reposFixed1 = createInMemoryRepositoryBundle(dbFixed1);
  const engFixed1 = new MarketEngine({ simulationContext: boot1.context, repositories: reposFixed1, persistence: pmFixed1 });
  const dirFixed1 = new EventDirector(engFixed1, boot1.context, reposFixed1.event, new NewsGenerator(boot1.context, rumorProvider), {
    onPersist: () => pmFixed1.saveSnapshot(dbFixed1),
    persistence: pmFixed1,
    epoch: boot1.epoch,
  });
  const firstFixedNews = await dirFixed1.triggerEndogenousNews();
  assert.ok(firstFixedNews?.id);
  assert.equal(dbFixed1.marketNews.length, 1);

  // Restart with exact same runId ('fixed_run') via prepareEngineRestartRuntime
  const dbFixed2 = new MemoryDatabase();
  const pmFixed2 = new PersistenceManager(new FileStorageAdapter(freshDir));
  const boot2 = await prepareEngineRestartRuntime(dbFixed2, pmFixed2, { seed: 55, runId: 'fixed_run' });
  const reposFixed2 = createInMemoryRepositoryBundle(dbFixed2);
  const engFixed2 = new MarketEngine({ simulationContext: boot2.context, repositories: reposFixed2, persistence: pmFixed2 });
  const dirFixed2 = new EventDirector(engFixed2, boot2.context, reposFixed2.event, new NewsGenerator(boot2.context, rumorProvider), {
    onPersist: () => pmFixed2.saveSnapshot(dbFixed2),
    persistence: pmFixed2,
    epoch: boot2.epoch,
  });
  const secondFixedNews = await dirFixed2.triggerEndogenousNews();
  assert.ok(secondFixedNews?.id && secondFixedNews.id !== firstFixedNews!.id, 'Restart with fixed runId must generate unique news ID');
  assert.equal(dbFixed2.marketNews.length, 2, 'Restart with fixed runId must NOT overwrite pre-restart news');

  // Also verify direct importSnapshot restart WITHOUT prepareEngineRestartRuntime (epoch=1, same runId='fixed_run')
  const dbFixed3 = new MemoryDatabase();
  dbFixed3.importSnapshot(dbFixed2.exportSnapshot());
  const ctxFixed3 = createSimulationContext({ seed: 55, clock: { now: () => baseNow + 1000 }, runId: 'fixed_run' });
  const reposFixed3 = createInMemoryRepositoryBundle(dbFixed3);
  const engFixed3 = new MarketEngine({ simulationContext: ctxFixed3, repositories: reposFixed3 });
  const dirFixed3 = new EventDirector(engFixed3, ctxFixed3, reposFixed3.event, new NewsGenerator(ctxFixed3, rumorProvider));
  const thirdFixedNews = await dirFixed3.triggerEndogenousNews();
  assert.ok(thirdFixedNews?.id);
  assert.equal(dbFixed3.marketNews.length, 3, 'Direct restart without epoch bump must also avoid overwriting existing fixed-runId news');

  console.log('  ✓ TEST 2 통과');
}

async function test3LocalEngineRollbackIdempotencyAndLockOverlap() {
  console.log('▶ [TEST 3] 로컬 엔진 예약뉴스 실패 복원·중간커밋 후 실패·동일종목 수동전진/주문 겹침·재시작 멱등성 검증');

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
  const t0 = engine.getSimulationTime();
  const agentMgr = engine.__getAgentManagerForTesting();
  const origAtt = agentMgr.attentionMap.get(stockId);
  const origUnc = agentMgr.uncertaintyMap.get(stockId);

  // 3A: Immediate admin event save failure (false and throw) rolls back agentManager + marketNews + clock + queue
  const immediateEvent = {
    eventId: 'evt_immediate_rollback_check',
    eventType: 'OFFICIAL' as const,
    title: '즉시 반영 관리자 뉴스 롤백 검증',
    content: '본문',
    publisher: '월스트리트저널',
    scope: 'stock' as const,
    targetStockIds: [stockId],
    valuationSignal: 0.4,
    attentionShock: 0.25,
    uncertaintyShock: 0.2,
    confidence: 0.9,
    halfLife: 60,
    publishedAt: t0,
    effectiveFrom: t0,
  };
  memoryDb.pendingAdminMarketEvents = [immediateEvent as any];
  await persistenceManager.saveSnapshot(memoryDb);

  const origSaveSnapshot = persistenceManager.saveSnapshot.bind(persistenceManager);
  persistenceManager.saveSnapshot = async () => false;
  let threwOnPublishFalse = false;
  try {
    await engine.stepSimulation(1.0);
  } catch {
    threwOnPublishFalse = true;
  } finally {
    persistenceManager.saveSnapshot = origSaveSnapshot;
  }
  assert.equal(threwOnPublishFalse, true, 'publishQueuedAdminEvents false must abort stepSimulation');
  assert.equal(engine.getSimulationTime(), t0, 'Clock must remain at T0');
  assert.equal(memoryDb.pendingAdminMarketEvents.length, 1, 'Queued event must stay in pendingAdminMarketEvents');
  assert.equal(memoryDb.marketNews.some((n) => n.id === immediateEvent.eventId), false, 'marketNews must not retain rolled-back event');
  assert.equal(agentMgr.publishedEventIds.has(immediateEvent.eventId), false, 'agentManager.publishedEventIds must be restored');
  assert.equal(agentMgr.effectiveEventIds.has(immediateEvent.eventId), false, 'agentManager.effectiveEventIds must be restored');
  assert.equal(agentMgr.idempotencyTracker.has(immediateEvent.eventId), false, 'idempotencyTracker must be restored');
  assert.equal(agentMgr.attentionMap.get(stockId), origAtt, 'attentionMap must be restored');
  assert.equal(agentMgr.uncertaintyMap.get(stockId), origUnc, 'uncertaintyMap must be restored');

  // Same check when persist throws
  persistenceManager.saveSnapshot = async () => {
    throw new Error('Injected publish throw');
  };
  let threwOnPublishErr = false;
  try {
    await engine.stepSimulation(1.0);
  } catch {
    threwOnPublishErr = true;
  } finally {
    persistenceManager.saveSnapshot = origSaveSnapshot;
  }
  assert.equal(threwOnPublishErr, true);
  assert.equal(agentMgr.publishedEventIds.has(immediateEvent.eventId), false, 'Throw must also restore publishedEventIds');
  assert.equal(memoryDb.marketNews.some((n) => n.id === immediateEvent.eventId), false);

  // Recover persistence and step -> event publishes & applies ONCE
  await engine.stepSimulation(1.0);
  const t1 = engine.getSimulationTime();
  assert.equal(t1, t0 + 1000);
  assert.equal(memoryDb.pendingAdminMarketEvents.length, 0);
  assert.equal(memoryDb.marketNews.filter((n) => n.id === immediateEvent.eventId).length, 1);

  // 3B: Scheduled news due at T2 (t1 + 1000) + mid-step committed fill + final save false/throw
  const t2 = t1 + 1000;
  const scheduledEvent = {
    eventId: 'evt_midstep_fill_then_fail',
    eventType: 'OFFICIAL' as const,
    title: '중간 체결 후 최종 저장 실패 멱등성 검증',
    content: '본문',
    publisher: '블룸버그 터미널',
    scope: 'stock' as const,
    targetStockIds: [stockId],
    valuationSignal: 0.3,
    attentionShock: 0.15,
    uncertaintyShock: 0.1,
    confidence: 0.9,
    halfLife: 60,
    publishedAt: t2,
    effectiveFrom: t2,
  };
  memoryDb.pendingAdminMarketEvents = [scheduledEvent as any];
  const guest = memoryDb.profiles.get(GUEST_USER_ID)!;
  guest.cash = 100_000_000;
  const stk = memoryDb.stocks.get(stockId)!;
  memoryDb.holdings.set(`${GUEST_USER_ID}_${stockId}`, {
    id: `${GUEST_USER_ID}_${stockId}`,
    user_id: GUEST_USER_ID,
    stock_id: stockId,
    quantity: 100,
    avg_price: stk.current_price,
    created_at: memoryDb.getIsoTimestamp(),
  });
  for (const ag of agentMgr.agents.values()) {
    ag.evaluationsPerStep = 33;
  }
  memoryDb.orders.set('test3b_cross_sell', {
    id: 'test3b_cross_sell',
    stock_id: stockId,
    user_id: GUEST_USER_ID,
    side: 'sell',
    price: 100,
    size: 5,
    filled: 0,
    status: 'open',
    is_lp: false,
    created_at: new Date(t1 - 500).toISOString(),
  });
  memoryDb.ensureUserProfile('test3b_buyer', { cash: 100_000_000 });
  memoryDb.orders.set('test3b_cross_buy', {
    id: 'test3b_cross_buy',
    stock_id: stockId,
    user_id: 'test3b_buyer',
    side: 'buy',
    price: 1_000_000,
    size: 5,
    filled: 0,
    status: 'open',
    is_lp: false,
    created_at: new Date(t1 - 400).toISOString(),
  });
  memoryDb.rebuildIndexes();

  let saveCount3B = 0;
  persistenceManager.saveSnapshot = async (dbArg) => {
    saveCount3B++;
    if (saveCount3B === 1) {
      return await origSaveSnapshot(dbArg);
    }
    throw new Error('Injected final step save throw');
  };
  let finalSaveThrew = false;
  try {
    await engine.stepSimulation(1.0);
  } catch {
    finalSaveThrew = true;
  } finally {
    persistenceManager.saveSnapshot = origSaveSnapshot;
  }
  assert.equal(finalSaveThrew, true, 'Final save throw must reject stepSimulation');
  assert.ok(saveCount3B >= 2, `Mid-step fill must have triggered persistence before final save (count=${saveCount3B})`);
  assert.equal(engine.getSimulationTime(), t2, 'Clock must stay at T2 matching committed mid-step fill');
  assert.equal(
    memoryDb.pendingAdminMarketEvents.some((e) => e.eventId === scheduledEvent.eventId),
    false,
    'Already-persisted/effective event must NOT be put back into pendingAdminMarketEvents'
  );

  // Restart from disk and step -> must remain idempotent (only 1 news record, clock advances cleanly)
  stopLocalStandaloneEngine();
  await ensureLocalStandaloneReady();
  const restarted = getLocalStandaloneEngine()!;
  restarted.stop();
  assert.equal(restarted.getSimulationTime(), t2, 'Restarted engine must restore T2 clock consistent with disk');
  assert.equal(
    memoryDb.marketNews.filter((n) => n.id === scheduledEvent.eventId).length,
    1,
    'Scheduled news must exist exactly once after restart'
  );
  await restarted.stepSimulation(1.0);
  assert.equal(
    memoryDb.marketNews.filter((n) => n.id === scheduledEvent.eventId).length,
    1,
    'Subsequent step after restart must not duplicate scheduled news'
  );

  // 3B-2: Same mid-step fill commit when final save returns `false` (not throw)
  for (const ag of restarted.__getAgentManagerForTesting().agents.values()) {
    ag.evaluationsPerStep = 33;
  }
  const t3 = restarted.getSimulationTime();
  const t4 = t3 + 1000;
  const scheduledEventFalse = {
    ...scheduledEvent,
    eventId: 'evt_midstep_fill_then_false',
    publishedAt: t4,
    effectiveFrom: t4,
  };
  memoryDb.pendingAdminMarketEvents = [scheduledEventFalse as any];
  memoryDb.orders.set('test3b2_cross_sell', {
    id: 'test3b2_cross_sell',
    stock_id: stockId,
    user_id: GUEST_USER_ID,
    side: 'sell',
    price: 100,
    size: 5,
    filled: 0,
    status: 'open',
    is_lp: false,
    created_at: new Date(t3 - 500).toISOString(),
  });
  memoryDb.orders.set('test3b2_cross_buy', {
    id: 'test3b2_cross_buy',
    stock_id: stockId,
    user_id: 'test3b_buyer',
    side: 'buy',
    price: 1_000_000,
    size: 5,
    filled: 0,
    status: 'open',
    is_lp: false,
    created_at: new Date(t3 - 400).toISOString(),
  });
  memoryDb.rebuildIndexes();

  let saveCount3B2 = 0;
  persistenceManager.saveSnapshot = async (dbArg) => {
    saveCount3B2++;
    if (saveCount3B2 === 1) {
      return await origSaveSnapshot(dbArg);
    }
    return false;
  };
  let finalSaveFailedFalse = false;
  try {
    await restarted.stepSimulation(1.0);
  } catch {
    finalSaveFailedFalse = true;
  } finally {
    persistenceManager.saveSnapshot = origSaveSnapshot;
  }
  assert.equal(finalSaveFailedFalse, true, 'Final save returning false must reject stepSimulation');
  assert.ok(saveCount3B2 >= 2);
  assert.equal(restarted.getSimulationTime(), t4, 'Clock must stay at T4 matching committed mid-step fill');
  assert.equal(
    memoryDb.pendingAdminMarketEvents.some((e) => e.eventId === scheduledEventFalse.eventId),
    false,
    'Already-persisted/effective event must NOT revert to pendingAdminMarketEvents on final save false'
  );

  // 3C: Concurrent stepSimulation + same-stock /api/orders overlap (no deadlock, consistent state)
  const overlapResults = await Promise.race([
    Promise.all([
      restarted.stepSimulation(1.0),
      ordersPOST(
        new Request('http://localhost:3000/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stock_id: stockId, side: 'buy', price: 1000, size: 1 }),
        })
      ),
      ordersPOST(
        new Request('http://localhost:3000/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stock_id: stockId, side: 'sell', price: 9999999, size: 1 }),
        })
      ),
    ]),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Same-stock concurrent overlap deadlock timeout')), 5000)),
  ]);
  assert.equal(overlapResults[1].status, 200);
  assert.equal(overlapResults[2].status, 200);

  // 3D: Overlapping concurrent /api/orders commits mid-step while stepSimulation final save fails
  const tBeforeOverlapFail = restarted.getSimulationTime();
  const tExpectedOverlapFail = tBeforeOverlapFail + 1000;
  let overlapInjected = false;
  let finalStepSaveFail = false;
  const origStepPersist = async (dbArg: any) => {
    if (!overlapInjected) {
      overlapInjected = true;
      // Save initial external order commit, then cause final step save to return false
      finalStepSaveFail = true;
      return await origSaveSnapshot(dbArg);
    }
    if (finalStepSaveFail) {
      return false;
    }
    return await origSaveSnapshot(dbArg);
  };
  persistenceManager.saveSnapshot = origStepPersist;
  let overlapStepRejected = false;
  try {
    const stepPromise = restarted.stepSimulation(1.0, async () => false);
    const orderPromise = ordersPOST(
      new Request('http://localhost:3000/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_id: stockId, side: 'buy', price: 1_000_000, size: 1 }),
      })
    );
    const [, orderRes] = await Promise.race([
      Promise.all([
        stepPromise.catch(() => {
          overlapStepRejected = true;
        }),
        orderPromise,
      ]),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Concurrent mid-step order overlap deadlock timeout')), 5000)),
    ]);
    assert.equal(orderRes.status, 200, 'Concurrent /api/orders on same stock must succeed without deadlock');
  } finally {
    persistenceManager.saveSnapshot = origSaveSnapshot;
  }
  assert.equal(overlapStepRejected, true, 'Failed final step save must still reject');
  // Disk snapshot and memory clock must agree!
  const diskAfterOverlap = JSON.parse(fs.readFileSync(path.join(tmpMainDir, 'snapshot.json'), 'utf8'));
  assert.equal(
    restarted.getSimulationTime(),
    diskAfterOverlap.localSimulationClock?.simulationTime,
    `In-memory clock (${restarted.getSimulationTime()}) must stay consistent with disk snapshot (${diskAfterOverlap.localSimulationClock?.simulationTime ?? tExpectedOverlapFail})`
  );

  stopLocalStandaloneEngine();
  console.log('  ✓ TEST 3 통과');
}

async function main() {
  console.log('════════════════════════════════════════════════════════════════');
  console.log('🧪 REGRESSION TEST SUITE FOR #24 FOLLOW-UP FIXES (P1 + P2)');
  console.log('════════════════════════════════════════════════════════════════');
  try {
    await test1RealtimeCursorSubscriptionAndConsumers();
    await test2EventDirectorConcurrencyIsolationLegacyAndRunId();
    await test3LocalEngineRollbackIdempotencyAndLockOverlap();
    console.log('\n════════════════════════════════════════════════════════════════');
    console.log('🎉 ALL #24 FOLLOW-UP REGRESSION TESTS PASSED!');
    console.log('════════════════════════════════════════════════════════════════');
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Follow-up regression suite failed:', err);
    process.exit(1);
  });
