/**
 * scripts/test-followup-18-p1-p2.ts
 *
 * #18 1차 독립 재검증 후속 수정 2건(P1, P2) 회귀 검증 스위트.
 * - 격리된 임시 STOCKSYS_DATA_DIR 및 합성 데이터만 사용합니다.
 * - 운영 .data/ 또는 실제 계정·외부 서비스를 절대 사용하지 않습니다.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const isChildColdStart = process.env.CHILD_COLD_START_TEST === '1';
const tmpRoot = isChildColdStart ? '' : fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-followup18-'));
if (!isChildColdStart) {
  const tmpDataDir = path.join(tmpRoot, 'data');
  fs.mkdirSync(tmpDataDir, { recursive: true });
  process.env.STOCKSYS_DATA_DIR = tmpDataDir;
}

async function testP1_CommodityEventSyncRollbackAndNoResurrection(): Promise<void> {
  console.log('▶ [P1] 원자재 이벤트 틱 동기화·실패 롤백·만료 후 GET 반복 및 로컬 재초기화 비복원 검증');

  const { memoryDb } = await import('../lib/memoryDb/memoryStore');
  const { persistenceManager } = await import('../lib/memoryDb/PersistenceManager');
  const {
    ensureLocalStandaloneReady,
    stopLocalStandaloneEngine,
    getLocalStandaloneEngine,
    persistConfirmedState,
  } = await import('../lib/engine/localStandaloneServer');
  const { CommodityMarketEngine } = await import('../lib/commodities/CommodityMarketEngine');
  const {
    commodityEngineInstance,
    ensureCommodityEngineReady,
  } = await import('../lib/commodities/commodityEngineInstance');
  const { GET: commoditiesGet, POST: commoditiesPost } = await import('../app/api/commodities/route');

  // 1. 단독 엔진으로 틱 저장 실패(false / throw) 시 메모리 런타임 & DB 스냅샷 정합 복원 검증
  const isolatedDb = new (memoryDb.constructor as typeof import('../lib/memoryDb/memoryStore').MemoryDatabase)();
  let persistMode: 'ok' | 'false' | 'throw' = 'ok';
  const engine = new CommodityMarketEngine({
    totalBots: 20,
    eventProbability: 0,
    db: isolatedDb,
    onPersist: async () => {
      if (persistMode === 'false') return false;
      if (persistMode === 'throw') throw new Error('Injected tick persist throw');
      return true;
    },
  });
  await engine.reconcileWithDatabase(isolatedDb);

  const triggered = engine.eventSystem.triggerEventById('EV_BRAZIL_FROST', engine.currentTick);
  assert.ok(triggered, 'EV_BRAZIL_FROST template must trigger');
  // 테스트 시간 제한을 위해 만료 틱을 짧게 설정
  triggered.remainingTicks = 2;
  triggered.totalTicks = 2;
  isolatedDb.commodityEventRuntimeState = engine.eventSystem.snapshotState();

  // 1틱 정상 진행: remainingTicks 2 -> 1, DB 스냅샷과 동기화됨
  await engine.stepTickAsync();
  assert.equal(engine.currentTick, 1);
  assert.equal(engine.eventSystem.activeEvents.length, 1);
  assert.equal(engine.eventSystem.activeEvents[0].remainingTicks, 1);
  assert.equal(isolatedDb.commodityCurrentTick, 1);
  assert.equal(isolatedDb.commodityEventRuntimeState.activeEvents.length, 1);
  assert.equal(isolatedDb.commodityEventRuntimeState.activeEvents[0].remainingTicks, 1);
  assert.equal(isolatedDb.commodityEventRuntimeState.manualSequence, 1);

  const normalizeRuntimeForCompare = (raw: ReturnType<typeof engine.snapshotRuntime>) => {
    const cloned = structuredClone(raw);
    const normRand = (r: any) => (r ? { ...r, state: r.state >>> 0 } : r);
    cloned.priceRandSnap = normRand(cloned.priceRandSnap);
    cloned.eventRandSnap = normRand(cloned.eventRandSnap);
    cloned.engineRandSnap = normRand(cloned.engineRandSnap);
    if (cloned.eventSystemSnapshot?.randomSnapshot) {
      cloned.eventSystemSnapshot.randomSnapshot = normRand(cloned.eventSystemSnapshot.randomSnapshot);
    }
    cloned.botSnapshots = cloned.botSnapshots.map((b: any) => ({
      ...b,
      randomSnapshot: normRand(b.randomSnapshot),
    }));
    return cloned;
  };
  const snapBeforeFailRuntime = normalizeRuntimeForCompare(engine.snapshotRuntime());
  const snapBeforeFailDbEvent = structuredClone(isolatedDb.commodityEventRuntimeState);
  const tickBeforeFail = isolatedDb.commodityCurrentTick;
  const tradeSeqBeforeFail = isolatedDb.commodityTradeSeq;
  const orderSeqBeforeFail = isolatedDb.commodityUserOrderSeq;

  // 2틱째(만료 틱) 저장 false 실패 -> 만료·틱·시퀀스·DB 스냅샷 모두 1틱 상태로 원복
  persistMode = 'false';
  await assert.rejects(() => engine.stepTickAsync(), /영속 저장에 실패/);
  assert.deepEqual(normalizeRuntimeForCompare(engine.snapshotRuntime()), snapBeforeFailRuntime, 'Runtime must roll back on persist false');
  assert.deepEqual(isolatedDb.commodityEventRuntimeState, snapBeforeFailDbEvent, 'DB event runtime state must roll back on persist false');
  assert.equal(isolatedDb.commodityCurrentTick, tickBeforeFail);
  assert.equal(isolatedDb.commodityTradeSeq, tradeSeqBeforeFail);
  assert.equal(isolatedDb.commodityUserOrderSeq, orderSeqBeforeFail);
  assert.equal(engine.eventSystem.activeEvents[0].remainingTicks, 1);

  // 2틱째(만료 틱) 저장 throw 실패 -> 동일하게 완전 원복
  persistMode = 'throw';
  await assert.rejects(() => engine.stepTickAsync(), /Injected tick persist throw/);
  assert.deepEqual(normalizeRuntimeForCompare(engine.snapshotRuntime()), snapBeforeFailRuntime, 'Runtime must roll back on persist throw');
  assert.deepEqual(isolatedDb.commodityEventRuntimeState, snapBeforeFailDbEvent, 'DB event runtime state must roll back on persist throw');
  assert.equal(isolatedDb.commodityCurrentTick, tickBeforeFail);
  assert.equal(engine.eventSystem.activeEvents[0].remainingTicks, 1);

  // 저장 복구 후 재시도 -> 만료가 원자적으로 DB 스냅샷에 반영됨
  persistMode = 'ok';
  await engine.stepTickAsync();
  assert.equal(engine.currentTick, 2);
  assert.equal(engine.eventSystem.activeEvents.length, 0, 'Event must expire on tick 2');
  assert.equal(isolatedDb.commodityEventRuntimeState.activeEvents.length, 0, 'DB snapshot must record expired empty activeEvents');
  assert.equal(isolatedDb.commodityEventRuntimeState.manualSequence, 1);
  assert.ok(isolatedDb.commodityEventRuntimeState.newsFeed.length >= 1, 'News feed must be preserved');

  // 2. 글로벌 commodityEngineInstance + GET 반복 + 실제 로컬 재초기화 비복원 검증
  const prevDevAdmin = process.env.ALLOW_DEV_ADMIN;
  process.env.ALLOW_DEV_ADMIN = 'true';
  try {
    stopLocalStandaloneEngine();
    await ensureLocalStandaloneReady();
    getLocalStandaloneEngine()?.stop();

    memoryDb.resetToSeedData({ suppressPublish: true });
    memoryDb.ensureUserProfile('admin_p1', { is_admin: true, cash: 50_000_000 });
    await persistConfirmedState();

    await ensureCommodityEngineReady();
    commodityEngineInstance.stop();

    // 관리자 이벤트 주입 (POST /api/commodities)
    const triggerRes = await commoditiesPost(
      new Request('http://localhost:3000/api/commodities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger_event', templateId: 'EV_OPEC_CUT' }),
      })
    );
    assert.equal(triggerRes.status, 200);
    const triggerBody = await triggerRes.json();
    assert.equal(triggerBody.success, true);
    assert.equal(commodityEngineInstance.eventSystem.activeEvents.length, 1);

    // 틱 진행으로 이벤트 만료 (remainingTicks를 1로 줄이고 stepTickAsync 1회 실행)
    commodityEngineInstance.eventSystem.activeEvents[0].remainingTicks = 1;
    await commodityEngineInstance.stepTickAsync();
    assert.equal(commodityEngineInstance.eventSystem.activeEvents.length, 0, 'Active events must be empty after expiration');
    assert.equal(memoryDb.commodityEventRuntimeState?.activeEvents?.length, 0, 'DB runtime activeEvents must be empty after expiration');
    const savedNewsCountAfterExpiry = commodityEngineInstance.eventSystem.newsFeed.length;
    const savedTickAfterExpiry = commodityEngineInstance.currentTick;

    // GET /api/commodities 반복 호출 시 과거 이벤트가 되살아나지 않아야 함
    for (let i = 0; i < 3; i++) {
      const getRes = await commoditiesGet(new Request('http://localhost:3000/api/commodities'));
      assert.equal(getRes.status, 200);
      const getBody = await getRes.json();
      assert.equal(getBody.activeEvents.length, 0, `GET #${i + 1} must not resurrect expired commodity event`);
      assert.equal(commodityEngineInstance.eventSystem.activeEvents.length, 0);
      commodityEngineInstance.stop();
    }

    // 실제 로컬 재초기화 (엔진/DB ready promise 초기화 후 파일 스냅샷에서 재로딩)
    stopLocalStandaloneEngine();
    await ensureCommodityEngineReady();
    commodityEngineInstance.stop();
    getLocalStandaloneEngine()?.stop();

    assert.equal(commodityEngineInstance.eventSystem.activeEvents.length, 0, 'Local re-init must not resurrect expired event');
    assert.equal(commodityEngineInstance.currentTick, savedTickAfterExpiry, 'Local re-init must preserve tick');
    assert.equal(
      commodityEngineInstance.eventSystem.newsFeed.length,
      savedNewsCountAfterExpiry,
      'Local re-init must preserve news feed'
    );

    // 재초기화 후 같은 이벤트 템플릿 재발동 시 manualSequence가 유지되어 ID 충돌이 없어야 함
    const retriggerRes = await commoditiesPost(
      new Request('http://localhost:3000/api/commodities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger_event', templateId: 'EV_OPEC_CUT' }),
      })
    );
    assert.equal(retriggerRes.status, 200);
    const retriggerBody = await retriggerRes.json();
    assert.notEqual(retriggerBody.event.id, triggerBody.event.id, 'Retriggered event ID must not collide after re-init');
    assert.equal(
      memoryDb.commodityEventRuntimeState.manualSequence,
      2,
      'manualSequence must advance cleanly across re-init'
    );

    // 스냅샷 교체(commodityEventRuntimeState = null) 시 reconcileWithDatabase가 이전 이벤트를 정리해야 함
    const cleanSnap = memoryDb.exportSnapshot();
    cleanSnap.commodityEventRuntimeState = null;
    cleanSnap.commodityCurrentTick = 0;
    memoryDb.importSnapshot(cleanSnap);
    await ensureCommodityEngineReady();
    commodityEngineInstance.stop();
    assert.equal(commodityEngineInstance.eventSystem.activeEvents.length, 0, 'Snapshot replacement with null event state must clear events');
    assert.equal(commodityEngineInstance.eventSystem.newsFeed.length, 0, 'Snapshot replacement with null event state must clear newsFeed');
  } finally {
    commodityEngineInstance.stop();
    stopLocalStandaloneEngine();
    if (prevDevAdmin === undefined) delete process.env.ALLOW_DEV_ADMIN;
    else process.env.ALLOW_DEV_ADMIN = prevDevAdmin;
    // persistenceManager 내부 saveQueue flush 대기
    await persistenceManager.saveSnapshot(memoryDb).catch(() => false);
  }

  console.log('  ✓ P1 통과');
}

async function testP2_BondLegacyLedgerCompatibilityAndBoundaries(): Promise<void> {
  console.log('▶ [P2] 채권 레거시 원장 단독 분기/월 키·실측 이력·다음 유효 기간·무이표·만기 경계 검증');

  const { MemoryDatabase } = await import('../lib/memoryDb/memoryStore');
  const { createInMemoryRepositoryBundle } = await import('../lib/repositories/inMemory');
  const { BondCouponEngine } = await import('../engine-server/src/settlement/BondCouponEngine');

  const setupBondTest = (bondOverrides: Record<string, any>) => {
    const db = new MemoryDatabase();
    db.profiles.clear();
    db.holdings.clear();
    db.bonds.clear();
    db.settlementLedger.clear();
    db.bondCouponPayments = [];
    db.rebuildIndexes();

    const userId = 'p2_bond_user';
    db.ensureUserProfile(userId, { cash: 1_000_000 });
    const bond = {
      id: 'bond_p2_test',
      ticker: 'P2BND',
      name: 'P2 테스트 채권',
      bond_type: 'govt',
      maturity: '3Y',
      maturity_date: '2028-01-01T00:00:00Z',
      coupon_rate: 4.0,
      face_value: 10000,
      payments_per_year: 4,
      current_price: 100,
      ...bondOverrides,
    };
    db.bonds.set(bond.id, bond as any);
    db.holdings.set(`${userId}_${bond.id}`, {
      id: `${userId}_${bond.id}`,
      user_id: userId,
      stock_id: bond.id,
      quantity: 100,
      avg_price: 100,
      created_at: '2025-12-01T00:00:00Z',
    });
    db.rebuildIndexes();

    const repos = createInMemoryRepositoryBundle(db);
    let nowMs = Date.parse('2026-01-15T00:00:00Z');
    const engine = new BondCouponEngine(repos, { now: () => nowMs });
    const pos = { userId, bondId: bond.id, quantity: 100, avgPrice: 100 };
    return { db, userId, bond, repos, engine, pos, setNow: (iso: string) => { nowMs = Date.parse(iso); } };
  };

  // 1. 원장 단독 분기 키 (v1 스냅샷: bondCouponPayments === [], settlementLedger에만 period_2026-Q1 존재)
  {
    const { db, userId, bond, engine, pos, setNow } = setupBondTest({ payments_per_year: 2 });
    const q1Key = engine.generateIdempotencyKey(bond.id, userId, 'period_2026-Q1', 'COUPON');
    db.settlementLedger.set(q1Key, {
      trade_id: q1Key,
      stock_id: bond.id,
      price: 0,
      size: 0,
      total_amount: 20000,
      buyer_fee_rate: 0,
      seller_fee_rate: 0,
      buyer_fee_amount: 0,
      seller_fee_amount: 0,
      settled_at: '2026-01-15T00:00:00Z',
    });
    assert.equal(db.bondCouponPayments.length, 0, 'v1 snapshot has empty bondCouponPayments');

    // Q2(2026-04-01)은 동일 반기(H1)이므로 차단되어야 함
    setNow('2026-04-01T00:00:00Z');
    const h1Apr = await engine.executeCouponBatch({
      bonds: [bond],
      positions: [pos],
      periodKey: 'period_2026-Q2',
      now: Date.parse('2026-04-01T00:00:00Z'),
    });
    assert.equal(h1Apr.couponCount, 0, 'Ledger-only legacy Q1 key must block overlapping H1 coupon in April');
    assert.equal(db.resolveProfileByUserId(userId)!.cash, 1_000_000);

    // Q3(2026-07-01)은 다음 유효 기간(H2)이므로 정상 지급되어야 함
    setNow('2026-07-01T00:00:00Z');
    const h2Jul = await engine.executeCouponBatch({
      bonds: [bond],
      positions: [pos],
      periodKey: 'period_2026-Q3',
      now: Date.parse('2026-07-01T00:00:00Z'),
    });
    assert.equal(h2Jul.couponCount, 1, 'Ledger-only legacy Q1 key must NOT block next valid H2 period in July');
    assert.equal(h2Jul.totalCouponPaid, Math.round(100 * 10000 * (0.04 / 2)));
  }

  // 2. 원장 트리밍 압축 후(settledBondCouponQuarterIntervals) & 레거시 월 키(period_2026-02) 단독 존재 검증
  {
    const { db, userId, bond, engine, pos } = setupBondTest({ payments_per_year: 4 });
    const febKey = engine.generateIdempotencyKey(bond.id, userId, 'period_2026-02', 'COUPON');
    db.settlementLedger.set(febKey, {
      trade_id: febKey,
      stock_id: bond.id,
      price: 0,
      size: 0,
      total_amount: 10000,
      buyer_fee_rate: 0,
      seller_fee_rate: 0,
      buyer_fee_amount: 0,
      seller_fee_amount: 0,
      settled_at: '2026-02-15T00:00:00Z',
    });
    db.trimSettlementLedger(0); // settledBondCouponIntervals로 압축
    assert.equal(db.settlementLedger.size, 0);
    assert.equal(db.isTradeAlreadySettled(febKey), true);

    const q1Res = await engine.executeCouponBatch({
      bonds: [bond],
      positions: [pos],
      periodKey: 'period_2026-Q1',
      now: Date.parse('2026-03-15T00:00:00Z'),
    });
    assert.equal(q1Res.couponCount, 0, 'Compressed legacy monthly key 2026-02 must block Q1');

    const q2Res = await engine.executeCouponBatch({
      bonds: [bond],
      positions: [pos],
      periodKey: 'period_2026-Q2',
      now: Date.parse('2026-04-01T00:00:00Z'),
    });
    assert.equal(q2Res.couponCount, 1, 'Legacy monthly key 2026-02 must NOT block Q2');
  }

  // 3. 월지급 채권(payments_per_year = 12):
  //    (a) 원장 단독 legacy period_2026-Q1 (시각 미상): Q1(2월) 보수적 차단, Q2(4월) 정상 지급
  {
    const { db, userId, bond, engine, pos } = setupBondTest({ payments_per_year: 12 });
    const q1Key = engine.generateIdempotencyKey(bond.id, userId, 'period_2026-Q1', 'COUPON');
    db.settlementLedger.set(q1Key, {
      trade_id: q1Key,
      stock_id: bond.id,
      price: 0,
      size: 0,
      total_amount: 3333,
      buyer_fee_rate: 0,
      seller_fee_rate: 0,
      buyer_fee_amount: 0,
      seller_fee_amount: 0,
      settled_at: '2026-01-15T00:00:00Z',
    });

    const febBlocked = await engine.executeCouponBatch({
      bonds: [bond],
      positions: [pos],
      periodKey: 'period_2026-Q1',
      now: Date.parse('2026-02-15T00:00:00Z'),
    });
    assert.equal(febBlocked.couponCount, 0, 'Timestamp-less legacy Q1 key conservatively blocks overlapping Q1 month');

    const aprPaid = await engine.executeCouponBatch({
      bonds: [bond],
      positions: [pos],
      periodKey: 'period_2026-Q2',
      now: Date.parse('2026-04-01T00:00:00Z'),
    });
    assert.equal(aprPaid.couponCount, 1, 'Timestamp-less legacy Q1 key must NOT block Q2 April month');
  }

  //    (b) 실측 이력(bondCouponPayments.paid_at = 2026-01-15)이 있는 period_2026-Q1:
  //        1월은 실측 겹침으로 차단, 2월은 실측 시각(1/15 < 2/1) 근거로 정상 지급
  {
    const { userId, bond, repos, engine, pos } = setupBondTest({ payments_per_year: 12 });
    const q1Key = engine.generateIdempotencyKey(bond.id, userId, 'period_2026-Q1', 'COUPON');
    await repos.settlement.settleBondCoupon(userId, bond.id, 3333, q1Key, Date.parse('2026-01-15T00:00:00Z'));

    const janRes = await engine.executeCouponBatch({
      bonds: [bond],
      positions: [pos],
      periodKey: 'period_2026-Q1',
      now: Date.parse('2026-01-20T00:00:00Z'),
    });
    assert.equal(janRes.couponCount, 0, 'Timestamped Jan payment must block Jan');

    const febRes = await engine.executeCouponBatch({
      bonds: [bond],
      positions: [pos],
      periodKey: 'period_2026-Q1',
      now: Date.parse('2026-02-15T00:00:00Z'),
    });
    assert.equal(febRes.couponCount, 1, 'Timestamped Jan payment under Q1 key must NOT block Feb monthly coupon');
  }

  // 4. 무이표채 & 만기 경계 검증
  {
    // (a) 무이표채: 만기 1ms 전 미지급, 만기 정각 원금만 상환(이자 0)
    const zeroMatIso = '2026-07-01T00:00:00.000Z';
    const zeroMatMs = Date.parse(zeroMatIso);
    const { db, userId, bond, engine, pos } = setupBondTest({
      coupon_rate: 0,
      maturity_date: zeroMatIso,
    });

    const beforeMat = await engine.executeCouponBatch({
      bonds: [bond],
      positions: [pos],
      periodKey: 'period_2026-Q2',
      now: zeroMatMs - 1,
    });
    assert.equal(beforeMat.couponCount, 0);
    assert.equal(beforeMat.redemptionCount, 0);
    assert.equal(db.holdings.has(`${userId}_${bond.id}`), true);

    const atMat = await engine.executeCouponBatch({
      bonds: [bond],
      positions: [pos],
      periodKey: 'period_2026-Q3',
      now: zeroMatMs,
    });
    assert.equal(atMat.couponCount, 0);
    assert.equal(atMat.redemptionCount, 1);
    assert.equal(atMat.totalCouponPaid, 0);
    assert.equal(atMat.totalPrincipalRedeemed, 100 * 10000);
    assert.equal(db.holdings.has(`${userId}_${bond.id}`), false);
    assert.equal(db.resolveProfileByUserId(userId)!.cash, 1_000_000 + 100 * 10000);
  }

  {
    // (b) 반기 이표채 만기 경계: H1 내 원장 단독 Q1 키가 있으면 만기 시 최종 쿠폰 중복 없이 원금만 상환
    const matIso = '2026-06-15T00:00:00.000Z';
    const { db, userId, bond, engine, pos } = setupBondTest({
      payments_per_year: 2,
      coupon_rate: 6.0,
      maturity_date: matIso,
    });
    const q1Key = engine.generateIdempotencyKey(bond.id, userId, 'period_2026-Q1', 'COUPON');
    db.settlementLedger.set(q1Key, {
      trade_id: q1Key,
      stock_id: bond.id,
      price: 0,
      size: 0,
      total_amount: 30000,
      buyer_fee_rate: 0,
      seller_fee_rate: 0,
      buyer_fee_amount: 0,
      seller_fee_amount: 0,
      settled_at: '2026-03-01T00:00:00Z',
    });

    const matRes = await engine.executeCouponBatch({
      bonds: [bond],
      positions: [pos],
      periodKey: 'period_2026-Q2',
      now: Date.parse(matIso),
    });
    assert.equal(matRes.redemptionCount, 1);
    assert.equal(matRes.totalPrincipalRedeemed, 100 * 10000);
    assert.equal(matRes.totalCouponPaid, 0, 'Overlapping H1 ledger-only Q1 key must prevent duplicate final coupon at maturity');
    assert.equal(db.resolveProfileByUserId(userId)!.cash, 1_000_000 + 100 * 10000);
  }

  {
    // (c) 반기 이표채가 다음 반기(H2: 2026-07-15)에 만기 시 H1 레거시 Q1 키가 있어도 최종 H2 쿠폰 + 원금 정상 상환
    const matIso = '2026-07-15T00:00:00.000Z';
    const { db, userId, bond, engine, pos } = setupBondTest({
      payments_per_year: 2,
      coupon_rate: 6.0,
      maturity_date: matIso,
    });
    const q1Key = engine.generateIdempotencyKey(bond.id, userId, 'period_2026-Q1', 'COUPON');
    db.settlementLedger.set(q1Key, {
      trade_id: q1Key,
      stock_id: bond.id,
      price: 0,
      size: 0,
      total_amount: 30000,
      buyer_fee_rate: 0,
      seller_fee_rate: 0,
      buyer_fee_amount: 0,
      seller_fee_amount: 0,
      settled_at: '2026-03-01T00:00:00Z',
    });

    const matRes = await engine.executeCouponBatch({
      bonds: [bond],
      positions: [pos],
      periodKey: 'period_2026-Q3',
      now: Date.parse(matIso),
    });
    const expectedFinalCoupon = Math.round(100 * 10000 * (0.06 / 2));
    assert.equal(matRes.redemptionCount, 1);
    assert.equal(matRes.totalPrincipalRedeemed, 100 * 10000);
    assert.equal(matRes.totalCouponPaid, expectedFinalCoupon, 'Earlier H1 legacy Q1 key must NOT block H2 final coupon at maturity');
    assert.equal(db.resolveProfileByUserId(userId)!.cash, 1_000_000 + 100 * 10000 + expectedFinalCoupon);
  }

  console.log('  ✓ P2 통과');
}

async function runColdStartChildAssertions(): Promise<void> {
  const dataDir = process.env.STOCKSYS_DATA_DIR;
  assert.ok(dataDir, 'Child process must receive isolated STOCKSYS_DATA_DIR');
  const snapshotPath = path.join(dataDir, 'snapshot.json');
  const initialDiskText = fs.readFileSync(snapshotPath, 'utf8');

  // 원자재 공개 API(/api/commodities) 및 ensureCommodityEngineReady/start를 전혀 호출하지 않은 콜드 스타트 상태
  const { POST: adminScenarioPost } = await import('../app/api/admin/scenarios/route');
  const { commodityEngineInstance } = await import('../lib/commodities/commodityEngineInstance');
  const { memoryDb } = await import('../lib/memoryDb/memoryStore');
  const { persistenceManager } = await import('../lib/memoryDb/PersistenceManager');
  const { stopLocalStandaloneEngine } = await import('../lib/engine/localStandaloneServer');

  assert.equal(commodityEngineInstance.currentTick, 0, 'Cold-start commodity engine tick must start at 0 before first admin call');
  assert.equal(commodityEngineInstance.eventSystem.activeEvents.length, 0, 'Cold-start commodity eventSystem must start empty before reconcile');
  assert.equal((commodityEngineInstance as any).isRunning, false, 'Cold-start commodity timer must NOT be running');

  const postMacroShock = (shockType: string) =>
    adminScenarioPost(
      new Request('http://localhost:3000/api/admin/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger_macro_shock', shockType }),
      })
    );

  const initialPersisted = JSON.parse(initialDiskText);
  const initialPersistedEventState = initialPersisted.commodityEventRuntimeState;
  const originalSave = persistenceManager.saveSnapshot.bind(persistenceManager);
  try {
    // 1. 저장 실패(false) 시 기존 영속 상태(이벤트/뉴스/이력/수동순번/틱) 보존 및 롤백 확인
    persistenceManager.saveSnapshot = async () => false;
    const failFalseRes = await postMacroShock('GEOPOLITICAL_CRISIS');
    assert.equal(failFalseRes.status, 500, 'Persist false must return 500');
    assert.equal((commodityEngineInstance as any).isRunning, false, 'Commodity timer must remain stopped');
    assert.equal(commodityEngineInstance.currentTick, 17, 'Reconciled commodity tick must be preserved');

    const afterFalseSnap = commodityEngineInstance.eventSystem.snapshotState();
    assert.equal(afterFalseSnap.activeEvents.length, 1);
    assert.equal(afterFalseSnap.activeEvents[0].id, 'ev_manual_17_EV_OPEC_CUT_3');
    assert.equal(afterFalseSnap.newsFeed.length, 1);
    assert.equal(afterFalseSnap.newsFeed[0].id, 'news_manual_17_EV_OPEC_CUT_3');
    assert.equal(afterFalseSnap.eventHistory.length, 1);
    assert.equal(afterFalseSnap.eventHistory[0].id, 'ev_manual_17_EV_OPEC_CUT_3');
    assert.equal(afterFalseSnap.manualSequence, 3);
    assert.deepEqual(afterFalseSnap, initialPersistedEventState, 'Runtime event state must match pre-shock persisted state');
    assert.deepEqual(memoryDb.commodityEventRuntimeState, initialPersistedEventState, 'DB event runtime state must match pre-shock persisted state');
    assert.equal(fs.readFileSync(snapshotPath, 'utf8'), initialDiskText, 'Disk snapshot must stay untouched on persist false');

    // 2. 저장 실패(throw) 시에도 동일하게 기존 영속 상태 유지 확인
    persistenceManager.saveSnapshot = async () => {
      throw new Error('Injected cold-start macro persist throw');
    };
    const failThrowRes = await postMacroShock('RATE_HIKE_SHOCK');
    assert.equal(failThrowRes.status, 500, 'Persist throw must return 500');
    const afterThrowSnap = commodityEngineInstance.eventSystem.snapshotState();
    assert.deepEqual(afterThrowSnap, afterFalseSnap, 'Runtime event state must remain unchanged after persist throw');
    assert.deepEqual(memoryDb.commodityEventRuntimeState, afterFalseSnap, 'DB event runtime state must remain unchanged after persist throw');
    assert.equal(fs.readFileSync(snapshotPath, 'utf8'), initialDiskText, 'Disk snapshot must stay untouched on persist throw');

    // 3. 저장 정상 복구 후 콜드 스타트 거시 충격 발동 -> 기존 상태 보존 + 신규 이벤트 1건만 추가 + 타이머 미기동
    persistenceManager.saveSnapshot = originalSave;
    const okRes = await postMacroShock('GEOPOLITICAL_CRISIS');
    assert.equal(okRes.status, 200, 'Macro shock on cold start must succeed when persistence recovers');
    const okJson = await okRes.json();
    assert.equal(okJson.success, true);
    assert.equal((commodityEngineInstance as any).isRunning, false, 'Admin macro shock must NOT start commodity timer');
    assert.equal(commodityEngineInstance.currentTick, 17, 'Persisted commodity tick must be preserved');

    const finalSnap = commodityEngineInstance.eventSystem.snapshotState();
    assert.equal(finalSnap.activeEvents.length, 2, 'Existing active event preserved + 1 new macro event appended');
    assert.equal(finalSnap.activeEvents[0].id, 'ev_manual_17_EV_OPEC_CUT_3');
    assert.equal(finalSnap.activeEvents[1].id, 'ev_manual_17_EV_MIDDLE_EAST_WAR_4');
    assert.equal(finalSnap.activeEvents[1].startTick, 17);
    assert.equal(finalSnap.newsFeed.length, 2, 'New macro news unshifted while preserving existing news');
    assert.equal(finalSnap.newsFeed[0].id, 'news_manual_17_EV_MIDDLE_EAST_WAR_4');
    assert.equal(finalSnap.newsFeed[1].id, 'news_manual_17_EV_OPEC_CUT_3');
    assert.equal(finalSnap.eventHistory.length, 2, 'Existing eventHistory preserved + 1 appended');
    assert.equal(finalSnap.eventHistory[0].id, 'ev_manual_17_EV_OPEC_CUT_3');
    assert.equal(finalSnap.eventHistory[1].id, 'ev_manual_17_EV_MIDDLE_EAST_WAR_4');
    assert.equal(finalSnap.manualSequence, 4, 'manualSequence must continue from persisted 3 to 4');

    const persistedDisk = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
    assert.equal(persistedDisk.commodityCurrentTick, 17);
    assert.equal(persistedDisk.commodityEventRuntimeState.activeEvents.length, 2);
    assert.equal(persistedDisk.commodityEventRuntimeState.newsFeed.length, 2);
    assert.equal(persistedDisk.commodityEventRuntimeState.eventHistory.length, 2);
    assert.equal(persistedDisk.commodityEventRuntimeState.manualSequence, 4);
    assert.equal(persistedDisk.scenarioRuntimeState.activeScenarios.length, 1, 'Existing scenario must be preserved');
    assert.equal(persistedDisk.scenarioRuntimeState.activeMacroShocks.length, 1, 'New macro shock must be appended once');
  } finally {
    persistenceManager.saveSnapshot = originalSave;
    commodityEngineInstance.stop();
    stopLocalStandaloneEngine();
  }
}

async function testP1_ColdStartMacroShockPreservationAndConcurrentReconcile(): Promise<void> {
  console.log('▶ [P1-ColdStart] 자식 프로세스 콜드 스타트 거시 충격 상태 보존 및 동시 reconcile 무교착 검증');

  const { MemoryDatabase } = await import('../lib/memoryDb/memoryStore');
  const { PersistenceManager } = await import('../lib/memoryDb/PersistenceManager');
  const { CommodityMarketEngine } = await import('../lib/commodities/CommodityMarketEngine');
  const { ScenarioManager } = await import('../lib/scenario/ScenarioManager');

  // 1. 격리된 임시 데이터 디렉터리에 콜드 스타트용 영속 스냅샷 생성
  const childDataDir = path.join(tmpRoot, 'cold-start-child-data');
  fs.mkdirSync(childDataDir, { recursive: true });
  const seedDb = new MemoryDatabase();
  seedDb.resetToSeedData({ suppressPublish: true });
  seedDb.commodityCurrentTick = 17;
  seedDb.commodityNextEpoch = 4;
  const seedEngine = new CommodityMarketEngine({ totalBots: 10, eventProbability: 0 });
  const seedEventRandomSnap = seedEngine.eventSystem.snapshotState().randomSnapshot;
  seedDb.commodityEventRuntimeState = {
    activeEvents: [
      {
        id: 'ev_manual_17_EV_OPEC_CUT_3',
        templateId: 'EV_OPEC_CUT',
        title: 'OPEC+ 산유국 전격 감산 합의 발표',
        headline: '기존 활성 원자재 이벤트',
        targetCategories: ['energy'],
        targetCommodityIds: ['CRUDE_OIL'],
        magnitude: 0.045,
        totalTicks: 30,
        remainingTicks: 15,
        startTick: 17,
      },
    ],
    newsFeed: [
      {
        id: 'news_manual_17_EV_OPEC_CUT_3',
        tick: 17,
        timestamp: 1774000017000,
        category: 'energy',
        title: '기존 원자재 뉴스',
        content: '기존 영속 뉴스 본문',
        impactSentiment: 'bullish',
        affectedCommodities: ['CRUDE_OIL'],
      },
    ],
    eventHistory: [
      {
        id: 'ev_manual_17_EV_OPEC_CUT_3',
        templateId: 'EV_OPEC_CUT',
        title: 'OPEC+ 산유국 전격 감산 합의 발표',
        headline: '기존 활성 원자재 이벤트',
        targetCategories: ['energy'],
        targetCommodityIds: ['CRUDE_OIL'],
        magnitude: 0.045,
        totalTicks: 30,
        remainingTicks: 15,
        startTick: 17,
      },
    ],
    manualSequence: 3,
    randomSnapshot: seedEventRandomSnap,
  };
  const scenMgr = new ScenarioManager({ seed: 42 });
  scenMgr.currentTick = 17;
  scenMgr.injectScenario({
    assetType: 'commodity',
    assetId: 'GOLD',
    ticker: 'GC',
    name: '금 선물',
    mode: 'pump',
    durationTicks: 30,
    targetChangePct: 25,
    volumeMultiplier: 2,
    initialPrice: 2350,
    adminUser: 'seed_admin',
  });
  seedDb.scenarioRuntimeState = scenMgr.snapshotState();

  // 계좌 락 경로까지 함께 통과하도록 미체결 원자재 주문/예약 포함
  seedDb.ensureUserProfile('cold_user_1', { cash: 10_000_000 });
  seedDb.commodityOpenOrders.set('usr_e3_t17_s1', {
    id: 'usr_e3_t17_s1',
    commodityId: 'CRUDE_OIL',
    userId: 'cold_user_1',
    side: 'buy',
    type: 'limit',
    price: 75,
    size: 1,
    filled: 0,
    createdAtTick: 17,
    createdAtTime: 1774000017000,
  });
  seedDb.commodityMarginReservations.set('usr_e3_t17_s1', {
    order_id: 'usr_e3_t17_s1',
    user_id: 'cold_user_1',
    commodity_id: 'CRUDE_OIL',
    side: 'buy',
    reserved_krw: 15000,
    margin_per_contract_krw: 15000,
    total_size: 1,
    remaining_size: 1,
    status: 'open',
    created_at: new Date(1774000017000).toISOString(),
  });

  const prevEnvDir = process.env.STOCKSYS_DATA_DIR;
  process.env.STOCKSYS_DATA_DIR = childDataDir;
  try {
    const pm = new PersistenceManager();
    const saved = await pm.saveSnapshot(seedDb);
    assert.equal(saved, true, 'Seed snapshot for cold-start child must save');
    pm.releaseWriterLock();
  } finally {
    process.env.STOCKSYS_DATA_DIR = prevEnvDir;
  }

  // 2. 완전 새 자식 프로세스에서 /api/commodities 선행 호출 없이 trigger_macro_shock 검증
  const tsxCli = require.resolve('tsx/cli');
  const scriptPath = path.resolve(__dirname, 'test-followup-18-p1-p2.ts');
  const child = spawnSync(process.execPath, [tsxCli, scriptPath], {
    env: {
      ...process.env,
      CHILD_COLD_START_TEST: '1',
      STOCKSYS_DATA_DIR: childDataDir,
      ALLOW_DEV_ADMIN: 'true',
    },
    encoding: 'utf8',
    timeout: 20000,
  });
  if (child.status !== 0) {
    throw new Error(
      `Cold-start child process failed (status=${child.status}, signal=${child.signal}):\nSTDOUT:\n${child.stdout}\nSTDERR:\n${child.stderr}`
    );
  }

  // 3. 이미 tickLock을 잡은 흐름과 외부 동시 reconcileWithDatabase 호출이 교착 없이 직렬화·완료되는지 검증
  const lockDb = new MemoryDatabase();
  lockDb.resetToSeedData({ suppressPublish: true });
  lockDb.commodityCurrentTick = 9;
  lockDb.commodityEventRuntimeState = structuredClone(seedDb.commodityEventRuntimeState);
  const lockEngine = new CommodityMarketEngine({ totalBots: 10, eventProbability: 0, db: lockDb });

  let externalReconcilePromise: Promise<void> | null = null;
  let innerCompleted = false;
  await lockEngine.runWithTickLock(async () => {
    // tickLock 보유 중 외부 비동기 흐름이 reconcileWithDatabase를 시작해 tickLock 대기 상태 진입
    externalReconcilePromise = lockEngine.reconcileWithDatabase(lockDb);
    await new Promise((r) => setTimeout(r, 20));
    // 동일 tickLock 보유 흐름 내부에서 reconcileWithDatabase 재진입 호출 -> 교착 없이 즉시 완료되어야 함
    await lockEngine.reconcileWithDatabase(lockDb);
    innerCompleted = true;
    assert.equal(lockEngine.currentTick, 9);
    assert.equal(lockEngine.eventSystem.snapshotState().manualSequence, 3);
  });
  assert.equal(innerCompleted, true);
  assert.ok(externalReconcilePromise);
  await Promise.race([
    externalReconcilePromise!,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Concurrent reconcile deadlocked')), 2000)),
  ]);

  console.log('  ✓ P1-ColdStart 통과');
}

async function main() {
  try {
    if (isChildColdStart) {
      await runColdStartChildAssertions();
      return;
    }
    await testP1_CommodityEventSyncRollbackAndNoResurrection();
    await testP1_ColdStartMacroShockPreservationAndConcurrentReconcile();
    await testP2_BondLegacyLedgerCompatibilityAndBoundaries();
    console.log('\n🎉 ALL #18 FOLLOWUP P1/P2 TESTS PASSED');
  } finally {
    if (!isChildColdStart && tmpRoot) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
