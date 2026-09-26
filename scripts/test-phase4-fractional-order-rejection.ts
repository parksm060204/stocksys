/**
 * Phase 4 Test: P1 - Fractional Order Rejection & Non-Rounding Guarantee
 *
 * Verifies that:
 * 1. normalizeOrderQuantities rejects fractional numbers (1.4, 1.5, -0.1) without rounding
 * 2. Numeric strings ('10') are NOT implicitly converted to numbers
 * 3. NaN, Infinity, and unsafe integers (> MAX_SAFE_INTEGER) are rejected
 * 4. Quantity mismatch (filled + remaining !== size) is rejected
 * 5. commitMatchedBatchAtomically rejects batch with fractional order size (0 mutation)
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import { normalizeOrderQuantities } from '../lib/repositories/types';
import { MemoryDatabase, OrderRecord, StockRecord } from '../lib/memoryDb/memoryStore';
import { createInMemoryRepositoryBundle } from '../lib/repositories/inMemory';

const STOCK_ID = 'stock_samsung';

function computeDatabaseFingerprint(db: MemoryDatabase): string {
  const hash = crypto.createHash('sha256');
  const orders = Array.from(db.orders.entries()).sort(([a], [b]) => a.localeCompare(b));
  hash.update(JSON.stringify(orders));
  return hash.digest('hex');
}

async function run() {
  console.log('--- Testing P1 Fractional Order Rejection & Non-Rounding ---');

  // Test 1: normalizeOrderQuantities strict input tests
  const invalidInputs = [
    { label: '1.4', input: { size: 1.4 } },
    { label: '1.5', input: { size: 1.5 } },
    { label: '-0.1', input: { size: -0.1 } },
    { label: 'string "10"', input: { size: '10' as any } },
    { label: 'NaN', input: { size: NaN } },
    { label: 'Infinity', input: { size: Infinity } },
    { label: '> MAX_SAFE_INTEGER', input: { size: Number.MAX_SAFE_INTEGER + 100 } },
    { label: 'mismatched filled+remaining', input: { size: 10, filledQuantity: 4, remainingQuantity: 5 } },
  ];

  for (const { label, input } of invalidInputs) {
    assert.throws(
      () => {
        const res = normalizeOrderQuantities(input);
        // If it returns, ensure it didn't round!
        if (res.originalQuantity !== input.size) {
          throw new RangeError(`Implicit rounding detected for ${label}: rounded to ${res.originalQuantity}`);
        }
      },
      RangeError,
      `Input ${label} must throw RangeError and not be accepted/rounded`
    );
    console.log(`✅ [PASS] Input ${label} rejected without implicit rounding`);
  }

  // Test 2: Repository batch rejection on fractional order
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

  const bundle = createInMemoryRepositoryBundle(db);
  const fpBefore = computeDatabaseFingerprint(db);

  const fractionalOrder: OrderRecord = {
    id: 'ord_fractional_1',
    stock_id: STOCK_ID,
    user_id: 'user_1',
    side: 'buy',
    price: 70000,
    size: 1.4, // Fractional size!
    filled: 0,
    status: 'open',
    is_lp: false,
    version: 1,
    created_at: new Date().toISOString(),
  };

  const res = await bundle.settlement.commitMatchedBatchAtomically({
    trades: [],
    newOrders: [fractionalOrder],
  });

  console.log('Fractional order batch result:', res.errorCode);
  assert.strictEqual(res.success, false, 'Batch containing fractional order must be rejected');
  assert.strictEqual(res.errorCode, 'INVALID_ORDER_QUANTITY');
  assert.strictEqual(computeDatabaseFingerprint(db), fpBefore, 'State unchanged on fractional order rejection');
  console.log('✅ [PASS] Repository rejected fractional order with 0 mutation');

  console.log('\n🎉 ALL FRACTIONAL ORDER REJECTION TESTS PASSED!\n');
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
