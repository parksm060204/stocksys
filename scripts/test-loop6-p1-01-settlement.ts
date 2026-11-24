/**
 * scripts/test-loop6-p1-01-settlement.ts
 *
 * 6차 독립 검증 P1-01(L5-02 잔여) 만기 정산 시간 계약 및 계좌 잠금 일관성 회귀 검증 스위트.
 * - 격리된 임시 STOCKSYS_DATA_DIR만 사용합니다.
 * - 운영 .data/ 또는 실제 계정·설정을 변경하지 않습니다.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-loop6-'));
const tmpDataDir = path.join(tmpRoot, 'data');
fs.mkdirSync(tmpDataDir, { recursive: true });
process.env.STOCKSYS_DATA_DIR = tmpDataDir;

async function testTimeContractFixedReferenceAndNextBatch(): Promise<void> {
  console.log('▶ [L6-01] 단일 기준시각 고정 계약 및 구간 경계 종목 다음 배치 이월 검증');

  const { memoryDb } = await import('../lib/memoryDb/memoryStore');
  const { createInMemoryRepositoryBundle } = await import('../lib/repositories/inMemory');
  const { LocalMarketEngineInstance, ensureLocalStandaloneReady, getLocalStandaloneEngine } = await import('../lib/engine/localStandaloneServer');
  const { SettlementBatchService } = await import('../engine-server/src/settlement/SettlementBatchService');
  const { withAccountLocks } = await import('../lib/memoryDb/accountLocks');

  await ensureLocalStandaloneReady();
  getLocalStandaloneEngine()?.stop();

  // 1. SettlementBatchService.runDailySettlementBatch(fixedNowMs) 직접 시간 계약 검증
  let clockNow = 1_780_000_000_000;
  const isoDb = memoryDb;
  isoDb.resetToSeedData({ suppressPublish: true });
  isoDb.profiles.clear();
  isoDb.holdings.clear();
  isoDb.orders.clear();
  isoDb.optionsContracts.clear();
  isoDb.bonds.clear();
  isoDb.settlementLedger.clear();
  isoDb.optionSettlements = [];
  isoDb.bondCouponPayments = [];
  isoDb.rebuildIndexes();

  isoDb.stocks.set('idx_k200', {
    id: 'idx_k200',
    ticker: 'K200',
    name: 'KOSPI200',
    market: 'index',
    current_price: 270,
    previous_close: 260,
    open_price: 260,
    high: 270,
    low: 260,
    volume: 0,
    change_rate: 0,
    market_cap: 0,
    pe_ratio: 0,
    dividend_yield: 0,
    sector: 'Index',
    is_listed: true,
  });

  const directUser = isoDb.ensureUserProfile('l6_direct_user', { id: 'prof_l6_direct', cash: 1_000_000 });
  const optBoundaryId = 'opt_l6_direct_boundary';
  isoDb.optionsContracts.set(optBoundaryId, {
    id: optBoundaryId,
    underlying_stock_id: 'idx_k200',
    ticker: 'IDX-K200-L6-BOUND',
    asset_class: 'IDX',
    type: 'CALL',
    option_type: 'CALL',
    strike_price: 260,
    current_price: 10,
    multiplier: 250000,
    expiry_date: new Date(clockNow + 50).toISOString(),
  });
  isoDb.holdings.set(`${directUser.user_id}_${optBoundaryId}`, {
    id: `${directUser.user_id}_${optBoundaryId}`,
    user_id: directUser.user_id,
    stock_id: optBoundaryId,
    quantity: 1,
    avg_price: 2,
    created_at: new Date(clockNow - 1000).toISOString(),
  });
  isoDb.rebuildIndexes();

  const bundle = createInMemoryRepositoryBundle(isoDb);
  const svc = new SettlementBatchService(bundle, { now: () => clockNow });

  await assert.rejects(() => svc.runDailySettlementBatch(Number.NaN), RangeError);
  await assert.rejects(() => svc.runDailySettlementBatch(Number.POSITIVE_INFINITY), RangeError);

  // clock.now()가 이미 만기 이후(clockNow + 100)여도 fixedNowMs(clockNow)로 고정하면 정산하지 않음
  const fixedNow = clockNow;
  clockNow += 100;
  const skippedRes = await svc.runDailySettlementBatch(fixedNow);
  assert.equal(skippedRes.optionSettled, 0, 'Fixed reference before expiry must not settle boundary contract');
  assert.equal(directUser.cash, 1_000_000);
  assert.equal(isoDb.holdings.has(`${directUser.user_id}_${optBoundaryId}`), true);

  // 다음 배치에서 현재 clockNow로 호출 시 정상 정산
  const k200Price1 = bundle.market.getUnderlyingPrices(['idx_k200']).idx_k200;
  const expectedPayout1 = Math.round(Math.max(0, k200Price1 - 260) * 1 * 250000);
  const settledRes = await svc.runDailySettlementBatch(clockNow);
  assert.equal(settledRes.optionSettled, 1, 'Next batch after expiry must settle boundary contract');
  assert.equal(directUser.cash, 1_000_000 + expectedPayout1);
  assert.equal(isoDb.holdings.has(`${directUser.user_id}_${optBoundaryId}`), false);

  // 2. LocalMarketEngineInstance.runPeriodicSettlementBatch:
  //    배치 대기 중 시계가 경계를 넘더라도 고정 기준을 벗어난 종목(optAfter)은 이번 배치에서 미정산,
  //    다음 배치에서 정상 정산되어야 함
  let simNow = 1_780_010_000_000;
  const origGetNowMs = memoryDb.getNowMs.bind(memoryDb);
  (memoryDb as any).getNowMs = () => simNow;
  try {
    memoryDb.resetToSeedData({ suppressPublish: true });
    memoryDb.profiles.clear();
    memoryDb.holdings.clear();
    memoryDb.orders.clear();
    memoryDb.optionsContracts.clear();
    memoryDb.bonds.clear();
    memoryDb.settlementLedger.clear();
    memoryDb.optionSettlements = [];
    memoryDb.bondCouponPayments = [];
    memoryDb.rebuildIndexes();

    const userA = memoryDb.ensureUserProfile('l6_time_a', { id: 'prof_l6_time_a', cash: 5_000_000 });
    const userB = memoryDb.ensureUserProfile('l6_time_b', { id: 'prof_l6_time_b', cash: 5_000_000 });

    const optInitialId = 'opt_l6_initial_exp';
    const optFutureBoundaryId = 'opt_l6_boundary_exp';

    memoryDb.optionsContracts.set(optInitialId, {
      id: optInitialId,
      underlying_stock_id: 'idx_k200',
      ticker: 'IDX-K200-L6-INIT',
      asset_class: 'IDX',
      type: 'CALL',
      option_type: 'CALL',
      strike_price: 250,
      current_price: 10,
      multiplier: 250000,
      expiry_date: new Date(simNow - 5_000).toISOString(),
    });
    memoryDb.optionsContracts.set(optFutureBoundaryId, {
      id: optFutureBoundaryId,
      underlying_stock_id: 'idx_k200',
      ticker: 'IDX-K200-L6-FUT',
      asset_class: 'IDX',
      type: 'CALL',
      option_type: 'CALL',
      strike_price: 250,
      current_price: 10,
      multiplier: 250000,
      expiry_date: new Date(simNow + 50).toISOString(),
    });

    memoryDb.holdings.set(`${userA.user_id}_${optInitialId}`, {
      id: `${userA.user_id}_${optInitialId}`,
      user_id: userA.user_id,
      stock_id: optInitialId,
      quantity: 1,
      avg_price: 1,
      created_at: new Date(simNow - 10_000).toISOString(),
    });
    memoryDb.holdings.set(`${userB.user_id}_${optFutureBoundaryId}`, {
      id: `${userB.user_id}_${optFutureBoundaryId}`,
      user_id: userB.user_id,
      stock_id: optFutureBoundaryId,
      quantity: 2,
      avg_price: 1,
      created_at: new Date(simNow - 10_000).toISOString(),
    });
    memoryDb.orders.set('ord_l6_future_open', {
      id: 'ord_l6_future_open',
      stock_id: optFutureBoundaryId,
      user_id: userB.user_id,
      side: 'buy',
      price: 2,
      size: 1,
      filled: 0,
      status: 'open',
      is_lp: false,
      created_at: new Date(simNow - 10_000).toISOString(),
      order_type: 'limit',
    });
    memoryDb.rebuildIndexes();

    const eng = new LocalMarketEngineInstance();

    let releaseLockA!: () => void;
    const gateA = new Promise<void>((r) => {
      releaseLockA = r;
    });
    const holderA = withAccountLocks([memoryDb.resolveAccountLockKey(userA.user_id)], async () => {
      await gateA;
    });
    await new Promise((r) => setTimeout(r, 10));

    const batch1 = (eng as any).runPeriodicSettlementBatch(async () => true);
    await new Promise((r) => setTimeout(r, 15));

    // 락 대기 중 시계가 경계를 넘어 미래 종목의 만기 이후로 진행
    simNow += 200;
    releaseLockA();
    await Promise.all([holderA, batch1]);

    // 고정 기준시각 내에 있던 optInitialId만 정산, 기준 밖 optFutureBoundaryId는 미정산
    assert.equal(memoryDb.holdings.has(`${userA.user_id}_${optInitialId}`), false, 'Expired option within fixed now must settle');
    assert.ok(userA.cash > 5_000_000, 'User A payout must be credited');
    assert.equal(memoryDb.holdings.has(`${userB.user_id}_${optFutureBoundaryId}`), true, 'Out-of-boundary option must wait for next batch');
    assert.equal(memoryDb.orders.get('ord_l6_future_open')?.status, 'open', 'Out-of-boundary order must remain open');
    assert.equal(userB.cash, 5_000_000, 'User B cash must remain untouched in batch 1');

    // 다음 배치 실행 시 userB 락이 잡혀 있는 동안 대기하고, 해제 후 정상 정산
    const traceB: string[] = [];
    let releaseLockB!: () => void;
    const gateB = new Promise<void>((r) => {
      releaseLockB = r;
    });
    const holderB = withAccountLocks([memoryDb.resolveAccountLockKey(userB.user_id)], async () => {
      traceB.push('lockB_enter');
      await gateB;
      traceB.push('lockB_exit');
    });
    await new Promise((r) => setTimeout(r, 10));

    const batch2 = (eng as any).runPeriodicSettlementBatch(async () => {
      traceB.push('batch2_persist');
      return true;
    });
    await new Promise((r) => setTimeout(r, 15));
    assert.deepEqual(traceB, ['lockB_enter'], 'Next batch must acquire userB canonical lock before settling');

    releaseLockB();
    await Promise.all([holderB, batch2]);
    assert.deepEqual(traceB, ['lockB_enter', 'lockB_exit', 'batch2_persist']);
    assert.equal(memoryDb.holdings.has(`${userB.user_id}_${optFutureBoundaryId}`), false);
    assert.equal(memoryDb.orders.get('ord_l6_future_open')?.status, 'expired');
    assert.ok(userB.cash > 5_000_000);
  } finally {
    (memoryDb as any).getNowMs = origGetNowMs;
  }

  console.log('  ✓ L6-01 통과');
}

async function testLockWaitCanonicalKeyAndTargetMutations(): Promise<void> {
  console.log('▶ [L6-02] 락 대기 중 정규 계좌 키 전환·신규 대상/계좌/자산 추가 시 재수집 및 완전 잠금 검증');

  const { memoryDb } = await import('../lib/memoryDb/memoryStore');
  const { LocalMarketEngineInstance, ensureLocalStandaloneReady, getLocalStandaloneEngine } = await import('../lib/engine/localStandaloneServer');
  const { withAccountLocks } = await import('../lib/memoryDb/accountLocks');

  await ensureLocalStandaloneReady();
  getLocalStandaloneEngine()?.stop();

  const fixedNow = 1_780_020_000_000;
  const origGetNowMs = memoryDb.getNowMs.bind(memoryDb);
  (memoryDb as any).getNowMs = () => fixedNow;

  try {
    // 시나리오 A: 락 대기 중 pre-profile userId -> canonical profile.id 로 락 키 전환 + 대상 보유/자산 동시 추가
    memoryDb.resetToSeedData({ suppressPublish: true });
    memoryDb.profiles.clear();
    memoryDb.holdings.clear();
    memoryDb.orders.clear();
    memoryDb.optionsContracts.clear();
    memoryDb.bonds.clear();
    memoryDb.settlementLedger.clear();
    memoryDb.optionSettlements = [];
    memoryDb.bondCouponPayments = [];
    memoryDb.rebuildIndexes();

    const uidPre = 'l6_pre_profile_uid';
    const canonicalPk = 'prof_l6_canon_pk';
    const uidLate = 'l6_late_holder_uid';
    const pkLate = 'prof_l6_late_pk';
    const optExp1 = 'opt_l6_canon_1';
    const optExp2 = 'opt_l6_added_later';

    memoryDb.optionsContracts.set(optExp1, {
      id: optExp1,
      underlying_stock_id: 'idx_k200',
      ticker: 'IDX-K200-L6-CANON',
      asset_class: 'IDX',
      type: 'CALL',
      option_type: 'CALL',
      strike_price: 250,
      current_price: 10,
      multiplier: 250000,
      expiry_date: new Date(fixedNow - 10_000).toISOString(),
    });
    // 초기에는 uidPre의 미체결 주문만 있고 프로필은 아직 없음 (pre-creation key = uidPre)
    memoryDb.orders.set('ord_l6_pre_open', {
      id: 'ord_l6_pre_open',
      stock_id: optExp1,
      user_id: uidPre,
      side: 'buy',
      price: 2,
      size: 1,
      filled: 0,
      status: 'open',
      is_lp: false,
      created_at: new Date(fixedNow - 20_000).toISOString(),
      order_type: 'limit',
    });
    memoryDb.rebuildIndexes();

    const eng = new LocalMarketEngineInstance();
    const trace: string[] = [];

    let releasePreKey!: () => void;
    const preKeyGate = new Promise<void>((r) => {
      releasePreKey = r;
    });
    let releaseCanonKey!: () => void;
    const canonKeyGate = new Promise<void>((r) => {
      releaseCanonKey = r;
    });
    let releaseLateKey!: () => void;
    const lateKeyGate = new Promise<void>((r) => {
      releaseLateKey = r;
    });

    // 1. uidPre 락 선점
    const preHolder = withAccountLocks([uidPre], async () => {
      trace.push('pre_enter');
      await preKeyGate;
      // 락 보유 중 정규 프로필(canonicalPk) 생성
      const createdCanon = memoryDb.ensureUserProfile(uidPre, {
        id: canonicalPk,
        cash: 3_000_000,
      });
      createdCanon.margin_debt_krw = 400_000;
      trace.push('pre_created_canon_profile');
    });

    // 2. canonicalPk 및 latePk 락도 외부에서 선점 (재시도 후 반드시 이 락들도 대기해야 함)
    const canonHolder = withAccountLocks([canonicalPk], async () => {
      trace.push('canon_enter');
      await canonKeyGate;
      // 외부 동시 변경: 잔액 +50,000 입금
      const p = memoryDb.profiles.get(canonicalPk)!;
      p.cash += 50_000;
      trace.push('canon_external_deposit_exit');
    });

    const lateHolder = withAccountLocks([pkLate], async () => {
      trace.push('late_enter');
      await lateKeyGate;
      trace.push('late_exit');
    });

    await new Promise((r) => setTimeout(r, 10));

    // 정산 배치 시작 (초기 planBefore.lockKeys = [uidPre])
    const batchPromise = (eng as any).runPeriodicSettlementBatch(async () => {
      trace.push('settlement_persist');
      return true;
    });
    await new Promise((r) => setTimeout(r, 15));

    // preHolder 실행 중: 아직 canonical profile 미생성, 배치 대기 중
    assert.equal(trace.includes('settlement_persist'), false);

    // preKey 해제 직전/직후, lateUser의 이미 만기된 신규 옵션 계약(optExp2) + 보유 추가
    memoryDb.ensureUserProfile(uidLate, { id: pkLate, cash: 2_000_000 });
    memoryDb.optionsContracts.set(optExp2, {
      id: optExp2,
      underlying_stock_id: 'idx_k200',
      ticker: 'IDX-K200-L6-LATE',
      asset_class: 'IDX',
      type: 'CALL',
      option_type: 'CALL',
      strike_price: 250,
      current_price: 10,
      multiplier: 250000,
      expiry_date: new Date(fixedNow - 1_000).toISOString(),
    });
    memoryDb.holdings.set(`${uidLate}_${optExp2}`, {
      id: `${uidLate}_${optExp2}`,
      user_id: uidLate,
      stock_id: optExp2,
      quantity: 1,
      avg_price: 1,
      created_at: new Date(fixedNow - 2_000).toISOString(),
    });
    memoryDb.rebuildIndexes();

    releasePreKey();
    await preHolder;
    await new Promise((r) => setTimeout(r, 20));

    // 배치는 canonKey와 lateKey가 모두 풀리기 전에 절대 persist에 진입해서는 안 됨!
    assert.equal(
      trace.includes('settlement_persist'),
      false,
      'Batch must detect canonical lock-key transition and newly added expired asset/holder, and wait on canonicalPk & pkLate'
    );

    releaseCanonKey();
    await canonHolder;
    await new Promise((r) => setTimeout(r, 15));
    assert.equal(
      trace.includes('settlement_persist'),
      false,
      'Batch must still wait for pkLate before settling optExp2'
    );

    releaseLateKey();
    await Promise.all([lateHolder, batchPromise]);

    assert.equal(trace[trace.length - 1], 'settlement_persist', 'Persist must run only after all canonical locks released');
    assert.equal(memoryDb.orders.get('ord_l6_pre_open')?.status, 'expired');
    const canonProf = memoryDb.profiles.get(canonicalPk)!;
    // 3,000,000 + 50,000 (external deposit) - 400,000 (margin debt swept) = 2,650,000
    assert.equal(canonProf.cash, 2_650_000, 'External deposit + margin sweep must both be preserved');
    assert.equal(canonProf.margin_debt_krw, undefined);
    assert.equal(memoryDb.holdings.has(`${uidLate}_${optExp2}`), false, 'Late expired option must be settled in same batch');
    assert.ok(memoryDb.profiles.get(pkLate)!.cash > 2_000_000, 'Late holder must receive option payout');
  } finally {
    (memoryDb as any).getNowMs = origGetNowMs;
  }

  console.log('  ✓ L6-02 통과');
}

async function testRollbackAndRetryConsistencyWithExternalMutations(): Promise<void> {
  console.log('▶ [L6-03] 성공·저장 false·예외·재시도 시 주문/보유/현금/부채/인덱스/원장/외부변경 일관성 검증');

  const { memoryDb } = await import('../lib/memoryDb/memoryStore');
  const { OPTIONS_LP_ID } = await import('../lib/options/optionOrderService');
  const { LocalMarketEngineInstance, ensureLocalStandaloneReady, getLocalStandaloneEngine } = await import('../lib/engine/localStandaloneServer');
  const { withAccountLocks } = await import('../lib/memoryDb/accountLocks');

  await ensureLocalStandaloneReady();
  getLocalStandaloneEngine()?.stop();

  const fixedNow = 1_780_030_000_000;
  const origGetNowMs = memoryDb.getNowMs.bind(memoryDb);
  (memoryDb as any).getNowMs = () => fixedNow;

  try {
    memoryDb.resetToSeedData({ suppressPublish: true });
    memoryDb.profiles.clear();
    memoryDb.holdings.clear();
    memoryDb.orders.clear();
    memoryDb.optionsContracts.clear();
    memoryDb.bonds.clear();
    memoryDb.settlementLedger.clear();
    memoryDb.lpLiabilities.clear();
    memoryDb.optionSettlements = [];
    memoryDb.bondCouponPayments = [];
    memoryDb.rebuildIndexes();

    const optId = 'opt_l6_rb_1';
    const bondId = 'bond_l6_rb_1';
    const stockId = '00000000-0000-4000-8000-000000000101';

    memoryDb.optionsContracts.set(optId, {
      id: optId,
      underlying_stock_id: 'idx_k200',
      ticker: 'IDX-K200-L6-RB',
      asset_class: 'IDX',
      type: 'CALL',
      option_type: 'CALL',
      strike_price: 250,
      current_price: 10,
      multiplier: 250000,
      expiry_date: new Date(fixedNow - 60_000).toISOString(),
    });
    memoryDb.bonds.set(bondId, {
      id: bondId,
      ticker: 'L6-BOND-1Y',
      name: 'L6 Test Bond',
      bond_type: 'government',
      maturity: '1Y',
      maturity_date: new Date(fixedNow - 60_000).toISOString(),
      coupon_rate: 4.0,
      face_value: 10_000,
      current_price: 10_000,
      ytm: 4.0,
      duration: 1.0,
      volume: 1000,
    });

    const userOpt = memoryDb.ensureUserProfile('l6_rb_opt_uid', {
      id: 'prof_l6_rb_opt',
      cash: 1_000_000,
    });
    userOpt.margin_debt_krw = 600_000;
    const userBond = memoryDb.ensureUserProfile('l6_rb_bond_uid', {
      id: 'prof_l6_rb_bond',
      cash: 500_000,
    });
    userBond.margin_debt_krw = 20_000;
    const userExternal = memoryDb.ensureUserProfile('l6_rb_ext_uid', {
      id: 'prof_l6_rb_ext',
      cash: 7_777_000,
    });

    const optHid = `${userOpt.user_id}_${optId}`;
    memoryDb.holdings.set(optHid, {
      id: optHid,
      user_id: userOpt.user_id,
      stock_id: optId,
      quantity: 1,
      avg_price: 1,
      created_at: new Date(fixedNow - 120_000).toISOString(),
    });
    const bondHid = `${userBond.user_id}_${bondId}`;
    memoryDb.holdings.set(bondHid, {
      id: bondHid,
      user_id: userBond.user_id,
      stock_id: bondId,
      quantity: 5,
      avg_price: 10_000,
      created_at: new Date(fixedNow - 120_000).toISOString(),
    });
    const extHid = `${userExternal.user_id}_${stockId}`;
    memoryDb.holdings.set(extHid, {
      id: extHid,
      user_id: userExternal.user_id,
      stock_id: stockId,
      quantity: 10,
      avg_price: 70_000,
      created_at: new Date(fixedNow - 120_000).toISOString(),
    });

    memoryDb.orders.set('ord_l6_rb_opt_open', {
      id: 'ord_l6_rb_opt_open',
      stock_id: optId,
      user_id: userOpt.user_id,
      side: 'buy',
      price: 2,
      size: 1,
      filled: 0,
      status: 'open',
      is_lp: false,
      created_at: new Date(fixedNow - 100_000).toISOString(),
      order_type: 'limit',
    });
    memoryDb.orders.set('ord_l6_ext_stock_open', {
      id: 'ord_l6_ext_stock_open',
      stock_id: stockId,
      user_id: userExternal.user_id,
      side: 'buy',
      price: 70_000,
      size: 2,
      filled: 0,
      status: 'open',
      is_lp: false,
      created_at: new Date(fixedNow - 100_000).toISOString(),
      order_type: 'limit',
    });

    memoryDb.lpLiabilities.set(`${OPTIONS_LP_ID}:${optId}`, 1);
    memoryDb.settlementLedger.set('pre_existing_trade_key', {
      trade_id: 'pre_existing_trade_key',
      stock_id: stockId,
      price: 70_000,
      size: 1,
      total_amount: 70_000,
      buyer_fee_rate: 0,
      seller_fee_rate: 0,
      buyer_fee_amount: 0,
      seller_fee_amount: 0,
      settled_at: new Date(fixedNow - 100_000).toISOString(),
    });
    memoryDb.rebuildIndexes();

    const eng = new LocalMarketEngineInstance();

    const assertUntouchedSnapshot = (expectedOptCash: number, label: string) => {
      assert.equal(memoryDb.orders.get('ord_l6_rb_opt_open')?.status, 'open', `${label}: option order status`);
      assert.equal(memoryDb.orderStockIndex.get(optId)?.has('ord_l6_rb_opt_open'), true, `${label}: orderStockIndex`);
      assert.equal(memoryDb.orderUserIndex.get(userOpt.user_id)?.has('ord_l6_rb_opt_open'), true, `${label}: orderUserIndex`);
      assert.equal(memoryDb.holdings.get(optHid)?.quantity, 1, `${label}: option holding`);
      assert.equal(memoryDb.holdingUserIndex.get(userOpt.user_id)?.has(optHid), true, `${label}: opt holdingUserIndex`);
      assert.equal(memoryDb.holdings.get(bondHid)?.quantity, 5, `${label}: bond holding`);
      assert.equal(memoryDb.holdingUserIndex.get(userBond.user_id)?.has(bondHid), true, `${label}: bond holdingUserIndex`);
      assert.equal(userOpt.cash, expectedOptCash, `${label}: userOpt cash`);
      assert.equal(userOpt.margin_debt_krw, 600_000, `${label}: userOpt debt`);
      assert.equal(userBond.cash, 500_000, `${label}: userBond cash`);
      assert.equal(userBond.margin_debt_krw, 20_000, `${label}: userBond debt`);
      assert.equal(memoryDb.lpLiabilities.get(`${OPTIONS_LP_ID}:${optId}`), 1, `${label}: lpLiabilities`);
      assert.equal(memoryDb.optionSettlements.length, 0, `${label}: optionSettlements`);
      assert.equal(memoryDb.bondCouponPayments.length, 0, `${label}: bondCouponPayments`);
      assert.equal(memoryDb.settlementLedger.size, 1, `${label}: settlementLedger size`);
      assert.equal(memoryDb.settlementLedger.has('pre_existing_trade_key'), true, `${label}: pre-existing ledger`);
      assert.equal(userExternal.cash, 7_777_000, `${label}: external user cash`);
      assert.equal(memoryDb.holdings.get(extHid)?.quantity, 10, `${label}: external user holding`);
      assert.equal(memoryDb.orders.get('ord_l6_ext_stock_open')?.status, 'open', `${label}: external user order`);
    };

    // 1. 락 대기 중 외부 동시 변경(+100,000 입금)이 발생한 뒤 persist false -> 외부 변경 보존 + 정산 롤백
    let releaseOptLock!: () => void;
    const optLockGate = new Promise<void>((r) => {
      releaseOptLock = r;
    });
    const extMutator = withAccountLocks([userOpt.id], async () => {
      await optLockGate;
      userOpt.cash += 100_000;
    });
    await new Promise((r) => setTimeout(r, 10));

    const falseBatch = (eng as any).runPeriodicSettlementBatch(async () => false);
    await new Promise((r) => setTimeout(r, 10));
    releaseOptLock();
    await Promise.all([extMutator, falseBatch]);

    assertUntouchedSnapshot(1_100_000, 'persist=false after external mutation');

    // 2. persist 예외 throw -> 완전 롤백
    await (eng as any).runPeriodicSettlementBatch(async () => {
      throw new Error('Injected persist failure');
    });
    assertUntouchedSnapshot(1_100_000, 'persist=throw');

    // 3. 재시도 persist true -> 완전 커밋 + 외부 변경·타계좌 보존
    const k200Price3 = (eng as any).settlementService.getRepositories().market.getUnderlyingPrices(['idx_k200']).idx_k200;
    const expectedOptPayout3 = Math.round(Math.max(0, k200Price3 - 250) * 1 * 250000);
    await (eng as any).runPeriodicSettlementBatch(async () => true);
    assert.equal(memoryDb.orders.get('ord_l6_rb_opt_open')?.status, 'expired');
    assert.equal(memoryDb.holdings.has(optHid), false);
    assert.equal(memoryDb.holdingUserIndex.get(userOpt.user_id)?.has(optHid), false);
    assert.equal(memoryDb.holdings.has(bondHid), false);
    assert.equal(memoryDb.holdingUserIndex.get(userBond.user_id)?.has(bondHid), false);
    assert.equal(memoryDb.lpLiabilities.has(`${OPTIONS_LP_ID}:${optId}`), false);
    assert.equal(userOpt.margin_debt_krw, undefined);
    assert.equal(userBond.margin_debt_krw, undefined);
    // userOpt: 1,100,000 - 600,000(부채상환) + expectedOptPayout3
    assert.equal(userOpt.cash, 500_000 + expectedOptPayout3);
    // userBond: 500,000 - 20,000(부채상환) + 5*10,000(원금) + 5*100(최종분기쿠폰) = 530,500
    assert.equal(userBond.cash, 530_500);
    assert.equal(memoryDb.optionSettlements.length, 1);
    assert.equal(memoryDb.bondCouponPayments.length, 1);
    assert.equal(memoryDb.settlementLedger.has('pre_existing_trade_key'), true);
    assert.equal(userExternal.cash, 7_777_000);
    assert.equal(memoryDb.holdings.get(extHid)?.quantity, 10);
    assert.equal(memoryDb.orders.get('ord_l6_ext_stock_open')?.status, 'open');

    // 4. 재진입 락(이미 상위에서 canonical 계좌 락을 보유한 상태) 호환성 검증
    const userReent = memoryDb.ensureUserProfile('l6_reent_uid', { id: 'prof_l6_reent', cash: 1_000_000 });
    const optReent = 'opt_l6_reent';
    memoryDb.optionsContracts.set(optReent, {
      id: optReent,
      underlying_stock_id: 'idx_k200',
      ticker: 'IDX-K200-L6-REENT',
      asset_class: 'IDX',
      type: 'CALL',
      option_type: 'CALL',
      strike_price: 250,
      current_price: 10,
      multiplier: 250000,
      expiry_date: new Date(fixedNow - 1_000).toISOString(),
    });
    memoryDb.holdings.set(`${userReent.user_id}_${optReent}`, {
      id: `${userReent.user_id}_${optReent}`,
      user_id: userReent.user_id,
      stock_id: optReent,
      quantity: 1,
      avg_price: 1,
      created_at: new Date(fixedNow - 5_000).toISOString(),
    });
    memoryDb.rebuildIndexes();

    await withAccountLocks([userReent.id], async () => {
      await (eng as any).runPeriodicSettlementBatch(async () => true);
    });
    assert.equal(memoryDb.holdings.has(`${userReent.user_id}_${optReent}`), false);
    assert.equal(userReent.cash, 1_000_000 + expectedOptPayout3);
  } finally {
    (memoryDb as any).getNowMs = origGetNowMs;
  }

  console.log('  ✓ L6-03 통과');
}

async function testContinuousChurnDeferral(): Promise<void> {
  console.log('▶ [L6-04] 지속 경합(락 대기 중 대상 집합 계속 변경) 시 쓰기 차단 및 다음 배치 연기 검증');

  const { memoryDb } = await import('../lib/memoryDb/memoryStore');
  const { LocalMarketEngineInstance, ensureLocalStandaloneReady, getLocalStandaloneEngine } = await import('../lib/engine/localStandaloneServer');

  await ensureLocalStandaloneReady();
  getLocalStandaloneEngine()?.stop();

  const fixedNow = 1_780_040_000_000;
  const origGetNowMs = memoryDb.getNowMs.bind(memoryDb);
  (memoryDb as any).getNowMs = () => fixedNow;

  memoryDb.resetToSeedData({ suppressPublish: true });
  memoryDb.profiles.clear();
  memoryDb.holdings.clear();
  memoryDb.orders.clear();
  memoryDb.optionsContracts.clear();
  memoryDb.bonds.clear();
  memoryDb.settlementLedger.clear();
  memoryDb.rebuildIndexes();

  const u = memoryDb.ensureUserProfile('l6_churn_uid', { id: 'prof_l6_churn', cash: 1_000_000 });
  const optId = 'opt_l6_churn';
  memoryDb.optionsContracts.set(optId, {
    id: optId,
    underlying_stock_id: 'idx_k200',
    ticker: 'IDX-K200-L6-CHURN',
    asset_class: 'IDX',
    type: 'CALL',
    option_type: 'CALL',
    strike_price: 250,
    current_price: 10,
    multiplier: 250000,
    expiry_date: new Date(fixedNow - 1_000).toISOString(),
  });
  memoryDb.holdings.set(`${u.user_id}_${optId}`, {
    id: `${u.user_id}_${optId}`,
    user_id: u.user_id,
    stock_id: optId,
    quantity: 1,
    avg_price: 1,
    created_at: new Date(fixedNow - 5_000).toISOString(),
  });
  memoryDb.rebuildIndexes();

  const eng = new LocalMarketEngineInstance();
  const repo = (eng as any).settlementService.getRepositories();
  const origGetOpen = repo.settlement.getOpenOptionOrderAccountIds.bind(repo.settlement);
  let callIdx = 0;
  let persistCalled = false;

  try {
    // 매 수집마다 다른 미체결 주문 계좌가 반환되는 지속 경합 모의
    repo.settlement.getOpenOptionOrderAccountIds = () => {
      callIdx += 1;
      return [`l6_churn_extra_${callIdx}`];
    };

    await (eng as any).runPeriodicSettlementBatch(async () => {
      persistCalled = true;
      return true;
    });

    assert.equal(persistCalled, false, 'Unstable lock/target set must defer without writing');
    assert.equal(u.cash, 1_000_000, 'Deferred batch must not alter user cash');
    assert.equal(memoryDb.holdings.has(`${u.user_id}_${optId}`), true, 'Deferred batch must leave holding intact');

    // 경합 해소 후 다음 배치에서 정상 정산
    const k200Price4 = repo.market.getUnderlyingPrices(['idx_k200']).idx_k200;
    const expectedPayout4 = Math.round(Math.max(0, k200Price4 - 250) * 1 * 250000);
    repo.settlement.getOpenOptionOrderAccountIds = origGetOpen;
    await (eng as any).runPeriodicSettlementBatch(async () => {
      persistCalled = true;
      return true;
    });

    assert.equal(persistCalled, true, 'Next batch after stabilization must persist');
    assert.equal(memoryDb.holdings.has(`${u.user_id}_${optId}`), false);
    assert.equal(u.cash, 1_000_000 + expectedPayout4);
  } finally {
    repo.settlement.getOpenOptionOrderAccountIds = origGetOpen;
    (memoryDb as any).getNowMs = origGetNowMs;
  }

  console.log('  ✓ L6-04 통과');
}

async function main() {
  try {
    await testTimeContractFixedReferenceAndNextBatch();
    await testLockWaitCanonicalKeyAndTargetMutations();
    await testRollbackAndRetryConsistencyWithExternalMutations();
    await testContinuousChurnDeferral();
    console.log('\n🎉 6차 독립 검증 P1-01 만기 정산 시간 계약 및 계좌 잠금 일관성 모든 회귀 테스트 통과!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ 6차 독립 검증 P1-01 회귀 테스트 실패:', err);
    process.exit(1);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main();
