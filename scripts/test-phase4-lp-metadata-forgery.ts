/**
 * Phase 4 Test: P1 - LP Metadata Forgery & Unbacked Selling Prevention
 *
 * Verifies that:
 * 1. Ordinary user forging `is_lp: true`, `participantKind: 'LP'`, or `orderRole: 'LP_QUOTE'` is rejected
 * 2. `lpQuoteUpserts` with an unauthorized LP account is rejected
 * 3. Existing non-LP orders cannot be seized or upgraded into LP quotes via `lpQuoteUpserts`
 * 4. Direct repository calls cannot bypass holding deduction if seller is not in LP registry
 * 5. Conservation invariants: Cash, Stock, and LP liability are strictly preserved
 * 6. All rejection cases have 0 mutation (state is byte-identical)
 */

import assert from 'node:assert';
import crypto from 'node:crypto';
import { MemoryDatabase, OrderRecord, StockRecord, ProfileRecord, HoldingRecord } from '../lib/memoryDb/memoryStore';
import { createInMemoryRepositoryBundle } from '../lib/repositories/inMemory';
import { TradeSettlementInput } from '../lib/repositories/types';

const NOW = Date.parse('2026-06-30T10:00:00.000Z');
const STOCK_ID = 'stock_samsung';
const ATTACKER_ID = 'user_attacker';
const BUYER_ID = 'user_legit_buyer';
const LEGIT_LP_ID = 'bot_as_mm_001';

function computeDatabaseFingerprint(db: MemoryDatabase): string {
  const hash = crypto.createHash('sha256');
  const profiles = Array.from(db.profiles.entries()).sort(([a], [b]) => a.localeCompare(b));
  const holdings = Array.from(db.holdings.entries()).sort(([a], [b]) => a.localeCompare(b));
  const orders = Array.from(db.orders.entries()).sort(([a], [b]) => a.localeCompare(b));
  const trades = [...db.trades].map((t) => t.id).sort();
  const ledger = Array.from(db.settlementLedger.entries()).sort(([a], [b]) => a.localeCompare(b));
  hash.update(JSON.stringify({ profiles, holdings, orders, trades, ledger }));
  return hash.digest('hex');
}

function setupDb(): { db: MemoryDatabase; bundle: ReturnType<typeof createInMemoryRepositoryBundle> } {
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

  // Attacker profile: 0 cash, 0 holdings
  const attackerProfile: ProfileRecord = {
    id: ATTACKER_ID,
    user_id: ATTACKER_ID,
    username: 'Attacker',
    nickname: 'Attacker',
    cash: 0,
    net_worth: 0,
    rank_tier: 'Bronze',
    created_at: new Date(NOW).toISOString(),
  };
  db.profiles.set(ATTACKER_ID, attackerProfile);
  db.profileUserIdIndex.set(ATTACKER_ID, ATTACKER_ID);

  // Buyer profile: 10,000,000 cash
  const buyerProfile: ProfileRecord = {
    id: BUYER_ID,
    user_id: BUYER_ID,
    username: 'Buyer',
    nickname: 'Buyer',
    cash: 10_000_000,
    net_worth: 10_000_000,
    rank_tier: 'Bronze',
    created_at: new Date(NOW).toISOString(),
  };
  db.profiles.set(BUYER_ID, buyerProfile);
  db.profileUserIdIndex.set(BUYER_ID, BUYER_ID);

  // Authorized LP profile & bot config
  const lpProfile: ProfileRecord = {
    id: LEGIT_LP_ID,
    user_id: LEGIT_LP_ID,
    username: 'LP Market Maker',
    nickname: 'LP Market Maker',
    cash: 100_000_000_000,
    net_worth: 100_000_000_000,
    rank_tier: 'Challenger',
    created_at: new Date(NOW).toISOString(),
  };
  db.profiles.set(LEGIT_LP_ID, lpProfile);
  db.profileUserIdIndex.set(LEGIT_LP_ID, LEGIT_LP_ID);

  // Pre-seed buyer order
  const buyOrder: OrderRecord = {
    id: 'ord_legit_buy_1',
    stock_id: STOCK_ID,
    user_id: BUYER_ID,
    participantId: BUYER_ID,
    side: 'buy',
    price: 70000,
    size: 10,
    filled: 0,
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

  const bundle = createInMemoryRepositoryBundle(db);
  return { db, bundle };
}

async function run() {
  console.log('--- Testing P1 LP Metadata Forgery & Unbacked Selling Prevention ---');

  // Test 1: Ordinary user submitting forged is_lp order via newOrders
  {
    const { db, bundle } = setupDb();
    const fpBefore = computeDatabaseFingerprint(db);

    const forgedOrder: OrderRecord = {
      id: 'ord_forged_lp_1',
      stock_id: STOCK_ID,
      user_id: ATTACKER_ID,
      participantId: ATTACKER_ID,
      participantKind: 'RETAIL',
      side: 'sell',
      price: 70000,
      size: 10,
      filled: 0,
      originalQuantity: 10,
      filledQuantity: 0,
      remainingQuantity: 10,
      status: 'open',
      is_lp: true, // Forged LP claim
      version: 1,
      created_at: new Date(NOW).toISOString(),
    };

    const res = await bundle.settlement.commitMatchedBatchAtomically({
      trades: [],
      newOrders: [forgedOrder],
    });

    console.log('Test 1 (forged is_lp in newOrders) result:', res.errorCode);
    assert.strictEqual(res.success, false, 'Forged is_lp order by non-LP must be rejected');
    assert.strictEqual(res.errorCode, 'UNAUTHORIZED_LP_ORDER');
    assert.strictEqual(computeDatabaseFingerprint(db), fpBefore, 'Zero mutation on rejection');
    console.log('✅ [PASS] Forged is_lp order in newOrders rejected with 0 mutation');
  }

  // Test 2: Ordinary user submitting forged participantKind: 'LIQUIDITY_PROVIDER' or orderRole: 'LP_QUOTE'
  {
    const { db, bundle } = setupDb();
    const fpBefore = computeDatabaseFingerprint(db);

    const forgedRoleOrder: any = {
      id: 'ord_forged_role_1',
      stock_id: STOCK_ID,
      user_id: ATTACKER_ID,
      participantId: ATTACKER_ID,
      participantKind: 'LIQUIDITY_PROVIDER', // Forged kind
      orderRole: 'LP_QUOTE',                // Forged role
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

    const res = await bundle.settlement.commitMatchedBatchAtomically({
      trades: [],
      newOrders: [forgedRoleOrder],
    });

    console.log('Test 2 (forged role/kind in newOrders) result:', res.errorCode);
    assert.strictEqual(res.success, false, 'Forged LP role/kind must be rejected');
    assert.strictEqual(res.errorCode, 'UNAUTHORIZED_LP_ORDER');
    assert.strictEqual(computeDatabaseFingerprint(db), fpBefore, 'Zero mutation on rejection');
    console.log('✅ [PASS] Forged LP role/kind in newOrders rejected with 0 mutation');
  }

  // Test 3: Attacker attempting to use lpQuoteUpserts
  {
    const { db, bundle } = setupDb();
    const fpBefore = computeDatabaseFingerprint(db);

    const forgedUpsert: OrderRecord = {
      id: 'ord_forged_upsert_1',
      stock_id: STOCK_ID,
      user_id: ATTACKER_ID,
      participantId: ATTACKER_ID,
      side: 'sell',
      price: 70000,
      size: 10,
      filled: 0,
      status: 'open',
      is_lp: true,
      version: 1,
      created_at: new Date(NOW).toISOString(),
    };

    const res = await bundle.settlement.commitMatchedBatchAtomically({
      trades: [],
      lpQuoteUpserts: [forgedUpsert],
    });

    console.log('Test 3 (unauthorized lpQuoteUpserts) result:', res.errorCode);
    assert.strictEqual(res.success, false, 'Unauthorized lpQuoteUpserts must be rejected');
    assert.strictEqual(res.errorCode, 'UNAUTHORIZED_LP_ORDER');
    assert.strictEqual(computeDatabaseFingerprint(db), fpBefore, 'Zero mutation on rejection');
    console.log('✅ [PASS] Unauthorized lpQuoteUpserts rejected with 0 mutation');
  }

  // Test 4: Attacker attempting to hijack an existing non-LP order via lpQuoteUpserts
  {
    const { db, bundle } = setupDb();

    // Existing legitimate retail order
    const retailOrder: OrderRecord = {
      id: 'ord_retail_user_1',
      stock_id: STOCK_ID,
      user_id: ATTACKER_ID,
      participantId: ATTACKER_ID,
      side: 'sell',
      price: 70000,
      size: 5,
      filled: 0,
      status: 'open',
      is_lp: false,
      version: 1,
      created_at: new Date(NOW).toISOString(),
    };
    db.orders.set(retailOrder.id, retailOrder);
    db.addOrderToIndex(retailOrder);
    const fpBefore = computeDatabaseFingerprint(db);

    // Attempt to hijack 'ord_retail_user_1' as an LP quote
    const hijackOrder: OrderRecord = {
      id: 'ord_retail_user_1',
      stock_id: STOCK_ID,
      user_id: LEGIT_LP_ID,
      participantId: LEGIT_LP_ID,
      side: 'sell',
      price: 70000,
      size: 50,
      filled: 0,
      status: 'open',
      is_lp: true,
      version: 1,
      created_at: new Date(NOW).toISOString(),
    };

    const res = await bundle.settlement.commitMatchedBatchAtomically({
      trades: [],
      lpQuoteUpserts: [hijackOrder],
    });

    console.log('Test 4 (hijack existing non-LP order) result:', res.errorCode);
    assert.strictEqual(res.success, false, 'Hijacking non-LP order via lpQuoteUpserts must be rejected');
    assert.strictEqual(res.errorCode, 'CANNOT_UPGRADE_NON_LP_ORDER');
    assert.strictEqual(computeDatabaseFingerprint(db), fpBefore, 'Zero mutation on rejection');
    console.log('✅ [PASS] Hijacking non-LP order rejected with 0 mutation');
  }

  // Test 5: Direct repository call bypass attempt (unbacked selling)
  // Attacker bypasses engine validation, puts is_lp: true directly on order in DB,
  // then attempts to settle a trade to generate cash without having stock!
  {
    const { db, bundle } = setupDb();
    const fpBefore = computeDatabaseFingerprint(db);

    // Attacker sneaks an order directly into DB with is_lp: true
    const sneakyOrder: OrderRecord = {
      id: 'ord_sneaky_sell',
      stock_id: STOCK_ID,
      user_id: ATTACKER_ID,
      participantId: ATTACKER_ID,
      side: 'sell',
      price: 70000,
      size: 10,
      filled: 0,
      originalQuantity: 10,
      filledQuantity: 0,
      remainingQuantity: 10,
      status: 'open',
      is_lp: true, // Attacker claims LP
      version: 1,
      created_at: new Date(NOW).toISOString(),
    };
    db.orders.set(sneakyOrder.id, sneakyOrder);
    db.addOrderToIndex(sneakyOrder);

    const sneakyTrade: TradeSettlementInput = {
      id: 'trd_sneaky_unbacked_1',
      stock_id: STOCK_ID,
      price: 70000,
      size: 10,
      buyer_id: BUYER_ID,
      seller_id: ATTACKER_ID,
      buyer_is_bot: false,
      seller_is_bot: false,
      buy_order_id: 'ord_legit_buy_1',
      sell_order_id: 'ord_sneaky_sell',
      buyer_fee_rate: 0,
      seller_fee_rate: 0,
    };

    const res = await bundle.settlement.commitMatchedBatchAtomically({
      trades: [sneakyTrade],
    });

    console.log('Test 5 (sneaky direct repository unbacked sell) result:', res.errorCode);
    // Must be rejected: Attacker is not an authorized LP account!
    assert.strictEqual(res.success, false, 'Direct unbacked sell via forged LP claim must be rejected');
    assert.strictEqual(res.errorCode, 'UNAUTHORIZED_LP_ORDER');

    // Clean up sneaky order from db for fingerprint check
    db.orders.delete(sneakyOrder.id);
    db.removeOrderFromIndex(sneakyOrder);
    assert.strictEqual(computeDatabaseFingerprint(db), fpBefore, 'Attacker got 0 cash and DB had 0 mutation');
    console.log('✅ [PASS] Direct repository unbacked sell rejected, 0 cash generated');
  }

  console.log('\n🎉 ALL P1 LP METADATA FORGERY TESTS PASSED!\n');
}

run().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
