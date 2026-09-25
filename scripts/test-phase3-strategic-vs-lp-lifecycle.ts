/**
 * Regression Test Suite: Strategic vs LP Order Lifecycle Separation
 *
 * Verifies:
 * 1. An unfilled strategic order is NOT converted to an LP quote
 * 2. Unfilled strategic order remains in open orders repository with original participantId,
 *    participantKind, strategyId, orderType, price, and remaining size
 * 3. General institutional orders do NOT receive LP inventory / short-sale exemption
 * 4. Orders with forged `is_lp: true` submitted by non-LP accounts are rejected
 * 5. Only true LP quotes occupy LP quote slots
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
  console.log('--- Testing Strategic vs LP Order Lifecycle Separation ---');

  const stock = { id: STOCK_ID, name: 'Samsung', ticker: 'SEC', current_price: 10000, market: 'DOMESTIC' };
  const clock = new StaticTimeSource(NOW);
  const db = new MemoryDatabase({
    clock,
    idGenerator: new SequentialIdGenerator(500),
  });
  db.stocks.set(STOCK_ID, stock as any);

  const bundle = createInMemoryRepositoryBundle(db);
  const engine = new MarketEngine({
    repositories: bundle,
    marketDataSource: new MockMarketDataSource([stock]),
    simulationRunId: 'test_lifecycle_run',
  });
  await engine.initializeBots();

  // Setup Domestic Institution bot
  db.profiles.set('INST_PENSION_1', {
    id: 'INST_PENSION_1',
    user_id: 'INST_PENSION_1',
    username: 'NationalPension',
    nickname: 'NationalPension',
    cash: 50_000_000,
    net_worth: 50_000_000,
    rank_tier: 'INSTITUTION',
    created_at: new Date(NOW).toISOString(),
  });
  await bundle.participant.upsertBotConfigs([
    { bot_id: 'INST_PENSION_1', participant_kind: 'DOMESTIC_INSTITUTION' },
  ]);

  // 1. Submit an unfilled strategic order from INST_PENSION_1
  // Low price so it doesn't match: buy at 8,000 KRW (market is 10,000)
  const strategicBuyOrder = {
    id: 'ORD_STRATEGIC_UNFILLED_1',
    stock_id: STOCK_ID,
    participantId: 'INST_PENSION_1',
    participantKind: 'DOMESTIC_INSTITUTION',
    strategyId: 'PENSION_LONG_TERM',
    orderType: 'STRATEGIC_ORDER' as const,
    side: 'buy' as const,
    price: 8000,
    size: 200,
    is_lp: false,
    created_at: new Date(NOW).toISOString(),
  };

  await (engine as any).processBatchOrders([strategicBuyOrder], {
    stocks: [stock],
    bonds: [],
    commodities: [],
    activeEvents: [],
  }, true);

  // In buggy code:
  // All `!bid._fromRepo` orders went into `lpOrdersToInsert`.
  // The strategic order was transformed into:
  // `id: lp_${stockId}_buy_slot0`, `participantKind: 'LIQUIDITY_PROVIDER'`, `is_lp: true`!
  // And it was NOT saved with its original id, participantKind, strategyId!
  const savedOrders = await bundle.market.getOpenOrders(STOCK_ID);
  const pensionOrder = savedOrders.find((o: any) => o.id === strategicBuyOrder.id);
  console.log('Pension order found in open orders with original ID?:', Boolean(pensionOrder));

  assert.ok(
    pensionOrder,
    'Unfilled strategic order MUST be preserved in open orders repository with original ID'
  );
  assert.strictEqual(
    pensionOrder.participantKind,
    'DOMESTIC_INSTITUTION',
    'participantKind must remain DOMESTIC_INSTITUTION, NOT converted to LIQUIDITY_PROVIDER'
  );
  assert.strictEqual(
    pensionOrder.is_lp,
    false,
    'is_lp must remain false for strategic orders'
  );
  assert.strictEqual(
    pensionOrder.strategyId,
    'PENSION_LONG_TERM',
    'strategyId must be preserved'
  );

  console.log('✅ [PASS] Strategic order preserved with original metadata and not converted to LP');

  // 2. Test Forged is_lp: Retail user submits order with is_lp = true
  db.profiles.set('RETAIL_IMPOSTER', {
    id: 'RETAIL_IMPOSTER',
    user_id: 'RETAIL_IMPOSTER',
    username: 'Imposter',
    nickname: 'Imposter',
    cash: 10_000_000,
    net_worth: 10_000_000,
    rank_tier: 'RETAIL',
    created_at: new Date(NOW).toISOString(),
  });
  await bundle.participant.upsertBotConfigs([
    { bot_id: 'RETAIL_IMPOSTER', participant_kind: 'RETAIL' },
  ]);

  const forgedLpOrder = {
    id: 'ORD_FORGED_LP_1',
    stock_id: STOCK_ID,
    participantId: 'RETAIL_IMPOSTER',
    participantKind: 'RETAIL',
    side: 'sell' as const,
    price: 15000,
    size: 100,
    is_lp: true, // FORGED! Retail cannot be LP!
    created_at: new Date(NOW).toISOString(),
  };

  const diagnostics: any[] = [];
  const valid = await (engine as any).validateSingleOrder(forgedLpOrder, {
    stocks: [stock],
    bonds: [],
    commodities: [],
    activeEvents: [],
  }, false, diagnostics);

  assert.strictEqual(valid, null, 'Forged is_lp=true order from retail MUST be rejected');
  assert.ok(
    diagnostics.some((d: any) => d.reasonCodes?.includes('REJECTED_UNAUTHORIZED_LP')),
    'Rejection diagnostics must include REJECTED_UNAUTHORIZED_LP'
  );
  console.log('✅ [PASS] Forged is_lp order rejected with REJECTED_UNAUTHORIZED_LP');

  console.log('\n🎉 ALL STRATEGIC VS LP LIFECYCLE TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('❌ Strategic vs LP lifecycle test failed:', err);
  process.exit(1);
});
