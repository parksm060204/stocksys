/**
 * scripts/test-support/testRegimeAuth.ts
 *
 * 테스트 전용 Capability 발급·검증 지원 모듈.
 *
 * 보안 격리 원칙:
 * 1. 이 모듈은 scripts/test-support 아래에만 존재하며, 운영 배포 번들이나 lib/ 코드에서 절대 import하지 않는다.
 * 2. 운영 모듈(regimeAuth.ts)의 비공개 raw factory를 일체 사용하지 않는다.
 * 3. AgentManager 통합 테스트용 정규 Capability는 ServerRegimeAuthorizationProvider를 통해 발급하며,
 *    REGIME_EXPERIMENT_AUTH_KEY는 try/finally 블록으로 엄격하게 원래 상태로 복원한다.
 * 4. 거절 테스트용 가짜 객체(createUnauthenticatedTestCapability)는 운영 Symbol이 없으므로
 *    운영 검증기(OperationalRegimeCapabilityVerifier)에서 반드시 거절된다.
 */

import { randomUUID } from 'crypto';
import {
  type RegimeAuthorizationProvider,
  type RegimeExperimentCapability,
  type RegimeCapabilityVerifier,
  type CapabilityVerificationResult,
  MAX_CAPABILITY_TTL_MS,
  ALLOWED_CLOCK_SKEW_MS,
  ServerRegimeAuthorizationProvider,
  OperationalRegimeCapabilityVerifier,
  isValidRegimeExperimentCapability,
} from '../../lib/engine/simulation/regime/regimeAuth';

export { MAX_CAPABILITY_TTL_MS, ALLOWED_CLOCK_SKEW_MS };

/**
 * 테스트 전용 독립 브랜드 Symbol.
 * 운영 REGIME_CAPABILITY_BRAND와는 완전히 다른 고유 Symbol이므로,
 * 운영 검증기(OperationalRegimeCapabilityVerifier)에서는 항상 위조 객체로 판단되어 거절된다.
 */
const TEST_FAKE_CAPABILITY_BRAND: unique symbol = Symbol('STOCKSYS_TEST_FAKE_CAPABILITY_BRAND');

export interface TestFakeRegimeCapability {
  readonly [TEST_FAKE_CAPABILITY_BRAND]: true;
  readonly id: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/**
 * 운영 검증기 통과용 정식 운영 Capability 발급 헬퍼 (통합 테스트용).
 *
 * ServerRegimeAuthorizationProvider를 통해 정상 키 인증으로 발급받으며,
 * REGIME_EXPERIMENT_AUTH_KEY는 try/finally로 반드시 원래 상태로 복원한다.
 */
export function createTestRegimeCapability(
  authKey: string = 'test-authorized-valid-token-key-32chars',
  _ttlMs: number = MAX_CAPABILITY_TTL_MS
): RegimeExperimentCapability {
  const previousKey = process.env.REGIME_EXPERIMENT_AUTH_KEY;
  try {
    process.env.REGIME_EXPERIMENT_AUTH_KEY = authKey;
    const provider = new ServerRegimeAuthorizationProvider();
    const result = provider.issueCapability({ secretKey: authKey });
    if (!result.success || !result.capability) {
      throw new Error(`[testRegimeAuth] Failed to issue capability for test: ${result.error}`);
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

/**
 * 운영 Symbol이 없는 가짜/비인가 테스트 객체 생성기 (거절 테스트용).
 * OperationalRegimeCapabilityVerifier에 제출 시 무조건 거절된다.
 */
export function createUnauthenticatedTestCapability(
  ttlMs: number = MAX_CAPABILITY_TTL_MS,
  nowMs: number = Date.now(),
  customId?: string
): RegimeExperimentCapability {
  const id = customId || `rcap_test_fake_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
  const fakeObj = Object.freeze({
    [TEST_FAKE_CAPABILITY_BRAND]: true as const,
    id,
    issuedAt: nowMs,
    expiresAt: nowMs + ttlMs,
  });
  return fakeObj as unknown as RegimeExperimentCapability;
}

/**
 * 테스트용 만료된 Capability 객체 생성기 (거절 테스트용).
 */
export function createExpiredTestRegimeCapability(
  expiredAgoMs: number = 1000,
  referenceNowMs: number = Date.now()
): RegimeExperimentCapability {
  const issued = referenceNowMs - 60000;
  const expires = referenceNowMs - expiredAgoMs;
  const fakeObj = Object.freeze({
    id: `rcap_test_expired_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    issuedAt: issued,
    expiresAt: expires,
  });
  return fakeObj as unknown as RegimeExperimentCapability;
}

/**
 * 테스트용 미래 시각 발급 Capability 객체 생성기 (거절 테스트용).
 */
export function createFutureTestRegimeCapability(
  futureSkewMs: number = 10000,
  referenceNowMs: number = Date.now()
): RegimeExperimentCapability {
  const issuedFuture = referenceNowMs + futureSkewMs;
  const fakeObj = Object.freeze({
    id: `rcap_test_future_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    issuedAt: issuedFuture,
    expiresAt: issuedFuture + MAX_CAPABILITY_TTL_MS,
  });
  return fakeObj as unknown as RegimeExperimentCapability;
}

/**
 * 테스트용 과도한 TTL Capability 객체 생성기 (거절 테스트용).
 */
export function createExcessiveTtlTestRegimeCapability(
  ttlMs: number = 10 * 60 * 1000, // 10분 (> 5분)
  referenceNowMs: number = Date.now()
): RegimeExperimentCapability {
  const fakeObj = Object.freeze({
    id: `rcap_test_excessive_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
    issuedAt: referenceNowMs,
    expiresAt: referenceNowMs + ttlMs,
  });
  return fakeObj as unknown as RegimeExperimentCapability;
}

/**
 * 테스트 전용 독립 Authorization Provider.
 */
export class TestRegimeAuthorizationProvider implements RegimeAuthorizationProvider {
  private readonly testToken: string;

  constructor(testToken: string = 'test-authorized-token') {
    this.testToken = testToken;
  }

  public issueCapability(credentials?: { secretKey?: string; reason?: string }): {
    success: boolean;
    capability?: RegimeExperimentCapability;
    error?: string;
  } {
    if (credentials?.secretKey === this.testToken) {
      return {
        success: true,
        capability: createTestRegimeCapability(credentials.secretKey),
      };
    }
    return {
      success: false,
      error: '테스트 토큰 불일치',
    };
  }
}
