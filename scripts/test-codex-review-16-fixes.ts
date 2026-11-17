import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { IStorageAdapter } from '../lib/memoryDb/StorageAdapter';
import type { ProfileRecord } from '../lib/memoryDb/memoryStore';

const ISOLATED_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-16fixes-'));
process.env.STOCKSYS_DATA_DIR = ISOLATED_DATA_DIR;

class ControlledMemoryAdapter implements IStorageAdapter {
  public savedSnapshots: string[] = [];
  private latestSnapshot: string | null = null;
  public nextResults: Array<boolean | (() => Promise<boolean>)> = [];

  public async saveSnapshot(data: string): Promise<boolean> {
    const next = this.nextResults.shift();
    const ok = typeof next === 'function' ? await next() : next !== undefined ? next : true;
    if (ok) {
      this.latestSnapshot = data;
      this.savedSnapshots.push(data);
    }
    return ok;
  }

  public async loadSnapshot(): Promise<string | null> {
    return this.latestSnapshot;
  }

  public async appendLog(): Promise<void> {}
}

function seedProfile(db: any, id: string, cash: number, extra?: Partial<ProfileRecord>): ProfileRecord {
  const rec: ProfileRecord = {
    id,
    user_id: id,
    username: id,
    nickname: id,
    cash,
    net_worth: cash,
    rank_tier: 'Gold',
    usd_balance: 0,
    eur_balance: 0,
    jpy_balance: 0,
    cny_balance: 0,
    gbp_balance: 0,
    is_admin: false,
    has_options_license: false,
    created_at: db.getIsoTimestamp(),
    ...extra,
  };
  db.profiles.set(id, rec);
  db.addProfileToIndex(rec);
  return rec;
}

async function main() {
  const { MemoryDatabase, GUEST_USER_ID, STOCK_UUID_MAP, memoryDb } = await import('../lib/memoryDb/memoryStore');
  const { createMemoryDbClient } = await import('../lib/memoryDb/memoryDbClient');
  const { PersistenceManager } = await import('../lib/memoryDb/PersistenceManager');
  const { FileStorageAdapter } = await import('../lib/memoryDb/StorageAdapter');
  const { submitAndMatchOrder } = await import('../lib/engine/dbMatching');
  const { executeCurrencyExchange } = await import('../lib/exchange/exchangeService');
  const { validateOrderCapacity, getAvailableCashKrw } = await import('../lib/engine/orderRisk');
  const {
    submitAuthoritativeOptionOrder,
    getOptionAccountSummary,
    cancelAllOptionOrders,
    liquidateAllOptionPositions,
  } = await import('../lib/options/optionOrderService');
  const { CommodityMarketEngine } = await import('../lib/commodities/CommodityMarketEngine');
  const {
    getUsdToKrwRate,
    calculateCommodityMarginPerContractKrw,
    reserveMarginAndSubmitCommodityOrder,
    settleCommodityTradeForUsers,
  } = await import('../lib/commodities/commodityLedger');
  const { prepareEngineRestartRuntime } = await import('../engine-server/src/restartRuntime');
  const { MarketEngine } = await import('../engine-server/src/MarketEngine');
  const { createInMemoryRepositoryBundle } = await import('../lib/repositories/inMemory');
  const { buildDeterministicTradeId } = await import('../engine-server/src/settlement/deterministicTradeId');
  const { ETF_CATALOG } = await import('../lib/engine/etfDefinitions');
  const { resolvePlayerEventChoice } = await import('../lib/events/playerEventService');
  const { LocalMarketEngineInstance, ensureMemoryDbReady, stopLocalStandaloneEngine } = await import(
    '../lib/engine/localStandaloneServer'
  );

  // 1. Asset boundary
  console.log('▶ [1] Testing stock order asset boundary against option/unregistered IDs...');
  {
    const client = createMemoryDbClient(memoryDb);
    const buyer = seedProfile(memoryDb, 'asset_boundary_buyer', 1_000_000);
    const seller = seedProfile(memoryDb, 'asset_boundary_seller', 1_000_000, { has_options_license: true });
    const optContract = memoryDb.optionsContracts.get('opt_c_720')!;
    optContract.expiry_date = new Date(Date.now() + 86400_000).toISOString();

    memoryDb.holdings.set(`${seller.id}_${optContract.id}`, {
      id: `${seller.id}_${optContract.id}`,
      user_id: seller.id,
      stock_id: optContract.id,
      quantity: 1,
      avg_price: 10,
      created_at: memoryDb.getIsoTimestamp(),
    });
    memoryDb.addHoldingToIndex(memoryDb.holdings.get(`${seller.id}_${optContract.id}`)!);

    const optSell = await submitAuthoritativeOptionOrder({
      db: memoryDb,
      userId: seller.id,
      contractId: optContract.id,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 10,
      qty: 1,
    });
    assert.equal(optSell.success, true);

    const bypassRes = await submitAndMatchOrder(client, {
      stock_id: optContract.id,
      user_id: buyer.id,
      side: 'buy',
      price: 10,
      size: 1,
    });
    assert.equal(bypassRes.success, false, 'Option ID must be rejected in stock matching');
    assert.equal(buyer.cash, 1_000_000, 'Bypass attempt must not change cash');

    const unknownRes = await submitAndMatchOrder(client, {
      stock_id: 'non_existent_asset_xyz',
      user_id: buyer.id,
      side: 'buy',
      price: 1000,
      size: 1,
    });
    assert.equal(unknownRes.success, false, 'Unregistered stock_id must be rejected');

    const prevGuest = process.env.ALLOW_DEV_GUEST;
    process.env.ALLOW_DEV_GUEST = 'true';
    try {
      const { POST: ordersPost } = await import('../app/api/orders/route');
      const req = new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_id: optContract.id, side: 'buy', price: 10, size: 1 }),
      });
      const res = await ordersPost(req);
      assert.equal(res.status, 400, 'POST /api/orders must reject option contract ID');
    } finally {
      if (prevGuest === undefined) delete process.env.ALLOW_DEV_GUEST;
      else process.env.ALLOW_DEV_GUEST = prevGuest;
    }
    console.log('  ✅ [PASS] Option and unregistered asset bypass blocked.');
  }

  // 2. Commit gate cross-account isolation
  console.log('▶ [2] Testing PersistenceManager commit gate prevents uncommitted state leaking across snapshots...');
  {
    const db = new MemoryDatabase();
    const adapter = new ControlledMemoryAdapter();
    const pm = new PersistenceManager(adapter);
    const persist = pm.createPersistHandler(db);

    const userA = seedProfile(db, 'commit_user_a', 200_000);
    const userB = seedProfile(db, 'commit_user_b', 10_000);

    let aEnteredSave!: () => void;
    const aSavingPromise = new Promise<void>((res) => {
      aEnteredSave = res;
    });
    let finishA!: () => void;
    const aGateWait = new Promise<void>((res) => {
      finishA = res;
    });

    adapter.nextResults.push(async () => {
      aEnteredSave();
      await aGateWait;
      return false; // A fails persistence
    });
    adapter.nextResults.push(true); // B succeeds
    adapter.nextResults.push(true); // autoSave succeeds

    const txA = executeCurrencyExchange({
      db,
      userId: userA.id,
      fromCur: 'KRW',
      toCur: 'USD',
      amount: 138_000,
      onPersist: persist,
    });

    await aSavingPromise;
    const txB = executeCurrencyExchange({
      db,
      userId: userB.id,
      fromCur: 'KRW',
      toCur: 'USD',
      amount: 1380,
      onPersist: persist,
    });
    const autoSavePromise = pm.saveSnapshot(db);

    await new Promise((r) => setTimeout(r, 25));
    finishA();

    const [resA, resB, resAuto] = await Promise.all([txA, txB, autoSavePromise]);
    assert.equal(resA.success, false, 'Transaction A must fail');
    assert.equal(resB.success, true, 'Transaction B must succeed');
    assert.equal(resAuto, true, 'Auto-save must succeed');
    assert.equal(userA.cash, 200_000, 'Failed A cash must be rolled back');
    assert.equal(userB.cash, 10_000 - 1380, 'Successful B cash must be updated');

    assert.equal(adapter.savedSnapshots.length, 2, 'Expected snapshots from auto-save and transaction B');
    for (const rawSnap of adapter.savedSnapshots) {
      const checkDb = new MemoryDatabase();
      checkDb.importSnapshot(JSON.parse(rawSnap));
      assert.equal(
        checkDb.profiles.get(userA.id)!.cash,
        200_000,
        'No committed snapshot may contain failed A intermediate state'
      );
    }
    const restoredDb = new MemoryDatabase();
    restoredDb.importSnapshot(JSON.parse(adapter.savedSnapshots[adapter.savedSnapshots.length - 1]));
    assert.equal(restoredDb.profiles.get(userB.id)!.cash, 10_000 - 1380);
    console.log('  ✅ [PASS] Uncommitted failed transaction never leaks into concurrent snapshots.');
  }

  // 3. Commodity tick rollback & concurrent exchange/order
  console.log('▶ [3] Testing commodity tick rollback scope & concurrent exchange/order isolation...');
  {
    const db = new MemoryDatabase();
    const adapter = new ControlledMemoryAdapter();
    const pm = new PersistenceManager(adapter);
    const persist = pm.createPersistHandler(db);

    const engine = new CommodityMarketEngine({ totalBots: 10, db });
    await engine.reconcileWithDatabase(db);
    const user = db.profiles.get(GUEST_USER_ID)!;
    user.cash = 100_000_000;
    const commodity = engine.getCommodity('CRUDE_OIL')!;

    const ordRes = await reserveMarginAndSubmitCommodityOrder({
      db,
      commodity,
      userId: user.id,
      side: 'buy',
      type: 'market',
      price: commodity.currentPrice,
      size: 1,
      submitToEngine: () =>
        engine.submitUserOrder({
          commodityId: commodity.id,
          userId: user.id,
          side: 'buy',
          type: 'market',
          price: commodity.currentPrice,
          size: 1,
        }),
      rollbackFromEngine: (oid) => engine.removeUserOrder(commodity.id, oid),
      onPersist: persist,
      runWithEngineLock: (fn) => engine.runWithTickLock(fn),
    });
    assert.equal(ordRes.success, true);
    const cashAfterOrder = user.cash;

    const tickBefore = engine.currentTick;
    const priceBefore = commodity.currentPrice;
    const historyLenBefore = commodity.priceHistory.length;
    const tradesLenBefore = engine.tradesHistory.length;
    const botCapBefore = engine.bots.map((b) => b.currentCapital);

    let enteredPersist!: () => void;
    const persistEntered = new Promise<void>((r) => {
      enteredPersist = r;
    });
    let releasePersist!: () => void;
    const persistGate = new Promise<void>((r) => {
      releasePersist = r;
    });

    adapter.nextResults.push(async () => {
      enteredPersist();
      await persistGate;
      return false; // Simulate disk failure on tick
    });
    adapter.nextResults.push(true);
    adapter.nextResults.push(true);

    (engine as any).onPersist = persist;

    const tickPromise = engine.stepTickAsync().catch((e) => e);
    await persistEntered;

    const exPromise = executeCurrencyExchange({
      db,
      userId: user.id,
      fromCur: 'KRW',
      toCur: 'USD',
      amount: 1380,
      onPersist: persist,
    });

    const newOrdPromise = reserveMarginAndSubmitCommodityOrder({
      db,
      commodity,
      userId: user.id,
      side: 'buy',
      type: 'limit',
      price: 10,
      size: 1,
      submitToEngine: () =>
        engine.submitUserOrder({
          commodityId: commodity.id,
          userId: user.id,
          side: 'buy',
          type: 'limit',
          price: 10,
          size: 1,
        }),
      rollbackFromEngine: (oid) => engine.removeUserOrder(commodity.id, oid),
      onPersist: persist,
      runWithEngineLock: (fn) => engine.runWithTickLock(fn),
    });

    await new Promise((r) => setTimeout(r, 25));
    releasePersist();

    const [tickErr, exRes, newOrdRes] = await Promise.all([tickPromise, exPromise, newOrdPromise]);
    assert.ok(tickErr instanceof Error, 'Failed tick must throw');
    assert.equal(exRes.success, true, 'Concurrent exchange must succeed without deadlock or overwrite');
    assert.equal(newOrdRes.success, true, 'Concurrent new commodity order must succeed');

    assert.equal(engine.currentTick, tickBefore, 'Tick counter must roll back');
    assert.equal(commodity.currentPrice, priceBefore, 'Commodity price must roll back');
    assert.equal(commodity.priceHistory.length, historyLenBefore, 'Commodity priceHistory must roll back');
    assert.equal(engine.tradesHistory.length, tradesLenBefore, 'Commodity tradesHistory must roll back');
    engine.bots.forEach((b, i) => {
      assert.equal(b.currentCapital, botCapBefore[i], `Bot ${i} capital must roll back`);
    });

    const newOrderMargin = calculateCommodityMarginPerContractKrw(commodity, db);
    assert.equal(
      user.cash,
      cashAfterOrder - 1380 - newOrderMargin,
      'User cash must reflect BOTH concurrent exchange and new order after tick rollback'
    );
    assert.equal(db.commodityOpenOrders.has(newOrdRes.order!.id), true, 'New commodity order must remain in open orders');
    assert.equal(db.commodityOpenOrders.has(ordRes.order!.id), true, 'Original pre-tick order must remain open');
    console.log('  ✅ [PASS] Commodity tick rollback is scoped & concurrent exchange/orders preserved.');
  }

  // 4. Currency exchange rounding arbitrage
  console.log('▶ [4] Testing currency exchange rounding arbitrage blocked...');
  {
    const db = new MemoryDatabase();
    const u = seedProfile(db, 'fx_arb_user', 100);

    const smallFail = await executeCurrencyExchange({
      db,
      userId: u.id,
      fromCur: 'KRW',
      toCur: 'USD',
      amount: 7,
    });
    assert.equal(smallFail.success, false, '7 KRW -> USD must be rejected');
    assert.equal(u.cash, 100);

    const leg1 = await executeCurrencyExchange({
      db,
      userId: u.id,
      fromCur: 'KRW',
      toCur: 'USD',
      amount: 14,
    });
    assert.equal(leg1.success, true);
    assert.equal(leg1.data!.to_amount, 0.01);

    const leg2 = await executeCurrencyExchange({
      db,
      userId: u.id,
      fromCur: 'USD',
      toCur: 'KRW',
      amount: 0.01,
    });
    assert.equal(leg2.success, true);
    assert.equal(leg2.data!.to_amount, 13);
    assert.ok(u.cash <= 100, `Round-trip must never create KRW (got ${u.cash})`);

    const jpyBefore = u.cash;
    const jpyLeg1 = await executeCurrencyExchange({ db, userId: u.id, fromCur: 'KRW', toCur: 'JPY', amount: 5 });
    assert.equal(jpyLeg1.success, false, '5 KRW -> JPY (< 1 JPY at 9.2) must be rejected');
    assert.equal(u.cash, jpyBefore);
    console.log('  ✅ [PASS] Currency exchange rounding arbitrage blocked.');
  }

  // 5. Cross-asset reservation & no double-count
  console.log('▶ [5] Testing cross-asset cash reservation & no commodity margin double deduction...');
  {
    const db = new MemoryDatabase();
    const u = seedProfile(db, 'cross_res_user', 600_000, { has_options_license: true });
    const contract = db.optionsContracts.get('opt_c_720')!;
    contract.expiry_date = new Date(Date.now() + 86400_000).toISOString();

    const optRes = await submitAuthoritativeOptionOrder({
      db,
      userId: u.id,
      contractId: contract.id,
      side: 'BUY',
      orderType: 'LIMIT',
      price: 2,
      qty: 1,
    });
    assert.equal(optRes.success, true);
    assert.equal(optRes.order?.status, 'open');

    const avail = getAvailableCashKrw(db, u.id);
    assert.equal(avail.reservedCash, 500_500);
    assert.equal(avail.availableCash, 99_500);

    const userOrders = Array.from(db.orders.values()).filter((o) => o.user_id === u.id);
    const stockCap = validateOrderCapacity({
      userId: u.id,
      stockId: STOCK_UUID_MAP['0010'],
      side: 'buy',
      incomingPrice: 200_000,
      incomingSize: 1,
      currentCash: u.cash,
      currentHoldingQty: 0,
      openOrders: userOrders as any,
      optionsContracts: db.optionsContracts,
    });
    assert.equal(stockCap.valid, false);
    assert.equal(stockCap.reserved, 500_500);

    const exRes = await executeCurrencyExchange({
      db,
      userId: u.id,
      fromCur: 'KRW',
      toCur: 'USD',
      amount: 552_000,
    });
    assert.equal(exRes.success, false);

    const rich = seedProfile(db, 'comm_nodouble_user', 14_000_000);
    const commEngine = new CommodityMarketEngine({ totalBots: 0, db });
    const oil = commEngine.getCommodity('CRUDE_OIL')!;
    const oneMargin = calculateCommodityMarginPerContractKrw(oil, db);
    assert.equal(oneMargin, 6_900_000);

    const c1 = await reserveMarginAndSubmitCommodityOrder({
      db,
      commodity: oil,
      userId: rich.id,
      side: 'buy',
      type: 'limit',
      price: 70,
      size: 1,
      submitToEngine: () =>
        commEngine.submitUserOrder({ commodityId: oil.id, userId: rich.id, side: 'buy', type: 'limit', price: 70, size: 1 }),
      rollbackFromEngine: (oid) => commEngine.removeUserOrder(oil.id, oid),
    });
    assert.equal(c1.success, true);
    assert.equal(rich.cash, 14_000_000 - 6_900_000);

    const c2 = await reserveMarginAndSubmitCommodityOrder({
      db,
      commodity: oil,
      userId: rich.id,
      side: 'buy',
      type: 'limit',
      price: 70,
      size: 1,
      submitToEngine: () =>
        commEngine.submitUserOrder({ commodityId: oil.id, userId: rich.id, side: 'buy', type: 'limit', price: 70, size: 1 }),
      rollbackFromEngine: (oid) => commEngine.removeUserOrder(oil.id, oid),
    });
    assert.equal(c2.success, true);
    console.log('  ✅ [PASS] Cross-asset reservation and no-double-deduction verified.');
  }

  // 6. engine-server restart ID isolation
  console.log('▶ [6] Testing engine-server restart assigns distinct epoch/runId and avoids ID collision...');
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-eng-restart-'));
    try {
      const db1 = new MemoryDatabase();
      const pm1 = new PersistenceManager(new FileStorageAdapter(tmpDir));
      const rt1 = await prepareEngineRestartRuntime(db1, pm1, { seed: 42 });
      assert.equal(rt1.epoch, 1);
      assert.equal(rt1.runId, 'run_seed_42_e1');

      const eng1 = new MarketEngine({
        simulationContext: rt1.context,
        repositories: createInMemoryRepositoryBundle(db1),
        initialTickCount: rt1.initialTickCount,
        initialPartialFillSequence: rt1.initialPartialFillSequence,
        onTickCommitPersist: async ({ tickCount, partialFillSequence }) => {
          db1.engineTickCount = tickCount;
          db1.enginePartialFillSequence = partialFillSequence;
          return await pm1.saveSnapshot(db1);
        },
      });
      const t1 = await eng1.tick();
      assert.equal(t1.success, true);
      pm1.releaseWriterLock();

      const db2 = new MemoryDatabase();
      const pm2 = new PersistenceManager(new FileStorageAdapter(tmpDir));
      const rt2 = await prepareEngineRestartRuntime(db2, pm2, { seed: 42 });
      assert.equal(rt2.restoredFromSnapshot, true);
      assert.equal(rt2.epoch, 2);
      assert.equal(rt2.runId, 'run_seed_42_e2');
      assert.ok(rt2.initialTickCount >= 1);
      assert.notEqual(rt2.runId, rt1.runId);
      pm2.releaseWriterLock();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    console.log('  ✅ [PASS] engine-server restart epoch & ID isolation verified.');
  }

  // 7. Settlement ledger bounds with real generated IDs
  console.log('▶ [7] Testing settlementLedger O(1) compression with real generated IDs & replay protection...');
  {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-ledger-real-'));
    try {
      const db = new MemoryDatabase();
      const pm = new PersistenceManager(new FileStorageAdapter(tmpDir));
      const settledOptionIds: string[] = [];
      const settledDetIds: string[] = [];

      for (let i = 0; i < 15; i++) {
        const optId = db.nextMonotonicTradeId('opt_tr');
        settledOptionIds.push(optId);
        db.settlementLedger.set(optId, {
          trade_id: optId,
          stock_id: 'opt_c_720',
          price: 2.15,
          size: 1,
          total_amount: 537500,
          buyer_fee_rate: 0.001,
          seller_fee_rate: 0.001,
          buyer_fee_amount: 538,
          seller_fee_amount: 538,
          settled_at: db.getIsoTimestamp(),
        });
      }

      for (let i = 0; i < 15; i++) {
        const detId = buildDeterministicTradeId({
          runId: 'run_seed_42_e1',
          tickSequence: i + 1,
          stockId: '0010',
          buyOrderId: `b_${i}`,
          sellOrderId: `s_${i}`,
          partialFillSequence: i,
          price: 72000,
          size: 10,
        });
        settledDetIds.push(detId);
        db.settlementLedger.set(detId, {
          trade_id: detId,
          stock_id: '0010',
          price: 72000,
          size: 10,
          total_amount: 720000,
          buyer_fee_rate: 0.0025,
          seller_fee_rate: -0.001,
          buyer_fee_amount: 1800,
          seller_fee_amount: -720,
          settled_at: db.getIsoTimestamp(),
        });
      }

      const trimmed = db.trimSettlementLedger(10);
      assert.equal(trimmed, 20);
      assert.equal(db.settlementLedger.size, 10);
      assert.equal(db.evictedCustomTradeIds.size, 0);
      assert.equal(db.isTradeAlreadySettled(settledOptionIds[0]), true);
      assert.equal(db.isTradeAlreadySettled(settledDetIds[0]), true);

      assert.equal(await pm.saveSnapshot(db), true);
      pm.releaseWriterLock();

      const db2 = new MemoryDatabase();
      const pm2 = new PersistenceManager(new FileStorageAdapter(tmpDir));
      assert.equal(await pm2.loadSnapshot(db2), true);
      assert.equal(db2.isTradeAlreadySettled(settledOptionIds[0]), true);
      assert.equal(db2.isTradeAlreadySettled(settledDetIds[0]), true);
      pm2.releaseWriterLock();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
    console.log('  ✅ [PASS] Real trade IDs compress cleanly without evictedCustomTradeIds growth.');
  }

  // 8. Auto-trade durability boundary
  console.log('▶ [8] Testing auto-trade durability boundary on both engines...');
  {
    const db = new MemoryDatabase();
    const eng = new MarketEngine({
      repositories: createInMemoryRepositoryBundle(db),
      onTickCommitPersist: async () => false,
    });
    const tickRes = await eng.tick();
    assert.equal(tickRes.success, false);
    assert.equal(tickRes.errorCode, 'PERSISTENCE_FAILED');

    const stockId = STOCK_UUID_MAP['0010'];
    const buyer = seedProfile(memoryDb, 'auto_dur_buyer', 1_000_000);
    const seller = seedProfile(memoryDb, 'auto_dur_seller', 500_000);
    const hKey = `${seller.id}_${stockId}`;
    memoryDb.holdings.set(hKey, {
      id: hKey,
      user_id: seller.id,
      stock_id: stockId,
      quantity: 10,
      avg_price: 70000,
      created_at: memoryDb.getIsoTimestamp(),
    });
    memoryDb.addHoldingToIndex(memoryDb.holdings.get(hKey)!);

    const localEngine = new LocalMarketEngineInstance();
    localEngine.setOnPersist(async () => false);
    const tradesBefore = memoryDb.trades.length;
    await localEngine.processMatching([
      {
        stock_id: stockId,
        user_id: buyer.id,
        side: 'buy',
        price: 999_999,
        size: 1,
        filled: 0,
        status: 'open',
        is_lp: false,
        created_at: new Date().toISOString(),
      },
      {
        stock_id: stockId,
        user_id: seller.id,
        side: 'sell',
        price: 999_999,
        size: 1,
        filled: 0,
        status: 'open',
        is_lp: false,
        created_at: new Date().toISOString(),
      },
    ]);
    assert.equal(buyer.cash, 1_000_000);
    assert.equal(memoryDb.trades.length, tradesBefore);
    assert.equal(localEngine.lastPersistOk, false);
    console.log('  ✅ [PASS] Auto-trade durability boundary verified on both engines.');
  }

  // 9. Option unified price priority
  console.log('▶ [9] Testing option matching prefers cheaper LP ask (10) over expensive user ask (20)...');
  {
    const db = new MemoryDatabase();
    const seller20 = seedProfile(db, 'opt_seller_20', 1_000_000, { has_options_license: true });
    const buyer = seedProfile(db, 'opt_buyer_mkt', 10_000_000, { has_options_license: true });
    const contract = db.optionsContracts.get('opt_c_720')!;
    contract.current_price = 10;
    contract.expiry_date = new Date(Date.now() + 86400_000).toISOString();

    db.holdings.set(`${seller20.id}_${contract.id}`, {
      id: `${seller20.id}_${contract.id}`,
      user_id: seller20.id,
      stock_id: contract.id,
      quantity: 2,
      avg_price: 10,
      created_at: db.getIsoTimestamp(),
    });
    db.addHoldingToIndex(db.holdings.get(`${seller20.id}_${contract.id}`)!);

    const sell20Res = await submitAuthoritativeOptionOrder({
      db,
      userId: seller20.id,
      contractId: contract.id,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 20,
      qty: 1,
    });
    assert.equal(sell20Res.success, true);

    const mktBuy = await submitAuthoritativeOptionOrder({
      db,
      userId: buyer.id,
      contractId: contract.id,
      side: 'BUY',
      orderType: 'MARKET',
      qty: 1,
    });
    assert.equal(mktBuy.success, true);
    assert.equal(mktBuy.order?.avgExecPrice, 10);
    assert.equal(db.orders.get(sell20Res.order!.orderId)!.status, 'open');
    console.log('  ✅ [PASS] Option market order matched LP ask 10 ahead of user ask 20.');
  }

  // 10. Commodity rate_to_krw
  console.log('▶ [10] Testing commodity margin/PnL uses rate_to_krw (1380)...');
  {
    const db = new MemoryDatabase();
    assert.equal(getUsdToKrwRate(db), 1380);
    const comm = new CommodityMarketEngine({ totalBots: 0, db }).getCommodity('CRUDE_OIL')!;
    assert.equal(calculateCommodityMarginPerContractKrw(comm, db), comm.marginRequirement * 1380);
    console.log('  ✅ [PASS] Commodity rate_to_krw schema unified.');
  }

  // 11. Commodity reduce-only & duplicate closing
  console.log('▶ [11] Testing commodity reduce-only margin, duplicate closing guard & flip margin...');
  {
    const db = new MemoryDatabase();
    const eng = new CommodityMarketEngine({ totalBots: 0, db });
    const oil = eng.getCommodity('CRUDE_OIL')!;
    const marginOne = calculateCommodityMarginPerContractKrw(oil, db);
    const u = seedProfile(db, 'comm_reduce_user', marginOne);
    const botMaker = 'bot_comm_maker';

    const b1 = await reserveMarginAndSubmitCommodityOrder({
      db,
      commodity: oil,
      userId: u.id,
      side: 'buy',
      type: 'limit',
      price: 75,
      size: 1,
      submitToEngine: () =>
        eng.submitUserOrder({ commodityId: oil.id, userId: u.id, side: 'buy', type: 'limit', price: 75, size: 1 }),
      rollbackFromEngine: (oid) => eng.removeUserOrder(oil.id, oid),
    });
    assert.equal(b1.success, true);

    await settleCommodityTradeForUsers(
      db,
      {
        id: 'cm_reduce_open_1',
        commodityId: oil.id,
        buyOrderId: b1.order!.id,
        sellOrderId: 'bot_sell_1',
        buyerId: u.id,
        sellerId: botMaker,
        price: 75,
        size: 1,
        tick: 1,
        timestamp: Date.now(),
      },
      oil
    );
    assert.equal(u.cash, 0);

    const close1 = await reserveMarginAndSubmitCommodityOrder({
      db,
      commodity: oil,
      userId: u.id,
      side: 'sell',
      type: 'limit',
      price: 75,
      size: 1,
      submitToEngine: () =>
        eng.submitUserOrder({ commodityId: oil.id, userId: u.id, side: 'sell', type: 'limit', price: 75, size: 1 }),
      rollbackFromEngine: (oid) => eng.removeUserOrder(oil.id, oid),
    });
    assert.equal(close1.success, true);
    assert.equal(close1.reservation!.reserved_krw, 0);

    const dupClose = await reserveMarginAndSubmitCommodityOrder({
      db,
      commodity: oil,
      userId: u.id,
      side: 'sell',
      type: 'limit',
      price: 75,
      size: 1,
      submitToEngine: () =>
        eng.submitUserOrder({ commodityId: oil.id, userId: u.id, side: 'sell', type: 'limit', price: 75, size: 1 }),
      rollbackFromEngine: (oid) => eng.removeUserOrder(oil.id, oid),
    });
    assert.equal(dupClose.success, false);

    await settleCommodityTradeForUsers(
      db,
      {
        id: 'cm_reduce_close_1',
        commodityId: oil.id,
        buyOrderId: 'bot_buy_1',
        sellOrderId: close1.order!.id,
        buyerId: botMaker,
        sellerId: u.id,
        price: 75,
        size: 1,
        tick: 2,
        timestamp: Date.now(),
      },
      oil
    );
    assert.equal(u.cash, marginOne);
    console.log('  ✅ [PASS] Commodity reduce-only and duplicate-closing margin rules verified.');
  }

  // 12 & 13. Option account & active option chain
  console.log('▶ [12,13] Testing option account summary/cancel/liquidate & unexpired active option chain...');
  {
    const db = new MemoryDatabase();
    const u = seedProfile(db, 'opt_acc_user', 20_000_000, { has_options_license: true });
    const nowMs = Date.now();
    const idxContracts = Array.from(db.optionsContracts.values()).filter((c) => c.asset_class === 'IDX');
    assert.ok(idxContracts.length >= 40);
    for (const c of idxContracts) {
      assert.ok(Date.parse(c.expiry_date) > nowMs);
      assert.ok(!c.ticker.includes('2608'));
    }

    const target = idxContracts.find((c) => c.current_price >= 1.0) ?? idxContracts[0];
    await submitAuthoritativeOptionOrder({
      db,
      userId: u.id,
      contractId: target.id,
      side: 'BUY',
      orderType: 'LIMIT',
      price: Math.max(0.01, Math.round((target.current_price * 0.5) * 100) / 100),
      qty: 1,
    });
    await submitAuthoritativeOptionOrder({
      db,
      userId: u.id,
      contractId: target.id,
      side: 'BUY',
      orderType: 'MARKET',
      qty: 1,
    });

    const summary = getOptionAccountSummary(db, u.id);
    assert.equal(summary.positions.length, 1);
    assert.equal(summary.unfilled.length, 1);
    assert.equal(summary.trades.length, 1);

    const cancelAllRes = await cancelAllOptionOrders({ db, userId: u.id });
    assert.equal(cancelAllRes.cancelledCount, 1);

    const liqRes = await liquidateAllOptionPositions({ db, userId: u.id });
    assert.equal(liqRes.success, true);
    assert.equal(liqRes.liquidatedCount, 1);
    assert.equal(getOptionAccountSummary(db, u.id).positions.length, 0);
    console.log('  ✅ [PASS] Option account real data, cancel/liquidate & dynamic chain verified.');
  }

  // 14. ETF catalog & server order
  console.log('▶ [14] Testing all ETF_CATALOG tickers seeded in memoryDb & tradable via /api/orders...');
  {
    for (const etf of ETF_CATALOG) {
      assert.ok(memoryDb.tickerIndex.has(etf.etfTicker), `ETF ${etf.etfTicker} must be seeded`);
    }

    const prevGuest = process.env.ALLOW_DEV_GUEST;
    process.env.ALLOW_DEV_GUEST = 'true';
    try {
      const { POST: ordersPost } = await import('../app/api/orders/route');
      const kodexSemiId = memoryDb.tickerIndex.get('KODEXSEMI')!;
      const stock = memoryDb.stocks.get(kodexSemiId)!;
      const req = new Request('http://localhost/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stock_id: kodexSemiId, side: 'buy', price: stock.current_price, size: 1 }),
      });
      const res = await ordersPost(req);
      assert.equal(res.status, 200);
    } finally {
      if (prevGuest === undefined) delete process.env.ALLOW_DEV_GUEST;
      else process.env.ALLOW_DEV_GUEST = prevGuest;
    }
    console.log('  ✅ [PASS] ETF catalog seeding & authoritative server order verified.');
  }

  // 15. Player event resolution
  console.log('▶ [15] Testing authoritative player event resolution...');
  {
    const db = new MemoryDatabase();
    const owner = seedProfile(db, 'evt_owner', 500_000);
    const attacker = seedProfile(db, 'evt_attacker', 500_000);

    db.playerEvents.push({
      id: 'evt_tmpl_1',
      stage: 1,
      title: '테스트 돌발 이벤트',
      description: '설명',
      choice_a_text: '투자',
      choice_a_cost: 100_000,
      choice_a_passive: 'PASSIVE_INSIGHT',
      choice_b_text: '패스',
      choice_b_cost: 0,
      choice_b_passive: null,
    });
    db.activePlayerEvents.push({
      id: 'active_evt_1',
      user_id: owner.id,
      event_id: 'evt_tmpl_1',
      status: 'pending',
    });

    const hijack = await resolvePlayerEventChoice({
      db,
      userId: attacker.id,
      activeEventId: 'active_evt_1',
      choice: 'A',
    });
    assert.equal(hijack.statusCode, 403);

    const saveFail = await resolvePlayerEventChoice({
      db,
      userId: owner.id,
      activeEventId: 'active_evt_1',
      choice: 'A',
      onPersist: async () => false,
    });
    assert.equal(saveFail.statusCode, 500);
    assert.equal(owner.cash, 500_000);
    assert.equal(db.activePlayerEvents[0].status, 'pending');

    const ok = await resolvePlayerEventChoice({
      db,
      userId: owner.id,
      activeEventId: 'active_evt_1',
      choice: 'A',
    });
    assert.equal(ok.success, true);
    assert.equal(owner.cash, 400_000);
    assert.deepEqual(owner.acquired_passives, ['PASSIVE_INSIGHT']);
    assert.equal(db.activePlayerEvents[0].status, 'resolved');

    const dup = await resolvePlayerEventChoice({
      db,
      userId: owner.id,
      activeEventId: 'active_evt_1',
      choice: 'A',
    });
    assert.equal(dup.statusCode, 409);
    console.log('  ✅ [PASS] Authoritative player event validation, rollback & idempotency verified.');
  }

  // 16. Cold-start readiness
  console.log('▶ [16] Testing DB readiness separation & market-flow/SSR cold-start wait...');
  {
    await ensureMemoryDbReady();

    const { GET: marketFlowGet } = await import('../app/api/market-flow/route');
    const mfRes = await marketFlowGet(new Request('http://localhost/api/market-flow'));
    assert.equal(mfRes.status, 200);

    const { createClient: createServerClient } = await import('../lib/db/server');
    const serverDb = await createServerClient();
    const { data: stocks } = await serverDb.from('stocks').select('id').limit(1);
    assert.ok(Array.isArray(stocks) && stocks.length > 0);

    stopLocalStandaloneEngine();
    console.log('  ✅ [PASS] Cold-start DB restore readiness & non-blocking routes verified.');
  }

  console.log('\n🎉 ALL 16 CODEX REVIEW REGRESSION TESTS PASSED');
}

main()
  .finally(() => {
    fs.rmSync(ISOLATED_DATA_DIR, { recursive: true, force: true });
  })
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Regression test failed:', err);
    process.exit(1);
  });
