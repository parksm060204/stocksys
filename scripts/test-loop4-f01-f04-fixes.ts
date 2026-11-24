/**
 * scripts/test-loop4-f01-f04-fixes.ts
 *
 * 4차 리뷰 후속 결함 4건(F-01~F-04) 회귀 검증 스위트.
 * - 격리된 임시 STOCKSYS_DATA_DIR 및 합성 데이터만 사용합니다.
 * - 운영 .data/, 실제 계정, 운영 설정을 절대 변경하지 않습니다.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-loop4-'));
const tmpDataDir = path.join(tmpRoot, 'data');
fs.mkdirSync(tmpDataDir, { recursive: true });
process.env.STOCKSYS_DATA_DIR = tmpDataDir;

async function testF01_TriggerRandomEventsCanonicalOwner(): Promise<void> {
  console.log('▶ [F-01] triggerRandomEvents canonical 인증 계정 귀속 및 적재·조회·해결 경계 검증');

  const { MemoryDatabase, GUEST_USER_ID, memoryDb } = await import('../lib/memoryDb/memoryStore');
  const { createInMemoryRepositoryBundle } = await import('../lib/repositories/inMemory');
  const { MarketEngine } = await import('../engine-server/src/MarketEngine');
  const { createSimulationContext } = await import('../lib/engine/simulation/runtime');
  const { resolvePlayerEventChoice } = await import('../lib/events/playerEventService');
  const { ensureLocalStandaloneReady, getLocalStandaloneEngine } = await import('../lib/engine/localStandaloneServer');
  const { POST: localDbPost } = await import('../app/api/local-db/route');

  // 1. 격리 DB에서 레거시(id !== user_id), PK 충돌, user_id 누락 레거시 행에 대한 triggerRandomEvents 검증
  const db = new MemoryDatabase();
  db.profiles.clear();
  db.profileUserIdIndex.clear();
  db.playerEvents = [
    {
      id: 'pe_synth_1',
      stage: 1,
      title: '합성 돌발 이벤트',
      description: '테스트용 이벤트',
      choice_a_text: '선택 A',
      choice_a_cost: 50_000,
      choice_a_passive: 'SYNTH_PASSIVE_A',
      choice_b_text: '선택 B',
      choice_b_cost: 0,
      choice_b_passive: null,
    },
  ];

  const legacyPkAlice = 'f01_legacy_pk_alice';
  const authAlice = 'f01_auth_alice';
  const authBob = 'f01_auth_bob';
  const legacyNoUid = 'f01_legacy_no_uid';

  db.profiles.set(legacyPkAlice, {
    id: legacyPkAlice,
    user_id: authAlice,
    username: 'Alice',
    nickname: 'Alice',
    cash: 1_000_000,
    net_worth: 1_000_000,
    rank_tier: 'Bronze',
    created_at: db.getIsoTimestamp(),
  });
  // 의도적 PK 충돌: Bob의 profile.id === authAlice
  db.profiles.set(authAlice, {
    id: authAlice,
    user_id: authBob,
    username: 'Bob',
    nickname: 'Bob',
    cash: 2_000_000,
    net_worth: 2_000_000,
    rank_tier: 'Bronze',
    created_at: db.getIsoTimestamp(),
  });
  // user_id 없는 레거시 행
  db.profiles.set(legacyNoUid, {
    id: legacyNoUid,
    username: 'LegacyNoUid',
    nickname: 'LegacyNoUid',
    cash: 3_000_000,
    net_worth: 3_000_000,
    rank_tier: 'Bronze',
    created_at: db.getIsoTimestamp(),
  } as any);
  db.rebuildIndexes();

  const repositories = createInMemoryRepositoryBundle(db);
  const simCtx = createSimulationContext({ seed: 123, runId: 'f01_run' });
  const engine = new MarketEngine({ simulationContext: simCtx, repositories });

  // deterministic하게 이벤트가 반드시 발동하도록 eventRandom stub (단위 검증용)
  (engine as any).eventRandom = {
    nextBoolean: () => true,
    nextInt: (_min: number, max: number) => (max > 0 ? 0 : 0),
  };

  await (engine as any).triggerRandomEvents();

  assert.equal(db.activePlayerEvents.length, 3, 'All 3 eligible users must receive an active event');
  const owners = db.activePlayerEvents.map((e) => e.user_id).sort();
  assert.deepEqual(
    owners,
    [authAlice, authBob, legacyNoUid].sort(),
    'Active events must be owned by canonical account IDs, never colliding PKs'
  );
  assert.equal(
    db.activePlayerEvents.some((e) => e.user_id === legacyPkAlice),
    false,
    'Profile PK legacyPkAlice must NOT be stored as event user_id'
  );
  for (const ev of db.activePlayerEvents) {
    assert.ok(typeof ev.id === 'string' && ev.id.length > 0, 'Saved active event must have generated id');
    assert.ok(typeof ev.created_at === 'string' && ev.created_at.length > 0, 'Saved active event must have created_at');
  }

  // 스냅샷 export -> import 경계에서도 소유자/프로필 매핑 일관성 유지 검증
  const exported = db.exportSnapshot();
  const restoredDb = new MemoryDatabase();
  restoredDb.importSnapshot(exported);
  assert.equal(restoredDb.resolveProfileByUserId(authAlice)?.id, legacyPkAlice);
  assert.equal(restoredDb.resolveProfileByUserId(authBob)?.id, authAlice);
  assert.equal(restoredDb.resolveProfileByUserId(legacyNoUid)?.id, legacyNoUid);
  assert.equal(restoredDb.activePlayerEvents.length, 3);

  // 해결 경계 검증: Bob은 Alice의 이벤트 해결 불가(403), Alice는 해결 성공 후 legacyPkAlice 잔고 차감
  const aliceEv = restoredDb.activePlayerEvents.find((e) => e.user_id === authAlice)!;
  const crossResolve = await resolvePlayerEventChoice({
    db: restoredDb,
    userId: authBob,
    activeEventId: aliceEv.id,
    choice: 'A',
    onPersist: async () => true,
  });
  assert.equal(crossResolve.success, false);
  assert.equal(crossResolve.statusCode, 403);

  const okResolve = await resolvePlayerEventChoice({
    db: restoredDb,
    userId: authAlice,
    activeEventId: aliceEv.id,
    choice: 'A',
    onPersist: async () => true,
  });
  assert.equal(okResolve.success, true);
  assert.equal(restoredDb.profiles.get(legacyPkAlice)?.cash, 950_000);
  assert.deepEqual(restoredDb.profiles.get(legacyPkAlice)?.acquired_passives, ['SYNTH_PASSIVE_A']);
  assert.equal(restoredDb.profiles.get(authAlice)?.cash, 2_000_000, 'Colliding Bob profile must remain untouched');

  // user_id 없는 레거시 행도 자신의 이벤트 해결 가능
  const noUidEv = restoredDb.activePlayerEvents.find((e) => e.user_id === legacyNoUid)!;
  const noUidResolve = await resolvePlayerEventChoice({
    db: restoredDb,
    userId: legacyNoUid,
    activeEventId: noUidEv.id,
    choice: 'A',
    onPersist: async () => true,
  });
  assert.equal(noUidResolve.success, true);
  assert.equal(restoredDb.profiles.get(legacyNoUid)?.cash, 2_950_000);

  // 2. /api/local-db 조회 경계 검증 (GUEST_USER_ID 세션 기준, 타인의 충돌 PK와 격리)
  await ensureLocalStandaloneReady();
  getLocalStandaloneEngine()?.stop();
  const prevDisableGuest = process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  try {
    memoryDb.resetToSeedData({ suppressPublish: true });
    memoryDb.profiles.delete(GUEST_USER_ID);
    memoryDb.profiles.set('f01_route_legacy_pk', {
      id: 'f01_route_legacy_pk',
      user_id: GUEST_USER_ID,
      username: 'GuestLegacy',
      nickname: 'GuestLegacy',
      cash: 50_000_000,
      net_worth: 50_000_000,
      rank_tier: 'Silver',
      created_at: memoryDb.getIsoTimestamp(),
    });
    memoryDb.profiles.set(GUEST_USER_ID, {
      id: GUEST_USER_ID,
      user_id: 'f01_other_user',
      username: 'OtherUser',
      nickname: 'OtherUser',
      cash: 10_000_000,
      net_worth: 10_000_000,
      rank_tier: 'Bronze',
      created_at: memoryDb.getIsoTimestamp(),
    });
    memoryDb.rebuildIndexes();
    memoryDb.playerEvents = [...db.playerEvents];
    memoryDb.activePlayerEvents = [];

    const routeRepo = createInMemoryRepositoryBundle(memoryDb);
    const routeSimCtx = createSimulationContext({ seed: 124, runId: 'f01_route_run' });
    const routeEngine = new MarketEngine({ simulationContext: routeSimCtx, repositories: routeRepo });
    (routeEngine as any).eventRandom = { nextBoolean: () => true, nextInt: () => 0 };
    await (routeEngine as any).triggerRandomEvents();

    const evRes = await localDbPost(
      new Request('http://localhost/api/local-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          tableName: 'active_player_events',
          query: { action: 'select', filters: [{ col: 'status', op: 'eq', val: 'pending' }] },
        }),
      })
    );
    assert.equal(evRes.status, 200);
    const evJson = await evRes.json();
    assert.equal(evJson.data.length, 1);
    assert.equal(evJson.data[0].user_id, GUEST_USER_ID);
  } finally {
    if (prevDisableGuest === undefined) delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
    else process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = prevDisableGuest;
  }

  console.log('  ✓ F-01 통과');
}

async function testF02_ProfilesSelectPolicyAndFilterValidation(): Promise<void> {
  console.log('▶ [F-02] profiles select 필터·OR 그룹·민감 속성·빈 값·조합 조건 정책 검증');

  const { GUEST_USER_ID, memoryDb } = await import('../lib/memoryDb/memoryStore');
  const { ensureLocalStandaloneReady, getLocalStandaloneEngine } = await import('../lib/engine/localStandaloneServer');
  const { POST: localDbPost } = await import('../app/api/local-db/route');

  await ensureLocalStandaloneReady();
  getLocalStandaloneEngine()?.stop();

  const prevDisableGuest = process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;

  const callProfilesSelect = async (query: Record<string, any>) => {
    const res = await localDbPost(
      new Request('http://localhost/api/local-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'execute', tableName: 'profiles', query }),
      })
    );
    return { status: res.status, json: await res.json() };
  };

  try {
    memoryDb.resetToSeedData({ suppressPublish: true });
    memoryDb.profiles.clear();
    memoryDb.profileUserIdIndex.clear();

    const ownLegacyPk = 'f02_own_legacy_pk';
    const otherAuthUid = 'f02_other_auth_uid';
    const noUidLegacyId = 'f02_no_uid_legacy';

    memoryDb.profiles.set(ownLegacyPk, {
      id: ownLegacyPk,
      user_id: GUEST_USER_ID,
      username: 'OwnUser',
      nickname: 'OwnNick',
      cash: 77_000_000,
      net_worth: 77_000_000,
      rank_tier: 'Diamond',
      is_admin: true,
      created_at: memoryDb.getIsoTimestamp(),
    });
    memoryDb.profiles.set(GUEST_USER_ID, {
      id: GUEST_USER_ID,
      user_id: otherAuthUid,
      username: 'OtherColliding',
      nickname: 'OtherColliding',
      cash: 111,
      net_worth: 111,
      rank_tier: 'Bronze',
      is_admin: false,
      created_at: memoryDb.getIsoTimestamp(),
    });
    memoryDb.profiles.set(noUidLegacyId, {
      id: noUidLegacyId,
      username: 'LegacyNoUid',
      nickname: 'LegacyNoUid',
      cash: 222,
      net_worth: 222,
      rank_tier: 'Silver',
      created_at: memoryDb.getIsoTimestamp(),
    } as any);
    memoryDb.rebuildIndexes();

    // 1. 필터와 OR 그룹이 실제로 없을 때만 기본 본인 조회
    const ownDefault = await callProfilesSelect({ action: 'select', filters: [], orFilterGroups: [], isMaybeSingle: true });
    assert.equal(ownDefault.status, 200);
    assert.equal(ownDefault.json.data?.id, ownLegacyPk);
    assert.equal(ownDefault.json.data?.cash, 77_000_000);

    // 2. OR 그룹 존재 시 기본 본인 조회로 fallthrough 금지, 명시적 거절(403)
    const orGroupCases = [
      { action: 'select', filters: [], orFilterGroups: [`id.eq.${GUEST_USER_ID},cash.gt.0`] },
      { action: 'select', orFilterGroups: [`user_id.eq.${otherAuthUid},is_admin.eq.false`] },
      { action: 'select', or: `id.eq.${ownLegacyPk},cash.gt.1` },
      { action: 'select', or: [`id.eq.${ownLegacyPk}`] },
    ];
    for (const q of orGroupCases) {
      const res = await callProfilesSelect(q);
      assert.equal(res.status, 403, `OR query must be rejected with 403: ${JSON.stringify(q)}`);
      assert.equal(res.json.data, null);
    }

    // 3. 지원하지 않거나 민감한 속성/연산자/정렬 명시적 거절(403)
    const disallowedQueries = [
      { action: 'select', filters: [{ col: 'cash', op: 'gt', val: 0 }] },
      { action: 'select', filters: [{ col: 'net_worth', op: 'gte', val: 100 }] },
      { action: 'select', filters: [{ col: 'is_admin', op: 'eq', val: true }] },
      { action: 'select', filters: [{ col: 'email', op: 'eq', val: 'a@b.c' }] },
      { action: 'select', filters: [{ col: 'margin_debt_krw', op: 'gt', val: 0 }] },
      { action: 'select', filters: [{ col: 'username', op: 'eq', val: 'OwnUser' }] },
      { action: 'select', filters: [{ col: 'id', op: 'eq', val: GUEST_USER_ID }, { col: 'cash', op: 'gt', val: 50 }] },
      { action: 'select', filters: [{ col: 'id', op: 'neq', val: GUEST_USER_ID }] },
      { action: 'select', filters: [{ col: 'user_id', op: 'in', val: [GUEST_USER_ID, otherAuthUid] }] },
      { action: 'select', filters: [{ col: 'id', op: 'eq', val: ownLegacyPk }], orderCol: 'cash' },
      { action: 'select', filters: [{ col: 'id', op: 'eq', val: ownLegacyPk }], orderSpecs: [{ col: 'is_admin', ascending: false }] },
    ];
    for (const q of disallowedQueries) {
      const res = await callProfilesSelect(q);
      assert.equal(res.status, 403, `Disallowed/sensitive query must be rejected with 403: ${JSON.stringify(q)}`);
      assert.equal(res.json.data, null);
    }

    // 4. 빈 값 / 공백 / 잘못된 타입 필터 거절(400)
    const emptyOrInvalidQueries = [
      { action: 'select', filters: [{ col: 'id', op: 'eq', val: '' }] },
      { action: 'select', filters: [{ col: 'id', op: 'eq', val: '   ' }] },
      { action: 'select', filters: [{ col: 'user_id', op: 'eq', val: null }] },
      { action: 'select', filters: [{ col: 'user_id', op: 'eq', val: '   ' }] },
      { action: 'select', filters: 'not-an-array' },
      { action: 'select', orFilterGroups: 'not-an-array' },
    ];
    for (const q of emptyOrInvalidQueries) {
      const res = await callProfilesSelect(q);
      assert.equal(res.status, 400, `Empty/malformed filter must be rejected with 400: ${JSON.stringify(q)}`);
      assert.equal(res.json.data, null);
    }

    // 5. 명시적 PK vs 인증 계정 ID 분리 및 조합·충돌 조건 일관성 검증
    // 5a. id=ownLegacyPk & user_id=GUEST_USER_ID (본인 일치 조합) -> 본인 전체 반환
    const combinedOwn = await callProfilesSelect({
      action: 'select',
      filters: [
        { col: 'id', op: 'eq', val: ownLegacyPk },
        { col: 'user_id', op: 'eq', val: GUEST_USER_ID },
      ],
      isMaybeSingle: true,
    });
    assert.equal(combinedOwn.status, 200);
    assert.equal(combinedOwn.json.data?.id, ownLegacyPk);
    assert.equal(combinedOwn.json.data?.cash, 77_000_000);

    // 5b. id=GUEST_USER_ID & user_id=GUEST_USER_ID (충돌 조합: PK는 타인행, user_id는 본인) -> null
    const combinedConflict = await callProfilesSelect({
      action: 'select',
      filters: [
        { col: 'id', op: 'eq', val: GUEST_USER_ID },
        { col: 'user_id', op: 'eq', val: GUEST_USER_ID },
      ],
      isMaybeSingle: true,
    });
    assert.equal(combinedConflict.status, 200);
    assert.equal(combinedConflict.json.data, null);

    // 5c. id=GUEST_USER_ID & user_id=otherAuthUid (타인 일치 조합) -> 마스킹 반환
    const combinedOther = await callProfilesSelect({
      action: 'select',
      filters: [
        { col: 'id', op: 'eq', val: GUEST_USER_ID },
        { col: 'user_id', op: 'eq', val: otherAuthUid },
      ],
      isMaybeSingle: true,
    });
    assert.equal(combinedOther.status, 200);
    assert.equal(combinedOther.json.data?.id, GUEST_USER_ID);
    assert.equal(combinedOther.json.data?.cash, undefined);

    // 5d. user_id 없는 레거시 행 조회 -> 마스킹 반환
    const noUidLookup = await callProfilesSelect({
      action: 'select',
      filters: [{ col: 'user_id', op: 'eq', val: noUidLegacyId }],
      isMaybeSingle: true,
    });
    assert.equal(noUidLookup.status, 200);
    assert.equal(noUidLookup.json.data?.id, noUidLegacyId);
    assert.equal(noUidLookup.json.data?.cash, undefined);

    // 5e. 중복 상충 user_id 필터 -> null
    const dupUserIds = await callProfilesSelect({
      action: 'select',
      filters: [
        { col: 'user_id', op: 'eq', val: GUEST_USER_ID },
        { col: 'user_id', op: 'eq', val: otherAuthUid },
      ],
      isMaybeSingle: true,
    });
    assert.equal(dupUserIds.status, 200);
    assert.equal(dupUserIds.json.data, null);
  } finally {
    if (prevDisableGuest === undefined) delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
    else process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = prevDisableGuest;
  }

  console.log('  ✓ F-02 통과');
}

async function testF03_ProfilesUpdateRollbackAndConcurrency(): Promise<void> {
  console.log('▶ [F-03] profiles update false/예외 롤백·잠금/commitGate 직렬화·메모리/저장 일치 검증');

  const { GUEST_USER_ID, memoryDb } = await import('../lib/memoryDb/memoryStore');
  const { persistenceManager } = await import('../lib/memoryDb/PersistenceManager');
  const { ensureLocalStandaloneReady, getLocalStandaloneEngine } = await import('../lib/engine/localStandaloneServer');
  const { POST: localDbPost } = await import('../app/api/local-db/route');

  await ensureLocalStandaloneReady();
  getLocalStandaloneEngine()?.stop();

  const prevDisableGuest = process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;

  const callUpdate = (nickname: string) =>
    localDbPost(
      new Request('http://localhost/api/local-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          tableName: 'profiles',
          query: { action: 'update', payloadData: { nickname } },
        }),
      })
    );

  const origSaveSnapshot = persistenceManager.saveSnapshot.bind(persistenceManager);
  try {
    memoryDb.resetToSeedData({ suppressPublish: true });
    memoryDb.profiles.delete(GUEST_USER_ID);
    const pk = 'f03_legacy_pk';
    memoryDb.profiles.set(pk, {
      id: pk,
      user_id: GUEST_USER_ID,
      username: '초기이름',
      nickname: '초기닉네임',
      cash: 10_000_000,
      net_worth: 10_000_000,
      rank_tier: 'Gold',
      created_at: memoryDb.getIsoTimestamp(),
    });
    memoryDb.rebuildIndexes();

    // 1. saveSnapshot -> false 반환 시 live Map 복원
    persistenceManager.saveSnapshot = async () => false;
    const falseRes = await callUpdate('실패닉네임1');
    assert.equal(falseRes.status, 500);
    assert.equal(memoryDb.profiles.get(pk)?.nickname, '초기닉네임', 'Must restore nickname when persist returns false');
    assert.equal(memoryDb.resolveProfileByUserId(GUEST_USER_ID)?.nickname, '초기닉네임');

    // 2. saveSnapshot -> 예외 throw 시 live Map 복원 및 500 JSON 응답
    persistenceManager.saveSnapshot = async () => {
      throw new Error('Disk I/O injected failure');
    };
    const throwRes = await callUpdate('예외닉네임2');
    assert.equal(throwRes.status, 500);
    const throwJson = await throwRes.json();
    assert.match(String(throwJson.error?.message), /Disk I\/O injected failure/);
    assert.equal(memoryDb.profiles.get(pk)?.nickname, '초기닉네임', 'Must restore nickname when persist throws');
    assert.equal(memoryDb.resolveProfileByUserId(GUEST_USER_ID)?.nickname, '초기닉네임');

    // 3. 진행 중인 실패 쓰기와 후속 정상 쓰기 동시 실행:
    //    commitGate + accountLock 안에서 첫 쓰기가 롤백된 뒤 두 번째 쓰기가 실행되며 덮어쓰지 않음 + 디스크/메모리 일치
    let callIdx = 0;
    let persistedSnapshotNickname: string | undefined;
    let enterPersistFirst!: () => void;
    const firstPersistEntered = new Promise<void>((r) => {
      enterPersistFirst = r;
    });
    let releaseFirstPersist!: () => void;
    const firstPersistGate = new Promise<void>((r) => {
      releaseFirstPersist = r;
    });

    persistenceManager.saveSnapshot = async (dbArg) => {
      callIdx += 1;
      if (callIdx === 1) {
        enterPersistFirst();
        await firstPersistGate;
        throw new Error('First write failed');
      }
      const ok = await origSaveSnapshot(dbArg);
      const snapProfile = dbArg.resolveProfileByUserId(GUEST_USER_ID);
      persistedSnapshotNickname = snapProfile?.nickname;
      return ok;
    };

    const req1Promise = callUpdate('첫번째실패');
    await firstPersistEntered;
    // 첫 번째가 commitGate 내부에서 대기 중일 때 두 번째 정상 요청 발행
    const req2Promise = callUpdate('두번째성공');
    // 동시에 외부 saveSnapshot도 commitGate를 우회해 미확정 상태를 저장하지 못해야 함
    let externalSavedDuringFirst: boolean | undefined;
    const externalSnapPromise = origSaveSnapshot(memoryDb).then((ok) => {
      externalSavedDuringFirst = ok;
      return ok;
    });

    await new Promise((r) => setTimeout(r, 15));
    assert.equal(externalSavedDuringFirst, undefined, 'External saveSnapshot must wait behind commitGate');

    releaseFirstPersist();
    const [res1, res2] = await Promise.all([req1Promise, req2Promise, externalSnapPromise]);
    assert.equal(res1.status, 500);
    assert.equal(res2.status, 200);
    assert.equal(memoryDb.profiles.get(pk)?.nickname, '두번째성공', 'Rollback of req1 must not overwrite req2');
    assert.equal(persistedSnapshotNickname, '두번째성공', 'Persisted snapshot must match final live memory state');
  } finally {
    persistenceManager.saveSnapshot = origSaveSnapshot;
    if (prevDisableGuest === undefined) delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
    else process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = prevDisableGuest;
  }

  console.log('  ✓ F-03 통과');
}

async function testF04_ProfilesInsertUpsertInvariantsAndLockTransition(): Promise<void> {
  console.log('▶ [F-04] profiles insert/upsert 유일성·무user_id 소유권·배치 원자성·직접 호출부·잠금 키 전환 검증');

  const { MemoryDatabase, memoryDb } = await import('../lib/memoryDb/memoryStore');
  const { createMemoryDbClient } = await import('../lib/memoryDb/memoryDbClient');
  const { createInMemoryRepositoryBundle } = await import('../lib/repositories/inMemory');
  const { ensureRestoredAndPersistUserProfile } = await import('../lib/auth/authOptions');
  const { persistenceManager } = await import('../lib/memoryDb/PersistenceManager');
  const { withResolvedAccountLocks } = await import('../lib/memoryDb/accountLocks');
  const { ensureLocalStandaloneReady, getLocalStandaloneEngine } = await import('../lib/engine/localStandaloneServer');

  const db = new MemoryDatabase();
  db.profiles.clear();
  db.profileUserIdIndex.clear();

  // 기존 행: (1) 레거시 독립 PK (2) user_id 없는 레거시 행
  db.profiles.set('pk_alice', {
    id: 'pk_alice',
    user_id: 'uid_alice',
    username: 'Alice',
    nickname: 'Alice',
    cash: 1_000,
    net_worth: 1_000,
    rank_tier: 'Bronze',
    created_at: db.getIsoTimestamp(),
  });
  db.profiles.set('legacy_no_uid', {
    id: 'legacy_no_uid',
    username: 'NoUidUser',
    nickname: 'NoUidUser',
    cash: 2_000,
    net_worth: 2_000,
    rank_tier: 'Silver',
    created_at: db.getIsoTimestamp(),
  } as any);
  db.rebuildIndexes();

  const client = createMemoryDbClient(db);

  // 1. insert: 중복 user_id, 무user_id 충돌, 배치 부분 반영 방지
  const dupUidInsert = await client.from('profiles').insert({
    id: 'pk_new_alice',
    user_id: 'uid_alice',
    username: 'DupAlice',
    nickname: 'DupAlice',
    cash: 999,
    net_worth: 999,
    rank_tier: 'Bronze',
  });
  assert.ok(dupUidInsert.error, 'Insert with duplicate user_id must fail');
  assert.equal(db.profiles.has('pk_new_alice'), false);
  assert.equal(db.profileUserIdIndex.get('uid_alice'), 'pk_alice');

  const collideNoUidInsert = await client.from('profiles').insert({
    id: 'pk_steal_nouid',
    user_id: 'legacy_no_uid',
    username: 'Steal',
    nickname: 'Steal',
    cash: 999,
    net_worth: 999,
    rank_tier: 'Bronze',
  });
  assert.ok(collideNoUidInsert.error, 'Insert colliding with owner of row without user_id must fail');
  assert.equal(db.profiles.has('pk_steal_nouid'), false);

  const batchInsertFail = await client.from('profiles').insert([
    {
      id: 'pk_batch_valid',
      user_id: 'uid_batch_valid',
      username: 'Valid',
      nickname: 'Valid',
      cash: 500,
      net_worth: 500,
      rank_tier: 'Bronze',
    },
    {
      id: 'pk_batch_conflict',
      user_id: 'uid_alice', // 충돌!
      username: 'Conflict',
      nickname: 'Conflict',
      cash: 500,
      net_worth: 500,
      rank_tier: 'Bronze',
    },
  ]);
  assert.ok(batchInsertFail.error, 'Batch insert must fail if any item fails');
  assert.equal(db.profiles.has('pk_batch_valid'), false, 'Failed batch insert must NOT leave partial rows');
  assert.equal(db.profileUserIdIndex.has('uid_batch_valid'), false, 'Failed batch insert must NOT leave partial index');

  // 2. upsert: user_id 없는 기존 행 탈취 차단 + 기존 동일 계정 갱신 의미 보존 + 배치 원자성
  const stealNoUidUpsert = await client.from('profiles').upsert({
    id: 'legacy_no_uid',
    user_id: 'attacker_uid',
    cash: 9_999_999,
  });
  assert.ok(stealNoUidUpsert.error, 'Upsert must reject claiming a row without user_id under another user_id');
  assert.equal(db.profiles.get('legacy_no_uid')?.cash, 2_000);
  assert.equal(db.profiles.get('legacy_no_uid')?.user_id, undefined);
  assert.equal(db.resolveProfileByUserId('attacker_uid'), undefined);

  // 동일 소유자의 user_id 없는 기존 행 갱신 허용 및 인덱스 정합성 유지
  const ownNoUidUpsert = await client.from('profiles').upsert({
    id: 'legacy_no_uid',
    cash: 2_500,
  });
  assert.equal(ownNoUidUpsert.error, null);
  assert.equal(db.profiles.get('legacy_no_uid')?.cash, 2_500);
  assert.equal(db.resolveProfileByUserId('legacy_no_uid')?.id, 'legacy_no_uid');

  // id 없이 user_id만으로 기존 동일 계정 갱신 (onConflict 기본/user_id 모두 보존)
  const sameAccountUpsert = await client.from('profiles').upsert({
    user_id: 'uid_alice',
    cash: 3_333,
  });
  assert.equal(sameAccountUpsert.error, null);
  assert.equal(db.profiles.get('pk_alice')?.cash, 3_333);
  assert.equal(db.profiles.size, 2, 'Same-account upsert must update existing row in place');

  // 다른 id와 기존 user_id를 함께 넘긴 충돌 upsert 거절
  const diffIdSameUserUpsert = await client.from('profiles').upsert({
    id: 'pk_other_for_alice',
    user_id: 'uid_alice',
    cash: 4_444,
  });
  assert.ok(diffIdSameUserUpsert.error, 'Upsert with new id for existing user_id must fail');
  assert.equal(db.profiles.has('pk_other_for_alice'), false);
  assert.equal(db.profiles.get('pk_alice')?.cash, 3_333);

  // 배치 도중 실패 시 부분 반영 0건
  const batchUpsertFail = await client.from('profiles').upsert([
    {
      id: 'pk_batch_upsert_ok',
      user_id: 'uid_batch_upsert_ok',
      cash: 12_345,
      net_worth: 12_345,
      username: 'Ok',
      nickname: 'Ok',
      rank_tier: 'Bronze',
    },
    {
      id: 'legacy_no_uid',
      user_id: 'attacker_uid',
      cash: 888_888,
    },
  ]);
  assert.ok(batchUpsertFail.error, 'Batch upsert must fail on second item conflict');
  assert.equal(db.profiles.has('pk_batch_upsert_ok'), false, 'Failed batch upsert must NOT partially commit first item');
  assert.equal(db.profileUserIdIndex.has('uid_batch_upsert_ok'), false);
  assert.equal(db.profiles.get('legacy_no_uid')?.cash, 2_500);

  // 3. 직접 호출부(InMemoryParticipantRepository.updateProfile, MemoryQueryBuilder.update) 불변식 검증
  const bundle = createInMemoryRepositoryBundle(db);
  await assert.rejects(
    bundle.participants.updateProfile('uid_alice', { id: 'forged_pk' }),
    /primary key conflict/i
  );
  await assert.rejects(
    bundle.participants.updateProfile('uid_alice', { user_id: 'uid_bob' }),
    /ownership conflict/i
  );
  const badDirectUpdate = await client.from('profiles').update({ user_id: 'legacy_no_uid' }).eq('id', 'pk_alice');
  assert.ok(badDirectUpdate.error, 'Direct query update must reject duplicate user_id');
  assert.equal(db.profiles.get('pk_alice')?.user_id, 'uid_alice');

  // 4. 최초 프로필 생성 시 잠금 키 전환(userId -> 독립 PK) 동시성 보호 검증
  await ensureLocalStandaloneReady();
  getLocalStandaloneEngine()?.stop();
  const origSave = persistenceManager.saveSnapshot.bind(persistenceManager);
  try {
    memoryDb.resetToSeedData({ suppressPublish: true });
    memoryDb.profiles.clear();
    memoryDb.profileUserIdIndex.clear();

    const newAuthUid = 'f04_colliding_new_uid';
    const existingOwnerUid = 'f04_existing_pk_owner';
    // newAuthUid와 동일한 PK를 타인이 이미 점유 중 -> 최초 생성 시 독립 PK(prof_...)로 전환됨
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
    memoryDb.rebuildIndexes();

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
      username: 'NewUser',
      nickname: 'NewUser',
    });
    await createPersistEntered;

    // 생성 persist 대기 중, 두 경로가 동시에 접근:
    // - pre-creation 키(newAuthUid)를 잡으려던 호출자(creation 전 resolveAccountLockKey 기준)
    // - post-creation 키(prof_...)를 잡는 호출자(creation 중/후 resolveAccountLockKey 기준)
    // 두 호출자는 생성 완료 후 모두 동일한 canonical PK 락 위에서 직렬화되어야 함
    const createdMid = memoryDb.resolveProfileByUserId(newAuthUid);
    assert.ok(createdMid && createdMid.id !== newAuthUid, 'Independent PK must be allocated during creation');

    const lockTrace: string[] = [];
    // creation 이전에 newAuthUid를 초기 키로 얻은 상태를 시뮬레이션하되 withResolvedAccountLocks로 전환 검증
    let usedPreKeyOnce = false;
    const preKeyCaller = withResolvedAccountLocks(
      () => {
        if (!usedPreKeyOnce) {
          usedPreKeyOnce = true;
          return [newAuthUid];
        }
        return [memoryDb.resolveAccountLockKey(newAuthUid)];
      },
      async () => {
        lockTrace.push('preKey_enter');
        await new Promise((r) => setTimeout(r, 20));
        lockTrace.push('preKey_exit');
      }
    );

    const postKeyCaller = withResolvedAccountLocks(
      () => [memoryDb.resolveAccountLockKey(newAuthUid)],
      async () => {
        lockTrace.push('postKey_enter');
        lockTrace.push('postKey_exit');
      }
    );

    await new Promise((r) => setTimeout(r, 15));
    assert.deepEqual(lockTrace, [], 'Both pre-creation and post-creation callers must wait while creation holds [userId, candidatePk]');

    releaseCreatePersist();
    await Promise.all([createPromise, preKeyCaller, postKeyCaller]);

    // 두 호출자는 절대 중첩되지 않고 순차 실행되어야 함
    assert.equal(lockTrace.length, 4);
    assert.ok(
      (lockTrace[0] === 'preKey_enter' && lockTrace[1] === 'preKey_exit' && lockTrace[2] === 'postKey_enter' && lockTrace[3] === 'postKey_exit') ||
      (lockTrace[0] === 'postKey_enter' && lockTrace[1] === 'postKey_exit' && lockTrace[2] === 'preKey_enter' && lockTrace[3] === 'preKey_exit'),
      `Callers must serialize cleanly across lock key transition, got: ${JSON.stringify(lockTrace)}`
    );
  } finally {
    persistenceManager.saveSnapshot = origSave;
  }

  console.log('  ✓ F-04 통과');
}

async function main() {
  try {
    await testF01_TriggerRandomEventsCanonicalOwner();
    await testF02_ProfilesSelectPolicyAndFilterValidation();
    await testF03_ProfilesUpdateRollbackAndConcurrency();
    await testF04_ProfilesInsertUpsertInvariantsAndLockTransition();
    console.log('\n🎉 4차 리뷰 후속 결함 F-01~F-04 모든 회귀 테스트 통과!');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ 4차 리뷰 회귀 테스트 실패:', err);
    process.exit(1);
  } finally {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
}

main();
