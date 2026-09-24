/**
 * Settlement Engine Legacy Harness — repository 기반 실행으로 전환
 *
 * 이전 harness는 0-arg 생성자와 private in-memory 멱등성 Set에 의존했다.
 * 이제 실제 MemoryDatabase + RepositoryBundle + SimulationTimeSource를 주입받아
 * 옵션/채권 정산이 authoritative repository 경로를 실제로 통과함을 검증한다.
 *
 * 기존 5개 검증 항목의 판정 기준은 그대로 유지한다.
 */

import { MemoryDatabase } from '../../../../lib/memoryDb/memoryStore';
import { createInMemoryRepositoryBundle } from '../../../../lib/repositories/inMemory';
import { StaticTimeSource } from '../../../../lib/engine/simulation/runtime/simulationTimeSource';
import { OptionSettlementEngine } from '../OptionSettlementEngine';
import { BondCouponEngine } from '../BondCouponEngine';
import { OptionContract, OptionPosition, BondItem, BondPosition } from '../types';

const SIM_NOW = 1774000000000;
const EXPIRED_AT = new Date(SIM_NOW - 1000).toISOString();
const BOND_MATURITY = new Date(SIM_NOW - 1000).toISOString();

function ensureProfile(db: MemoryDatabase, userId: string, cash: number): void {
  db.profiles.set(userId, {
    id: userId,
    user_id: userId,
    username: userId,
    nickname: userId,
    cash,
    net_worth: cash,
    rank_tier: 'BRONZE',
    created_at: '2026-01-01T00:00:00Z',
  });
  db.profileUserIdIndex.set(userId, userId);
}

function ensureHolding(db: MemoryDatabase, userId: string, assetId: string, quantity: number): void {
  const hid = `${userId}_${assetId}`;
  const holding = {
    id: hid,
    user_id: userId,
    stock_id: assetId,
    quantity,
    avg_price: 100,
    created_at: '2026-01-01T00:00:00Z',
  };
  db.holdings.set(hid, holding);
  db.addHoldingToIndex(holding);
}

function seedSettlementFixtures(db: MemoryDatabase): void {
  db.stocks.set('stock_kospi200', {
    id: 'stock_kospi200',
    ticker: 'KOSPI200',
    name: 'KOSPI 200',
    market: 'domestic',
    current_price: 320,
    previous_close: 320,
    high: 320,
    low: 320,
    open_price: 320,
    volume: 1000,
    change_rate: 0,
    market_cap: 0,
    pe_ratio: 0,
    dividend_yield: 0,
    sector: 'index',
  });

  const options = [
    { id: 'opt_call_300', underlying_stock_id: 'stock_kospi200', ticker: 'CALL300', type: 'CALL', option_type: 'CALL', strike_price: 300, current_price: 20, expiry_date: EXPIRED_AT, open_interest: 100, volume: 50 },
    { id: 'opt_put_300', underlying_stock_id: 'stock_kospi200', ticker: 'PUT300', type: 'PUT', option_type: 'PUT', strike_price: 300, current_price: 0.1, expiry_date: EXPIRED_AT, open_interest: 100, volume: 50 },
    { id: 'opt_put_350', underlying_stock_id: 'stock_kospi200', ticker: 'PUT350', type: 'PUT', option_type: 'PUT', strike_price: 350, current_price: 30, expiry_date: EXPIRED_AT, open_interest: 100, volume: 50 },
  ];
  for (const o of options) db.optionsContracts.set(o.id, o as never);

  db.bonds.set('bond_kr_gov_3y', {
    id: 'bond_kr_gov_3y',
    ticker: 'KR3Y',
    name: '국고채 3년물',
    bond_type: 'govt',
    maturity: '3Y',
    maturity_date: BOND_MATURITY,
    coupon_rate: 3.5,
    face_value: 10000,
    current_price: 100,
  } as never);

  ensureProfile(db, 'user_alpha', 1000);
  ensureProfile(db, 'user_beta', 1000);
  ensureProfile(db, 'user_gamma', 1000);

  ensureHolding(db, 'user_alpha', 'opt_call_300', 10);
  ensureHolding(db, 'user_alpha', 'opt_put_300', 10);
  ensureHolding(db, 'user_beta', 'opt_put_350', 5);
  ensureHolding(db, 'user_gamma', 'bond_kr_gov_3y', 1000);
}

async function runSettlementTestSuite() {
  console.log('================================================================');
  console.log('[SETTLEMENT ENGINE] expiry settlement & bond coupon (repository-backed)');
  console.log('================================================================\n');

  let passedTests = 0;
  const totalTests = 5;

  const db = new MemoryDatabase();
  seedSettlementFixtures(db);
  const repositories = createInMemoryRepositoryBundle(db);
  const clock = new StaticTimeSource(SIM_NOW);

  const optEngine = new OptionSettlementEngine(repositories, clock);
  const bondEngine = new BondCouponEngine(repositories, clock);

  const callContract: OptionContract = {
    id: 'opt_call_300',
    underlying_stock_id: 'stock_kospi200',
    type: 'CALL',
    option_type: 'CALL',
    strike_price: 300,
    current_price: 20,
    expiry_date: EXPIRED_AT,
    open_interest: 100,
    volume: 50,
  };
  const callPos: OptionPosition = { userId: 'user_alpha', optionId: 'opt_call_300', quantity: 10, avgPrice: 5 };

  // ── [TEST 1] 콜 ITM / 풋 OTM 계산 ──
  console.log('\n▶ [TEST 1] Call ITM / Put OTM payout calculation');
  const callResult = optEngine.calculateSettlement({ contract: callContract, position: callPos, underlyingClosePrice: 320, multiplier: 250000 });
  const expectedCallPayout = (320 - 300) * 10 * 250000;
  console.log(`  [Call ITM] payout: ₩${callResult.payoutAmount.toLocaleString()} (expected ₩${expectedCallPayout.toLocaleString()})`);

  const putContractOtm: OptionContract = {
    id: 'opt_put_300', underlying_stock_id: 'stock_kospi200', type: 'PUT', option_type: 'PUT',
    strike_price: 300, current_price: 0.1, expiry_date: EXPIRED_AT, open_interest: 100, volume: 50,
  };
  const putPosOtm: OptionPosition = { userId: 'user_alpha', optionId: 'opt_put_300', quantity: 10, avgPrice: 4 };
  const putResultOtm = optEngine.calculateSettlement({ contract: putContractOtm, position: putPosOtm, underlyingClosePrice: 320, multiplier: 250000 });

  if (callResult.payoutAmount === expectedCallPayout && putResultOtm.payoutAmount === 0 && !putResultOtm.isItm) {
    console.log('  결과: ✅ PASS'); passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  // ── [TEST 2] 풋 ITM 계산 ──
  console.log('\n▶ [TEST 2] Put ITM (K=350, S=320) payout calculation');
  const putContractItm: OptionContract = {
    id: 'opt_put_350', underlying_stock_id: 'stock_kospi200', type: 'PUT', option_type: 'PUT',
    strike_price: 350, current_price: 30, expiry_date: EXPIRED_AT, open_interest: 100, volume: 50,
  };
  const putPosItm: OptionPosition = { userId: 'user_beta', optionId: 'opt_put_350', quantity: 5, avgPrice: 10 };
  const putResultItm = optEngine.calculateSettlement({ contract: putContractItm, position: putPosItm, underlyingClosePrice: 320, multiplier: 250000 });
  const expectedPutPayout = (350 - 320) * 5 * 250000;
  console.log(`  [Put ITM] payout: ₩${putResultItm.payoutAmount.toLocaleString()} (expected ₩${expectedPutPayout.toLocaleString()})`);

  if (putResultItm.payoutAmount === expectedPutPayout && putResultItm.isItm) {
    console.log('  결과: ✅ PASS'); passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  // ── [TEST 3] 채권 쿠폰/상환 계산 ──
  console.log('\n▶ [TEST 3] Bond quarterly coupon & maturity redemption calculation');
  const bondGov: BondItem = {
    id: 'bond_kr_gov_3y', ticker: 'KR3Y', name: '국고채 3년물', bond_type: 'govt',
    maturity: '3Y', coupon_rate: 3.5, face_value: 10000, current_price: 100,
  };
  const bondPos: BondPosition = { userId: 'user_gamma', bondId: 'bond_kr_gov_3y', quantity: 1000, avgPrice: 100 };

  const couponResult = bondEngine.calculateCouponPayment({ bond: bondGov, position: bondPos, periodKey: '2026_Q3', paymentsPerYear: 4 });
  const expectedCoupon = Math.round(1000 * 10000 * (0.035 / 4));
  console.log(`  [쿠폰] ₩${couponResult.paymentAmount.toLocaleString()} (expected ₩${expectedCoupon.toLocaleString()})`);

  const redemptionResult = bondEngine.calculateMaturityRedemption({ bond: bondGov, position: bondPos, periodKey: '2026_Q3' });
  const expectedPrincipal = 1000 * 10000;
  console.log(`  [만기상환] ₩${redemptionResult.paymentAmount.toLocaleString()} (expected ₩${expectedPrincipal.toLocaleString()})`);

  if (Math.abs(couponResult.paymentAmount - expectedCoupon) < 1 && Math.abs(redemptionResult.paymentAmount - expectedPrincipal) < 1) {
    console.log('  결과: ✅ PASS'); passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  // ── [TEST 4] 배치 실행 (authoritative repository 경로) ──
  console.log('\n▶ [TEST 4] executeSettlementBatch & executeCouponBatch via repositories');
  const batchRes = await optEngine.executeSettlementBatch({
    contracts: [callContract, putContractOtm, putContractItm],
    positions: [callPos, putPosOtm, putPosItm],
    underlyingPrices: { stock_kospi200: 320 },
    now: SIM_NOW,
  });
  console.log(`  - 옵션 정산 ${batchRes.settledCount}건 (ITM: ${batchRes.itmCount}건, OTM: ${batchRes.otmCount}건)`);
  console.log(`  - 옵션 지급 합계: ₩${batchRes.totalPayout.toLocaleString()}`);

  // 채권은 만기일이 지났으므로 만기 상환 경로를 검증한다.
  const initialCouponRes = await bondEngine.executeCouponBatch({
    bonds: [bondGov],
    positions: [bondPos],
    periodKey: '2026_Q3',
    now: SIM_NOW,
  });
  const bondSettled = initialCouponRes.couponCount + initialCouponRes.redemptionCount;
  console.log(`  - 채권 정산 ${bondSettled}건 (coupon: ${initialCouponRes.couponCount}, redemption: ${initialCouponRes.redemptionCount})`);

  const bondAfter = db.profiles.get('user_gamma')?.cash ?? 0;
  const optionAfterAlpha = db.profiles.get('user_alpha')?.cash ?? 0;
  const optionAfterBeta = db.profiles.get('user_beta')?.cash ?? 0;
  console.log(`  - 잔고: alpha=${optionAfterAlpha}, beta=${optionAfterBeta}, gamma=${bondAfter}`);

  if (batchRes.settledCount === 3 && batchRes.itmCount === 2 && bondSettled === 1) {
    console.log('  결과: ✅ PASS'); passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  // ── [TEST 5] 재실행 멱등성 (authoritative ledger 기준) ──
  console.log('\n▶ [TEST 5] Re-run idempotency via authoritative settlement ledger');
  const duplicateBatchRes = await optEngine.executeSettlementBatch({
    contracts: [callContract, putContractOtm, putContractItm],
    positions: [callPos, putPosOtm, putPosItm],
    underlyingPrices: { stock_kospi200: 320 },
    now: SIM_NOW,
  });
  console.log(`  - 2차 옵션 정산: ${duplicateBatchRes.settledCount}건 (기대 0건)`);

  const duplicateCouponRes = await bondEngine.executeCouponBatch({
    bonds: [bondGov],
    positions: [bondPos],
    periodKey: '2026_Q3',
    now: SIM_NOW,
  });
  const duplicateBondSettled = duplicateCouponRes.couponCount + duplicateCouponRes.redemptionCount;
  console.log(`  - 2차 채권 정산: ${duplicateBondSettled}건 (기대 0건)`);

  const alphaUnchanged = (db.profiles.get('user_alpha')?.cash ?? 0) === optionAfterAlpha;
  const betaUnchanged = (db.profiles.get('user_beta')?.cash ?? 0) === optionAfterBeta;
  const gammaUnchanged = (db.profiles.get('user_gamma')?.cash ?? 0) === bondAfter;

  if (duplicateBatchRes.settledCount === 0 && duplicateBondSettled === 0 && alphaUnchanged && betaUnchanged && gammaUnchanged) {
    console.log('  결과: ✅ PASS'); passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  console.log('\n================================================================');
  if (passedTests === totalTests) {
    console.log(`🎉 ALL ${totalTests} SETTLEMENT ENGINE TESTS PASSED`);
    console.log('================================================================');
    process.exit(0);
  } else {
    console.error(`💥 ${totalTests - passedTests} TEST(S) FAILED`);
    console.log('================================================================');
    process.exit(1);
  }
}

runSettlementTestSuite().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
