/**
 * scripts/test-support/testRegimeAuth.ts
 *
 * 테스트 전용 Capability 발급·검증 지원 모듈.
 *
 * 보안 정책:
 * - 이 파일은 scripts/test-support 아래에만 존재하며,
 *   프로덕션 배포 번들이나 lib/ 코드에서 절대 import하지 않는다.
 * - _createRegimeCapabilityRaw 같은 운영 raw factory를 직접 import하지 않는다.
 * - createTestCapabilityForVerifier() (regimeAuth.ts 내부 헬퍼)를 통해 테스트 capability를 발급한다.
 * - 브랜드 심볼이나 내부 구조를 우회하지 않는다.
 * - NODE_ENV === 'test'만으로 자동 승인하지 않는다.
 */

import {
  type RegimeAuthorizationProvider,
  type RegimeExperimentCapability,
  type RegimeCapabilityVerifier,
  type CapabilityVerificationResult,
  MAX_CAPABILITY_TTL_MS,
  isValidRegimeExperimentCapability,
  createTestCapabilityForVerifier,
} from '../../lib/engine/simulation/regime/regimeAuth';

export { MAX_CAPABILITY_TTL_MS };

/**
 * 테스트 전용 Capability 검증기.
 *
 * AgentManager 생성자의 capabilityVerifier 옵션으로 주입하여 사용한다.
 * 운영 raw factory에 접근하지 않고, createTestCapabilityForVerifier()를 통해 capability를 발급받는다.
 *
 * consumed capability 저장소 정책 (OperationalRegimeCapabilityVerifier와 동일):
 * - Map<capabilityId, expiresAt>
 * - 만료된 항목만 정리 (미만료 항목은 크기 제한으로 삭제하지 않음)
 * - 포화 시 fail-closed
 */
export class TestRegimeCapabilityVerifier implements RegimeCapabilityVerifier {
  private readonly CONSUMED_MAX_SIZE = 1000;
  private readonly consumedCapabilities: Map<string, number> = new Map();

  public verifyAndConsume(
    capability: unknown,
    nowMs: number
  ): CapabilityVerificationResult {
    // 1. 만료된 소비 기록 정리
    this.pruneExpiredConsumed(nowMs);

    // 2. 유효성 검증
    if (!isValidRegimeExperimentCapability(capability, nowMs)) {
      return { success: false, errorCode: 'INVALID_CAPABILITY' };
    }

    const cap = capability as RegimeExperimentCapability;

    // 3. 재사용 거절
    if (this.consumedCapabilities.has(cap.id)) {
      return { success: false, errorCode: 'ALREADY_CONSUMED' };
    }

    // 4. 포화 fail-closed (미만료 항목 삭제 금지)
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
 * 프로덕션 코드에서는 절대 import되어서는 안 되며,
 * 오직 테스트 스위트에서만 DI용으로 사용됨.
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
      // createTestCapabilityForVerifier를 사용하므로 raw factory를 직접 호출하지 않음
      const cap = createTestCapabilityForVerifier(this.nowMs, MAX_CAPABILITY_TTL_MS);
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
 *
 * createTestCapabilityForVerifier를 통해 발급하므로 raw factory 미사용.
 * nowMs를 명시적으로 주입하여 결정론적 테스트를 지원한다.
 */
export function createTestRegimeCapability(
  _testToken: string = 'test-authorized-token',
  ttlMs: number = MAX_CAPABILITY_TTL_MS,
  nowMs: number = Date.now(),
  _customId?: string
): RegimeExperimentCapability {
  return createTestCapabilityForVerifier(nowMs, ttlMs);
}

/**
 * 테스트용 만료된 Capability 생성기.
 * issuedAt을 현재보다 훨씬 이전으로, expiresAt을 이미 지난 시각으로 설정.
 */
export function createExpiredTestRegimeCapability(
  expiredAgoMs: number = 1000,
  referenceNowMs: number = Date.now()
): RegimeExperimentCapability {
  const issued = referenceNowMs - 60000;
  const ttl = 60000 - expiredAgoMs;
  if (ttl <= 0) {
    // ttl이 음수면 이미 만료된 시각으로 강제 생성
    return createTestCapabilityForVerifier(referenceNowMs - 70000, 1);
  }
  return createTestCapabilityForVerifier(issued, ttl);
}

/**
 * 테스트용 미래 시각 발급 Capability 생성기.
 * issuedAt을 ALLOWED_CLOCK_SKEW_MS(5초)보다 더 미래로 설정하여 거절 테스트에 사용.
 */
export function createFutureTestRegimeCapability(
  futureSkewMs: number = 10000,
  referenceNowMs: number = Date.now()
): RegimeExperimentCapability {
  const issuedFuture = referenceNowMs + futureSkewMs;
  return createTestCapabilityForVerifier(issuedFuture, MAX_CAPABILITY_TTL_MS);
}

/**
 * 테스트용 과도한 TTL Capability 생성기.
 * MAX_CAPABILITY_TTL_MS(5분)를 초과하는 TTL로 생성하여 거절 테스트에 사용.
 */
export function createExcessiveTtlTestRegimeCapability(
  ttlMs: number = 10 * 60 * 1000, // 10분 (> 5분)
  referenceNowMs: number = Date.now()
): RegimeExperimentCapability {
  return createTestCapabilityForVerifier(referenceNowMs, ttlMs);
}
