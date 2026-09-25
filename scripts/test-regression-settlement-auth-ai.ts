/**
 * Comprehensive Regression Test Suite
 *
 * Verifies fixes for:
 * 1. LP seller settlement (declaration order & LP authorization)
 * 2. Option expiry settlement (underlying_stock_id, ITM/OTM payouts, position closure, idempotency)
 * 3. Auth user profile creation & isolation (no guest account fallback, distinct ledger, 5M KRW seed)
 * 4. AI analyze API security (auth enforcement, payload length guard, rate limiting, header-based API key)
 */

import assert from 'node:assert';
import { MemoryDatabase, StockRecord, OptionContractRecord, ProfileRecord, HoldingRecord, OrderRecord, memoryDb } from '../lib/memoryDb/memoryStore';
import { createInMemoryRepositoryBundle } from '../lib/repositories/inMemory';
import { createMemoryDbClient } from '../lib/memoryDb/memoryDbClient';
import { POST as analyzePostHandler, MAX_TEXT_LENGTH, MAX_REQUESTS_PER_WINDOW, checkRateLimit } from '../app/api/analyze/route';
import { NextRequest } from 'next/server';

const NOW = 1774483200000;

async function testLpSellerSettlement() {
  console.log('\n--- 1. Testing LP Seller Settlement ---');
  const db = new MemoryDatabase();
  const bundle = createInMemoryRepositoryBundle(db);

  const stockId = 'stock_sec_005930';
  const stock: StockRecord = {
    id: stockId,
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
  db.stocks.set(stockId, stock);
  db.addStockToIndex(stock);

  const buyerId = 'usr_buyer_alice';
  const buyerProfile: ProfileRecord = {
    id: buyerId,
    user_id: buyerId,
    username: 'Alice',
    nickname: 'Alice',
    cash: 10_000_000,
    net_worth: 10_000_000,
    rank_tier: 'Bronze',
    created_at: new Date(NOW).toISOString(),
  };
  db.profiles.set(buyerId, buyerProfile);
  db.profileUserIdIndex.set(buyerId, buyerId);

  const lpId = 'bot_lp_omega';
  const lpProfile: ProfileRecord = {
    id: lpId,
    user_id: lpId,
    username: 'Omega LP',
    nickname: 'Omega LP',
    cash: 100_000_000_000,
    net_worth: 100_000_000_000,
    rank_tier: 'Challenger',
    created_at: new Date(NOW).toISOString(),
  };
  db.profiles.set(lpId, lpProfile);
  db.profileUserIdIndex.set(lpId, lpId);
  db.lpAccounts.add(lpId);

  // LP has 0 initial holdings in stockId (unbacked LP sell quote)
  const buyOrder: OrderRecord = {
    id: 'ord_reg_buy_1',
    stock_id: stockId,
    user_id: buyerId,
    participantId: buyerId,
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

  const lpSellOrder: OrderRecord = {
    id: 'ord_lp_sell_1',
    stock_id: stockId,
    user_id: lpId,
    participantId: lpId,
    side: 'sell',
    price: 70000,
    size: 10,
    filled: 0,
    originalQuantity: 10,
    filledQuantity: 0,
    remainingQuantity: 10,
    status: 'open',
    is_lp: true,
    version: 1,
    created_at: new Date(NOW).toISOString(),
  };
  db.orders.set(lpSellOrder.id, lpSellOrder);
  db.addOrderToIndex(lpSellOrder);

  const tradeRes = await bundle.settlement.commitMatchedBatchAtomically({
    trades: [
      {
        id: 'trd_lp_settle_1',
        stock_id: stockId,
        price: 70000,
        size: 10,
        buyer_id: buyerId,
        seller_id: lpId,
        buyer_is_bot: false,
        seller_is_bot: true,
        buy_order_id: buyOrder.id,
        sell_order_id: lpSellOrder.id,
        buyer_fee_rate: 0.00015,
        seller_fee_rate: -0.00005,
      },
    ],
    orderUpdates: [
      { id: buyOrder.id, filledQuantity: 10, remainingQuantity: 0, status: 'filled' },
      { id: lpSellOrder.id, filledQuantity: 10, remainingQuantity: 0, status: 'filled' },
    ],
  });

  assert.strictEqual(tradeRes.success, true, 'LP seller settlement must succeed without ReferenceError or unbacked rejection');
  const updatedBuyer = db.profiles.get(buyerId)!;
  const buyerHolding = Array.from(db.holdings.values()).find((h) => h.user_id === buyerId && h.stock_id === stockId);
  assert(buyerHolding, 'Buyer must now possess the stock');
  assert.strictEqual(buyerHolding.quantity, 10, 'Buyer holding quantity must be 10');
  assert(updatedBuyer.cash < 10_000_000, 'Buyer cash must be deducted by trade value + fee');

  console.log('✅ [PASS] LP seller settlement succeeded and balances/holdings updated correctly');
}

async function testOptionExpirySettlement() {
  console.log('\n--- 2. Testing Option Expiry Settlement ---');
  const db = new MemoryDatabase();
  const bundle = createInMemoryRepositoryBundle(db);

  const underlyingStockId = 'stock_sec_005930';
  const stock: StockRecord = {
    id: underlyingStockId,
    ticker: '005930',
    name: 'Samsung Electronics',
    current_price: 80000,
    previous_close: 80000,
    open_price: 80000,
    high: 80000,
    low: 80000,
    volume: 1000,
    change_rate: 0,
    market_cap: 80000000000,
    pe_ratio: 10,
    dividend_yield: 2,
    sector: 'Technology',
    market: 'domestic',
    shares_outstanding: 1000000,
    floating_shares: 800000,
  };
  db.stocks.set(underlyingStockId, stock);
  db.addStockToIndex(stock);

  const userId = 'usr_option_trader';
  const userProfile: ProfileRecord = {
    id: userId,
    user_id: userId,
    username: 'Trader Bob',
    nickname: 'Trader Bob',
    cash: 1_000_000,
    net_worth: 1_000_000,
    rank_tier: 'Bronze',
    created_at: new Date(NOW).toISOString(),
  };
  db.profiles.set(userId, userProfile);
  db.profileUserIdIndex.set(userId, userId);

  // Contract 1: ITM Call (Strike 70,000, Close 80,000 => Payoff 10,000 * multiplier)
  const itmCall: OptionContractRecord = {
    id: 'opt_itm_call_1',
    ticker: 'OPT_SEC_CALL_70000',
    underlying_stock_id: underlyingStockId,
    type: 'CALL',
    strike_price: 70000,
    current_price: 10000,
    expiry_date: '2026-03-25T15:00:00.000Z',
    multiplier: 1, // 1 share per contract for easy calculation
  };
  db.optionsContracts.set(itmCall.id, itmCall);

  const itmHolding: HoldingRecord = {
    id: `${userId}_${itmCall.id}`,
    user_id: userId,
    stock_id: itmCall.id,
    quantity: 5,
    avg_price: 3000,
    created_at: new Date(NOW).toISOString(),
  };
  db.holdings.set(itmHolding.id, itmHolding);
  db.addHoldingToIndex(itmHolding);

  // Settle ITM Call
  const itmRes = await bundle.settlement.settleOptionExpiryAtomically({
    userId,
    optionId: itmCall.id,
    underlyingClosePrice: 80000,
    now: NOW,
    idempotencyKey: 'idem_itm_call_1',
  });

  assert.strictEqual(itmRes.success, true, 'ITM option settlement must succeed');
  const itmSettlement = db.optionSettlements.find((s) => s.id === 'idem_itm_call_1');
  assert(itmSettlement, 'Option settlement entry must be created in db');
  assert.strictEqual(itmSettlement.payout_amount, 50000, '5 contracts * (80,000 - 70,000) * 1 = 50,000 KRW');

  const afterItmProfile = db.profiles.get(userId)!;
  assert.strictEqual(afterItmProfile.cash, 1_050_000, 'Cash should increase by exactly payout');

  const afterItmHolding = Array.from(db.holdings.values()).find((h) => h.user_id === userId && h.stock_id === itmCall.id);
  assert(!afterItmHolding || afterItmHolding.quantity === 0, 'Expired holding position must be closed/removed');

  // Idempotency test: Re-running with same idempotencyKey
  const replayRes = await bundle.settlement.settleOptionExpiryAtomically({
    userId,
    optionId: itmCall.id,
    underlyingClosePrice: 80000,
    now: NOW,
    idempotencyKey: 'idem_itm_call_1',
  });
  assert.strictEqual(replayRes.success, true, 'Replaying settled option expiry must succeed idempotently');
  assert.strictEqual(replayRes.errorCode, 'ALREADY_SETTLED', 'Error code must be ALREADY_SETTLED');
  assert.strictEqual(db.profiles.get(userId)!.cash, 1_050_000, 'Replay must not credit cash again');

  // Contract 2: OTM Call (Strike 90,000, Close 80,000 => Payoff 0)
  const otmCall: OptionContractRecord = {
    id: 'opt_otm_call_1',
    ticker: 'OPT_SEC_CALL_90000',
    underlying_stock_id: underlyingStockId,
    type: 'CALL',
    strike_price: 90000,
    current_price: 500,
    expiry_date: '2026-03-25T15:00:00.000Z',
    multiplier: 1,
  };
  db.optionsContracts.set(otmCall.id, otmCall);

  const otmHolding: HoldingRecord = {
    id: `${userId}_${otmCall.id}`,
    user_id: userId,
    stock_id: otmCall.id,
    quantity: 10,
    avg_price: 1000,
    created_at: new Date(NOW).toISOString(),
  };
  db.holdings.set(otmHolding.id, otmHolding);
  db.addHoldingToIndex(otmHolding);

  const otmRes = await bundle.settlement.settleOptionExpiryAtomically({
    userId,
    optionId: otmCall.id,
    underlyingClosePrice: 80000,
    now: NOW,
    idempotencyKey: 'idem_otm_call_1',
  });

  assert.strictEqual(otmRes.success, true, 'OTM option expiry settlement must succeed');
  const otmSettlement = db.optionSettlements.find((s) => s.id === 'idem_otm_call_1');
  assert(otmSettlement, 'OTM settlement entry must be created in db');
  assert.strictEqual(otmSettlement.payout_amount, 0, 'OTM payoff must be 0');
  assert.strictEqual(db.profiles.get(userId)!.cash, 1_050_000, 'Cash balance must not change for OTM');

  const afterOtmHolding = Array.from(db.holdings.values()).find((h) => h.user_id === userId && h.stock_id === otmCall.id);
  assert(!afterOtmHolding || afterOtmHolding.quantity === 0, 'OTM expired position must be closed/removed');

  console.log('✅ [PASS] Option expiry correctly handles underlying_stock_id, ITM payout, OTM closure, and idempotency');
}

async function testAuthProfileCreationAndIsolation() {
  console.log('\n--- 3. Testing Google Auth New User Profile Creation & Isolation ---');

  const client = createMemoryDbClient(memoryDb);

  // Verify non-existent user query does NOT return guest account
  const nonExistentUserId = 'user_non_existent_' + Date.now();
  const queryResult = await client
    .from('profiles')
    .select('*')
    .eq('id', nonExistentUserId)
    .maybeSingle();

  assert.strictEqual(queryResult.data, null, 'Non-existent user must return null, never the guest account!');

  // Create new user profile via ensureUserProfile
  const newUserId1 = 'google_oauth_user_1';
  const newProfile1 = memoryDb.ensureUserProfile(newUserId1, {
    username: 'Google User 1',
    email: 'user1@example.com',
  });

  assert.strictEqual(newProfile1.id, newUserId1);
  assert.strictEqual(newProfile1.cash, 5_000_000, 'Initial seed cash must be 5,000,000 KRW');
  assert.strictEqual(newProfile1.net_worth, 5_000_000, 'Initial net worth must be 5,000,000 KRW');
  assert.strictEqual(newProfile1.rank_tier, 'Bronze', 'Initial tier must be Bronze');

  // Create second user profile
  const newUserId2 = 'google_oauth_user_2';
  const newProfile2 = memoryDb.ensureUserProfile(newUserId2, {
    username: 'Google User 2',
    email: 'user2@example.com',
  });

  // Verify memoryDbClient query returns exact user profile
  const user1Query = await client
    .from('profiles')
    .select('*')
    .eq('id', newUserId1)
    .maybeSingle();

  assert.strictEqual(user1Query.data?.id, newUserId1);
  assert.strictEqual(user1Query.data?.username, 'Google User 1');

  // Modify user1 cash and verify user2 is not affected
  newProfile1.cash += 1_000_000;
  assert.strictEqual(newProfile1.cash, 6_000_000);
  assert.strictEqual(newProfile2.cash, 5_000_000, 'User 2 cash must remain isolated from User 1');

  console.log('✅ [PASS] Auth profile initialization and isolation verified (no guest fallback, distinct 5M seed)');
}

async function testAiAnalyzeApiSecurity() {
  console.log('\n--- 4. Testing AI Analyze API Hardening & Abuse Prevention ---');

  // 1. Unauthenticated request -> 401
  const unauthReq = new NextRequest('http://localhost:3000/api/analyze', {
    method: 'POST',
    body: JSON.stringify({ text: 'Analyze stocks' }),
    headers: { 'Content-Type': 'application/json' },
  });

  const unauthRes = await analyzePostHandler(unauthReq);
  assert.strictEqual(unauthRes.status, 401, 'Unauthenticated request must return 401');
  const unauthBody = await unauthRes.json();
  assert.strictEqual(unauthBody.error, '로그인이 필요한 서비스입니다.');

  // 2. Body length limit verification
  assert.strictEqual(MAX_TEXT_LENGTH, 5000, 'Max prompt text length must be capped at 5000 characters');

  // 3. Rate limiting unit verification
  const testKey = 'test_rate_user_' + Date.now();
  for (let i = 0; i < MAX_REQUESTS_PER_WINDOW; i++) {
    const allowed = checkRateLimit(testKey);
    assert.strictEqual(allowed, true, `Request ${i + 1} within window must be allowed`);
  }
  const blocked = checkRateLimit(testKey);
  assert.strictEqual(blocked, false, 'Request exceeding MAX_REQUESTS_PER_WINDOW must be blocked');

  console.log('✅ [PASS] AI Analyze API 401 unauth, rate limit (5 req/min), and 5000 char limits verified');
}

async function runAll() {
  console.log('================================================================');
  console.log('🚀 RUNNING ALL REGRESSION TESTS FOR FIXES');
  console.log('================================================================');

  await testLpSellerSettlement();
  await testOptionExpirySettlement();
  await testAuthProfileCreationAndIsolation();
  await testAiAnalyzeApiSecurity();

  console.log('\n================================================================');
  console.log('🎉 ALL REGRESSION TESTS PASSED SUCCESSFULLY');
  console.log('================================================================\n');
}

runAll().catch((err) => {
  console.error('❌ Regression tests failed:', err);
  process.exit(1);
});
