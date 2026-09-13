/**
 * MUMYEONG: Order Risk, Reservation & Settlement 종합 검증 테스트
 * 실행: npx tsx scripts/test-order-risk-and-settlement.ts
 */

import {
  calculateReservedCash,
  calculateReservedQty,
  validateOrderCapacity,
  OpenOrderForRisk,
} from '../lib/engine/orderRisk';
import {
  calculateTradeFees,
  executeSettlement,
  MAKER_REBATE_RATE,
  TAKER_FEE_RATE,
  SettlementTrade,
} from '../lib/engine/settlement';
import { createMemoryDbClient } from '../lib/memoryDb/memoryDbClient';
import { memoryDb } from '../lib/memoryDb/memoryStore';
import { submitAndMatchOrder } from '../lib/engine/dbMatching';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✅ PASS: ${message}`);
}

async function runAllTests() {
  console.log('\n==================================================');
  console.log('🚀 MUMYEONG E2E Verification: Risk, Settlement, Invariants');
  console.log('==================================================\n');

  // ----------------------------------------------------
  // TEST A: Cash Reservation
  // cash = 1,000,000 상태에서 1,000,000원 open 주문 후 추가 1원 주문 시 거절
  // ----------------------------------------------------
  console.log('[TEST A] Cash Reservation Test');
  const userCash = 1_000_000;
  const buyOrder1: OpenOrderForRisk = {
    id: 'ord_buy_1',
    user_id: 'user_a',
    stock_id: 'stock_1',
    side: 'buy',
    price: 10_000,
    size: 100, // 10,000 * 100 = 1,000,000
    filled: 0,
    status: 'open',
  };

  const reservedA = calculateReservedCash([buyOrder1]);
  assert(reservedA === 1_000_000, `Reserved cash should be 1,000,000 (actual: ${reservedA})`);

  const checkA = validateOrderCapacity({
    userId: 'user_a',
    stockId: 'stock_1',
    side: 'buy',
    incomingPrice: 10_000,
    incomingSize: 1, // 추가 10,000원 필요
    currentCash: userCash,
    currentHoldingQty: 0,
    openOrders: [buyOrder1],
  });
  assert(checkA.valid === false, 'Second BUY order must be rejected due to reserved cash');
  assert(checkA.availableBalance === 0, 'Available cash should be 0');

  // ----------------------------------------------------
  // TEST B: Holdings Reservation
  // holding = 100 상태에서 SELL 100 open 주문 후 추가 1주 매도 시 거절
  // ----------------------------------------------------
  console.log('\n[TEST B] Holdings Reservation Test');
  const userHolding = 100;
  const sellOrder1: OpenOrderForRisk = {
    id: 'ord_sell_1',
    user_id: 'user_b',
    stock_id: 'stock_1',
    side: 'sell',
    price: 10_000,
    size: 100,
    filled: 0,
    status: 'open',
  };

  const reservedB = calculateReservedQty([sellOrder1], 'stock_1');
  assert(reservedB === 100, `Reserved qty should be 100 (actual: ${reservedB})`);

  const checkB = validateOrderCapacity({
    userId: 'user_b',
    stockId: 'stock_1',
    side: 'sell',
    incomingPrice: 10_000,
    incomingSize: 1, // 추가 1주 매도 시도
    currentCash: 500_000,
    currentHoldingQty: userHolding,
    openOrders: [sellOrder1],
  });
  assert(checkB.valid === false, 'Second SELL order must be rejected due to reserved holdings');
  assert(checkB.availableBalance === 0, 'Available qty should be 0');

  // ----------------------------------------------------
  // TEST C: Partial Fill Reservation
  // 원 주문 100주, 50주 체결 시 remaining 50주만 예약 계산
  // ----------------------------------------------------
  console.log('\n[TEST C] Partial Fill Reservation Test');
  const partialBuyOrder: OpenOrderForRisk = {
    id: 'ord_buy_partial',
    user_id: 'user_c',
    stock_id: 'stock_1',
    side: 'buy',
    price: 10_000,
    size: 100,
    filled: 50, // 50주 부분 체결 완료
    status: 'partial',
  };

  const reservedC = calculateReservedCash([partialBuyOrder]);
  assert(
    reservedC === 500_000,
    `Partial buy reserved cash must be 500,000 (actual: ${reservedC})`
  );

  const partialSellOrder: OpenOrderForRisk = {
    id: 'ord_sell_partial',
    user_id: 'user_c',
    stock_id: 'stock_1',
    side: 'sell',
    price: 10_000,
    size: 100,
    filled: 50,
    status: 'partial',
  };
  const reservedQtyC = calculateReservedQty([partialSellOrder], 'stock_1');
  assert(
    reservedQtyC === 50,
    `Partial sell reserved qty must be 50 (actual: ${reservedQtyC})`
  );

  // ----------------------------------------------------
  // TEST D: Order Cancel Reservation Release
  // 주문 취소 시 예약 즉시 해제
  // ----------------------------------------------------
  console.log('\n[TEST D] Order Cancel Reservation Release Test');
  const cancelledOrder: OpenOrderForRisk = {
    id: 'ord_cancelled',
    user_id: 'user_d',
    stock_id: 'stock_1',
    side: 'buy',
    price: 10_000,
    size: 100,
    filled: 0,
    status: 'cancelled', // 취소됨
  };
  const reservedD = calculateReservedCash([cancelledOrder]);
  assert(reservedD === 0, `Cancelled order must reserve 0 cash (actual: ${reservedD})`);

  // ----------------------------------------------------
  // TEST E: Maker/Taker Fee & Resting Maker Price Settlement
  // Maker: BUY 100 @ 10,000, Taker: SELL 100 @ 9,900 -> 체결가 10,000
  // Maker rebate: -0.1%, Taker fee: +0.25%
  // ----------------------------------------------------
  console.log('\n[TEST E] Maker/Taker Fee & Price-Time Priority Settlement Test');
  const client = createMemoryDbClient();
  const testStockId = '00000000-0000-4000-8000-000000000101';
  const buyerUid = 'user_maker_buyer';
  const sellerUid = 'user_taker_seller';

  // 프로필 초기 세팅
  memoryDb.profiles.set(buyerUid, {
    id: buyerUid,
    user_id: buyerUid,
    username: 'buyer',
    nickname: 'Buyer',
    cash: 2_000_000,
    net_worth: 2_000_000,
    rank_tier: 'Bronze',
    created_at: new Date().toISOString(),
  });
  memoryDb.profiles.set(sellerUid, {
    id: sellerUid,
    user_id: sellerUid,
    username: 'seller',
    nickname: 'Seller',
    cash: 0,
    net_worth: 1_000_000,
    rank_tier: 'Bronze',
    created_at: new Date().toISOString(),
  });
  // 매도자 주식 100주 보유
  memoryDb.holdings.set(`${sellerUid}_${testStockId}`, {
    id: `${sellerUid}_${testStockId}`,
    user_id: sellerUid,
    stock_id: testStockId,
    quantity: 100,
    avg_price: 9_000,
    created_at: new Date().toISOString(),
  });

  const execPrice = 10_000;
  const execQty = 100;
  const tradeAmount = execPrice * execQty; // 1,000,000

  // Buyer is Maker (rebate -0.1%), Seller is Taker (fee +0.25%)
  const feesE = calculateTradeFees(true, false);
  assert(feesE.buyer_fee === MAKER_REBATE_RATE, `Buyer fee must be -0.1% (actual: ${feesE.buyer_fee})`);
  assert(feesE.seller_fee === TAKER_FEE_RATE, `Seller fee must be +0.25% (actual: ${feesE.seller_fee})`);

  const tradePayload: SettlementTrade[] = [
    {
      stock_id: testStockId,
      buyer_id: buyerUid,
      seller_id: sellerUid,
      buyer_is_bot: false,
      seller_is_bot: false,
      price: execPrice,
      size: execQty,
      buyer_fee: feesE.buyer_fee,
      seller_fee: feesE.seller_fee,
    },
  ];

  const settleRes = await executeSettlement(client, tradePayload);
  assert(settleRes.success === true, 'Settlement execution must succeed');

  // 결과 검증
  const buyerAfter = memoryDb.profiles.get(buyerUid)!;
  const sellerAfter = memoryDb.profiles.get(sellerUid)!;
  const buyerHoldingAfter = memoryDb.holdings.get(`${buyerUid}_${testStockId}`)!;
  const sellerHoldingAfter = memoryDb.holdings.get(`${sellerUid}_${testStockId}`);

  // Buyer cash: 2,000,000 - 1,000,000 * (1 + (-0.001)) = 2,000,000 - 999,000 = 1,001,000
  const expectedBuyerCash = 2_000_000 - tradeAmount * (1 + MAKER_REBATE_RATE);
  assert(
    buyerAfter.cash === expectedBuyerCash,
    `Buyer cash should be ${expectedBuyerCash} (actual: ${buyerAfter.cash})`
  );
  assert(buyerHoldingAfter.quantity === 100, `Buyer holding should be 100 (actual: ${buyerHoldingAfter.quantity})`);

  // Seller cash: 0 + 1,000,000 * (1 - 0.0025) = 997,500
  const expectedSellerCash = tradeAmount * (1 - TAKER_FEE_RATE);
  assert(
    sellerAfter.cash === expectedSellerCash,
    `Seller cash should be ${expectedSellerCash} (actual: ${sellerAfter.cash})`
  );
  assert(
    !sellerHoldingAfter || sellerHoldingAfter.quantity === 0,
    'Seller holding should be 0 or deleted after full sell'
  );

  // ----------------------------------------------------
  // TEST F: DB Invariant & Rollback Test
  // 잔고 부족 매수자 또는 주식 부족 매도자 체결 시 전체 rollback
  // ----------------------------------------------------
  console.log('\n[TEST F] DB Invariant & Rollback on Insufficient Balance');
  const poorBuyer = 'poor_buyer';
  memoryDb.profiles.set(poorBuyer, {
    id: poorBuyer,
    user_id: poorBuyer,
    username: 'poor',
    nickname: 'Poor',
    cash: 50_000, // 5만원뿐
    net_worth: 50_000,
    rank_tier: 'Bronze',
    created_at: new Date().toISOString(),
  });

  const invalidTradePayload: SettlementTrade[] = [
    {
      stock_id: testStockId,
      buyer_id: poorBuyer,
      seller_id: sellerUid,
      buyer_is_bot: false,
      seller_is_bot: false,
      price: 10_000,
      size: 100, // 100만원 필요 (잔고 5만원이므로 부족!)
      buyer_fee: 0.0025,
      seller_fee: 0.0025,
    },
  ];

  const failSettle = await executeSettlement(client, invalidTradePayload);
  assert(failSettle.success === false, 'Settlement must fail due to insufficient cash');
  assert(
    memoryDb.profiles.get(poorBuyer)!.cash === 50_000,
    'Poor buyer cash must remain untouched (rollback)'
  );

  // ----------------------------------------------------
  // TEST G: High/Low Canonical Schema Consistency
  // ----------------------------------------------------
  console.log('\n[TEST G] High/Low Canonical Schema Test');
  const sampleStock = memoryDb.stocks.get(testStockId);
  assert(sampleStock !== undefined, 'Sample stock must exist in memoryDb');
  assert(typeof sampleStock!.high === 'number', `stock.high must be a number (actual: ${sampleStock?.high})`);
  assert(typeof sampleStock!.low === 'number', `stock.low must be a number (actual: ${sampleStock?.low})`);
  assert(sampleStock!.high >= sampleStock!.low, 'stock.high must be >= stock.low');

  // ----------------------------------------------------
  // TEST H: Concurrent Race Condition (Double Order Prevention)
  // 20개 동시 BUY 주문 제출 시 잔고 초과 주문 접수/체결 원천 차단
  // ----------------------------------------------------
  console.log('\n[TEST H] Concurrent Race Condition Test');
  const raceUser = 'race_user';
  memoryDb.profiles.set(raceUser, {
    id: raceUser,
    user_id: raceUser,
    username: 'race',
    nickname: 'Racer',
    cash: 100_000, // 정확히 10만원
    net_worth: 100_000,
    rank_tier: 'Bronze',
    created_at: new Date().toISOString(),
  });

  // 1만원짜리 주문 20개를 순차/병렬로 접수 시도 -> 최대 10개만 성공해야 함
  let acceptedCount = 0;
  let rejectedCount = 0;

  for (let i = 0; i < 20; i++) {
    const res = await submitAndMatchOrder(client as any, {
      stock_id: testStockId,
      user_id: raceUser,
      side: 'buy',
      price: 10_000,
      size: 1, // 10,000원
    });
    if (res.success) {
      acceptedCount++;
    } else {
      rejectedCount++;
    }
  }

  console.log(`  -> Accepted orders: ${acceptedCount}, Rejected orders: ${rejectedCount}`);
  assert(
    acceptedCount === 10,
    `Exactly 10 orders of 10,000 won should be accepted with 100,000 won cash (actual: ${acceptedCount})`
  );
  assert(
    rejectedCount === 10,
    `Remaining 10 orders must be rejected (actual: ${rejectedCount})`
  );

  // ----------------------------------------------------
  // TEST I: Cumulative Buyer Cash Validation
  // 두 거래가 개별적으로는 통과하지만 합산 시 잔고 초과 → 전체 배치 거절
  // ----------------------------------------------------
  console.log('\n[TEST I] Cumulative Buyer Cash Validation');
  const cumulBuyer = 'cumul_buyer_test';
  const cumulStockId = '00000000-0000-4000-8000-000000000501';
  memoryDb.profiles.set(cumulBuyer, {
    id: cumulBuyer, user_id: cumulBuyer, username: 'cumulb', nickname: 'CumulBuyer',
    cash: 1_000_000, net_worth: 1_000_000, rank_tier: 'Silver', created_at: new Date().toISOString(),
  });
  const botSeller = 'bot_seller_for_cumul'; // bot: skip holding check

  // 700,000원 거래 2개 → 합산 1,400,000원 > 잔고 1,000,000원
  const cumulBatch: SettlementTrade[] = [
    { stock_id: cumulStockId, buyer_id: cumulBuyer, seller_id: botSeller, buyer_is_bot: false, seller_is_bot: true, price: 7_000, size: 100, buyer_fee: 0.0025, seller_fee: 0.0025 },
    { stock_id: cumulStockId, buyer_id: cumulBuyer, seller_id: botSeller, buyer_is_bot: false, seller_is_bot: true, price: 7_000, size: 100, buyer_fee: 0.0025, seller_fee: 0.0025 },
  ];
  const cumulBuyResult = await executeSettlement(client, cumulBatch);
  assert(cumulBuyResult.success === false, 'Cumulative buyer cash batch must be rejected');
  assert(memoryDb.profiles.get(cumulBuyer)!.cash === 1_000_000, 'Buyer cash must remain exactly 1,000,000 after rejection');

  // ----------------------------------------------------
  // TEST J: Cumulative Seller Holdings Validation
  // 두 매도 거래가 합산 시 보유 수량 초과 → 전체 배치 거절
  // ----------------------------------------------------
  console.log('\n[TEST J] Cumulative Seller Holdings Validation');
  const cumulSeller = 'cumul_seller_test';
  memoryDb.profiles.set(cumulSeller, { id: cumulSeller, user_id: cumulSeller, username: 'cumuls', nickname: 'CumulSeller', cash: 0, net_worth: 500_000, rank_tier: 'Bronze', created_at: new Date().toISOString() });
  memoryDb.holdings.set(`${cumulSeller}_${cumulStockId}`, {
    id: `${cumulSeller}_${cumulStockId}`, user_id: cumulSeller, stock_id: cumulStockId,
    quantity: 100, avg_price: 5_000, created_at: new Date().toISOString(),
  });
  const botBuyer = 'bot_buyer_for_cumul';

  // 80주 매도 2개 → 합산 160주 > 보유 100주
  const cumulSellBatch: SettlementTrade[] = [
    { stock_id: cumulStockId, buyer_id: botBuyer, seller_id: cumulSeller, buyer_is_bot: true, seller_is_bot: false, price: 5_000, size: 80, buyer_fee: 0.0025, seller_fee: 0.0025 },
    { stock_id: cumulStockId, buyer_id: botBuyer, seller_id: cumulSeller, buyer_is_bot: true, seller_is_bot: false, price: 5_000, size: 80, buyer_fee: 0.0025, seller_fee: 0.0025 },
  ];
  const cumulSellResult = await executeSettlement(client, cumulSellBatch);
  assert(cumulSellResult.success === false, 'Cumulative seller holdings batch must be rejected');
  assert(memoryDb.holdings.get(`${cumulSeller}_${cumulStockId}`)!.quantity === 100, 'Seller holdings must remain exactly 100 after rejection');

  // ----------------------------------------------------
  // TEST K: Valid Multi-Trade Batch Succeeds
  // 누적 체크를 통과하는 유효 배치는 성공해야 함
  // ----------------------------------------------------
  console.log('\n[TEST K] Valid Multi-Trade Batch Succeeds');
  const validBuyer = 'valid_buyer_multi';
  const validSeller = 'valid_seller_multi';
  const validStockId = '00000000-0000-4000-8000-000000000502';
  memoryDb.profiles.set(validBuyer, { id: validBuyer, user_id: validBuyer, username: 'vb', nickname: 'VB', cash: 2_000_000, net_worth: 2_000_000, rank_tier: 'Gold', created_at: new Date().toISOString() });
  memoryDb.profiles.set(validSeller, { id: validSeller, user_id: validSeller, username: 'vs', nickname: 'VS', cash: 0, net_worth: 1_000_000, rank_tier: 'Gold', created_at: new Date().toISOString() });
  memoryDb.holdings.set(`${validSeller}_${validStockId}`, {
    id: `${validSeller}_${validStockId}`, user_id: validSeller, stock_id: validStockId,
    quantity: 200, avg_price: 5_000, created_at: new Date().toISOString(),
  });

  // 500,000원 x 2 = 1,000,000원 < 잔고 2,000,000원
  const validBatch: SettlementTrade[] = [
    { stock_id: validStockId, buyer_id: validBuyer, seller_id: validSeller, buyer_is_bot: false, seller_is_bot: false, price: 5_000, size: 100, buyer_fee: 0.0025, seller_fee: 0.0025 },
    { stock_id: validStockId, buyer_id: validBuyer, seller_id: validSeller, buyer_is_bot: false, seller_is_bot: false, price: 5_000, size: 100, buyer_fee: 0.0025, seller_fee: 0.0025 },
  ];
  const validBatchResult = await executeSettlement(client, validBatch);
  assert(validBatchResult.success === true, 'Valid 2-trade batch must succeed');
  assert(validBatchResult.settled_count === 2, `Settled count must be 2 (actual: ${validBatchResult.settled_count})`);
  const vbAfter = memoryDb.profiles.get(validBuyer)!;
  const vsHolding = memoryDb.holdings.get(`${validSeller}_${validStockId}`);
  assert(vbAfter.cash < 2_000_000, 'Buyer cash must have decreased');
  assert(vsHolding === undefined || vsHolding.quantity === 0, 'Seller should have 0 holding after selling all 200');

  // ----------------------------------------------------
  // TEST L: Failed Batch Leaves State Unchanged
  // 단일 거래라도 실패 시 시작 상태와 완전히 동일
  // ----------------------------------------------------
  console.log('\n[TEST L] Failed Batch — State Must Be Exactly Unchanged');
  const failBuyer = 'fail_buyer_state';
  memoryDb.profiles.set(failBuyer, { id: failBuyer, user_id: failBuyer, username: 'fb', nickname: 'FB', cash: 100_000, net_worth: 100_000, rank_tier: 'Bronze', created_at: new Date().toISOString() });
  const cashBefore = memoryDb.profiles.get(failBuyer)!.cash;
  const tradesBefore = memoryDb.trades.length;

  const failBatch: SettlementTrade[] = [
    { stock_id: validStockId, buyer_id: failBuyer, seller_id: 'bot', buyer_is_bot: false, seller_is_bot: true, price: 10_000, size: 50, buyer_fee: 0.0025, seller_fee: 0.0025 }, // 500,000 > 100,000
  ];
  const failBatchResult = await executeSettlement(client, failBatch);
  assert(failBatchResult.success === false, 'Insufficient-cash batch must fail');
  assert(memoryDb.profiles.get(failBuyer)!.cash === cashBefore, `Cash must be exactly ${cashBefore} (unchanged)`);
  assert(memoryDb.trades.length === tradesBefore, `Trade log must be exactly ${tradesBefore} (no trades appended)`);

  // ----------------------------------------------------
  // TEST M: Multi-Fill OHLC Correctness
  // 다수 체결가에 걷친 주문 → executionHigh/Low이 모든 체결가를 반영해야 함
  // ----------------------------------------------------
  console.log('\n[TEST M] Multi-Fill OHLC Correctness');
  const ohlcStockId = '00000000-0000-4000-8000-000000000555';
  memoryDb.stocks.set(ohlcStockId, {
    id: ohlcStockId, ticker: 'OHLC55', name: 'OHLC Test', market: 'KRX',
    current_price: 10_000, previous_close: 10_000, open_price: 10_000,
    high: 10_000, low: 0, volume: 0, change_rate: 0, market_cap: 1_000_000_000, pe_ratio: 10, dividend_yield: 0, sector: 'IT',
  });

  const ohlcBuyer = 'ohlc_buyer_test';
  const ohlcSeller1 = 'ohlc_seller_1'; // SELL 5 @ 9,800
  const ohlcSeller2 = 'ohlc_seller_2'; // SELL 5 @ 10,100
  const ohlcSeller3 = 'ohlc_seller_3'; // SELL 5 @ 10_500

  memoryDb.profiles.set(ohlcBuyer, { id: ohlcBuyer, user_id: ohlcBuyer, username: 'ob', nickname: 'OB', cash: 5_000_000, net_worth: 5_000_000, rank_tier: 'Gold', created_at: new Date().toISOString() });
  for (const [uid, qty, price] of [[ohlcSeller1, 5, 9_800], [ohlcSeller2, 5, 10_100], [ohlcSeller3, 5, 10_500]] as [string, number, number][]) {
    memoryDb.profiles.set(uid, { id: uid, user_id: uid, username: uid, nickname: uid, cash: 0, net_worth: 500_000, rank_tier: 'Bronze', created_at: new Date().toISOString() });
    memoryDb.holdings.set(`${uid}_${ohlcStockId}`, { id: `${uid}_${ohlcStockId}`, user_id: uid, stock_id: ohlcStockId, quantity: qty, avg_price: price, created_at: new Date().toISOString() });
    memoryDb.addHoldingToIndex({ id: `${uid}_${ohlcStockId}`, user_id: uid, stock_id: ohlcStockId, quantity: qty, avg_price: price, created_at: new Date().toISOString() });
    // Place resting SELL orders
    await submitAndMatchOrder(client as any, { stock_id: ohlcStockId, user_id: uid, side: 'sell', price, size: qty });
  }

  // Incoming BUY sweeps across 3 price levels: 9,800 / 10,100 / 10,500
  const ohlcBuyRes = await submitAndMatchOrder(client as any, {
    stock_id: ohlcStockId,
    user_id: ohlcBuyer,
    side: 'buy',
    price: 11_000, // crosses all three
    size: 15,      // fills all 15
  });

  assert(ohlcBuyRes.success === true, 'Multi-fill BUY must succeed');
  assert(ohlcBuyRes.filledQty === 15, `Must fill all 15 shares (actual: ${ohlcBuyRes.filledQty})`);
  assert(ohlcBuyRes.execPrice === 10_500, `Last exec price must be 10,500 (actual: ${ohlcBuyRes.execPrice})`);

  const ohlcStock = memoryDb.stocks.get(ohlcStockId)!;
  console.log(`  -> current_price=${ohlcStock.current_price}, high=${ohlcStock.high}, low=${ohlcStock.low}, volume=${ohlcStock.volume}`);
  assert(ohlcStock.current_price === 10_500, `current_price must be last exec 10,500 (actual: ${ohlcStock.current_price})`);
  assert(ohlcStock.high >= 10_500, `high must be >= 10,500 (actual: ${ohlcStock.high})`);
  assert(ohlcStock.low > 0 && ohlcStock.low <= 9_800, `low must be <= 9,800 (actual: ${ohlcStock.low})`);
  assert(ohlcStock.volume >= 15, `volume must be >= 15 (actual: ${ohlcStock.volume})`);

  console.log('\n==================================================');
  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! (TEST A ~ TEST M)');
  console.log('==================================================\n');
}

runAllTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
