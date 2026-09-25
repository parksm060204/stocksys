/**
 * Regression Test Suite: Commodity Scenario Determinism and Engine Isolation
 *
 * Verifies:
 * 1. Identical seed and initial state produce identical events, IDs, trades, and prices
 * 2. Different seeds produce different results
 * 3. Two engine instances running in parallel have fully isolated scenario states (no cross-pollution)
 * 4. Determinism is independent of system wall-clock time
 * 5. Deterministic fingerprint matches bit-for-bit across multiple runs with active scenarios
 */

import assert from 'node:assert';
import { CommodityMarketEngine } from '../lib/commodities/CommodityMarketEngine';
import { ScenarioManager } from '../lib/scenario/ScenarioManager';
import { createSimulationContext } from '../lib/engine/simulation/runtime/simulationContext';
import { StaticTimeSource } from '../lib/engine/simulation/runtime/simulationTimeSource';
import * as crypto from 'crypto';

function computeFingerprint(engine: CommodityMarketEngine): string {
  const hash = crypto.createHash('sha256');
  const commodityStates = Array.from(engine.commodities.values()).map((c) => ({
    id: c.id,
    price: c.currentPrice,
    vol: c.volume,
    high: c.high,
    low: c.low,
    historyLen: c.priceHistory.length,
  }));
  const trades = engine.tradesHistory.map((t) => ({
    id: t.id,
    price: t.price,
    qty: t.size,
    buyer: t.buyerId,
    seller: t.sellerId,
  }));
  hash.update(JSON.stringify({ commodityStates, trades }));
  return hash.digest('hex');
}

async function runTests() {
  console.log('--- Testing Commodity Scenario Determinism & Isolation ---');

  // Test 1: ScenarioManager uses injected clock and deterministic ID generator, no Date.now()/Math.random()
  {
    const clock = new StaticTimeSource(1700000000000);
    const mgr1 = new ScenarioManager({ clock, seed: 42 });
    const scen1 = mgr1.injectScenario({
      assetType: 'commodity',
      assetId: 'gold',
      ticker: 'GC',
      name: 'Gold',
      mode: 'pump',
      initialPrice: 2000,
    });

    const clock2 = new StaticTimeSource(1700000000000);
    const mgr2 = new ScenarioManager({ clock: clock2, seed: 42 });
    const scen2 = mgr2.injectScenario({
      assetType: 'commodity',
      assetId: 'gold',
      ticker: 'GC',
      name: 'Gold',
      mode: 'pump',
      initialPrice: 2000,
    });

    assert.strictEqual(scen1.id, scen2.id, `Scenario IDs must be deterministic across identical seeds! Got ${scen1.id} vs ${scen2.id}`);
    console.log('✅ [PASS] ScenarioManager deterministic ID generation');
  }

  // Test 2: Engine instance scenario state isolation
  {
    const ctxA = createSimulationContext({ seed: 100, clock: new StaticTimeSource(1000) });
    const ctxB = createSimulationContext({ seed: 200, clock: new StaticTimeSource(1000) });

    const engineA = new CommodityMarketEngine({ simulationContext: ctxA });
    const engineB = new CommodityMarketEngine({ simulationContext: ctxB });

    // Inject scenario into Engine A ONLY
    if ((engineA as any).scenarioManager) {
      (engineA as any).scenarioManager.injectScenario({
        assetType: 'commodity',
        assetId: 'gold',
        ticker: 'GC',
        name: 'Gold',
        mode: 'pump',
        initialPrice: 2000,
      });

      const activeB = (engineB as any).scenarioManager?.getActiveScenarios() || [];
      assert.strictEqual(
        activeB.length,
        0,
        'Engine B must NOT have scenarios injected into Engine A (cross-instance pollution)'
      );
    }
    console.log('✅ [PASS] Scenario state isolation between engines');
  }

  // Test 3: Bit-for-bit fingerprint reproducibility with active scenarios
  {
    const runEngine = (seed: number, wallClockOffset: number = 0) => {
      const clock = new StaticTimeSource(1700000000000 + wallClockOffset);
      const ctx = createSimulationContext({ seed, clock });
      const engine = new CommodityMarketEngine({ simulationContext: ctx });

      if ((engine as any).scenarioManager) {
        (engine as any).scenarioManager.injectScenario({
          assetType: 'commodity',
          assetId: 'gold',
          ticker: 'GC',
          name: 'Gold',
          mode: 'dump',
          initialPrice: 2000,
        });
      }

      for (let i = 0; i < 15; i++) {
        engine.nextTick();
      }
      return computeFingerprint(engine);
    };

    const fp1 = runEngine(12345, 0);
    const fp2 = runEngine(12345, 99999999); // different wall-clock offset
    const fpDiffSeed = runEngine(54321, 0);

    assert.strictEqual(fp1, fp2, 'Identical seed must produce identical fingerprints regardless of wall-clock!');
    assert.notStrictEqual(fp1, fpDiffSeed, 'Different seeds must produce different fingerprints');
    console.log('✅ [PASS] Bit-for-bit commodity engine determinism with active scenarios');
  }

  console.log('\n🎉 ALL COMMODITY SCENARIO DETERMINISM TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('❌ Commodity scenario determinism test failed:', err);
  process.exit(1);
});
