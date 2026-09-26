/**
 * Phase 4 Test: P1 - Atomic LP Quote Refresh & Elimination of Fake Rollback
 *
 * Verifies that:
 * 1. refreshLpQuotesAtomically handles quotes, stale expiration, and generation CAS as one atomic UoW
 * 2. Partial writes across chunk boundaries (>500 quotes) roll back 100% if later chunk fails
 * 3. Mid-refresh failures (stale cancellation, generation change) roll back cleanly
 * 4. Byte-identical database fingerprint before and after failed refresh
 * 5. General non-LP orders in the book are completely unaffected
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import { MemoryDatabase, OrderRecord, StockRecord } from '../lib/memoryDb/memoryStore';
import { createInMemoryRepositoryBundle } from '../lib/repositories/inMemory';

const NOW = Date.parse('2026-06-30T10:00:00.000Z');
const STOCK_ID = 'stock_samsung';
const LP_ID = 'bot_as_mm_001';

function computeDatabaseFingerprint(db: MemoryDatabase): string {
  const hash = crypto.createHash('sha256');
  const orders = Array.from(db.orders.entries()).sort(([a], [b]) => a.localeCompare(b));
  const orderIndex = Array.from(db.orderStockIndex.entries()).map(([k, set]) => [k, Array.from(set).sort()]);
  hash.update(JSON.stringify({ orders, orderIndex, lpGen: (db as any).lpQuoteGeneration }));
  return hash.digest('hex');
}

function setupDb(): { db: MemoryDatabase; bundle: ReturnType<typeof createInMemoryRepositoryBundle> } {
  const db = new MemoryDatabase();

  const stock: StockRecord = {
    id: STOCK_ID,
    ticker: '005930',
    name: 'Samsung Electronics',
    current_price: 70000,
    previous_close: 70000,
    open_price: 70000,
    high: 70000,
    low: 70000,
    volume: 10000,
    change_rate: 0,
    market_cap: 70000 * 1000000,
    pe_ratio: 15,
    dividend_yield: 0.02,
    sector: 'IT',
    market: 'domestic',
    shares_outstanding: 1000000,
    floating_shares: 800000,
  };
  db.stocks.set(STOCK_ID, stock);
  db.addStockToIndex(stock);

  // Pre-seed an ordinary resting retail order
  const retailOrder: OrderRecord = {
    id: 'ord_retail_resting_1',
    stock_id: STOCK_ID,
    user_id: 'user_retail_1',
    side: 'buy',
    price: 69000,
    size: 20,
    filled: 0,
    originalQuantity: 20,
    filledQuantity: 0,
    remainingQuantity: 20,
    status: 'open',
    is_lp: false,
    version: 1,
    created_at: new Date(NOW).toISOString(),
  };
  db.orders.set(retailOrder.id, retailOrder);
  db.addOrderToIndex(retailOrder);

  // Pre-seed initial LP quotes (Generation 1)
  for (let slot = 0; slot < 5; slot++) {
    const buyId = `lp_${STOCK_ID}_buy_slot${slot}`;
    const sellId = `lp_${STOCK_ID}_sell_slot${slot}`;
    const buyOrd: OrderRecord = {
      id: buyId,
      stock_id: STOCK_ID,
      user_id: LP_ID,
      participantId: LP_ID,
      participantKind: 'LIQUIDITY_PROVIDER',
      side: 'buy',
      price: 69900 - slot * 100,
      size: 10,
      filled: 0,
      status: 'open',
      is_lp: true,
      version: 1,
      created_at: new Date(NOW).toISOString(),
    };
    const sellOrd: OrderRecord = {
      id: sellId,
      stock_id: STOCK_ID,
      user_id: LP_ID,
      participantId: LP_ID,
      participantKind: 'LIQUIDITY_PROVIDER',
      side: 'sell',
      price: 70100 + slot * 100,
      size: 10,
      filled: 0,
      status: 'open',
      is_lp: true,
      version: 1,
      created_at: new Date(NOW).toISOString(),
    };
    db.orders.set(buyId, buyOrd);
    db.orders.set(sellId, sellOrd);
    db.addOrderToIndex(buyOrd);
    db.addOrderToIndex(sellOrd);
  }
  (db as any).lpQuoteGeneration = 1;

  const bundle = createInMemoryRepositoryBundle(db);
  return { db, bundle };
}

async function run() {
  console.log('--- Testing P1 Atomic LP Quote Refresh ---');

  // Test 1: Method exists and can perform atomic refresh
  {
    const { db, bundle } = setupDb();
    assert.strictEqual(typeof (bundle.settlement as any).refreshLpQuotesAtomically, 'function', 'refreshLpQuotesAtomically must exist on settlement repository');

    const nextQuotes: OrderRecord[] = [
      {
        id: `lp_${STOCK_ID}_buy_slot0`,
        stock_id: STOCK_ID,
        user_id: LP_ID,
        participantId: LP_ID,
        participantKind: 'LIQUIDITY_PROVIDER',
        side: 'buy',
        price: 69950,
        size: 15,
        filled: 0,
        status: 'open',
        is_lp: true,
        version: 2,
        created_at: new Date(NOW).toISOString(),
      },
    ];

    const res = await (bundle.settlement as any).refreshLpQuotesAtomically({
      quotes: nextQuotes,
      expectedGeneration: 1,
      nextGeneration: 2,
      staleSlotIdsToCancel: [`lp_${STOCK_ID}_buy_slot4`],
    });

    assert.strictEqual(res.success, true);
    assert.strictEqual(db.orders.get(`lp_${STOCK_ID}_buy_slot0`)?.price, 69950);
    assert.strictEqual(db.orders.get(`lp_${STOCK_ID}_buy_slot4`)?.status, 'cancelled');
    assert.strictEqual((db as any).lpQuoteGeneration, 2);
    console.log('✅ [PASS] Normal atomic LP quote refresh succeeded');
  }

  // Test 2: Chunk failure rollback (> 500 quotes)
  {
    const { db, bundle } = setupDb();
    const fpBefore = computeDatabaseFingerprint(db);

    // Create 600 quotes (spans multiple chunks)
    const largeQuotes: OrderRecord[] = [];
    for (let i = 0; i < 600; i++) {
      largeQuotes.push({
        id: `lp_${STOCK_ID}_test_slot_${i}`,
        stock_id: STOCK_ID,
        user_id: LP_ID,
        participantId: LP_ID,
        participantKind: 'LIQUIDITY_PROVIDER',
        side: i % 2 === 0 ? 'buy' : 'sell',
        price: 70000 + (i % 2 === 0 ? -1 : 1) * (i + 1),
        size: 5,
        filled: 0,
        status: 'open',
        is_lp: true,
        version: 2,
        created_at: new Date(NOW).toISOString(),
      });
    }

    // Inject failure on second chunk
    const res = await (bundle.settlement as any).refreshLpQuotesAtomically({
      quotes: largeQuotes,
      expectedGeneration: 1,
      nextGeneration: 2,
      faultInjection: 'FAIL_AFTER_FIRST_CHUNK',
    });

    assert.strictEqual(res.success, false, 'Refresh must fail when fault is injected on second chunk');
    assert.strictEqual(computeDatabaseFingerprint(db), fpBefore, 'Database state must be byte-identical after chunk failure');
    assert.strictEqual(db.orders.has(`lp_${STOCK_ID}_test_slot_0`), false, 'No leaked quotes from first chunk');
    assert.strictEqual(db.orders.get('ord_retail_resting_1')?.status, 'open', 'Retail order remains intact');
    console.log('✅ [PASS] 600-quote chunk failure rolled back 100% with byte-identical fingerprint');
  }

  // Test 3: Failure during stale slot cancellation
  {
    const { db, bundle } = setupDb();
    const fpBefore = computeDatabaseFingerprint(db);

    const res = await (bundle.settlement as any).refreshLpQuotesAtomically({
      quotes: [{
        id: `lp_${STOCK_ID}_buy_slot0`,
        stock_id: STOCK_ID,
        user_id: LP_ID,
        participantId: LP_ID,
        participantKind: 'LIQUIDITY_PROVIDER',
        side: 'buy',
        price: 69980,
        size: 20,
        status: 'open',
        is_lp: true,
        version: 2,
        created_at: new Date(NOW).toISOString(),
      }],
      expectedGeneration: 1,
      nextGeneration: 2,
      staleSlotIdsToCancel: [`lp_${STOCK_ID}_buy_slot1`],
      faultInjection: 'FAIL_DURING_STALE_CANCEL',
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(computeDatabaseFingerprint(db), fpBefore, 'State unchanged when stale cancel fails');
    console.log('✅ [PASS] Failure during stale cancel rolled back cleanly');
  }

  // Test 4: Generation CAS mismatch rejected with 0 mutation
  {
    const { db, bundle } = setupDb();
    const fpBefore = computeDatabaseFingerprint(db);

    const res = await (bundle.settlement as any).refreshLpQuotesAtomically({
      quotes: [],
      expectedGeneration: 999, // Stale generation
      nextGeneration: 1000,
    });

    assert.strictEqual(res.success, false);
    assert.strictEqual(res.errorCode, 'CAS_GENERATION_MISMATCH');
    assert.strictEqual(computeDatabaseFingerprint(db), fpBefore, 'State unchanged on CAS generation mismatch');
    console.log('✅ [PASS] Generation CAS mismatch rejected with 0 mutation');
  }

  console.log('\n🎉 ALL ATOMIC LP QUOTE REFRESH TESTS PASSED!\n');
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
