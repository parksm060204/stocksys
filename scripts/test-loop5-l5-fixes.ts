/**
 * scripts/test-loop5-l5-fixes.ts
 *
 * 5차 검증 후속 결함(L5-01, L5-02, 인접 P2) 및 P3 두 관찰 회귀 검증 스위트.
 * - 격리된 임시 STOCKSYS_DATA_DIR 및 합성 데이터만 사용합니다.
 * - 운영 .data/, 실제 계정, 운영 설정을 절대 변경하지 않습니다.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-loop5-'));
const tmpDataDir = path.join(tmpRoot, 'data');
fs.mkdirSync(tmpDataDir, { recursive: true });
process.env.STOCKSYS_DATA_DIR = tmpDataDir;

async function testL501_OptionOrderResolvedAccountLocksAndInvariants(): Promise<void> {
  console.log('▶ [L5-01] submitAuthoritativeOptionOrder 최초 생성/독립 PK 전후 상호배제·다계좌·재진입·재시도·롤백 검증');

  const { MemoryDatabase, memoryDb } = await import('../lib/memoryDb/memoryStore');
  const { ensureRestoredAndPersistUserProfile } = await import('../lib/auth/authOptions');
  const { submitAuthoritativeOptionOrder, OPTIONS_LP_ID } = await import('../lib/options/optionOrderService');
  const { withAccountLocks, withResolvedAccountLocks } = await import('../lib/memoryDb/accountLocks');
  const { persistenceManager } = await import('../lib/memoryDb/PersistenceManager');
  const { ensureLocalStandaloneReady, getLocalStandaloneEngine } = await import('../lib/engine/localStandaloneServer');

  await ensureLocalStandaloneReady();
  getLocalStandaloneEngine()?.stop();

  const origSave = persistenceManager.saveSnapshot.bind(persistenceManager);
  try {
    // 1. 최초 프로필 생성 + 독립 PK 할당 중 옵션 주문과 후속 계좌 작업 간 상호배제 검증
    memoryDb.resetToSeedData({ suppressPublish: true });
    memoryDb.profiles.clear();
    memoryDb.profileUserIdIndex.clear();

    const newAuthUid = 'l501_new_auth_uid';
    const existingOwnerUid = 'l501_existing_owner';
    // newAuthUid와 동일한 PK를 타인이 이미 점유 -> 독립 PK(prof_...) 할당 유도
    memoryDb.profiles.set(newAuthUid, {
      id: newAuthUid,
      user_id: existingOwnerUid,
      username: 'ExistingOwner',
      nickname: 'ExistingOwner',
      cash: 50_000,
      net_worth: 50_000,
      rank_tier: 'Bronze',
      created_at: memoryDb.getIsoTimestamp(),
    });
    memoryDb.profiles.set(OPTIONS_LP_ID, {
      id: OPTIONS_LP_ID,
      user_id: OPTIONS_LP_ID,
      username: 'LP',
      nickname: 'LP',
      cash: 10_000_000_000,
      net_worth: 10_000_000_000,
      rank_tier: 'LP',
      created_at: memoryDb.getIsoTimestamp(),
    });
    memoryDb.rebuildIndexes();

    const contract = Array.from(memoryDb.optionsContracts.values())[0];
    assert.ok(contract, 'Seeded option contract must exist');

    let enterCreatePersist!: () => void;
    const createPersistEntered = new Promise<void>((r) => {
      enterCreatePersist = r;
    });
    let releaseCreatePersist!: () => void;
    const createPersistGate = new Promise<void>((r) => {
      releaseCreatePersist = r;
    });

    persistenceManager.saveSnapshot = async () => {
      enterCreatePersist();
      await createPersistGate;
      return true;
    };

    const createPromise = ensureRestoredAndPersistUserProfile(newAuthUid, {
      username: 'NewOptionTrader',
      nickname: 'NewOptionTrader',
    });
    await createPersistEntered;

    const createdProfile = memoryDb.resolveProfileByUserId(newAuthUid)!;
    assert.ok(createdProfile, 'Profile must be staged during creation');
    assert.notEqual(createdProfile.id, newAuthUid, 'Independent PK must be allocated');
    createdProfile.cash = 100_000_000;
    createdProfile.has_options_license = true;

    const timeline: string[] = [];
    let releaseOrderPersist!: () => void;
    const orderPersistGate = new Promise<void>((r) => {
      releaseOrderPersist = r;
    });
    let enterOrderPersist!: () => void;
    const orderPersistEntered = new Promise<void>((r) => {
      enterOrderPersist = r;
    });

    // 옵션 주문이 생성 직전/도중 키에서 시작해 독립 PK 락으로 전환된 뒤 영속 저장 중 대기하도록 구성
    const optionOrderPromise = submitAuthoritativeOptionOrder({
      db: memoryDb,
      userId: newAuthUid,
      contractId: contract.id,
      side: 'BUY',
      orderType: 'MARKET',
      qty: 1,
      onPersist: async () => {
        timeline.push('opt_persist_enter');
        enterOrderPersist();
        await orderPersistGate;
        timeline.push('opt_persist_exit');
        return true;
      },
    });

    // 생성 완료 전까지는 옵션 주문도 진행할 수 없음
    await new Promise((r) => setTimeout(r, 15));
    assert.deepEqual([...timeline], [], 'Option order must wait while profile creation holds account lock');

    // 생성 완료 후: 옵션 주문이 독립 PK 락을 획득해 onPersist에 진입
    releaseCreatePersist();
    await createPromise;
    await orderPersistEntered;
    assert.deepEqual([...timeline], ['opt_persist_enter']);

    // 옵션 주문이 onPersist 중일 때, 동일 계좌(독립 PK)에 대한 다른 계좌 작업은 상호 배제되어 대기해야 함
    const peerAccountOp = withResolvedAccountLocks(
      () => [memoryDb.resolveAccountLockKey(newAuthUid)],
      async () => {
        timeline.push('peer_enter');
        timeline.push('peer_exit');
      }
    );

    await new Promise((r) => setTimeout(r, 15));
    assert.deepEqual(
      [...timeline],
      ['opt_persist_enter'],
      'Peer account operation on canonical PK must wait while option order holds lock'
    );

    releaseOrderPersist();
    const [optRes] = await Promise.all([optionOrderPromise, peerAccountOp]);
    assert.equal(optRes.success, true, `Option order must succeed, got: ${optRes.message}`);
    assert.deepEqual([...timeline], ['opt_persist_enter', 'opt_persist_exit', 'peer_enter', 'peer_exit']);
    assert.equal(
      memoryDb.profiles.get(newAuthUid)?.cash,
      50_000,
      'Colliding profile row must remain untouched'
    );

    // 2. 다계좌(유저 간 휴면 매칭) + 재진입 + 롤백·재시도 단위 검증
    const db = new MemoryDatabase();
    db.profiles.clear();
    db.profileUserIdIndex.clear();
    db.orders.clear();
    db.holdings.clear();
    db.rebuildIndexes();

    const sellerAuth = 'l501_seller_auth';
    const buyerAuth = 'l501_buyer_auth';
    db.profiles.set('l501_pk_seller', {
      id: 'l501_pk_seller',
      user_id: sellerAuth,
      username: 'Seller',
      nickname: 'Seller',
      cash: 1_000_000,
      net_worth: 1_000_000,
      rank_tier: 'Silver',
      has_options_license: true,
      created_at: db.getIsoTimestamp(),
    });
    db.profiles.set('l501_pk_buyer', {
      id: 'l501_pk_buyer',
      user_id: buyerAuth,
      username: 'Buyer',
      nickname: 'Buyer',
      cash: 100_000_000,
      net_worth: 100_000_000,
      rank_tier: 'Silver',
      has_options_license: true,
      created_at: db.getIsoTimestamp(),
    });
    db.profiles.set(OPTIONS_LP_ID, {
      id: OPTIONS_LP_ID,
      user_id: OPTIONS_LP_ID,
      username: 'LP',
      nickname: 'LP',
      cash: 10_000_000_000,
      net_worth: 10_000_000_000,
      rank_tier: 'LP',
      created_at: db.getIsoTimestamp(),
    });
    db.rebuildIndexes();

    const c2 = Array.from(db.optionsContracts.values())[0];
    c2.current_price = 10.0; // lpAskPrice=10.0, lpBidPrice=9.8
    const multiplier = c2.multiplier ?? 250000;
    db.holdings.set(`${sellerAuth}_${c2.id}`, {
      id: `${sellerAuth}_${c2.id}`,
      user_id: sellerAuth,
      stock_id: c2.id,
      quantity: 2,
      avg_price: 2.0,
      created_at: db.getIsoTimestamp(),
    });
    db.addHoldingToIndex(db.holdings.get(`${sellerAuth}_${c2.id}`)!);

    // 매도 휴면 주문 (lpBidPrice 9.8 초과, lpAskPrice 10.0 미만인 9.9로 휴면 대기)
    const restSellRes = await submitAuthoritativeOptionOrder({
      db,
      userId: sellerAuth,
      contractId: c2.id,
      side: 'SELL',
      orderType: 'LIMIT',
      price: 9.9,
      qty: 2,
      onPersist: async () => true,
    });
    assert.equal(restSellRes.success, true);
    assert.equal(restSellRes.order?.status, 'open');

    // 재진입 계약 검증: 필요한 모든 계좌 락을 이미 보유한 외부 스코프에서는 재진입 성공
    const reentrantRes = await withAccountLocks(
      [db.resolveAccountLockKey(buyerAuth), db.resolveAccountLockKey(sellerAuth)],
      async () => {
        return await submitAuthoritativeOptionOrder({
          db,
          userId: buyerAuth,
          contractId: c2.id,
          side: 'BUY',
          orderType: 'LIMIT',
          price: 9.9,
          qty: 1,
          onPersist: async () => false, // 영속 실패로 롤백 검증
        });
      }
    );
    assert.equal(reentrantRes.success, false);
    assert.equal(db.resolveProfileByUserId(buyerAuth)?.cash, 100_000_000, 'Buyer cash must roll back');
    assert.equal(db.resolveProfileByUserId(sellerAuth)?.cash, 1_000_000, 'Seller cash must roll back');
    assert.equal(db.holdings.get(`${sellerAuth}_${c2.id}`)?.quantity, 2, 'Seller holding must roll back');
    assert.equal(db.orders.get(restSellRes.order!.orderId)?.filled, 0, 'Resting order filled must roll back');

    // 누락된 상대방 락 없이 buyerAuth만 잡은 외부 스코프는 lock ordering violation 유지
    await assert.rejects(
      () =>
        withAccountLocks([db.resolveAccountLockKey(buyerAuth)], async () => {
          return await submitAuthoritativeOptionOrder({
            db,
            userId: buyerAuth,
            contractId: c2.id,
            side: 'BUY',
            orderType: 'LIMIT',
            price: 9.9,
            qty: 1,
            onPersist: async () => true,
          });
        }),
      /Lock ordering violation/
    );

    // 정상 재시도 성공
    const retryOk = await submitAuthoritativeOptionOrder({
      db,
      userId: buyerAuth,
      contractId: c2.id,
      side: 'BUY',
      orderType: 'LIMIT',
      price: 9.9,
      qty: 1,
      onPersist: async () => true,
    });
    assert.equal(retryOk.success, true);
    const fillNotional = Math.round(9.9 * multiplier);
    const fee = Math.round(fillNotional * 0.001);
    assert.equal(db.resolveProfileByUserId(buyerAuth)?.cash, 100_000_000 - fillNotional - fee);
    assert.equal(db.resolveProfileByUserId(sellerAuth)?.cash, 1_000_000 + fillNotional - fee);
    assert.equal(db.holdings.get(`${buyerAuth}_${c2.id}`)?.quantity, 1);
    assert.equal(db.holdings.get(`${sellerAuth}_${c2.id}`)?.quantity, 1);
  } finally {
    persistenceManager.saveSnapshot = origSave;
  }

  console.log('  ✓ L5-01 통과');
}

async function testL502_PeriodicSettlementSingleResolutionAndSnapshotRollback(): Promise<void> {
  console.log('▶ [L5-02] getOpenOptionOrderAccountIds & runPeriodicSettlementBatch 단일 락 해석·실프로필 스냅샷·false/throw 롤백·재시도 검증');

  const { memoryDb } = await import('../lib/memoryDb/memoryStore');
  const { createInMemoryRepositoryBundle } = await import('../lib/repositories/inMemory');
  const { LocalMarketEngineInstance, ensureLocalStandaloneReady, getLocalStandaloneEngine } = await import('../lib/engine/localStandaloneServer');
  const { withAccountLocks } = await import('../lib/memoryDb/accountLocks');

  await ensureLocalStandaloneReady();
  getLocalStandaloneEngine()?.stop();

  memoryDb.resetToSeedData({ suppressPublish: true });
  memoryDb.profiles.clear();
  memoryDb.profileUserIdIndex.clear();
  memoryDb.holdings.clear();
  memoryDb.orders.clear();
  memoryDb.rebuildIndexes();

  // 의도적 이중 해석 함정 구성:
  // Alice: authUid='l502_auth_alice', profile.id='l502_auth_bob' (Bob의 user_id와 동일!)
  // Bob:   authUid='l502_auth_bob',   profile.id='l502_pk_bob'
  // 만약 resolveAccountLockKey('l502_auth_alice')가 두 번 호출되면 'l502_auth_bob' -> 'l502_pk_bob'으로 빗나감!
  const authAlice = 'l502_auth_alice';
  const authBob = 'l502_auth_bob';
  const pkBob = 'l502_pk_bob';

  memoryDb.profiles.set(authBob, {
    id: authBob,
    user_id: authAlice,
    username: 'Alice',
    nickname: 'Alice',
    cash: 2_000_000,
    margin_debt_krw: 500_000,
    net_worth: 1_500_000,
    rank_tier: 'Gold',
    has_options_license: true,
    created_at: memoryDb.getIsoTimestamp(),
  });
  memoryDb.profiles.set(pkBob, {
    id: pkBob,
    user_id: authBob,
    username: 'Bob',
    nickname: 'Bob',
    cash: 9_000_000,
    margin_debt_krw: 100_000,
    net_worth: 8_900_000,
    rank_tier: 'Silver',
    created_at: memoryDb.getIsoTimestamp(),
  });
  memoryDb.rebuildIndexes();

  const expOptId = 'opt_l502_expired';
  const pastIso = new Date(memoryDb.getNowMs() - 60_000).toISOString();
  memoryDb.optionsContracts.set(expOptId, {
    id: expOptId,
    underlying_stock_id: 'idx_k200',
    ticker: 'IDX-K200-L502-C260',
    asset_class: 'IDX',
    type: 'CALL',
    option_type: 'CALL',
    strike_price: 260,
    current_price: 2.0,
    multiplier: 250000,
    expiry_date: pastIso,
  });

  // Alice의 만기 옵션 미체결 매수 주문 (주문 해제 시 현금으로 마진 부채 500,000 상환 가능하도록 가용 현금 충분)
  const openOrderId = 'ord_l502_open';
  memoryDb.orders.set(openOrderId, {
    id: openOrderId,
    stock_id: expOptId,
    user_id: authAlice,
    side: 'buy',
    price: 2.0,
    size: 1,
    filled: 0,
    status: 'open',
    is_lp: false,
    created_at: memoryDb.getIsoTimestamp(),
    order_type: 'limit',
  });
  memoryDb.addOrderToIndex(memoryDb.orders.get(openOrderId)!);

  // 1. 인터페이스/저장소 ID 의미 보존: getOpenOptionOrderAccountIds는 canonical user_id 반환
  const repo = createInMemoryRepositoryBundle(memoryDb);
  const openAccIds = repo.settlement.getOpenOptionOrderAccountIds?.([expOptId]);
  assert.deepEqual(openAccIds, [authAlice], 'getOpenOptionOrderAccountIds must return canonical ord.user_id');

  const eng = new LocalMarketEngineInstance();

  // 2. persistFn returning false -> 주문·현금·부채·인덱스 완전 원복
  await (eng as any).runPeriodicSettlementBatch(async () => false);
  assert.equal(memoryDb.orders.get(openOrderId)?.status, 'open', 'Order status must roll back on persist false');
  assert.equal(memoryDb.orderStockIndex.get(expOptId)?.has(openOrderId), true, 'orderStockIndex must stay intact');
  assert.equal(memoryDb.orderUserIndex.get(authAlice)?.has(openOrderId), true, 'orderUserIndex must stay intact');
  assert.equal(memoryDb.profiles.get(authBob)?.cash, 2_000_000, 'Alice cash must roll back on persist false');
  assert.equal(memoryDb.profiles.get(authBob)?.margin_debt_krw, 500_000, 'Alice margin_debt_krw must roll back on persist false');
  assert.equal(memoryDb.profiles.get(pkBob)?.cash, 9_000_000, 'Bob cash must remain untouched');
  assert.equal(memoryDb.profiles.get(pkBob)?.margin_debt_krw, 100_000, 'Bob debt must remain untouched');

  // 3. persistFn throwing -> 주문·현금·부채·인덱스 완전 원복
  await (eng as any).runPeriodicSettlementBatch(async () => {
    throw new Error('Injected settlement persist throw');
  });
  assert.equal(memoryDb.orders.get(openOrderId)?.status, 'open', 'Order status must roll back on persist throw');
  assert.equal(memoryDb.orderStockIndex.get(expOptId)?.has(openOrderId), true);
  assert.equal(memoryDb.orderUserIndex.get(authAlice)?.has(openOrderId), true);
  assert.equal(memoryDb.profiles.get(authBob)?.cash, 2_000_000, 'Alice cash must roll back on persist throw');
  assert.equal(memoryDb.profiles.get(authBob)?.margin_debt_krw, 500_000, 'Alice margin_debt_krw must roll back on persist throw');
  assert.equal(memoryDb.profiles.get(pkBob)?.cash, 9_000_000);
  assert.equal(memoryDb.profiles.get(pkBob)?.margin_debt_krw, 100_000);

  // 4. 동시성 락 키 일치 검증: Alice의 정규 락 키(authBob)가 잠겨 있을 때 배치가 대기해야 함
  const lockTrace: string[] = [];
  let releaseAliceLock!: () => void;
  const aliceLockGate = new Promise<void>((r) => {
    releaseAliceLock = r;
  });
  const aliceLockHolder = withAccountLocks([memoryDb.resolveAccountLockKey(authAlice)], async () => {
    lockTrace.push('alice_hold_enter');
    await aliceLockGate;
    lockTrace.push('alice_hold_exit');
  });
  await new Promise((r) => setTimeout(r, 10));

  const batchPromise = (eng as any).runPeriodicSettlementBatch(async () => {
    lockTrace.push('batch_persist');
    return true;
  });
  await new Promise((r) => setTimeout(r, 15));
  assert.deepEqual(
    lockTrace,
    ['alice_hold_enter'],
    'runPeriodicSettlementBatch must wait on canonical lock key of Alice (not double-resolved Bob PK)'
  );

  releaseAliceLock();
  await Promise.all([aliceLockHolder, batchPromise]);
  assert.deepEqual(lockTrace, ['alice_hold_enter', 'alice_hold_exit', 'batch_persist']);

  // 5. 재시도 성공 결과 검증: 주문 expired 전환 + Alice 부채 전액 상환 + Bob 무변조
  assert.equal(memoryDb.orders.get(openOrderId)?.status, 'expired');
  assert.equal(memoryDb.profiles.get(authBob)?.cash, 1_500_000);
  assert.equal(memoryDb.profiles.get(authBob)?.margin_debt_krw, undefined);
  assert.equal(memoryDb.profiles.get(pkBob)?.cash, 9_000_000);
  assert.equal(memoryDb.profiles.get(pkBob)?.margin_debt_krw, 100_000);

  console.log('  ✓ L5-02 통과');
}

async function testAdjacentP2_CommitBatchProfilePkAllocation(): Promise<void> {
  console.log('▶ [인접 P2] InMemorySettlementRepository.commitBatch 새 프로필 PK 할당 충돌 방지 검증');

  const { MemoryDatabase, STOCK_UUID_MAP } = await import('../lib/memoryDb/memoryStore');
  const { createInMemoryRepositoryBundle } = await import('../lib/repositories/inMemory');

  const db = new MemoryDatabase();
  db.profiles.clear();
  db.profileUserIdIndex.clear();
  db.orders.clear();
  db.holdings.clear();
  db.rebuildIndexes();

  const stockId = STOCK_UUID_MAP['0010'];
  const botId = 'bot_p2_inst';
  const buyerId = 'p2_buyer_uid';

  // botId는 institutionalPortfolios에만 있고 profiles에는 없음 (needsProfileCreation = true)
  db.institutionalPortfolios.set(botId, {
    bot_id: botId,
    name: 'P2 Inst Bot',
    total_capital: 50_000_000,
    current_cash: 50_000_000,
    current_stock: 100,
  });
  db.holdings.set(`${botId}_${stockId}`, {
    id: `${botId}_${stockId}`,
    user_id: botId,
    stock_id: stockId,
    quantity: 100,
    avg_price: 70_000,
    created_at: db.getIsoTimestamp(),
  });
  db.addHoldingToIndex(db.holdings.get(`${botId}_${stockId}`)!);

  // 1. botId를 PK로 가진 타인 행 배치
  db.profiles.set(botId, {
    id: botId,
    user_id: 'p2_other_user_1',
    username: 'Other1',
    nickname: 'Other1',
    cash: 111_000,
    net_worth: 111_000,
    rank_tier: 'Bronze',
    created_at: db.getIsoTimestamp(),
  });
  // 2. 첫 번째 generateId('prof')가 반환할 키를 예측해 기존 PK로 점유
  const snapGen = db.snapshotIdGenerator();
  const firstProfId = db.generateId('prof');
  const secondProfId = db.generateId('prof');
  db.restoreIdGenerator(snapGen);

  db.profiles.set(firstProfId, {
    id: firstProfId,
    user_id: 'p2_other_user_2',
    username: 'Other2',
    nickname: 'Other2',
    cash: 222_000,
    net_worth: 222_000,
    rank_tier: 'Bronze',
    created_at: db.getIsoTimestamp(),
  });
  // 3. 두 번째 generateId('prof')가 반환할 키는 다른 프로필의 user_id로 점유
  db.profiles.set('p2_pk_holding_second_prof_uid', {
    id: 'p2_pk_holding_second_prof_uid',
    user_id: secondProfId,
    username: 'Other3',
    nickname: 'Other3',
    cash: 333_000,
    net_worth: 333_000,
    rank_tier: 'Bronze',
    created_at: db.getIsoTimestamp(),
  });
  db.profiles.set(buyerId, {
    id: buyerId,
    user_id: buyerId,
    username: 'Buyer',
    nickname: 'Buyer',
    cash: 10_000_000,
    net_worth: 10_000_000,
    rank_tier: 'Gold',
    created_at: db.getIsoTimestamp(),
  });
  db.rebuildIndexes();

  const repo = createInMemoryRepositoryBundle(db);
  const buyOrderId = 'ord_p2_buy';
  const sellOrderId = 'ord_p2_sell';

  // 실패 주입 시 새로 만든 프로필만 롤백되고 충돌 행은 보존되어야 함
  const failBatch = await repo.settlement.commitMatchedBatchAtomically({
    newOrders: [
      {
        id: buyOrderId,
        stock_id: stockId,
        user_id: buyerId,
        side: 'buy',
        price: 70_000,
        size: 10,
        filled: 0,
        status: 'open',
        is_lp: false,
        created_at: db.getIsoTimestamp(),
      },
      {
        id: sellOrderId,
        stock_id: stockId,
        user_id: botId,
        side: 'sell',
        price: 70_000,
        size: 10,
        filled: 0,
        status: 'open',
        is_lp: false,
        created_at: db.getIsoTimestamp(),
      },
    ],
    trades: [
      {
        id: 'tr_p2_fail',
        stock_id: stockId,
        buyer_id: buyerId,
        seller_id: botId,
        buy_order_id: buyOrderId,
        sell_order_id: sellOrderId,
        buyer_is_bot: false,
        seller_is_bot: true,
        price: 70_000,
        size: 10,
        fee_rates: { buyerFeeRate: 0.001, sellerFeeRate: 0.001 },
      },
    ],
    faultInjection: 'FAIL_AFTER_HOLDINGS_UPDATED',
  });
  assert.equal(failBatch.success, false);
  assert.equal(failBatch.rollbackOccurred, true);
  assert.equal(db.resolveProfileByUserId(botId), undefined);
  assert.equal(db.profiles.get(botId)?.cash, 111_000);
  assert.equal(db.profiles.get(firstProfId)?.cash, 222_000);
  assert.equal(db.resolveProfileByUserId(secondProfId)?.cash, 333_000);

  // 정상 커밋 시 3번째 이상 비충돌 PK를 할당하고 기존 충돌 행들을 전혀 훼손하지 않음
  const okBatch = await repo.settlement.commitMatchedBatchAtomically({
    newOrders: [
      {
        id: buyOrderId,
        stock_id: stockId,
        user_id: buyerId,
        side: 'buy',
        price: 70_000,
        size: 10,
        filled: 0,
        status: 'open',
        is_lp: false,
        created_at: db.getIsoTimestamp(),
      },
      {
        id: sellOrderId,
        stock_id: stockId,
        user_id: botId,
        side: 'sell',
        price: 70_000,
        size: 10,
        filled: 0,
        status: 'open',
        is_lp: false,
        created_at: db.getIsoTimestamp(),
      },
    ],
    trades: [
      {
        id: 'tr_p2_ok',
        stock_id: stockId,
        buyer_id: buyerId,
        seller_id: botId,
        buy_order_id: buyOrderId,
        sell_order_id: sellOrderId,
        buyer_is_bot: false,
        seller_is_bot: true,
        price: 70_000,
        size: 10,
        fee_rates: { buyerFeeRate: 0.001, sellerFeeRate: 0.001 },
      },
    ],
  });
  assert.equal(okBatch.success, true, okBatch.error);
  const createdBotProfile = db.resolveProfileByUserId(botId)!;
  assert.ok(createdBotProfile);
  assert.notEqual(createdBotProfile.id, botId);
  assert.notEqual(createdBotProfile.id, firstProfId);
  assert.notEqual(createdBotProfile.id, secondProfId);
  assert.equal(db.profiles.get(botId)?.cash, 111_000);
  assert.equal(db.profiles.get(firstProfId)?.cash, 222_000);
  assert.equal(db.resolveProfileByUserId(secondProfId)?.cash, 333_000);

  console.log('  ✓ 인접 P2 통과');
}

async function testP3_ObservationsVerification(): Promise<void> {
  console.log('▶ [P3] 명시 PK 충돌 정책(InMemoryParticipantRepository) 및 시장 리셋 시 이벤트·시나리오 정리 검증');

  const { MemoryDatabase, memoryDb, GUEST_USER_ID } = await import('../lib/memoryDb/memoryStore');
  const { createInMemoryRepositoryBundle } = await import('../lib/repositories/inMemory');
  const { resetStandaloneMarketAtomically, ensureLocalStandaloneReady, getLocalStandaloneEngine } = await import('../lib/engine/localStandaloneServer');

  // P3-1: InMemoryParticipantRepository.updateProfile 명시 PK 충돌 시 비파괴 독립 PK 할당 정책 확인
  const db = new MemoryDatabase();
  db.profiles.clear();
  db.profileUserIdIndex.clear();
  db.profiles.set('shared_pk', {
    id: 'shared_pk',
    user_id: 'owner_1',
    username: 'Owner1',
    nickname: 'Owner1',
    cash: 500_000,
    net_worth: 500_000,
    rank_tier: 'Bronze',
    created_at: db.getIsoTimestamp(),
  });
  db.rebuildIndexes();

  const bundle = createInMemoryRepositoryBundle(db);
  await bundle.participants.updateProfile('owner_2', {
    id: 'shared_pk',
    user_id: 'owner_2',
    username: 'Owner2',
    cash: 700_000,
  });
  const p1 = await bundle.participants.getProfile('owner_1');
  const p2 = await bundle.participants.getProfile('owner_2');
  assert.equal(p1?.id, 'shared_pk');
  assert.equal(p1?.cash, 500_000, 'Existing PK row must never be overwritten');
  assert.ok(p2 && p2.id !== 'shared_pk' && p2.user_id === 'owner_2' && p2.cash === 700_000);

  // P3-2: 시장 리셋 시 activePlayerEvents/activeManipulations/scenarioRuntimeState 정리 + 카탈로그(playerEvents/botsConfig) 보존 + 실패 롤백
  await ensureLocalStandaloneReady();
  getLocalStandaloneEngine()?.stop();
  memoryDb.resetToSeedData({ suppressPublish: true });
  memoryDb.playerEvents = [{ id: 'ev_cat_1', title: 'Catalog Event' }];
  memoryDb.botsConfig = [{ id: 'bot_cfg_1', bot_id: 'bot_cfg_1' }];
  memoryDb.activePlayerEvents = [
    { id: 'ape_1', user_id: GUEST_USER_ID, event_id: 'ev_cat_1', status: 'pending' },
  ];
  memoryDb.activeManipulations = [
    { id: 'man_1', stock_id: '0010', status: 'pending' },
  ];
  memoryDb.scenarioRuntimeState = { activeScenarios: [['sc1', { id: 'sc1' }]], activeMacroShocks: [], actionLogs: [] };
  const prevScenarioResetVersion = memoryDb.scenarioResetVersion;

  // 실패 시 activePlayerEvents / activeManipulations / scenarioRuntimeState 모두 롤백
  const failReset = await resetStandaloneMarketAtomically(async () => false);
  assert.equal(failReset, false);
  assert.equal(memoryDb.activePlayerEvents.length, 1);
  assert.equal(memoryDb.activeManipulations.length, 1);
  assert.ok(memoryDb.scenarioRuntimeState);
  assert.equal(memoryDb.scenarioResetVersion, prevScenarioResetVersion);

  // 성공 시 activePlayerEvents / activeManipulations / scenarioRuntimeState 초기화, 카탈로그 보존
  const okReset = await resetStandaloneMarketAtomically(async () => true);
  assert.equal(okReset, true);
  assert.equal(memoryDb.activePlayerEvents.length, 0, 'Active player events must clear on market reset');
  assert.equal(memoryDb.activeManipulations.length, 0, 'Active manipulations must clear on market reset');
  assert.equal(memoryDb.scenarioRuntimeState, null, 'Scenario runtime state must clear on market reset');
  assert.equal(memoryDb.scenarioResetVersion, prevScenarioResetVersion + 1);
  assert.equal(memoryDb.playerEvents.length, 1, 'Player event catalog must remain preserved');
  assert.equal(memoryDb.botsConfig.length, 1, 'Bot config catalog must remain preserved');

  console.log('  ✓ P3 관찰 검증 통과');
}

async function main() {
  try {
    await testL501_OptionOrderResolvedAccountLocksAndInvariants();
    await testL502_PeriodicSettlementSingleResolutionAndSnapshotRollback();
    await testAdjacentP2_CommitBatchProfilePkAllocation();
    await testP3_ObservationsVerification();
    console.log('\n🎉 5차 검증 후속 결함 L5-01, L5-02, 인접 P2, P3 관찰 모든 회귀 테스트 통과!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ 5차 검증 회귀 테스트 실패:', err);
    process.exit(1);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main();
