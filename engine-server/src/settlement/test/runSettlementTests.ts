import { OptionSettlementEngine } from '../OptionSettlementEngine';
import { BondCouponEngine } from '../BondCouponEngine';
import { OptionContract, OptionPosition, BondItem, BondPosition } from '../types';

async function runSettlementTestSuite() {
  console.log('================================================================');
  console.log('🏦 [SETTLEMENT ENGINE] 옵션 만기 결제 & 채권 이자/상환 검증 시작');
  console.log('================================================================\n');

  let passedTests = 0;
  const totalTests = 5;

  const optEngine = new OptionSettlementEngine();
  const bondEngine = new BondCouponEngine();

  // ── [TEST 1] 콜/풋 옵션 ITM/OTM 정산 수학 모델 검증 ──
  console.log('▶ [TEST 1] 콜/풋 옵션 ITM/OTM 차액 결제 계산 검증');

  // 콜 옵션 (K=300, S=320 -> ITM, 차액 20pt)
  const callContract: OptionContract = {
    id: 'opt_call_300',
    underlying_stock_id: 'stock_kospi200',
    type: 'CALL',
    strike_price: 300,
    current_price: 20,
    expiry_date: new Date(Date.now() - 1000).toISOString(), // 이미 만기 지남
    open_interest: 100,
    volume: 50,
  };
  const callPos: OptionPosition = {
    userId: 'user_alpha',
    optionId: 'opt_call_300',
    quantity: 10, // 10계약
    avgPrice: 5,
  };

  const callResult = optEngine.calculateSettlement({
    contract: callContract,
    position: callPos,
    underlyingClosePrice: 320,
    multiplier: 250000,
  });

  const expectedCallPayout = (320 - 300) * 10 * 250000; // 50,000,000원
  console.log(`  [Call ITM] 종가: 320, 행사가: 300, 수량: 10 -> 결제금액: ₩${callResult.payoutAmount.toLocaleString()} (기대치: ₩${expectedCallPayout.toLocaleString()})`);

  // 풋 옵션 (K=300, S=320 -> OTM, 외가격 소멸)
  const putContractOtm: OptionContract = {
    id: 'opt_put_300',
    underlying_stock_id: 'stock_kospi200',
    type: 'PUT',
    strike_price: 300,
    current_price: 0.1,
    expiry_date: new Date(Date.now() - 1000).toISOString(),
    open_interest: 100,
    volume: 50,
  };
  const putPosOtm: OptionPosition = {
    userId: 'user_alpha',
    optionId: 'opt_put_300',
    quantity: 10,
    avgPrice: 4,
  };

  const putResultOtm = optEngine.calculateSettlement({
    contract: putContractOtm,
    position: putPosOtm,
    underlyingClosePrice: 320,
    multiplier: 250000,
  });
  console.log(`  [Put OTM] 종가: 320, 행사가: 300, 수량: 10 -> 결제금액: ₩${putResultOtm.payoutAmount.toLocaleString()} (외가격 소멸: ${!putResultOtm.isItm})`);

  if (callResult.payoutAmount === expectedCallPayout && putResultOtm.payoutAmount === 0 && !putResultOtm.isItm) {
    console.log('  결과: ✅ PASS (콜 ITM 차액 결제 및 풋 OTM 소멸 정상)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  // ── [TEST 2] 풋 옵션 ITM 내가격 결제 검증 ──
  console.log('\n▶ [TEST 2] 풋 옵션 ITM (K=350, S=320) 차액 결제 검증');
  const putContractItm: OptionContract = {
    id: 'opt_put_350',
    underlying_stock_id: 'stock_kospi200',
    type: 'PUT',
    strike_price: 350,
    current_price: 30,
    expiry_date: new Date(Date.now() - 1000).toISOString(),
    open_interest: 100,
    volume: 50,
  };
  const putPosItm: OptionPosition = {
    userId: 'user_beta',
    optionId: 'opt_put_350',
    quantity: 5, // 5계약
    avgPrice: 10,
  };

  const putResultItm = optEngine.calculateSettlement({
    contract: putContractItm,
    position: putPosItm,
    underlyingClosePrice: 320,
    multiplier: 250000,
  });

  const expectedPutPayout = (350 - 320) * 5 * 250000; // 37,500,000원
  console.log(`  [Put ITM] 종가: 320, 행사가: 350, 수량: 5 -> 결제금액: ₩${putResultItm.payoutAmount.toLocaleString()} (기대치: ₩${expectedPutPayout.toLocaleString()})`);

  if (putResultItm.payoutAmount === expectedPutPayout && putResultItm.isItm) {
    console.log('  결과: ✅ PASS (풋 ITM 차액 결제 정상)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  // ── [TEST 3] 채권 정기 분기 쿠폰 이자 및 만기 원금 상환 검증 ──
  console.log('\n▶ [TEST 3] 채권 분기별 쿠폰 이자 및 만기 상환액 계산 검증');

  const bondGov: BondItem = {
    id: 'bond_kr_gov_3y',
    ticker: 'KR3Y',
    name: '국고채 3년물',
    bond_type: 'govt',
    maturity: '3Y',
    coupon_rate: 3.5, // 연 3.5%
    face_value: 10000,
    current_price: 100,
  };
  const bondPos: BondPosition = {
    userId: 'user_gamma',
    bondId: 'bond_kr_gov_3y',
    quantity: 1000, // 1,000주 (액면가 1,000만원)
    avgPrice: 100,
  };

  const couponResult = bondEngine.calculateCouponPayment({
    bond: bondGov,
    position: bondPos,
    periodKey: '2026_Q3',
    paymentsPerYear: 4,
  });

  // 분기 이자 = 1,000 * 10,000 * (0.035 / 4) = 87,500원
  const expectedCoupon = Math.round(1000 * 10000 * (0.035 / 4));
  console.log(`  [쿠폰 지급] 수량: 1000주, 쿠폰금리: 3.5%, 분기이자: ₩${couponResult.paymentAmount.toLocaleString()} (기대치: ₩${expectedCoupon.toLocaleString()})`);

  // 만기 원금 상환
  const redemptionResult = bondEngine.calculateMaturityRedemption({
    bond: bondGov,
    position: bondPos,
    periodKey: '2026_Q3',
  });
  const expectedPrincipal = 1000 * 10000; // 10,000,000원
  console.log(`  [만기 원금상환] 수량: 1000주 -> 원금지급: ₩${redemptionResult.paymentAmount.toLocaleString()} (기대치: ₩${expectedPrincipal.toLocaleString()})`);

  if (Math.abs(couponResult.paymentAmount - expectedCoupon) < 1 && Math.abs(redemptionResult.paymentAmount - expectedPrincipal) < 1) {
    console.log('  결과: ✅ PASS (쿠폰 및 만기 원금 상환 계산 정상)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  // ── [TEST 4] 옵션 만기 & 채권 쿠폰 일괄 배치 실행 검증 ──
  console.log('\n▶ [TEST 4] 옵션 만기 & 채권 쿠폰 일괄 배치 실행 (executeSettlementBatch & executeCouponBatch)');
  const batchRes = await optEngine.executeSettlementBatch({
    contracts: [callContract, putContractOtm, putContractItm],
    positions: [callPos, putPosOtm, putPosItm],
    underlyingPrices: { stock_kospi200: 320 },
  });

  console.log(`  - 정산된 옵션 계약 수: ${batchRes.settledCount}건 (ITM: ${batchRes.itmCount}건, OTM: ${batchRes.otmCount}건)`);
  console.log(`  - 총 옵션 정산 지급액: ₩${batchRes.totalPayout.toLocaleString()}`);

  const initialCouponRes = await bondEngine.executeCouponBatch({
    bonds: [bondGov],
    positions: [bondPos],
    currentPeriodKey: '2026_Q3',
  });
  console.log(`  - 지급된 채권 이자 건수: ${initialCouponRes.couponCount}건 (지급액: ₩${initialCouponRes.totalCouponPaid.toLocaleString()})`);

  if (batchRes.settledCount === 3 && batchRes.itmCount === 2 && initialCouponRes.couponCount === 1) {
    console.log('  결과: ✅ PASS (일괄 정산 및 쿠폰 지급 배치 정상)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL');
  }

  // ── [TEST 5] 서버 재시작 및 중복 실행 시 멱등성(Idempotency) 방어 검증 ──
  console.log('\n▶ [TEST 5] 서버 재시작 / 중복 실행 시 멱등성 (이중 정산 차단) 검증');
  const duplicateBatchRes = await optEngine.executeSettlementBatch({
    contracts: [callContract, putContractOtm, putContractItm],
    positions: [callPos, putPosOtm, putPosItm],
    underlyingPrices: { stock_kospi200: 320 },
  });

  console.log(`  - 2회차 옵션 재실행 정산 건수: ${duplicateBatchRes.settledCount}건 (기대치: 0건)`);
  console.log(`  - 2회차 옵션 재실행 지급액: ₩${duplicateBatchRes.totalPayout.toLocaleString()} (기대치: ₩0)`);

  const duplicateCouponRes = await bondEngine.executeCouponBatch({
    bonds: [bondGov],
    positions: [bondPos],
    currentPeriodKey: '2026_Q3',
  });
  console.log(`  - 2회차 채권 재실행 이자 건수: ${duplicateCouponRes.couponCount}건 (기대치: 0건)`);
  console.log(`  - 2회차 채권 재실행 이자 지급액: ₩${duplicateCouponRes.totalCouponPaid.toLocaleString()} (기대치: ₩0)`);

  if (duplicateBatchRes.settledCount === 0 && duplicateCouponRes.couponCount === 0) {
    console.log('  결과: ✅ PASS (이중 정산 및 중복 쿠폰 지급 100% 완벽 방어)');
    passedTests++;
  } else {
    console.error('  결과: ❌ FAIL (중복 지급 발생)');
  }

  console.log('\n================================================================');
  if (passedTests === totalTests) {
    console.log(`🏁 [최종 결과] 옵션/채권 정산 배치 엔진 검증: 모든 테스트 통과 (${passedTests}/${totalTests}) 100% ✅`);
  } else {
    console.log(`🏁 [최종 결과] 옵션/채권 정산 배치 엔진 검증: 일부 실패 (${passedTests}/${totalTests}) ❌`);
  }
  console.log('================================================================\n');
}

runSettlementTestSuite().catch(console.error);
