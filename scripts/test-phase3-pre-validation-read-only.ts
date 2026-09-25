/**
 * Regression Test Suite: Read-Only Pre-Validation & Elimination of Profile Creation Side-Effects
 *
 * Verifies:
 * 1. When an institutional portfolio exists without a profile in db.profiles,
 *    pre-validation must NOT create/insert a profile into db.profiles as a side-effect.
 * 2. If settlement fails (e.g. insufficient balance), zero mutation occurs.
 * 3. Database fingerprint before and after failed settlement is 100% bit-for-bit identical.
 */

import assert from 'node:assert';
import { MemoryDatabase, SequentialIdGenerator } from '../lib/memoryDb/memoryStore';
import { createInMemoryRepositoryBundle } from '../lib/repositories/inMemory';
import { StaticTimeSource } from '../lib/engine/simulation/runtime/simulationTimeSource';
import type { MatchedBatchCommitInput } from '../lib/repositories/types';
import crypto from 'node:crypto';

const NOW = Date.parse('2026-06-01T09:00:00.000Z');
const STOCK_ID = '00000000-0000-4000-8000-000000000001';
const BOT_ID = 'INST_PORTFOLIO_ONLY_BOT';

function computeDatabaseFingerprint(db: MemoryDatabase): string {
  const hash = crypto.createHash('sha256');
  const orders = Array.from(db.orders.entries()).sort(([a], [b]) => a.localeCompare(b));
  const profiles = Array.from(db.profiles.entries()).sort(([a], [b]) => a.localeCompare(b));
  const holdings = Array.from(db.holdings.entries()).sort(([a], [b]) => a.localeCompare(b));
  const portfolios = Array.from(db.institutionalPortfolios.entries()).sort(([a], [b]) => a.localeCompare(b));
  const trades = [...db.trades].sort((a, b) => a.id.localeCompare(b.id));
  const ledger = Array.from(db.settlementLedger.entries()).sort(([a], [b]) => a.localeCompare(b));
  const profileIndex = Array.from(db.profileUserIdIndex.entries()).sort(([a], [b]) => a.localeCompare(b));

  hash.update(JSON.stringify({
    orders,
    profiles,
    holdings,
    portfolios,
    trades,
    ledger,
    profileIndex,
    idGen: db.snapshotIdGenerator(),
  }));
  return hash.digest('hex');
}

async function runTests() {
  console.log('--- Testing Read-Only Pre-Validation & Zero Side-Effects ---');

  const clock = new StaticTimeSource(NOW);
  const db = new MemoryDatabase({
    clock,
    idGenerator: new SequentialIdGenerator(400),
  });
  const bundle = createInMemoryRepositoryBundle(db);

  // Setup: Institutional portfolio exists, but NO profile exists in db.profiles!
  db.institutionalPortfolios.set(BOT_ID, {
    bot_id: BOT_ID,
    name: 'PortfolioOnlyFund',
    current_cash: 500, // VERY LOW CASH (insufficient for 10,000 KRW trade)
    current_stock: 0,
    total_capital: 500,
    updated_at: new Date(NOW).toISOString(),
  });

  // Verify profile does NOT exist in db.profiles or index before settlement
  assert.strictEqual(db.profiles.has(BOT_ID), false, 'Profile must not exist before test');
  assert.strictEqual(db.profileUserIdIndex.has(BOT_ID), false, 'Profile index must not exist before test');

  // Setup seller with holding
  db.profiles.set('SELLER_USER', {
    id: 'SELLER_USER',
    user_id: 'SELLER_USER',
    username: 'Seller',
    nickname: 'Seller',
    cash: 1_000_000,
    net_worth: 1_000_000,
    rank_tier: 'RETAIL',
    created_at: new Date(NOW).toISOString(),
  });
  const sellerHolding = {
    id: `SELLER_USER_${STOCK_ID}`,
    user_id: 'SELLER_USER',
    stock_id: STOCK_ID,
    quantity: 100,
    avg_price: 10000,
    created_at: new Date(NOW).toISOString(),
  };
  db.holdings.set(sellerHolding.id, sellerHolding);
  db.addHoldingToIndex(sellerHolding);

  // Orders
  const buyOrder = {
    id: 'ORD_BUY_INSUFFICIENT',
    stock_id: STOCK_ID,
    user_id: BOT_ID,
    participantId: BOT_ID,
    side: 'buy' as const,
    price: 10_000,
    size: 1,
    filled: 0,
    status: 'open' as const,
    is_lp: false,
    created_at: new Date(NOW).toISOString(),
  };
  const sellOrder = {
    id: 'ORD_SELL_VALID',
    stock_id: STOCK_ID,
    user_id: 'SELLER_USER',
    participantId: 'SELLER_USER',
    side: 'sell' as const,
    price: 10_000,
    size: 1,
    filled: 0,
    status: 'open' as const,
    is_lp: false,
    created_at: new Date(NOW).toISOString(),
  };

  db.orders.set(buyOrder.id, buyOrder);
  db.addOrderToIndex(buyOrder);
  db.orders.set(sellOrder.id, sellOrder);
  db.addOrderToIndex(sellOrder);

  const baselineFingerprint = computeDatabaseFingerprint(db);

  // Attempt settlement of 10,000 KRW trade (buyer only has 500 KRW)
  const batch: MatchedBatchCommitInput = {
    trades: [
      {
        id: 'TRADE_INSUFFICIENT_FUNDS_1',
        stock_id: STOCK_ID,
        buy_order_id: buyOrder.id,
        sell_order_id: sellOrder.id,
        buyer_id: BOT_ID,
        seller_id: 'SELLER_USER',
        buyer_is_bot: true,
        seller_is_bot: false,
        price: 10_000,
        size: 1,
        fee_rates: { buyerFeeRate: 0.001, sellerFeeRate: 0.001 },
      },
    ],
  };

  const res = await bundle.settlement.commitMatchedBatchAtomically(batch);
  console.log('Settlement result:', res.errorCode, res.error);

  assert.strictEqual(res.success, false, 'Settlement must fail due to insufficient funds');

  // Verify: Did validation pollute db.profiles with a newly created profile?
  // In buggy code: getProfile() in validation creates and sets a profile in db.profiles!
  const profileCreated = db.profiles.has(BOT_ID);
  console.log('Profile created in db.profiles after failed settlement?:', profileCreated);

  assert.strictEqual(
    profileCreated,
    false,
    'Validation must be pure read-only! Profile must NOT be created as a side-effect of a failed batch!'
  );

  const postFailureFingerprint = computeDatabaseFingerprint(db);
  assert.strictEqual(
    postFailureFingerprint,
    baselineFingerprint,
    'Database fingerprint must be 100% bit-for-bit identical before and after failed settlement'
  );

  console.log('✅ [PASS] Pre-validation is strictly read-only and leaves zero profile side-effects');
}

runTests().catch((err) => {
  console.error('❌ Pre-validation test failed:', err);
  process.exit(1);
});
