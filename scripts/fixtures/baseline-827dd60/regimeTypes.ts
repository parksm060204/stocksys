/**
 * BASELINE FIXTURE - 827dd6079a11f58cdb2746668cbab7290752b8f4
 * Source Path: lib/engine/simulation/regime/regimeTypes.ts
 * Git Blob Hash: 1ac2fd2d28adcfceae7a13a03c8ea77857d3a116
 * SHA-256: 7d5ff85dc90f3051ad7ddc1d6e0fb0f190ab22c7e803fadcaa83588bc8916ff4
 */
/**
 * STOCKSYS Market Regime & Trading Session Domain Types
 *
 * 1단계: 타입·설정·결정론적 상태 전환 엔진
 * - 시장 국면(MarketRegime) 및 거래 세션(TradingSession)
 * - 불변 파라미터 및 안전한 스냅샷 DTO
 * - 확정된 이전 스텝 관측 DTO(RegimeObservation)
 * - 구조화된 전환 이유 및 이력 레코드
 */

export type MarketRegime =
  | 'BULL'
  | 'BEAR'
  | 'SIDEWAYS'
  | 'HIGH_VOLATILITY'
  | 'LIQUIDITY_CRISIS';

export type TradingSession =
  | 'PRE_OPEN'
  | 'OPENING_AUCTION'
  | 'CONTINUOUS'
  | 'CLOSING_AUCTION'
  | 'CLOSED';

export type RegimeTransitionReason =
  | 'VOLATILITY_SURGE'
  | 'LIQUIDITY_DROUGHT'
  | 'BULLISH_FLOW'
  | 'BEARISH_FLOW'
  | 'RANGE_STABILIZATION'
  | 'CRISIS_RECOVERY';

export interface MarketRegimeParameters {
  /** 매수 주문 도착 빈도 배수 (1.0 = 표준) */
  readonly buyArrivalMultiplier: number;
  /** 매도 주문 도착 빈도 배수 (1.0 = 표준) */
  readonly sellArrivalMultiplier: number;
  /** 평균 주문 크기 배수 (1.0 = 표준) */
  readonly orderSizeMultiplier: number;
  /** 위험 허용도 배수 (1.0 = 표준) */
  readonly riskToleranceMultiplier: number;
  /** 추세 추종 민감도 (1.0 = 표준) */
  readonly trendSensitivity: number;
  /** 가치평가 역발상 민감도 (1.0 = 표준) */
  readonly valueSensitivity: number;
  /** LP 호가 스프레드 배수 (1.0 = 표준) */
  readonly lpSpreadMultiplier: number;
  /** LP 호가 깊이 배수 (1.0 = 표준) */
  readonly lpDepthMultiplier: number;
  /** 불확실성 배수 (1.0 = 표준) */
  readonly uncertaintyMultiplier: number;
  /** 뉴스 충격 반감기 배수 (1.0 = 표준) */
  readonly newsHalfLifeMultiplier: number;
  /** 자산 중 현금 선호도 (0.0 ~ 1.0) */
  readonly cashPreference: number;
}

export interface RegimeObservation {
  /** 관측 시점 시뮬레이션 절대 시각 (epoch ms) */
  readonly simulationTime: number;
  /** 시가총액 가중 평균 시장수익률 (Market-cap weighted aggregate return) */
  readonly aggregateReturn: number;
  /** 시장 지수 시계열 실현 변동성 (Time-series realized volatility) */
  readonly realizedVolatility: number;
  /** 종목 간 횡단면 수익률 분산 (Cross-sectional return dispersion) */
  readonly crossSectionalDispersion?: number;
  /** 거래대금 변화율 (전기 대비) */
  readonly turnoverChange: number;
  /** 과거 기록 기반 평균 스프레드 (bps, 대시보드/진입 참고용) */
  readonly averageSpreadBps: number;
  /**
   * 해당 스텝 최종 주문 장부에서 관측한 현재 유효 양측 최우선 호가 스프레드 (bps).
   * 유효 양측 호가 부재/교차 호가/비정상 가격이면 null 또는 undefined (스프레드 회복 미확인).
   */
  readonly currentSpreadBps?: number | null;
  /** 호가 깊이 변화율 (전기 대비) */
  readonly depthChange: number;
  /** 시장 평균 불확실성 */
  readonly uncertainty: number;
  /** 호가 공백(빈 장부) 지속 시간 (초) */
  readonly emptyBookDurationSeconds: number;
  /** 호가 공백(양측 호가 부재) 종목 비율 (0.0 ~ 1.0) */
  readonly emptyBookStockRatio?: number;
  /** 유효 거시 경제 뉴스 신호 (-1.0 ~ +1.0) */
  readonly effectiveMacroNewsSignal: number;
}

export interface RegimeTransitionMetrics {
  readonly aggregateReturn: number;
  readonly realizedVolatility: number;
  readonly crossSectionalDispersion?: number;
  readonly turnoverChange: number;
  /** 과거 기록 기반 평균 스프레드 (bps, 대시보드/진입 참고용) */
  readonly averageSpreadBps: number;
  /** 현재 장부 기준 유효 양측 최우선 호가 스프레드 (bps, 관측 불가 시 null/undefined) */
  readonly currentSpreadBps?: number | null;
  readonly depthChange: number;
  readonly uncertainty: number;
  readonly emptyBookDurationSeconds: number;
  readonly emptyBookStockRatio?: number;
  readonly effectiveMacroNewsSignal: number;
  readonly triggerScore?: number;
}

export interface PendingRegimeTransition {
  readonly regime: MarketRegime;
  readonly decidedAt: number;
  readonly effectiveAt: number;
  readonly decisionStepId: number;
  readonly reason: RegimeTransitionReason;
  readonly metrics: Readonly<RegimeTransitionMetrics>;
}

export interface RegimeTransitionRecord {
  readonly transitionId: number;
  /** 평가 및 판단 시각 (epoch ms) */
  readonly evaluatedAt: number;
  /** 실제 국면 적용 시각 (epoch ms) */
  readonly effectiveAt: number;
  /** 결정이 내려진 스텝 ID */
  readonly decisionStepId: number;
  readonly fromRegime: MarketRegime;
  readonly toRegime: MarketRegime;
  readonly reason: RegimeTransitionReason;
  readonly metrics: Readonly<RegimeTransitionMetrics>;
  readonly details?: string;
}

export interface SessionTransitionRecord {
  readonly transitionId: number;
  readonly timestamp: number;
  readonly fromSession: TradingSession;
  readonly toSession: TradingSession;
  readonly tradingDay: number;
}

export interface MarketStateCapabilities {
  readonly regimeDetection: boolean;
  readonly sessionTracking: boolean;
  readonly botBehaviorAdjustment: boolean;
  readonly lpAdjustment: boolean;
  readonly auctionMatching: boolean;
  readonly sessionOrderRestriction: boolean;
}

export interface MarketStateSnapshot {
  /** 단조 증가하는 스냅샷 버전 */
  readonly stateVersion: number;
  /** 스냅샷 기준 시뮬레이션 시각 (epoch ms) */
  readonly simulationTime: number;

  readonly regime: MarketRegime;
  readonly previousRegime: MarketRegime | null;
  readonly regimeStartedAt: number;
  readonly regimeDurationSeconds: number;

  readonly session: TradingSession;
  readonly sessionStartedAt: number;
  readonly nextSession: TradingSession;
  readonly nextTransitionAt: number;

  /** 거래일 인덱스 (0부터 시작) */
  readonly tradingDayIndex: number;
  /** 현재 거래일 시작 시각 (epoch ms) */
  readonly tradingDayStartedAt: number;

  readonly pendingRegime: MarketRegime | null;
  readonly pendingRegimeEffectiveAt: number | null;

  readonly transitionId: number;
  readonly transitionReason: RegimeTransitionReason | null;
  readonly parameters: Readonly<MarketRegimeParameters>;

  /** 구현 메타데이터 */
  readonly implementationStage: 1;
  /** 국면 효과(봇·LP 행동 반영)가 실제 적용 중인지 여부 (Stage 2, 설정 미활성 시 false) */
  readonly marketMechanicsApplied: boolean;
  readonly capabilities: Readonly<MarketStateCapabilities>;
}

export interface TradingSessionDefinition {
  readonly session: TradingSession;
  readonly durationSeconds: number;
}

export interface SessionScheduleConfig {
  /** 거래일 시작 기준 시각 (epoch ms) */
  readonly tradingDayAnchorMs: number;
  /** 구버전 호환 alias */
  readonly dayStartEpochMs?: number;
  /** 거래일 총 길이 (초 단위, 예: 86,400s) */
  readonly tradingDayDurationSeconds: number;
  /** 구버전 호환 alias */
  readonly totalDayDurationSeconds?: number;
  /** 세션 정의 목록 ([start, end) 순서로 연속) */
  readonly sessions: readonly TradingSessionDefinition[];
}

export interface RegimeThresholdConfig {
  /** 최소 국면 유지 시간 (초) */
  readonly minRegimeDurationSeconds: number;
  /** 국면 전환 쿨다운 (초) */
  readonly regimeCooldownSeconds: number;

  // 1. 유동성 위기 (LIQUIDITY_CRISIS) 진입 / 이탈 임계치 분리
  readonly liquidityCrisisEnterSpreadBps: number;
  readonly liquidityCrisisExitSpreadBps: number;
  readonly liquidityCrisisEnterDepthDrop: number;
  readonly liquidityCrisisExitDepthDrop: number;
  readonly liquidityCrisisEmptyBookDurationSeconds: number;
  /** 시장 전체 빈 장부 판정 종목 비율 임계값 (0.0 ~ 1.0) */
  readonly emptyBookStockRatioThreshold?: number;

  // 2. 고변동성 (HIGH_VOLATILITY) 진입 / 이탈 임계치 분리
  readonly highVolatilityEnterThreshold: number;
  readonly highVolatilityExitThreshold: number;
  readonly highVolatilityUncertaintyThreshold: number;

  // 3. 상승장 (BULL) 진입 임계치
  readonly bullReturnThreshold: number;
  readonly bullTurnoverChangeThreshold: number;
  readonly bullMacroSignalThreshold: number;

  // 4. 하락장 (BEAR) 진입 임계치
  readonly bearReturnThreshold: number;
  readonly bearTurnoverChangeThreshold: number;
  readonly bearMacroSignalThreshold: number;

  // 5. 횡보장 (SIDEWAYS) 임계치
  readonly sidewaysReturnAbsBound: number;
  readonly sidewaysVolatilityBound: number;

  // ── 하위 호환성 필드 (선택적) ──
  readonly liquidityCrisisSpreadBpsThreshold?: number;
  readonly liquidityCrisisDepthDropThreshold?: number;
  readonly liquidityCrisisRecoverySpreadBps?: number;
  readonly liquidityCrisisRecoveryMinDurationSeconds?: number;
  readonly highVolatilityThreshold?: number;
  readonly highVolatilityRecoveryVolatility?: number;
}

export interface MarketStateEngineConfig {
  readonly initialRegime: MarketRegime;
  readonly initialSession?: TradingSession;
  readonly sessionSchedule: SessionScheduleConfig;
  readonly thresholds: RegimeThresholdConfig;
  readonly maxHistoryLimit?: number;
  /**
   * 국면 효과(봇 주문·LP 호가 반영) 활성화 여부 (Stage 2).
   * - 기본값 false: 관측·판정만 수행하고 주문/호가에는 영향을 주지 않는다.
   * - true: 스냅샷 capabilities의 botBehaviorAdjustment/lpAdjustment 및 marketMechanicsApplied가 true로 게시된다.
   */
  readonly regimeEffectsEnabled?: boolean;
}

/** 기본 주식수 폴백 (100,000주) */
export const FALLBACK_SHARES = 100000;
export const DEFAULT_FALLBACK_SHARES = FALLBACK_SHARES;

/**
 * STOCKSYS 단일 권위 주식수 산출 순수 함수
 * - 상장주식수(shares_outstanding)를 1차 권위로 사용
 * - 부재 시 유통주식수(floating_shares)를 fallback으로 사용
 * - 둘 다 부재 시 기본 fallback(100,000) 사용
 */
export function getAuthoritativeShares(stock?: {
  shares_outstanding?: number | null;
  floating_shares?: number | null;
}): number {
  if (!stock) return FALLBACK_SHARES;
  return stock.shares_outstanding ?? stock.floating_shares ?? FALLBACK_SHARES;
}

/**
 * STOCKSYS 단일 권위 시가총액 산출 순수 함수 (일반 시가총액)
 * marketCap = current_price * authoritativeShares
 */
export function calculateAuthoritativeMarketCap(stock?: {
  current_price: number;
  shares_outstanding?: number | null;
  floating_shares?: number | null;
}): number {
  if (!stock || typeof stock.current_price !== 'number' || !Number.isFinite(stock.current_price)) {
    return 1;
  }
  const authoritativeShares = getAuthoritativeShares(stock);
  return Math.max(1, stock.current_price * authoritativeShares);
}

/**
 * 종목 간 동일 가중 횡단면 수익률 분산 (Equal-weighted Cross-Sectional Dispersion)
 * - 각 종목 수익률에서 동일 가중 산술 평균을 차감하여 표준편차를 산출하는 순수 함수
 * - returns가 비어있으면 0 반환
 */
export function calculateCrossSectionalDispersion(returns: number[]): number {
  if (!returns || returns.length === 0) return 0;
  const n = returns.length;
  const mean = returns.reduce((acc, r) => acc + r, 0) / n;
  let varSum = 0;
  for (const r of returns) {
    const diff = r - mean;
    varSum += diff * diff;
  }
  return Math.sqrt(varSum / n);
}
