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
 *   RegimeCapabilityVerifier 인터페이스 및 OperationalRegimeCapabilityVerifier만 사용한다.
 * - AgentManager는 환경과 무관하게 OperationalRegimeCapabilityVerifier(Process-wide single-use)를 내부에서 직접 생성하여 사용한다.
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
 * Capability 검증·소비 인터페이스.
 *
 * 운영 구현체: OperationalRegimeCapabilityVerifier (AgentManager 내부 기본, Process-wide single-use)
 */
export interface RegimeCapabilityVerifier {
  /**
   * Capability의 유효성을 검증하고 단회용으로 소비한다.
   * 신뢰 가능한 시스템 시계(Date.now())를 내부에서 직접 조회하여 검증 및 만료 정리를 수행한다.
   * 검증 실패 또는 이미 소비된 경우 success: false.
   * 성공한 경우에만 capability를 소비한다.
   */
  verifyAndConsume(
    capability: unknown
  ): CapabilityVerificationResult;

  /**
   * 이미 소비된 capability인지 확인한다 (소비하지 않음).
   */
  isConsumed(capabilityId: string): boolean;
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
 * consumed capability 저장소 정책 (Process-wide Single-Use):
 * - 동일 프로세스 내 모든 OperationalRegimeCapabilityVerifier 및 AgentManager 인스턴스가
 *   공통의 정적 저장소(consumedCapabilities static Map<capabilityId, expiresAt>)를 공유한다.
 * - 한 AgentManager에서 소비된 capability는 다른 AgentManager 또는 새로운 인스턴스에서도 즉시 재사용 거절된다.
 * - AgentManager reset 또는 재생성으로 소비 기록이 초기화되지 않는다.
 * - 검증 수행 직전(verifyAndConsume 내부): 신뢰 가능한 시스템 시계(Date.now()) 기준 만료 항목만 안전하게 내부 private 정리한다.
 * - 외부에서 임의의 nowMs를 주입하여 저장소를 비우거나 공개 prune 메서드를 호출하는 보안 우회는 원천 차단된다.
 * - 미만료 소비 기록은 저장소 크기 제한 때문에 절대 임의로 삭제하지 않는다.
 * - 안전 상한(1,000건) 도달 후 만료 정리 후에도 포화 상태이면 fail-closed (errorCode: CONSUMED_STORE_SATURATED)로 거절한다.
 * - 성공적으로 EXPERIMENTAL_ON 전환이 예약된 경우에만 단 1회 capability를 소비 등록한다.
 *
 * 🚨 [보안 제약 사항]:
 * - 이 단회용 소비 보장은 동일 Node.js 프로세스 내 메모리에서만 유효하다.
 * - 프로세스 재시작 시 인메모리 Map이 소멸되므로, 만료되지 않은 capability가 이론적으로 재사용될 수 있는 창(최대 5분 TTL)이 존재한다.
 * - 다중 컨테이너 / 멀티프로세스 수평 확장(Scale-out) 환경에서는 인스턴스 간 메모리가 분리되므로,
 *   중앙 원자적 분산 캐시(Redis `SET key value NX EX ttl` 등) 또는 DB 트랜잭션 기반 저장소가 필수적이다.
 *   본 모듈은 단일 프로세스 아키텍처 범위 내에서 process-wide 불변식을 엄격히 보장한다.
 */
export class OperationalRegimeCapabilityVerifier implements RegimeCapabilityVerifier {
  private static readonly CONSUMED_MAX_SIZE = 1000;
  // Process-wide 싱글톤 소비 저장소: Map<capabilityId, expiresAt>
  private static readonly consumedCapabilities: Map<string, number> = new Map();

  public verifyAndConsume(
    capability: unknown
  ): CapabilityVerificationResult {
    // 외부 조작 불가능한 신뢰할 수 있는 시스템 시계(wall-clock)를 내부에서 단 1회 직접 조회
    const nowMs = Date.now();

    // 1. 만료된 소비 기록 정리 (신뢰 가능한 현재 시각으로만 내부 private 정리)
    OperationalRegimeCapabilityVerifier.pruneExpired(nowMs);

    // 2. capability 기본 유효성 검증
    if (!isValidRegimeExperimentCapability(capability, nowMs)) {
      return { success: false, errorCode: 'INVALID_CAPABILITY' };
    }

    const cap = capability as RegimeExperimentCapability;

    // 3. 이미 소비된 capability 재사용 거절 (프로세스 전체 범위)
    if (OperationalRegimeCapabilityVerifier.consumedCapabilities.has(cap.id)) {
      return { success: false, errorCode: 'ALREADY_CONSUMED' };
    }

    // 4. 저장소 포화 검사: 만료 정리 후에도 상한에 도달했다면 fail-closed
    if (OperationalRegimeCapabilityVerifier.consumedCapabilities.size >= OperationalRegimeCapabilityVerifier.CONSUMED_MAX_SIZE) {
      return { success: false, errorCode: 'CONSUMED_STORE_SATURATED' };
    }

    // 5. 소비 기록 등록 (expiresAt 저장으로 미래 만료 정리 가능)
    OperationalRegimeCapabilityVerifier.consumedCapabilities.set(cap.id, cap.expiresAt);

    return { success: true };
  }

  public isConsumed(capabilityId: string): boolean {
    return OperationalRegimeCapabilityVerifier.consumedCapabilities.has(capabilityId);
  }

  /**
   * 신뢰 가능한 wall-clock 기준으로 만료된 항목만 정리하는 내부 private 메서드.
   * 외부(공개 인터페이스 또는 인스턴스 메서드)에서 임의의 미래 시각을 전달하여
   * process-wide 저장소를 비우는 보안 우회를 원천 차단한다.
   */
  private static pruneExpired(nowMs: number): void {
    for (const [id, expiresAt] of OperationalRegimeCapabilityVerifier.consumedCapabilities) {
      if (expiresAt <= nowMs) {
        OperationalRegimeCapabilityVerifier.consumedCapabilities.delete(id);
      }
    }
  }
}

/**
 * 서버 환경변수(REGIME_EXPERIMENT_AUTH_KEY)를 통한 정규 서버 인가 프로바이더.
 * - fail-closed: 환경변수 미설정 또는 최소 길이(32자) 미만 시 발급 거절
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

    // Fail-closed: 환경변수 미설정이거나 최소 길이(32자) 미만이면 즉시 거절
    if (!requiredKey || requiredKey.trim().length < 32) {
      return {
        success: false,
        error: 'REGIME_EXPERIMENT_AUTH_KEY 미설정 또는 길이 부족 (최소 32자 필수, Fail-closed 정책 적용)',
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
