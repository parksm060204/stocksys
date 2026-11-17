import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import { MemoryDatabase, GUEST_USER_ID } from '../lib/memoryDb/memoryStore';
import { FileStorageAdapter } from '../lib/memoryDb/StorageAdapter';
import { PersistenceManager } from '../lib/memoryDb/PersistenceManager';
import { createInMemoryRepositoryBundle } from '../lib/repositories/inMemory';
import { CommodityOrderBook } from '../lib/commodities/CommodityOrderBook';
import { CommodityMarketEngine } from '../lib/commodities/CommodityMarketEngine';
import {
  reserveMarginAndSubmitCommodityOrder,
  settleCommodityTradeForUsers,
  releaseCommodityOrderMargin,
  calculateCommodityMarginPerContractKrw,
} from '../lib/commodities/commodityLedger';
import { executeCurrencyExchange } from '../lib/exchange/exchangeService';
import {
  MEDIA_OUTLETS,
  SHOP_PRODUCTS,
  pruneExpiredProfileEntitlements,
} from '../lib/shop/catalog';
import { createMemoryDbClient } from '../lib/memoryDb/memoryDbClient';
import { isDevGuestAuthEnabled } from '../lib/engine/localDevMode';

async function test1_CommodityInputAndLoopDefense() {
  console.log('▶ [1] Testing Commodity Order Input Validation & NaN Loop Defense...');

  // 1a. Isolated child process with 5s timeout to prove NaN/non-numeric size cannot hang event loop
  const childScript = `
    import { CommodityOrderBook } from './lib/commodities/CommodityOrderBook';
    const book = new CommodityOrderBook('CRUDE_OIL');
    const addedBad = book.addOrder({
      id: 'bad_1', commodityId: 'CRUDE_OIL', userId: 'u1',
      side: 'buy', type: 'limit', price: 80, size: 'abc', filled: 0,
      createdAtTick: 1, createdAtTime: 1000
    });
    if (addedBad) throw new Error('Non-numeric size should be rejected by addOrder');
    // Force-inject corrupted order directly into bids to test matchOrders defense
    book.bids.push({
      id: 'corrupt_1', commodityId: 'CRUDE_OIL', userId: 'u1',
      side: 'buy', type: 'limit', price: 80, size: Number.NaN, filled: 0,
      createdAtTick: 1, createdAtTime: 1000
    });
    book.addOrder({
      id: 'good_ask', commodityId: 'CRUDE_OIL', userId: 'u2',
      side: 'sell', type: 'limit', price: 79, size: 1, filled: 0,
      createdAtTick: 1, createdAtTime: 1000
    });
    const res = book.matchOrders(80, 2);
    if (res.matchedTradesCount !== 0 || book.bids.length !== 0) {
      throw new Error('Corrupted bid was not safely evicted');
    }
    console.log('CHILD_LOOP_DEFENSE_OK');
  `;

  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', childScript],
    { cwd: process.cwd(), timeout: 5000, encoding: 'utf-8' }
  );
  assert.equal(child.status, 0, `Child process failed or timed out: ${child.stderr || child.stdout}`);
  assert.ok(child.stdout.includes('CHILD_LOOP_DEFENSE_OK'), 'Expected child loop defense marker');

  // 1b. CommodityMarketEngine.submitUserOrder validation
  const engine = new CommodityMarketEngine({ totalBots: 2 });
  assert.throws(() => engine.submitUserOrder({
    commodityId: 'NON_EXISTENT',
    userId: 'u1',
    side: 'buy',
    type: 'limit',
    price: 80,
    size: 1,
  }), /존재하지 않는 원자재/);

  assert.throws(() => engine.submitUserOrder({
    commodityId: 'CRUDE_OIL',
    userId: 'u1',
    side: 'buy',
    type: 'limit',
    price: -10,
    size: 1,
  }), /가격/);

  assert.throws(() => engine.submitUserOrder({
    commodityId: 'CRUDE_OIL',
    userId: 'u1',
    side: 'buy',
    type: 'limit',
    price: 80,
    size: 1.5,
  }), /수량/);

  const validMarket = engine.submitUserOrder({
    commodityId: 'CRUDE_OIL',
    userId: 'u1',
    side: 'buy',
    type: 'market',
    price: 0,
    size: 2,
  });
  assert.ok(validMarket.id.startsWith('usr_'));
  assert.ok(validMarket.price > 0);
  console.log('  ✅ [PASS] Commodity validation & NaN loop defense verified.');
}

async function test4_7_9_PersistenceAndSnapshotCompleteness() {
  console.log('▶ [4,7,9] Testing Persistence, Atomic Replace, Snapshot v2 Completeness & Ledger Bounds...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-persist-'));
  try {
    const adapter = new FileStorageAdapter(tmpDir);
    const pm = new PersistenceManager(adapter);
    const db1 = new MemoryDatabase();

    // Mutate authoritative states: profile, settlementLedger, lpLiabilities, optionSettlements, bondCouponPayments
    const guest = db1.profiles.get(GUEST_USER_ID)!;
    guest.cash = 12345678;
    guest.usd_balance = 999.5;
    db1.settlementLedger.set('tr_settled_1', {
      trade_id: 'tr_settled_1',
      stock_id: 'stk_1',
      price: 1000,
      size: 1,
      total_amount: 1000,
      buyer_fee_rate: 0.0025,
      seller_fee_rate: 0.0025,
      buyer_fee_amount: 3,
      seller_fee_amount: 3,
      settled_at: new Date().toISOString(),
    });
    db1.lpLiabilities.set('lp_mm:stk_1', 42);
    db1.optionSettlements.push({ id: 'opt_set_1', user_id: GUEST_USER_ID, payout_amount: 50000 });
    db1.bondCouponPayments.push({ id: 'bond_cp_1', user_id: GUEST_USER_ID, coupon_amount: 10000 });

    // Concurrent save serialization test (single-writer queue must not drop or corrupt)
    const [s1, s2, s3] = await Promise.all([
      pm.saveSnapshot(db1),
      pm.saveSnapshot(db1),
      pm.saveSnapshot(db1),
    ]);
    assert.equal(s1 && s2 && s3, true, 'All serialized saves should succeed');

    // Restore into a fresh MemoryDatabase instance
    const db2 = new MemoryDatabase();
    const restored = await pm.loadSnapshot(db2);
    assert.equal(restored, true);
    assert.equal(db2.profiles.get(GUEST_USER_ID)?.cash, 12345678);
    assert.equal(db2.profiles.get(GUEST_USER_ID)?.usd_balance, 999.5);
    assert.equal(db2.settlementLedger.has('tr_settled_1'), true);
    assert.equal(db2.lpLiabilities.get('lp_mm:stk_1'), 42);
    assert.equal(db2.optionSettlements.length, 1);
    assert.equal(db2.bondCouponPayments.length, 1);

    // Verify settlement idempotency survives snapshot restore
    const repo2 = createInMemoryRepositoryBundle(db2);
    assert.equal(repo2.settlement.isTradeSettled('tr_settled_1'), true);

    // Verify corrupted snapshot throws rather than silently resetting
    fs.writeFileSync(path.join(tmpDir, 'snapshot.json'), '{CORRUPTED_JSON', 'utf-8');
    const db3 = new MemoryDatabase();
    await assert.rejects(() => pm.loadSnapshot(db3));

    // Verify legacy v1 snapshot with trades but no settlementLedger is rejected
    const v1Unsafe = JSON.stringify({
      profiles: Array.from(db1.profiles.entries()),
      stocks: Array.from(db1.stocks.entries()),
      orders: Array.from(db1.orders.entries()),
      trades: [{ id: 'tr_1' }],
    });
    fs.writeFileSync(path.join(tmpDir, 'snapshot.json'), v1Unsafe, 'utf-8');
    await assert.rejects(() => pm.loadSnapshot(new MemoryDatabase()), /settlementLedger/);

    // Verify CommodityOrderBook has no unbounded tradeHistory & settlementLedger watermark pruning
    const book = new CommodityOrderBook('GOLD');
    assert.equal((book as any).tradeHistory, undefined, 'Unused unbounded tradeHistory must be removed');

    const dbTrim = new MemoryDatabase();
    for (let i = 0; i < 15; i++) {
      dbTrim.settlementLedger.set(`tr_w_${i}`, {
        trade_id: `tr_w_${i}`,
        stock_id: 's1',
        price: 1000,
        size: 1,
        total_amount: 1000,
        buyer_fee_rate: 0.0025,
        seller_fee_rate: 0.0025,
        buyer_fee_amount: 3,
        seller_fee_amount: 3,
        settled_at: new Date(1700000000000 + i * 1000).toISOString(),
      });
    }
    const removed = dbTrim.trimSettlementLedger(10);
    assert.equal(removed, 5);
    assert.equal(dbTrim.settlementLedger.size, 10);
    assert.equal(
      dbTrim.isTradeAlreadySettled('tr_w_0'),
      true,
      'Pruned old trade must still be blocked by archive'
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log('  ✅ [PASS] Persistence, snapshot completeness, corruption guard, and ledger bounds verified.');
}

async function test5_CommodityMarginAndSettlement() {
  console.log('▶ [5] Testing Commodity Margin Reservation, Partial Fill, Expiry Refund & Concurrency...');
  const db = new MemoryDatabase();
  const engine = new CommodityMarketEngine({ totalBots: 0, db });
  const commodity = engine.getCommodity('CRUDE_OIL')!;
  const profile = db.profiles.get(GUEST_USER_ID)!;
  const initialCash = 50_000_000;
  profile.cash = initialCash;

  const marginPerContract = calculateCommodityMarginPerContractKrw(commodity, db);

  // Concurrent overspend test: two orders each needing > 50% of cash
  const bigContracts = Math.floor(initialCash / marginPerContract);
  const [r1, r2] = await Promise.all([
    reserveMarginAndSubmitCommodityOrder({
      db,
      commodity,
      userId: GUEST_USER_ID,
      side: 'buy',
      type: 'limit',
      price: 80,
      size: bigContracts,
      submitToEngine: () =>
        engine.submitUserOrder({ commodityId: 'CRUDE_OIL', userId: GUEST_USER_ID, side: 'buy', type: 'limit', price: 80, size: bigContracts }),
      rollbackFromEngine: (id) => engine.removeUserOrder('CRUDE_OIL', id),
    }),
    reserveMarginAndSubmitCommodityOrder({
      db,
      commodity,
      userId: GUEST_USER_ID,
      side: 'buy',
      type: 'limit',
      price: 80,
      size: bigContracts,
      submitToEngine: () =>
        engine.submitUserOrder({ commodityId: 'CRUDE_OIL', userId: GUEST_USER_ID, side: 'buy', type: 'limit', price: 80, size: bigContracts }),
      rollbackFromEngine: (id) => engine.removeUserOrder('CRUDE_OIL', id),
    }),
  ]);
  assert.equal([r1.success, r2.success].filter(Boolean).length, 1, 'Only one concurrent order should succeed');

  // Refund & reset for fill/expiry test
  const successOrder = r1.success ? r1.order! : r2.order!;
  engine.removeUserOrder('CRUDE_OIL', successOrder.id);
  await releaseCommodityOrderMargin(db, successOrder.id, 'cancelled');
  assert.equal(profile.cash, initialCash, 'Cancelled order must refund full margin');

  // Place 2-contract buy order, partial fill 1 contract, then expire remaining 1 contract
  const buyRes = await reserveMarginAndSubmitCommodityOrder({
    db,
    commodity,
    userId: GUEST_USER_ID,
    side: 'buy',
    type: 'limit',
    price: 80,
    size: 2,
    submitToEngine: () =>
      engine.submitUserOrder({ commodityId: 'CRUDE_OIL', userId: GUEST_USER_ID, side: 'buy', type: 'limit', price: 80, size: 2 }),
    rollbackFromEngine: (id) => engine.removeUserOrder('CRUDE_OIL', id),
  });
  assert.equal(buyRes.success, true);
  assert.equal(profile.cash, initialCash - marginPerContract * 2);

  await settleCommodityTradeForUsers(
    db,
    {
      id: 'cm_trade_1',
      commodityId: 'CRUDE_OIL',
      buyOrderId: buyRes.order!.id,
      sellOrderId: 'bot_sell_1',
      buyerId: GUEST_USER_ID,
      sellerId: 'bot_1',
      price: 80,
      size: 1,
      tick: 1,
      timestamp: Date.now(),
    },
    commodity
  );

  // Idempotent replay must not double-apply
  await settleCommodityTradeForUsers(
    db,
    {
      id: 'cm_trade_1',
      commodityId: 'CRUDE_OIL',
      buyOrderId: buyRes.order!.id,
      sellOrderId: 'bot_sell_1',
      buyerId: GUEST_USER_ID,
      sellerId: 'bot_1',
      price: 80,
      size: 1,
      tick: 1,
      timestamp: Date.now(),
    },
    commodity
  );

  const pos = db.commodityPositions.get(`${GUEST_USER_ID}_CRUDE_OIL`);
  assert.equal(pos?.quantity, 1);
  assert.equal(pos?.side, 'long');
  assert.equal(pos?.reserved_margin_krw, marginPerContract);

  // Expire remaining 1 contract
  await releaseCommodityOrderMargin(db, buyRes.order!.id, 'expired');
  assert.equal(profile.cash, initialCash - marginPerContract, 'Unfilled 1 contract margin must be refunded');
  console.log('  ✅ [PASS] Commodity margin reservation, concurrency lock, partial fill, and refund verified.');
}

async function test7_8_11_ShopExchangeGuestPolicy() {
  console.log('▶ [7,8,11] Testing Shop Catalog/Expiry, Currency Exchange & Guest Policy...');
  const db = new MemoryDatabase();
  const profile = db.profiles.get(GUEST_USER_ID)!;
  profile.cash = 10_000_000;
  profile.usd_balance = 0;

  // Media outlets catalog exists
  assert.ok(MEDIA_OUTLETS.length >= 4);
  assert.ok(SHOP_PRODUCTS.fee_booster.durationDays === 30);

  // 30-day expiry pruning
  profile.unlocked_features = ['custom_dashboard', 'fee_booster'];
  profile.feature_expiries = {
    fee_booster: new Date(Date.now() - 1000).toISOString(), // expired
  };
  profile.news_subscriptions = {
    '1': new Date(Date.now() - 1000).toISOString(), // expired
    '2': new Date(Date.now() + 86400_000).toISOString(), // active
  };
  const pruned = pruneExpiredProfileEntitlements(profile);
  assert.deepEqual(pruned.unlocked_features, ['custom_dashboard']);
  assert.deepEqual(Object.keys(pruned.news_subscriptions), ['2']);

  // Currency exchange atomic & failure no-mutation
  const exOk = await executeCurrencyExchange({
    db,
    userId: GUEST_USER_ID,
    fromCur: 'KRW',
    toCur: 'USD',
    amount: 1380000,
  });
  assert.equal(exOk.success, true);
  assert.equal(exOk.data?.to_amount, 1000);
  assert.equal(profile.cash, 10_000_000 - 1380000);
  assert.equal(profile.usd_balance, 1000);

  const exFail = await executeCurrencyExchange({
    db,
    userId: GUEST_USER_ID,
    fromCur: 'KRW',
    toCur: 'USD',
    amount: 999_999_999,
  });
  assert.equal(exFail.success, false);
  assert.equal(profile.cash, 10_000_000 - 1380000, 'Failed exchange must not mutate balance');

  // Unknown RPC must return explicit error
  const client = createMemoryDbClient(db);
  const unknownRpc = await client.rpc('non_existent_rpc_fn', {});
  assert.ok(unknownRpc.error, 'Unknown RPC must return explicit error');

  // Production guest policy check
  const prevEnv = process.env.NODE_ENV;
  (process.env as any).NODE_ENV = 'production';
  assert.equal(isDevGuestAuthEnabled(), false, 'Guest auth must be disabled in production');
  (process.env as any).NODE_ENV = prevEnv;

  console.log('  ✅ [PASS] Shop expiry, currency exchange, unknown RPC error, and prod guest policy verified.');
}

async function main() {
  await test1_CommodityInputAndLoopDefense();
  await test4_7_9_PersistenceAndSnapshotCompleteness();
  await test5_CommodityMarginAndSettlement();
  await test7_8_11_ShopExchangeGuestPolicy();
  console.log('\n🎉 ALL CODE REVIEW FIX VERIFICATION TESTS PASSED');
}

main().catch((err) => {
  console.error('❌ Verification test failed:', err);
  process.exit(1);
});
