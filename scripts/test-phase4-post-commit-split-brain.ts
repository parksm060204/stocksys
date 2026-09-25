/**
 * Phase 4 Test: P0 - Settlement Post-Commit Error vs Split-Brain Prevention
 *
 * Verifies that:
 * 1. Post-commit errors (e.g. commodityEngine.nextTick() throwing) do NOT report tick failure
 * 2. Pre-commit runtime state (tickCount) is NOT rolled back if authoritative commit succeeded
 * 3. commitStatus === 'COMMITTED' and postCommitWarnings are populated
 * 4. Exactly-once settlement: retrying does not create duplicate trades
 */

import assert from 'node:assert';
import { MarketEngine } from '../engine-server/src/MarketEngine';
import { MemoryDatabase, OrderRecord, StockRecord, ProfileRecord, HoldingRecord } from '../lib/memoryDb/memoryStore';
import { createInMemoryRepositoryBundle } from '../lib/repositories/inMemory';
import { createSimulationContext } from '../lib/engine/simulation/runtime/simulationContext';
import { StaticTimeSource } from '../lib/engine/simulation/runtime/simulationTimeSource';
import type { MarketExecutionObserver } from '../engine-server/src/observers/MarketExecutionObserver';

class NoopObserver implements MarketExecutionObserver {
  public async onSettlementCommitted() {}
}

const NOW = Date.parse('2026-06-30T10:00:00.000Z');
const STOCK_ID = 'stock_samsung';
const BUYER_ID = 'user_buyer_1';
const SELLER_ID = 'user_seller_1';

async function setupEngine(): Promise<{ engine: MarketEngine; db: MemoryDatabase }> {
  const db = new MemoryDatabase();
  db.trades = [];
  db.settlementLedger.clear();

  const stock: StockRecord = {
    id: STOCK_ID,
    ticker: '005930',
    name: 'Samsung Electronics',
    current_price: 70000,
    previous_close: 70000,
    market: 'domestic',
    shares_outstanding: 1000000,
    floating_shares: 800000,
  };
  db.stocks.set(STOCK_ID, stock);
  db.addStockToIndex(stock);

  const buyerProfile: ProfileRecord = {
    id: BUYER_ID,
    user_id: BUYER_ID,
    cash: 10_000_000,
    net_worth: 10_000_000,
  };
  db.profiles.set(BUYER_ID, buyerProfile);
  db.profileUserIdIndex.set(BUYER_ID, BUYER_ID);

  const sellerProfile: ProfileRecord = {
    id: SELLER_ID,
    user_id: SELLER_ID,
    cash: 1_000_000,
    net_worth: 8_000_000,
  };
  db.profiles.set(SELLER_ID, sellerProfile);
  db.profileUserIdIndex.set(SELLER_ID, SELLER_ID);

  const sellerHolding: HoldingRecord = {
    id: `${SELLER_ID}_${STOCK_ID}`,
    user_id: SELLER_ID,
    stock_id: STOCK_ID,
    quantity: 100,
    avg_price: 68000,
  };
  db.holdings.set(sellerHolding.id, sellerHolding);
  db.addHoldingToIndex(sellerHolding);

  // Pre-seed matching resting orders
  const buyOrder: OrderRecord = {
    id: 'ord_buy_test_1',
    stock_id: STOCK_ID,
    user_id: BUYER_ID,
    side: 'buy',
    price: 70000,
    size: 10,
    originalQuantity: 10,
    filledQuantity: 0,
    remainingQuantity: 10,
    status: 'open',
    is_lp: false,
    version: 1,
    created_at: new Date(NOW).toISOString(),
  };
  db.orders.set(buyOrder.id, buyOrder);
  db.addOrderToIndex(buyOrder);

  const sellOrder: OrderRecord = {
    id: 'ord_sell_test_1',
    stock_id: STOCK_ID,
    user_id: SELLER_ID,
    side: 'sell',
    price: 70000,
    size: 10,
    originalQuantity: 10,
    filledQuantity: 0,
    remainingQuantity: 10,
    status: 'open',
    is_lp: false,
    version: 1,
    created_at: new Date(NOW).toISOString(),
  };
  db.orders.set(sellOrder.id, sellOrder);
  db.addOrderToIndex(sellOrder);

  const repositories = createInMemoryRepositoryBundle(db);
  const simContext = createSimulationContext({ seed: 42, clock: new StaticTimeSource(NOW) });

  const fixedDataSource = {
    fetchMarketState: async () => ({
      stocks: [{ id: STOCK_ID, current_price: 70000, previous_close: 70000, volume: 10000 }],
      bonds: [],
      commodities: [],
      options_contracts: [],
      adminBaseRate: 0.03,
      sentiment: 'NEUTRAL',
      orderBook: {},
      realWorldMacro: { us10yYield: 3.5, vix: 15, brentOil: 80, dxyIndex: 103 },
      activeEvents: [],
      fundamentals: {},
    }),
    fetchRealWorldData: async () => ({ us10yYield: 3.5, vix: 15, brentOil: 80, dxyIndex: 103 }),
  };

  const engine = new MarketEngine({
    simulationContext: simContext,
    repositories,
    marketDataSource: fixedDataSource as any,
    executionObserver: new NoopObserver(),
  });

  return { engine, db };
}

async function run() {
  console.log('--- Testing P0 Post-Commit Error vs Split-Brain Prevention ---');
  const { engine, db } = await setupEngine();

  // Force commodityEngine.nextTick to throw to simulate a post-commit projection failure
  (engine as any).commodityEngine.nextTick = () => {
    throw new Error('SIMULATED_COMMODITY_FAILURE');
  };

  const tickResult = await engine.tick();

  console.log('Tick result:', {
    success: tickResult.success,
    commitStatus: (tickResult as any).commitStatus,
    tickCount: tickResult.tickCount,
    postCommitWarnings: (tickResult as any).postCommitWarnings?.length,
  });

  // Authoritative settlement succeeded: trade must be committed in DB
  assert.strictEqual(db.settlementLedger.size, 1, 'Settlement ledger must record 1 settled trade');
  assert.strictEqual(db.trades.length, 1, 'Trade record must be committed to DB');

  // Requirements:
  // 1. tickResult must NOT report failure when authoritative state is already committed!
  assert.strictEqual(tickResult.success, true, 'Tick must succeed when authoritative settlement is COMMITTED');
  assert.strictEqual((tickResult as any).commitStatus, 'COMMITTED', "commitStatus must be 'COMMITTED'");

  // 2. tickCount must NOT be rolled back to 0!
  assert.strictEqual(tickResult.tickCount, 1, 'tickCount must remain advanced to 1, not rolled back');

  // 3. Post-commit error must be captured in postCommitWarnings
  const warnings = (tickResult as any).postCommitWarnings;
  assert.ok(Array.isArray(warnings) && warnings.length > 0, 'postCommitWarnings must contain warnings');
  assert.ok(
    warnings.some((w: any) => w.stage === 'COMMODITY_ENGINE_TICK' || String(w.message).includes('SIMULATED_COMMODITY_FAILURE')),
    'Warning must contain commodity engine failure'
  );

  console.log('✅ [PASS] Post-commit error reports COMMITTED and preserves tickCount without split-brain');

  // 4. Exactly-once: executing a subsequent tick does not re-settle or duplicate
  const secondTick = await engine.tick();
  assert.strictEqual(db.settlementLedger.size, 1, 'Subsequent tick must not duplicate trade settlement');
  assert.strictEqual(db.trades.length, 1, 'Total settled trades remains exactly 1');
  console.log('✅ [PASS] Exactly-once verified: no duplicate settlement on subsequent tick');

  console.log('\n🎉 ALL POST-COMMIT SPLIT-BRAIN TESTS PASSED!\n');
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
