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
import fs from 'node:fs';
import path from 'node:path';
import { MemoryDatabase, StockRecord, OptionContractRecord, ProfileRecord, HoldingRecord, OrderRecord, memoryDb } from '../lib/memoryDb/memoryStore';
import { createInMemoryRepositoryBundle } from '../lib/repositories/inMemory';
import { createMemoryDbClient } from '../lib/memoryDb/memoryDbClient';
import {
  POST as analyzePostHandler,
  MAX_TEXT_LENGTH,
  MAX_REQUESTS_PER_WINDOW,
  MAX_BODY_BYTES,
  checkRateLimit,
  setSessionGetter,
  setGeminiFetcher,
  resetRateLimits,
} from '../app/api/analyze/route';
import {
  defaultPostgresStore,
  defaultUpstashStore,
  defaultMemoryStore,
  getActiveRateLimiterStore,
  isLocalDevMode,
  setCustomLimiterStore,
  RateLimiterConfigurationError,
  RateLimiterServiceUnavailableError,
} from '../lib/rateLimit/sharedRateLimiter';
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
  console.log('\n--- 4. Testing AI Analyze API Hardening, Route Guard & Shared Rate Limiter ---');

  // Track all external Gemini calls to verify that rejected requests never trigger external calls
  let externalGeminiCallCount = 0;
  process.env.GEMINI_API_KEY = 'mock_gemini_api_key_for_testing';

  setGeminiFetcher(async (_input, _init) => {
    externalGeminiCallCount++;
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    summary: '모의 분석 요약',
                    impacts: [{ sector: '반도체', impact: 'positive', score: 8.5 }],
                  }),
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  });

  resetRateLimits();

  try {
    // 1. Unauthenticated request -> 401 (Zero external API calls)
    setSessionGetter(async () => null);
    const unauthReq = new NextRequest('http://localhost:3000/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ text: '삼성전자 HBM 공급 계약 체결' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const unauthRes = await analyzePostHandler(unauthReq);
    assert.strictEqual(unauthRes.status, 401, 'Unauthenticated request must return 401');
    assert.strictEqual(externalGeminiCallCount, 0, 'Unauthenticated request must NOT call external Gemini API');
    console.log('✅ [PASS] Unauthenticated request returns 401 with 0 external API calls');

    // 2. Authenticated valid request -> 200 (Calls external Gemini API)
    const testUserId = 'usr_ai_test_alice';
    setSessionGetter(async () => ({ user: { id: testUserId } }));

    const validReq = new NextRequest('http://localhost:3000/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ text: '삼성전자 HBM 공급 계약 체결' }),
      headers: { 'Content-Type': 'application/json' },
    });

    const validRes = await analyzePostHandler(validReq);
    assert.strictEqual(validRes.status, 200, 'Authenticated valid request must return 200');
    assert.strictEqual(externalGeminiCallCount, 1, 'Valid request must invoke external API once');
    const validBody = await validRes.json();
    assert.strictEqual(validBody.summary, '모의 분석 요약');
    assert.strictEqual(validBody.impacts[0].sector, '반도체');
    console.log('✅ [PASS] Authenticated request returns 200 with successful Gemini response');

    // 3. Rate limiting (5 requests per minute):
    // Perform 4 more requests for testUserId (reaching 5 total)
    for (let i = 2; i <= MAX_REQUESTS_PER_WINDOW; i++) {
      const req = new NextRequest('http://localhost:3000/api/analyze', {
        method: 'POST',
        body: JSON.stringify({ text: `뉴스 텍스트 분석 ${i}` }),
        headers: { 'Content-Type': 'application/json' },
      });
      const res = await analyzePostHandler(req);
      assert.strictEqual(res.status, 200);
    }
    assert.strictEqual(externalGeminiCallCount, 5, '5 valid requests within window must all execute');

    // 6th request for same user -> 429 Too Many Requests (Zero external call)
    const rateLimitedReq = new NextRequest('http://localhost:3000/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ text: '6번째 초과 요청' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const rateLimitedRes = await analyzePostHandler(rateLimitedReq);
    assert.strictEqual(rateLimitedRes.status, 429, '6th request within 1 min must return 429');
    assert.strictEqual(externalGeminiCallCount, 5, 'Rate-limited 429 request must NOT call external Gemini API');
    console.log('✅ [PASS] Exceeding 5 requests/min returns 429 without external API calls');

    // 4. Body byte size limit (> 32 KB) -> 413 Payload Too Large
    const freshUser = 'usr_ai_test_bob';
    setSessionGetter(async () => ({ user: { id: freshUser } }));

    // 4a. Oversized with Content-Length header
    const oversizedJson = JSON.stringify({ text: 'X'.repeat(MAX_BODY_BYTES + 1000) });
    const oversizedHeaderReq = new NextRequest('http://localhost:3000/api/analyze', {
      method: 'POST',
      body: oversizedJson,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': String(Buffer.byteLength(oversizedJson)),
      },
    });
    const oversizedHeaderRes = await analyzePostHandler(oversizedHeaderReq);
    assert.strictEqual(oversizedHeaderRes.status, 413, 'Oversized request via Content-Length must return 413');
    assert.strictEqual(externalGeminiCallCount, 5, '413 request must NOT call external Gemini API');

    // 4b. Oversized with missing or inaccurate Content-Length header (stream reader limit defense)
    const oversizedStreamReq = new NextRequest('http://localhost:3000/api/analyze', {
      method: 'POST',
      body: oversizedJson,
      headers: {
        'Content-Type': 'application/json',
        // Inaccurate Content-Length header pretending to be tiny
        'Content-Length': '10',
      },
    });
    const oversizedStreamRes = await analyzePostHandler(oversizedStreamReq);
    assert.strictEqual(oversizedStreamRes.status, 413, 'Oversized request with inaccurate Content-Length must return 413');
    assert.strictEqual(externalGeminiCallCount, 5, '413 request must NOT call external Gemini API');
    console.log('✅ [PASS] Body exceeding 32 KB returns 413 (both Content-Length and stream limits defended)');

    // 5. Text length limit (> 5,000 characters) -> 400 Bad Request
    const longTextUser = 'usr_ai_test_carol';
    setSessionGetter(async () => ({ user: { id: longTextUser } }));
    const longTextJson = JSON.stringify({ text: 'A'.repeat(MAX_TEXT_LENGTH + 1) });
    const longTextReq = new NextRequest('http://localhost:3000/api/analyze', {
      method: 'POST',
      body: longTextJson,
      headers: { 'Content-Type': 'application/json' },
    });
    const longTextRes = await analyzePostHandler(longTextReq);
    assert.strictEqual(longTextRes.status, 400, 'Text exceeding 5,000 characters must return 400');
    assert.strictEqual(externalGeminiCallCount, 5, '400 request must NOT call external Gemini API');
    console.log('✅ [PASS] Text exceeding 5,000 characters returns 400 without external API call');

    // 6. Invalid JSON / non-string text -> 400 Bad Request
    const invalidJsonReq = new NextRequest('http://localhost:3000/api/analyze', {
      method: 'POST',
      body: '{"text": not_valid_json}',
      headers: { 'Content-Type': 'application/json' },
    });
    const invalidJsonRes = await analyzePostHandler(invalidJsonReq);
    assert.strictEqual(invalidJsonRes.status, 400, 'Invalid JSON must return 400');
    assert.strictEqual(externalGeminiCallCount, 5, 'Invalid JSON must NOT call external Gemini API');

    const nonStringReq = new NextRequest('http://localhost:3000/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ text: 12345 }),
      headers: { 'Content-Type': 'application/json' },
    });
    const nonStringRes = await analyzePostHandler(nonStringReq);
    assert.strictEqual(nonStringRes.status, 400, 'Non-string text must return 400');
    assert.strictEqual(externalGeminiCallCount, 5, 'Non-string text must NOT call external Gemini API');

    const emptyTextReq = new NextRequest('http://localhost:3000/api/analyze', {
      method: 'POST',
      body: JSON.stringify({ text: '   ' }),
      headers: { 'Content-Type': 'application/json' },
    });
    const emptyTextRes = await analyzePostHandler(emptyTextReq);
    assert.strictEqual(emptyTextRes.status, 400, 'Empty/whitespace text must return 400');
    assert.strictEqual(externalGeminiCallCount, 5, 'Empty text must NOT call external Gemini API');
    console.log('✅ [PASS] Invalid JSON and non-string/empty text return 400 without external API calls');

    // 7. Unit rate limiter check
    const unitKey = 'test_rate_user_unit_' + Date.now();
    for (let i = 0; i < MAX_REQUESTS_PER_WINDOW; i++) {
      const allowed = await checkRateLimit(unitKey);
      assert.strictEqual(allowed, true, `Unit request ${i + 1} within window must be allowed`);
    }
    const unitBlocked = await checkRateLimit(unitKey);
    assert.strictEqual(unitBlocked, false, 'Unit request exceeding MAX_REQUESTS_PER_WINDOW must be blocked');
    console.log('✅ [PASS] Unit rate limiter verification passed');

  } finally {
    // Clean up test hooks
    setSessionGetter(null);
    setGeminiFetcher(null);
    resetRateLimits();
  }
}

async function testProductionRateLimiterSecurityAndFailClosed() {
  console.log('\n--- 5. Testing Production Shared Rate Limiter Fail-Closed & Security Hardening ---');

  const envKeysToRestore = [
    'NODE_ENV',
    'USE_LOCAL_IN_MEMORY_RATE_LIMIT',
    'NEXT_PUBLIC_USE_IN_MEMORY',
    'ENGINE_DB_URL',
    'ENGINE_DB_SERVICE_ROLE_KEY',
    'UPSTASH_REDIS_REST_URL',
    'UPSTASH_REDIS_REST_TOKEN',
    'GEMINI_API_KEY',
  ];
  const savedEnv: Record<string, string | undefined> = {};
  for (const k of envKeysToRestore) {
    savedEnv[k] = process.env[k];
  }
  const originalFetch = global.fetch;

  try {
    // 1. Verify SQL migrations strictly revoke anon/auth/PUBLIC and grant only to service_role
    console.log('Testing SQL permission lockdown in migrations...');
    const migrationDir = path.resolve(process.cwd(), 'archive/legacy-postgres/sql/migrations');
    const baseMigration = fs.readFileSync(path.join(migrationDir, '20260926_create_ai_rate_limits.sql'), 'utf-8');
    const lockdownMigration = fs.readFileSync(path.join(migrationDir, '20260927_lockdown_ai_rate_limits_permissions.sql'), 'utf-8');

    for (const [name, sql] of [
      ['20260926_create_ai_rate_limits.sql', baseMigration],
      ['20260927_lockdown_ai_rate_limits_permissions.sql', lockdownMigration],
    ]) {
      assert.ok(
        sql.includes('REVOKE ALL ON FUNCTION public.check_ai_rate_limit(text, int, int) FROM PUBLIC, anon, authenticated;'),
        `${name} must revoke EXECUTE from PUBLIC, anon, and authenticated`
      );
      assert.ok(
        sql.includes('REVOKE ALL ON TABLE public.ai_rate_limits FROM PUBLIC, anon, authenticated;'),
        `${name} must revoke table permissions from PUBLIC, anon, and authenticated`
      );
      assert.ok(
        sql.includes('GRANT EXECUTE ON FUNCTION public.check_ai_rate_limit(text, int, int) TO service_role;'),
        `${name} must grant EXECUTE exclusively to service_role`
      );
      assert.ok(
        sql.includes('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.ai_rate_limits TO service_role;'),
        `${name} must grant table permissions to service_role`
      );
      assert.ok(
        !sql.includes('GRANT EXECUTE ON FUNCTION public.check_ai_rate_limit TO anon'),
        `${name} must not grant EXECUTE to anon`
      );
    }
    console.log('✅ [PASS] SQL migrations enforce strict server-only (service_role) permissions');

    // Setup simulated production environment
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    process.env.USE_LOCAL_IN_MEMORY_RATE_LIMIT = 'true';
    assert.strictEqual(
      isLocalDevMode(),
      false,
      'isLocalDevMode() must be false in production even with USE_LOCAL_IN_MEMORY_RATE_LIMIT=true'
    );
    delete process.env.USE_LOCAL_IN_MEMORY_RATE_LIMIT;

    process.env.NEXT_PUBLIC_USE_IN_MEMORY = 'true';
    assert.strictEqual(
      isLocalDevMode(),
      false,
      'isLocalDevMode() must be false in production even with NEXT_PUBLIC_USE_IN_MEMORY=true'
    );
    delete process.env.NEXT_PUBLIC_USE_IN_MEMORY;

    assert.notStrictEqual(
      getActiveRateLimiterStore(),
      defaultMemoryStore,
      'getActiveRateLimiterStore() must NOT return defaultMemoryStore in production'
    );
    console.log('✅ [PASS] In-memory limiter strictly forbidden in production regardless of override flags');

    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    process.env.ENGINE_DB_URL = 'https://secure-db.internal:3001';
    process.env.ENGINE_DB_SERVICE_ROLE_KEY = 'super-secret-service-role-key-999';
    process.env.GEMINI_API_KEY = 'test-gemini-key';

    let geminiCallCount = 0;
    setGeminiFetcher(async () => {
      geminiCallCount++;
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ summary: '정상 분석', impacts: [] }) }] } }],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });

    const testUserId = 'usr_prod_test_user';
    setSessionGetter(async () => ({ user: { id: testUserId } }));

    const makeReq = () =>
      new NextRequest('http://localhost:3000/api/analyze', {
        method: 'POST',
        body: JSON.stringify({ text: '새로운 인공지능 반도체 개발 성공 뉴스' }),
        headers: { 'Content-Type': 'application/json' },
      });

    // 2. Production shared store normal response -> 200, Gemini called 1 time
    let dbFetchCount = 0;
    global.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const urlStr = String(input);
      if (urlStr.includes('/rpc/check_ai_rate_limit')) {
        dbFetchCount++;
        const headers = (init?.headers || {}) as Record<string, string>;
        assert.strictEqual(headers['apikey'], 'super-secret-service-role-key-999', 'PostgREST apikey must be service key');
        assert.strictEqual(headers['Authorization'], 'Bearer super-secret-service-role-key-999', 'Bearer token must be service key');
        return new Response(
          JSON.stringify({
            allowed: true,
            count: 1,
            reset_at: Date.now() + 60000,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return originalFetch(input, init);
    };

    geminiCallCount = 0;
    const okRes = await analyzePostHandler(makeReq());
    assert.strictEqual(okRes.status, 200, 'Production normal response must be 200');
    assert.strictEqual(geminiCallCount, 1, 'Gemini must be called exactly 1 time on successful rate limit');
    assert.strictEqual(dbFetchCount, 1, 'DB check_ai_rate_limit RPC must be called');
    console.log('✅ [PASS] Production shared store normal response returns 200 with 1 Gemini call');

    // 3. Database connection failure -> 503, Gemini called 0 times
    global.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = String(input);
      if (urlStr.includes('/rpc/check_ai_rate_limit')) {
        throw new Error('connect ECONNREFUSED 10.0.0.1:3001');
      }
      return originalFetch(input);
    };

    geminiCallCount = 0;
    const connFailRes = await analyzePostHandler(makeReq());
    assert.strictEqual(connFailRes.status, 503, 'DB connection failure must return 503');
    const connFailJson = await connFailRes.json();
    assert.ok(connFailJson.error.includes('일시적으로 사용할 수 없습니다'), 'Must return helpful Korean 503 error message');
    assert.strictEqual(geminiCallCount, 0, 'Gemini must NOT be called on DB connection failure (0 times)');
    console.log('✅ [PASS] DB connection failure returns 503 with 0 Gemini calls');

    // 4. Missing RPC (404 Not Found from DB) -> 503, Gemini called 0 times
    global.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = String(input);
      if (urlStr.includes('/rpc/check_ai_rate_limit')) {
        return new Response(JSON.stringify({ code: '42883', message: 'function check_ai_rate_limit does not exist' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input);
    };

    geminiCallCount = 0;
    const notFoundRes = await analyzePostHandler(makeReq());
    assert.strictEqual(notFoundRes.status, 503, 'DB 404 missing RPC must return 503');
    assert.strictEqual(geminiCallCount, 0, 'Gemini must NOT be called on 404 RPC missing (0 times)');
    console.log('✅ [PASS] DB 404 missing RPC returns 503 with 0 Gemini calls');

    // 5. Auth Error (401 / 403 from DB) -> 503, Gemini called 0 times
    global.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = String(input);
      if (urlStr.includes('/rpc/check_ai_rate_limit')) {
        return new Response(JSON.stringify({ message: 'JWT expired or invalid' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input);
    };

    geminiCallCount = 0;
    const authFailRes = await analyzePostHandler(makeReq());
    assert.strictEqual(authFailRes.status, 503, 'DB 401 auth error must return 503');
    assert.strictEqual(geminiCallCount, 0, 'Gemini must NOT be called on DB auth error (0 times)');

    global.fetch = async (input: RequestInfo | URL): Promise<Response> => {
      const urlStr = String(input);
      if (urlStr.includes('/rpc/check_ai_rate_limit')) {
        return new Response(JSON.stringify({ message: 'Forbidden' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return originalFetch(input);
    };

    geminiCallCount = 0;
    const forbiddenRes = await analyzePostHandler(makeReq());
    assert.strictEqual(forbiddenRes.status, 503, 'DB 403 forbidden error must return 503');
    assert.strictEqual(geminiCallCount, 0, 'Gemini must NOT be called on DB 403 forbidden (0 times)');
    console.log('✅ [PASS] DB auth errors (401, 403) return 503 with 0 Gemini calls');

    // 6. Missing required environment variables -> 503, Gemini called 0 times
    // 6a. Missing ENGINE_DB_URL
    delete process.env.ENGINE_DB_URL;
    geminiCallCount = 0;
    const missingUrlRes = await analyzePostHandler(makeReq());
    assert.strictEqual(missingUrlRes.status, 503, 'Missing ENGINE_DB_URL in prod must return 503');
    assert.strictEqual(geminiCallCount, 0, 'Gemini must NOT be called when ENGINE_DB_URL is missing');
    await assert.rejects(
      async () => defaultPostgresStore.consume('test', 5, 60000),
      (err: Error) => err instanceof RateLimiterConfigurationError && err.message.includes('ENGINE_DB_URL is required')
    );

    // 6b. Missing ENGINE_DB_SERVICE_ROLE_KEY
    process.env.ENGINE_DB_URL = 'https://secure-db.internal:3001';
    delete process.env.ENGINE_DB_SERVICE_ROLE_KEY;
    geminiCallCount = 0;
    const missingKeyRes = await analyzePostHandler(makeReq());
    assert.strictEqual(missingKeyRes.status, 503, 'Missing ENGINE_DB_SERVICE_ROLE_KEY in prod must return 503');
    assert.strictEqual(geminiCallCount, 0, 'Gemini must NOT be called when service key is missing');
    await assert.rejects(
      async () => defaultPostgresStore.consume('test', 5, 60000),
      (err: Error) =>
        err instanceof RateLimiterConfigurationError &&
        err.message.includes('ENGINE_DB_SERVICE_ROLE_KEY is required')
    );
    console.log('✅ [PASS] Missing required env vars return 503 with 0 Gemini calls and throw RateLimiterConfigurationError');

    // 7. Insecure HTTP address configured in production -> 503, Gemini called 0 times
    // 7a. ENGINE_DB_URL with HTTP
    process.env.ENGINE_DB_URL = 'http://insecure-db.internal:3001';
    process.env.ENGINE_DB_SERVICE_ROLE_KEY = 'some-key';
    geminiCallCount = 0;
    const insecureDbRes = await analyzePostHandler(makeReq());
    assert.strictEqual(insecureDbRes.status, 503, 'Insecure HTTP DB URL must return 503 in prod');
    assert.strictEqual(geminiCallCount, 0, 'Gemini must NOT be called on insecure HTTP DB URL');
    await assert.rejects(
      async () => defaultPostgresStore.consume('test', 5, 60000),
      (err: Error) =>
        err instanceof RateLimiterConfigurationError &&
        err.message.includes('Insecure HTTP protocol is prohibited')
    );

    // 7b. UPSTASH_REDIS_REST_URL with HTTP
    delete process.env.ENGINE_DB_URL;
    process.env.UPSTASH_REDIS_REST_URL = 'http://insecure-redis.upstash.io';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'redis-token-123';
    geminiCallCount = 0;
    const insecureRedisRes = await analyzePostHandler(makeReq());
    assert.strictEqual(insecureRedisRes.status, 503, 'Insecure HTTP Redis URL must return 503 in prod');
    assert.strictEqual(geminiCallCount, 0, 'Gemini must NOT be called on insecure HTTP Redis URL');
    await assert.rejects(
      async () => defaultUpstashStore.consume('test', 5, 60000),
      (err: Error) =>
        err instanceof RateLimiterConfigurationError &&
        err.message.includes('Insecure HTTP protocol is prohibited')
    );
    console.log('✅ [PASS] Insecure HTTP configuration rejected with 503 and 0 Gemini calls');

  } finally {
    for (const k of envKeysToRestore) {
      if (savedEnv[k] === undefined) {
        delete (process.env as Record<string, string | undefined>)[k];
      } else {
        (process.env as Record<string, string | undefined>)[k] = savedEnv[k];
      }
    }
    global.fetch = originalFetch;
    setCustomLimiterStore(null);
    setSessionGetter(null);
    setGeminiFetcher(null);
    resetRateLimits();
  }
}

async function runAll() {
  console.log('================================================================');
  console.log('🚀 RUNNING ALL REGRESSION TESTS FOR FIXES');
  console.log('================================================================');

  await testLpSellerSettlement();
  await testOptionExpirySettlement();
  await testAuthProfileCreationAndIsolation();
  await testAiAnalyzeApiSecurity();
  await testProductionRateLimiterSecurityAndFailClosed();

  console.log('\n================================================================');
  console.log('🎉 ALL REGRESSION TESTS PASSED SUCCESSFULLY');
  console.log('================================================================\n');
}

runAll().catch((err) => {
  console.error('❌ Regression tests failed:', err);
  process.exit(1);
});
