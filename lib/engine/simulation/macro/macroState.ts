/**
 * STOCKSYS Macroeconomic State Engine & Pure Analytical Functions
 *
 * - 공통 거시 상태 초기화 및 결정론적 전진 함수
 * - 뉴스/이벤트를 경제 충격(EconomicShock)으로 변환
 * - 충격 반감기 감쇠, 평균회귀(Ornstein-Uhlenbeck) 순수 수학 계산
 * - 100% 비결정론 배제: 동일 입력 및 시계열에 동일 MacroState 보장
 */

import { ObservableMarketEvent } from '../marketEventTypes';
import { EconomicShock, MacroFactor, MacroState, MacroStateParameters, ObservableMacroState } from './macroTypes';

export const DEFAULT_MACRO_STATE: MacroState = {
  growth: 0.02,             // 2.0% 잠재성장률
  inflation: 0.025,         // 2.5% 물가상승률
  policyRate: 0.035,        // 3.5% 기준금리
  realRate: 0.010,          // 1.0% 실질금리 (3.5% - 2.5%)
  yieldCurveSlope: 50.0,    // 10Y - 2Y 스프레드 50 bps
  creditSpread: 120.0,      // 회사채 스프레드 120 bps
  liquidity: 0.70,          // 70% 정상 유동성
  riskAversion: 0.30,       // 30% 위험회피 (중립-안정)
  fxDollarStrength: 100.0,  // DXY 지수 100
  commodityDemand: 1.0,     // 원자재 수요 지수 1.0
  geopoliticalRisk: 0.10,   // 지정학적 리스크 10%
  uncertainty: 0.05,        // 거시 불확실성 5%
  timestamp: 0,
  version: 1,
};

export const DEFAULT_MACRO_PARAMETERS: MacroStateParameters = {
  // 초 단위 평균회귀 속도 kappa (값이 클수록 기준선으로 빠르게 복귀)
  meanReversionSpeed: {
    growth: 0.0005,
    inflation: 0.0003,
    policyRate: 0.0002,
    yieldCurveSlope: 0.0005,
    creditSpread: 0.0008,
    liquidity: 0.0010,
    riskAversion: 0.0015,
    fxDollarStrength: 0.0004,
    commodityDemand: 0.0006,
    geopoliticalRisk: 0.0020,
    uncertainty: 0.0020,
  },
  baseline: {
    growth: 0.02,
    inflation: 0.025,
    policyRate: 0.035,
    yieldCurveSlope: 50.0,
    creditSpread: 120.0,
    liquidity: 0.70,
    riskAversion: 0.30,
    fxDollarStrength: 100.0,
    commodityDemand: 1.0,
    geopoliticalRisk: 0.10,
    uncertainty: 0.05,
  },
};

/**
 * 순수 함수: 시장 이벤트(ObservableMarketEvent)를 구조화된 경제 충격(EconomicShock)으로 변환합니다.
 */
export function convertEventToEconomicShock(event: ObservableMarketEvent): EconomicShock | null {
  if (!event || typeof event.valuationSignal !== 'number') return null;

  const title = (event.title || '').toLowerCase();
  const content = (event.content || '').toLowerCase();
  const text = `${title} ${content}`;

  let factor: MacroFactor = 'growth';

  // 텍스트 및 키워드 기반 거시 요인 분류
  if (text.includes('금리') || text.includes('rate') || text.includes('긴축') || text.includes('인하') || text.includes('fed') || text.includes('기준금리')) {
    factor = 'policyRate';
  } else if (text.includes('물가') || text.includes('cpi') || text.includes('인플레') || text.includes('inflation')) {
    factor = 'inflation';
  } else if (text.includes('유동성') || text.includes('liquidity') || text.includes('신용경색') || text.includes('자금난')) {
    factor = 'liquidity';
  } else if (text.includes('전쟁') || text.includes('분쟁') || text.includes('지정학') || text.includes('제재') || text.includes('sanction') || text.includes('war')) {
    factor = 'geopoliticalRisk';
  } else if (text.includes('유가') || text.includes('원유') || text.includes('oil') || text.includes('opec') || text.includes('원자재')) {
    factor = 'oilSupply';
  } else if (text.includes('공포') || text.includes('패닉') || text.includes('안전자산') || text.includes('위험회피') || text.includes('risk-off')) {
    factor = 'riskAversion';
  } else if (text.includes('부도') || text.includes('스프레드') || text.includes('default') || text.includes('신용')) {
    factor = 'creditSpread';
  } else {
    factor = 'growth';
  }

  // 충격 강도 및 신뢰도 매핑
  const magnitude = Math.max(-1.0, Math.min(1.0, event.valuationSignal));
  const confidence = Math.max(0.0, Math.min(1.0, event.confidence ?? 0.8));
  const halfLifeSeconds = Math.max(1, event.halfLife ?? 300);

  return {
    shockId: `shock_${event.eventId}`,
    sourceEventId: event.eventId,
    factor,
    magnitude,
    confidence,
    effectiveFrom: event.effectiveFrom,
    halfLifeSeconds,
    affectedSectors: event.sectorId ? [event.sectorId] : undefined,
    affectedAssets: event.targetStockIds && event.targetStockIds.length > 0 ? [...event.targetStockIds] : undefined,
  };
}

/**
 * 순수 함수: 이전 거시 상태와 유효한 경제 충격 목록, 경과 시간을 기반으로 다음 거시 상태를 결정론적으로 산출합니다.
 */
export function advanceMacroState(
  prevState: MacroState,
  shocks: readonly EconomicShock[],
  dtSeconds: number,
  simTime: number,
  params: MacroStateParameters = DEFAULT_MACRO_PARAMETERS
): MacroState {
  if (dtSeconds <= 0) {
    return { ...prevState, timestamp: simTime };
  }

  // 1. 유효 충격들의 요인별 가중 합산
  const factorImpacts: Record<MacroFactor, number> = {
    growth: 0,
    inflation: 0,
    policyRate: 0,
    liquidity: 0,
    riskAversion: 0,
    creditSpread: 0,
    oilSupply: 0,
    geopoliticalRisk: 0,
  };

  for (const shock of shocks) {
    if (shock.effectiveFrom > simTime) continue; // 미공개/미발효 충격 엄격 배제

    const elapsedSec = Math.max(0, (simTime - shock.effectiveFrom) / 1000);
    // 지수 감쇠: halfLife 기준 감쇠 계수 = 0.5^(elapsed / halfLife)
    const decay = Math.exp(-Math.LN2 * (elapsedSec / Math.max(1, shock.halfLifeSeconds)));
    const netImpact = shock.magnitude * shock.confidence * decay;

    factorImpacts[shock.factor] = (factorImpacts[shock.factor] || 0) + netImpact;
  }

  // 2. 평균회귀(Ornstein-Uhlenbeck drift) + 신규 충격 누적
  const stepDrift = (
    current: number,
    base: number,
    kappa: number,
    impact: number,
    scale: number = 1.0
  ): number => {
    const reversion = -kappa * (current - base) * dtSeconds;
    const shockDelta = impact * scale;
    return current + reversion + shockDelta;
  };

  // 경제 성장: baseline 2% 기준 ±0.01 범위 충격
  const nextGrowth = Math.max(
    -0.05,
    Math.min(
      0.10,
      stepDrift(prevState.growth, params.baseline.growth, params.meanReversionSpeed.growth, factorImpacts.growth, 0.005 * dtSeconds)
    )
  );

  // 인플레이션: baseline 2.5% 기준 유가 충격 및 인플레 충격 반영
  const combinedInflationShock = factorImpacts.inflation + 0.3 * factorImpacts.oilSupply;
  const nextInflation = Math.max(
    -0.02,
    Math.min(
      0.15,
      stepDrift(prevState.inflation, params.baseline.inflation, params.meanReversionSpeed.inflation, combinedInflationShock, 0.004 * dtSeconds)
    )
  );

  // 정책금리: 테일러 준칙 모티브 (인플레 및 성장 압력에 반응)
  const taylorPressure = 0.5 * (nextInflation - params.baseline.inflation) + 0.5 * (nextGrowth - params.baseline.growth);
  const combinedRateShock = factorImpacts.policyRate + 0.2 * taylorPressure;
  const nextPolicyRate = Math.max(
    0.0,
    Math.min(
      0.20,
      stepDrift(prevState.policyRate, params.baseline.policyRate, params.meanReversionSpeed.policyRate, combinedRateShock, 0.003 * dtSeconds)
    )
  );

  // 실질금리 = 명목 정책금리 - 기대 인플레이션
  const nextRealRate = nextPolicyRate - nextInflation;

  // 수익률곡선 기울기: 성장 기대 시 가팔라짐(Steepening), 긴축 시 평탄화/역전(Inversion)
  const curveSlopeShock = factorImpacts.growth * 20 - factorImpacts.policyRate * 30;
  const nextYieldCurveSlope = Math.max(
    -150.0,
    Math.min(
      250.0,
      stepDrift(prevState.yieldCurveSlope, params.baseline.yieldCurveSlope, params.meanReversionSpeed.yieldCurveSlope, curveSlopeShock, 1.0 * dtSeconds)
    )
  );

  // 신용 스프레드: 위험회피/불황 시 확대, 유동성 완화 시 축소
  const creditShock = factorImpacts.creditSpread + factorImpacts.riskAversion * 40 - factorImpacts.liquidity * 30;
  const nextCreditSpread = Math.max(
    30.0,
    Math.min(
      800.0,
      stepDrift(prevState.creditSpread, params.baseline.creditSpread, params.meanReversionSpeed.creditSpread, creditShock, 2.0 * dtSeconds)
    )
  );

  // 유동성: 긴축/위기 시 위축, 완화 시 풍부
  const liquidityShock = factorImpacts.liquidity - factorImpacts.policyRate * 0.2 - factorImpacts.creditSpread * 0.001;
  const nextLiquidity = Math.max(
    0.05,
    Math.min(
      1.0,
      stepDrift(prevState.liquidity, params.baseline.liquidity, params.meanReversionSpeed.liquidity, liquidityShock, 0.01 * dtSeconds)
    )
  );

  // 위험회피: 지정학/신용위기 시 급등, 성장 시 안정
  const riskAversionShock = factorImpacts.riskAversion + factorImpacts.geopoliticalRisk * 0.3 - factorImpacts.growth * 0.2;
  const nextRiskAversion = Math.max(
    0.05,
    Math.min(
      1.0,
      stepDrift(prevState.riskAversion, params.baseline.riskAversion, params.meanReversionSpeed.riskAversion, riskAversionShock, 0.02 * dtSeconds)
    )
  );

  // 달러 강도: 미국 금리 상승 및 안전자산 선호 시 상승
  const dollarShock = factorImpacts.policyRate * 5 + factorImpacts.riskAversion * 3;
  const nextDollar = Math.max(
    70.0,
    Math.min(
      140.0,
      stepDrift(prevState.fxDollarStrength, params.baseline.fxDollarStrength, params.meanReversionSpeed.fxDollarStrength, dollarShock, 0.2 * dtSeconds)
    )
  );

  // 원자재 수요: 글로벌 성장 시 증가, 달러 강세 시 둔화
  const commShock = factorImpacts.growth * 1.5 - (nextDollar - 100.0) * 0.01;
  const nextCommodityDemand = Math.max(
    0.2,
    Math.min(
      3.0,
      stepDrift(prevState.commodityDemand, params.baseline.commodityDemand, params.meanReversionSpeed.commodityDemand, commShock, 0.02 * dtSeconds)
    )
  );

  // 지정학적 위험
  const nextGeopolitical = Math.max(
    0.0,
    Math.min(
      1.0,
      stepDrift(prevState.geopoliticalRisk, params.baseline.geopoliticalRisk, params.meanReversionSpeed.geopoliticalRisk, factorImpacts.geopoliticalRisk, 0.05 * dtSeconds)
    )
  );

  // 거시 불확실성: 충격의 절대 크기 누적
  const shockMagnitudeSum = Object.values(factorImpacts).reduce((acc, val) => acc + Math.abs(val), 0);
  const nextUncertainty = Math.max(
    0.01,
    Math.min(
      1.0,
      stepDrift(prevState.uncertainty, params.baseline.uncertainty, params.meanReversionSpeed.uncertainty, shockMagnitudeSum, 0.05 * dtSeconds)
    )
  );

  return {
    growth: Number(nextGrowth.toFixed(6)),
    inflation: Number(nextInflation.toFixed(6)),
    policyRate: Number(nextPolicyRate.toFixed(6)),
    realRate: Number(nextRealRate.toFixed(6)),
    yieldCurveSlope: Number(nextYieldCurveSlope.toFixed(2)),
    creditSpread: Number(nextCreditSpread.toFixed(2)),
    liquidity: Number(nextLiquidity.toFixed(4)),
    riskAversion: Number(nextRiskAversion.toFixed(4)),
    fxDollarStrength: Number(nextDollar.toFixed(2)),
    commodityDemand: Number(nextCommodityDemand.toFixed(4)),
    geopoliticalRisk: Number(nextGeopolitical.toFixed(4)),
    uncertainty: Number(nextUncertainty.toFixed(4)),
    timestamp: simTime,
    version: prevState.version + 1,
  };
}

/**
/**
 * 봇 관측용 방어적 복사본 및 관측 DTO 생성
 */
export function createObservableMacroState(
  state: MacroState,
  effectiveRegime?: string,
  estimationNoise?: Partial<Record<keyof Omit<MacroState, 'timestamp' | 'version'>, number>>
): ObservableMacroState {
  const applyNoise = (val: number, key: keyof Omit<MacroState, 'timestamp' | 'version'>): number => {
    const n = estimationNoise?.[key] ?? 0;
    return val + n;
  };

  const growth = applyNoise(state.growth, 'growth');
  const inflation = applyNoise(state.inflation, 'inflation');
  const policyRate = applyNoise(state.policyRate, 'policyRate');
  const realRate = policyRate - inflation;
  const yieldCurveSlope = applyNoise(state.yieldCurveSlope, 'yieldCurveSlope');
  const creditSpread = Math.max(0, applyNoise(state.creditSpread, 'creditSpread'));
  const liquidity = Math.max(0.01, Math.min(1.0, applyNoise(state.liquidity, 'liquidity')));
  const riskAversion = Math.max(0.01, Math.min(1.0, applyNoise(state.riskAversion, 'riskAversion')));
  const fxDollarStrength = Math.max(50, applyNoise(state.fxDollarStrength, 'fxDollarStrength'));
  const commodityDemand = Math.max(0.1, applyNoise(state.commodityDemand, 'commodityDemand'));
  const geopoliticalRisk = Math.max(0.0, Math.min(1.0, applyNoise(state.geopoliticalRisk, 'geopoliticalRisk')));
  const uncertainty = Math.max(0.01, Math.min(1.0, applyNoise(state.uncertainty, 'uncertainty')));

  const observedState: MacroState = {
    growth,
    inflation,
    policyRate,
    realRate,
    yieldCurveSlope,
    creditSpread,
    liquidity,
    riskAversion,
    fxDollarStrength,
    commodityDemand,
    geopoliticalRisk,
    uncertainty,
    timestamp: state.timestamp,
    version: state.version,
  };

  const values: Record<string, number> = {
    growth,
    inflation,
    policyRate,
    realRate,
    yieldCurveSlope,
    creditSpread,
    liquidity,
    riskAversion,
    fxDollarStrength,
    commodityDemand,
    geopoliticalRisk,
    uncertainty,
  };

  // 불확실성에 반비례하는 신뢰도
  const conf = Math.max(0.2, 1.0 - uncertainty * 1.5);
  const confidences: Record<string, number> = {
    growth: conf,
    inflation: conf,
    policyRate: 0.95,
    realRate: conf,
    yieldCurveSlope: 0.95,
    creditSpread: 0.90,
    liquidity: Math.max(0.3, conf * 0.9),
    riskAversion: Math.max(0.3, conf * 0.85),
    fxDollarStrength: 0.98,
    commodityDemand: conf,
    geopoliticalRisk: Math.max(0.3, conf * 0.8),
    uncertainty: conf,
  };

  return {
    state: observedState,
    values,
    confidences,
    effectiveRegime,
  };
}
