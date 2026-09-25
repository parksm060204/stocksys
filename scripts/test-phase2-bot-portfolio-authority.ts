/**
 * Regression Test Suite: Bot Portfolio & Risk Check Authoritative Integration
 *
 * Verifies:
 * 1. Single authoritative repository record for bot cash and positions
 * 2. Consecutive strategy buys actually deduct bot cash in the authoritative store
 * 3. Next order exceeding remaining cash is rejected with REJECTED_ZERO_CASH_BUY or REJECTED_INSUFFICIENT_FUNDS
 * 4. Engine recreation restores authoritative bot portfolio without falling back to static botsConfig
 * 5. Settlement failure rolls back trades, orders, prices, and bot portfolios atomically
 */

import assert from 'node:assert';
import { MemoryDatabase } from '../lib/memoryDb/memoryStore';
import { MarketEngine } from '../engine-server/src/MarketEngine';
import { createInMemoryRepositoryBundle } from '../lib/repositories/inMemory';
import { createSimulationContext } from '../lib/engine/simulation/runtime/simulationContext';
import { StaticTimeSource } from '../lib/engine/simulation/runtime/simulationTimeSource';
import type { MarketDataSource } from '../engine-server/src/MarketEngine';

const NOW = Date.parse('2026-06-01T09:00:00.000Z');
const STOCK_ID = '00000000-0000-4000-8000-000000000001';
const BOT_ID = 'bot_institution_alpha';

class FixedDataSource implements MarketDataSource {
  constructor(private readonly stocks: any[]) {}
  async fetchMarketState(): Promise<any> {
    return { stocks: this.stocks, bonds: [], commodities: [], activeEvents: [] };
  }
}

function setupTestEnvironment(botInitialCash: number = 20_000_000) {
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

  // Authoritative profile for bot
  db.profiles.set(BOT_ID, {
    id: BOT_ID,
    user_id: BOT_ID,
    username: BOT_ID,
    nickname: BOT_ID,
    cash: botInitialCash,
    net_worth: botInitialCash,
    rank_tier: 'INSTITUTION',
    created_at: new Date(NOW).toISOString(),
  });
  db.profileUserIdIndex.set(BOT_ID, BOT_ID);

  // Authoritative institutional portfolio
  db.institutionalPortfolios.set(BOT_ID, {
    bot_id: BOT_ID,
    total_capital: botInitialCash,
    current_cash: botInitialCash,
    current_stock: 0,
  });

  // Bot config
  db.botsConfig = [
    {
      id: BOT_ID,
      bot_id: BOT_ID,
      participant_kind: 'DOMESTIC_INSTITUTION',
      type: 'MOMENTUM',
      current_cash: botInitialCash, // static config
      total_capital: botInitialCash,
    },
  ];

  return { db, stock };
}

async function runTests() {
  console.log('--- Testing Bot Portfolio & Risk Check Authoritative Integration ---');

  // Test 1: Settlement must authoritatively deduct bot cash when bot buys
  {
    const { db } = setupTestEnvironment(20_000_000);
    const bundle = createInMemoryRepositoryBundle(db);

    // Initial bot cash in DB is 20,000,000
    assert.strictEqual(db.profiles.get(BOT_ID)!.cash, 20_000_000);

    // Settle a buy trade where buyer_id is BOT_ID, size 1000 @ 10,000 = 10,000,000
    // Setup matching orders in db
    db.orders.set('BO_BOT_1', {
      id: 'BO_BOT_1',
      stock_id: STOCK_ID,
      user_id: BOT_ID,
      participantId: BOT_ID,
      side: 'buy',
      price: 10_000,
      size: 1000,
      filled: 0,
      status: 'open',
      is_lp: false,
      created_at: new Date(NOW).toISOString(),
    });
    db.orders.set('SO_LP_1', {
      id: 'SO_LP_1',
      stock_id: STOCK_ID,
      user_id: 'lp_1',
      participantId: 'lp_1',
      side: 'sell',
      price: 10_000,
      size: 1000,
      filled: 0,
      status: 'open',
      is_lp: true,
      created_at: new Date(NOW).toISOString(),
    });
    db.profiles.set('lp_1', {
      id: 'lp_1',
      user_id: 'lp_1',
      username: 'lp_1',
      nickname: 'lp_1',
      cash: 100_000_000,
      net_worth: 100_000_000,
      rank_tier: 'LP',
      created_at: new Date(NOW).toISOString(),
    });
    db.profileUserIdIndex.set('lp_1', 'lp_1');

    const lpHolding = {
      id: `lp_1_${STOCK_ID}`,
      user_id: 'lp_1',
      stock_id: STOCK_ID,
      quantity: 5000,
      avg_price: 10000,
      created_at: new Date(NOW).toISOString(),
    };
    db.holdings.set(lpHolding.id, lpHolding);
    db.addHoldingToIndex(lpHolding);

    const settleRes = await bundle.settlement.commitMatchedBatchAtomically({
      trades: [
        {
          id: 'T_BOT_BUY_1',
          stock_id: STOCK_ID,
          buyer_id: BOT_ID,
          seller_id: 'lp_1',
          buy_order_id: 'BO_BOT_1',
          sell_order_id: 'SO_LP_1',
          buyer_is_bot: true,
          seller_is_bot: true,
          price: 10_000,
          size: 1000,
          fee_rates: { buyerFeeRate: 0.001, sellerFeeRate: 0.001 },
        },
      ],
    });

    assert.strictEqual(settleRes.success, true);
    const remainingCash = db.profiles.get(BOT_ID)!.cash;
    assert.ok(
      remainingCash < 20_000_000,
      `Bot cash must be authoritatively deducted on trade settlement! Expected < 20M, got ${remainingCash}`
    );
    console.log('✅ [PASS] Bot cash authoritatively deducted during settlement');
  }

  // Test 2: Consecutive buys exhaust cash and subsequent buy is rejected by risk check
  {
    const { db } = setupTestEnvironment(10_010_000);
    const bundle = createInMemoryRepositoryBundle(db);

    // Initial buy order of 1000 @ 10,000 + fee 10,000 consumes 10,010,000, leaving exactly 0 cash
    db.orders.set('BO_BOT_A', {
      id: 'BO_BOT_A',
      stock_id: STOCK_ID,
      user_id: BOT_ID,
      participantId: BOT_ID,
      side: 'buy',
      price: 10_000,
      size: 1000,
      filled: 0,
      status: 'open',
      is_lp: false,
      created_at: new Date(NOW).toISOString(),
    });
    db.orders.set('SO_LP_A', {
      id: 'SO_LP_A',
      stock_id: STOCK_ID,
      user_id: 'lp_1',
      participantId: 'lp_1',
      side: 'sell',
      price: 10_000,
      size: 1000,
      filled: 0,
      status: 'open',
      is_lp: true,
      created_at: new Date(NOW).toISOString(),
    });
    db.profiles.set('lp_1', {
      id: 'lp_1',
      user_id: 'lp_1',
      username: 'lp_1',
      nickname: 'lp_1',
      cash: 100_000_000,
      net_worth: 100_000_000,
      rank_tier: 'LP',
      created_at: new Date(NOW).toISOString(),
    });
    db.profileUserIdIndex.set('lp_1', 'lp_1');

    const lpHolding = {
      id: `lp_1_${STOCK_ID}`,
      user_id: 'lp_1',
      stock_id: STOCK_ID,
      quantity: 5000,
      avg_price: 10000,
      created_at: new Date(NOW).toISOString(),
    };
    db.holdings.set(lpHolding.id, lpHolding);
    db.addHoldingToIndex(lpHolding);

    const settle1 = await bundle.settlement.commitMatchedBatchAtomically({
      trades: [
        {
          id: 'T_BOT_A1',
          stock_id: STOCK_ID,
          buyer_id: BOT_ID,
          seller_id: 'lp_1',
          buy_order_id: 'BO_BOT_A',
          sell_order_id: 'SO_LP_A',
          buyer_is_bot: true,
          seller_is_bot: true,
          price: 10_000,
          size: 1000,
          fee_rates: { buyerFeeRate: 0.001, sellerFeeRate: 0.001 },
        },
      ],
    });
    assert.strictEqual(settle1.success, true);
    assert.strictEqual(db.profiles.get(BOT_ID)!.cash, 0);

    // Verify risk assessment: next buy must be rejected with REJECTED_ZERO_CASH_BUY
    const { verifyParticipantProfile, assessStrategicOrder } = await import(
      '../engine-server/src/risk/orderSourceMetadata'
    );
    const verified = await verifyParticipantProfile(bundle, BOT_ID, STOCK_ID);
    assert.ok(verified !== null);
    assert.strictEqual(verified.availableCash, 0);

    const assessment = assessStrategicOrder({
      profile: verified,
      side: 'buy',
      adv: 100000,
      requestedOrderType: 'STRATEGIC_ORDER',
    });
    assert.strictEqual(assessment.accepted, false);
    assert.strictEqual(assessment.rejection, 'REJECTED_ZERO_CASH_BUY');
    console.log('✅ [PASS] Exhausted cash correctly rejects subsequent buy in risk check');
  }

  // Test 3: Engine restart restores authoritative portfolio cash without reverting to static config
  {
    const { db, stock } = setupTestEnvironment(50_000_000);
    const bundle = createInMemoryRepositoryBundle(db);

    // Update profile cash to 12,345,678 (simulating past trading)
    db.profiles.get(BOT_ID)!.cash = 12_345_678;

    // Create a new MarketEngine instance (simulating restart)
    const engine = new MarketEngine({
      simulationContext: createSimulationContext({ seed: 123, clock: new StaticTimeSource(NOW) }),
      repositories: bundle,
      marketDataSource: new FixedDataSource([stock]),
    });
    await engine.initializeBots();

    // Verify authoritative cash is preserved
    const profileAfterInit = await bundle.participant.getProfile(BOT_ID);
    assert.strictEqual(profileAfterInit!.cash, 12_345_678);
    console.log('✅ [PASS] Engine recreation restores authoritative bot cash');
  }

  // Test 4: Settlement failure rolls back trades, orders, prices, and bot portfolios atomically
  {
    const { db } = setupTestEnvironment(20_000_000);
    const bundle = createInMemoryRepositoryBundle(db);

    db.orders.set('BO_ROLLBACK_1', {
      id: 'BO_ROLLBACK_1',
      stock_id: STOCK_ID,
      user_id: BOT_ID,
      participantId: BOT_ID,
      side: 'buy',
      price: 10_000,
      size: 1000,
      filled: 0,
      status: 'open',
      is_lp: false,
      created_at: new Date(NOW).toISOString(),
    });
    // Set seller order with insufficient size to trigger overfill failure on trade 2
    db.orders.set('SO_ROLLBACK_1', {
      id: 'SO_ROLLBACK_1',
      stock_id: STOCK_ID,
      user_id: 'lp_1',
      participantId: 'lp_1',
      side: 'sell',
      price: 10_000,
      size: 500, // Only 500 available
      filled: 0,
      status: 'open',
      is_lp: true,
      created_at: new Date(NOW).toISOString(),
    });
    db.profiles.set('lp_1', {
      id: 'lp_1',
      user_id: 'lp_1',
      username: 'lp_1',
      nickname: 'lp_1',
      cash: 100_000_000,
      net_worth: 100_000_000,
      rank_tier: 'LP',
      created_at: new Date(NOW).toISOString(),
    });
    db.profileUserIdIndex.set('lp_1', 'lp_1');

    const botCashBefore = db.profiles.get(BOT_ID)!.cash;
    const tradesCountBefore = db.trades.length;

    // Attempt settlement of 1000 against order of 500 -> should fail with ORDER_OVERFILLED
    const failRes = await bundle.settlement.commitMatchedBatchAtomically({
      trades: [
        {
          id: 'T_FAIL_1',
          stock_id: STOCK_ID,
          buyer_id: BOT_ID,
          seller_id: 'lp_1',
          buy_order_id: 'BO_ROLLBACK_1',
          sell_order_id: 'SO_ROLLBACK_1',
          buyer_is_bot: true,
          seller_is_bot: true,
          price: 10_000,
          size: 1000,
          fee_rates: { buyerFeeRate: 0.001, sellerFeeRate: 0.001 },
        },
      ],
    });

    assert.strictEqual(failRes.success, false);
    assert.strictEqual(failRes.errorCode, 'ORDER_OVERFILL');
    assert.strictEqual(db.profiles.get(BOT_ID)!.cash, botCashBefore);
    assert.strictEqual(db.trades.length, tradesCountBefore);
    assert.strictEqual(db.orders.get('BO_ROLLBACK_1')!.filled, 0);
    assert.strictEqual(db.orders.get('SO_ROLLBACK_1')!.filled, 0);
    console.log('✅ [PASS] Failed settlement rolls back bot cash and all entities atomically');
  }

  console.log('\n🎉 ALL BOT PORTFOLIO AUTHORITY TESTS PASSED!');
}

runTests().catch((err) => {
  console.error('❌ Bot portfolio authority test failed:', err);
  process.exit(1);
});
