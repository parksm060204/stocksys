/**
 * STOCKSYS Market Regime & Session Configuration & Invariant Validation
 *
 * 1단계: 중앙 설정 및 불변식 검증 모듈
 * - 국면별 파라미터 불변 셋 및 수치 정합성 검증
 * - 거래 세션 [start, end) 스케줄 및 시간 정합성 검증
 * - 결정론적 전환 임계값 및 히스테리시스 파라미터
 * - 순수 결정론적 PRNG 시드 파생 함수
 * - Deep Freeze 불변성 보장 유틸리티
 */

import {
  MarketRegime,
  MarketRegimeParameters,
  SessionScheduleConfig,
  RegimeThresholdConfig,
  TradingSession,
} from './regimeTypes';

const MAX_MULTIPLIER_UPPER_BOUND = 100.0;

/**
 * 객체 및 하위 중첩 객체를 재귀적으로 동결하여 깊은 불변성을 보장합니다.
 */
export function deepFreeze<T>(obj: T): Readonly<T> {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.keys(obj)) {
    const prop = (obj as any)[key];
    if (prop !== null && typeof prop === 'object' && !Object.isFrozen(prop)) {
      deepFreeze(prop);
    }
  }
  return obj as Readonly<T>;
}

/**
 * 순환 참조가 없는 DTO/스냅샷 객체를 안전하게 깊은 복제합니다.
 */
export function deepClone<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => deepClone(item)) as unknown as T;
  }
  const copy = {} as any;
  for (const [key, value] of Object.entries(obj)) {
    copy[key] = deepClone(value);
  }
  return copy as T;
}

/**
 * 부모 시드와 고정 네임스페이스 문자열로부터 순수하게 파생된 32비트 unsigned integer 시드를 생성합니다.
 * Date.now()나 Math.random()을 일절 사용하지 않으며, 동일 입력 시 100% 동일한 시드를 반환합니다.
 */
export function deriveDeterministicSeed(parentSeed: number, namespace: string): number {
  let hash = (Math.abs(Math.floor(parentSeed)) || 1) ^ 0x811c9dc5;
  for (let i = 0; i < namespace.length; i++) {
    hash ^= namespace.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash ^ (hash >>> 16)) >>> 0) || 1;
}

/**
 * 국면별 파라미터 유효성 엄격 검증
 * - NaN, Infinity, 음수 차단
 * - 비정상적 과대값 차단
 * - 현금 선호도 [0.0, 1.0] 범위 검증
 */
export function validateRegimeParameters(params: MarketRegimeParameters): void {
  if (!params || typeof params !== 'object') {
    throw new Error('[RegimeConfig] MarketRegimeParameters must be a non-null object');
  }

  const numericFields: Array<keyof MarketRegimeParameters> = [
    'buyArrivalMultiplier',
    'sellArrivalMultiplier',
    'orderSizeMultiplier',
    'riskToleranceMultiplier',
    'trendSensitivity',
    'valueSensitivity',
    'lpSpreadMultiplier',
    'lpDepthMultiplier',
    'uncertaintyMultiplier',
    'newsHalfLifeMultiplier',
    'cashPreference',
  ];

  for (const field of numericFields) {
    const val = params[field];
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new RangeError(`[RegimeConfig] Field '${field}' must be a finite number: got ${val}`);
    }
    if (val < 0) {
      throw new RangeError(`[RegimeConfig] Field '${field}' must be non-negative: got ${val}`);
    }
    if (val > MAX_MULTIPLIER_UPPER_BOUND) {
      throw new RangeError(
        `[RegimeConfig] Field '${field}' exceeds upper safety bound (${MAX_MULTIPLIER_UPPER_BOUND}): got ${val}`
      );
    }
  }

  if (params.cashPreference > 1.0) {
    throw new RangeError(`[RegimeConfig] Field 'cashPreference' must be in [0.0, 1.0]: got ${params.cashPreference}`);
  }
}

/**
 * 5대 국면별 기본 불변 파라미터 세트 (deepFreeze로 깊은 불변성 보장)
 */
export const DEFAULT_REGIME_PARAMETERS: Readonly<Record<MarketRegime, Readonly<MarketRegimeParameters>>> = deepFreeze({
  BULL: {
    buyArrivalMultiplier: 1.3,
    sellArrivalMultiplier: 0.8,
    orderSizeMultiplier: 1.2,
    riskToleranceMultiplier: 1.3,
    trendSensitivity: 1.4,
    valueSensitivity: 0.8,
    lpSpreadMultiplier: 0.9,
    lpDepthMultiplier: 1.2,
    uncertaintyMultiplier: 0.8,
    newsHalfLifeMultiplier: 1.2,
    cashPreference: 0.2,
  },
  BEAR: {
    buyArrivalMultiplier: 0.7,
    sellArrivalMultiplier: 1.4,
    orderSizeMultiplier: 1.1,
    riskToleranceMultiplier: 0.6,
    trendSensitivity: 1.3,
    valueSensitivity: 1.1,
    lpSpreadMultiplier: 1.3,
    lpDepthMultiplier: 0.8,
    uncertaintyMultiplier: 1.4,
    newsHalfLifeMultiplier: 0.8,
    cashPreference: 0.6,
  },
  SIDEWAYS: {
    buyArrivalMultiplier: 1.0,
    sellArrivalMultiplier: 1.0,
    orderSizeMultiplier: 1.0,
    riskToleranceMultiplier: 1.0,
    trendSensitivity: 0.7,
    valueSensitivity: 1.3,
    lpSpreadMultiplier: 1.0,
    lpDepthMultiplier: 1.0,
    uncertaintyMultiplier: 0.9,
    newsHalfLifeMultiplier: 1.0,
    cashPreference: 0.3,
  },
  HIGH_VOLATILITY: {
    buyArrivalMultiplier: 1.2,
    sellArrivalMultiplier: 1.2,
    orderSizeMultiplier: 0.8,
    riskToleranceMultiplier: 0.7,
    trendSensitivity: 1.6,
    valueSensitivity: 0.6,
    lpSpreadMultiplier: 1.8,
    lpDepthMultiplier: 0.6,
    uncertaintyMultiplier: 2.0,
    newsHalfLifeMultiplier: 0.6,
    cashPreference: 0.5,
  },
  LIQUIDITY_CRISIS: {
    buyArrivalMultiplier: 0.3,
    sellArrivalMultiplier: 1.8,
    orderSizeMultiplier: 0.5,
    riskToleranceMultiplier: 0.2,
    trendSensitivity: 0.5,
    valueSensitivity: 0.4,
    lpSpreadMultiplier: 3.5,
    lpDepthMultiplier: 0.2,
    uncertaintyMultiplier: 3.0,
    newsHalfLifeMultiplier: 0.4,
    cashPreference: 0.8,
  },
});

// 시작 시 기본 파라미터 무결성 자체 검증
for (const [, params] of Object.entries(DEFAULT_REGIME_PARAMETERS)) {
  validateRegimeParameters(params);
}

/**
 * 기본 거래 세션 스케줄 정의 (24시간 = 86,400초 주기)
 * [start, end) 반열린 구간 규칙
 * - PRE_OPEN: 30분 (1,800s)
 * - OPENING_AUCTION: 10분 (600s)
 * - CONTINUOUS: 6시간 (21,600s)
 * - CLOSING_AUCTION: 10분 (600s)
 * - CLOSED: 17시간 10분 (61,800s)
 * 합계: 86,400s
 */
export const DEFAULT_SESSION_SCHEDULE: Readonly<SessionScheduleConfig> = deepFreeze({
  tradingDayAnchorMs: 1773500000000,
  dayStartEpochMs: 1773500000000, // backward compatible
  tradingDayDurationSeconds: 86400,
  totalDayDurationSeconds: 86400, // backward compatible
  sessions: [
    { session: 'PRE_OPEN' as TradingSession, durationSeconds: 1800 },
    { session: 'OPENING_AUCTION' as TradingSession, durationSeconds: 600 },
    { session: 'CONTINUOUS' as TradingSession, durationSeconds: 21600 },
    { session: 'CLOSING_AUCTION' as TradingSession, durationSeconds: 600 },
    { session: 'CLOSED' as TradingSession, durationSeconds: 61800 },
  ],
});

export const STANDARD_SESSIONS: readonly TradingSession[] = [
  'PRE_OPEN',
  'OPENING_AUCTION',
  'CONTINUOUS',
  'CLOSING_AUCTION',
  'CLOSED',
];

const VALID_SESSIONS_SET = new Set<string>(STANDARD_SESSIONS);

/**
 * 세션 스케줄 유효성 검증
 * - 5개 표준 세션(PRE_OPEN, OPENING_AUCTION, CONTINUOUS, CLOSING_AUCTION, CLOSED)이 정확히 한 번씩 존재
 * - 표준 세션 순서 준수
 * - 중복 세션 및 런타임 비정상 세션 문자열 차단
 * - 모든 세션 길이 > 0 및 유한성
 * - 세션 길이 합계 === tradingDayDurationSeconds
 */
export function validateSessionSchedule(config: SessionScheduleConfig): void {
  if (!config || typeof config !== 'object') {
    throw new Error('[SessionSchedule] config must be a non-null object');
  }

  const anchor = config.tradingDayAnchorMs ?? config.dayStartEpochMs;
  if (typeof anchor !== 'number' || !Number.isFinite(anchor) || anchor < 0) {
    throw new RangeError(`[SessionSchedule] tradingDayAnchorMs must be non-negative finite: ${anchor}`);
  }

  const durationSec = config.tradingDayDurationSeconds ?? config.totalDayDurationSeconds;
  if (typeof durationSec !== 'number' || !Number.isFinite(durationSec) || durationSec <= 0) {
    throw new RangeError(`[SessionSchedule] tradingDayDurationSeconds must be positive finite: ${durationSec}`);
  }

  if (!Array.isArray(config.sessions) || config.sessions.length === 0) {
    throw new Error(`[SessionSchedule] sessions list must be a non-empty array`);
  }

  if (config.sessions.length !== STANDARD_SESSIONS.length) {
    throw new Error(
      `[SessionSchedule] Schedule must contain exactly ${STANDARD_SESSIONS.length} standard sessions, got ${config.sessions.length}`
    );
  }

  const seenSessions = new Set<TradingSession>();
  let accumulated = 0;

  for (let i = 0; i < config.sessions.length; i++) {
    const s = config.sessions[i];
    if (!s || typeof s !== 'object') {
      throw new Error(`[SessionSchedule] Session[${i}] must be a non-null object`);
    }

    if (!VALID_SESSIONS_SET.has(s.session)) {
      throw new Error(`[SessionSchedule] Session[${i}] has invalid session identifier: '${s.session}'`);
    }

    if (seenSessions.has(s.session)) {
      throw new Error(`[SessionSchedule] Duplicate session detected: '${s.session}' appears multiple times`);
    }
    seenSessions.add(s.session);

    const expectedSession = STANDARD_SESSIONS[i];
    if (s.session !== expectedSession) {
      throw new Error(
        `[SessionSchedule] Session order mismatch at index ${i}: expected '${expectedSession}', got '${s.session}'`
      );
    }

    if (typeof s.durationSeconds !== 'number' || !Number.isFinite(s.durationSeconds) || s.durationSeconds <= 0) {
      throw new RangeError(
        `[SessionSchedule] Session[${i}] (${s.session}) durationSeconds must be positive finite: ${s.durationSeconds}`
      );
    }
    accumulated += s.durationSeconds;
  }

  for (const std of STANDARD_SESSIONS) {
    if (!seenSessions.has(std)) {
      throw new Error(`[SessionSchedule] Missing required standard session: '${std}'`);
    }
  }

  if (Math.abs(accumulated - durationSec) > 1e-6) {
    throw new Error(
      `[SessionSchedule] Sum of session durations (${accumulated}s) does not match tradingDayDurationSeconds (${durationSec}s)`
    );
  }
}

// 기본 스케줄 무결성 자체 검증
validateSessionSchedule(DEFAULT_SESSION_SCHEDULE);

/**
 * 국면 전환 임계값 및 히스테리시스 설정 유효성 검증
 * - 모든 수치 필드의 유한성(NaN, Infinity 거절)
 * - 음수 금지 항목 및 논리 범위 검증
 * - 진입 및 이탈 임계값의 엄격한 히스테리시스 순서 검증
 */
export function validateRegimeThresholds(th: RegimeThresholdConfig): void {
  if (!th || typeof th !== 'object') {
    throw new Error('[RegimeThresholds] thresholds must be a non-null object');
  }

  // 1. 유한성 검증 헬퍼
  const assertFinite = (name: string, val: unknown): number => {
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      throw new RangeError(`[RegimeThresholds] Field '${name}' must be a finite number, got: ${val}`);
    }
    return val;
  };

  const minDuration = assertFinite('minRegimeDurationSeconds', th.minRegimeDurationSeconds);
  if (minDuration < 0) throw new RangeError(`minRegimeDurationSeconds must be non-negative: ${minDuration}`);

  const cooldown = assertFinite('regimeCooldownSeconds', th.regimeCooldownSeconds);
  if (cooldown < 0) throw new RangeError(`regimeCooldownSeconds must be non-negative: ${cooldown}`);

  // 2. 유동성 위기 (LIQUIDITY_CRISIS)
  const enterSpread = assertFinite('liquidityCrisisEnterSpreadBps', th.liquidityCrisisEnterSpreadBps);
  const exitSpread = assertFinite('liquidityCrisisExitSpreadBps', th.liquidityCrisisExitSpreadBps);
  if (enterSpread <= 0 || exitSpread <= 0) {
    throw new RangeError(`Crisis spreads must be positive: enter=${enterSpread}, exit=${exitSpread}`);
  }
  if (enterSpread <= exitSpread) {
    throw new Error(`liquidityCrisisEnterSpreadBps (${enterSpread}) must be greater than exitSpreadBps (${exitSpread}) for hysteresis`);
  }

  const enterDepth = assertFinite('liquidityCrisisEnterDepthDrop', th.liquidityCrisisEnterDepthDrop);
  const exitDepth = assertFinite('liquidityCrisisExitDepthDrop', th.liquidityCrisisExitDepthDrop);
  if (enterDepth >= exitDepth) {
    throw new Error(
      `liquidityCrisisEnterDepthDrop (${enterDepth}) must be strictly less than exitDepthDrop (${exitDepth}) for hysteresis`
    );
  }

  const emptyBookDur = assertFinite('liquidityCrisisEmptyBookDurationSeconds', th.liquidityCrisisEmptyBookDurationSeconds);
  if (emptyBookDur < 0) {
    throw new RangeError(`liquidityCrisisEmptyBookDurationSeconds must be non-negative: ${emptyBookDur}`);
  }

  // 3. 고변동성 (HIGH_VOLATILITY)
  const enterVol = assertFinite('highVolatilityEnterThreshold', th.highVolatilityEnterThreshold);
  const exitVol = assertFinite('highVolatilityExitThreshold', th.highVolatilityExitThreshold);
  if (enterVol <= 0 || exitVol <= 0) {
    throw new RangeError(`Volatility thresholds must be positive: enter=${enterVol}, exit=${exitVol}`);
  }
  if (enterVol <= exitVol) {
    throw new Error(`highVolatilityEnterThreshold (${enterVol}) must be greater than exitThreshold (${exitVol}) for hysteresis`);
  }

  const uncertainty = assertFinite('highVolatilityUncertaintyThreshold', th.highVolatilityUncertaintyThreshold);
  if (uncertainty < 0 || uncertainty > 1.0) {
    throw new RangeError(`highVolatilityUncertaintyThreshold must be in [0.0, 1.0], got: ${uncertainty}`);
  }

  // 4. 상승장 (BULL) & 하락장 (BEAR)
  const bullReturn = assertFinite('bullReturnThreshold', th.bullReturnThreshold);
  if (bullReturn <= 0) {
    throw new RangeError(`bullReturnThreshold must be positive, got: ${bullReturn}`);
  }

  const bearReturn = assertFinite('bearReturnThreshold', th.bearReturnThreshold);
  if (bearReturn >= 0) {
    throw new RangeError(`bearReturnThreshold must be negative, got: ${bearReturn}`);
  }

  const bullTurnover = assertFinite('bullTurnoverChangeThreshold', th.bullTurnoverChangeThreshold);
  if (bullTurnover < 0) throw new RangeError(`bullTurnoverChangeThreshold must be non-negative, got: ${bullTurnover}`);

  const bearTurnover = assertFinite('bearTurnoverChangeThreshold', th.bearTurnoverChangeThreshold);
  if (bearTurnover < 0) throw new RangeError(`bearTurnoverChangeThreshold must be non-negative, got: ${bearTurnover}`);

  const bullMacro = assertFinite('bullMacroSignalThreshold', th.bullMacroSignalThreshold);
  if (bullMacro <= 0 || bullMacro > 1.0) {
    throw new RangeError(`bullMacroSignalThreshold must be in (0.0, 1.0], got: ${bullMacro}`);
  }

  const bearMacro = assertFinite('bearMacroSignalThreshold', th.bearMacroSignalThreshold);
  if (bearMacro >= 0 || bearMacro < -1.0) {
    throw new RangeError(`bearMacroSignalThreshold must be in [-1.0, 0.0), got: ${bearMacro}`);
  }

  // 5. 횡보장 (SIDEWAYS)
  const sidewaysReturn = assertFinite('sidewaysReturnAbsBound', th.sidewaysReturnAbsBound);
  if (sidewaysReturn <= 0) throw new RangeError(`sidewaysReturnAbsBound must be positive, got: ${sidewaysReturn}`);

  const sidewaysVol = assertFinite('sidewaysVolatilityBound', th.sidewaysVolatilityBound);
  if (sidewaysVol <= 0) throw new RangeError(`sidewaysVolatilityBound must be positive, got: ${sidewaysVol}`);
}

/**
 * 기본 국면 전환 임계값 및 히스테리시스 설정
 */
export const DEFAULT_REGIME_THRESHOLDS: Readonly<RegimeThresholdConfig> = deepFreeze({
  minRegimeDurationSeconds: 10.0,
  regimeCooldownSeconds: 5.0,

  // 1. 유동성 위기 (LIQUIDITY_CRISIS)
  liquidityCrisisEnterSpreadBps: 120.0,
  liquidityCrisisExitSpreadBps: 65.0,
  liquidityCrisisEnterDepthDrop: -0.45,
  liquidityCrisisExitDepthDrop: -0.20,
  liquidityCrisisEmptyBookDurationSeconds: 2.0,

  // 하위 호환
  liquidityCrisisSpreadBpsThreshold: 120.0,
  liquidityCrisisDepthDropThreshold: -0.45,
  liquidityCrisisRecoverySpreadBps: 65.0,
  liquidityCrisisRecoveryMinDurationSeconds: 12.0,

  // 2. 고변동성 (HIGH_VOLATILITY)
  highVolatilityEnterThreshold: 0.035,
  highVolatilityExitThreshold: 0.022,
  highVolatilityUncertaintyThreshold: 0.35,

  // 하위 호환
  highVolatilityThreshold: 0.035,
  highVolatilityRecoveryVolatility: 0.022,

  // 3. 상승장 (BULL)
  bullReturnThreshold: 0.012,
  bullTurnoverChangeThreshold: 0.08,
  bullMacroSignalThreshold: 0.12,

  // 4. 하락장 (BEAR)
  bearReturnThreshold: -0.012,
  bearTurnoverChangeThreshold: 0.08,
  bearMacroSignalThreshold: -0.12,

  // 5. 횡보장 (SIDEWAYS)
  sidewaysReturnAbsBound: 0.007,
  sidewaysVolatilityBound: 0.018,
});

validateRegimeThresholds(DEFAULT_REGIME_THRESHOLDS);
