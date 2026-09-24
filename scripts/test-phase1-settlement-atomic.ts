/**
 * Phase 1 Settlement Repository Atomic & Idempotency Test
 *
 * Validates:
 * 1. Atomic batch settlement execution
 * 2. Pre-validation and strict non-negative invariant enforcement
 * 3. Atomic rollback on batch failure (all-or-nothing)
 * 4. Idempotency guarantees (duplicate batch or trade settles 0 times)
 */

import assert from 'node:assert';
import { MemoryDatabase } from '../lib/memoryDb/memoryStore';
import { InMemorySettlementRepository } from '../lib/repositories/inMemory/InMemorySettlementRepository';
import type { TradeSettlementInput } from '../lib/repositories/types';

async function runSettlementAtomicTests() {
  console.log('================================================================');
  console.log('🧪 [TEST] Phase 1 Settlement Repository Atomic & Idempotency');
  console.log('================================================================\n');

  // Setup isolated database
  const db = new MemoryDatabase();
  const repo = new InMemorySettlementRepository(db);

  // Setup accounts
  const buyerId = 'user_buyer_1';
  const sellerId = 'user_seller_1';
  const stockId = 'stock_samsung';

  db.profiles.set(buyerId, {
    id: buyerId,
    user_id: buyerId,
    username: 'Buyer',
    nickname: 'BuyerNick',
    cash: 1_000_000,
    net_worth: 1_000_000,
    rank_tier: 'BRONZE',
    created_at: '2026-01-01T00:00:00Z',
  });

  db.profiles.set(sellerId, {
    id: sellerId,
    user_id: sellerId,
    username: 'Seller',
    nickname: 'SellerNick',
    cash: 500_000,
    net_worth: 500_000,
    rank_tier: 'BRONZE',
    created_at: '2026-01-01T00:00:00Z',
  });

  db.holdings.set(`${sellerId}_${stockId}`, {
    id: `holding_${sellerId}_${stockId}`,
    user_id: sellerId,
    stock_id: stockId,
    quantity: 100,
    avg_price: 50_000,
    created_at: '2026-01-01T00:00:00Z',
  });

  db.stocks.set(stockId, {
    id: stockId,
    ticker: '005930',
    name: 'Samsung',
    market: 'KOSPI',
    current_price: 60_000,
    previous_close: 60_000,
    open_price: 60_000,
    high: 60_000,
    low: 60_000,
    volume: 1000,
    change_rate: 0,
    market_cap: 1000000000,
    pe_ratio: 10,
    dividend_yield: 2,
    sector: 'semiconductor',
  });

  // ── TEST 1: Successful Atomic Batch Settlement ──
  console.log('[TEST 1] Successful Atomic Batch Settlement');
  const validBatch: TradeSettlementInput[] = [
    {
      id: 'trade_001',
      stock_id: stockId,
      buy_order_id: 'order_b1',
      sell_order_id: 'order_s1',
      buyer_id: buyerId,
      seller_id: sellerId,
      buyer_is_bot: false,
      seller_is_bot: false,
      price: 60_000,
      size: 5,
      total_amount: 300_000,
      buyer_fee: 300,
      seller_fee: 300,
      created_at: '2026-01-01T10:00:00Z',
      settled: false,
    },
  ];

  const result1 = await repo.settleTradeBatchAtomically(validBatch);
  assert.strictEqual(result1.success, true, 'Batch settlement should succeed');
  assert.strictEqual(result1.settledTradesCount, 1, '1 trade settled');
  assert.strictEqual(result1.rollbackOccurred, false, 'No rollback');

  // Verify balances
  const buyerProfile1 = db.profiles.get(buyerId)!;
  const sellerProfile1 = db.profiles.get(sellerId)!;
  const sellerHolding1 = db.holdings.get(`${sellerId}_${stockId}`)!;
  const buyerHolding1 = db.holdings.get(`${buyerId}_${stockId}`)!;

  assert.strictEqual(buyerProfile1.cash, 1_000_000 - 300_000 - 300, 'Buyer cash debited with fee');
  assert.strictEqual(sellerProfile1.cash, 500_000 + 300_000 - 300, 'Seller cash credited minus fee');
  assert.strictEqual(sellerHolding1.quantity, 95, 'Seller shares decremented');
  assert.strictEqual(buyerHolding1.quantity, 5, 'Buyer shares incremented');
  console.log('  ✅ [PASS] Balances and holdings updated accurately');

  // ── TEST 2: Idempotency (Re-settling same trade does not alter balances) ──
  console.log('\n[TEST 2] Settlement Idempotency (Duplicate Prevention)');
  const duplicateResult = await repo.settleTradeBatchAtomically(validBatch);
  assert.strictEqual(duplicateResult.success, true, 'Duplicate request is safe');
  assert.strictEqual(duplicateResult.settledTradesCount, 0, 'No trades re-settled');
  assert.strictEqual(duplicateResult.skippedTradeIds?.length, 1, 'Trade marked skipped');

  const buyerProfileAfterDup = db.profiles.get(buyerId)!;
  assert.strictEqual(buyerProfileAfterDup.cash, buyerProfile1.cash, 'Buyer cash unchanged on replay');
  console.log('  ✅ [PASS] Duplicate trade execution idempotently skipped');

  // ── TEST 3: Atomic Rollback on Batch Failure ──
  console.log('\n[TEST 3] Atomic Rollback on Partial Validation Failure');
  const buyerCashBeforeBatch = buyerProfileAfterDup.cash;
  const sellerHoldingBeforeBatch = sellerHolding1.quantity;

  const failingBatch: TradeSettlementInput[] = [
    // Trade A: valid (buyer has enough cash for 1 share)
    {
      id: 'trade_002',
      stock_id: stockId,
      buy_order_id: 'order_b2',
      sell_order_id: 'order_s2',
      buyer_id: buyerId,
      seller_id: sellerId,
      buyer_is_bot: false,
      seller_is_bot: false,
      price: 60_000,
      size: 1,
      total_amount: 60_000,
      buyer_fee: 60,
      seller_fee: 60,
      created_at: '2026-01-01T10:05:00Z',
      settled: false,
    },
    // Trade B: invalid (buyer tries to buy 1,000,000 shares exceeding cash)
    {
      id: 'trade_003',
      stock_id: stockId,
      buy_order_id: 'order_b3',
      sell_order_id: 'order_s3',
      buyer_id: buyerId,
      seller_id: sellerId,
      buyer_is_bot: false,
      seller_is_bot: false,
      price: 60_000,
      size: 1_000_000,
      total_amount: 60_000_000_000,
      buyer_fee: 60_000_000,
      seller_fee: 60_000_000,
      created_at: '2026-01-01T10:05:01Z',
      settled: false,
    },
  ];

  const result3 = await repo.settleTradeBatchAtomically(failingBatch);
  assert.strictEqual(result3.success, false, 'Batch should fail');
  assert.strictEqual(result3.rollbackOccurred, true, 'Rollback flag must be true');
  assert.strictEqual(result3.settledTradesCount, 0, 'No trades committed');

  // Invariant check: Trade A MUST NOT have mutated balances!
  const buyerCashAfterRollback = db.profiles.get(buyerId)!.cash;
  const sellerHoldingAfterRollback = db.holdings.get(`${sellerId}_${stockId}`)!.quantity;
  assert.strictEqual(buyerCashAfterRollback, buyerCashBeforeBatch, 'Buyer cash strictly unchanged after rollback');
  assert.strictEqual(sellerHoldingAfterRollback, sellerHoldingBeforeBatch, 'Seller holding strictly unchanged after rollback');
  assert.strictEqual(repo.isTradeSettled('trade_002'), false, 'Trade A is not marked settled');
  console.log('  ✅ [PASS] Entire batch rolled back atomically on failure');

  // ── TEST 4: Negative Cash / Short Selling Prevention ──
  console.log('\n[TEST 4] Negative Invariant Enforcement');
  const emptySellerId = 'user_seller_empty';
  db.profiles.set(emptySellerId, {
    id: emptySellerId,
    user_id: emptySellerId,
    username: 'EmptySeller',
    nickname: 'EmptySellerNick',
    cash: 0,
    net_worth: 0,
    rank_tier: 'BRONZE',
    created_at: '2026-01-01T00:00:00Z',
  });

  const illegalShortSell: TradeSettlementInput[] = [
    {
      id: 'trade_004',
      stock_id: stockId,
      buy_order_id: 'order_b4',
      sell_order_id: 'order_s4',
      buyer_id: buyerId,
      seller_id: emptySellerId,
      buyer_is_bot: false,
      seller_is_bot: false,
      price: 60_000,
      size: 10,
      total_amount: 600_000,
      buyer_fee: 600,
      seller_fee: 600,
      created_at: '2026-01-01T10:10:00Z',
      settled: false,
    },
  ];

  const result4 = await repo.settleTradeBatchAtomically(illegalShortSell);
  assert.strictEqual(result4.success, false, 'Short sell without holding must fail');
  assert.strictEqual(result4.rollbackOccurred, true, 'Rollback occurred');
  assert.strictEqual(db.holdings.has(`${emptySellerId}_${stockId}`), false, 'Negative holding prevented');
  console.log('  ✅ [PASS] Short selling without inventory strictly rejected');

  console.log('\n================================================================');
  console.log('🎉 ALL SETTLEMENT ATOMIC & IDEMPOTENCY TESTS PASSED (100%)');
  console.log('================================================================');
}

runSettlementAtomicTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
