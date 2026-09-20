/**
 * scripts/test-support/testRegimeAuth.ts
 *
 * 테스트 전용 독립 Capability 발급·검증 지원 모듈.
 *
 * 보안 격리 원칙:
 * 1. 이 모듈은 scripts/test-support 아래에만 존재하며, 운영 배포 번들이나 lib/ 코드에서 절대 import하지 않는다.
 * 2. 운영 모듈(regimeAuth.ts)의 raw factory나 운영용 테스트 발급 함수를 전혀 import하지 않는다.
 * 3. 테스트 객체는 운영 REGIME_CAPABILITY_BRAND 심볼이 없으므로,
 *    운영 OperationalRegimeCapabilityVerifier를 절대로 통과할 수 없다. (거절 보장)
 * 4. 테스트 capability는 오직 TestRegimeCapabilityVerifier에 주입했을 때만 유효하게 검증·소비된다.
 * 5. 필요한 타입 단언(as unknown as RegimeExperimentCapability)은 이 테스트 모듈과 테스트 스크립트에만 한정한다.
 */

import { randomUUID } from 'crypto';
import {
  type RegimeAuthorizationProvider,
  type RegimeExperimentCapability,
  type RegimeCapabilityVerifier,
  type CapabilityVerificationResult,
  MAX_CAPABILITY_TTL_MS,
  ALLOWED_CLOCK_SKEW_MS,
} from '../../lib/engine/simulation/regime/regimeAuth';

export { MAX_CAPABILITY_TTL_MS, ALLOWED_CLOCK_SKEW_MS };

/**
 * 테스트 전용 독립 브랜드 Symbol.
 * 운영 REGIME_CAPABILITY_BRAND와는 완전히 다른 고유 Symbol이므로,
 * 운영 검증기(OperationalRegimeCapabilityVerifier)에서는 항상 위조 객체로 판단되어 거절된다.
 */
const TEST_CAPABILITY_BRAND: unique symbol = Symbol('STOCKSYS_TEST_CAPABILITY_BRAND');

export interface TestRegimeExperimentCapability {
  readonly [TEST_CAPABILITY_BRAND]: true;
  readonly id: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/**
 * 주어진 객체가 유효하게 발급된 테스트 전용 Capability인지 검증한다.
 * (TestRegimeCapabilityVerifier 내부 검증용)
 */
export function isValidTestRegimeCapability(
  cap: unknown,
  nowMs: number = Date.now()
): cap is TestRegimeExperimentCapability {
  if (!cap || typeof cap !== 'object') return false;
  const c = cap as any;

  // 1. 테스트 브랜드 무결성 검증 (운영 Symbol이 아닌 테스트 고유 Symbol 확인)
  if (c[TEST_CAPABILITY_BRAND] !== true) return false;

  // 2. 테스트 ID 규격 검증 ('rcap_test_' 접두사 필수)
  if (typeof c.id !== 'string' || !c.id.startsWith('rcap_test_') || c.id.length < 15 || c.id.length > 64) {
    return false;
  }

  // 3. 시간값 안전 정수 검증 (NaN, Infinity, 소수, 음수 거절)
  if (typeof c.issuedAt !== 'number' || !Number.isSafeInteger(c.issuedAt) || c.issuedAt <= 0) {
    return false;
  }
  if (typeof c.expiresAt !== 'number' || !Number.isSafeInteger(c.expiresAt) || c.expiresAt <= 0) {
    return false;
  }
  if (typeof nowMs !== 'number' || !Number.isSafeInteger(nowMs) || nowMs <= 0) {
    return false;
  }

  // 4. 미래 발급 검사 (허용 클록 스큐 5초 초과 시 거절)
  if (c.issuedAt > nowMs + ALLOWED_CLOCK_SKEW_MS) {
    return false;
  }

  // 5. 만료 검사 (nowMs 시점부터 거절)
  if (c.expiresAt <= nowMs) {
    return false;
  }

  // 6. 논리적 순서 검사
  if (c.expiresAt <= c.issuedAt) {
    return false;
  }

  // 7. 최대 TTL 검사 (5분 초과 거절)
  if (c.expiresAt - c.issuedAt > MAX_CAPABILITY_TTL_MS) {
    return false;
  }

  return true;
}

/**
 * 테스트 전용 독립 Capability 생성 내부 함수.
 * 운영 모듈의 raw factory를 일체 사용하지 않는다.
 */
function _createTestCapabilityInternal(
  ttlMs: number = MAX_CAPABILITY_TTL_MS,
  issuedAt?: number,
  customId?: string,
  explicitExpiresAt?: number
): RegimeExperimentCapability {
  const now = typeof issuedAt === 'number' ? issuedAt : Date.now();
  const expires = typeof explicitExpiresAt === 'number'
    ? explicitExpiresAt
    : now + ttlMs;
  const id = customId || `rcap_test_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

  const obj = Object.freeze({
    [TEST_CAPABILITY_BRAND]: true as const,
    id,
    issuedAt: now,
    expiresAt: expires,
  });

  // 테스트 코드 인터페이스 호환을 위한 타입 단언 (테스트 모듈 내 한정)
  return obj as unknown as RegimeExperimentCapability;
}

/**
 * 테스트 전용 Capability 검증기 (DI용).
 *
 * AgentManager 생성자의 capabilityVerifier 옵션으로 주입하여 사용한다.
 * 운영 검증기와 동일한 단회용 소비·만료 정리·포화 fail-closed 정책을 구현하되,
 * 오직 TEST_CAPABILITY_BRAND가 붙은 테스트 객체만 승인한다.
 */
export class TestRegimeCapabilityVerifier implements RegimeCapabilityVerifier {
  private readonly CONSUMED_MAX_SIZE = 1000;
  // Map<capabilityId, expiresAt>
  private readonly consumedCapabilities: Map<string, number> = new Map();

  public verifyAndConsume(
    capability: unknown,
    nowMs: number
  ): CapabilityVerificationResult {
    // 1. 만료된 소비 기록 정리 (미만료 기록은 삭제하지 않음)
    this.pruneExpiredConsumed(nowMs);

    // 2. 테스트 capability 규격 및 브랜드 유효성 검증
    if (!isValidTestRegimeCapability(capability, nowMs)) {
      return { success: false, errorCode: 'INVALID_CAPABILITY' };
    }

    const cap = capability as TestRegimeExperimentCapability;

    // 3. 이미 소비된 capability 재사용 거절
    if (this.consumedCapabilities.has(cap.id)) {
      return { success: false, errorCode: 'ALREADY_CONSUMED' };
    }

    // 4. 저장소 포화 검사: 만료 정리 후에도 상한에 도달했다면 fail-closed
    if (this.consumedCapabilities.size >= this.CONSUMED_MAX_SIZE) {
      return { success: false, errorCode: 'CONSUMED_STORE_SATURATED' };
    }

    // 5. 소비 기록
    this.consumedCapabilities.set(cap.id, cap.expiresAt);
    return { success: true };
  }

  public isConsumed(capabilityId: string): boolean {
    return this.consumedCapabilities.has(capabilityId);
  }

  public pruneExpiredConsumed(nowMs: number): void {
    for (const [id, expiresAt] of this.consumedCapabilities) {
      if (expiresAt <= nowMs) {
        this.consumedCapabilities.delete(id);
      }
    }
  }

  public getConsumedCount(): number {
    return this.consumedCapabilities.size;
  }

  public getUnexpiredConsumedCount(nowMs: number): number {
    let count = 0;
    for (const expiresAt of this.consumedCapabilities.values()) {
      if (expiresAt > nowMs) count++;
    }
    return count;
  }
}

/**
 * 테스트 전용 Authorization Provider.
 * 프로덕션 코드에서는 절대 import되어서는 안 되며 오직 테스트 스위트에서만 DI용으로 사용됨.
 */
export class TestRegimeAuthorizationProvider implements RegimeAuthorizationProvider {
  private readonly testToken: string;
  private readonly nowMs: number;

  constructor(testToken: string = 'test-authorized-token', nowMs?: number) {
    this.testToken = testToken;
    this.nowMs = typeof nowMs === 'number' ? nowMs : Date.now();
  }

  public issueCapability(credentials?: { secretKey?: string; reason?: string }): {
    success: boolean;
    capability?: RegimeExperimentCapability;
    error?: string;
  } {
    if (credentials?.secretKey === this.testToken) {
      const cap = _createTestCapabilityInternal(MAX_CAPABILITY_TTL_MS, this.nowMs);
      return {
        success: true,
        capability: cap,
      };
    }
    return {
      success: false,
      error: '테스트 토큰 불일치',
    };
  }
}

/**
 * 테스트 전용 유효한 Capability 발급기.
 * 운영 raw factory를 일체 사용하지 않으며, 테스트 전용 브랜드 객체를 반환한다.
 */
export function createTestRegimeCapability(
  _testToken: string = 'test-authorized-token',
  ttlMs: number = MAX_CAPABILITY_TTL_MS,
  nowMs: number = Date.now(),
  customId?: string
): RegimeExperimentCapability {
  return _createTestCapabilityInternal(ttlMs, nowMs, customId);
}

/**
 * 테스트용 만료된 Capability 생성기.
 */
export function createExpiredTestRegimeCapability(
  expiredAgoMs: number = 1000,
  referenceNowMs: number = Date.now()
): RegimeExperimentCapability {
  const issued = referenceNowMs - 60000;
  const ttl = 60000 - expiredAgoMs;
  if (ttl <= 0) {
    return _createTestCapabilityInternal(1, referenceNowMs - 70000);
  }
  return _createTestCapabilityInternal(ttl, issued);
}

/**
 * 테스트용 미래 시각 발급 Capability 생성기.
 */
export function createFutureTestRegimeCapability(
  futureSkewMs: number = 10000,
  referenceNowMs: number = Date.now()
): RegimeExperimentCapability {
  const issuedFuture = referenceNowMs + futureSkewMs;
  return _createTestCapabilityInternal(MAX_CAPABILITY_TTL_MS, issuedFuture);
}

/**
 * 테스트용 과도한 TTL Capability 생성기.
 */
export function createExcessiveTtlTestRegimeCapability(
  ttlMs: number = 10 * 60 * 1000, // 10분 (> 5분)
  referenceNowMs: number = Date.now()
): RegimeExperimentCapability {
  return _createTestCapabilityInternal(ttlMs, referenceNowMs);
}
