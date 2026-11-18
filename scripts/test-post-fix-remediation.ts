import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const ISOLATED_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-remediation-'));
process.env.STOCKSYS_DATA_DIR = ISOLATED_DATA_DIR;

async function main() {
  const { MemoryDatabase, STOCK_UUID_MAP } = await import('../lib/memoryDb/memoryStore');
  const { createMemoryDbClient } = await import('../lib/memoryDb/memoryDbClient');
  const { PersistenceManager } = await import('../lib/memoryDb/PersistenceManager');
  const { FileStorageAdapter } = await import('../lib/memoryDb/StorageAdapter');
  const { createInMemoryRepositoryBundle } = await import('../lib/repositories/inMemory');
  const { submitAuthoritativeOptionOrder, OPTIONS_LP_ID } = await import('../lib/options/optionOrderService');
  const { submitAndMatchOrder } = await import('../lib/engine/dbMatching');
  const { validateOrderCapacity, calculateReservedCash } = await import('../lib/engine/orderRisk');
  const { LocalMarketService } = await import('../lib/engine/marketService');
  const { CommodityMarketEngine } = await import('../lib/commodities/CommodityMarketEngine');
  const { reserveMarginAndSubmitCommodityOrder, cancelCommodityOrders, calculateCommodityMarginPerContractKrw } = await import('../lib/commodities/commodityLedger');
  const { MarketEngine } = await import('../engine-server/src/MarketEngine');
  const { HttpMemoryClient } = await import('../lib/db/client');
  const { isUsdQuotedAsset } = await import('../lib/engine/currency');

  function seedUser(db: InstanceType<typeof MemoryDatabase>, id: string, cash: number) {
    const p = {
      id,
      user_id: id,
      username: id,
      nickname: id,
      cash,
      net_worth: cash,
      rank_tier: 'Bronze',
      is_admin: false,
      has_options_license: true,
      created_at: db.getIsoTimestamp(),
    };
    db.profiles.set(id, p);
    db.profileUserIdIndex.set(id, id);
    return p;
  }

  console.log('\n======================================================');
  console.log('🧪 POST-FIX COMPREHENSIVE REMEDIATION REGRESSION SUITE');
  console.log('======================================================\n');

  // ── 1. [P1-1] Option Buyer Counterparty Fee, Cumulative Fill Cash & Seller Holdings Validation ──
  console.log('▶ [1] Testing P1-1: Option counterparty fees, cumulative fill validation, resting seller holdings & rollback...');
  {
    const db = new MemoryDatabase();
    const contract = Array.from(db.optionsContracts.values())[0];
    contract.current_price = 2.0; // 2.0 * 250,000 = 500,000 per contract

    // [1a] Two resting BUY orders from same buyer cp1 for 1 contract @ 2.0 each (500,500 * 2 = 1,001,000)
    // Give cp1 only 1,000,000 -> passes each single check without fee/cumul, fails cumulative+fee!
    const cp1 = seedUser(db, 'opt_cp_buy_cumul', 1_000_000);
    const seller = seedUser(db, 'opt_seller_1', 500_000);
    const sellerHKey = `${seller.id}_${contract.id}`;
    db.holdings.set(sellerHKey, {
      id: sellerHKey,
      user_id: seller.id,
      stock_id: contract.id,
      quantity: 5,
      avg_price: 1.5,
      created_at: db.getIsoTimestamp(),
    });
    db.addHoldingToIndex(db.holdings.get(sellerHKey)!);

    const buyOrd1 = {
      id: 'opt_rest_b1', stock_id: contract.id, user_id: cp1.id, side: 'buy' as const,
      price: 2.0, size: 1, filled: 0, status: 'open' as const, is_lp: false, created_at: '2026-01-01T00:00:00Z',
    };
    const buyOrd2 = {
      id: 'opt_rest_b2', stock_id: contract.id, user_id: cp1.id, side: 'buy' as const,
      price: 2.0, size: 1, filled: 0, status: 'open' as const, is_lp: false, created_at: '2026-01-01T00:00:01Z',
    };
    db.orders.set(buyOrd1.id, buyOrd1); db.addOrderToIndex(buyOrd1);
    db.orders.set(buyOrd2.id, buyOrd2); db.addOrderToIndex(buyOrd2);

    const resSellFail = await submitAuthoritativeOptionOrder({
      db, userId: seller.id, contractId: contract.id, side: 'SELL', orderType: 'LIMIT', price: 2.0, qty: 2,
    });
    assert.equal(resSellFail.success, false, 'Incoming SELL matching buyer lacking cumulative+fee cash must be rejected');
    assert.equal(resSellFail.statusCode, 400);
    assert.equal(cp1.cash, 1_000_000, 'Counterparty cash untouched on atomic rejection');
    assert.equal(seller.cash, 500_000, 'Seller cash untouched on atomic rejection');
    assert.equal(db.holdings.get(sellerHKey)?.quantity, 5, 'Seller holdings untouched on atomic rejection');
    assert.equal(buyOrd1.status, 'open');
    assert.equal(buyOrd2.status, 'open');

    // [1b] Exact 1-contract fee edge: cp2 has 1,000,000, price=4.0 (notional=1,000,000, fee=1,000, req=1,001,000)
    const cp2 = seedUser(db, 'opt_cp_fee_edge', 1_000_000);
    const buyEdge = {
      id: 'opt_rest_edge', stock_id: contract.id, user_id: cp2.id, side: 'buy' as const,
      price: 4.0, size: 1, filled: 0, status: 'open' as const, is_lp: false, created_at: '2026-01-01T00:00:00Z',
    };
    db.orders.set(buyEdge.id, buyEdge); db.addOrderToIndex(buyEdge);

    // Clear cp1 orders so seller hits cp2
    db.orders.delete(buyOrd1.id); db.removeOrderFromIndex(buyOrd1);
    db.orders.delete(buyOrd2.id); db.removeOrderFromIndex(buyOrd2);

    const resEdgeFail = await submitAuthoritativeOptionOrder({
      db, userId: seller.id, contractId: contract.id, side: 'SELL', orderType: 'LIMIT', price: 4.0, qty: 1,
    });
    assert.equal(resEdgeFail.success, false);
    assert.equal(cp2.cash, 1_000_000, 'Exact fee boundary rejects without negative cash');

    // Give cp2 exact 1,001,000 -> succeeds and cp2.cash === 0
    cp2.cash = 1_001_000;
    const resEdgeOk = await submitAuthoritativeOptionOrder({
      db, userId: seller.id, contractId: contract.id, side: 'SELL', orderType: 'LIMIT', price: 4.0, qty: 1,
    });
    assert.equal(resEdgeOk.success, true, 'Exact cash including buyer fee succeeds');
    assert.equal(cp2.cash, 0, 'Buyer cash finishes at 0 (1,000,000 notional + 1,000 fee)');

    // [1c] Non-LP resting seller lacking sufficient holdings must fail BEFORE mutation
    const poorSeller = seedUser(db, 'opt_poor_seller', 500_000);
    const poorAsk = {
      id: 'opt_rest_ask_poor', stock_id: contract.id, user_id: poorSeller.id, side: 'sell' as const,
      price: 1.5, size: 2, filled: 0, status: 'open' as const, is_lp: false, created_at: '2026-01-01T00:00:00Z',
    };
    db.orders.set(poorAsk.id, poorAsk); db.addOrderToIndex(poorAsk);
    const buyer3 = seedUser(db, 'opt_buyer_3', 5_000_000);
    const resPoorSellerFail = await submitAuthoritativeOptionOrder({
      db, userId: buyer3.id, contractId: contract.id, side: 'BUY', orderType: 'LIMIT', price: 1.5, qty: 2,
    });
    assert.equal(resPoorSellerFail.success, false);
    assert.equal(resPoorSellerFail.statusCode, 400);
    assert.equal(buyer3.cash, 5_000_000, 'Buyer cash completely preserved when resting seller lacks holdings');
    assert.equal(poorAsk.filled, 0);
  }
  console.log('  ✅ [PASS] P1-1 verified.');

  // ── 2. [P1-2] MarketEngine.tick() Persistence Boundary Rollback & Observer Deferral ──
  console.log('\n▶ [2] Testing P1-2: MarketEngine.tick() rollback, observer non-fire, retry idempotency, tick-50 save...');
  {
    const db = new MemoryDatabase();
    const stockId = STOCK_UUID_MAP['0010'];
    const buyer = seedUser(db, 'p12_buyer', 10_000_000);
    const seller = seedUser(db, 'p12_seller', 1_000_000);
    const shKey = `${seller.id}_${stockId}`;
    db.holdings.set(shKey, { id: shKey, user_id: seller.id, stock_id: stockId, quantity: 100, avg_price: 70000, created_at: db.getIsoTimestamp() });
    db.addHoldingToIndex(db.holdings.get(shKey)!);

    // Seed matching orders directly in DB so tick 1 matches them
    const bOrd = { id: 'p12_b', stock_id: stockId, user_id: buyer.id, side: 'buy' as const, price: 72000, size: 5, filled: 0, status: 'open' as const, is_lp: false, created_at: db.getIsoTimestamp(), version: 1, originalQuantity: 5, remainingQuantity: 5, filledQuantity: 0 };
    const sOrd = { id: 'p12_s', stock_id: stockId, user_id: seller.id, side: 'sell' as const, price: 72000, size: 5, filled: 0, status: 'open' as const, is_lp: false, created_at: db.getIsoTimestamp(), version: 1, originalQuantity: 5, remainingQuantity: 5, filledQuantity: 0 };
    db.orders.set(bOrd.id, bOrd); db.addOrderToIndex(bOrd);
    db.orders.set(sOrd.id, sOrd); db.addOrderToIndex(sOrd);

    let persistAllowed = false;
    const observerEvents: any[] = [];
    let lastPersistInfo: any = null;
    const tradesBefore = db.trades.length;

    const eng = new MarketEngine({
      repositories: createInMemoryRepositoryBundle(db),
      executionObserver: {
        async onSettlementCommitted(ev) {
          observerEvents.push(ev);
        },
      },
      onTickCommitPersist: async (info) => {
        lastPersistInfo = info;
        return persistAllowed;
      },
    });

    const failTick = await eng.tick();
    assert.equal(failTick.success, false);
    assert.equal(failTick.commitStatus, 'NOT_COMMITTED', 'Failed persist MUST return NOT_COMMITTED');
    assert.equal(failTick.errorCode, 'PERSISTENCE_FAILED');
    assert.equal(observerEvents.length, 0, 'executionObserver must NOT fire when onTickCommitPersist fails');
    assert.equal(eng.getRuntimeCounters().tickCount, 0, 'tickCount must roll back to 0');
    assert.equal(db.profiles.get(buyer.id)!.cash, 10_000_000, 'Buyer cash must roll back completely on persist failure');
    assert.equal(db.profiles.get(seller.id)!.cash, 1_000_000, 'Seller cash must roll back completely on persist failure');
    assert.equal(db.trades.length, tradesBefore, 'Trades must roll back completely on persist failure');
    assert.equal(db.settlementLedger.size, 0, 'SettlementLedger must roll back completely on persist failure');

    // Retry with persistAllowed = true -> settles cleanly once & observer fires once!
    persistAllowed = true;
    const retryTick = await eng.tick();
    assert.equal(retryTick.success, true);
    assert.equal(retryTick.commitStatus, 'COMMITTED');
    assert.equal(eng.getRuntimeCounters().tickCount, 1);
    assert.equal(observerEvents.length, 1, 'executionObserver must fire once after committed persist succeeds');
    assert.equal(db.trades.length >= tradesBefore + 1, true);
    assert.ok(db.profiles.get(buyer.id)!.cash < 10_000_000, 'Buyer cash debited on successful retry');

    // Verify expired option settlement on tick 50 signals hasPersistentStateChanges === true
    const dbOpt = new MemoryDatabase();
    const optBuyer = seedUser(dbOpt, 'p12_opt_owner', 1_000_000);
    const optContract = Array.from(dbOpt.optionsContracts.values())[0];
    optContract.expiry_date = '2020-01-01T00:00:00.000Z';
    const ohKey = `${optBuyer.id}_${optContract.id}`;
    dbOpt.holdings.set(ohKey, { id: ohKey, user_id: optBuyer.id, stock_id: optContract.id, quantity: 2, avg_price: 1.0, created_at: dbOpt.getIsoTimestamp() });
    dbOpt.addHoldingToIndex(dbOpt.holdings.get(ohKey)!);
    let tick50PersistInfo: any = null;
    const eng50 = new MarketEngine({
      repositories: createInMemoryRepositoryBundle(dbOpt),
      initialTickCount: 49,
      onTickCommitPersist: async (info) => {
        tick50PersistInfo = info;
        return true;
      },
    });
    const t50 = await eng50.tick();
    assert.equal(t50.success, true);
    assert.equal(tick50PersistInfo?.tickCount, 50);
    assert.equal(tick50PersistInfo?.hasPersistentStateChanges, true, 'Non-trade option expiry settlement on tick 50 sets hasPersistentStateChanges=true');
  }
  console.log('  ✅ [PASS] P1-2 verified.');

  // ── 3. [P2-1] Boot importSnapshot Supplement vs Rollback Non-Synthesis ──
  console.log('\n▶ [3] Testing P2-1: Non-destructive catalog/option supplement & rollback isolation...');
  {
    const fresh = new MemoryDatabase();
    const snap = fresh.exportSnapshot();

    // Remove KODEXSEMI and force all option expiry dates into the past
    const kodexSemiId = STOCK_UUID_MAP['KODEXSEMI'];
    snap.stocks = snap.stocks.filter(([id]: [string, any]) => id !== kodexSemiId);
    const pastIso = '2021-01-01T00:00:00.000Z';
    snap.optionsContracts = snap.optionsContracts.map(([id, c]: [string, any]) => [
      id,
      { ...c, expiry_date: pastIso },
    ]);

    // Rollback restore must NOT synthesize new stocks/options or bump tradeEpoch!
    const rbDb = new MemoryDatabase();
    const epochBefore = snap.tradeEpoch;
    rbDb.restoreRollbackSnapshot(snap);
    assert.equal(rbDb.stocks.has(kodexSemiId), false, 'restoreRollbackSnapshot must not synthesize missing ETF');
    assert.equal(rbDb.tradeEpoch, epochBefore, 'restoreRollbackSnapshot must preserve exact tradeEpoch');
    assert.equal(
      Array.from(rbDb.optionsContracts.values()).filter((c) => Date.parse(c.expiry_date) > Date.now()).length,
      0,
      'restoreRollbackSnapshot must not synthesize new future options'
    );

    // Boot importSnapshot MUST supplement KODEXSEMI & new future option contracts while keeping old contracts' past expiry intact!
    const bootDb = new MemoryDatabase();
    bootDb.importSnapshot(snap);
    assert.equal(bootDb.stocks.has(kodexSemiId), true, 'Boot importSnapshot supplements missing KODEXSEMI');
    assert.equal(bootDb.tradeEpoch, epochBefore + 1, 'Boot importSnapshot advances tradeEpoch by 1');
    assert.equal(bootDb.optionsContracts.get('opt_c_720')?.expiry_date, pastIso, 'Existing expired contract expiry_date must remain untouched');
    const unexpiredCount = Array.from(bootDb.optionsContracts.values()).filter((c) => Date.parse(c.expiry_date) > Date.now()).length;
    assert.ok(unexpiredCount > 0, `Boot importSnapshot adds future option months (count=${unexpiredCount})`);
  }
  console.log('  ✅ [PASS] P2-1 verified.');

  // ── 4. [P2-2] Out-of-Order Watermarks & Bond/Option Ledger Compaction ──
  console.log('\n▶ [4] Testing P2-2: Out-of-order ledger compression & bond/option compaction...');
  {
    const db = new MemoryDatabase();
    db.settlementLedger.clear();
    const dummyEntry = (id: string) => ({
      trade_id: id, stock_id: 's1', price: 1, size: 1, total_amount: 1,
      buyer_fee_rate: 0, seller_fee_rate: 0, buyer_fee_amount: 0, seller_fee_amount: 0, settled_at: '2026-01-01T00:00:00.000Z',
    });

    // Repro [8]: opt_tr_e1_2, opt_settle_contract1, opt_tr_e1_3 -> trimSettlementLedger(1)
    db.settlementLedger.set('opt_tr_e1_2', dummyEntry('opt_tr_e1_2'));
    db.settlementLedger.set('opt_settle_contract1', dummyEntry('opt_settle_contract1'));
    db.settlementLedger.set('opt_tr_e1_3', dummyEntry('opt_tr_e1_3'));
    db.trimSettlementLedger(1);

    assert.equal(db.settledOptionEpochWatermarks.get(1) ?? 0, 0, 'Out-of-order opt_tr_e1_2 eviction must NOT raise watermark to 2');
    assert.equal(db.isTradeAlreadySettled('opt_tr_e1_1'), false, 'Missing opt_tr_e1_1 must NOT be reported as settled');
    assert.equal(db.isTradeAlreadySettled('opt_tr_e1_2'), true, 'Evicted opt_tr_e1_2 stays settled via interval');
    assert.equal(db.isTradeAlreadySettled('opt_tr_e1_3'), true, 'Remaining opt_tr_e1_3 stays settled');
    assert.equal(db.isTradeAlreadySettled('opt_settle_contract1'), true, 'opt_settle_contract1 stays settled');
    assert.equal(db.evictedCustomTradeIds.size, 0, 'opt_settle_* must NOT pollute evictedCustomTradeIds');

    // Now insert opt_tr_e1_1 and trim down to 0 -> all evicted, contiguous watermark catches up to 3 and intervals clear!
    db.settlementLedger.set('opt_tr_e1_1', dummyEntry('opt_tr_e1_1'));
    db.trimSettlementLedger(0);
    assert.equal(db.settledOptionEpochWatermarks.get(1), 3, 'Watermark advances contiguously to 3 once #1 arrives and merges with [2,3]');
    assert.equal(db.settledOptionEpochIntervals.has(1), false, 'Merged contiguous intervals clear completely');
    assert.equal(db.isTradeAlreadySettled('opt_tr_e1_3'), true);

    // Compress 60 monthly bond_coupon entries into 1 merged YYYY-MM interval (leaving gap in month 06)
    db.settlementLedger.clear();
    for (let y = 2020; y < 2025; y++) {
      for (let m = 1; m <= 12; m++) {
        if (y === 2022 && m === 6) continue; // intentional missing coupon
        const id = `bond_coupon_bond_kr_2y_user1_period_${y}-${String(m).padStart(2, '0')}`;
        db.settlementLedger.set(id, dummyEntry(id));
      }
    }
    db.trimSettlementLedger(5);
    assert.equal(db.evictedCustomTradeIds.size, 0, 'Bond coupon IDs must not accumulate in evictedCustomTradeIds');
    assert.equal(db.isTradeAlreadySettled('bond_coupon_bond_kr_2y_user1_period_2021-05'), true);
    assert.equal(db.isTradeAlreadySettled('bond_coupon_bond_kr_2y_user1_period_2022-06'), false, 'Skipped month must NOT be treated as settled');
    const intervals = db.settledBondCouponIntervals.get('bond_kr_2y_user1');
    assert.ok(intervals && intervals.length === 2, `Contiguous runs compress into 2 intervals around skipped month (got ${intervals?.length})`);
  }
  console.log('  ✅ [PASS] P2-2 verified.');

  // ── 5. [P2-3 & P2-5.1] Stock/ETF 0.25% Fee Consistency & USD FX Capacity/Settlement ──
  console.log('\n▶ [5] Testing P2-3 & P2-5.1: Stock 0.25% fee parity & USD stock/ETF FX capacity/settlement...');
  {
    const db = new MemoryDatabase();
    const client = createMemoryDbClient(db);
    const krStock = STOCK_UUID_MAP['0010'];
    const seller = seedUser(db, 'stk_seller', 0);
    db.holdings.set(`${seller.id}_${krStock}`, { id: `${seller.id}_${krStock}`, user_id: seller.id, stock_id: krStock, quantity: 100, avg_price: 10000, created_at: db.getIsoTimestamp() });
    db.addHoldingToIndex(db.holdings.get(`${seller.id}_${krStock}`)!);
    const sellOrd = { id: 'stk_s1', stock_id: krStock, user_id: seller.id, side: 'sell' as const, price: 10_000, size: 10, filled: 0, status: 'open' as const, is_lp: false, created_at: db.getIsoTimestamp() };
    db.orders.set(sellOrd.id, sellOrd); db.addOrderToIndex(sellOrd);

    // Exact [4] repro: cash = 100,000, incoming buy 10 @ 10,000 -> must fail pre-validation too (100,250 required)!
    const buyer = seedUser(db, 'stk_fee_buyer', 100_000);
    const capFail = validateOrderCapacity({
      userId: buyer.id, stockId: krStock, side: 'buy', incomingPrice: 10_000, incomingSize: 10,
      currentCash: buyer.cash, currentHoldingQty: 0, openOrders: [],
    });
    assert.equal(capFail.valid, false, 'Pre-validation must include 0.25% taker fee');
    assert.equal(capFail.required, 100_250);

    // Give exact 100,250 -> pre-validation passes AND settlement succeeds to exact 0!
    buyer.cash = 100_250;
    const capOk = validateOrderCapacity({
      userId: buyer.id, stockId: krStock, side: 'buy', incomingPrice: 10_000, incomingSize: 10,
      currentCash: buyer.cash, currentHoldingQty: 0, openOrders: [],
    });
    assert.equal(capOk.valid, true);
    const matchRes = await submitAndMatchOrder(client as any, {
      stock_id: krStock, user_id: buyer.id, side: 'buy', price: 10_000, size: 10,
    });
    assert.equal(matchRes.success, true);
    assert.equal(matchRes.filledQty, 10);
    assert.equal(db.profiles.get(buyer.id)!.cash, 0, 'Buyer cash finishes at 0 after 100,000 notional + 250 taker fee');

    // Open order reserved cash also reflects 0.25% fee
    const reservedCheck = calculateReservedCash([
      { stock_id: krStock, side: 'buy', price: 10_000, size: 10, filled: 0, status: 'open' },
    ]);
    assert.equal(reservedCheck, 100_250, 'Resting stock buy order reserves 1.0025 * price * qty');

    // USD ETF check (TSLL is LEVERAGE category, must still be recognized as USD quoted!)
    const tsll = db.stocks.get(STOCK_UUID_MAP['TSLL'])!;
    assert.equal(isUsdQuotedAsset(tsll), true, 'TSLL must be recognized as USD quoted ETF');
    const aaplId = STOCK_UUID_MAP['AAPL'];
    const usdBuyer = seedUser(db, 'usd_buyer', 300_000); // $185.5 * 1380 * 1.0025 = 256,630 KRW
    const aaplSeller = seedUser(db, 'usd_seller', 0);
    db.holdings.set(`${aaplSeller.id}_${aaplId}`, { id: `${aaplSeller.id}_${aaplId}`, user_id: aaplSeller.id, stock_id: aaplId, quantity: 5, avg_price: 180, created_at: db.getIsoTimestamp() });
    db.addHoldingToIndex(db.holdings.get(`${aaplSeller.id}_${aaplId}`)!);
    const aaplSell = { id: 'aapl_s1', stock_id: aaplId, user_id: aaplSeller.id, side: 'sell' as const, price: 185.5, size: 1, filled: 0, status: 'open' as const, is_lp: false, created_at: db.getIsoTimestamp() };
    db.orders.set(aaplSell.id, aaplSell); db.addOrderToIndex(aaplSell);

    const aaplRes = await submitAndMatchOrder(client as any, {
      stock_id: aaplId, user_id: usdBuyer.id, side: 'buy', price: 185.5, size: 1,
    });
    assert.equal(aaplRes.success, true);
    const expectedUsdKrw = Math.round(185.5 * 1380);
    const expectedUsdFee = Math.round(expectedUsdKrw * 0.0025);
    assert.equal(db.profiles.get(usdBuyer.id)!.cash, 300_000 - (expectedUsdKrw + expectedUsdFee), 'USD stock deducts KRW using server USD FX rate + fee');
    assert.equal(db.holdings.get(`${usdBuyer.id}_${aaplId}`)?.avg_price, 185.5, 'USD holding avg_price stored in quote USD currency');
  }
  console.log('  ✅ [PASS] P2-3 & P2-5.1 verified.');

  // ── 6. [P2-4 & P2-5.5 & P2-6] Batch Cancel Rollback, HttpRpc Error, Commodity Concurrency/Sync/Index ──
  console.log('\n▶ [6] Testing P2-4, P2-5.5 & P2-6: Batch cancel rollback, HTTP error JSON, commodity concurrency/sync, deleteOrders index...');
  {
    const db = new MemoryDatabase();
    const s1 = STOCK_UUID_MAP['0010'];
    const u1 = seedUser(db, 'batch_u1', 1_000_000);
    const u2 = seedUser(db, 'batch_u2', 1_000_000);
    const o1 = { id: 'b_ord_1', stock_id: s1, user_id: u1.id, side: 'buy' as const, price: 70000, size: 1, filled: 0, status: 'open' as const, is_lp: false, created_at: db.getIsoTimestamp() };
    const o2 = { id: 'b_ord_2', stock_id: s1, user_id: u1.id, side: 'buy' as const, price: 70000, size: 1, filled: 0, status: 'open' as const, is_lp: false, created_at: db.getIsoTimestamp() };

    // LocalMarketService uses singleton memoryDb
    const { memoryDb: singletonDb } = await import('../lib/memoryDb/memoryStore');
    singletonDb.profiles.set(u1.id, u1); singletonDb.profileUserIdIndex.set(u1.id, u1.id);
    singletonDb.profiles.set(u2.id, u2); singletonDb.profileUserIdIndex.set(u2.id, u2.id);
    singletonDb.orders.set(o1.id, { ...o1 }); singletonDb.addOrderToIndex(singletonDb.orders.get(o1.id)!);
    singletonDb.orders.set(o2.id, { ...o2 }); singletonDb.addOrderToIndex(singletonDb.orders.get(o2.id)!);

    const failBatch = await LocalMarketService.cancelOrdersBatch({
      orderIds: [o1.id, o2.id],
      userId: u1.id,
      onPersist: async () => false,
    });
    assert.equal(failBatch.success, false);
    assert.equal(failBatch.statusCode, 500);
    assert.equal(singletonDb.orders.get(o1.id)?.status, 'open', 'Batch cancel persistence fail rolls back ALL orders');
    assert.equal(singletonDb.orders.get(o2.id)?.status, 'open');

    // InMemoryMarketRepository.deleteOrders index cleanup (P2-6.3)
    const repoBundle = createInMemoryRepositoryBundle(db);
    db.orders.set(o1.id, o1); db.addOrderToIndex(o1);
    await repoBundle.markets.deleteOrders([o1.id]);
    assert.equal(db.orders.has(o1.id), false);
    assert.equal(db.orderStockIndex.get(s1)?.has(o1.id) ?? false, false, 'deleteOrders cleans orderStockIndex');
    assert.equal(db.orderUserIndex.get(u1.id)?.has(o1.id) ?? false, false, 'deleteOrders cleans orderUserIndex');

    // P2-6.1 & P2-6.2: CommodityMarketEngine concurrent reconcile + failure retry + stepTickAsync DB price sync & rollback
    const dbComm = new MemoryDatabase();
    const cu = seedUser(dbComm, 'comm_reconcile_u', 1_000_000);
    const oilMargin = calculateCommodityMarginPerContractKrw(new CommodityMarketEngine({ totalBots: 0 }).getCommodity('CRUDE_OIL')!, dbComm);
    cu.cash = 0; // remaining after reserve
    dbComm.commodityOpenOrders.set('c_orphan_unknown', {
      id: 'c_orphan_unknown', commodityId: 'UNKNOWN_COMM', userId: cu.id, side: 'buy', type: 'limit', price: 10, size: 1, filled: 0, createdAtTick: 1, createdAtTime: 1,
    });
    dbComm.commodityMarginReservations.set('c_orphan_unknown', {
      order_id: 'c_orphan_unknown', user_id: cu.id, commodity_id: 'UNKNOWN_COMM', side: 'buy', margin_per_contract_krw: oilMargin, total_size: 1, remaining_size: 1, reserved_krw: 500_000, status: 'open', created_at: dbComm.getIsoTimestamp(),
    });
    dbComm.commodityOpenOrders.set('c_valid_oil', {
      id: 'c_valid_oil', commodityId: 'CRUDE_OIL', userId: cu.id, side: 'buy', type: 'limit', price: 65, size: 1, filled: 0, createdAtTick: 2, createdAtTime: 2,
    });
    dbComm.commodityMarginReservations.set('c_valid_oil', {
      order_id: 'c_valid_oil', user_id: cu.id, commodity_id: 'CRUDE_OIL', side: 'buy', margin_per_contract_krw: oilMargin, total_size: 1, remaining_size: 1, reserved_krw: oilMargin, status: 'open', created_at: dbComm.getIsoTimestamp(),
    });

    const commEng = new CommodityMarketEngine({ totalBots: 0 });
    await Promise.all([
      commEng.reconcileWithDatabase(dbComm),
      commEng.reconcileWithDatabase(dbComm),
    ]);
    assert.equal(commEng.getOrderBook('CRUDE_OIL')!.bids.some((b) => b.id === 'c_valid_oil'), true, 'Concurrent callers both wait for complete reconcile');
    assert.equal(cu.cash, 500_000, 'Unknown commodity orphan margin refunded');

    // stepTickAsync DB price sync + rollback on persist failure
    let persistShouldFail = true;
    const commEngPersist = new CommodityMarketEngine({
      totalBots: 5,
      db: dbComm,
      onPersist: async () => !persistShouldFail,
    });
    const oilPriceBefore = dbComm.commodities.get('CRUDE_OIL')!.current_price;
    await assert.rejects(() => commEngPersist.stepTickAsync());
    assert.equal(commEngPersist.currentTick, 0, 'stepTickAsync rolls back currentTick on onPersist=false');
    assert.equal(dbComm.commodities.get('CRUDE_OIL')!.current_price, oilPriceBefore, 'stepTickAsync rolls back db.commodities price on persist failure');

    persistShouldFail = false;
    await commEngPersist.stepTickAsync();
    assert.equal(commEngPersist.currentTick, 1);
    assert.equal(
      dbComm.commodities.get('CRUDE_OIL')!.current_price,
      commEngPersist.getCommodity('CRUDE_OIL')!.currentPrice,
      'stepTickAsync syncs commodity engine price into db.commodities'
    );

    // cancelCommodityOrders persistence rollback
    const richCommU = seedUser(dbComm, 'comm_cancel_u', 20_000_000);
    const oilDef = commEngPersist.getCommodity('CRUDE_OIL')!;
    const cSub = await reserveMarginAndSubmitCommodityOrder({
      db: dbComm,
      commodity: oilDef,
      userId: richCommU.id,
      side: 'buy',
      type: 'limit',
      price: 10,
      size: 1,
      submitToEngine: () => commEngPersist.submitUserOrder({ commodityId: 'CRUDE_OIL', userId: richCommU.id, side: 'buy', type: 'limit', price: 10, size: 1 }),
      rollbackFromEngine: (oid) => commEngPersist.removeUserOrder('CRUDE_OIL', oid),
    });
    assert.equal(cSub.success, true);
    const cashAfterSub = richCommU.cash;
    const cancelFail = await cancelCommodityOrders({
      db: dbComm,
      userId: richCommU.id,
      orderIds: [cSub.order!.id],
      removeFromBook: (cid, oid) => commEngPersist.removeUserOrder(cid, oid),
      restoreToBook: (cid, ord) => commEngPersist.restoreUserOrder(cid, ord),
      onPersist: async () => false,
    });
    assert.equal(cancelFail.success, false);
    assert.equal(richCommU.cash, cashAfterSub, 'Commodity cancel persist failure must NOT refund cash');
    assert.equal(commEngPersist.getOrderBook('CRUDE_OIL')!.bids.some((b) => b.id === cSub.order!.id), true, 'Commodity cancel persist failure must restore book order');

    // HttpMemoryClient.rpc JSON error message preservation (P2-5.5)
    const origFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () =>
        new Response(JSON.stringify({ data: null, error: { message: '보유 원화 잔액이 부족합니다.' } }), {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'Content-Type': 'application/json' },
        })) as any;
      const httpCli = new HttpMemoryClient();
      const rpcRes = await httpCli.rpc('exchange_currency', {});
      assert.equal(rpcRes.error?.message, '보유 원화 잔액이 부족합니다.', 'HttpMemoryClient.rpc preserves specific server error JSON message');
    } finally {
      globalThis.fetch = origFetch;
    }

    // PersistenceManager snapshot round-trip preserves compacted ledgers
    const tmpSnapDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-p22-snap-'));
    try {
      const pm = new PersistenceManager(new FileStorageAdapter(tmpSnapDir));
      const snapDb = new MemoryDatabase();
      snapDb.settlementLedger.set('opt_tr_e1_2', {
        trade_id: 'opt_tr_e1_2', stock_id: 'o1', price: 1, size: 1, total_amount: 1,
        buyer_fee_rate: 0, seller_fee_rate: 0, buyer_fee_amount: 0, seller_fee_amount: 0, settled_at: '2026-01-01T00:00:00Z',
      });
      snapDb.settlementLedger.set('bond_coupon_b1_u1_period_2026-01', {
        trade_id: 'bond_coupon_b1_u1_period_2026-01', stock_id: 'b1', price: 1, size: 1, total_amount: 1,
        buyer_fee_rate: 0, seller_fee_rate: 0, buyer_fee_amount: 0, seller_fee_amount: 0, settled_at: '2026-01-01T00:00:00Z',
      });
      snapDb.trimSettlementLedger(0);
      assert.equal(await pm.saveSnapshot(snapDb), true);
      pm.releaseWriterLock();

      const reloaded = new MemoryDatabase();
      const pm2 = new PersistenceManager(new FileStorageAdapter(tmpSnapDir));
      assert.equal(await pm2.loadSnapshot(reloaded), true);
      pm2.releaseWriterLock();
      assert.equal(reloaded.isTradeAlreadySettled('opt_tr_e1_1'), false, 'Gap preserved across snapshot reload');
      assert.equal(reloaded.isTradeAlreadySettled('opt_tr_e1_2'), true, 'Out-of-order interval preserved across snapshot reload');
      assert.equal(reloaded.isTradeAlreadySettled('bond_coupon_b1_u1_period_2026-01'), true, 'Bond coupon interval preserved across snapshot reload');
    } finally {
      fs.rmSync(tmpSnapDir, { recursive: true, force: true });
    }
  }
  console.log('  ✅ [PASS] P2-4, P2-5.5 & P2-6 verified.');

  console.log('\n🎉 ALL POST-FIX REMEDIATION REGRESSION TESTS PASSED!');
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
