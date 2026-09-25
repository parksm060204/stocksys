/**
 * Regression Test Suite: Multi-Stock Order ID Collision Detection
 *
 * Verifies:
 * 1. Fallback order IDs generated in the same tick across different stocks do NOT collide
 * 2. Order IDs are deterministic and uniquely incorporate stockId, participantId, side, sequence
 * 3. Both trades settle normally without ID collision
 * 4. 100 stocks x multiple participants combination produces exactly 0 collisions
 */

import assert from 'node:assert';
import { MemoryDatabase, SequentialIdGenerator } from '../lib/memoryDb/memoryStore';
import { MarketEngine } from '../engine-server/src/MarketEngine';
import { createInMemoryRepositoryBundle } from '../lib/repositories/inMemory';
import { StaticTimeSource } from '../lib/engine/simulation/runtime/simulationTimeSource';
import type { MarketDataSource } from '../engine-server/src/MarketEngine';
import { buildDeterministicOrderId } from '../engine-server/src/settlement/deterministicOrderId';

const NOW = Date.parse('2026-06-01T09:00:00.000Z');
const STOCK_1 = '00000000-0000-4000-8000-000000000001';
const STOCK_2 = '00000000-0000-4000-8000-000000000002';

class MockMarketDataSource implements MarketDataSource {
  constructor(private readonly stocks: any[]) {}
  async fetchMarketState(): Promise<any> {
    return { stocks: this.stocks, bonds: [], commodities: [], activeEvents: [] };
  }
}

async function runTests() {
  console.log('--- Testing Multi-Stock Order ID Collision Detection ---');

  // Test 1: Fallback order ID generation across two stocks in same tick
  // In current code:
  // buyOrderId = highestBid.id ?? (highestBid.id = `ord_${this.simulationRunId}_t${this.tickCount}_b${workingBids.length}`)
  // If stock 1 and stock 2 both have workingBids.length === 1, they get IDENTICAL order IDs!
  const stock1 = { id: STOCK_1, name: 'Stock 1', ticker: 'STK1', current_price: 10000, market: 'DOMESTIC' };
  const stock2 = { id: STOCK_2, name: 'Stock 2', ticker: 'STK2', current_price: 20000, market: 'DOMESTIC' };

  const clock = new StaticTimeSource(NOW);
  const db = new MemoryDatabase({
    clock,
    idGenerator: new SequentialIdGenerator(100),
  });
  db.stocks.set(STOCK_1, stock1 as any);
  db.stocks.set(STOCK_2, stock2 as any);

  const bundle = createInMemoryRepositoryBundle(db);
  const engine = new MarketEngine({
    repositories: bundle,
    marketDataSource: new MockMarketDataSource([stock1, stock2]),
    simulationRunId: 'test_run',
  });
  await engine.initializeBots();

  // Test internal ID collision:
  // Submit raw orders for Stock 1 and Stock 2 WITHOUT explicit ids (forcing fallback generation)
  const orderS1Buy = {
    stock_id: STOCK_1,
    participantId: 'INST_BOT_1',
    participantKind: 'DOMESTIC_INSTITUTION',
    orderType: 'STRATEGIC_ORDER',
    side: 'buy' as const,
    price: 10000,
    size: 10,
    // id: undefined -> forces fallback generation!
  };
  const orderS1Sell = {
    stock_id: STOCK_1,
    participantId: 'INST_BOT_2',
    participantKind: 'DOMESTIC_INSTITUTION',
    orderType: 'STRATEGIC_ORDER',
    side: 'sell' as const,
    price: 10000,
    size: 10,
  };

  const orderS2Buy = {
    stock_id: STOCK_2,
    participantId: 'INST_BOT_3',
    participantKind: 'DOMESTIC_INSTITUTION',
    orderType: 'STRATEGIC_ORDER',
    side: 'buy' as const,
    price: 20000,
    size: 10,
    // id: undefined -> forces fallback generation!
  };
  const orderS2Sell = {
    stock_id: STOCK_2,
    participantId: 'INST_BOT_4',
    participantKind: 'DOMESTIC_INSTITUTION',
    orderType: 'STRATEGIC_ORDER',
    side: 'sell' as const,
    price: 20000,
    size: 10,
  };

  // Fund participants
  for (const botId of ['INST_BOT_1', 'INST_BOT_2', 'INST_BOT_3', 'INST_BOT_4']) {
    db.profiles.set(botId, {
      id: botId,
      user_id: botId,
      username: botId,
      nickname: botId,
      cash: 10_000_000,
      net_worth: 10_000_000,
      rank_tier: 'INSTITUTION',
      created_at: new Date(NOW).toISOString(),
    });
  }
  await bundle.participant.upsertBotConfigs([
    { bot_id: 'INST_BOT_1', participant_kind: 'DOMESTIC_INSTITUTION' },
    { bot_id: 'INST_BOT_2', participant_kind: 'DOMESTIC_INSTITUTION' },
    { bot_id: 'INST_BOT_3', participant_kind: 'DOMESTIC_INSTITUTION' },
    { bot_id: 'INST_BOT_4', participant_kind: 'DOMESTIC_INSTITUTION' },
  ]);
  const h1 = { id: `INST_BOT_2_${STOCK_1}`, user_id: 'INST_BOT_2', stock_id: STOCK_1, quantity: 100, avg_price: 10000, created_at: new Date(NOW).toISOString() };
  const h2 = { id: `INST_BOT_4_${STOCK_2}`, user_id: 'INST_BOT_4', stock_id: STOCK_2, quantity: 100, avg_price: 20000, created_at: new Date(NOW).toISOString() };
  db.holdings.set(h1.id, h1);
  db.holdings.set(h2.id, h2);
  db.addHoldingToIndex(h1);
  db.addHoldingToIndex(h2);

  // Directly pass these raw orders into processBatchOrders
  await (engine as any).processBatchOrders([orderS1Buy, orderS1Sell, orderS2Buy, orderS2Sell], {
    stocks: [stock1, stock2],
    bonds: [],
    commodities: [],
    activeEvents: [],
  }, false);

  // Filter trades for STOCK_1 and STOCK_2 generated by our test orders
  const s1Trades = db.trades.filter(t => t.stock_id === STOCK_1 && (t.buyer_id === 'INST_BOT_1' || t.seller_id === 'INST_BOT_2'));
  const s2Trades = db.trades.filter(t => t.stock_id === STOCK_2 && (t.buyer_id === 'INST_BOT_3' || t.seller_id === 'INST_BOT_4'));

  assert.strictEqual(s1Trades.length, 1, 'Stock 1 trade should be matched and settled');
  assert.strictEqual(s2Trades.length, 1, 'Stock 2 trade should be matched and settled');
  const trade1 = s1Trades[0];
  const trade2 = s2Trades[0];

  const s1BuyId = trade1.buy_order_id;
  const s2BuyId = trade2.buy_order_id;
  const s1SellId = trade1.sell_order_id;
  const s2SellId = trade2.sell_order_id;

  console.log(`Generated IDs:
  Trade 1 (Stock 1): buy=${s1BuyId}, sell=${s1SellId}
  Trade 2 (Stock 2): buy=${s2BuyId}, sell=${s2SellId}`);

  assert.notStrictEqual(
    s1BuyId,
    s2BuyId,
    `Order IDs for different stocks in the same tick MUST NOT COLLIDE! Got ${s1BuyId} for both!`
  );
  assert.notStrictEqual(
    s1SellId,
    s2SellId,
    `Order IDs for different stocks in the same tick MUST NOT COLLIDE! Got ${s1SellId} for both!`
  );

  // Verify all 4 IDs are mutually exclusive
  const idSet = new Set([s1BuyId, s1SellId, s2BuyId, s2SellId]);
  assert.strictEqual(idSet.size, 4, 'All 4 order IDs must be mutually exclusive');

  // Test 2: Stress test 100 stocks x 10 participants x 2 sides x 5 sequences = 10,000 IDs
  const stressIdSet = new Set<string>();
  let totalGenerated = 0;
  for (let s = 1; s <= 100; s++) {
    const stockId = `stock_${s}`;
    for (let p = 1; p <= 10; p++) {
      const partId = `part_${p}`;
      for (const side of ['buy' as const, 'sell' as const]) {
        for (let seq = 1; seq <= 5; seq++) {
          const id = buildDeterministicOrderId({
            simulationRunId: 'stress_run',
            tickSequence: 1,
            stockId,
            participantId: partId,
            side,
            perTickOrderSequence: seq,
          });
          assert.strictEqual(stressIdSet.has(id), false, `Collision detected on ID ${id}`);
          stressIdSet.add(id);
          totalGenerated++;
        }
      }
    }
  }
  assert.strictEqual(stressIdSet.size, totalGenerated, `Expected ${totalGenerated} distinct IDs, got ${stressIdSet.size}`);
  console.log(`✅ [PASS] 100 stocks x 10 participants stress test generated ${totalGenerated} IDs with 0 collisions`);

  console.log('\n🎉 ALL MULTI-STOCK ORDER ID TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('❌ Multi-stock order ID test failed:', err);
  process.exit(1);
});
