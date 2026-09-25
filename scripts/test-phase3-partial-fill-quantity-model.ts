/**
 * Regression Test Suite: Partial Fill Quantity Model & Continuous Tick Matching
 *
 * Verifies:
 * 1. 100-share order matched with 40-share order in Tick 1:
 *    - Order has original: 100, filled: 40, remaining: 60, status: 'partial'
 * 2. In Tick 2, when matched against another 100-share order:
 *    - Only the remaining 60 shares are matched (NOT 100 shares!)
 * 3. Total filled across ticks is exactly 100, status becomes 'filled'
 * 4. In Tick 3, no additional fills occur
 */

import assert from 'node:assert';
import { MemoryDatabase, SequentialIdGenerator } from '../lib/memoryDb/memoryStore';
import { MarketEngine } from '../engine-server/src/MarketEngine';
import { createInMemoryRepositoryBundle } from '../lib/repositories/inMemory';
import { StaticTimeSource } from '../lib/engine/simulation/runtime/simulationTimeSource';
import type { MarketDataSource } from '../engine-server/src/MarketEngine';

const NOW = Date.parse('2026-06-01T09:00:00.000Z');
const STOCK_ID = '00000000-0000-4000-8000-000000000001';

class MockMarketDataSource implements MarketDataSource {
  constructor(private readonly stocks: any[]) {}
  async fetchMarketState(): Promise<any> {
    return { stocks: this.stocks, bonds: [], commodities: [], activeEvents: [] };
  }
}

async function runTests() {
  console.log('--- Testing Partial Fill Quantity Model & Continuous Ticks ---');

  const stock = { id: STOCK_ID, name: 'Samsung', ticker: 'SEC', current_price: 10000, market: 'DOMESTIC' };
  const clock = new StaticTimeSource(NOW);
  const db = new MemoryDatabase({
    clock,
    idGenerator: new SequentialIdGenerator(200),
  });
  db.stocks.set(STOCK_ID, stock as any);

  const bundle = createInMemoryRepositoryBundle(db);
  const engine = new MarketEngine({
    repositories: bundle,
    marketDataSource: new MockMarketDataSource([stock]),
    simulationRunId: 'test_partial_fill_run',
  });
  await engine.initializeBots();

  // Setup participants
  db.profiles.set('BUYER_PARTIAL', {
    id: 'BUYER_PARTIAL',
    user_id: 'BUYER_PARTIAL',
    username: 'BuyerPartial',
    nickname: 'BuyerPartial',
    cash: 50_000_000,
    net_worth: 50_000_000,
    rank_tier: 'INSTITUTION',
    created_at: new Date(NOW).toISOString(),
  });
  db.profiles.set('SELLER_PARTIAL_1', {
    id: 'SELLER_PARTIAL_1',
    user_id: 'SELLER_PARTIAL_1',
    username: 'SellerPartial1',
    nickname: 'SellerPartial1',
    cash: 10_000_000,
    net_worth: 10_000_000,
    rank_tier: 'INSTITUTION',
    created_at: new Date(NOW).toISOString(),
  });
  db.profiles.set('SELLER_PARTIAL_2', {
    id: 'SELLER_PARTIAL_2',
    user_id: 'SELLER_PARTIAL_2',
    username: 'SellerPartial2',
    nickname: 'SellerPartial2',
    cash: 10_000_000,
    net_worth: 10_000_000,
    rank_tier: 'INSTITUTION',
    created_at: new Date(NOW).toISOString(),
  });

  await bundle.participant.upsertBotConfigs([
    { bot_id: 'BUYER_PARTIAL', participant_kind: 'DOMESTIC_INSTITUTION' },
    { bot_id: 'SELLER_PARTIAL_1', participant_kind: 'DOMESTIC_INSTITUTION' },
    { bot_id: 'SELLER_PARTIAL_2', participant_kind: 'DOMESTIC_INSTITUTION' },
  ]);

  const h1 = { id: `SELLER_PARTIAL_1_${STOCK_ID}`, user_id: 'SELLER_PARTIAL_1', stock_id: STOCK_ID, quantity: 1000, avg_price: 10000, created_at: new Date(NOW).toISOString() };
  const h2 = { id: `SELLER_PARTIAL_2_${STOCK_ID}`, user_id: 'SELLER_PARTIAL_2', stock_id: STOCK_ID, quantity: 1000, avg_price: 10000, created_at: new Date(NOW).toISOString() };
  db.holdings.set(h1.id, h1);
  db.holdings.set(h2.id, h2);
  db.addHoldingToIndex(h1);
  db.addHoldingToIndex(h2);

  // 1. Submit a 100-share buy order into open orders repository
  const buyOrder = {
    id: 'ORD_BUY_100_PARTIAL',
    stock_id: STOCK_ID,
    user_id: 'BUYER_PARTIAL',
    participantId: 'BUYER_PARTIAL',
    participantKind: 'DOMESTIC_INSTITUTION',
    orderType: 'STRATEGIC_ORDER',
    side: 'buy' as const,
    price: 10000,
    size: 100,
    filled: 0,
    status: 'open' as const,
    is_lp: false,
    created_at: new Date(NOW).toISOString(),
  };
  db.orders.set(buyOrder.id, buyOrder);
  db.addOrderToIndex(buyOrder);

  // 2. Tick 1: A 40-share sell order enters
  const sellOrder40 = {
    id: 'ORD_SELL_40_TICK1',
    stock_id: STOCK_ID,
    user_id: 'SELLER_PARTIAL_1',
    participantId: 'SELLER_PARTIAL_1',
    participantKind: 'DOMESTIC_INSTITUTION',
    orderType: 'STRATEGIC_ORDER',
    side: 'sell' as const,
    price: 10000,
    size: 40,
    filled: 0,
    status: 'open' as const,
    is_lp: false,
    created_at: new Date(NOW + 1000).toISOString(),
  };

  await (engine as any).processBatchOrders([sellOrder40], {
    stocks: [stock],
    bonds: [],
    commodities: [],
    activeEvents: [],
  }, false);

  // Check state after Tick 1:
  const orderAfterTick1 = db.orders.get(buyOrder.id)!;
  console.log('Order after Tick 1:', {
    size: orderAfterTick1.size,
    filled: orderAfterTick1.filled,
    remainingQuantity: (orderAfterTick1 as any).remainingQuantity,
    status: orderAfterTick1.status,
  });

  assert.strictEqual(orderAfterTick1.filled, 40, 'Tick 1 filled quantity must be 40');
  assert.strictEqual(orderAfterTick1.status, 'partial', 'Tick 1 order status must be partial');

  // 3. Tick 2: A 100-share sell order enters
  // In buggy code:
  // getOpenOrders returns orderAfterTick1 with size = 100 (or whichever).
  // The matching engine uses `size` (100) instead of remaining quantity (60),
  // which attempts to match 100 shares, resulting in ORDER_OVERFILL!
  const sellOrder100 = {
    id: 'ORD_SELL_100_TICK2',
    stock_id: STOCK_ID,
    user_id: 'SELLER_PARTIAL_2',
    participantId: 'SELLER_PARTIAL_2',
    participantKind: 'DOMESTIC_INSTITUTION',
    orderType: 'STRATEGIC_ORDER',
    side: 'sell' as const,
    price: 10000,
    size: 100,
    filled: 0,
    status: 'open' as const,
    is_lp: false,
    created_at: new Date(NOW + 2000).toISOString(),
  };

  await (engine as any).processBatchOrders([sellOrder100], {
    stocks: [stock],
    bonds: [],
    commodities: [],
    activeEvents: [],
  }, false);

  // Check state after Tick 2:
  const orderAfterTick2 = db.orders.get(buyOrder.id)!;
  console.log('Order after Tick 2:', {
    size: orderAfterTick2.size,
    filled: orderAfterTick2.filled,
    remainingQuantity: (orderAfterTick2 as any).remainingQuantity,
    status: orderAfterTick2.status,
  });

  assert.strictEqual(orderAfterTick2.filled, 100, 'Tick 2 filled quantity must be exactly 100');
  assert.strictEqual(orderAfterTick2.status, 'filled', 'Order must be filled after 100 total');

  // 4. Tick 3: Another sell order enters -> buy order must NOT match anything more!
  const sellOrderExtra = {
    id: 'ORD_SELL_EXTRA_TICK3',
    stock_id: STOCK_ID,
    user_id: 'SELLER_PARTIAL_2',
    participantId: 'SELLER_PARTIAL_2',
    participantKind: 'DOMESTIC_INSTITUTION',
    orderType: 'STRATEGIC_ORDER',
    side: 'sell' as const,
    price: 10000,
    size: 50,
    filled: 0,
    status: 'open' as const,
    is_lp: false,
    created_at: new Date(NOW + 3000).toISOString(),
  };

  const tradesCountBefore = db.trades.length;
  await (engine as any).processBatchOrders([sellOrderExtra], {
    stocks: [stock],
    bonds: [],
    commodities: [],
    activeEvents: [],
  }, false);

  const tradesCountAfter = db.trades.length;
  assert.strictEqual(tradesCountAfter, tradesCountBefore, 'No additional trades should occur for filled order in Tick 3');

  console.log('\n🎉 ALL PARTIAL FILL CONTINUOUS TICK TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('❌ Partial fill test failed:', err);
  process.exit(1);
});
