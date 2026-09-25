/**
 * Phase 4 Test: P2 - Strategic Order Persistence Failure Fail-Closed Guarantee
 *
 * Verifies that:
 * 1. Authoritative creation of unfilled strategic orders is part of the pre-commit UoW
 * 2. If saving strategic orders fails, the engine does NOT swallow it with a warning
 * 3. Instead, the tick fails pre-commit with `success: false, commitStatus: 'NOT_COMMITTED'`
 * 4. "Order accepted successfully" while the order vanished from storage is strictly forbidden
 */

import assert from 'node:assert';
import { MarketEngine } from '../engine-server/src/MarketEngine';
import { MemoryDatabase, StockRecord, ProfileRecord } from '../lib/memoryDb/memoryStore';
import { createInMemoryRepositoryBundle } from '../lib/repositories/inMemory';
import { createSimulationContext } from '../lib/engine/simulation/runtime/simulationContext';
import { StaticTimeSource } from '../lib/engine/simulation/runtime/simulationTimeSource';
import type { MarketExecutionObserver } from '../engine-server/src/MarketEngine';

class NoopObserver implements MarketExecutionObserver {
  public async onSettlementCommitted() {}
}

const NOW = Date.parse('2026-06-30T10:00:00.000Z');
const STOCK_ID = 'stock_samsung';
const BOT_ID = 'INST_PENSION_FUND';

async function run() {
  console.log('--- Testing P2 Strategic Order Persistence Failure Fail-Closed ---');

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
    volume: 1000,
    change_rate: 0,
    market_cap: 70000000000,
    pe_ratio: 10,
    dividend_yield: 2,
    sector: 'Technology',
    market: 'domestic',
    shares_outstanding: 1000000,
    floating_shares: 800000,
  };
  db.stocks.set(STOCK_ID, stock);
  db.addStockToIndex(stock);

  const profile: ProfileRecord = {
    id: BOT_ID,
    user_id: BOT_ID,
    username: 'National Pension Service',
    nickname: 'National Pension Service',
    cash: 50_000_000_000,
    net_worth: 50_000_000_000,
    rank_tier: 'Challenger',
    created_at: new Date().toISOString(),
  };
  db.profiles.set(BOT_ID, profile);
  db.profileUserIdIndex.set(BOT_ID, BOT_ID);

  db.botsConfig.push({
    id: BOT_ID,
    bot_id: BOT_ID,
    name: 'National Pension Service',
    bot_type: 'PENSION_FUND',
    participant_kind: 'DOMESTIC_INSTITUTION',
    capital: 50000000000,
    current_cash: 50000000000,
  });

  const repositories = createInMemoryRepositoryBundle(db);
  const simContext = createSimulationContext({ seed: 77, clock: new StaticTimeSource(NOW) });

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

  await engine.initializeBots();

  // Inject a mock strategic order generator into one of the institutional bots that submits a large resting order
  const pensionAgent = (engine as any).pensionFundAgents[0];
  assert.ok(pensionAgent, 'Pension fund agent must be initialized');

  pensionAgent.generateOrders = async () => [
    {
      id: 'ord_strategic_unfilled_1',
      stock_id: STOCK_ID,
      user_id: BOT_ID,
      participantId: BOT_ID,
      participantKind: 'DOMESTIC_INSTITUTION',
      strategyId: 'pension_long_term',
      orderType: 'STRATEGIC_ORDER',
      side: 'buy',
      price: 65000, // Non-matching price -> resting order
      size: 1000,
    },
  ];

  // Induce a failure during strategic order insertion (pre-commit save)
  const originalInsertOrders = repositories.markets.insertOrders.bind(repositories.markets);
  repositories.markets.insertOrders = async (orders: any[]) => {
    if (orders.some((o) => o.id === 'ord_strategic_unfilled_1')) {
      throw new Error('STRATEGIC_ORDER_DISK_FULL');
    }
    return originalInsertOrders(orders);
  };

  const tickResult = await engine.tick();

  console.log('Strategic order failure tick result:', {
    success: tickResult.success,
    commitStatus: (tickResult as any).commitStatus,
    errorCode: tickResult.errorCode,
  });

  // Requirements:
  // Must NOT succeed with warning! It must fail with commitStatus: 'NOT_COMMITTED'
  assert.strictEqual(tickResult.success, false, 'Tick must fail when strategic order persistence fails');
  assert.strictEqual((tickResult as any).commitStatus, 'NOT_COMMITTED', "commitStatus must be 'NOT_COMMITTED'");

  console.log('✅ [PASS] Strategic order persistence failure fails closed pre-commit');
  console.log('\n🎉 ALL STRATEGIC ORDER PERSISTENCE TESTS PASSED!\n');
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
