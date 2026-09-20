/**
 * scripts/test-regime-activation-modes.ts
 *
 * STOCKSYS 시장 국면 운용 모드 최종 안전성 보완 검증 스위트
 *
 * 1단계: Capability 보안 경계 및 reset 감사 이력
 * 2단계: 동일 스냅샷 기반 SHADOW 및 런타임 불변식 진단
 * 3단계: 실제 가격 이력 조회 및 채권 fallback 결정론
 */

import * as fs from 'fs';
import * as path from 'path';
import { memoryDb, OrderRecord, HoldingRecord, TradeRecord } from '../lib/memoryDb/memoryStore';
import { AgentManager } from '../lib/engine/simulation/agentManager';
import { createHeadlessSimulationRunner } from '../lib/engine/localStandaloneServer';
import {
  ServerRegimeAuthorizationProvider,
  OperationalRegimeCapabilityVerifier,
  isValidRegimeExperimentCapability,
  RegimeExperimentCapability,
  MAX_CAPABILITY_TTL_MS,
  ALLOWED_CLOCK_SKEW_MS,
} from '../lib/engine/simulation/regime/regimeAuth';
import * as regimeBarrel from '../lib/engine/simulation/regime';
import {
  createUnauthenticatedTestCapability,
  createExpiredTestRegimeCapability,
  createFutureTestRegimeCapability,
  createExcessiveTtlTestRegimeCapability,
} from './test-support/testRegimeAuth';
import {
  fetchCanonicalPriceHistory,
  createDeterministicBondHistory,
  DEFAULT_BOND_FALLBACK_EPOCH_MS,
} from '../lib/services/priceHistoryService';

const START_EPOCH_MS = 1773500000000;

function assert(condition: boolean, message: string): void {
  if (!condition) {
    console.error(`\n❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`  ✓ ${message}`);
}

function checkInvariants(stepName: string): void {
  for (const p of memoryDb.profiles.values()) {
    if (!Number.isFinite(p.cash) || p.cash < 0) {
      throw new Error(`[${stepName}] 계좌 cash 비정상: ${p.id}=${p.cash}`);
    }
  }
  for (const h of memoryDb.holdings.values()) {
    if (!Number.isFinite(h.quantity) || h.quantity < 0) {
      throw new Error(`[${stepName}] 보유 quantity 비정상: user=${h.user_id}, qty=${h.quantity}`);
    }
  }
  for (const t of memoryDb.trades) {
    if (!Number.isFinite(t.price) || t.price <= 0 || !Number.isFinite(t.size) || t.size <= 0) {
      throw new Error(`[${stepName}] 체결 비정상 가격/수량: ${t.id}`);
    }
    if (t.buyer_id && t.seller_id && t.buyer_id === t.seller_id) {
      throw new Error(`[${stepName}] 자가 체결 발생: ${t.id}`);
    }
  }
  for (const o of memoryDb.orders.values()) {
    if (!Number.isFinite(o.price) || o.price <= 0 || !Number.isFinite(o.size) || o.size <= 0) {
      throw new Error(`[${stepName}] 주문 비정상 가격/수량: ${o.id}`);
    }
    if (o.filled < 0 || o.filled > o.size) {
      throw new Error(`[${stepName}] 주문 체결량 범위 오류: ${o.id}`);
    }
  }
}

function getFingerprint(mgr: AgentManager): string {
  const orders = Array.from(memoryDb.orders.values())
    .map((o) => `${o.stock_id}:${o.side}:${o.price}:${o.size}:${o.filled}:${o.status}`)
    .sort()
    .join('|');
  const trades = memoryDb.trades
    .map((t) => `${t.stock_id}:${t.price}:${t.size}:${t.buyer_id}:${t.seller_id}`)
    .sort()
    .join('|');
  const profiles = Array.from(memoryDb.profiles.values())
    .map((p) => `${p.id}:${p.cash}`)
    .sort()
    .join('|');
  const holdings = Array.from(memoryDb.holdings.values())
    .map((h) => `${h.user_id}:${h.stock_id}:${h.quantity}:${h.avg_price}`)
    .sort()
    .join('|');
  const botPrng = Array.from(mgr.agentPrngs.entries())
    .map(([k, p]) => `${k}:${p.getState()}`)
    .sort()
    .join('|');
  const fundPrng = mgr.fundamentalPrng.getState();

  return `ORDERS[${orders}]__TRADES[${trades}]__PROFILES[${profiles}]__HOLDINGS[${holdings}]__PRNG[${botPrng}#${fundPrng}]`;
}

function issueRealCapability(
  authKey: string = 'test-authorized-valid-token-key-32chars',
  reason?: string
): RegimeExperimentCapability {
  const previousKey = process.env.REGIME_EXPERIMENT_AUTH_KEY;
  try {
    process.env.REGIME_EXPERIMENT_AUTH_KEY = authKey;
    const provider = new ServerRegimeAuthorizationProvider();
    const result = provider.issueCapability({ secretKey: authKey, reason });
    if (!result.success || !result.capability) {
      throw new Error(`[test] Failed to issue real capability: ${result.error}`);
    }
    return result.capability;
  } finally {
    if (previousKey === undefined) {
      delete process.env.REGIME_EXPERIMENT_AUTH_KEY;
    } else {
      process.env.REGIME_EXPERIMENT_AUTH_KEY = previousKey;
    }
  }
}

async function runAllTests(): Promise<void> {
  console.log('================================================================');
  console.log('  STOCKSYS 시장 국면 운용 모드 최종 안전성 보완 검증 스위트');
  console.log('================================================================\n');

  // ═════════════════════════════════════════════════════════════════
  // 1단계: Capability 보안 경계 및 reset 감사 이력
  // ═════════════════════════════════════════════════════════════════
  console.log('▶ [1단계] Capability 보안 경계 및 reset 감사 이력 검증');

  // 1.1 운영 배럴 및 운영 모듈에서 테스트 발급 기능 완전 미노출 검증
  assert(
    !('TestRegimeAuthorizationProvider' in regimeBarrel),
    '1.1-A TestRegimeAuthorizationProvider 운영 배럴(regime/index.ts) 미노출 확인'
  );
  assert(
    !('createTestRegimeCapability' in regimeBarrel),
    '1.1-B createTestRegimeCapability 운영 배럴(regime/index.ts) 미노출 확인'
  );
  assert(
    !('createTestCapabilityForVerifier' in regimeBarrel),
    '1.1-C createTestCapabilityForVerifier 운영 배럴(regime/index.ts) 미노출 확인'
  );
  assert(
    !('_createRegimeCapabilityRaw' in regimeBarrel),
    '1.1-D _createRegimeCapabilityRaw 운영 배럴(regime/index.ts) 미노출 확인'
  );

  // 1.2 운영 코드(lib/, app/)에서 test-support import 없음 정적 검사
  {
    const rootDir = path.resolve(__dirname, '..');
    const checkDirs = ['lib', 'app'];
    let violationCount = 0;

    function scanDir(dirPath: string) {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      for (const ent of entries) {
        const full = path.join(dirPath, ent.name);
        if (ent.isDirectory()) {
          scanDir(full);
        } else if (ent.isFile() && (ent.name.endsWith('.ts') || ent.name.endsWith('.tsx'))) {
          const content = fs.readFileSync(full, 'utf8');
          const importMatches = content.match(/import\s+.*?['"].*?(test-support|testRegimeAuth|TestRegimeCapabilityVerifier).*?['"]/g);
          if (importMatches) {
            console.error(`[보안 위반] 운영 코드에서 테스트 지원 모듈 import 발견: ${full}`);
            violationCount++;
          }
        }
      }
    }

    for (const d of checkDirs) {
      scanDir(path.join(rootDir, d));
    }
    assert(violationCount === 0, '1.2 운영 코드(lib/, app/)에서 test-support 모듈 import 없음 확인');
  }

  // 1.3 공개 주입 경로 차단 및 안전 옵션 타입 검증
  {
    // @ts-expect-error capabilityVerifier should not exist on AgentManagerOptions
    const _typeTestMgr = new AgentManager(42, START_EPOCH_MS, { capabilityVerifier: {} as any });
    assert(Boolean(_typeTestMgr), '1.3-A AgentManager 생성자 옵션 타입에서 capabilityVerifier 배제 확인');

    // @ts-expect-error capabilityVerifier should not exist on HeadlessSimulationRunnerOptions
    const _typeTestRunner = createHeadlessSimulationRunner(42, START_EPOCH_MS, { capabilityVerifier: {} as any });
    assert(Boolean(_typeTestRunner), '1.3-B createHeadlessSimulationRunner 옵션 타입에서 capabilityVerifier 배제 확인');

    // 런타임에 임의 verifier를 options로 강제 주입하려 해도 내부 operational verifier로 고정됨
    const fakeVerifier = { verifyAndConsume: () => ({ success: true }) };
    const forcedMgr = new AgentManager(42, START_EPOCH_MS, { capabilityVerifier: fakeVerifier } as any);
    assert(
      (forcedMgr as any).capabilityVerifier instanceof OperationalRegimeCapabilityVerifier,
      '1.3-C 런타임에 capabilityVerifier 주입 시도해도 OperationalRegimeCapabilityVerifier 강제 유지'
    );

    // [P1 수정 검증 1] verifier 클래스 및 인스턴스에 pruneExpired, pruneExpiredConsumed, consumedCapabilities가 전혀 노출되지 않음 확인 (Module-private closure)
    const opVerifierInstance = new OperationalRegimeCapabilityVerifier();
    assert(
      typeof (opVerifierInstance as any).pruneExpiredConsumed === 'undefined',
      '1.3-D1 인스턴스 pruneExpiredConsumed 공개 메서드 부재 확인'
    );
    assert(
      typeof (OperationalRegimeCapabilityVerifier as any).pruneExpired === 'undefined',
      '1.3-D2 클래스 pruneExpired 정적 메서드 부재 확인 (런타임 private 은닉)'
    );
    assert(
      typeof (OperationalRegimeCapabilityVerifier as any).consumedCapabilities === 'undefined',
      '1.3-D3 클래스 consumedCapabilities 정적 저장소 부재 확인 (모듈 비공개 영역 은닉)'
    );

    // [P1 수정 검증 2] 런타임 리플렉션 및 nowMs: MAX_SAFE_INTEGER 주입을 통한 process-wide 저장소 삭제 공격 원천 차단
    {
      const capAttack = issueRealCapability();
      const mgrAttack = new AgentManager(42, START_EPOCH_MS);
      const resInit = mgrAttack.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: capAttack });
      assert(resInit.success === true, '1.3-E 정상 capability 1차 소비 성공');
      mgrAttack.reset(42);

      // 공격 1: 런타임 리플렉션을 통한 정적 메서드 호출 / 맵 clear 시도
      try {
        (OperationalRegimeCapabilityVerifier as any).pruneExpired?.(Number.MAX_SAFE_INTEGER);
        (OperationalRegimeCapabilityVerifier as any).consumedCapabilities?.clear();
      } catch {}

      // 공격 2: nowMs: MAX_SAFE_INTEGER를 주입하여 기존 소비 기록을 prune 시도
      const resExploit = mgrAttack.setRegimeEffectsMode('EXPERIMENTAL_ON', {
        capability: createUnauthenticatedTestCapability(),
        nowMs: Number.MAX_SAFE_INTEGER,
      } as any);
      assert(!resExploit.success, '1.3-F 위조 capability 및 MAX_SAFE_INTEGER 주입 거절');

      // 기존 소비된 capAttack을 재사용 시도 -> 저장소가 비워지지 않고 보존되어 ALREADY_CONSUMED 거절되어야 함
      const resReplay = mgrAttack.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: capAttack });
      assert(
        !resReplay.success && resReplay.errorCode === 'ALREADY_CONSUMED',
        '1.3-G 런타임 리플렉션 및 nowMs 주입 공격 후에도 기존 소비 기록이 보존되어 ALREADY_CONSUMED 거절 (P1 공격 차단 성공)'
      );
    }

    // NODE_ENV 무관 fail-closed 검증 (staging, dev, preview, test, production, undefined)
    const envsToTest = ['development', 'staging', 'test', undefined, 'production'];
    for (const env of envsToTest) {
      const prevEnv = process.env.NODE_ENV;
      const envRecord = process.env as Record<string, string | undefined>;
      try {
        if (env === undefined) delete envRecord.NODE_ENV;
        else envRecord.NODE_ENV = env;
        const testEnvMgr = new AgentManager(42, START_EPOCH_MS);
        const unauthCap = createUnauthenticatedTestCapability();
        const res = testEnvMgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: unauthCap });
        assert(!res.success, `1.3-H NODE_ENV=${env} 에서 비인가 capability 거절 확인 (fail-open 없음)`);
      } finally {
        if (prevEnv === undefined) delete envRecord.NODE_ENV;
        else envRecord.NODE_ENV = prevEnv;
      }
    }
  }

  // 1.4 정상 발급 경로 및 환경변수 격리 (Fail-closed & 최소 키 길이 32자 검증)
  {
    const oldKey = process.env.REGIME_EXPERIMENT_AUTH_KEY;
    try {
      // 1. 환경변수 미설정 시 거절
      delete process.env.REGIME_EXPERIMENT_AUTH_KEY;
      const providerUnset = new ServerRegimeAuthorizationProvider();
      assert(!providerUnset.issueCapability({ secretKey: 'any' }).success, '1.4-A 환경변수 미설정 시 발급 거절');
      assert(!providerUnset.issueCapability({ secretKey: 'STOCKSYS_REGIME_ADMIN' }).success, '1.4-B 과거 기본키 거절');
      assert(!providerUnset.issueCapability({ secretKey: 'TEST_PERMITTED' }).success, '1.4-C 과거 테스트키 거절');

      // 2. [P2 수정 검증] 환경변수와 일치하지만 32자 미만(8~31자)인 키 거절 정책 검증
      process.env.REGIME_EXPERIMENT_AUTH_KEY = 'short-secret-key-only-26char';
      const shortKeyProvider = new ServerRegimeAuthorizationProvider();
      const shortRes = shortKeyProvider.issueCapability({ secretKey: 'short-secret-key-only-26char' });
      assert(
        !shortRes.success && Boolean(shortRes.error && shortRes.error.includes('32자')),
        '1.4-D 환경변수와 비밀키가 동일하더라도 32자 미만(26자) 키 거절 확인 (P2 정책 준수)'
      );

      // 3. 32자 이상 올바른 키 설정 시 정상 발급
      const valid32Key = 'production-grade-auth-key-for-test-39824';
      process.env.REGIME_EXPERIMENT_AUTH_KEY = valid32Key;
      const validProvider = new ServerRegimeAuthorizationProvider();
      const validRes = validProvider.issueCapability({ secretKey: valid32Key });
      assert(validRes.success === true, '1.4-E 32자 이상 올바른 비밀키 시 정상 발급 성공');
    } finally {
      if (oldKey === undefined) {
        delete process.env.REGIME_EXPERIMENT_AUTH_KEY;
      } else {
        process.env.REGIME_EXPERIMENT_AUTH_KEY = oldKey;
      }
    }
    assert(process.env.REGIME_EXPERIMENT_AUTH_KEY === oldKey, '1.4-F 환경변수 try/finally 완벽 복원 확인');
  }

  // 1.5 올바른 인증 키 capability 운영 verifier 통과 및 가짜/만료/위조 객체 거절
  {
    const authKey = 'production-grade-auth-key-for-test-39824';
    const validCap = issueRealCapability(authKey);
    const operationalVerifier = new OperationalRegimeCapabilityVerifier();
    const opNow = Date.now();

    // 순수 시간 검증 함수 isValidRegimeExperimentCapability를 통한 경계 조건 검증
    assert(isValidRegimeExperimentCapability(validCap, opNow), '1.5-A 올바른 키로 발급된 capability 유효');
    assert(isValidRegimeExperimentCapability(validCap, validCap.expiresAt - 1), '1.5-B 만료 1ms 직전까지 유효');
    assert(!isValidRegimeExperimentCapability(validCap, validCap.expiresAt), '1.5-C 만료 시각(nowMs >= expiresAt) 즉시 거절');
    assert(!isValidRegimeExperimentCapability(validCap, validCap.expiresAt + 1000), '1.5-D 만료 이후 거절');

    // 운영 verifier는 내부 wall-clock을 읽어 검증 (외부 nowMs 전달 불필요)
    const opVerifyResult = operationalVerifier.verifyAndConsume(validCap);
    assert(opVerifyResult.success, '1.5-E 올바른 인증 키를 통한 Capability만 운영 verifier 통과');

    // 테스트/가짜 capability는 운영 verifier에서 엄격히 거절됨 (운영 Symbol 부재)
    const fakeCap = createUnauthenticatedTestCapability(60000, opNow);
    assert(!isValidRegimeExperimentCapability(fakeCap, opNow), '1.5-F 테스트 가짜 객체 isValidRegimeExperimentCapability 거절');
    const fakeAgainstOp = operationalVerifier.verifyAndConsume(fakeCap);
    assert(!fakeAgainstOp.success, '1.5-G 테스트 가짜 객체 운영 verifier 거절');

    // 미래 발급 (클록 스큐 초과)
    const futureCap = createFutureTestRegimeCapability(ALLOWED_CLOCK_SKEW_MS + 1000, opNow);
    assert(!isValidRegimeExperimentCapability(futureCap, opNow), '1.5-H 미래 발급(허용 클록 스큐 초과) 거절');

    // 최대 TTL 초과
    const excessiveTtlCap = createExcessiveTtlTestRegimeCapability(MAX_CAPABILITY_TTL_MS + 1000, opNow);
    assert(!isValidRegimeExperimentCapability(excessiveTtlCap, opNow), '1.5-I 최대 허용 TTL(5분) 초과 capability 거절');

    // 비정상 수치값 및 브랜드 없는 위조 객체 거절
    const forgedNoBrand = { id: 'rcap_test_fake1234567890', issuedAt: opNow, expiresAt: opNow + 60000 };
    assert(!isValidRegimeExperimentCapability(forgedNoBrand, opNow), '1.5-J 브랜드 없는 위조 객체 거절');
  }

  // 1.6 소비 시점 3대 상태 구분 및 단회용 정책 정밀 검증
  {
    memoryDb.resetToSeedData();
    const mgr = new AgentManager(42, START_EPOCH_MS);

    const cap1 = issueRealCapability();
    const cap2 = issueRealCapability();

    // [케이스 1] 신규 EXPERIMENTAL_ON 전환 예약 성공 시 정확히 1회 소비
    const res1 = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: cap1 });
    assert(res1.success === true, '1.6-A 신규 EXPERIMENTAL_ON 1차 전환 예약 성공');
    assert(mgr.getRegimeModeDiagnostics().pendingMode === 'EXPERIMENTAL_ON', '1.6-B pendingMode === EXPERIMENTAL_ON');

    // [케이스 2] 동일한 모드 전환이 이미 pending 대기 중인 경우 -> 중복 예약 no-op, capability 미소비 보존
    const resDup = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: cap2 });
    assert(resDup.success === true, '1.6-C 동일 모드 대기 중 중복 예약 성공 (no-op)');
    assert(resDup.message.includes('대기 중'), '1.6-D 대기 중 메시지 확인');

    // 스텝 진행 -> 모드가 실제로 EXPERIMENTAL_ON으로 적용됨
    await mgr.step(10);
    assert(mgr.regimeEffectsMode === 'EXPERIMENTAL_ON', '1.6-E 현재 모드 EXPERIMENTAL_ON 진입');
    assert(mgr.getRegimeModeDiagnostics().pendingMode === null, '1.6-F pendingMode 해제 (null)');

    // [케이스 3] 현재 모드와 요청 모드가 같고 pending이 없는 경우 -> no-op 응답, capability 미소비 보존
    const resNoop = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: cap2 });
    assert(resNoop.success === true, '1.6-G 이미 활성 모드인 경우 no-op 응답 반환');
    assert(resNoop.message.includes('이미'), '1.6-H 이미 활성 메시지 확인');

    // [케이스 4] 현재 모드는 EXPERIMENTAL_ON이지만 pending OFF가 대기 중인 상태에서 다시 EXPERIMENTAL_ON 요청
    // -> pending OFF를 취소/덮어쓰는 실질적인 권한 상승 요청이므로 capability를 소비해야 함
    const resOff = mgr.setRegimeEffectsMode('OFF');
    assert(resOff.success === true, '1.6-I pending OFF 예약 성공');
    assert(mgr.getRegimeModeDiagnostics().pendingMode === 'OFF', '1.6-J pendingMode === OFF');

    // 이제 cap2로 EXPERIMENTAL_ON 재요청 (pending 취소 및 EXPERIMENTAL_ON 유지)
    // 앞서 케이스 2, 3에서 cap2가 미소비 상태로 잘 보존되었으므로 정상 승인 및 이번에 최초 소비됨!
    const resOverride = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: cap2 });
    assert(resOverride.success === true, '1.6-K pending OFF 취소 및 EXPERIMENTAL_ON 재예약 성공 (cap2 미소비 보존 증명)');
    assert(mgr.getRegimeModeDiagnostics().pendingMode === 'EXPERIMENTAL_ON', '1.6-L pendingMode === EXPERIMENTAL_ON 복원');

    // [케이스 5] 이미 소비된 capability 재사용 거절:
    mgr.setRegimeEffectsMode('OFF');
    const resReuse1 = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: cap1 });
    assert(resReuse1.success === false && resReuse1.errorCode === 'ALREADY_CONSUMED', '1.6-M 이미 소비된 cap1 재사용 거절 (ALREADY_CONSUMED)');

    const resReuse2 = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: cap2 });
    assert(resReuse2.success === false && resReuse2.errorCode === 'ALREADY_CONSUMED', '1.6-N 이미 소비된 cap2 재사용 거절 (ALREADY_CONSUMED)');

    // [케이스 6] 거절된 요청의 capability는 미소비
    const cap3 = issueRealCapability();
    const fakeRejected = mgr.setRegimeEffectsMode('INVALID_MODE' as any, { capability: cap3 });
    assert(fakeRejected.success === false, '1.6-O 유효하지 않은 모드 거절');

    // cap3가 미소비 상태이므로 정상적인 전환 요청에 유효하게 사용됨을 검증
    const resValidCap3 = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: cap3 });
    assert(resValidCap3.success === true, '1.6-P 거절된 요청의 cap3는 소비되지 않고 이후 정상 요청에 사용됨 증명');

    // [케이스 7] reset 후에도 소비된 capability 재사용 차단
    mgr.reset(42);
    const resReuseAfterReset = mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: cap1 });
    assert(resReuseAfterReset.success === false && resReuseAfterReset.errorCode === 'ALREADY_CONSUMED', '1.6-Q reset 후에도 과거 소비된 cap1 재사용 차단');
  }

  // 1.7 reset 시간 도메인 분리 검증 (시뮬레이션 클록 혼용 차단 & Fake Timer 검증)
  {
    // 1. 실제 기준 시각에서 capability 발급
    const wallNow = Date.now();
    const capResetDomain = issueRealCapability();

    // 2. wallNow보다 충분히 미래인 startEpochMs로 AgentManager 생성 (시뮬레이션 클록이 미래)
    const futureStartEpoch = wallNow + 100_000_000;
    const timeMgr = new AgentManager(42, futureStartEpoch);

    // 3. capability를 사용해 전환 예약
    const timeRes1 = timeMgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: capResetDomain });
    assert(timeRes1.success === true, '1.7-A 미래 시뮬레이션 클록 매니저에서 정상 예약');

    // 4. manager reset (postResetTime = futureStartEpoch가 전달되더라도 capability 소비 기록을 prune하지 않음)
    timeMgr.reset(42);

    // 5. 같은 capability 재사용 시도 -> 시뮬레이션 클록으로 만료 정리되지 않았으므로 여전히 ALREADY_CONSUMED
    const timeRes2 = timeMgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: capResetDomain });
    assert(
      timeRes2.success === false && timeRes2.errorCode === 'ALREADY_CONSUMED',
      '1.7-B reset 시 시뮬레이션 클록으로 만료 정리하지 않음 -> 소비 기록 보존 및 ALREADY_CONSUMED 거절 확인'
    );

    // 6. Fake timer를 사용하여 실제 wall clock 경과 시 만료 정리 동작 검증
    const testCleanVerifier = new OperationalRegimeCapabilityVerifier();
    const origNow = Date.now;
    try {
      Date.now = () => capResetDomain.expiresAt + 1000;
      // 만료 후 검증 시 내부 private pruneExpired가 트리거되고, 만료된 capability는 INVALID_CAPABILITY 거절
      const expVerify = testCleanVerifier.verifyAndConsume(capResetDomain);
      assert(
        expVerify.success === false && expVerify.errorCode === 'INVALID_CAPABILITY',
        '1.7-C Fake timer 경과 후 내부 만료 정리가 정상 수행되고 만료 capability 거절 확인'
      );
    } finally {
      Date.now = origNow;
    }
  }

  // 1.8 manager 간 capability 재사용 차단 및 process-wide 단회용 검증 (요구사항 3)
  {
    // 1. 하나의 정상 capability 발급
    const capShared = issueRealCapability();

    // 2. 첫 번째 AgentManager에서 소비
    const mgrA = new AgentManager(42, START_EPOCH_MS);
    const resA = mgrA.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: capShared });
    assert(resA.success === true, '1.8-A 매니저 A에서 capability 소비 성공');

    // 3. 같은 프로세스의 두 번째 AgentManager에서 동일 capability 제출
    const mgrB = new AgentManager(99, START_EPOCH_MS);
    const resB = mgrB.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: capShared });

    // 4. 반드시 ALREADY_CONSUMED로 거절
    assert(
      resB.success === false && resB.errorCode === 'ALREADY_CONSUMED',
      '1.8-B 매니저 B에서 동일 capability 제출 시 ALREADY_CONSUMED 거절 (Process-wide 차단)'
    );

    // 5. 첫 번째 manager를 reset하거나 새 manager를 생성해도 재사용 불가
    mgrA.reset(42);
    const resAReuse = mgrA.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: capShared });
    assert(
      resAReuse.success === false && resAReuse.errorCode === 'ALREADY_CONSUMED',
      '1.8-C 매니저 A reset 후에도 동일 capability 재사용 거절'
    );

    const mgrC = new AgentManager(100, START_EPOCH_MS);
    const resC = mgrC.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: capShared });
    assert(
      resC.success === false && resC.errorCode === 'ALREADY_CONSUMED',
      '1.8-D 신규 매니저 C에서도 동일 capability 재사용 거절'
    );
  }

  // 1.9 1,000건 저장소 포화 시 fail-closed 및 Fake Timer 기반 만료 복구 검증
  {
    const satVerifier = new OperationalRegimeCapabilityVerifier();
    const satNow = Date.now();
    const authKey = 'saturation-test-key-for-regime-32chars';

    // process-wide Map의 기존 항목을 고려하여 포화 한계(1,000건)까지 등록
    const satCaps: RegimeExperimentCapability[] = [];
    let lastRes: any = { success: true };
    while (lastRes.success) {
      const cap = issueRealCapability(authKey);
      satCaps.push(cap);
      lastRes = satVerifier.verifyAndConsume(cap);
    }

    // 1,000건 상한 도달 후 요청 -> fail-closed (거절)
    assert(!lastRes.success, '1.9-A 저장소 포화 시 신규 capability 거절 (Fail-closed)');
    assert(lastRes.errorCode === 'CONSUMED_STORE_SATURATED', '1.9-B errorCode === CONSUMED_STORE_SATURATED');

    // 1,001번째 이상 추가 요청도 CONSUMED_STORE_SATURATED 거절
    const capOverflow = issueRealCapability(authKey);
    const rOverflow = satVerifier.verifyAndConsume(capOverflow);
    assert(!rOverflow.success && rOverflow.errorCode === 'CONSUMED_STORE_SATURATED', '1.9-C 추가 요청 거절 확인');

    // 기존 1,000건 중 첫 번째 항목 재제출 -> 여전히 ALREADY_CONSUMED (삭제되지 않고 보존됨)
    const rCheckFirst = satVerifier.verifyAndConsume(satCaps[0]);
    assert(
      !rCheckFirst.success && rCheckFirst.errorCode === 'ALREADY_CONSUMED',
      '1.9-D 포화 상태에서도 기존 미만료 기록은 삭제되지 않고 온전히 보존됨'
    );

    // Fake timer를 통해 만료 시각(satNow + MAX_CAPABILITY_TTL_MS + 1000)으로 전진
    // -> 다음 verifyAndConsume 호출 시 내부 private pruneExpired가 만료된 1,000건을 정리하여 새 capability 발급이 다시 성공함
    const origNow = Date.now;
    try {
      Date.now = () => satNow + MAX_CAPABILITY_TTL_MS + 1000;
      const postCleanCap = issueRealCapability(authKey);
      const rPostClean = satVerifier.verifyAndConsume(postCleanCap);
      assert(rPostClean.success, '1.9-E 가상 시간 경과 후 내부 만료 정리가 수행되어 신규 capability 정상 처리 확인');
    } finally {
      Date.now = origNow;
    }
  }

  // 1.10 reset 시 감사 이력 시간 역행 방지 및 보존 검증
  {
    memoryDb.resetToSeedData();
    const mgr = new AgentManager(42, START_EPOCH_MS);

    // OFF -> SHADOW 전환
    mgr.setRegimeEffectsMode('SHADOW');
    await mgr.step(10);
    assert(mgr.regimeEffectsMode === 'SHADOW', '1.10-A SHADOW 활성화');

    // SHADOW -> EXPERIMENTAL_ON 전환
    const cap = issueRealCapability();
    mgr.setRegimeEffectsMode('EXPERIMENTAL_ON', { capability: cap });
    await mgr.step(10);
    assert(mgr.regimeEffectsMode === 'EXPERIMENTAL_ON', '1.10-B EXPERIMENTAL_ON 활성화');

    const historyBefore = mgr.getRegimeModeDiagnostics().modeChangeHistory;
    assert(historyBefore.length >= 2, '1.10-C reset 전 모드 전환 이력 2건 이상 존재');

    // Reset 실행
    mgr.reset(42);
    const diagAfterReset = mgr.getRegimeModeDiagnostics();
    const historyAfter = diagAfterReset.modeChangeHistory;

    assert(diagAfterReset.currentMode === 'OFF', '1.10-D reset 후 currentMode === OFF');
    assert(diagAfterReset.pendingMode === null, '1.10-E reset 후 pendingMode === null');
    assert(diagAfterReset.appliedRegime === null, '1.10-F reset 후 appliedRegime === null');
    assert(Object.keys(diagAfterReset.appliedMultipliers).length === 0, '1.10-G reset 후 appliedMultipliers 빈 객체');

    // 감사 이력이 덮어쓰이지 않고 append 되었는지 검증
    assert(historyAfter.length === historyBefore.length + 1, '1.10-H reset 감사 기록이 기존 이력에 append 됨 (보존)');
    const lastRec = historyAfter[historyAfter.length - 1];
    assert(lastRec.toMode === 'OFF' && lastRec.fromMode === 'EXPERIMENTAL_ON', '1.10-I reset 이벤트 모드 정확');
    assert(lastRec.reason === 'simulation_reset_fail_safe', '1.10-J reset 이벤트 사유 정확');
    assert(lastRec.eventType === 'RESET_FAIL_SAFE', '1.10-K 비-OFF 상태 reset은 RESET_FAIL_SAFE로 기록');
    // 시간 역행 방지 검증: reset 감사 이벤트 timestamp는 reset 이전 시뮬레이션 시각이어야 함
    assert(lastRec.timestamp >= historyBefore[historyBefore.length - 1].timestamp, '1.10-L 감사 이력 시간 역행 없음 (preResetTime 보존)');

    // 이미 OFF 상태에서 reset 재실행 -> 허위 모드 전환 없이 eventType: 'RESET'
    mgr.reset(42);
    const historyAfter2 = mgr.getRegimeModeDiagnostics().modeChangeHistory;
    const lastRec2 = historyAfter2[historyAfter2.length - 1];
    assert(lastRec2.eventType === 'RESET', '1.10-M OFF 상태 reset은 RESET으로 기록');

    // 인증 정보 DTO 미노출 검증
    const diagStr = JSON.stringify(diagAfterReset);
    assert(!diagStr.includes('STOCKSYS_REGIME_ADMIN'), '1.10-N 진단 DTO에 구 기본키 미노출');
    assert(!diagStr.includes('TEST_PERMITTED'), '1.10-O 진단 DTO에 구 테스트키 미노출');
    assert(!diagStr.includes('rcap_'), '1.10-P 진단 DTO에 Capability 식별자 미노출');
  }
  console.log('  ✓ [1단계] Capability 보안 경계 및 reset 감사 이력 검증 100% 통과!\n');

  // ═════════════════════════════════════════════════════════════════
  // 2단계: 동일 스냅샷 기반 SHADOW 및 런타임 불변식 진단
  // ═════════════════════════════════════════════════════════════════
  console.log('▶ [2단계] 동일 스냅샷 기반 SHADOW 및 런타임 불변식 진단 검증');

  // 2.1 & 2.2: OFF와 SHADOW의 실제 장부·체결·가격·잔고·PRNG 지문 100% 비트 단위 일치
  {
    const TEST_SEED = 2026;

    async function runSim(mode: 'OFF' | 'SHADOW') {
      memoryDb.resetToSeedData();
      const mgr = new AgentManager(TEST_SEED, START_EPOCH_MS, { regimeEffectsMode: mode });

      await mgr.step(1800);
      await mgr.step(600);
      await mgr.step(30);

      const eventTime = mgr.clock.simulationTime;
      mgr.registerEvent({
        eventId: `test2_bull_${mode}`,
        scope: 'market',
        eventType: 'OFFICIAL',
        targetStockIds: [],
        valuationSignal: 0.65,
        attentionShock: 0.4,
        uncertaintyShock: 0.02,
        confidence: 0.95,
        halfLife: 1800,
        publishedAt: eventTime,
        effectiveFrom: eventTime,
        publisher: 'GovPolicy',
        title: '글로벌 유동성 공급',
        content: '시장 호재 유입',
      });

      for (const stock of memoryDb.stocks.values()) {
        memoryDb.stockPriceHistory.push({
          id: `hist_t2_${stock.id}_${mode}`,
          stock_id: stock.id,
          price: Math.round(stock.current_price * 1.03),
          recorded_at: new Date(eventTime).toISOString(),
        });
      }

      for (let s = 1; s <= 5; s++) {
        await mgr.step(15);
        checkInvariants(`Test2_${mode}_Step${s}`);
      }

      return {
        mgr,
        fingerprint: getFingerprint(mgr),
        diagnostics: mgr.getRegimeModeDiagnostics(),
        shadowHistory: mgr.getShadowDiagnosticsHistory(),
      };
    }

    const resOff = await runSim('OFF');
    const resShadow = await runSim('SHADOW');

    assert(
      resOff.fingerprint === resShadow.fingerprint,
      '2.1 & 2.2 OFF와 SHADOW 모드의 실제 장부·체결·가격·잔고·PRNG 지문 100% 비트 단위 일치'
    );

    // 2.3 SHADOW 진단 상태 COMPLETED 확인
    const shadowRec = resShadow.diagnostics.shadowDiagnostics;
    assert(shadowRec !== null, '2.3-A SHADOW 최신 진단 레코드 존재');
    assert(shadowRec?.shadowCalculationStatus === 'COMPLETED', '2.3-B shadowCalculationStatus === "COMPLETED"');
    assert(Object.keys(shadowRec?.virtualMultipliers || {}).length > 0, '2.3-C 가상 배수 산출 확인');

    // 2.4 Idempotent Read 및 방어적 복사본 검증
    const diag1 = resShadow.mgr.getRegimeModeDiagnostics();
    const diag2 = resShadow.mgr.getRegimeModeDiagnostics();
    assert(JSON.stringify(diag1) === JSON.stringify(diag2), '2.4-A getRegimeModeDiagnostics() 2회 호출 전후 일치');
    // 반환 객체 변조 시 내부 상태 보호 확인
    (diag1 as any).modeChangeHistory.push({ fake: true });
    const diag3 = resShadow.mgr.getRegimeModeDiagnostics();
    assert(diag3.modeChangeHistory.length !== (diag1 as any).modeChangeHistory.length, '2.4-B 내부 배열 직접 참조 미노출 (방어적 복사)');
    if (diag1.shadowDiagnostics) {
      (diag1.shadowDiagnostics as any).virtualMultipliers['fake_key'] = 999;
      const diag4 = resShadow.mgr.getRegimeModeDiagnostics();
      assert(diag4.shadowDiagnostics?.virtualMultipliers['fake_key'] === undefined, '2.4-C shadowDiagnostics 가상 배수 객체 직접 변조 방어');
    }

    // 2.5 동일 시드 재현
    const resShadow2 = await runSim('SHADOW');
    assert(
      JSON.stringify(resShadow.shadowHistory) === JSON.stringify(resShadow2.shadowHistory),
      '2.5 동일 seed SHADOW 결과 bit-for-bit 완벽 재현'
    );
  }

  // 2.6 불변식 검사 강화 및 위반 주입 검증
  {
    memoryDb.resetToSeedData();
    const mgr = new AgentManager(42, START_EPOCH_MS);
    await mgr.step(10);

    // 정상 상태에서는 invariantViolationCount === 0
    assert(mgr.getRegimeModeDiagnostics().invariantViolationCount === 0, '2.6-A 정상 상태 invariantViolationCount === 0');

    // 불변식 검사 전후 PRNG 불변 검증
    const prngBefore = mgr.agentPrngs.get('acc_bot_val_01')?.getState();
    mgr.checkRuntimeInvariants(mgr.clock.simulationTime, mgr.clock.simulationStep, false);
    const prngAfter = mgr.agentPrngs.get('acc_bot_val_01')?.getState();
    assert(prngBefore === prngAfter, '2.6-B 불변식 검사 수행 전후 실제 PRNG 상태 보존');

    // 위반 주입 1: 예약 현금 > 실제 잔고 (RESERVED_CASH_EXCEEDS_BALANCE)
    const testUser = 'acc_bot_val_01';
    const prof = memoryDb.profiles.get(testUser);
    const firstStock = Array.from(memoryDb.stocks.values())[0];
    if (prof && firstStock) {
      const origCash = prof.cash;
      const fakeBuyOrder: OrderRecord = {
        id: 'fake_buy_order_res',
        stock_id: firstStock.id,
        user_id: testUser,
        side: 'buy',
        price: 50000,
        size: 100,
        filled: 0,
        status: 'open',
        is_lp: false,
        created_at: new Date(mgr.clock.simulationTime).toISOString(),
      };
      memoryDb.orders.set(fakeBuyOrder.id, fakeBuyOrder);
      memoryDb.addOrderToIndex(fakeBuyOrder);

      prof.cash = 10; // 잔고를 10원으로 대폭 축소하여 열린 주문의 예약 현금보다 작게 만듦
      mgr.checkRuntimeInvariants(mgr.clock.simulationTime, mgr.clock.simulationStep + 1, false);
      const diagInjected = mgr.getRegimeModeDiagnostics();
      assert(
        Boolean(diagInjected.violations?.some((v) => v.code === 'RESERVED_CASH_EXCEEDS_BALANCE')),
        '2.6-C 예약 현금 > 실제 잔고 위반(RESERVED_CASH_EXCEEDS_BALANCE) 탐지'
      );
      prof.cash = origCash;
      memoryDb.orders.delete(fakeBuyOrder.id);
      memoryDb.removeOrderFromIndex(fakeBuyOrder);
    }

    // 위반 주입 2: 예약 매도량 > 실제 보유량 (RESERVED_HOLDING_EXCEEDS_QUANTITY)
    if (firstStock) {
      const userHids = memoryDb.holdingUserIndex.get(testUser);
      let targetHolding: HoldingRecord | undefined;
      if (userHids) {
        for (const hid of userHids) {
          const h = memoryDb.holdings.get(hid);
          if (h && h.stock_id === firstStock.id) {
            targetHolding = h;
            break;
          }
        }
      }
      if (!targetHolding) {
        targetHolding = {
          id: `holding_${testUser}_${firstStock.id}`,
          user_id: testUser,
          stock_id: firstStock.id,
          quantity: 10,
          avg_price: 50000,
          created_at: new Date().toISOString(),
        };
        memoryDb.holdings.set(targetHolding.id, targetHolding);
        memoryDb.addHoldingToIndex(targetHolding);
      }

      const fakeSellOrder: OrderRecord = {
        id: 'fake_sell_order_res',
        stock_id: firstStock.id,
        user_id: testUser,
        side: 'sell',
        price: 50000,
        size: 500,
        filled: 0,
        status: 'open',
        is_lp: false,
        created_at: new Date(mgr.clock.simulationTime).toISOString(),
      };
      memoryDb.orders.set(fakeSellOrder.id, fakeSellOrder);
      memoryDb.addOrderToIndex(fakeSellOrder);

      const origQty = targetHolding.quantity;
      targetHolding.quantity = 0; // 보유량을 0으로 만들어 기존 활성 매도 주문의 예약량(500)보다 작게 만듦
      mgr.checkRuntimeInvariants(mgr.clock.simulationTime, mgr.clock.simulationStep + 2, false);
      const diagHolding = mgr.getRegimeModeDiagnostics();
      assert(
        Boolean(diagHolding.violations?.some((v) => v.code === 'RESERVED_HOLDING_EXCEEDS_QUANTITY')),
        '2.6-D 예약 매도량 > 실제 보유량 위반(RESERVED_HOLDING_EXCEEDS_QUANTITY) 탐지'
      );
      targetHolding.quantity = origQty;
      memoryDb.orders.delete(fakeSellOrder.id);
      memoryDb.removeOrderFromIndex(fakeSellOrder);
    }

    // 위반 주입 3: Zombie Order 탐지 (인덱스에만 존재하고 orders 맵에 없음)
    const zombieOrderId = 'zombie_order_9999';
    const firstStockId = Array.from(memoryDb.stocks.keys())[0];
    memoryDb.orderStockIndex.get(firstStockId)?.add(zombieOrderId);
    mgr.checkRuntimeInvariants(mgr.clock.simulationTime, mgr.clock.simulationStep + 3, false);
    const diagZombie = mgr.getRegimeModeDiagnostics();
    assert(
      Boolean(diagZombie.violations?.some((v) => v.code === 'ZOMBIE_ORDER_IN_STOCK_INDEX')),
      '2.6-E 인덱스에만 남은 Zombie 주문(ZOMBIE_ORDER_IN_STOCK_INDEX) 탐지'
    );
    memoryDb.orderStockIndex.get(firstStockId)?.delete(zombieOrderId);

    // 위반 주입 4: Missing Order Index 탐지 (orders에는 존재하지만 인덱스에 누락)
    const testOrder = Array.from(memoryDb.orders.values())[0];
    if (testOrder) {
      memoryDb.orderStockIndex.get(testOrder.stock_id)?.delete(testOrder.id);
      mgr.checkRuntimeInvariants(mgr.clock.simulationTime, mgr.clock.simulationStep + 4, false);
      const diagMissing = mgr.getRegimeModeDiagnostics();
      assert(
        Boolean(diagMissing.violations?.some((v) => v.code === 'MISSING_ORDER_STOCK_INDEX')),
        '2.6-F 인덱스 누락 주문(MISSING_ORDER_STOCK_INDEX) 탐지'
      );
      memoryDb.orderStockIndex.get(testOrder.stock_id)?.add(testOrder.id);
    }
  }
  console.log('  ✓ [2단계] 동일 스냅샷 기반 SHADOW 및 런타임 불변식 진단 검증 100% 통과!\n');

  // ═════════════════════════════════════════════════════════════════
  // 3단계: 실제 가격 이력 조회 및 채권 fallback 결정론
  // ═════════════════════════════════════════════════════════════════
  console.log('▶ [3단계] 실제 가격 이력 조회 및 채권 fallback 결정론 검증');

  // 3.1 실제 운영 함수 fetchCanonicalPriceHistory 검증
  {
    const mockDbStore: Record<string, any[]> = {
      stock_price_history: [
        { id: 'h1', stock_id: '00000000-0000-4000-8000-000000000101', price: 72000, volume: 1000, created_at: '2026-03-01T10:00:00Z' },
        { id: 'h2', stock_id: '0015', price: 85000, volume: 2000, created_at: '2026-03-01T10:00:00Z' }, // 구버전 ticker 기준
      ],
    };

    const createMockSupabase = (failOnTable?: string) => ({
      from: (tableName: string) => ({
        select: (_cols: string) => ({
          eq: (col: string, val: any) => ({
            order: (_ordCol: string, _opts: any) => ({
              limit: (n: number) => {
                if (tableName === failOnTable) {
                  return Promise.resolve({ data: null, error: { message: `Simulated DB error on ${tableName}` } });
                }
                const rows = (mockDbStore[tableName] || []).filter((r) => r[col] === val).slice(0, n);
                return Promise.resolve({ data: rows, error: null });
              },
            }),
          }),
        }),
      }),
    });

    const mockDb = createMockSupabase();

    // 시나리오 1: UUID로 주식 상세 접근 (canonical 결과 존재 -> ticker fallback 미호출)
    const res1 = await fetchCanonicalPriceHistory({
      db: mockDb,
      assetId: '00000000-0000-4000-8000-000000000101',
      ticker: '0010',
      assetKind: 'stock',
    });
    assert(res1.source === 'canonical' && res1.data.length === 1 && res1.data[0].price === 72000, '3.1-A canonical ID로 정상 조회 및 ticker fallback 미호출');

    // 시나리오 2: canonical 결과 없고 구버전 ticker 기준 결과 존재 -> ticker fallback 호출
    const res2 = await fetchCanonicalPriceHistory({
      db: mockDb,
      assetId: '00000000-0000-4000-8000-000000000102',
      ticker: '0015',
      assetKind: 'stock',
    });
    assert(res2.source === 'ticker_fallback' && res2.data.length === 1 && res2.data[0].price === 85000, '3.1-B canonical 부재 시 ticker fallback 정상 조회');

    // 시나리오 3: canonical 및 ticker 결과 모두 부재
    const res3 = await fetchCanonicalPriceHistory({
      db: mockDb,
      assetId: '00000000-0000-4000-8000-000000000999',
      ticker: '9999',
      assetKind: 'stock',
    });
    assert(res3.source === 'empty' && res3.data.length === 0, '3.1-C 양쪽 모두 부재 시 정상 빈 결과 반환');
    // 시나리오 4: DB 조회 오류 시 source === 'error' 반환 (정상 empty와 명확히 구분)
    const failingDb = createMockSupabase('stock_price_history');
    const res4 = await fetchCanonicalPriceHistory({
      db: failingDb,
      assetId: '00000000-0000-4000-8000-000000000101',
      ticker: '0010',
      assetKind: 'stock',
    });
    // 수정된 정책: DB 오류는 source === 'error' (이전 'empty'와 구분)
    assert(res4.source === 'error' && res4.error !== undefined && res4.error.code !== undefined, '3.1-D DB 오류 격리: source === error, 오류 코드 포함');
  }

  // 3.2 채권 synthetic price history 결정론 검증 (Date.now 미사용)
  {
    const bondAsset = {
      id: 'bond_kr_10y_01',
      currentPrice: 10150,
      previousClose: 10120,
      volume: 25000,
      updated_at: '2026-03-01T12:00:00.000Z',
      created_at: '2026-01-01T00:00:00.000Z',
    };

    // 1순위: 명시적 시뮬레이션 시각 기준
    const simTimeMs = 1773500500000;
    const history1A = createDeterministicBondHistory(bondAsset, simTimeMs);
    const history1B = createDeterministicBondHistory(bondAsset, simTimeMs);
    assert(JSON.stringify(history1A) === JSON.stringify(history1B), '3.2-A 동일 입력 시 채권 synthetic history 100% 결정론적 일치');
    assert(history1A[0].created_at === new Date(simTimeMs).toISOString(), '3.2-B 1순위: 시뮬레이션 시각 기준 타임스탬프 산출');
    assert(history1A[1].created_at === new Date(simTimeMs - 60000).toISOString(), '3.2-C 60초 전 과거 포인트 생성');

    // 2순위: updated_at 기준
    const history2 = createDeterministicBondHistory(bondAsset);
    assert(history2[0].created_at === new Date('2026-03-01T12:00:00.000Z').toISOString(), '3.2-D 2순위: updated_at 기준 타임스탬프 산출');

    // 3순위: created_at 기준
    const bondOnlyCreated = { ...bondAsset, updated_at: undefined };
    const history3 = createDeterministicBondHistory(bondOnlyCreated);
    assert(history3[0].created_at === new Date('2026-01-01T00:00:00.000Z').toISOString(), '3.2-E 3순위: created_at 기준 타임스탬프 산출');

    // 4순위: 고정 fallback epoch 기준
    const bondNoDates = { ...bondAsset, updated_at: undefined, created_at: undefined };
    const history4 = createDeterministicBondHistory(bondNoDates);
    assert(history4[0].created_at === new Date(DEFAULT_BOND_FALLBACK_EPOCH_MS).toISOString(), '3.2-F 4순위: 고정 fallback epoch 기준 타임스탬프 산출');
  }
  console.log('  ✓ [3단계] 실제 가격 이력 조회 및 채권 fallback 결정론 검증 100% 통과!\n');

  console.log('================================================================');
  console.log('  🎉 7대 결함 보완 검증 스위트 모든 항목 100% 통과 완료!');
  console.log('================================================================\n');

  process.exit(0);
}

if (require.main === module) {
  runAllTests().catch((err) => {
    console.error('❌ FATAL ERROR in test-regime-activation-modes:', err);
    process.exit(1);
  });
}
