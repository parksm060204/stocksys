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
 * 민감한 비밀키나 세션 정보는 일체 포함하지 않음.
 */
export function _createRegimeCapabilityRaw(
  scope: string,
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
 * 서버 환경변수(REGIME_EXPERIMENT_AUTH_KEY)를 통한 정규 서버 인가 프로바이더.
 * - fail-closed: 환경변수 미설정 시 발급 거절
 * - 취약/과거 기본키 거절
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
        capability: _createRegimeCapabilityRaw('server_env_authorized', MAX_CAPABILITY_TTL_MS),
      };
    }

    return {
      success: false,
      error: '비밀키가 일치하지 않습니다.',
    };
  }
}
