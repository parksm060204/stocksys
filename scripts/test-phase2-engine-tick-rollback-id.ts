/**
 * Regression Test Suite: MarketEngine.tick() Error Contract and ID Generator Rollback
 *
 * Verifies:
 * 1. MarketEngine.tick() does NOT swallow settlement errors; failure is explicitly propagated to caller
 * 2. On settlement failure, post-commit side effects do NOT occur
 * 3. Deterministic ID generator counter is restored on rollback
 * 4. Fault injection retry produces identical IDs and bit-for-bit identical deterministic fingerprints
 */

import assert from 'node:assert';
import { MemoryDatabase, SequentialIdGenerator } from '../lib/memoryDb/memoryStore';
import { MarketEngine } from '../engine-server/src/MarketEngine';
import { createInMemoryRepositoryBundle } from '../lib/repositories/inMemory';
import { createSimulationContext } from '../lib/engine/simulation/runtime/simulationContext';
import { StaticTimeSource } from '../lib/engine/simulation/runtime/simulationTimeSource';
import type { MarketDataSource } from '../engine-server/src/MarketEngine';

const NOW = Date.parse('2026-06-01T09:00:00.000Z');
const STOCK_ID = '00000000-0000-4000-8000-000000000001';

class FixedDataSource implements MarketDataSource {
  constructor(private readonly stocks: any[]) {}
  async fetchMarketState(): Promise<any> {
    return { stocks: this.stocks, bonds: [], commodities: [], activeEvents: [] };
  }
}

function setupEnvironment() {
  const db = new MemoryDatabase();
  const stock = {
    id: STOCK_ID,
    ticker: 'TEST_STOCK',
    name: 'Test Stock',
    market: 'domestic',
    current_price: 10_000,
    previous_close: 10_000,
    open_price: 10_000,
    high: 10_000,
    low: 10_000,
    volume: 50000,
    change_rate: 0,
    market_cap: 1_000_000_000,
    pe_ratio: 15,
    dividend_yield: 0,
    sector: 'semiconductor',
  };
  db.stocks.set(STOCK_ID, stock);

  const bundle = createInMemoryRepositoryBundle(db);
  const clock = new StaticTimeSource(NOW);
  const simContext = createSimulationContext({ seed: 999, clock });

  const engine = new MarketEngine({
    simulationContext: simContext,
    repositories: bundle,
    marketDataSource: new FixedDataSource([stock]),
  });

  return { db, bundle, engine, clock };
}

async function runTests() {
  console.log('--- Testing Engine Tick Error Contract & ID Generator Rollback ---');

  // Test 1: tick() must report failure when settlement rejects, not swallow and return void/success
  {
    const { bundle, engine } = setupEnvironment();
    await engine.initializeBots();

    // Force settlement repository to reject next batch
    const forceReject = true;
    const origCommit = bundle.settlement.commitMatchedBatchAtomically.bind(bundle.settlement);
    bundle.settlement.commitMatchedBatchAtomically = async (batch) => {
      if (forceReject) {
        return {
          success: false,
          settledTradesCount: 0,
          totalVolume: 0,
          totalAmount: 0,
          totalFeeAmount: 0,
          errorCode: 'FORCED_SETTLEMENT_REJECTION',
          error: 'Test forced rejection',
          rollbackOccurred: true,
          settledTradeIds: [],
        };
      }
      return origCommit(batch);
    };

    // On current code, tick() swallows the error in try { ... } catch and returns undefined!
    // We expect tick() to either return TickResult with success: false OR reject
    let failedExplicitly = false;
    try {
      const res: any = await engine.tick();
      if (res && res.success === false && res.errorCode === 'FORCED_SETTLEMENT_REJECTION') {
        failedExplicitly = true;
      }
    } catch (err: any) {
      if (err.message.includes('FORCED_SETTLEMENT_REJECTION') || err.message.includes('Settlement rejected')) {
        failedExplicitly = true;
      }
    }

    assert.strictEqual(
      failedExplicitly,
      true,
      'engine.tick() MUST NOT swallow settlement errors! Caller must receive explicit failure'
    );
    console.log('✅ [PASS] engine.tick() reports settlement error explicitly');
  }

  // Test 2: SequentialIdGenerator snapshot and restore
  {
    const idGen = new SequentialIdGenerator(42);
    const id1 = idGen.nextId('sph');
    assert.strictEqual(id1, 'sph_42_000001');

    const snap = (idGen as any).getSnapshot();
    const id2 = idGen.nextId('sph');
    assert.strictEqual(id2, 'sph_42_000002');

    // Restore snapshot
    (idGen as any).restoreSnapshot(snap);
    const id2AfterRestore = idGen.nextId('sph');
    assert.strictEqual(
      id2AfterRestore,
      'sph_42_000002',
      'Restored ID generator must produce identical next ID'
    );
    console.log('✅ [PASS] SequentialIdGenerator snapshot and restore');
  }

  // Test 3: Fault injection during batch commit and retry produces identical deterministic fingerprint
  {
    // Run A: Clean execution
    const dbA = new MemoryDatabase({
      clock: new StaticTimeSource(NOW),
      idGenerator: new SequentialIdGenerator(777),
    });
    const bundleA = createInMemoryRepositoryBundle(dbA);
    const orderA1 = {
      id: 'ORD_A_BUY_1',
      stock_id: STOCK_ID,
      user_id: 'USER_1',
      side: 'buy' as const,
      price: 10_000,
      size: 100,
      filled: 0,
      is_lp: false,
      status: 'open' as const,
      created_at: new Date(NOW).toISOString(),
    };
    const orderA2 = {
      id: 'ORD_A_SELL_1',
      stock_id: STOCK_ID,
      user_id: 'USER_2',
      side: 'sell' as const,
      price: 10_000,
      size: 100,
      filled: 0,
      is_lp: false,
      status: 'open' as const,
      created_at: new Date(NOW).toISOString(),
    };
    dbA.orders.set(orderA1.id, orderA1);
    dbA.orders.set(orderA2.id, orderA2);
    dbA.profiles.set('USER_1', { id: 'USER_1', user_id: 'USER_1', username: 'U1', nickname: 'U1', cash: 2_000_000, net_worth: 2_000_000, rank_tier: 'RETAIL', created_at: new Date(NOW).toISOString() });
    dbA.profiles.set('USER_2', { id: 'USER_2', user_id: 'USER_2', username: 'U2', nickname: 'U2', cash: 2_000_000, net_worth: 2_000_000, rank_tier: 'RETAIL', created_at: new Date(NOW).toISOString() });
    const holdingA = { id: `USER_2_${STOCK_ID}`, user_id: 'USER_2', stock_id: STOCK_ID, quantity: 1000, avg_price: 10000, created_at: new Date(NOW).toISOString() };
    dbA.holdings.set(holdingA.id, holdingA);
    dbA.addHoldingToIndex(holdingA);

    const cleanRes = await bundleA.settlement.commitMatchedBatchAtomically({
      trades: [
        {
          id: 'T_DET_1',
          stock_id: STOCK_ID,
          buyer_id: 'USER_1',
          seller_id: 'USER_2',
          buy_order_id: 'ORD_A_BUY_1',
          sell_order_id: 'ORD_A_SELL_1',
          buyer_is_bot: false,
          seller_is_bot: false,
          price: 10_000,
          size: 100,
          fee_rates: { buyerFeeRate: 0.001, sellerFeeRate: 0.001 },
        },
      ],
      priceHistory: [
        { stock_id: STOCK_ID, price: 10_000, recorded_at: new Date(NOW).toISOString() },
      ],
    });
    assert.strictEqual(cleanRes.success, true);
    const cleanHistoryId = dbA.stockPriceHistory[dbA.stockPriceHistory.length - 1].id;

    // Run B: Identical setup, but first attempt is injected with a failure (stale CAS) after ID reservation
    const dbB = new MemoryDatabase({
      clock: new StaticTimeSource(NOW),
      idGenerator: new SequentialIdGenerator(777),
    });
    const bundleB = createInMemoryRepositoryBundle(dbB);
    const initialHistoryCountB = dbB.stockPriceHistory.length;
    const orderB1 = {
      id: 'ORD_A_BUY_1',
      stock_id: STOCK_ID,
      user_id: 'USER_1',
      side: 'buy' as const,
      price: 10_000,
      size: 100,
      filled: 0,
      is_lp: false,
      status: 'open' as const,
      created_at: new Date(NOW).toISOString(),
    };
    const orderB2 = {
      id: 'ORD_A_SELL_1',
      stock_id: STOCK_ID,
      user_id: 'USER_2',
      side: 'sell' as const,
      price: 10_000,
      size: 100,
      filled: 0,
      is_lp: false,
      status: 'open' as const,
      created_at: new Date(NOW).toISOString(),
    };
    dbB.orders.set(orderB1.id, orderB1);
    dbB.orders.set(orderB2.id, orderB2);
    dbB.profiles.set('USER_1', { id: 'USER_1', user_id: 'USER_1', username: 'U1', nickname: 'U1', cash: 2_000_000, net_worth: 2_000_000, rank_tier: 'RETAIL', created_at: new Date(NOW).toISOString() });
    dbB.profiles.set('USER_2', { id: 'USER_2', user_id: 'USER_2', username: 'U2', nickname: 'U2', cash: 2_000_000, net_worth: 2_000_000, rank_tier: 'RETAIL', created_at: new Date(NOW).toISOString() });
    const holdingB = { id: `USER_2_${STOCK_ID}`, user_id: 'USER_2', stock_id: STOCK_ID, quantity: 1000, avg_price: 10000, created_at: new Date(NOW).toISOString() };
    dbB.holdings.set(holdingB.id, holdingB);
    dbB.addHoldingToIndex(holdingB);

    // Injected failure on attempt 1 (CAS mismatch rejects batch and forces rollback of reserved ID generator)
    const failedAttempt = await bundleB.settlement.commitMatchedBatchAtomically({
      trades: [
        {
          id: 'T_DET_1',
          stock_id: STOCK_ID,
          buyer_id: 'USER_1',
          seller_id: 'USER_2',
          buy_order_id: 'ORD_A_BUY_1',
          sell_order_id: 'ORD_A_SELL_1',
          buyer_is_bot: false,
          seller_is_bot: false,
          price: 10_000,
          size: 100,
          fee_rates: { buyerFeeRate: 0.001, sellerFeeRate: 0.001 },
        },
      ],
      priceHistory: [
        { stock_id: STOCK_ID, price: 10_000, recorded_at: new Date(NOW).toISOString() },
      ],
      orderCas: [
        { id: 'ORD_A_BUY_1', expectedRemaining: 999999 }, // Mismatch causes failure!
      ],
    });
    assert.strictEqual(failedAttempt.success, false);
    assert.strictEqual(failedAttempt.errorCode, 'ORDER_CAS_MISMATCH');
    assert.strictEqual(dbB.stockPriceHistory.length, initialHistoryCountB);

    // Attempt 2 (Retry without CAS mismatch): Must produce bit-for-bit identical history ID!
    const retryRes = await bundleB.settlement.commitMatchedBatchAtomically({
      trades: [
        {
          id: 'T_DET_1',
          stock_id: STOCK_ID,
          buyer_id: 'USER_1',
          seller_id: 'USER_2',
          buy_order_id: 'ORD_A_BUY_1',
          sell_order_id: 'ORD_A_SELL_1',
          buyer_is_bot: false,
          seller_is_bot: false,
          price: 10_000,
          size: 100,
          fee_rates: { buyerFeeRate: 0.001, sellerFeeRate: 0.001 },
        },
      ],
      priceHistory: [
        { stock_id: STOCK_ID, price: 10_000, recorded_at: new Date(NOW).toISOString() },
      ],
    });
    assert.strictEqual(retryRes.success, true);
    const retryHistoryId = dbB.stockPriceHistory[dbB.stockPriceHistory.length - 1].id;

    assert.strictEqual(
      retryHistoryId,
      cleanHistoryId,
      `Fault-injected retry ID (${retryHistoryId}) must be identical to clean execution ID (${cleanHistoryId})!`
    );
    console.log('✅ [PASS] Fault injection retry produces identical deterministic ID fingerprint');
  }

  console.log('\n🎉 ALL TICK CONTRACT & ID ROLLBACK TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('❌ Tick contract & ID rollback test failed:', err);
  process.exit(1);
});
