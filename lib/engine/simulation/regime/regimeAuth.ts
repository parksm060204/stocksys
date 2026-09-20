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
 * 5. 비밀키, 세션 토큰 등 민감정보는 DTO 및 로그에 노출하지 않음
 */

import { randomUUID } from 'crypto';

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
function createOpaqueCapability(scope: string, ttlMs: number = 3600000): RegimeExperimentCapability {
  const now = Date.now();
  return Object.freeze({
    [REGIME_CAPABILITY_BRAND]: true as const,
    id: `rcap_${randomUUID().slice(0, 16)}`,
    issuedAt: now,
    expiresAt: now + ttlMs,
  });
}

/**
 * 주어진 객체가 유효하게 발급된 불투명 Capability인지 검증한다.
 */
export function isValidRegimeExperimentCapability(cap: unknown): cap is RegimeExperimentCapability {
  if (!cap || typeof cap !== 'object') return false;
  const c = cap as any;
  return (
    c[REGIME_CAPABILITY_BRAND] === true &&
    typeof c.id === 'string' &&
    typeof c.issuedAt === 'number' &&
    typeof c.expiresAt === 'number' &&
    c.expiresAt >= c.issuedAt
  );
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
    adminUser?: string;
    reason?: string;
  }): {
    success: boolean;
    capability?: RegimeExperimentCapability;
    error?: string;
  };
}

/**
 * 서버 환경변수(REGIME_EXPERIMENT_AUTH_KEY) 또는 관리자 세션을 통한 정규 인가 프로바이더.
 * - fail-closed: 환경변수 미설정 시 발급 거절
 * - 취약/과거 기본키 거절
 */
export class ServerRegimeAuthorizationProvider implements RegimeAuthorizationProvider {
  public issueCapability(credentials?: {
    secretKey?: string;
    adminUser?: string;
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
        capability: createOpaqueCapability('server_env_authorized'),
      };
    }

    return {
      success: false,
      error: '비밀키가 일치하지 않습니다.',
    };
  }
}

/**
 * 테스트 전용 인가 팩토리.
 * 테스트 스크립트에서 명시적으로 인스턴스를 주입하여 사용할 때만 동작.
 * NODE_ENV === 'test'만으로 자동 승인되지 않음.
 */
export class TestRegimeAuthorizationProvider implements RegimeAuthorizationProvider {
  private readonly testToken: string;

  constructor(testToken: string = 'test-authorized-token') {
    this.testToken = testToken;
  }

  public issueCapability(credentials?: { secretKey?: string }): {
    success: boolean;
    capability?: RegimeExperimentCapability;
    error?: string;
  } {
    if (credentials?.secretKey === this.testToken) {
      return {
        success: true,
        capability: createOpaqueCapability('test_authorized'),
      };
    }
    return {
      success: false,
      error: '테스트 토큰 불일치',
    };
  }
}

/**
 * 테스트 전용 독립 Capability 발급 헬퍼 (테스트 코드 전용).
 */
export function createTestRegimeCapability(testToken: string = 'test-authorized-token'): RegimeExperimentCapability {
  const provider = new TestRegimeAuthorizationProvider(testToken);
  const res = provider.issueCapability({ secretKey: testToken });
  if (!res.success || !res.capability) {
    throw new Error(`Failed to create test capability: ${res.error}`);
  }
  return res.capability;
}
