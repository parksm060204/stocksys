/**
 * scripts/test-topbar-cash-runtime.tsx
 *
 * TopBar cash 런타임 크래시 회귀 테스트 (JSDOM + 실제 React 렌더링 + 격리 local-db owner 보호 확인).
 * - 실제 .data/ 대신 mock fetch 및 임시 STOCKSYS_DATA_DIR만 사용합니다.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const tmpDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-topbar-test-'));
process.env.STOCKSYS_DATA_DIR = tmpDataDir;

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
  url: 'http://localhost:3000',
  pretendToBeVisual: true,
});

Object.defineProperty(globalThis, 'window', { value: dom.window, configurable: true, writable: true });
Object.defineProperty(globalThis, 'document', { value: dom.window.document, configurable: true, writable: true });
Object.defineProperty(globalThis, 'HTMLElement', { value: dom.window.HTMLElement, configurable: true, writable: true });
Object.defineProperty(globalThis, 'Node', { value: dom.window.Node, configurable: true, writable: true });
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SessionContext } from 'next-auth/react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import TopBar, { parseValidCash } from '../app/components/TopBar';
import { setBrowserClient } from '../lib/db/client';
import { GUEST_USER_ID, memoryDb } from '../lib/memoryDb/memoryStore';

function createDeferred<T>() {
  let resolve!: (val: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeMockRouter() {
  return {
    back: () => {},
    forward: () => {},
    refresh: () => {},
    push: () => {},
    prefetch: async () => {},
    replace: () => {},
  };
}

type SessionState = {
  data: any;
  status: 'authenticated' | 'unauthenticated' | 'loading';
};

function renderTopBar(root: ReturnType<typeof createRoot>, sessionState: SessionState) {
  return act(async () => {
    root.render(
      <AppRouterContext.Provider value={makeMockRouter() as any}>
        <SessionContext.Provider
          value={{
            ...sessionState,
            update: async () => null,
          } as any}
        >
          <TopBar />
        </SessionContext.Provider>
      </AppRouterContext.Provider>
    );
  });
}

async function flushMicrotasks() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}

async function runTests() {
  console.log('================================================================');
  console.log('  TopBar cash 런타임 안전성 & owner 보호 회귀 테스트');
  console.log('================================================================\n');

  // 1. parseValidCash 경계 입력 검증
  console.log('▶ [1] parseValidCash 입력 검증 (정상/비정상)');
  assert.equal(parseValidCash(0), 0);
  assert.equal(Object.is(parseValidCash(-0), 0), true);
  assert.equal(parseValidCash(5432100), 5432100);
  assert.equal(parseValidCash(1234.56), 1234.56);

  for (const invalid of [
    undefined,
    null,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    [],
    [1000],
    {},
    { cash: 1000 },
    '',
    '   ',
    '0',
    '5000',
    'NaN',
    'abc',
    true,
    false,
  ]) {
    assert.equal(parseValidCash(invalid), null, `Expected null for ${String(invalid)}`);
  }
  console.log('  ✓ parseValidCash 정상/비정상 입력 검증 통과');

  // 2. 실제 TopBar 마운트 + mock fetch 기반 시나리오 검증
  const originalFetch = globalThis.fetch;
  const originalDisableGuest = process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
  setBrowserClient(null);

  let profileHandler: (targetId: string | undefined) => Promise<Response> = async () =>
    new Response(JSON.stringify({ data: null, error: null }), { status: 200 });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    if (url === '/api/local-db' && init?.body) {
      const parsed = JSON.parse(String(init.body));
      if (parsed.tableName === 'stocks') {
        return new Response(JSON.stringify({ data: [], error: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (parsed.tableName === 'profiles') {
        const eqFilter = parsed.query?.filters?.find(
          (f: any) => (f.col === 'id' || f.col === 'user_id') && f.op === 'eq'
        );
        return await profileHandler(eqFilter?.val);
      }
    }
    return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
  }) as typeof fetch;

  const container = dom.window.document.createElement('div');
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);

  const getCashText = () => container.querySelector('[data-testid="topbar-cash"]')?.textContent ?? null;

  try {
    process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'true';

    // Scenario A: 정상 양수 잔액
    console.log('▶ [2] 정상 양수 잔액 렌더링');
    profileHandler = async (targetId) =>
      new Response(JSON.stringify({ data: { id: targetId, cash: 5432100 }, error: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    await renderTopBar(root, {
      status: 'authenticated',
      data: { user: { id: 'user-a', name: 'User A', email: 'a@test.local' } },
    });
    await flushMicrotasks();
    assert.equal(getCashText(), `₩${(5432100).toLocaleString()}`);
    console.log('  ✓ 양수 잔액 ₩5,432,100 표시 확인');

    // Scenario B: 정상 잔액 0원
    console.log('▶ [3] 정상 잔액 0원 렌더링');
    profileHandler = async (targetId) =>
      new Response(JSON.stringify({ data: { id: targetId, cash: 0 }, error: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });

    await renderTopBar(root, {
      status: 'authenticated',
      data: { user: { id: 'user-zero', name: 'User Zero', email: 'z@test.local' } },
    });
    await flushMicrotasks();
    assert.equal(getCashText(), '₩0');
    console.log('  ✓ 잔액 0원 ₩0 정상 표시 확인');

    // Scenario C: cash 누락 응답(safeData)으로 재렌더 시 크래시 없이 미표시 + 이전 잔액 제거
    console.log('▶ [4] cash 누락(safeData) 재렌더 크래시 방어 및 이전 잔액 정리');
    await renderTopBar(root, {
      status: 'authenticated',
      data: { user: { id: 'user-a', name: 'User A', email: 'a@test.local' } },
    });
    profileHandler = async (targetId) =>
      new Response(
        JSON.stringify({
          data: { id: targetId, user_id: targetId, username: 'safe_user', nickname: 'Safe', rank_tier: 'Bronze' },
          error: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    await flushMicrotasks();

    await renderTopBar(root, {
      status: 'authenticated',
      data: { user: { id: 'user-safe', name: 'User Safe', email: 'safe@test.local' } },
    });
    await flushMicrotasks();
    assert.equal(getCashText(), null, 'cash 누락 시 잔액 배지가 표시되지 않아야 함');
    assert.equal(container.textContent?.includes('NaN'), false);
    assert.equal(container.textContent?.includes('undefined'), false);
    console.log('  ✓ cash 누락(safeData) 시 크래시/NaN/0원 오표시/이전 잔액 잔존 없음 확인');

    // Scenario D: 비정상 cash 값들 (null, 문자열, 배열, 객체) 재렌더
    console.log('▶ [5] 비정상 cash 응답(null/문자열/배열/객체) 재렌더 방어');
    const badPayloads: unknown[] = [null, 'NaN', 'abc', '5000', '', [], [100], {}, { amount: 100 }, true];
    for (let i = 0; i < badPayloads.length; i++) {
      const badCash = badPayloads[i];
      profileHandler = async (targetId) =>
        new Response(JSON.stringify({ data: { id: targetId, cash: badCash }, error: null }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      await renderTopBar(root, {
        status: 'authenticated',
        data: { user: { id: `user-bad-${i}`, name: `Bad ${i}`, email: `bad${i}@test.local` } },
      });
      await flushMicrotasks();
      assert.equal(getCashText(), null, `비정상 cash(${JSON.stringify(badCash)})는 표시되면 안 됨`);
    }
    console.log('  ✓ 비정상 cash 응답 10종 모두 안전 차단');

    // Scenario E: HTTP 500 및 fetch reject 시 크래시 방어 & 이전 잔액 제거
    console.log('▶ [6] 조회 실패(HTTP 500 및 네트워크 reject) 방어');
    profileHandler = async (targetId) =>
      new Response(JSON.stringify({ data: { id: targetId, cash: 123456 }, error: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    await renderTopBar(root, {
      status: 'authenticated',
      data: { user: { id: 'user-rich', name: 'Rich', email: 'rich@test.local' } },
    });
    await flushMicrotasks();
    assert.equal(getCashText(), `₩${(123456).toLocaleString()}`);

    profileHandler = async () =>
      new Response(JSON.stringify({ data: null, error: { message: 'DB failure' } }), { status: 500 });
    await renderTopBar(root, {
      status: 'authenticated',
      data: { user: { id: 'user-500', name: 'Err500', email: '500@test.local' } },
    });
    await flushMicrotasks();
    assert.equal(getCashText(), null, 'HTTP 500 시 이전 유저 잔액이 남지 않아야 함');

    profileHandler = async () => {
      throw new Error('Network down');
    };
    await renderTopBar(root, {
      status: 'authenticated',
      data: { user: { id: 'user-net-err', name: 'NetErr', email: 'net@test.local' } },
    });
    await flushMicrotasks();
    assert.equal(getCashText(), null, '네트워크 예외 시 크래시 없이 미표시되어야 함');
    console.log('  ✓ HTTP 500 및 네트워크 예외 시 이전 잔액 정리·크래시 방어 확인');

    // Scenario F: 계정 변경 경합 & 지연된 stale 응답 무시
    console.log('▶ [7] 계정 전환 시 지연된 stale 응답 무시 & 즉시 초기화');
    const slowDeferred = createDeferred<Response>();
    const fastDeferred = createDeferred<Response>();

    profileHandler = async (targetId) => {
      if (targetId === 'user-slow') return await slowDeferred.promise;
      if (targetId === 'user-fast') return await fastDeferred.promise;
      return new Response(JSON.stringify({ data: null, error: null }), { status: 200 });
    };

    await renderTopBar(root, {
      status: 'authenticated',
      data: { user: { id: 'user-slow', name: 'Slow User', email: 'slow@test.local' } },
    });

    // user-slow가 아직 응답하기 전에 user-fast로 전환
    await renderTopBar(root, {
      status: 'authenticated',
      data: { user: { id: 'user-fast', name: 'Fast User', email: 'fast@test.local' } },
    });
    assert.equal(getCashText(), null, '전환 직후 pending 상태에서는 cash가 null이어야 함');

    fastDeferred.resolve(
      new Response(JSON.stringify({ data: { id: 'user-fast', cash: 777000 }, error: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await flushMicrotasks();
    assert.equal(getCashText(), `₩${(777000).toLocaleString()}`);

    // 뒤늦게 도착한 user-slow의 응답은 무시되어야 함
    slowDeferred.resolve(
      new Response(JSON.stringify({ data: { id: 'user-slow', cash: 999999999 }, error: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await flushMicrotasks();
    assert.equal(getCashText(), `₩${(777000).toLocaleString()}`, '지연 도착한 이전 계정 응답이 덮어쓰면 안 됨');
    console.log('  ✓ 계정 전환 시 stale 응답 무시 확인');

    // Scenario G: 로그아웃 시 잔액 정리 및 지연 응답 무시
    console.log('▶ [8] 로그아웃 시 잔액 정리 및 이후 지연 응답 무시');
    const logoutRaceDeferred = createDeferred<Response>();
    profileHandler = async () => await logoutRaceDeferred.promise;

    await renderTopBar(root, {
      status: 'authenticated',
      data: { user: { id: 'user-logout-race', name: 'Logout Race', email: 'lr@test.local' } },
    });

    await renderTopBar(root, {
      status: 'unauthenticated',
      data: null,
    });
    assert.equal(getCashText(), null);

    logoutRaceDeferred.resolve(
      new Response(JSON.stringify({ data: { id: 'user-logout-race', cash: 888000 }, error: null }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    await flushMicrotasks();
    assert.equal(getCashText(), null, '로그아웃 후 도착한 응답도 무시되어야 함');
    assert.ok(container.textContent?.includes('Google 로그인'));
    console.log('  ✓ 로그아웃 시 즉시 정리 및 stale 응답 무시 확인');

    // Scenario H: 개발 게스트 흐름
    console.log('▶ [9] 개발 게스트 조회 흐름');
    process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'false';
    profileHandler = async (targetId) =>
      new Response(
        JSON.stringify({
          data: targetId === GUEST_USER_ID ? { id: GUEST_USER_ID, cash: 100000000 } : null,
          error: null,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    await renderTopBar(root, {
      status: 'unauthenticated',
      data: null,
    });
    await flushMicrotasks();
    assert.equal(getCashText(), `₩${(100000000).toLocaleString()}`);
    console.log('  ✓ 개발 게스트 잔액 조회/렌더링 확인');
  } finally {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    globalThis.fetch = originalFetch;
    if (originalDisableGuest === undefined) {
      delete process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH;
    } else {
      process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = originalDisableGuest;
    }
  }

  // 3. 실제 app/api/local-db/route.ts의 profiles owner 보호 및 본인 cash 반환 확인 (임시 STOCKSYS_DATA_DIR)
  console.log('▶ [10] local-db profiles SELECT owner 보호 및 본인 cash 반환 확인');
  {
    const { POST } = await import('../app/api/local-db/route');
    const { ensureLocalStandaloneReady, stopLocalStandaloneEngine } = await import('../lib/engine/localStandaloneServer');
    const { persistenceManager } = await import('../lib/memoryDb/PersistenceManager');

    await ensureLocalStandaloneReady();
    try {
      process.env.NEXT_PUBLIC_DISABLE_GUEST_AUTH = 'false';
      const guest = memoryDb.ensureUserProfile(GUEST_USER_ID);
      guest.cash = 42_500_000;
      guest.unlocked_features = ['fee_booster'];
      guest.feature_expiries = { fee_booster: new Date(Date.now() - 60_000).toISOString() };
      memoryDb.profiles.set('other-user-id', {
        id: 'other-user-id',
        user_id: 'other-user-id',
        username: 'other',
        nickname: '타인',
        cash: 987654321,
        net_worth: 987654321,
        rank_tier: 'Gold',
        created_at: memoryDb.getIsoTimestamp(),
      });
      memoryDb.rebuildIndexes();

      const makeReq = (targetId: string) =>
        new Request('http://localhost:3000/api/local-db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'execute',
            tableName: 'profiles',
            query: {
              action: 'select',
              filters: [{ col: 'id', op: 'eq', val: targetId }],
              isMaybeSingle: true,
            },
          }),
        });

      const nonOwnerRes = await POST(makeReq('other-user-id'));
      const nonOwnerJson = await nonOwnerRes.json();
      assert.equal(nonOwnerRes.status, 200);
      assert.equal(nonOwnerJson.data?.id, 'other-user-id');
      assert.equal('cash' in (nonOwnerJson.data || {}), false, '타인 프로필 조회에는 cash가 포함되면 안 됨');

      const ownerRes = await POST(makeReq(GUEST_USER_ID));
      const ownerJson = await ownerRes.json();
      assert.equal(ownerRes.status, 200);
      assert.equal(ownerJson.data?.id, GUEST_USER_ID);
      assert.equal(ownerJson.data?.cash, 42_500_000, '본인 프로필 조회에는 숫자 cash가 포함되어야 함');
      assert.deepEqual(ownerJson.data?.unlocked_features, [], '복제본 기준 만료 권한 정리가 반영되어야 함');
      assert.deepEqual(guest.unlocked_features, ['fee_booster'], 'SELECT 경로에서 원본 상태는 무잠금 변이되지 않아야 함');
      console.log('  ✓ local-db profiles SELECT owner 보호 및 본인 cash 반환 확인');
    } finally {
      await stopLocalStandaloneEngine();
      persistenceManager.stopAutoSave();
    }
  }

  fs.rmSync(tmpDataDir, { recursive: true, force: true });
  console.log('\n✅ ALL TOPBAR CASH RUNTIME TESTS PASSED');
}

runTests().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  try {
    fs.rmSync(tmpDataDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
  process.exit(1);
});
