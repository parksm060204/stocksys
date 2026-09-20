/**
 * STOCKSYS Cross-Asset Signals & Portfolio Allocation Types
 *
 * 주식·옵션·채권·원자재 간 교차자산 신호 및 에이전트 포트폴리오 목표 DTO.
 */

export type AssetClass = 'STOCK' | 'OPTION' | 'BOND' | 'COMMODITY';

export interface SignalDriver {
  /** 팩터 명 (예: 'growth', 'inflation', 'policyRate', 'realRate', 'creditSpread', 'orderFlow', 'volatilitySpread' 등) */
  readonly factor: string;
  /** 신호 기여도 (-1.0 ~ +1.0) */
  readonly contribution: number;
  /** 신뢰도 (0.0 ~ 1.0) */
  readonly confidence: number;
  /** 연관 이벤트 ID */
  readonly sourceEventId?: string;
  /** 설명적 텍스트 */
  readonly description?: string;
}

export interface CrossAssetSignal {
  readonly assetId: string;
  readonly ticker: string;
  readonly assetClass: AssetClass;
  /** 종합 방향성 (-1.0: 강력 매도/언더웨이트 ~ +1.0: 강력 매수/오버웨이트) */
  readonly direction: number;
  /** 연율화 기대 수익률 (예: 0.08 = 8%) */
  readonly expectedReturn: number;
  /** 연율화 기대 변동성 (예: 0.20 = 20%) */
  readonly expectedVolatility: number;
  /** 신호 신뢰도 (0.0 ~ 1.0) */
  readonly confidence: number;
  /** 투자 지평 (ms) */
  readonly horizonMs: number;
  /** 유동성/스프레드 패널티 (비용 차감) */
  readonly liquidityPenalty: number;
  /** 요인별 위험 기여도 (예: { rates: 0.4, equityMarket: 0.6 }) */
  readonly riskContributions: Record<string, number>;
  /** 판단을 이끈 주요 드라이버 요인 목록 */
  readonly drivers: readonly SignalDriver[];
}

export interface AgentMacroProfile {
  readonly agentId: string;
  readonly strategyType: 'macro' | 'micro' | 'value' | 'trend' | 'risk_averse' | 'lp';
  /** 거시 정보 민감도 (0.0 ~ 1.0) */
  readonly macroSensitivity: number;
  /** 미시 오더북/스프레드 민감도 (0.0 ~ 1.0) */
  readonly microSensitivity: number;
  /** 위험회피 계수 (Risk Aversion Lambda > 0) */
  readonly riskAversion: number;
  /** 단일 자산 최대 비중 한도 (0.0 ~ 1.0) */
  readonly maxAssetConcentration: number;
  /** 단일 섹터 최대 비중 한도 (0.0 ~ 1.0) */
  readonly maxSectorConcentration: number;
  /** 현금/무위험 자산 최소 확보 비율 (0.0 ~ 1.0) */
  readonly minCashBuffer: number;
  /** 허용 공통 요인 노출 한도 (Factor Exposure Bounds) */
  readonly maxFactorExposure: {
    readonly rateBeta: number;      // 금리 민감도 상한
    readonly growthBeta: number;    // 성장 민감도 상한
    readonly commodityBeta: number; // 원자재 민감도 상한
  };
}

export interface TargetExposure {
  readonly assetId: string;
  readonly assetClass: AssetClass;
  /** 목표 가중치 (NAV 대비 비율 0.0 ~ 1.0) */
  readonly targetWeight: number;
  /** 목표 금액 (원화) */
  readonly targetNotional: number;
  /** 목표 수량 (단위 수) */
  readonly targetQuantity: number;
  /** 현재 수량과의 델타 */
  readonly deltaQuantity: number;
  /** 위험 한도 적용 전 원본 목표 비중 */
  readonly unconstrainedWeight: number;
  /** 제약 조건 적용 이유 (한도 축소 사유 등) */
  readonly constraintReasons: readonly string[];
}

export interface PortfolioAllocationResult {
  readonly accountId: string;
  readonly simulationTime: number;
  readonly totalNav: number;
  readonly availableCash: number;
  readonly targetAllocations: readonly TargetExposure[];
  readonly aggregateFactorExposure: Record<string, number>;
  readonly heldReasons: Record<string, string>;
  readonly converged: boolean;
  readonly appliedConstraints: readonly string[];
}
