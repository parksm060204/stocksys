/**
 * Regression Test Suite: Duplicate Order Settlement and Overfill Protection
 *
 * Verifies:
 * 1. Sequential duplicate settlement using different trade IDs on already filled orders is rejected
 * 2. Concurrent settlement using Promise.all() on the same order settles exactly one and rejects the other
 * 3. Legitimate multiple partial fills succeed up to exact order quantity
 * 4. Fills exceeding remaining order quantity are rejected
 * 5. Non-existent order references are rejected
 * 6. Order participant, symbol, or side mismatches are rejected
 * 7. On rejection, all domains (cash, holdings, orders, trades, price history) have ZERO mutations
 */

import assert from 'node:assert';
import { MemoryDatabase, OrderRecord } from '../lib/memoryDb/memoryStore';
import { InMemorySettlementRepository } from '../lib/repositories/inMemory/InMemorySettlementRepository';
import type { TradeSettlementInput } from '../lib/repositories/types';

const STOCK = '00000000-0000-4000-8000-000000000001';
const BUYER = 'user_buyer_1';
const SELLER = 'user_seller_1';

function setupEnvironment() {
  const db = new MemoryDatabase();
  db.profiles.set(BUYER, {
    id: BUYER,
    user_id: BUYER,
    username: 'buyer',
    nickname: 'buyer',
    cash: 50_000_000,
    net_worth: 50_000_000,
    rank_tier: 'GOLD',
    created_at: '2026-01-01T00:00:00.000Z',
  });
  db.profiles.set(SELLER, {
    id: SELLER,
    user_id: SELLER,
    username: 'seller',
    nickname: 'seller',
    cash: 10_000_000,
    net_worth: 10_000_000,
    rank_tier: 'GOLD',
    created_at: '2026-01-01T00:00:00.000Z',
  });
  db.profileUserIdIndex.set(BUYER, BUYER);
  db.profileUserIdIndex.set(SELLER, SELLER);

  const h = {
    id: `${SELLER}_${STOCK}`,
    user_id: SELLER,
    stock_id: STOCK,
    quantity: 5_000,
    avg_price: 1000,
    created_at: '2026-01-01T00:00:00.000Z',
  };
  db.holdings.set(h.id, h);
  db.addHoldingToIndex(h);

  db.stocks.set(STOCK, {
    id: STOCK,
    ticker: 'TEST',
    name: 'Test Corp',
    market: 'domestic',
    current_price: 1000,
    previous_close: 1000,
    open_price: 1000,
    high: 1000,
    low: 1000,
    volume: 0,
    change_rate: 0,
    market_cap: 10_000_000,
    pe_ratio: 10,
    dividend_yield: 0,
    sector: 'it',
  });

  db.trades = [];
  db.tradeStockIndex.clear();
  db.orders.clear();
  db.orderStockIndex.clear();
  db.orderUserIndex.clear();

  const repo = new InMemorySettlementRepository(db);
  return { db, repo };
}

function makeOrder(
  db: MemoryDatabase,
  id: string,
  side: 'buy' | 'sell',
  userId: string,
  price: number,
  size: number,
  filled: number = 0,
  status: 'open' | 'partial' | 'filled' = 'open'
): OrderRecord {
  const ord: OrderRecord = {
    id,
    stock_id: STOCK,
    user_id: userId,
    participantId: userId,
    side,
    price,
    size,
    filled,
    status,
    is_lp: false,
    created_at: '2026-01-01T00:00:00.000Z',
  };
  db.orders.set(id, ord);
  return ord;
}

function makeTrade(
  id: string,
  buyOrderId: string,
  sellOrderId: string,
  price: number,
  size: number,
  overrides: Partial<TradeSettlementInput> = {}
): TradeSettlementInput {
  return {
    id,
    stock_id: STOCK,
    buyer_id: BUYER,
    seller_id: SELLER,
    buy_order_id: buyOrderId,
    sell_order_id: sellOrderId,
    buyer_is_bot: false,
    seller_is_bot: false,
    price,
    size,
    fee_rates: { buyerFeeRate: 0.001, sellerFeeRate: 0.001 },
    simulation_time: 100,
    sequence: 1,
    ...overrides,
  };
}

async function runTests() {
  console.log('--- Testing Duplicate & Overfill Settlement Protection ---');

  // Test 1: Non-existent order rejection
  {
    const { db, repo } = setupEnvironment();
    makeOrder(db, 'BO_1', 'buy', BUYER, 1000, 100);
    // SO_999 does not exist
    const res = await repo.commitMatchedBatchAtomically({
      trades: [makeTrade('T_1', 'BO_1', 'SO_999', 1000, 50)],
    });
    assert.strictEqual(res.success, false, 'Should reject when sell order does not exist');
    assert.strictEqual(res.rollbackOccurred, true);
    assert.strictEqual(db.trades.length, 0, 'No trades recorded on non-existent order');
    assert.strictEqual(db.orders.get('BO_1')!.filled, 0, 'Buy order must not be modified');
    console.log('✅ [PASS] Non-existent order rejection');
  }

  // Test 2: Participant, symbol, or side mismatch rejection
  {
    const { db, repo } = setupEnvironment();
    makeOrder(db, 'BO_WRONG_SIDE', 'sell', BUYER, 1000, 100); // side is sell, but used as buy_order_id
    makeOrder(db, 'SO_1', 'sell', SELLER, 1000, 100);

    const res = await repo.commitMatchedBatchAtomically({
      trades: [makeTrade('T_2', 'BO_WRONG_SIDE', 'SO_1', 1000, 50)],
    });
    assert.strictEqual(res.success, false, 'Should reject when buy order has wrong side');
    assert.strictEqual(res.errorCode, 'ORDER_SIDE_MISMATCH');
    assert.strictEqual(db.trades.length, 0);
    console.log('✅ [PASS] Order side mismatch rejection');
  }

  // Test 3: Normal partial fills followed by completion
  {
    const { db, repo } = setupEnvironment();
    makeOrder(db, 'BO_PART', 'buy', BUYER, 1000, 100);
    makeOrder(db, 'SO_PART', 'sell', SELLER, 1000, 100);

    // Fill 40
    const res1 = await repo.commitMatchedBatchAtomically({
      trades: [makeTrade('T_P1', 'BO_PART', 'SO_PART', 1000, 40)],
    });
    assert.strictEqual(res1.success, true);
    assert.strictEqual(db.orders.get('BO_PART')!.filled, 40);
    assert.strictEqual(db.orders.get('BO_PART')!.status, 'partial');
    assert.strictEqual(db.orders.get('SO_PART')!.filled, 40);

    // Fill remaining 60
    const res2 = await repo.commitMatchedBatchAtomically({
      trades: [makeTrade('T_P2', 'BO_PART', 'SO_PART', 1000, 60)],
    });
    assert.strictEqual(res2.success, true);
    assert.strictEqual(db.orders.get('BO_PART')!.filled, 100);
    assert.strictEqual(db.orders.get('BO_PART')!.status, 'filled');
    assert.strictEqual(db.orders.get('SO_PART')!.filled, 100);
    assert.strictEqual(db.orders.get('SO_PART')!.status, 'filled');
    console.log('✅ [PASS] Multiple normal partial fills up to 100%');
  }

  // Test 4: Sequential duplicate settlement with same orders and new trade ID on filled order
  {
    const { db, repo } = setupEnvironment();
    makeOrder(db, 'BO_FULL', 'buy', BUYER, 1000, 100, 100, 'filled');
    makeOrder(db, 'SO_FULL', 'sell', SELLER, 1000, 100, 100, 'filled');

    // Attempt to settle again with new trade ID
    const res = await repo.commitMatchedBatchAtomically({
      trades: [makeTrade('T_DUP_NEW_ID', 'BO_FULL', 'SO_FULL', 1000, 100)],
    });
    assert.strictEqual(res.success, false, 'Must reject duplicate settlement of filled orders');
    assert.strictEqual(res.rollbackOccurred, true);
    assert.strictEqual(db.trades.length, 0);
    console.log('✅ [PASS] Sequential duplicate settlement on filled orders rejected');
  }

  // Test 5: Order remaining quantity overfill rejection
  {
    const { db, repo } = setupEnvironment();
    makeOrder(db, 'BO_SMALL', 'buy', BUYER, 1000, 30);
    makeOrder(db, 'SO_LARGE', 'sell', SELLER, 1000, 100);

    // Attempt to fill 50 when buy order only has 30
    const res = await repo.commitMatchedBatchAtomically({
      trades: [makeTrade('T_OVERFILL', 'BO_SMALL', 'SO_LARGE', 1000, 50)],
    });
    assert.strictEqual(res.success, false, 'Must reject overfill trade');
    assert.strictEqual(res.errorCode, 'ORDER_OVERFILL');
    assert.strictEqual(db.orders.get('BO_SMALL')!.filled, 0);
    assert.strictEqual(db.trades.length, 0);
    console.log('✅ [PASS] Order remaining quantity overfill rejection');
  }

  // Test 6: Aggregate overfill across multiple trades in one batch
  {
    const { db, repo } = setupEnvironment();
    makeOrder(db, 'BO_AGG', 'buy', BUYER, 1000, 50);
    makeOrder(db, 'SO_1', 'sell', SELLER, 1000, 30);
    makeOrder(db, 'SO_2', 'sell', SELLER, 1000, 30);

    // BO_AGG has size 50. Trade 1 takes 30, Trade 2 takes 30 -> total 60 > 50
    const res = await repo.commitMatchedBatchAtomically({
      trades: [
        makeTrade('T_AGG_1', 'BO_AGG', 'SO_1', 1000, 30),
        makeTrade('T_AGG_2', 'BO_AGG', 'SO_2', 1000, 30),
      ],
    });
    assert.strictEqual(res.success, false, 'Must reject batch when aggregate order quantity exceeds remaining');
    assert.strictEqual(res.errorCode, 'ORDER_OVERFILL');
    assert.strictEqual(db.trades.length, 0, 'No trades from failing batch should commit');
    assert.strictEqual(db.orders.get('BO_AGG')!.filled, 0);
    console.log('✅ [PASS] Batch-aggregate overfill rejection');
  }

  // Test 7: Concurrent duplicate settlement with Promise.all() - exactly one succeeds
  {
    const { db, repo } = setupEnvironment();
    makeOrder(db, 'BO_CONC', 'buy', BUYER, 1000, 100);
    makeOrder(db, 'SO_CONC', 'sell', SELLER, 1000, 100);

    const cashBuyerBefore = db.profiles.get(BUYER)!.cash;
    const holdingSellerBefore = db.holdings.get(`${SELLER}_${STOCK}`)!.quantity;

    // Both attempt to settle the full 100 concurrently
    const [resA, resB] = await Promise.all([
      repo.commitMatchedBatchAtomically({
        trades: [makeTrade('T_CONC_A', 'BO_CONC', 'SO_CONC', 1000, 100)],
      }),
      repo.commitMatchedBatchAtomically({
        trades: [makeTrade('T_CONC_B', 'BO_CONC', 'SO_CONC', 1000, 100)],
      }),
    ]);

    const successes = [resA, resB].filter((r) => r.success);
    const failures = [resA, resB].filter((r) => !r.success);

    assert.strictEqual(successes.length, 1, `Exactly one concurrent request must succeed, got ${successes.length}`);
    assert.strictEqual(failures.length, 1, 'Exactly one concurrent request must fail');
    assert.strictEqual(db.orders.get('BO_CONC')!.filled, 100);
    assert.strictEqual(db.orders.get('BO_CONC')!.status, 'filled');
    assert.strictEqual(db.trades.length, 1, 'Exactly 1 trade must be settled in DB');

    // Expected buyer cash decrease: 100 * 1000 + fee (100 * 1000 * 0.001 = 100) = 100,100
    const cashBuyerAfter = db.profiles.get(BUYER)!.cash;
    assert.strictEqual(cashBuyerBefore - cashBuyerAfter, 100_100, 'Cash deducted must match exactly 1 trade');

    // Expected seller holding decrease: 100
    const holdingSellerAfter = db.holdings.get(`${SELLER}_${STOCK}`)!.quantity;
    assert.strictEqual(holdingSellerBefore - holdingSellerAfter, 100);
    console.log('✅ [PASS] Concurrent duplicate settlement: exactly 1 succeeds, 1 rejected');
  }

  // Test 8: Zero-mutation assertion after failed settlement
  {
    const { db, repo } = setupEnvironment();
    makeOrder(db, 'BO_FAIL', 'buy', BUYER, 1000, 50);
    makeOrder(db, 'SO_FAIL', 'sell', SELLER, 1000, 50);

    const buyerCash = db.profiles.get(BUYER)!.cash;
    const sellerCash = db.profiles.get(SELLER)!.cash;
    const sellerHoldings = db.holdings.get(`${SELLER}_${STOCK}`)!.quantity;
    const tradesCount = db.trades.length;
    const ledgerCount = db.settlementLedger.size;
    const sphCount = db.stockPriceHistory.length;

    // Trigger failure by requesting trade size 999 on 50 size order
    const res = await repo.commitMatchedBatchAtomically({
      trades: [makeTrade('T_FAIL_MUTE', 'BO_FAIL', 'SO_FAIL', 1000, 999)],
      marketPriceUpdates: [{ stock_id: STOCK, price: 1200 }],
      priceHistory: [{ stock_id: STOCK, price: 1200, recorded_at: '2026-01-01T00:00:00.000Z' }],
    });
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.rollbackOccurred, true);

    // Verify ZERO mutation
    assert.strictEqual(db.profiles.get(BUYER)!.cash, buyerCash, 'Buyer cash unchanged');
    assert.strictEqual(db.profiles.get(SELLER)!.cash, sellerCash, 'Seller cash unchanged');
    assert.strictEqual(db.holdings.get(`${SELLER}_${STOCK}`)!.quantity, sellerHoldings, 'Holdings unchanged');
    assert.strictEqual(db.orders.get('BO_FAIL')!.filled, 0, 'Order filled unchanged');
    assert.strictEqual(db.orders.get('BO_FAIL')!.status, 'open', 'Order status unchanged');
    assert.strictEqual(db.stocks.get(STOCK)!.current_price, 1000, 'Stock price unchanged');
    assert.strictEqual(db.trades.length, tradesCount, 'No trade added');
    assert.strictEqual(db.settlementLedger.size, ledgerCount, 'No ledger entry added');
    assert.strictEqual(db.stockPriceHistory.length, sphCount, 'No price history added');
    console.log('✅ [PASS] Zero-mutation on failed settlement');
  }

  console.log('\n🎉 ALL DUPLICATE & OVERFILL SETTLEMENT TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('❌ Test failed with error:', err);
  process.exit(1);
});
