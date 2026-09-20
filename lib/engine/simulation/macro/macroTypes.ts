/**
 * STOCKSYS Macroeconomic State & Economic Shock Types
 *
 * 공통 거시 상태 및 경제 충격 도메인 모델 정의.
 * - 다차원 거시 변수: 성장률, 인플레이션, 정책금리, 실질금리, 수익률곡선, 신용스프레드, 유동성 등
 * - 구조화된 경제 충격(EconomicShock): 이벤트로부터 결정론적으로 유도된 팩터 충격
 */

export interface MacroState {
  /** 경제 성장 기대 (z-score 또는 %, baseline = 0.02) */
  readonly growth: number;
  /** 기대 인플레이션 (연율 %, baseline = 0.025) */
  readonly inflation: number;
  /** 중앙은행 정책금리 (연율 %, baseline = 0.035) */
  readonly policyRate: number;
  /** 실질금리 (policyRate - inflation) */
  readonly realRate: number;
  /** 수익률 곡선 기울기 (10Y - 2Y bps, baseline = 50.0) */
  readonly yieldCurveSlope: number;
  /** 회사채 신용 스프레드 (bps, baseline = 120.0) */
  readonly creditSpread: number;
  /** 금융시장 유동성 지수 (0.0 ~ 1.0, baseline = 0.70) */
  readonly liquidity: number;
  /** 시장 위험회피 성향 (0.0 ~ 1.0, baseline = 0.30) */
  readonly riskAversion: number;
  /** 달러 인덱스 강도 (baseline = 100.0) */
  readonly fxDollarStrength: number;
  /** 원자재 실물 수요 지수 (baseline = 1.0) */
  readonly commodityDemand: number;
  /** 지정학적 위험 지수 (0.0 ~ 1.0, baseline = 0.10) */
  readonly geopoliticalRisk: number;
  /** 거시 불확실성 (0.0 ~ 1.0, baseline = 0.05) */
  readonly uncertainty: number;
  /** 시뮬레이션 절대 시각 (epoch ms) */
  readonly timestamp: number;
  /** 상태 버전 카운터 */
  readonly version: number;
}

export type MacroFactor =
  | 'growth'
  | 'inflation'
  | 'policyRate'
  | 'liquidity'
  | 'riskAversion'
  | 'creditSpread'
  | 'oilSupply'
  | 'geopoliticalRisk';

export interface EconomicShock {
  readonly shockId: string;
  readonly sourceEventId: string;
  readonly factor: MacroFactor;
  /** 충격 강도 (-1.0 ~ +1.0) */
  readonly magnitude: number;
  /** 신뢰도 (0.0 ~ 1.0) */
  readonly confidence: number;
  /** 발효 시점 (epoch ms) */
  readonly effectiveFrom: number;
  /** 반감기 (초) */
  readonly halfLifeSeconds: number;
  /** 대상 섹터 (선택적) */
  readonly affectedSectors?: readonly string[];
  /** 대상 자산 (선택적) */
  readonly affectedAssets?: readonly string[];
}

export interface MacroStateParameters {
  /** 각 변수별 평균회귀 속도 (연율화 kappa) */
  readonly meanReversionSpeed: Record<keyof Omit<MacroState, 'timestamp' | 'version' | 'realRate'>, number>;
  /** 각 변수별 장기 정상 균형점 (baseline) */
  readonly baseline: Record<keyof Omit<MacroState, 'timestamp' | 'version' | 'realRate'>, number>;
}

export interface ObservableMacroState {
  readonly state: MacroState;
  readonly values: Record<string, number>;
  readonly confidences: Record<string, number>;
  readonly effectiveRegime?: string;
}
