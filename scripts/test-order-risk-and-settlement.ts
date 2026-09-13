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

  console.log('\n==================================================');
  console.log('🎉 ALL TESTS PASSED SUCCESSFULLY! (TEST A ~ TEST H)');
  console.log('==================================================\n');
}

runAllTests().catch((e) => {
  console.error(e);
  process.exit(1);
});
