/**
 * Regression Test Suite: Full Runtime Deterministic State Rollback
 *
 * Verifies:
 * 1. Tick failure rolls back all runtime state:
 *    - tickCount
 *    - partialFillSequence
 *    - lpQuoteGeneration
 *    - PRNG namespace state
 *    - fundamentals
 *    - activeEvents
 *    - Hawkes intensity
 *    - SequentialIdGenerator
 * 2. Fault injected during commit:
 *    - After trade ID generation
 *    - After PRNG consumption
 * 3. Retry after rollback produces 100% bit-for-bit identical results with clean run:
 *    - trade IDs
 *    - order IDs
 *    - price history IDs
 *    - prices
 *    - fundamentals
 *    - canonical database fingerprint
 */

import assert from 'node:assert';
import { MemoryDatabase, SequentialIdGenerator } from '../lib/memoryDb/memoryStore';
import { MarketEngine } from '../engine-server/src/MarketEngine';
import { createInMemoryRepositoryBundle } from '../lib/repositories/inMemory';
import { createSimulationContext } from '../lib/engine/simulation/runtime/simulationContext';
import { StaticTimeSource } from '../lib/engine/simulation/runtime/simulationTimeSource';
import type { MarketDataSource } from '../engine-server/src/MarketEngine';
import crypto from 'node:crypto';

const NOW = Date.parse('2026-06-01T09:00:00.000Z');
const STOCK_ID = '00000000-0000-4000-8000-000000000001';

class MockMarketDataSource implements MarketDataSource {
  constructor(private readonly stocks: any[]) {}
  async fetchMarketState(): Promise<any> {
    return { stocks: this.stocks, bonds: [], commodities: [], activeEvents: [] };
  }
}

function computeFullStateFingerprint(engine: MarketEngine, db: MemoryDatabase): string {
  const hash = crypto.createHash('sha256');

  // Engine state
  const engineState = {
    tickCount: (engine as any).tickCount,
    partialFillSeq: (engine as any).partialFillSequence,
    lpQuoteGen: (engine as any).lpQuoteGeneration,
    hawkes: (engine as any).hawkesIntensity,
    fundamentals: (engine as any).fundamentals,
    events: (engine as any).activeEvents,
    prngSnap: (engine as any).simulationContext.random.snapshot(),
  };

  // DB state
  const orders = Array.from(db.orders.entries()).sort(([a], [b]) => a.localeCompare(b));
  const profiles = Array.from(db.profiles.entries()).sort(([a], [b]) => a.localeCompare(b));
  const holdings = Array.from(db.holdings.entries()).sort(([a], [b]) => a.localeCompare(b));
  const trades = [...db.trades].sort((a, b) => a.id.localeCompare(b.id));
  const priceHistory = [...db.stockPriceHistory];
  const ledger = Array.from(db.settlementLedger.entries()).sort(([a], [b]) => a.localeCompare(b));
  const idGen = db.snapshotIdGenerator();

  hash.update(JSON.stringify({
    engineState,
    orders,
    profiles,
    holdings,
    trades,
    priceHistory,
    ledger,
    idGen,
  }));
  return hash.digest('hex');
}

async function runTests() {
  console.log('--- Testing Full Runtime Deterministic Rollback ---');

  const stock = { id: STOCK_ID, name: 'Samsung', ticker: 'SEC', current_price: 10000, market: 'DOMESTIC' };

  // Setup Run A: Clean execution
  const clockA = new StaticTimeSource(NOW);
  const contextA = createSimulationContext({ seed: 777, clock: clockA });
  const dbA = new MemoryDatabase({
    clock: clockA,
    idGenerator: new SequentialIdGenerator(777),
  });
  dbA.stocks.set(STOCK_ID, stock as any);
  const bundleA = createInMemoryRepositoryBundle(dbA);
  const engineA = new MarketEngine({
    repositories: bundleA,
    marketDataSource: new MockMarketDataSource([stock]),
    simulationContext: contextA,
    simulationRunId: 'deterministic_run_777',
  });
  await engineA.initializeBots();

  // Run 1 tick cleanly on A
  const resA = await engineA.tick();
  assert.strictEqual(resA.success, true);
  const fingerprintA = computeFullStateFingerprint(engineA, dbA);

  // Setup Run B: Identical initial state, but first tick attempt experiences settlement failure
  const clockB = new StaticTimeSource(NOW);
  const contextB = createSimulationContext({ seed: 777, clock: clockB });
  const dbB = new MemoryDatabase({
    clock: clockB,
    idGenerator: new SequentialIdGenerator(777),
  });
  dbB.stocks.set(STOCK_ID, stock as any);
  const bundleB = createInMemoryRepositoryBundle(dbB);
  const engineB = new MarketEngine({
    repositories: bundleB,
    marketDataSource: new MockMarketDataSource([stock]),
    simulationContext: contextB,
    simulationRunId: 'deterministic_run_777',
  });
  await engineB.initializeBots();

  const preTickFingerprintB = computeFullStateFingerprint(engineB, dbB);

  // Inject failure into settlement repository on first attempt
  let failSettlement = true;
  const origCommit = bundleB.settlement.commitMatchedBatchAtomically.bind(bundleB.settlement);
  bundleB.settlement.commitMatchedBatchAtomically = async (batch) => {
    if (failSettlement) {
      return {
        success: false,
        settledTradesCount: 0,
        totalVolume: 0,
        totalAmount: 0,
        totalFeeAmount: 0,
        errorCode: 'FAULT_INJECTION_SETTLEMENT_REJECTED',
        error: 'Injected settlement fault',
        rollbackOccurred: true,
        settledTradeIds: [],
      };
    }
    return origCommit(batch);
  };

  const failedRes = await engineB.tick();
  assert.strictEqual(failedRes.success, false, 'First tick on B must fail');

  // Verify full engine state was rolled back to pre-tick on failure!
  const postFailFingerprintB = computeFullStateFingerprint(engineB, dbB);
  console.log('Fingerprint comparison: pre-tick vs post-fail:');
  console.log('Pre-tick:  ', preTickFingerprintB);
  console.log('Post-fail: ', postFailFingerprintB);

  assert.strictEqual(
    postFailFingerprintB,
    preTickFingerprintB,
    'Engine runtime state + database state MUST be completely rolled back to pre-tick on failure!'
  );
  console.log('✅ [PASS] Full runtime snapshot restored on tick settlement failure');

  // Now retry tick with fault cleared
  failSettlement = false;
  const retryRes = await engineB.tick();
  assert.strictEqual(retryRes.success, true, 'Retry tick on B must succeed');

  const fingerprintB = computeFullStateFingerprint(engineB, dbB);
  console.log('Fingerprint comparison: Clean Run A vs Retried Run B:');
  console.log('Run A: ', fingerprintA);
  console.log('Run B: ', fingerprintB);

  assert.strictEqual(
    fingerprintB,
    fingerprintA,
    'Retried Run B must produce 100% bit-for-bit identical fingerprint with Clean Run A!'
  );
  console.log('✅ [PASS] Bit-for-bit identical deterministic execution after fault recovery');

  console.log('\n🎉 ALL FULL RUNTIME DETERMINISTIC ROLLBACK TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('❌ Full runtime deterministic rollback test failed:', err);
  process.exit(1);
});
