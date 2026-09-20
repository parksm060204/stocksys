/**
 * lib/engine/simulation/regime/regimeAuth.ts
 *
 * STOCKSYS 시장 국면 운용 모드 인가 및 Capability 관리 계층
 *
 * 필수 보안 정책:
 * 1. 기본 운용 모드는 항상 'OFF'
 * 2. REGIME_EXPERIMENT_AUTH_KEY 미설정 시 활성화 거절 (Fail-closed)
 * 3. 과거 기본키(STOCKSYS_REGIME_ADMIN) 및 테스트키(TEST_PERMITTED) 원천 차단
 * 4. 불투명 심볼(Symbol) 기반의 위조 불가능한 Capability 객체를 통해서만 EXPERIMENTAL_ON 허용
 * 5. 비밀키, 세션 토큰, capability 식별자 등 민감정보는 DTO 및 로그에 노출하지 않음
 * 6. 만료 검증: issuedAt/expiresAt 안전 정수 검사, 최대 TTL(5분), 허용 클록 스큐(5초), nowMs 주입 지원
 *
 * 보안 경계:
 * - raw capability 생성 함수(_createRegimeCapabilityRaw)는 이 모듈 내부에서만 사용되며,
 *   외부로 export되지 않는다. 운영 capability 생성 권한은 ServerRegimeAuthorizationProvider에만 있다.
 * - 외부 코드는 capability 검증 함수(isValidRegimeExperimentCapability)와
 *   RegimeCapabilityVerifier 인터페이스만 사용한다.
 * - 테스트 코드는 TestRegimeCapabilityVerifier를 DI하며 이 모듈의 내부 함수를 import하지 않는다.
 */

import { randomUUID } from 'crypto';

export const MAX_CAPABILITY_TTL_MS = 5 * 60 * 1000; // 5분 (300,000ms)
export const ALLOWED_CLOCK_SKEW_MS = 5000; // 5초

const REGIME_CAPABILITY_BRAND: unique symbol = Symbol('STOCKSYS_REGIME_EXPERIMENT_CAPABILITY');

export interface RegimeExperimentCapability {
  readonly [REGIME_CAPABILITY_BRAND]: true;
  readonly id: string;
  readonly issuedAt: number;
  readonly expiresAt: number;
}

/**
 * 불투명(Opaque) Capability 생성 내부 헬퍼.
 * 이 함수는 외부로 export되지 않으며 ServerRegimeAuthorizationProvider 내부에서만 호출된다.
 * 민감한 비밀키나 세션 정보는 일체 포함하지 않음.
 *
 * @internal 운영 모듈 내부 전용 - 절대 export하지 않을 것
 */
function _createRegimeCapabilityRaw(
  _scope: string,
  ttlMs: number = MAX_CAPABILITY_TTL_MS,
  issuedAt?: number,
  customId?: string,
  explicitExpiresAt?: number
): RegimeExperimentCapability {
  const now = typeof issuedAt === 'number' ? issuedAt : Date.now();
  const expires = typeof explicitExpiresAt === 'number'
    ? explicitExpiresAt
    : now + ttlMs;
  const id = customId || `rcap_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

  return Object.freeze({
    [REGIME_CAPABILITY_BRAND]: true as const,
    id,
    issuedAt: now,
    expiresAt: expires,
  });
}

/**
 * 주어진 객체가 유효하게 발급된 불투명 Capability인지 엄격하게 검증한다.
 *
 * 검증 항목:
 * - 심볼 브랜드 [REGIME_CAPABILITY_BRAND] === true
 * - ID 접두어 'rcap_' 및 규격 검증
 * - issuedAt, expiresAt, nowMs가 모두 양의 유한한 안전 정수(SafeInteger)인지 확인 (NaN, Infinity, 음수, 소수 거절)
 * - issuedAt <= nowMs + ALLOWED_CLOCK_SKEW_MS (미래 발급 방지)
 * - expiresAt > nowMs (만료 시각부터 즉시 거절)
 * - expiresAt > issuedAt
 * - expiresAt - issuedAt <= MAX_CAPABILITY_TTL_MS (최대 허용 TTL 5분 초과 거절)
 */
export function isValidRegimeExperimentCapability(
  cap: unknown,
  nowMs: number = Date.now()
): cap is RegimeExperimentCapability {
  if (!cap || typeof cap !== 'object') return false;
  const c = cap as any;

  // 1. 브랜드 무결성 검증 (필드만 복사한 위조 객체 차단)
  if (c[REGIME_CAPABILITY_BRAND] !== true) return false;

  // 2. ID 규격 검증
  if (typeof c.id !== 'string' || !c.id.startsWith('rcap_') || c.id.length < 10 || c.id.length > 64) {
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

  // 5. 만료 검사 (만료 시각 nowMs 시점부터 거절)
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
 * 사용자가 입력한 reason 문자열의 제어문자(\x00-\x1F, \x7F)를 제거하고
 * 100자 이내로 정규화한다.
 */
export function sanitizeReason(reason: unknown): string {
  if (typeof reason !== 'string') return '';
  return reason.replace(/[\x00-\x1F\x7F]/g, '').trim().slice(0, 100);
}

/**
 * Capability 검증 및 소비(단회용) 결과 타입.
 */
export interface CapabilityVerificationResult {
  readonly success: boolean;
  readonly errorCode?: string;
}

/**
 * Capability 검증·소비 인터페이스 (Dependency Injection용).
 *
 * 운영 환경: OperationalRegimeCapabilityVerifier (AgentManager 기본)
 * 테스트 환경: scripts/test-support/TestRegimeCapabilityVerifier (테스트 DI)
 *
 * 이 인터페이스를 통해 테스트 코드가 운영 비공개 raw factory에 접근하지 않아도 된다.
 */
export interface RegimeCapabilityVerifier {
  /**
   * Capability의 유효성을 검증하고 단회용으로 소비한다.
   * 검증 실패 또는 이미 소비된 경우 success: false.
   * 성공한 경우에만 capability를 소비한다.
   */
  verifyAndConsume(
    capability: unknown,
    nowMs: number
  ): CapabilityVerificationResult;

  /**
   * 이미 소비된 capability인지 확인한다 (소비하지 않음).
   */
  isConsumed(capabilityId: string): boolean;

  /**
   * reset 후에도 미만료 소비 기록을 유지한다.
   * 만료된 소비 기록만 제거한다.
   */
  pruneExpiredConsumed(nowMs: number): void;
}

export interface RegimeAuthorizationProvider {
  issueCapability(credentials?: {
    secretKey?: string;
    reason?: string;
  }): {
    success: boolean;
    capability?: RegimeExperimentCapability;
    error?: string;
  };
}

/**
 * 운영 환경 Capability 검증기.
 *
 * consumed capability 저장소 정책:
 * - Map<capabilityId, expiresAt> 구조 사용
 * - 신규 검증 전: expiresAt <= nowMs인 만료 항목만 제거
 * - 미만료 소비 기록은 저장소 크기 제한 때문에 절대 삭제하지 않음
 * - 안전 상한(1,000건) 도달 후 만료 항목이 없으면 fail-closed (신규 거절)
 * - 성공적으로 EXPERIMENTAL_ON 전환이 예약된 경우에만 capability 소비
 * - reset 후에도 미만료 소비 기록 유지
 *
 * 제한: 단일 프로세스 인스턴스 내에서만 보장됨.
 * 다중 인스턴스 환경(수평 확장)에서는 공유 저장소(Redis 등)가 필요하다.
 */
export class OperationalRegimeCapabilityVerifier implements RegimeCapabilityVerifier {
  private readonly CONSUMED_MAX_SIZE = 1000;
  // Map<capabilityId, expiresAt>
  private readonly consumedCapabilities: Map<string, number> = new Map();

  public verifyAndConsume(
    capability: unknown,
    nowMs: number
  ): CapabilityVerificationResult {
    // 1. 만료된 소비 기록 정리 (미만료 기록은 절대 삭제하지 않음)
    this.pruneExpiredConsumed(nowMs);

    // 2. capability 기본 유효성 검증
    if (!isValidRegimeExperimentCapability(capability, nowMs)) {
      return { success: false, errorCode: 'INVALID_CAPABILITY' };
    }

    const cap = capability as RegimeExperimentCapability;

    // 3. 이미 소비된 capability 재사용 거절
    if (this.consumedCapabilities.has(cap.id)) {
      return { success: false, errorCode: 'ALREADY_CONSUMED' };
    }

    // 4. 저장소 포화 검사: 만료 정리 후에도 상한에 도달했다면 fail-closed
    if (this.consumedCapabilities.size >= this.CONSUMED_MAX_SIZE) {
      return { success: false, errorCode: 'CONSUMED_STORE_SATURATED' };
    }

    // 5. 소비 기록 (expiresAt 저장으로 미래 만료 정리 가능)
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

  /** 테스트 검증용: 현재 소비된 capability 수 (만료 포함) */
  public getConsumedCount(): number {
    return this.consumedCapabilities.size;
  }

  /** 테스트 검증용: 미만료 소비된 capability 수 */
  public getUnexpiredConsumedCount(nowMs: number): number {
    let count = 0;
    for (const expiresAt of this.consumedCapabilities.values()) {
      if (expiresAt > nowMs) count++;
    }
    return count;
  }
}

/**
 * 서버 환경변수(REGIME_EXPERIMENT_AUTH_KEY)를 통한 정규 서버 인가 프로바이더.
 * - fail-closed: 환경변수 미설정 시 발급 거절
 * - 취약/과거 기본키 거절
 * - capability 생성은 내부 _createRegimeCapabilityRaw만 사용 (외부 노출 금지)
 */
export class ServerRegimeAuthorizationProvider implements RegimeAuthorizationProvider {
  public issueCapability(credentials?: {
    secretKey?: string;
    reason?: string;
  }): {
    success: boolean;
    capability?: RegimeExperimentCapability;
    error?: string;
  } {
    const requiredKey = process.env.REGIME_EXPERIMENT_AUTH_KEY;

    // Fail-closed: 환경변수 미설정이거나 너무 짧으면 즉시 거절
    if (!requiredKey || requiredKey.trim().length < 8) {
      return {
        success: false,
        error: 'REGIME_EXPERIMENT_AUTH_KEY 미설정 또는 길이 부족 (Fail-closed 정책 적용)',
      };
    }

    // 과거 기본키 및 테스트용 키는 운영 환경에서 명시적 거절
    const givenKey = credentials?.secretKey?.trim();
    if (
      givenKey === 'STOCKSYS_REGIME_ADMIN' ||
      givenKey === 'TEST_PERMITTED' ||
      !givenKey
    ) {
      return {
        success: false,
        error: '비인가 또는 폐기된 인증 키입니다.',
      };
    }

    if (givenKey === requiredKey.trim()) {
      return {
        success: true,
        // 내부 전용 함수 호출 - 외부 코드는 이 경로를 직접 실행할 수 없음
        capability: _createRegimeCapabilityRaw('server_env_authorized', MAX_CAPABILITY_TTL_MS),
      };
    }

    return {
      success: false,
      error: '비밀키가 일치하지 않습니다.',
    };
  }
}
