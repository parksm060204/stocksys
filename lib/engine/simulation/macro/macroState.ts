/**
 * STOCKSYS Macroeconomic State Engine & Pure Analytical Functions
 *
 * - 공통 거시 상태 초기화 및 결정론적 전진 함수
 * - 시장 이벤트를 명시적 경제 충격(EconomicShock)으로 변환 (MacroImpactDescriptor 기반)
 * - 충격 반감기 감쇠, Ornstein-Uhlenbeck 평균회귀 순수 분석적 상태 전진
 * - 시간 의미 일관성: 큰 한 스텝과 여러 작은 스텝이 경제적으로 동등한 결과 도출
 * - 멱등성 및 중복 배제: 동일 사건/재조회로 인한 중복 충격 누적 원천 차단
 * - 100% 비결정론 배제: 동일 입력 및 시계열에 동일 MacroState 보장
 */

import { ObservableMarketEvent } from '../marketEventTypes';
import {
  EconomicShock,
  MacroFactor,
  MacroState,
  MacroStateParameters,
  ObservableMacroState,
} from './macroTypes';

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
 * 팩터별 경제적 스케일 (충격 magnitude 1.0 시의 표준 경제 변화량)
 */
export const FACTOR_SHOCK_SCALES: Readonly<Record<MacroFactor, number>> = {
  growth: 0.020,            // 연율 2.0%p 성장 충격
  inflation: 0.020,         // 연율 2.0%p 인플레이션 충격
  policyRate: 0.025,        // 250 bps 정책금리 충격
  liquidity: 0.30,          // 유동성 지수 0.30 충격
  riskAversion: 0.35,       // 위험회피 0.35 충격
  creditSpread: 150.0,      // 회사채 스프레드 150 bps 충격
  oilSupply: 0.40,          // 원유 공급 충격
  geopoliticalRisk: 0.50,   // 지정학적 위험 0.50 충격
};

/**
 * 순수 함수: 시장 이벤트(ObservableMarketEvent)를 명시적 구조화 경제 충격 목록으로 변환합니다.
 *
 * 필수 정책:
 * - valuationSignal은 주식·섹터 가치평가 신호로만 사용한다.
 * - 거시 팩터 방향은 명시적 MacroImpactDescriptor에서만 가져온다.
 * - 개별 주식·섹터 이벤트는 명시적 거시 효과가 없으면 전역 MacroState를 변경하지 않는다.
 * - 알 수 없는 이벤트를 자동으로 growth 충격으로 처리하지 않는다.
 * - 거시 효과가 없는 이벤트는 빈 충격 목록으로 fail-closed 처리한다.
 */
export function convertEventToEconomicShocks(event: ObservableMarketEvent): EconomicShock[] {
  if (!event || typeof event.eventId !== 'string') return [];

  // 명시적 macroImpacts 디스크립터가 지정된 경우에만 거시 충격으로 변환
  if (Array.isArray(event.macroImpacts) && event.macroImpacts.length > 0) {
    const shocks: EconomicShock[] = [];
    for (let i = 0; i < event.macroImpacts.length; i++) {
      const imp = event.macroImpacts[i];
      if (!imp || !imp.factor || (imp.direction !== -1 && imp.direction !== 1)) continue;
      if (typeof imp.magnitude !== 'number' || !Number.isFinite(imp.magnitude) || imp.magnitude <= 0) continue;
      if (imp.halfLifeSeconds !== undefined && (!Number.isFinite(imp.halfLifeSeconds) || imp.halfLifeSeconds <= 0)) continue;

      const magnitude = Math.min(1.0, Math.max(0.0, imp.magnitude));
      const confidence = typeof imp.confidence === 'number' && Number.isFinite(imp.confidence)
        ? Math.max(0.0, Math.min(1.0, imp.confidence))
        : Math.max(0.0, Math.min(1.0, event.confidence ?? 0.8));
      const halfLifeSeconds = typeof imp.halfLifeSeconds === 'number' && Number.isFinite(imp.halfLifeSeconds) && imp.halfLifeSeconds > 0
        ? imp.halfLifeSeconds
        : Math.max(1, event.halfLife ?? 300);

      shocks.push({
        shockId: `shock_${event.eventId}_${imp.factor}_${i}`,
        sourceEventId: event.eventId,
        factor: imp.factor,
        direction: imp.direction,
        magnitude,
        confidence,
        effectiveFrom: event.effectiveFrom,
        halfLifeSeconds,
        affectedSectors: imp.affectedSectors ?? (event.sectorId ? [event.sectorId] : undefined),
        affectedAssets: imp.affectedAssets ?? (event.targetStockIds && event.targetStockIds.length > 0 ? [...event.targetStockIds] : undefined),
      });
    }
    return shocks;
  }

  // 명시적 거시 효과가 없는 이벤트는 빈 충격 목록으로 fail-closed
  return [];
}

/**
 * 하위 호환성 단일 충격 변환기 (첫 번째 충격 반환 또는 null)
 */
export function convertEventToEconomicShock(event: ObservableMarketEvent): EconomicShock | null {
  const shocks = convertEventToEconomicShocks(event);
  return shocks.length > 0 ? shocks[0] : null;
}

/**
 * 순수 함수: 관측 가능한 시장 이벤트 목록에서 정정 정책(RETRACT, REPLACE, ADDITIVE)을 적용하여
 * 현재 시점에 유효한 경제 충격(EconomicShock) 목록을 결정론적으로 추출합니다.
 */
export function extractEffectiveEconomicShocks(
  events: readonly ObservableMarketEvent[],
  simTime: number
): EconomicShock[] {
  if (!events || events.length === 0 || !Number.isFinite(simTime)) return [];

  // 1. 이벤트 멱등성 보장 (eventId 기반 중복 제거)
  const uniqueEventsMap = new Map<string, ObservableMarketEvent>();
  for (const ev of events) {
    if (ev && typeof ev.eventId === 'string' && !uniqueEventsMap.has(ev.eventId)) {
      uniqueEventsMap.set(ev.eventId, ev);
    }
  }

  // 2. 발효 시점 필터링 (publishedAt <= simTime && effectiveFrom <= simTime)
  const effectiveEvents = Array.from(uniqueEventsMap.values()).filter(
    (e) =>
      Number.isFinite(e.publishedAt) &&
      e.publishedAt <= simTime &&
      Number.isFinite(e.effectiveFrom) &&
      e.effectiveFrom <= simTime
  );
  if (effectiveEvents.length === 0) return [];

  // 3. 정정 이벤트(CORRECTION) 그룹화 및 결정론적 정렬
  const correctionsByOriginalId = new Map<string, ObservableMarketEvent[]>();
  for (const ev of effectiveEvents) {
    if (ev.eventType === 'CORRECTION' && ev.originalEventId) {
      const list = correctionsByOriginalId.get(ev.originalEventId) ?? [];
      list.push(ev);
      correctionsByOriginalId.set(ev.originalEventId, list);
    }
  }

  // 정정 결정론적 승자 선정: effectiveFrom ASC -> publishedAt ASC -> sequence ASC -> eventId ASC
  const winningCorrectionByOriginalId = new Map<string, ObservableMarketEvent>();
  for (const [origId, corrList] of correctionsByOriginalId.entries()) {
    corrList.sort((a, b) => {
      if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom - b.effectiveFrom;
      if (a.publishedAt !== b.publishedAt) return a.publishedAt - b.publishedAt;
      const seqA = a.sequence ?? 0;
      const seqB = b.sequence ?? 0;
      if (seqA !== seqB) return seqA - seqB;
      return a.eventId.localeCompare(b.eventId);
    });
    winningCorrectionByOriginalId.set(origId, corrList[corrList.length - 1]);
  }

  const resultShocks: EconomicShock[] = [];
  const processedShockIds = new Set<string>();

  for (const ev of effectiveEvents) {
    // A. 원본 루머 처리
    if (ev.eventType === 'RUMOR') {
      const winningCorr = winningCorrectionByOriginalId.get(ev.eventId);
      if (winningCorr) {
        const mode = winningCorr.correctionMode ?? 'RETRACT';
        // RETRACT, REPLACE: 원본 루머의 거시 충격 기여도 완전 제거
        if (mode === 'RETRACT' || mode === 'REPLACE') {
          continue;
        }
        // ADDITIVE: 원본 루머 유지
      }
    }

    // B. 정정 이벤트 처리
    if (ev.eventType === 'CORRECTION') {
      if (ev.originalEventId) {
        const winningCorr = winningCorrectionByOriginalId.get(ev.originalEventId);
        if (winningCorr && winningCorr.eventId !== ev.eventId) {
          continue; // 최신 정정이 아니면 무시
        }
      }
      const mode = ev.correctionMode ?? 'RETRACT';
      if (mode === 'RETRACT') {
        // RETRACT는 원본 무효화만 수행하며, 자체 거시 충격은 미반영
        continue;
      }
      // REPLACE, ADDITIVE: 정정 이벤트의 거시 충격 반영
    }

    const eventShocks = convertEventToEconomicShocks(ev);
    for (const shock of eventShocks) {
      if (!processedShockIds.has(shock.shockId)) {
        processedShockIds.add(shock.shockId);
        resultShocks.push(shock);
      }
    }
  }

  return resultShocks;
}

/**
 * 특정 시점 timeMs에서 유효한 충격들의 순 팩터별 영향도 계산 (순수 함수)
 */
function computeFactorShockLevels(
  shocks: readonly EconomicShock[],
  timeMs: number
): Record<MacroFactor, number> {
  const levels: Record<MacroFactor, number> = {
    growth: 0,
    inflation: 0,
    policyRate: 0,
    liquidity: 0,
    riskAversion: 0,
    creditSpread: 0,
    oilSupply: 0,
    geopoliticalRisk: 0,
  };

  const seenKeys = new Set<string>();

  for (const shock of shocks) {
    if (!shock || shock.effectiveFrom > timeMs) continue;

    // 입력 유효성 검증: NaN, Infinity, 음수 반감기, 잘못된 강도 배제
    if (!Number.isFinite(shock.magnitude) || shock.magnitude < 0 || shock.magnitude > 1) continue;
    if (!Number.isFinite(shock.confidence) || shock.confidence < 0 || shock.confidence > 1) continue;
    if (shock.direction !== 1 && shock.direction !== -1) continue;
    if (!Number.isFinite(shock.halfLifeSeconds) || shock.halfLifeSeconds <= 0) continue;

    const dedupeKey = `${shock.sourceEventId || shock.shockId}_${shock.factor}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    const elapsedSec = Math.max(0, (timeMs - shock.effectiveFrom) / 1000);
    const decay = Math.pow(2, -elapsedSec / shock.halfLifeSeconds);
    const scale = FACTOR_SHOCK_SCALES[shock.factor] ?? 1.0;
    const impact = shock.direction * shock.magnitude * shock.confidence * decay * scale;

    levels[shock.factor] = (levels[shock.factor] || 0) + impact;
  }

  return levels;
}

/**
 * 팩터 간 상호 피드백 계산 (테일러 준칙, 인플레-원유, 신용-위험회피 등)
 */
function computeMacroFeedbacks(
  factorShocks: Record<MacroFactor, number>,
  baseline: MacroStateParameters['baseline']
): {
  taylorRateFeedback: number;
  oilInflationFeedback: number;
  curveSlopeFeedback: number;
  creditFeedback: number;
  liquidityFeedback: number;
  riskAversionFeedback: number;
  dollarFeedback: number;
  commodityDemandFeedback: number;
  uncertaintyLevel: number;
} {
  const oilInflationFeedback = 0.25 * factorShocks.oilSupply;
  const netInflationShock = factorShocks.inflation + oilInflationFeedback;

  const taylorPressure = 0.5 * netInflationShock + 0.5 * factorShocks.growth;
  const taylorRateFeedback = 0.25 * taylorPressure;

  const curveSlopeFeedback = factorShocks.growth * 15.0 - factorShocks.policyRate * 25.0;
  const creditFeedback = factorShocks.riskAversion * 30.0 - factorShocks.liquidity * 20.0;
  const liquidityFeedback = -factorShocks.policyRate * 0.15 - (factorShocks.creditSpread / 1000.0);
  const riskAversionFeedback = factorShocks.geopoliticalRisk * 0.25 - factorShocks.growth * 0.10;
  const dollarFeedback = factorShocks.policyRate * 3.0 + factorShocks.riskAversion * 2.0;
  const commodityDemandFeedback = factorShocks.growth * 1.0 - dollarFeedback * 0.005;

  const totalAbsShocks = Object.values(factorShocks).reduce((sum, v) => sum + Math.abs(v), 0);
  const uncertaintyLevel = Math.min(0.50, totalAbsShocks * 0.5);

  return {
    taylorRateFeedback,
    oilInflationFeedback,
    curveSlopeFeedback,
    creditFeedback,
    liquidityFeedback,
    riskAversionFeedback,
    dollarFeedback,
    commodityDemandFeedback,
    uncertaintyLevel,
  };
}

/**
 * 순수 함수: 이전 거시 상태와 유효한 경제 충격 목록, 경과 시간을 기반으로 다음 거시 상태를 결정론적으로 산출합니다.
 *
 * 시간 일관성 불변식:
 * - 10초 1회 전진 결과 ≈ 1초 10회 전진 결과 (수학적 지수 전이 동등성)
 * - 동일 eventId/shockId 중복 입력 시 단 1회만 반영 (멱등성)
 * - 반감기 경과 시 정확히 50% 감쇠
 * - 충격 종료/감소 후 baseline으로 평균회귀
 */
export function advanceMacroState(
  prevState: MacroState,
  shocks: readonly EconomicShock[],
  dtSeconds: number,
  simTime: number,
  params: MacroStateParameters = DEFAULT_MACRO_PARAMETERS
): MacroState {
  if (dtSeconds <= 0 && prevState.version > 1) {
    return { ...prevState, timestamp: simTime };
  }

  const initTimestamp = prevState.initialTimestamp ?? (prevState.timestamp || 0);
  const initVals = prevState.initialValues ?? {
    growth: prevState.growth,
    inflation: prevState.inflation,
    policyRate: prevState.policyRate,
    yieldCurveSlope: prevState.yieldCurveSlope,
    creditSpread: prevState.creditSpread,
    liquidity: prevState.liquidity,
    riskAversion: prevState.riskAversion,
    fxDollarStrength: prevState.fxDollarStrength,
    commodityDemand: prevState.commodityDemand,
    geopoliticalRisk: prevState.geopoliticalRisk,
    uncertainty: prevState.uncertainty,
  };

  const elapsedSec = Math.max(0, (simTime - initTimestamp) / 1000);

  // 1. 현재 시점의 충격 레벨 및 거시 피드백 산출
  const currShocks = computeFactorShockLevels(shocks, simTime);
  const currFeedbacks = computeMacroFeedbacks(currShocks, params.baseline);

  // 2. 초기 내생적 편차의 지수 평균회귀 및 외생적 충격 결합 계산
  const evolveVariable = (
    baseVal: number,
    initVal: number,
    currShockVal: number,
    kappa: number
  ): number => {
    const initEndogenous = initVal - baseVal;
    const currEndogenous = initEndogenous * Math.exp(-kappa * elapsedSec);
    return baseVal + currEndogenous + currShockVal;
  };

  // 성장률
  const nextGrowth = Math.max(
    -0.05,
    Math.min(
      0.10,
      evolveVariable(
        params.baseline.growth,
        initVals.growth,
        currShocks.growth,
        params.meanReversionSpeed.growth
      )
    )
  );

  // 인플레이션 (원유 피드백 포함)
  const nextInflation = Math.max(
    -0.02,
    Math.min(
      0.15,
      evolveVariable(
        params.baseline.inflation,
        initVals.inflation,
        currShocks.inflation + currFeedbacks.oilInflationFeedback,
        params.meanReversionSpeed.inflation
      )
    )
  );

  // 정책금리 (테일러 피드백 포함)
  const nextPolicyRate = Math.max(
    0.0,
    Math.min(
      0.20,
      evolveVariable(
        params.baseline.policyRate,
        initVals.policyRate,
        currShocks.policyRate + currFeedbacks.taylorRateFeedback,
        params.meanReversionSpeed.policyRate
      )
    )
  );

  // 실질금리 = 정책금리 - 인플레이션
  const nextRealRate = nextPolicyRate - nextInflation;

  // 수익률 곡선 기울기
  const nextYieldCurveSlope = Math.max(
    -150.0,
    Math.min(
      250.0,
      evolveVariable(
        params.baseline.yieldCurveSlope,
        initVals.yieldCurveSlope,
        currFeedbacks.curveSlopeFeedback,
        params.meanReversionSpeed.yieldCurveSlope
      )
    )
  );

  // 신용 스프레드
  const nextCreditSpread = Math.max(
    30.0,
    Math.min(
      800.0,
      evolveVariable(
        params.baseline.creditSpread,
        initVals.creditSpread,
        currShocks.creditSpread + currFeedbacks.creditFeedback,
        params.meanReversionSpeed.creditSpread
      )
    )
  );

  // 유동성
  const nextLiquidity = Math.max(
    0.05,
    Math.min(
      1.0,
      evolveVariable(
        params.baseline.liquidity,
        initVals.liquidity,
        currShocks.liquidity + currFeedbacks.liquidityFeedback,
        params.meanReversionSpeed.liquidity
      )
    )
  );

  // 위험회피
  const nextRiskAversion = Math.max(
    0.05,
    Math.min(
      1.0,
      evolveVariable(
        params.baseline.riskAversion,
        initVals.riskAversion,
        currShocks.riskAversion + currFeedbacks.riskAversionFeedback,
        params.meanReversionSpeed.riskAversion
      )
    )
  );

  // 달러 강도
  const nextDollar = Math.max(
    70.0,
    Math.min(
      140.0,
      evolveVariable(
        params.baseline.fxDollarStrength,
        initVals.fxDollarStrength,
        currFeedbacks.dollarFeedback,
        params.meanReversionSpeed.fxDollarStrength
      )
    )
  );

  // 원자재 실물 수요
  const nextCommodityDemand = Math.max(
    0.2,
    Math.min(
      3.0,
      evolveVariable(
        params.baseline.commodityDemand,
        initVals.commodityDemand,
        currFeedbacks.commodityDemandFeedback,
        params.meanReversionSpeed.commodityDemand
      )
    )
  );

  // 지정학적 위험
  const nextGeopolitical = Math.max(
    0.0,
    Math.min(
      1.0,
      evolveVariable(
        params.baseline.geopoliticalRisk,
        initVals.geopoliticalRisk,
        currShocks.geopoliticalRisk,
        params.meanReversionSpeed.geopoliticalRisk
      )
    )
  );

  // 거시 불확실성
  const nextUncertainty = Math.max(
    0.01,
    Math.min(
      1.0,
      evolveVariable(
        params.baseline.uncertainty,
        initVals.uncertainty,
        currFeedbacks.uncertaintyLevel,
        params.meanReversionSpeed.uncertainty
      )
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
    initialTimestamp: initTimestamp,
    initialValues: initVals,
  };
}

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
