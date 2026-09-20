import {
  type RegimeAuthorizationProvider,
  type RegimeExperimentCapability,
  _createRegimeCapabilityRaw,
  MAX_CAPABILITY_TTL_MS,
} from '../../lib/engine/simulation/regime/regimeAuth';

/**
 * 테스트 전용 인가 프로바이더.
 * 프로덕션 코드에서는 절대 import되어서는 안 되며 오직 테스트 스위트에서만 의존성 주입(DI)용으로 사용됨.
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
        capability: _createRegimeCapabilityRaw('test_authorized', MAX_CAPABILITY_TTL_MS),
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
 */
export function createTestRegimeCapability(
  testToken: string = 'test-authorized-token',
  ttlMs: number = MAX_CAPABILITY_TTL_MS,
  issuedAt?: number,
  customId?: string
): RegimeExperimentCapability {
  const provider = new TestRegimeAuthorizationProvider(testToken);
  const res = provider.issueCapability({ secretKey: testToken });
  if (!res.success || !res.capability) {
    throw new Error(`Failed to create test capability: ${res.error}`);
  }
  if (ttlMs !== MAX_CAPABILITY_TTL_MS || issuedAt !== undefined || customId !== undefined) {
    return _createRegimeCapabilityRaw('test_custom', ttlMs, issuedAt, customId);
  }
  return res.capability;
}

/**
 * 테스트용 만료된 Capability 생성기.
 */
export function createExpiredTestRegimeCapability(
  expiredAgoMs: number = 1000,
  referenceNowMs: number = Date.now()
): RegimeExperimentCapability {
  const issued = referenceNowMs - 60000;
  const expires = referenceNowMs - expiredAgoMs;
  return _createRegimeCapabilityRaw('test_expired', expires - issued, issued);
}

/**
 * 테스트용 미래 시각 발급 Capability 생성기.
 */
export function createFutureTestRegimeCapability(
  futureSkewMs: number = 10000,
  referenceNowMs: number = Date.now()
): RegimeExperimentCapability {
  const issued = referenceNowMs + futureSkewMs;
  return _createRegimeCapabilityRaw('test_future', MAX_CAPABILITY_TTL_MS, issued);
}

/**
 * 테스트용 과도한 TTL Capability 생성기.
 */
export function createExcessiveTtlTestRegimeCapability(
  ttlMs: number = 10 * 60 * 1000, // 10분 (> 5분)
  referenceNowMs: number = Date.now()
): RegimeExperimentCapability {
  return _createRegimeCapabilityRaw('test_excessive_ttl', ttlMs, referenceNowMs);
}
