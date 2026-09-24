/**
 * Test Suite: Phase 1 Market Abuse Safety & Isolation
 *
 * Verifies:
 * 1. Missing ENABLE_MARKET_ABUSE_SCENARIOS rejects spoofing
 * 2. Case variations ('True', 'TRUE') or numeric strings ('1') fail-closed
 * 3. Exact 'true' enables spoofing
 * 4. Normal PropDeskAgent execution under default settings produces 0 spoof orders
 */

import assert from 'assert';
import { isMarketAbuseScenarioEnabled } from '../engine-server/src/simulation/featureFlags';
import { PropDeskAgent } from '../engine-server/src/bots/PropDeskAgent';
import { createSimulationContext } from '../lib/engine/simulation/runtime';

function testFlagValidationVariations() {
  const orig = process.env.ENABLE_MARKET_ABUSE_SCENARIOS;
  try {
    delete process.env.ENABLE_MARKET_ABUSE_SCENARIOS;
    assert.strictEqual(isMarketAbuseScenarioEnabled(), false);

    const falsyValues = ['false', 'False', 'FALSE', '1', '0', 'yes', 'TRUE', 'True', ' true', 'true '];
    for (const val of falsyValues) {
      process.env.ENABLE_MARKET_ABUSE_SCENARIOS = val;
      assert.strictEqual(
        isMarketAbuseScenarioEnabled(),
        false,
        `Expected value "${val}" to fail-closed and return false`
      );
    }

    process.env.ENABLE_MARKET_ABUSE_SCENARIOS = 'true';
    assert.strictEqual(isMarketAbuseScenarioEnabled(), true, 'Exact "true" must return true');
  } finally {
    if (orig !== undefined) {
      process.env.ENABLE_MARKET_ABUSE_SCENARIOS = orig;
    } else {
      delete process.env.ENABLE_MARKET_ABUSE_SCENARIOS;
    }
  }
}

function testPropDeskDefaultProducesZeroSpoofs() {
  const orig = process.env.ENABLE_MARKET_ABUSE_SCENARIOS;
  try {
    delete process.env.ENABLE_MARKET_ABUSE_SCENARIOS; // Default production state

    const ctx = createSimulationContext({ seed: 777 });
    const bot = new PropDeskAgent({
      id: 'prop_test',
      name: 'Prop Desk Safety Test',
      type: 'PROP_DESK',
      capital: 100000000000
    } as any, ctx);

    const stock = {
      id: '0010',
      name: '오성전자',
      current_price: 70000,
      previous_close: 70000
    };

    const market = {
      stocks: [stock],
      activeEvents: []
    };

    const orderBook = {
      '0010': {
        bids: [{ price: 69900, size: 500 }],
        asks: [{ price: 70100, size: 500 }]
      }
    };

    // Run 50 ticks of market making
    for (let i = 0; i < 50; i++) {
      const orders = bot.executeMarketMaking(market, orderBook, {});
      for (const order of orders) {
        assert.notStrictEqual(
          order.is_spoof,
          true,
          'PropDeskAgent must NEVER issue spoof orders when ENABLE_MARKET_ABUSE_SCENARIOS is not enabled'
        );
      }
    }
  } finally {
    if (orig !== undefined) {
      process.env.ENABLE_MARKET_ABUSE_SCENARIOS = orig;
    } else {
      delete process.env.ENABLE_MARKET_ABUSE_SCENARIOS;
    }
  }
}

function testMarketAbuseDisabledZeroInterference() {
  const orig = process.env.ENABLE_MARKET_ABUSE_SCENARIOS;
  try {
    delete process.env.ENABLE_MARKET_ABUSE_SCENARIOS;

    const seed = 54321;
    // Execution 1: Flag disabled (default)
    const ctx1 = createSimulationContext({ seed });
    const bot1 = new PropDeskAgent({
      id: 'prop_interference_test',
      name: 'Prop Desk Zero Interference',
      type: 'PROP_DESK',
      capital: 100000000000
    } as any, ctx1);

    // Execution 2: Reference execution with identical seed
    const ctx2 = createSimulationContext({ seed });
    const bot2 = new PropDeskAgent({
      id: 'prop_interference_test',
      name: 'Prop Desk Zero Interference',
      type: 'PROP_DESK',
      capital: 100000000000
    } as any, ctx2);

    const stock = { id: '0010', name: '오성전자', current_price: 70000, previous_close: 70000 };
    const market = { stocks: [stock], activeEvents: [] };
    const orderBook = {
      '0010': {
        bids: [{ price: 69900, size: 500 }],
        asks: [{ price: 70100, size: 500 }]
      }
    };

    const ordersRun1: any[] = [];
    const ordersRun2: any[] = [];

    for (let i = 0; i < 30; i++) {
      ordersRun1.push(bot1.executeMarketMaking(market, orderBook, {}));
      ordersRun2.push(bot2.executeMarketMaking(market, orderBook, {}));
    }

    assert.deepStrictEqual(ordersRun1, ordersRun2, 'Orders between identical disabled runs must match 100%');
    assert.strictEqual(
      (bot1 as any).activeSpoofOrders.length,
      0,
      'Disabled flag must never accumulate active spoof orders'
    );
    assert.strictEqual(
      (bot2 as any).activeSpoofOrders.length,
      0,
      'Disabled flag must never accumulate active spoof orders'
    );
  } finally {
    if (orig !== undefined) {
      process.env.ENABLE_MARKET_ABUSE_SCENARIOS = orig;
    } else {
      delete process.env.ENABLE_MARKET_ABUSE_SCENARIOS;
    }
  }
}

function runAll() {
  console.log('Running testFlagValidationVariations...');
  testFlagValidationVariations();
  console.log('Running testPropDeskDefaultProducesZeroSpoofs...');
  testPropDeskDefaultProducesZeroSpoofs();
  console.log('Running testMarketAbuseDisabledZeroInterference...');
  testMarketAbuseDisabledZeroInterference();
  console.log('✅ All Phase 1 Market Abuse Safety tests passed!');
}

runAll();
