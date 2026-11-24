/**
 * scripts/test-loop3-n01-n03-fixes.ts
 *
 * 3차 리뷰 계정 식별 결함 3건(N-01, N-02, N-03) 회귀 검증 스위트.
 * - 격리된 임시 STOCKSYS_DATA_DIR 및 합성 데이터만 사용합니다.
 * - 운영 .data/, 실제 계정, 운영 설정을 절대 변경하지 않습니다.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-loop3-'));
const tmpDataDir = path.join(tmpRoot, 'data');
fs.mkdirSync(tmpDataDir, { recursive: true });
process.env.STOCKSYS_DATA_DIR = tmpDataDir;

async function testN01_EnsureProfileCollisionAndRollback(): Promise<void> {
  console.log('▶ [N-01] ensureUserProfile 독립 PK 할당 및 authOptions 저장 실패 롤백·재시도·동시성 검증');

  const { MemoryDatabase, memoryDb } = await import('../lib/memoryDb/memoryStore');
  const { ensureRestoredAndPersistUserProfile, authOptions } = await import('../lib/auth/authOptions');
  const { persistenceManager } = await import('../lib/memoryDb/PersistenceManager');
  const { ensureLocalStandaloneReady, getLocalStandaloneEngine } = await import('../lib/engine/localStandaloneServer');

  await ensureLocalStandaloneReady();
  getLocalStandaloneEngine()?.stop();

  // 1. MemoryDatabase 단위: PK 충돌 시 기존 행 덮어쓰기 방지 및 독립 PK 할당
  const db = new MemoryDatabase();
  const collidingAuthId = 'n01_auth_user_a';
  const otherAuthId = 'n01_auth_other';

  db.profiles.set(collidingAuthId, {
    id: collidingAuthId,
    user_id: otherAuthId,
    username: '타인행',
    nickname: '타인행',
    cash: 777_000,
    net_worth: 777_000,
    rank_tier: 'Gold',
    created_at: db.getIsoTimestamp(),
  });
  db.rebuildIndexes();

  const createdA = db.ensureUserProfile(collidingAuthId, {
    username: '신규A',
    nickname: '신규A',
    email: 'a@synth.local',
  });
  assert.notEqual(createdA.id, collidingAuthId, 'New profile must allocate independent PK when userId collides');
  assert.equal(createdA.user_id, collidingAuthId);
  assert.equal(db.profiles.get(collidingAuthId)?.user_id, otherAuthId, 'Colliding row must not be overwritten');
  assert.equal(db.profiles.get(collidingAuthId)?.cash, 777_000);
  assert.equal(db.resolveProfileByUserId(collidingAuthId)?.id, createdA.id);
  assert.equal(db.resolveProfileByUserId(otherAuthId)?.id, collidingAuthId);

  // 비충돌 레거시 호환: PK 미충돌 시 id === userId 유지
  const normalUid = 'n01_normal_user';
  const createdNormal = db.ensureUserProfile(normalUid, { username: '일반' });
  assert.equal(createdNormal.id, normalUid);
  assert.equal(createdNormal.user_id, normalUid);

  // updateAtomic 예외 발생 후에도 동일 키 큐가 오염되지 않는지 검증
  await assert.rejects(
    db.updateAtomic('profile:n01_queue_test', () => {
      throw new Error('simulated updater failure');
    }),
    /simulated updater failure/
  );
  const queuedAfterErr = await db.updateAtomic('profile:n01_queue_test', () => ({
    id: 'n01_queue_test',
    user_id: 'n01_queue_test',
    username: 'ok',
    nickname: 'ok',
    cash: 123,
    net_worth: 123,
    rank_tier: 'Bronze',
    created_at: db.getIsoTimestamp(),
  }));
  assert.equal(queuedAfterErr.cash, 123, 'Subsequent updateAtomic must recover after prior rejection');

  // 2. authOptions ensureRestoredAndPersistUserProfile: 저장 실패(false/throw) 롤백 시 타인 행/인덱스 보존
  memoryDb.resetToSeedData({ suppressPublish: true });
  memoryDb.profiles.clear();
  memoryDb.profileUserIdIndex.clear();

  const authUid = 'n01_live_auth_a';
  const victimUid = 'n01_live_victim';
  memoryDb.profiles.set(authUid, {
    id: authUid,
    user_id: victimUid,
    username: '피해자B',
    nickname: '피해자B',
    cash: 9_999_000,
    net_worth: 9_999_000,
    rank_tier: 'Platinum',
    created_at: memoryDb.getIsoTimestamp(),
  });
  memoryDb.rebuildIndexes();

  const origSaveSnapshot = persistenceManager.saveSnapshot.bind(persistenceManager);
  try {
    // 2a. saveSnapshot returns false -> rollback created row only, keep colliding victim row & index
    persistenceManager.saveSnapshot = async () => false;
    await ensureRestoredAndPersistUserProfile(authUid, {
      username: '유저A',
      nickname: '유저A',
      email: 'usera@synth.local',
    });

    assert.equal(memoryDb.resolveProfileByUserId(authUid), undefined, 'Failed persist must roll back created profile');
    assert.equal(memoryDb.profiles.size, 1, 'No orphan profile must remain after rollback');
    assert.equal(memoryDb.profiles.get(authUid)?.user_id, victimUid, 'Colliding row must NOT be deleted on rollback');
    assert.equal(memoryDb.profiles.get(authUid)?.cash, 9_999_000);
    assert.equal(memoryDb.profileUserIdIndex.get(victimUid), authUid, 'Victim index must remain intact');

    // 2b. saveSnapshot throws -> NextAuth signIn callback must stay graceful while rolling back
    persistenceManager.saveSnapshot = async () => {
      throw new Error('Injected disk error');
    };
    const signInResult = await authOptions.callbacks!.signIn!({
      user: { id: authUid, name: '유저A', email: 'usera@synth.local' } as any,
      account: null,
      profile: undefined,
    });
    assert.equal(signInResult, true, 'NextAuth signIn callback must stay graceful on persistence error');
    assert.equal(memoryDb.resolveProfileByUserId(authUid), undefined, 'Thrown persist must roll back created profile');
    assert.equal(memoryDb.profiles.get(authUid)?.user_id, victimUid, 'Colliding row must remain intact after thrown persist');

    // 2c. Retry after failure + concurrency: 5 concurrent calls create exactly 1 independent profile
    let saveCalls = 0;
    persistenceManager.saveSnapshot = async () => {
      saveCalls += 1;
      await new Promise((r) => setTimeout(r, 15));
      return true;
    };

    await Promise.all(
      Array.from({ length: 5 }, () =>
        ensureRestoredAndPersistUserProfile(authUid, {
          username: '유저A',
          nickname: '유저A',
          email: 'usera@synth.local',
        })
      )
    );

    assert.equal(saveCalls, 1, 'Concurrent profile ensure for same userId must persist exactly once');
    const persistedProfile = memoryDb.resolveProfileByUserId(authUid);
    assert.ok(persistedProfile, 'Retry after rollback must create and persist profile');
    assert.notEqual(persistedProfile!.id, authUid, 'Persisted profile must keep independent PK');
    assert.equal(memoryDb.profiles.get(authUid)?.user_id, victimUid);
    assert.equal(memoryDb.profiles.size, 2);
  } finally {
    persistenceManager.saveSnapshot = origSaveSnapshot;
  }

  console.log('  ✓ N-01 통과');
}

async function testN02_UpdateCashBalanceOwnershipAndAtomicity(): Promise<void> {
  console.log('▶ [N-02] update_cash_balance 식별자 검증·소유권 격리·잠금 키·원자성 검증');

  const { MemoryDatabase, GUEST_USER_ID } = await import('../lib/memoryDb/memoryStore');
  const { createMemoryDbClient } = await import('../lib/memoryDb/memoryDbClient');
  const { withAccountLocks } = await import('../lib/memoryDb/accountLocks');

  const db = new MemoryDatabase();
  const client = createMemoryDbClient(db);
  const guestBefore = db.resolveProfileByUserId(GUEST_USER_ID)!.cash;

  const legacyPk = 'n02_legacy_pk';
  const authUid = 'n02_auth_uid';
  const collidingOtherUid = 'n02_colliding_other';
  const missingAuthUid = 'n02_missing_auth_uid';

  db.profiles.set(legacyPk, {
    id: legacyPk,
    user_id: authUid,
    username: '레거시소유자',
    nickname: '레거시소유자',
    cash: 100_000,
    net_worth: 100_000,
    rank_tier: 'Silver',
    created_at: db.getIsoTimestamp(),
  });
  db.profiles.set(authUid, {
    id: authUid,
    user_id: collidingOtherUid,
    username: '충돌타인',
    nickname: '충돌타인',
    cash: 555,
    net_worth: 555,
    rank_tier: 'Bronze',
    created_at: db.getIsoTimestamp(),
  });
  db.profiles.set(missingAuthUid, {
    id: missingAuthUid,
    user_id: 'n02_someone_else',
    username: '다른소유자',
    nickname: '다른소유자',
    cash: 888,
    net_worth: 888,
    rank_tier: 'Bronze',
    created_at: db.getIsoTimestamp(),
  });
  db.rebuildIndexes();

  // 1. 식별자 누락 / 모호 / 비정상 delta -> fail-closed & GUEST 미변조
  const badPayloads: Array<[string, Record<string, any>]> = [
    ['empty params', {}],
    ['blank user_id', { p_user_id: '   ', p_delta: 5000 }],
    ['p_user_id != user_id', { p_user_id: authUid, user_id: collidingOtherUid, p_delta: 1000 }],
    ['profile_id only without user_id', { p_profile_id: legacyPk, p_delta: 1000 }],
    ['mismatched p_profile_id', { p_user_id: authUid, p_profile_id: authUid, p_delta: 1000 }],
    ['p_delta != amount', { p_user_id: authUid, p_delta: 100, amount: 200 }],
    ['NaN delta', { p_user_id: authUid, p_delta: 'not_a_number' }],
    ['non-existent user colliding PK', { p_user_id: missingAuthUid, p_delta: 5000 }],
  ];

  for (const [label, payload] of badPayloads) {
    const res = await client.rpc('update_cash_balance', payload);
    assert.ok(res.error, `Must fail closed for ${label}`);
    assert.equal(res.data, null, `Data must be null on error for ${label}`);
  }

  assert.equal(db.resolveProfileByUserId(GUEST_USER_ID)!.cash, guestBefore, 'GUEST cash must remain untouched');
  assert.equal(db.profiles.get(legacyPk)!.cash, 100_000, 'Legacy profile cash must remain untouched');
  assert.equal(db.profiles.get(authUid)!.cash, 555, 'Colliding profile cash must remain untouched');
  assert.equal(db.profiles.get(missingAuthUid)!.cash, 888, 'Unrelated colliding row must remain untouched');
  assert.equal(db.resolveProfileByUserId(missingAuthUid), undefined, 'Must not auto-create unowned profile');

  // 2. 정상 인증 소유 행 갱신 (레거시 PK = legacyPk, 충돌 행 authUid 무변조)
  const okRes = await client.rpc('update_cash_balance', { p_user_id: authUid, p_delta: 25_000 });
  assert.equal(okRes.error, null);
  assert.equal(okRes.data, 125_000);
  assert.equal(db.profiles.get(legacyPk)!.cash, 125_000);
  assert.equal(db.profiles.get(legacyPk)!.net_worth, 125_000);
  assert.equal(db.profiles.get(authUid)!.cash, 555, 'Colliding row must remain untouched on valid update');

  // 3. 잠금 키 일치 및 동시성 원자성 검증 (withAccountLocks([legacyPk])와 직렬화 + 50건 병렬 오차 0)
  const lockTimeline: string[] = [];
  let releaseHold!: () => void;
  const holdGate = new Promise<void>((r) => {
    releaseHold = r;
  });
  const lockHolder = withAccountLocks([legacyPk], async () => {
    lockTimeline.push('enter');
    await holdGate;
    lockTimeline.push('exit');
  });
  await new Promise((r) => setTimeout(r, 10));
  const waitingRpc = client.rpc('update_cash_balance', { user_id: authUid, amount: 5_000 }).then((r) => {
    lockTimeline.push('rpc_done');
    return r;
  });
  await new Promise((r) => setTimeout(r, 15));
  assert.deepEqual(lockTimeline, ['enter'], 'update_cash_balance must wait on canonical profile.id account lock');
  releaseHold();
  await lockHolder;
  const waitRes = await waitingRpc;
  assert.equal(waitRes.error, null);
  assert.equal(waitRes.data, 130_000);
  assert.deepEqual(lockTimeline, ['enter', 'exit', 'rpc_done']);

  // 재진입: 외부에서 동일 계좌 락을 이미 보유한 상태에서도 안전하게 동작
  const reentrantRes = await withAccountLocks([db.resolveAccountLockKey(authUid)], async () => {
    return await client.rpc('update_cash_balance', { p_user_id: authUid, p_delta: 1_000 });
  });
  assert.equal(reentrantRes.error, null);
  assert.equal(reentrantRes.data, 131_000);

  // 50건 병렬 호출 원자성
  const parallelResults = await Promise.all(
    Array.from({ length: 50 }, () => client.rpc('update_cash_balance', { p_user_id: authUid, p_delta: 100 }))
  );
  assert.ok(parallelResults.every((r) => r.error === null));
  assert.equal(db.profiles.get(legacyPk)!.cash, 136_000);
  assert.equal(db.profiles.get(authUid)!.cash, 555);

  // 4. upsert 교차 소유 PK 충돌 차단 검증
  const conflictUpsert = await client
    .from('profiles')
    .upsert({ id: authUid, user_id: authUid, cash: 999_999 });
  assert.ok(conflictUpsert.error, 'Upserting into another user PK must fail closed');
  assert.equal(db.profiles.get(authUid)!.user_id, collidingOtherUid);
  assert.equal(db.profiles.get(authUid)!.cash, 555);

  console.log('  ✓ N-02 통과');
}

async function testN03_LocalDbProfilesExplicitIdVsUserId(): Promise<void> {
  console.log('▶ [N-03] /api/local-db profiles.id PK 전용 해석 vs user_id/기본 조회 구분 검증');

  const { GUEST_USER_ID, memoryDb } = await import('../lib/memoryDb/memoryStore');
  const { ensureLocalStandaloneReady, getLocalStandaloneEngine } = await import('../lib/engine/localStandaloneServer');
  const { POST: localDbPost } = await import('../app/api/local-db/route');

  await ensureLocalStandaloneReady();
  getLocalStandaloneEngine()?.stop();

  const prevDisableGuest = process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;

  try {
    memoryDb.resetToSeedData({ suppressPublish: true });
    memoryDb.profiles.clear();
    memoryDb.profileUserIdIndex.clear();

    const legacyGuestPk = 'n03_legacy_guest_pk';
    const otherUid = 'n03_other_user';

    memoryDb.profiles.set(legacyGuestPk, {
      id: legacyGuestPk,
      user_id: GUEST_USER_ID,
      username: '게스트레거시',
      nickname: '게스트레거시',
      cash: 88_000_000,
      net_worth: 88_000_000,
      rank_tier: 'Diamond',
      is_admin: true,
      created_at: memoryDb.getIsoTimestamp(),
    });
    memoryDb.profiles.set(GUEST_USER_ID, {
      id: GUEST_USER_ID,
      user_id: otherUid,
      username: '충돌타인행',
      nickname: '충돌타인행',
      cash: 333,
      net_worth: 333,
      rank_tier: 'Bronze',
      is_admin: false,
      created_at: memoryDb.getIsoTimestamp(),
    });
    memoryDb.rebuildIndexes();

    const callLocalDb = async (query: Record<string, any>) => {
      const res = await localDbPost(
        new Request('http://localhost:3000/api/local-db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'execute', tableName: 'profiles', query }),
        })
      );
      return { status: res.status, json: await res.json() };
    };

    // 1. 명시적 .eq('id', GUEST_USER_ID)는 본인 인증 ID와 같더라도 PK로만 해석해야 함 (타인 행 마스킹 반환)
    const explicitIdColliding = await callLocalDb({
      action: 'select',
      filters: [{ col: 'id', op: 'eq', val: GUEST_USER_ID }],
      isMaybeSingle: true,
    });
    assert.equal(explicitIdColliding.status, 200);
    assert.equal(explicitIdColliding.json.data?.id, GUEST_USER_ID);
    assert.equal(explicitIdColliding.json.data?.user_id, otherUid);
    assert.equal(explicitIdColliding.json.data?.cash, undefined, 'Non-owner row selected by PK must mask cash');
    assert.equal(explicitIdColliding.json.data?.is_admin, undefined, 'Non-owner row selected by PK must mask is_admin');

    // 2. 명시적 .eq('id', legacyGuestPk)는 본인 소유 PK 행 전체 반환
    const explicitOwnPk = await callLocalDb({
      action: 'select',
      filters: [{ col: 'id', op: 'eq', val: legacyGuestPk }],
      isMaybeSingle: true,
    });
    assert.equal(explicitOwnPk.json.data?.id, legacyGuestPk);
    assert.equal(explicitOwnPk.json.data?.cash, 88_000_000);
    assert.equal(explicitOwnPk.json.data?.is_admin, true);

    // 3. 명시적 .eq('user_id', GUEST_USER_ID)는 인증 계정 소유 행 반환
    const explicitUserId = await callLocalDb({
      action: 'select',
      filters: [{ col: 'user_id', op: 'eq', val: GUEST_USER_ID }],
      isMaybeSingle: true,
    });
    assert.equal(explicitUserId.json.data?.id, legacyGuestPk);
    assert.equal(explicitUserId.json.data?.cash, 88_000_000);

    // 4. 필터가 없는 본인 기본 조회는 인증 계정 소유 행 반환
    const defaultOwnQuery = await callLocalDb({
      action: 'select',
      filters: [],
      isMaybeSingle: true,
    });
    assert.equal(defaultOwnQuery.json.data?.id, legacyGuestPk);
    assert.equal(defaultOwnQuery.json.data?.cash, 88_000_000);

    // 5. PK 충돌 행을 제거한 뒤에도 .eq('id', GUEST_USER_ID)는 user_id로 fallback 하지 않고 null 반환해야 함
    memoryDb.profiles.delete(GUEST_USER_ID);
    memoryDb.rebuildIndexes();
    const missingPkNoFallback = await callLocalDb({
      action: 'select',
      filters: [{ col: 'id', op: 'eq', val: GUEST_USER_ID }],
      isMaybeSingle: true,
    });
    assert.equal(missingPkNoFallback.json.data, null, 'Explicit id filter must NOT fall back to user_id when PK is absent');

    // 6. 충돌하는 중복 id 필터는 null 반환
    const conflictingIds = await callLocalDb({
      action: 'select',
      filters: [
        { col: 'id', op: 'eq', val: legacyGuestPk },
        { col: 'id', op: 'eq', val: 'other_pk' },
      ],
      isMaybeSingle: true,
    });
    assert.equal(conflictingIds.json.data, null);

    // 7. 미인증 상태의 필터 없는 기본 조회는 401 반환
    process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'true';
    const unauthDefault = await callLocalDb({ action: 'select', filters: [], isMaybeSingle: true });
    assert.equal(unauthDefault.status, 401);
  } finally {
    if (prevDisableGuest === undefined) delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
    else process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = prevDisableGuest;
  }

  console.log('  ✓ N-03 통과');
}

async function main() {
  try {
    await testN01_EnsureProfileCollisionAndRollback();
    await testN02_UpdateCashBalanceOwnershipAndAtomicity();
    await testN03_LocalDbProfilesExplicitIdVsUserId();
    console.log('\n🎉 3차 리뷰 N-01~N-03 모든 회귀 테스트 통과!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ 3차 리뷰 회귀 테스트 실패:', err);
    process.exit(1);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main();
