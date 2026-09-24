/**
 * Phase 0 Baseline Test Suite for STOCKSYS
 *
 * Verifies:
 * 1. Legacy Child Order Safety constraints (5M KRW, 5K shares, 10% depth, KRX tick alignment)
 * 2. Market Abuse scenario fail-closed feature flag
 * 3. BaseAgent integration with legacyOrderSafety and featureFlags
 */

import assert from 'assert';
import {
  applyLegacyChildOrderSafetyLimits,
  getLegacyTickSize,
  alignToLegacyTickSize,
  LEGACY_CHILD_ORDER_LIMITS
} from '../engine-server/src/risk/legacyOrderSafety';
import { isMarketAbuseScenarioEnabled } from '../engine-server/src/simulation/featureFlags';
import { BaseAgent } from '../engine-server/src/bots/BaseAgent';

function testTickSize() {
  assert.strictEqual(getLegacyTickSize(1500), 1);
  assert.strictEqual(getLegacyTickSize(2500), 5);
  assert.strictEqual(getLegacyTickSize(12000), 10);
  assert.strictEqual(getLegacyTickSize(35000), 50);
  assert.strictEqual(getLegacyTickSize(120000), 100);
  assert.strictEqual(getLegacyTickSize(350000), 500);
  assert.strictEqual(getLegacyTickSize(700000), 1000);

  assert.strictEqual(alignToLegacyTickSize(1502.3), 1502);
  assert.strictEqual(alignToLegacyTickSize(2003), 2005);
  assert.strictEqual(alignToLegacyTickSize(21123), 21100);
}

function testLegacyChildOrderLimits() {
  // Test 1: Excessive Notional (100,000 KRW stock, 100 shares = 10,000,000 KRW -> capped to 50 shares = 5,000,000 KRW)
  const order1 = applyLegacyChildOrderSafetyLimits(
    { side: 'buy', price: 100000, size: 100 },
    100000,
    100000
  );
  assert(order1, 'order1 must not be undefined');
  assert.strictEqual(order1.size, 50, 'Notional cap of 5,000,000 KRW must limit shares to 50');
  assert.strictEqual(order1.price, 100000);

  // Test 2: Excessive Shares (1,000 KRW stock, 10,000 shares -> capped to 5,000 shares)
  const order2 = applyLegacyChildOrderSafetyLimits(
    { side: 'buy', price: 1000, size: 10000 },
    1000,
    1000000
  );
  assert(order2, 'order2 must not be undefined');
  assert.strictEqual(order2.size, 5000, 'Max shares cap of 5,000 must limit shares');

  // Test 3: LOB Depth Ratio Cap (10% of 200 shares depth = 20 shares)
  const order3 = applyLegacyChildOrderSafetyLimits(
    { side: 'buy', price: 10000, size: 50 },
    10000,
    200
  );
  assert(order3, 'order3 must not be undefined');
  assert.strictEqual(order3.size, 20, 'LOB Depth cap of 10% must limit shares to 20');

  // Test 4: Tick alignment on raw price
  const order4 = applyLegacyChildOrderSafetyLimits(
    { side: 'sell', price: 54321, size: 10 },
    54321,
    50000
  );
  assert(order4, 'order4 must not be undefined');
  assert.strictEqual(order4.price, 54300, 'Price must be aligned to 100 KRW tick ladder');
}

function testMarketAbuseFeatureFlags() {
  const origEnv = process.env.ENABLE_MARKET_ABUSE_SCENARIOS;
  try {
    delete process.env.ENABLE_MARKET_ABUSE_SCENARIOS;
    assert.strictEqual(isMarketAbuseScenarioEnabled(), false, 'Missing env must be false');

    process.env.ENABLE_MARKET_ABUSE_SCENARIOS = 'false';
    assert.strictEqual(isMarketAbuseScenarioEnabled(), false, '"false" must be false');

    process.env.ENABLE_MARKET_ABUSE_SCENARIOS = '1';
    assert.strictEqual(isMarketAbuseScenarioEnabled(), false, '"1" must be false');

    process.env.ENABLE_MARKET_ABUSE_SCENARIOS = 'True';
    assert.strictEqual(isMarketAbuseScenarioEnabled(), false, '"True" must be false');

    process.env.ENABLE_MARKET_ABUSE_SCENARIOS = 'TRUE';
    assert.strictEqual(isMarketAbuseScenarioEnabled(), false, '"TRUE" must be false');

    process.env.ENABLE_MARKET_ABUSE_SCENARIOS = 'true';
    assert.strictEqual(isMarketAbuseScenarioEnabled(), true, 'Exact "true" must be true');
  } finally {
    if (origEnv !== undefined) {
      process.env.ENABLE_MARKET_ABUSE_SCENARIOS = origEnv;
    } else {
      delete process.env.ENABLE_MARKET_ABUSE_SCENARIOS;
    }
  }
}

function testBaseAgentSafetyIntegration() {
  const origEnv = process.env.ENABLE_MARKET_ABUSE_SCENARIOS;
  try {
    delete process.env.ENABLE_MARKET_ABUSE_SCENARIOS;
    const agent = new BaseAgent({ id: 'test_agent', capital: 100000000 });

    // 1. applyInstitutionalRiskControls calls canonical legacyOrderSafety
    const controlledOrder = agent.applyInstitutionalRiskControls(
      { side: 'buy', price: 100000, size: 200 },
      100000
    );
    assert.strictEqual(controlledOrder.size, 50, 'BaseAgent must enforce 5M KRW limit');

    // 2. Spoofing is disabled when feature flag is off
    const spoof = agent.executeSpoofLayering({ id: '0010', current_price: 70000 }, 'buy', 2, 8.0, 1);
    assert.strictEqual(spoof, null, 'executeSpoofLayering must return null when flag is disabled');

    // 3. Spoofing is allowed only when feature flag is explicitly 'true'
    process.env.ENABLE_MARKET_ABUSE_SCENARIOS = 'true';
    const activeSpoof = agent.executeSpoofLayering({ id: '0010', current_price: 70000 }, 'buy', 2, 8.0, 1);
    assert.notStrictEqual(activeSpoof, null, 'executeSpoofLayering should return order when flag is true');
    assert.strictEqual(activeSpoof.is_spoof, true);
  } finally {
    if (origEnv !== undefined) {
      process.env.ENABLE_MARKET_ABUSE_SCENARIOS = origEnv;
    } else {
      delete process.env.ENABLE_MARKET_ABUSE_SCENARIOS;
    }
  }
}

function runAll() {
  console.log('Running testTickSize...');
  testTickSize();
  console.log('Running testLegacyChildOrderLimits...');
  testLegacyChildOrderLimits();
  console.log('Running testMarketAbuseFeatureFlags...');
  testMarketAbuseFeatureFlags();
  console.log('Running testBaseAgentSafetyIntegration...');
  testBaseAgentSafetyIntegration();
  console.log('✅ All Phase 0 Baseline tests passed successfully!');
}

runAll();
