/**
 * STOCKSYS Macroeconomic Shock Transmission Engine
 *
 * 경제 상태 및 충격 원인 분기(Cause Discrimination)와 시장별·자산별 전달 경로를 계산하는 순수 모듈.
 * - 단순 고정 규칙이 아닌, 금리 변동 원인(성장 견인 vs 인플레 발작 vs 긴축 쇼크 vs 신용 스트레스) 구분
 * - 시장 국면(MarketRegime)과의 상호작용 반영
 * - 섹터별(기술, 금융, 에너지, 경기소비재 등) 차별화된 거시 민감도 산출
 */

import { MacroState } from '../macro/macroTypes';
import { MarketRegime } from '../regime/regimeTypes';
import { AssetClass, SignalDriver } from './crossAssetTypes';

export type RateEnvironmentType =
  | 'GROWTH_DRIVEN_RISE'     // 성장 호조에 따른 자연스러운 금리 상승 (이익 증가가 할인율 상쇄)
  | 'INFLATION_SHOCK_RISE'   // 인플레이션 쇼크로 인한 금리 급등 (마진 압박 + 밸류에이션 타격)
  | 'POLICY_TIGHTENING_RISE' // 중앙은행 매파적 긴축에 의한 금리 상승 (유동성 위축 + 멀티플 압축)
  | 'CREDIT_STRESS_RISE'     // 신용위험 확대로 인한 스프레드/장기금리 상승 (부도 위험)
  | 'RECESSION_PANIC_FALL'   // 경기 침체 공포로 인한 금리 급락 (실적 악화 > 금리 하락 효과)
  | 'DISINFLATION_EASING_FALL'// 물가 안정에 따른 완화적 금리 하락 (골디락스: 밸류에이션 호재)
  | 'NEUTRAL';

export interface TransmissionContext {
  readonly rateEnv: RateEnvironmentType;
  readonly regime: MarketRegime;
  readonly realRatePressure: number; // 실질금리 부담도 (양수면 할인율 부담, 음수면 완화)
  readonly liquidityConditions: number; // 0.0 (극심한 경색) ~ 1.0 (풍부)
  readonly riskSentiment: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL';
}

/**
 * 거시 상태와 시장 국면으로부터 현재 금리 환경과 위험 센티먼트를 진단합니다.
 */
export function analyzeTransmissionContext(
  macro: MacroState,
  regime: MarketRegime
): TransmissionContext {
  const growthDiff = macro.growth - 0.02;       // baseline 2% 대비
  const inflationDiff = macro.inflation - 0.025; // baseline 2.5% 대비
  const rateDiff = macro.policyRate - 0.035;    // baseline 3.5% 대비
  const creditSpreadDiff = macro.creditSpread - 120.0; // baseline 120bps 대비

  let rateEnv: RateEnvironmentType = 'NEUTRAL';

  if (rateDiff > 0.005) {
    // 금리가 기준선 대비 상승한 상태
    if (creditSpreadDiff > 60.0) {
      rateEnv = 'CREDIT_STRESS_RISE';
    } else if (inflationDiff > 0.010 && growthDiff <= 0) {
      rateEnv = 'INFLATION_SHOCK_RISE';
    } else if (growthDiff > 0.008) {
      rateEnv = 'GROWTH_DRIVEN_RISE';
    } else {
      rateEnv = 'POLICY_TIGHTENING_RISE';
    }
  } else if (rateDiff < -0.005) {
    // 금리가 기준선 대비 하락한 상태
    if (growthDiff < -0.010) {
      rateEnv = 'RECESSION_PANIC_FALL';
    } else {
      rateEnv = 'DISINFLATION_EASING_FALL';
    }
  }

  const realRatePressure = macro.realRate - 0.010; // baseline 실질금리 1.0% 대비
  const liquidityConditions = Math.max(0.0, Math.min(1.0, macro.liquidity));

  let riskSentiment: 'RISK_ON' | 'RISK_OFF' | 'NEUTRAL' = 'NEUTRAL';
  if (macro.riskAversion > 0.50 || regime === 'LIQUIDITY_CRISIS' || regime === 'BEAR') {
    riskSentiment = 'RISK_OFF';
  } else if (macro.riskAversion < 0.25 && (regime === 'BULL' || growthDiff > 0.005)) {
    riskSentiment = 'RISK_ON';
  }

  return {
    rateEnv,
    regime,
    realRatePressure,
    liquidityConditions,
    riskSentiment,
  };
}

/**
 * 주식 섹터별 거시 전달 신호 산출
 */
export function evaluateStockSectorTransmission(
  sectorId: string | undefined,
  macro: MacroState,
  ctx: TransmissionContext
): { expectedReturnDelta: number; drivers: SignalDriver[] } {
  const drivers: SignalDriver[] = [];
  let returnDelta = 0;

  const normalizedSector = (sectorId || 'general').toLowerCase();

  // 1. 공통 성장 요인 전달
  const growthDriver = (macro.growth - 0.02) * 2.5; // 성장 1%p 상승 시 연율 +2.5%p
  returnDelta += growthDriver;
  drivers.push({
    factor: 'macroGrowth',
    contribution: Number(growthDriver.toFixed(4)),
    confidence: 0.85,
    description: `글로벌 성장 기대(${ (macro.growth * 100).toFixed(1) }%)`,
  });

  // 2. 금리 환경 전달 (원인별 분기)
  let rateImpact = 0;
  if (normalizedSector.includes('tech') || normalizedSector.includes('bio') || normalizedSector.includes('growth')) {
    // 기술주/성장주: 할인율에 매우 민감
    if (ctx.rateEnv === 'INFLATION_SHOCK_RISE' || ctx.rateEnv === 'POLICY_TIGHTENING_RISE') {
      rateImpact = -0.06; // 인플레/긴축 금리 상승 시 강한 하락 압력
    } else if (ctx.rateEnv === 'GROWTH_DRIVEN_RISE') {
      rateImpact = -0.01; // 성장 개선에 의한 금리는 실적 기대로 부분 상쇄
    } else if (ctx.rateEnv === 'DISINFLATION_EASING_FALL') {
      rateImpact = +0.08; // 골디락스 금리 하락 시 최대 수혜
    } else if (ctx.rateEnv === 'RECESSION_PANIC_FALL') {
      rateImpact = -0.03; // 불황 금리 하락은 실적 둔화로 인해 약세
    }
  } else if (normalizedSector.includes('finan') || normalizedSector.includes('bank')) {
    // 금융주: 예대마진 및 금리 방향에 양의 연동 (단, 신용위험 스트레스는 제외)
    if (ctx.rateEnv === 'CREDIT_STRESS_RISE') {
      rateImpact = -0.08; // 신용경색 시 부실 위험 급증
    } else if (ctx.rateEnv === 'GROWTH_DRIVEN_RISE' || ctx.rateEnv === 'POLICY_TIGHTENING_RISE') {
      rateImpact = +0.05; // 금리 상승으로 마진 확대
    } else {
      rateImpact = -0.03;
    }
  } else if (normalizedSector.includes('energy') || normalizedSector.includes('oil') || normalizedSector.includes('chem')) {
    // 에너지주: 지정학 리스크로 인한 유가 급등 수혜, 원자재 수요 및 인플레이션에 연동
    const geoOilBenefit = (macro.geopoliticalRisk - 0.10) * 0.12;
    const oilDemandImpact = (macro.commodityDemand - 1.0) * 0.08 + (macro.inflation - 0.025) * 1.5;
    rateImpact = geoOilBenefit + oilDemandImpact;
  } else {
    // 일반 경기소비재/제조업
    rateImpact = -ctx.realRatePressure * 1.5;
  }

  returnDelta += rateImpact;
  drivers.push({
    factor: 'rateEnvironment',
    contribution: Number(rateImpact.toFixed(4)),
    confidence: 0.80,
    description: `금리 환경(${ctx.rateEnv})의 섹터(${normalizedSector}) 전달`,
  });

  // 3. 유동성 및 위험회피 전달
  const liquidityImpact = (ctx.liquidityConditions - 0.70) * 0.05;
  const riskAversionImpact = -(macro.riskAversion - 0.30) * 0.08;
  returnDelta += (liquidityImpact + riskAversionImpact);

  drivers.push({
    factor: 'liquidityRiskAversion',
    contribution: Number((liquidityImpact + riskAversionImpact).toFixed(4)),
    confidence: 0.90,
    description: `시장 유동성(${macro.liquidity.toFixed(2)}) 및 위험회피(${macro.riskAversion.toFixed(2)})`,
  });

  return {
    expectedReturnDelta: Number(returnDelta.toFixed(4)),
    drivers,
  };
}

/**
 * 채권 자산 전달 신호 산출
 */
export function evaluateBondTransmission(
  durationYears: number,
  isSovereign: boolean,
  creditSpreadBps: number,
  macro: MacroState,
  ctx: TransmissionContext
): { expectedReturnDelta: number; drivers: SignalDriver[] } {
  const drivers: SignalDriver[] = [];
  let returnDelta = 0;

  // 1. 듀레이션 기반 금리 변동 손익 (가격 변화 ≈ -Duration * ΔYield)
  // 금리가 1%p(0.01) 오르면 듀레이션 5년 채권은 -5% 가격 변동
  const rateDelta = macro.policyRate - 0.035;
  const durationCapitalGain = -durationYears * rateDelta;
  returnDelta += durationCapitalGain;

  drivers.push({
    factor: 'rateDurationEffect',
    contribution: Number(durationCapitalGain.toFixed(4)),
    confidence: 0.95,
    description: `듀레이션(${durationYears.toFixed(1)}년) 금리 민감도 효과`,
  });

  // 2. 안전자산 선호(Flight to Quality)
  if (isSovereign) {
    // 국채: 위험회피/위기 시 안전자산 프리미엄 매수세 유입
    const safetyPremium = (macro.riskAversion - 0.30) * 0.04 + (ctx.riskSentiment === 'RISK_OFF' ? 0.03 : 0);
    returnDelta += safetyPremium;
    drivers.push({
      factor: 'flightToSafety',
      contribution: Number(safetyPremium.toFixed(4)),
      confidence: 0.85,
      description: '국채 안전자산 선호 유입',
    });
  } else {
    // 회사채: 신용 스프레드 확대 시 가격 하락 손실
    const spreadWidening = (macro.creditSpread - 120.0) / 10000; // bps -> %
    const creditLoss = -durationYears * spreadWidening * 0.5;
    returnDelta += creditLoss;
    drivers.push({
      factor: 'creditSpreadRisk',
      contribution: Number(creditLoss.toFixed(4)),
      confidence: 0.85,
      description: `회사채 신용스프레드(${macro.creditSpread}bps) 변동`,
    });
  }

  return {
    expectedReturnDelta: Number(returnDelta.toFixed(4)),
    drivers,
  };
}

/**
 * 원자재 자산 전달 신호 산출
 */
export function evaluateCommodityTransmission(
  category: 'energy' | 'metals' | 'agriculture' | string,
  macro: MacroState,
  ctx: TransmissionContext
): { expectedReturnDelta: number; drivers: SignalDriver[] } {
  const drivers: SignalDriver[] = [];
  let returnDelta = 0;

  const cat = category.toLowerCase();

  if (cat.includes('energy') || cat.includes('oil')) {
    // 원유: 지정학 위험(+) + 실물성장(+) + 달러강도(-)
    const geoDriver = (macro.geopoliticalRisk - 0.10) * 0.20;
    const growthDriver = (macro.growth - 0.02) * 2.0;
    const dollarDrag = -(macro.fxDollarStrength - 100.0) * 0.002;
    returnDelta = geoDriver + growthDriver + dollarDrag;

    drivers.push({ factor: 'geopoliticalRisk', contribution: Number(geoDriver.toFixed(4)), confidence: 0.80, description: '지정학적 공급 차질 프리미엄' });
    drivers.push({ factor: 'demandGrowth', contribution: Number(growthDriver.toFixed(4)), confidence: 0.75, description: '산업 실물 원유 수요' });
    drivers.push({ factor: 'dollarStrength', contribution: Number(dollarDrag.toFixed(4)), confidence: 0.90, description: '달러 강세 결제 통화 역풍' });
  } else if (cat.includes('gold') || cat.includes('precious')) {
    // 금/귀금속: 실질금리 역비례(-) + 인플레이션 헤지(+) + 안전자산(+)
    const realRateDrag = -(macro.realRate - 0.010) * 4.0;
    const inflHedge = (macro.inflation - 0.025) * 2.5;
    const safeHaven = (macro.riskAversion - 0.30) * 0.10;
    returnDelta = realRateDrag + inflHedge + safeHaven;

    drivers.push({ factor: 'realInterestRate', contribution: Number(realRateDrag.toFixed(4)), confidence: 0.90, description: '무이자 자산으로서 실질금리 기회비용' });
    drivers.push({ factor: 'inflationHedge', contribution: Number(inflHedge.toFixed(4)), confidence: 0.85, description: '인플레이션 헷지 수요' });
    drivers.push({ factor: 'safeHaven', contribution: Number(safeHaven.toFixed(4)), confidence: 0.80, description: '안전자산 수요' });
  } else {
    // 산업용 금속(구리 등): 경기 민감도 주도
    const growthDriver = (macro.growth - 0.02) * 3.0;
    const commDemand = (macro.commodityDemand - 1.0) * 0.10;
    returnDelta = growthDriver + commDemand;
    drivers.push({ factor: 'industrialDemand', contribution: Number((growthDriver + commDemand).toFixed(4)), confidence: 0.80, description: '산업 제조 사이클 수요' });
  }

  return {
    expectedReturnDelta: Number(returnDelta.toFixed(4)),
    drivers,
  };
}

/**
 * 옵션 자산 전달 신호 산출
 */
export function evaluateOptionTransmission(
  optionType: 'CALL' | 'PUT',
  underlyingExpectedReturn: number,
  delta: number,
  impliedVol: number,
  realizedVolEst: number,
  macro: MacroState,
  ctx: TransmissionContext
): { expectedReturnDelta: number; drivers: SignalDriver[] } {
  const drivers: SignalDriver[] = [];
  let returnDelta = 0;

  // 1. 기초자산 방향성 전달: Delta * 기초자산 기대수익
  const directionContribution = delta * underlyingExpectedReturn;
  returnDelta += directionContribution;
  drivers.push({
    factor: 'deltaExposure',
    contribution: Number(directionContribution.toFixed(4)),
    confidence: 0.85,
    description: `기초자산 방향성(Delta: ${delta.toFixed(2)}) 연동`,
  });

  // 2. 변동성 괴리(Volatility Spread): 실현변동성 기대 > IV 이면 롱 옵션 유리, 반대면 숏 옵션 유리
  const volSpread = realizedVolEst - impliedVol;
  const volSpreadImpact = volSpread * 1.5;
  returnDelta += volSpreadImpact;
  drivers.push({
    factor: 'volatilityEdge',
    contribution: Number(volSpreadImpact.toFixed(4)),
    confidence: 0.75,
    description: `변동성 괴리(예상실현: ${(realizedVolEst * 100).toFixed(1)}% vs IV: ${(impliedVol * 100).toFixed(1)}%)`,
  });

  // 3. 위험회피 급등 시 풋옵션 스큐/헤지 프리미엄
  if (optionType === 'PUT' && ctx.riskSentiment === 'RISK_OFF') {
    const putHedgeDemand = (macro.riskAversion - 0.30) * 0.15;
    returnDelta += putHedgeDemand;
    drivers.push({
      factor: 'tailRiskHedging',
      contribution: Number(putHedgeDemand.toFixed(4)),
      confidence: 0.90,
      description: '하방 꼬리위험(Tail-Risk) 풋옵션 보호 수요',
    });
  }

  return {
    expectedReturnDelta: Number(returnDelta.toFixed(4)),
    drivers,
  };
}
