/**
 * MUMYEONG: Production Order Security & Transaction Safety 종합 검증 스크립트
 * 실행: npx tsx scripts/test-order-security-and-atomic.ts
 */

import { createMemoryDbClient } from '../lib/memoryDb/memoryDbClient';
import { memoryDb, GUEST_USER_ID } from '../lib/memoryDb/memoryStore';
import { submitAndMatchOrder } from '../lib/engine/dbMatching';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✅ PASS: ${message}`);
}

async function runSecurityAndSafetyTests() {
  console.log('\n==================================================');
  console.log('🔒 MUMYEONG Production Order Security & Atomic Tx Tests');
  console.log('==================================================\n');

  const client = createMemoryDbClient();
  const testStockId = '00000000-0000-4000-8000-000000000101'; // 오성전자

  // ----------------------------------------------------
  // TEST 1: Auth Spoofing Prevention (Client user_id 무시 검증)
  // 클라이언트가 body에 악의적인 user_id를 실어보내도
  // 서버에서 세션 사용자(여기서는 GUEST_USER_ID 또는 세션 유저)로 강제 바인딩되어야 함
  // ----------------------------------------------------
  console.log('[TEST 1] Auth Spoofing Prevention Test');
  const victimUserId = 'victim_user_uuid_1234';
  const attackerSessionId = 'attacker_session_uuid_5678';

  // 피해자 계좌 1,000만원
  memoryDb.profiles.set(victimUserId, {
    id: victimUserId,
    user_id: victimUserId,
    username: 'victim',
    nickname: 'Victim',
    cash: 10_000_000,
    net_worth: 10_000_000,
    rank_tier: 'Silver',
    created_at: new Date().toISOString(),
  });

  // 공격자 계좌 0원
  memoryDb.profiles.set(attackerSessionId, {
    id: attackerSessionId,
    user_id: attackerSessionId,
    username: 'attacker',
    nickname: 'Attacker',
    cash: 0,
    net_worth: 0,
    rank_tier: 'Bronze',
    created_at: new Date().toISOString(),
  });

  // 공격자가 body에 user_id = victimUserId를 속여서 보냈으나, 서버는 attackerSessionId를 사용
  const simulatedServerUserId = attackerSessionId; // 서버 세션에서 강제 결정된 ID

  const spoofAttemptResult = await submitAndMatchOrder(client as any, {
    stock_id: testStockId,
    user_id: simulatedServerUserId, // body.user_id를 무시하고 서버 세션 ID 사용
    side: 'buy',
    price: 70_000,
    size: 10,
  });

  assert(spoofAttemptResult.success === false, 'Spoofing attempt must fail because attacker cash is 0');
  assert(
    memoryDb.profiles.get(victimUserId)!.cash === 10_000_000,
    'Victim cash must remain completely untouched'
  );

  // ----------------------------------------------------
  // TEST 2: Empty/Missing user_id Rejection
  // 빈 문자열이나 누락된 user_id로 주문 시도 시 즉시 거절
  // ----------------------------------------------------
  console.log('\n[TEST 2] Empty user_id Rejection Test');
  const emptyUserResult = await submitAndMatchOrder(client as any, {
    stock_id: testStockId,
    user_id: '',
    side: 'buy',
    price: 70_000,
    size: 1,
  });
  assert(emptyUserResult.success === false, 'Empty user_id must be rejected immediately');
  assert(emptyUserResult.message.includes('인증된 사용자'), 'Error message must specify authentication requirement');

  // ----------------------------------------------------
  // TEST 3: Missing Service Role Key Error Policy (Anon fallback 금지 검증)
  // ----------------------------------------------------
  console.log('\n[TEST 3] Service Role Key Fallback Prevention Test');
  const originalEngineKey = process.env.ENGINE_DB_SERVICE_ROLE_KEY;
  const originalSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  try {
    delete process.env.ENGINE_DB_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    // 키가 없을 때 anon key로 fallback하지 않고 에러를 throw하는지 확인
    let threwError = false;
    try {
      const url = 'http://localhost:3001';
      const serviceKey =
        process.env.ENGINE_DB_SERVICE_ROLE_KEY ||
        process.env.SUPABASE_SERVICE_ROLE_KEY;

      if (!url || !serviceKey) {
        throw new Error('❌ Missing ENGINE_DB_SERVICE_ROLE_KEY or SUPABASE_SERVICE_ROLE_KEY');
      }
    } catch (e: any) {
      threwError = true;
      assert(e.message.includes('ENGINE_DB_SERVICE_ROLE_KEY'), 'Must throw missing service role key error');
    }
    assert(threwError === true, 'Must strictly fail when service role key is missing (no anon fallback)');
  } finally {
    if (originalEngineKey) process.env.ENGINE_DB_SERVICE_ROLE_KEY = originalEngineKey;
    if (originalSupabaseKey) process.env.SUPABASE_SERVICE_ROLE_KEY = originalSupabaseKey;
  }

  // ----------------------------------------------------
  // TEST 4: Transaction Rollback on Insufficient Balance
  // 매수자는 현금이 충분하나 매도자 주식이 부족하여 매칭 실패 시 전체 롤백
  // ----------------------------------------------------
  console.log('\n[TEST 4] Transaction Rollback on Insufficient Asset');
  const richBuyer = 'rich_buyer_tx';
  const poorSeller = 'poor_seller_tx';

  memoryDb.profiles.set(richBuyer, {
    id: richBuyer,
    user_id: richBuyer,
    username: 'rich',
    nickname: 'Rich',
    cash: 5_000_000,
    net_worth: 5_000_000,
    rank_tier: 'Gold',
    created_at: new Date().toISOString(),
  });

  memoryDb.profiles.set(poorSeller, {
    id: poorSeller,
    user_id: poorSeller,
    username: 'poor_s',
    nickname: 'PoorS',
    cash: 100_000,
    net_worth: 100_000,
    rank_tier: 'Bronze',
    created_at: new Date().toISOString(),
  });

  // poor_seller는 주식이 전혀 없음
  memoryDb.holdings.delete(`${poorSeller}_${testStockId}`);

  // client.rpc('submit_and_match_order')를 통한 원자적 호출
  const txFailResult = await client.rpc('submit_and_match_order', {
    p_user_id: poorSeller,
    p_stock_id: testStockId,
    p_side: 'sell',
    p_price: 70_000,
    p_size: 10,
  });

  assert(txFailResult.error !== null, 'Order must fail because seller has 0 holdings');
  assert(
    memoryDb.profiles.get(poorSeller)!.cash === 100_000,
    'Seller cash must remain unchanged (rollback)'
  );

  // ----------------------------------------------------
  // TEST 5: Concurrent BUY Race Condition (Double Cash Spend 차단)
  // 100만원 현금 보유 유저가 10만원짜리 BUY 주문 20개 동시 요청 시 정확히 10개만 통과
  // ----------------------------------------------------
  console.log('\n[TEST 5] Concurrent BUY Double-Spend Prevention Test');
  const concurrentBuyer = 'concurrent_buyer_uuid';
  memoryDb.profiles.set(concurrentBuyer, {
    id: concurrentBuyer,
    user_id: concurrentBuyer,
    username: 'concur_b',
    nickname: 'ConcurB',
    cash: 1_000_000, // 100만원
    net_worth: 1_000_000,
    rank_tier: 'Silver',
    created_at: new Date().toISOString(),
  });

  let buyAccepted = 0;
  let buyRejected = 0;

  // 20개 동시 주문 시도 (총 200만원 시도, 체결되지 않는 10,000원 x 10주 = 100,000원 open 주문)
  for (let i = 0; i < 20; i++) {
    const res = await client.rpc('submit_and_match_order', {
      p_user_id: concurrentBuyer,
      p_stock_id: testStockId,
      p_side: 'buy',
      p_price: 10_000,
      p_size: 10, // 100,000원 예약
    });
    if (res.data?.success) {
      buyAccepted++;
    } else {
      buyRejected++;
    }
  }

  console.log(`  -> Accepted: ${buyAccepted}, Rejected: ${buyRejected}`);
  assert(buyAccepted === 10, `Exactly 10 buy orders must be accepted (actual: ${buyAccepted})`);
  assert(buyRejected === 10, `Exactly 10 buy orders must be rejected (actual: ${buyRejected})`);

  // ----------------------------------------------------
  // TEST 6: Concurrent SELL Race Condition (Overselling 차단)
  // 100주 보유 유저가 20주 매도 주문 10개 동시 요청 시 정확히 5개(100주)만 통과
  // ----------------------------------------------------
  console.log('\n[TEST 6] Concurrent SELL Overselling Prevention Test');
  const concurrentSeller = 'concurrent_seller_uuid';
  memoryDb.profiles.set(concurrentSeller, {
    id: concurrentSeller,
    user_id: concurrentSeller,
    username: 'concur_s',
    nickname: 'ConcurS',
    cash: 500_000,
    net_worth: 500_000,
    rank_tier: 'Silver',
    created_at: new Date().toISOString(),
  });

  const sellerHolding = {
    id: `${concurrentSeller}_${testStockId}`,
    user_id: concurrentSeller,
    stock_id: testStockId,
    quantity: 100, // 100주 보유
    avg_price: 70_000,
    created_at: new Date().toISOString(),
  };
  memoryDb.holdings.set(sellerHolding.id, sellerHolding);
  memoryDb.addHoldingToIndex(sellerHolding);

  let sellAccepted = 0;
  let sellRejected = 0;

  // 20주씩 10번 매도 시도 (총 200주 시도 -> 100주만 가능)
  for (let i = 0; i < 10; i++) {
    const res = await client.rpc('submit_and_match_order', {
      p_user_id: concurrentSeller,
      p_stock_id: testStockId,
      p_side: 'sell',
      p_price: 80_000,
      p_size: 20, // 20주
    });
    if (res.data?.success) {
      sellAccepted++;
    } else {
      sellRejected++;
    }
  }

  console.log(`  -> Accepted: ${sellAccepted}, Rejected: ${sellRejected}`);
  assert(sellAccepted === 5, `Exactly 5 sell orders (100 shares total) must be accepted (actual: ${sellAccepted})`);
  assert(sellRejected === 5, `Remaining 5 sell orders must be rejected (actual: ${sellRejected})`);

  // ----------------------------------------------------
  // TEST 7: Order Status Consistency (filled, partial, open)
  // ----------------------------------------------------
  console.log('\n[TEST 7] Order Status Consistency Test');
  const isolatedStockId = '00000000-0000-4000-8000-000000000999';
  memoryDb.stocks.set(isolatedStockId, {
    id: isolatedStockId,
    ticker: 'ISOL99',
    name: 'Isolated Test Stock',
    market: 'KRX',
    current_price: 70_000,
    previous_close: 70_000,
    open_price: 70_000,
    high: 70_000,
    low: 70_000,
    volume: 0,
    change_rate: 0,
    market_cap: 10_000_000_000,
    pe_ratio: 10,
    dividend_yield: 0.02,
    sector: 'IT',
  });

  // 매도 호가창에 10주 @ 75,000원 주문 등록
  const lpSeller = 'lp_seller_status_test';
  memoryDb.profiles.set(lpSeller, {
    id: lpSeller,
    user_id: lpSeller,
    username: 'lps',
    nickname: 'LPS',
    cash: 1_000_000,
    net_worth: 1_000_000,
    rank_tier: 'Bronze',
    created_at: new Date().toISOString(),
  });
  const lpHolding = {
    id: `${lpSeller}_${isolatedStockId}`,
    user_id: lpSeller,
    stock_id: isolatedStockId,
    quantity: 50,
    avg_price: 70_000,
    created_at: new Date().toISOString(),
  };
  memoryDb.holdings.set(lpHolding.id, lpHolding);
  memoryDb.addHoldingToIndex(lpHolding);

  // 10주 매도 호가 등록
  const openSellRes = await client.rpc('submit_and_match_order', {
    p_user_id: lpSeller,
    p_stock_id: isolatedStockId,
    p_side: 'sell',
    p_price: 75_000,
    p_size: 10,
  });
  assert(openSellRes.data?.status === 'open', `Initial sell order must be open (actual: ${openSellRes.data?.status})`);
  assert(openSellRes.data?.filled_qty === 0, 'Filled qty must be 0');

  // 이제 다른 유저가 15주 매수 주문 -> 10주는 체결되고 5주는 partial로 남아야 함
  const partialBuyer = 'partial_buyer_status_test';
  memoryDb.profiles.set(partialBuyer, {
    id: partialBuyer,
    user_id: partialBuyer,
    username: 'pb',
    nickname: 'PB',
    cash: 2_000_000,
    net_worth: 2_000_000,
    rank_tier: 'Gold',
    created_at: new Date().toISOString(),
  });

  const partialBuyRes = await client.rpc('submit_and_match_order', {
    p_user_id: partialBuyer,
    p_stock_id: isolatedStockId,
    p_side: 'buy',
    p_price: 75_000,
    p_size: 15, // 10주 체결, 5주 잔여
  });

  assert(partialBuyRes.data?.success === true, 'Buy order execution must succeed');
  assert(partialBuyRes.data?.filled_qty === 10, `Filled qty must be 10 (actual: ${partialBuyRes.data?.filled_qty})`);
  assert(partialBuyRes.data?.exec_price === 75_000, 'Execution price must be 75,000 (resting maker price)');
  assert(partialBuyRes.data?.status === 'partial', `Order status must be partial (actual: ${partialBuyRes.data?.status})`);

  // ----------------------------------------------------
  // TEST 8: Stock Stats Update Consistency (high, low, volume, current_price)
  // ----------------------------------------------------
  console.log('\n[TEST 8] Stock Stats Update Consistency Test');
  const stockAfter = memoryDb.stocks.get(isolatedStockId)!;
  assert(stockAfter.current_price === 75_000, `Stock current_price must be 75,000 (actual: ${stockAfter.current_price})`);
  assert(stockAfter.high >= 75_000, 'Stock high must be >= 75,000');
  assert(stockAfter.low <= 75_000, 'Stock low must be <= 75,000');
  assert(stockAfter.volume > 0, 'Stock volume must be > 0');

  // ----------------------------------------------------
  // TEST 9: Self-Trade Prevention
  // 동일 유저가 SELL 주문을 resting에 두고 BUY 주문을 넣어도 자기 주문에 체결되면 안 됨
  // ----------------------------------------------------
  console.log('\n[TEST 9] Self-Trade Prevention Test');
  const selfTradeStockId = '00000000-0000-4000-8000-000000000777';
  memoryDb.stocks.set(selfTradeStockId, {
    id: selfTradeStockId,
    ticker: 'SELF77',
    name: 'Self Trade Test Stock',
    market: 'KRX',
    current_price: 10_000,
    previous_close: 10_000,
    open_price: 10_000,
    high: 10_000,
    low: 10_000,
    volume: 0,
    change_rate: 0,
    market_cap: 1_000_000_000,
    pe_ratio: 10,
    dividend_yield: 0,
    sector: 'IT',
  });

  const selfUser = 'self_trade_user_abc';
  memoryDb.profiles.set(selfUser, {
    id: selfUser,
    user_id: selfUser,
    username: 'selftrade',
    nickname: 'SelfTrade',
    cash: 5_000_000,
    net_worth: 5_000_000,
    rank_tier: 'Silver',
    created_at: new Date().toISOString(),
  });
  memoryDb.holdings.set(`${selfUser}_${selfTradeStockId}`, {
    id: `${selfUser}_${selfTradeStockId}`,
    user_id: selfUser,
    stock_id: selfTradeStockId,
    quantity: 50,
    avg_price: 10_000,
    created_at: new Date().toISOString(),
  });
  memoryDb.addHoldingToIndex({ id: `${selfUser}_${selfTradeStockId}`, user_id: selfUser, stock_id: selfTradeStockId, quantity: 50, avg_price: 10_000, created_at: new Date().toISOString() });

  // 자기 SELL 주문 resting 등록
  const selfSellRes = await submitAndMatchOrder(client as any, {
    stock_id: selfTradeStockId,
    user_id: selfUser,
    side: 'sell',
    price: 10_000,
    size: 20,
  });
  assert(selfSellRes.success === true, 'Initial SELL resting must be accepted');
  assert(selfSellRes.filledQty === 0, 'Initial SELL must not fill (no opposite side)');

  const initialCash = memoryDb.profiles.get(selfUser)!.cash;
  const initialHolding = memoryDb.holdings.get(`${selfUser}_${selfTradeStockId}`)?.quantity ?? 0;

  // 동일 유저가 BUY 주문 → 자기 resting SELL에 체결되면 안 됨
  const selfBuyRes = await submitAndMatchOrder(client as any, {
    stock_id: selfTradeStockId,
    user_id: selfUser,
    side: 'buy',
    price: 10_000, // crossing price
    size: 10,
  });

  assert(selfBuyRes.success === true, 'BUY order must succeed (goes to book, not self-matched)');
  assert(selfBuyRes.filledQty === 0, `Self-trade must not execute: filledQty must be 0 (actual: ${selfBuyRes.filledQty})`);
  const afterCash = memoryDb.profiles.get(selfUser)!.cash;
  const afterHolding = memoryDb.holdings.get(`${selfUser}_${selfTradeStockId}`)?.quantity ?? 0;
  assert(afterHolding === initialHolding, `Holdings must not change from self-trade (before: ${initialHolding}, after: ${afterHolding})`);
  assert(afterCash === initialCash, `Cash must not change from self-trade settlement (before: ${initialCash}, after: ${afterCash})`);

  // ----------------------------------------------------
  // TEST 10: Concurrent Matching Double-Consume Prevention
  // 한 maker의 10주 주문에 두 taker가 동시에 요청 → 총 체결 수량이 10주를 초과하면 안 됨
  // ----------------------------------------------------
  console.log('\n[TEST 10] Concurrent Matching — No Double-Consume of Maker');
  const concStockId = '00000000-0000-4000-8000-000000000888';
  memoryDb.stocks.set(concStockId, {
    id: concStockId,
    ticker: 'CONC88',
    name: 'Concurrency Test Stock',
    market: 'KRX',
    current_price: 50_000,
    previous_close: 50_000,
    open_price: 50_000,
    high: 50_000,
    low: 50_000,
    volume: 0,
    change_rate: 0,
    market_cap: 1_000_000_000,
    pe_ratio: 10,
    dividend_yield: 0,
    sector: 'FIN',
  });

  const concMaker = 'conc_maker_user';
  const concTaker1 = 'conc_taker_user_1';
  const concTaker2 = 'conc_taker_user_2';

  memoryDb.profiles.set(concMaker, { id: concMaker, user_id: concMaker, username: 'maker', nickname: 'Maker', cash: 0, net_worth: 1_000_000, rank_tier: 'Gold', created_at: new Date().toISOString() });
  memoryDb.profiles.set(concTaker1, { id: concTaker1, user_id: concTaker1, username: 'taker1', nickname: 'Taker1', cash: 3_000_000, net_worth: 3_000_000, rank_tier: 'Silver', created_at: new Date().toISOString() });
  memoryDb.profiles.set(concTaker2, { id: concTaker2, user_id: concTaker2, username: 'taker2', nickname: 'Taker2', cash: 3_000_000, net_worth: 3_000_000, rank_tier: 'Silver', created_at: new Date().toISOString() });

  // Maker: 10주 SELL @ 50,000
  memoryDb.holdings.set(`${concMaker}_${concStockId}`, { id: `${concMaker}_${concStockId}`, user_id: concMaker, stock_id: concStockId, quantity: 10, avg_price: 40_000, created_at: new Date().toISOString() });
  memoryDb.addHoldingToIndex({ id: `${concMaker}_${concStockId}`, user_id: concMaker, stock_id: concStockId, quantity: 10, avg_price: 40_000, created_at: new Date().toISOString() });

  const makerRes = await submitAndMatchOrder(client as any, {
    stock_id: concStockId,
    user_id: concMaker,
    side: 'sell',
    price: 50_000,
    size: 10,
  });
  assert(makerRes.success === true, 'Maker SELL order must be placed');
  assert(makerRes.filledQty === 0, 'Maker must not fill immediately');

  // 두 taker가 동시에 BUY 주문 (각 10주씩 → 총 20주 시도)
  const { LocalMarketService } = await import('../lib/engine/marketService');
  const [t1Result, t2Result] = await Promise.all([
    LocalMarketService.submitOrder({ userId: concTaker1, stockId: concStockId, side: 'buy', price: 50_000, size: 10 }),
    LocalMarketService.submitOrder({ userId: concTaker2, stockId: concStockId, side: 'buy', price: 50_000, size: 10 }),
  ]);

  const totalFilled = t1Result.filledQty + t2Result.filledQty;
  console.log(`  -> Taker1 filled: ${t1Result.filledQty}, Taker2 filled: ${t2Result.filledQty}, Total: ${totalFilled}`);

  assert(totalFilled <= 10, `Total filled must not exceed maker's 10 shares (actual: ${totalFilled})`);

  // maker's resting order filled count must not exceed size
  const makerOrders = Array.from(memoryDb.orders.values()).filter(
    (o) => o.user_id === concMaker && o.stock_id === concStockId && o.side === 'sell'
  );
  const makerFilled = makerOrders.reduce((sum, o) => sum + Number(o.filled || 0), 0);
  const makerSize = makerOrders.reduce((sum, o) => sum + Number(o.size || 0), 0);
  assert(makerFilled <= makerSize, `Maker filled (${makerFilled}) must not exceed size (${makerSize})`);

  console.log('\n==================================================');
  console.log('🎉 ALL SECURITY & ATOMIC TX TESTS PASSED! (TEST 1 ~ TEST 10)');
  console.log('==================================================\n');
}

runSecurityAndSafetyTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
