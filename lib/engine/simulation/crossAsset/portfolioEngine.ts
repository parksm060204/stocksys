/**
 * STOCKSYS Cross-Asset Portfolio Allocation & Execution Adapter
 *
 * - 에이전트 이질성(AgentMacroProfile) 및 거시/미시 민감도 기반 신호 해석
 * - 공통 요인 노출(Common Factor Exposure: 금리, 성장, 원자재 Beta) 반복 수렴 캡핑
 * - 캡핑 후 최종 비중 기반 요인 노출 재계산 및 불변식 보장
 * - 단일 자산/섹터 집중도 한도 및 최소 현금 버퍼 제약
 * - 실제 거래 엔진 지원 여부 검증 및 Fail-Closed 실행 어댑터
 * - 임의의 50,000 fallback 완전 배제: 결측/비정상 가격 fail-closed 보류
 * - 미체결 매수/매도 예약 자산을 반영한 가용 자금/수량 정합성 준수
 */

import { AgentOrderIntent } from '../agentTypes';
import {
  AgentMacroProfile,
  AssetClass,
  CrossAssetSignal,
  PortfolioAllocationResult,
  TargetExposure,
} from './crossAssetTypes';

export interface CurrentHoldingSnapshot {
  readonly assetId: string;
  readonly assetClass: AssetClass;
  readonly sectorId?: string;
  readonly quantity: number;
  readonly currentPrice: number;
  readonly availableHolding?: number; // 미체결 매도 주문 예약 수량을 제외한 실제 매도 가능 수량
}

export interface PortfolioEngineInput {
  readonly agentProfile: AgentMacroProfile;
  readonly nav: number;
  readonly availableCash: number; // 미체결 매수 주문 예약금을 제외한 실제 가용 현금
  readonly signals: ReadonlyMap<string, CrossAssetSignal>;
  readonly currentHoldings: readonly CurrentHoldingSnapshot[];
  readonly assetMetadata: ReadonlyMap<string, { sectorId?: string; tickSize?: number; minOrderSize?: number }>;
  readonly currentPrices?: ReadonlyMap<string, number>;
  readonly simulationTime: number;
}

export interface ExecutionSupportCheck {
  readonly supported: boolean;
  readonly reason?: string;
}

/**
 * 에이전트 거시 프로필 유효성 검증
 */
export function validateAgentMacroProfile(profile: AgentMacroProfile): string | null {
  if (!profile || typeof profile.agentId !== 'string') return 'agentId is required';
  for (const [key, val] of [
    ['macroSensitivity', profile.macroSensitivity],
    ['microSensitivity', profile.microSensitivity],
    ['riskAversion', profile.riskAversion],
    ['maxAssetConcentration', profile.maxAssetConcentration],
    ['maxSectorConcentration', profile.maxSectorConcentration],
    ['minCashBuffer', profile.minCashBuffer],
    ['rateBeta', profile.maxFactorExposure?.rateBeta],
    ['growthBeta', profile.maxFactorExposure?.growthBeta],
    ['commodityBeta', profile.maxFactorExposure?.commodityBeta],
  ] as const) {
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
      return `${key} must be a non-negative finite number`;
    }
  }
  if (profile.maxAssetConcentration > 1.0) return 'maxAssetConcentration cannot exceed 1.0';
  if (profile.maxSectorConcentration > 1.0) return 'maxSectorConcentration cannot exceed 1.0';
  if (profile.minCashBuffer >= 1.0) return 'minCashBuffer must be strictly less than 1.0';
  return null;
}

/**
 * 자산별 거래 엔진 지원 여부 판정 (Fail-closed)
 * - 현재 주식(STOCK)은 호가창 및 원자적 체결 엔진 지원
 * - 채권(BOND), 원자재(COMMODITY), 옵션(OPTION)은 독립 체결 어댑터 부재 시 안전하게 보류
 */
export function checkAssetExecutionSupport(
  assetClass: AssetClass,
  _assetId: string
): ExecutionSupportCheck {
  if (assetClass === 'STOCK') {
    return { supported: true };
  }
  // 거래 엔진이 완전하지 않은 자산군은 fail-closed 보류
  return {
    supported: false,
    reason: `EXECUTION_NOT_SUPPORTED_FOR_${assetClass}`,
  };
}

/**
 * 순수 함수: 교차자산 신호와 에이전트 프로필, 위험 한도를 결합하여 포트폴리오 목표 배분을 산출합니다.
 */
export function computePortfolioAllocation(
  input: PortfolioEngineInput
): PortfolioAllocationResult {
  const { agentProfile, nav, availableCash, signals, currentHoldings, assetMetadata, currentPrices, simulationTime } = input;

  const targetAllocations: TargetExposure[] = [];
  const heldReasons: Record<string, string> = {};
  const currentHoldingMap = new Map(currentHoldings.map((h) => [h.assetId, h]));

  const profileErr = validateAgentMacroProfile(agentProfile);
  if (profileErr) {
    return {
      accountId: agentProfile?.agentId || 'unknown',
      simulationTime,
      totalNav: nav,
      availableCash,
      targetAllocations: [],
      aggregateFactorExposure: { rateBeta: 0, growthBeta: 0, commodityBeta: 0 },
      heldReasons: { all: `INVALID_PROFILE: ${profileErr}` },
      converged: false,
      appliedConstraints: [],
    };
  }

  if (!Number.isFinite(nav) || nav <= 0) {
    return {
      accountId: agentProfile.agentId,
      simulationTime,
      totalNav: 0,
      availableCash: 0,
      targetAllocations: [],
      aggregateFactorExposure: { rateBeta: 0, growthBeta: 0, commodityBeta: 0 },
      heldReasons: { all: 'NAV_NON_POSITIVE' },
      converged: false,
      appliedConstraints: [],
    };
  }

  // 1. 에이전트 주관적 기대 점수 및 비제약 목표 비중(Unconstrained Target) 산출
  interface CandidateWeight {
    assetId: string;
    assetClass: AssetClass;
    sectorId?: string;
    unconstrainedWeight: number;
    constrainedWeight: number;
    price: number;
    signal: CrossAssetSignal;
    constraints: string[];
  }

  const candidates: CandidateWeight[] = [];
  let totalPositiveWeight = 0;

  for (const [assetId, signal] of signals.entries()) {
    const meta = assetMetadata.get(assetId);
    const holding = currentHoldingMap.get(assetId);
    // 임의의 50,000 fallback 제거: 실제 가격 맵 또는 보유 스냅샷의 현재가만 허용
    const rawPrice = currentPrices?.get(assetId) ?? holding?.currentPrice;
    if (typeof rawPrice !== 'number' || !Number.isFinite(rawPrice) || rawPrice <= 0) {
      heldReasons[assetId] = 'INVALID_OR_MISSING_PRICE';
      continue;
    }
    const price = rawPrice;

    // 거시 및 미시 민감도 정규화 결합
    const totalSens = agentProfile.macroSensitivity + agentProfile.microSensitivity;
    const normMacroWeight = totalSens > 0 ? agentProfile.macroSensitivity / totalSens : 0.5;
    const effectiveDirection = signal.direction * normMacroWeight * signal.confidence;

    // 데드밴드: 방향성 점수가 미미하면 패스
    if (Math.abs(effectiveDirection) < 0.05) {
      heldReasons[assetId] = 'WITHIN_SIGNAL_DEADBAND';
      continue;
    }

    // 기본 비제약 목표 비중 (신호 강도 비례, 최대 집중도 범위 내)
    let rawWeight = Math.max(0, effectiveDirection * agentProfile.maxAssetConcentration);

    // 위험회피 성향에 따른 변동성 역비례 패널티
    if (signal.expectedVolatility > 0) {
      const volDiscount = Math.max(0.2, 1.0 - (signal.expectedVolatility - 0.15) * agentProfile.riskAversion);
      rawWeight *= volDiscount;
    }

    candidates.push({
      assetId,
      assetClass: signal.assetClass,
      sectorId: meta?.sectorId,
      unconstrainedWeight: Number(rawWeight.toFixed(4)),
      constrainedWeight: Number(rawWeight.toFixed(4)),
      price,
      signal,
      constraints: [],
    });

    totalPositiveWeight += rawWeight;
  }

  // 자산 입력 순서에 무관한 결정론적 불변성 보장을 위해 assetId 기준 사전 정렬
  candidates.sort((a, b) => a.assetId.localeCompare(b.assetId));

  // 2. 반복 수렴 캡핑: 공통 요인 노출(금리, 성장, 원자재 Beta) + 단일 자산/섹터 집중도 + 최소 현금 버퍼
  const maxIterations = 20;
  const EPS = 1e-4;
  let converged = false;
  const appliedConstraintsSet = new Set<string>();

  for (let iter = 0; iter < maxIterations; iter++) {
    // 2.1 전체 현금 버퍼 한도 검사 및 스케일링
    let totalInvested = 0;
    for (const c of candidates) {
      totalInvested += c.constrainedWeight;
    }
    const maxTotalInvestable = Math.max(0.0, 1.0 - agentProfile.minCashBuffer);
    if (totalInvested > maxTotalInvestable + EPS && totalInvested > 0) {
      const scale = maxTotalInvestable / totalInvested;
      for (const c of candidates) {
        c.constrainedWeight *= scale;
        if (!c.constraints.includes('CASH_BUFFER_CAPPED')) c.constraints.push('CASH_BUFFER_CAPPED');
        appliedConstraintsSet.add('CASH_BUFFER_CAPPED');
      }
    }

    // 2.2 단일 자산 집중도 한도 검사
    for (const c of candidates) {
      if (c.constrainedWeight > agentProfile.maxAssetConcentration + EPS) {
        c.constrainedWeight = agentProfile.maxAssetConcentration;
        if (!c.constraints.includes('SINGLE_ASSET_CAP_EXCEEDED')) c.constraints.push('SINGLE_ASSET_CAP_EXCEEDED');
        appliedConstraintsSet.add('SINGLE_ASSET_CAP_EXCEEDED');
      }
    }

    // 2.3 섹터별 집중도 한도 검사
    const sectorWeights = new Map<string, number>();
    for (const c of candidates) {
      const sec = c.sectorId || 'unknown';
      sectorWeights.set(sec, (sectorWeights.get(sec) || 0) + c.constrainedWeight);
    }
    for (const [sec, secWeight] of sectorWeights.entries()) {
      if (secWeight > agentProfile.maxSectorConcentration + EPS && secWeight > 0) {
        const secScale = agentProfile.maxSectorConcentration / secWeight;
        for (const c of candidates) {
          if ((c.sectorId || 'unknown') === sec) {
            c.constrainedWeight *= secScale;
            const reason = `SECTOR_CAP_EXCEEDED_${sec.toUpperCase()}`;
            if (!c.constraints.includes(reason)) c.constraints.push(reason);
            appliedConstraintsSet.add(reason);
          }
        }
      }
    }

    // 2.4 공통 요인 노출 계산
    let curRateBeta = 0;
    let curGrowthBeta = 0;
    let curCommBeta = 0;

    for (const c of candidates) {
      const rContrib = Math.abs(c.signal.riskContributions.rates ?? (c.assetClass === 'BOND' ? 0.8 : 0.3));
      const gContrib = Math.abs(c.signal.riskContributions.growth ?? (c.assetClass === 'STOCK' ? 0.7 : 0.1));
      const cContrib = Math.abs(c.signal.riskContributions.commoditySupply ?? (c.assetClass === 'COMMODITY' ? 0.9 : 0.1));

      curRateBeta += c.constrainedWeight * rContrib;
      curGrowthBeta += c.constrainedWeight * gContrib;
      curCommBeta += c.constrainedWeight * cContrib;
    }

    const rateExceeded = curRateBeta > agentProfile.maxFactorExposure.rateBeta + EPS;
    const growthExceeded = curGrowthBeta > agentProfile.maxFactorExposure.growthBeta + EPS;
    const commExceeded = curCommBeta > agentProfile.maxFactorExposure.commodityBeta + EPS;

    // 모든 한도 및 요인 노출 충족 시 즉시 수렴
    if (!rateExceeded && !growthExceeded && !commExceeded) {
      converged = true;
      break;
    }

    // 임의 임계값 배제: 양의 한계 기여(marginal contribution > 0)를 하는 모든 자산을 비례 축소
    // 헤지 자산(기여도 <= 0)은 잘못 축소하지 않음
    let posRateWeight = 0;
    let posGrowthWeight = 0;
    let posCommWeight = 0;

    for (const c of candidates) {
      const rContrib = Math.abs(c.signal.riskContributions.rates ?? (c.assetClass === 'BOND' ? 0.8 : 0.3));
      const gContrib = Math.abs(c.signal.riskContributions.growth ?? (c.assetClass === 'STOCK' ? 0.7 : 0.1));
      const cContrib = Math.abs(c.signal.riskContributions.commoditySupply ?? (c.assetClass === 'COMMODITY' ? 0.9 : 0.1));

      if (rContrib > 0) posRateWeight += c.constrainedWeight * rContrib;
      if (gContrib > 0) posGrowthWeight += c.constrainedWeight * gContrib;
      if (cContrib > 0) posCommWeight += c.constrainedWeight * cContrib;
    }

    const rateScale = rateExceeded && posRateWeight > 0
      ? agentProfile.maxFactorExposure.rateBeta / posRateWeight
      : 1.0;
    const growthScale = growthExceeded && posGrowthWeight > 0
      ? agentProfile.maxFactorExposure.growthBeta / posGrowthWeight
      : 1.0;
    const commScale = commExceeded && posCommWeight > 0
      ? agentProfile.maxFactorExposure.commodityBeta / posCommWeight
      : 1.0;

    for (const c of candidates) {
      const rContrib = Math.abs(c.signal.riskContributions.rates ?? (c.assetClass === 'BOND' ? 0.8 : 0.3));
      const gContrib = Math.abs(c.signal.riskContributions.growth ?? (c.assetClass === 'STOCK' ? 0.7 : 0.1));
      const cContrib = Math.abs(c.signal.riskContributions.commoditySupply ?? (c.assetClass === 'COMMODITY' ? 0.9 : 0.1));

      let assetScale = 1.0;
      if (rateScale < 1.0 && rContrib > 0) {
        assetScale = Math.min(assetScale, rateScale);
        if (!c.constraints.includes('RATE_FACTOR_EXPOSURE_CAPPED')) c.constraints.push('RATE_FACTOR_EXPOSURE_CAPPED');
        appliedConstraintsSet.add('RATE_FACTOR_EXPOSURE_CAPPED');
      }
      if (growthScale < 1.0 && gContrib > 0) {
        assetScale = Math.min(assetScale, growthScale);
        if (!c.constraints.includes('GROWTH_FACTOR_EXPOSURE_CAPPED')) c.constraints.push('GROWTH_FACTOR_EXPOSURE_CAPPED');
        appliedConstraintsSet.add('GROWTH_FACTOR_EXPOSURE_CAPPED');
      }
      if (commScale < 1.0 && cContrib > 0) {
        assetScale = Math.min(assetScale, commScale);
        if (!c.constraints.includes('COMMODITY_FACTOR_EXPOSURE_CAPPED')) c.constraints.push('COMMODITY_FACTOR_EXPOSURE_CAPPED');
        appliedConstraintsSet.add('COMMODITY_FACTOR_EXPOSURE_CAPPED');
      }

      c.constrainedWeight *= assetScale;
    }
  }

  // 3. 최종 불변조건 검증 (NaN, Infinity, 음수 가중치, 현금 버퍼 위반, 미수렴 요인 노출 초과 거부)
  let finalRateBeta = 0;
  let finalGrowthBeta = 0;
  let finalCommBeta = 0;
  let finalTotalWeight = 0;

  for (const c of candidates) {
    if (!Number.isFinite(c.constrainedWeight) || c.constrainedWeight < 0) {
      return {
        accountId: agentProfile.agentId,
        simulationTime,
        totalNav: nav,
        availableCash,
        targetAllocations: [],
        aggregateFactorExposure: { rateBeta: 0, growthBeta: 0, commodityBeta: 0 },
        heldReasons: { all: 'PORTFOLIO_ALLOCATION_FAILED: INVALID_WEIGHT_NON_FINITE_OR_NEGATIVE' },
        converged: false,
        appliedConstraints: Array.from(appliedConstraintsSet),
      };
    }
    const rContrib = Math.abs(c.signal.riskContributions.rates ?? (c.assetClass === 'BOND' ? 0.8 : 0.3));
    const gContrib = Math.abs(c.signal.riskContributions.growth ?? (c.assetClass === 'STOCK' ? 0.7 : 0.1));
    const cContrib = Math.abs(c.signal.riskContributions.commoditySupply ?? (c.assetClass === 'COMMODITY' ? 0.9 : 0.1));

    finalRateBeta += c.constrainedWeight * rContrib;
    finalGrowthBeta += c.constrainedWeight * gContrib;
    finalCommBeta += c.constrainedWeight * cContrib;
    finalTotalWeight += c.constrainedWeight;
  }

  const finalRateOk = finalRateBeta <= agentProfile.maxFactorExposure.rateBeta + EPS;
  const finalGrowthOk = finalGrowthBeta <= agentProfile.maxFactorExposure.growthBeta + EPS;
  const finalCommOk = finalCommBeta <= agentProfile.maxFactorExposure.commodityBeta + EPS;
  const finalCashOk = finalTotalWeight <= (1.0 - agentProfile.minCashBuffer) + EPS;

  if (!converged || !finalRateOk || !finalGrowthOk || !finalCommOk || !finalCashOk) {
    return {
      accountId: agentProfile.agentId,
      simulationTime,
      totalNav: nav,
      availableCash,
      targetAllocations: [],
      aggregateFactorExposure: {
        rateBeta: Number(finalRateBeta.toFixed(4)),
        growthBeta: Number(finalGrowthBeta.toFixed(4)),
        commodityBeta: Number(finalCommBeta.toFixed(4)),
      },
      heldReasons: { all: 'PORTFOLIO_ALLOCATION_FAILED: UNABLE_TO_CONVERGE_CONSTRAINTS' },
      converged: false,
      appliedConstraints: Array.from(appliedConstraintsSet),
    };
  }

  // 4. 최종 목표 수량 및 델타 계산 (실제 유효 가격 기반)
  for (const c of candidates) {
    const currentQty = currentHoldingMap.get(c.assetId)?.quantity ?? 0;
    const targetNotional = nav * c.constrainedWeight;
    const targetQuantity = c.price > 0 ? Math.floor(targetNotional / c.price) : 0;
    const deltaQuantity = targetQuantity - currentQty;

    targetAllocations.push({
      assetId: c.assetId,
      assetClass: c.assetClass,
      targetWeight: Number(c.constrainedWeight.toFixed(4)),
      targetNotional: Math.round(targetNotional),
      targetQuantity,
      deltaQuantity,
      unconstrainedWeight: c.unconstrainedWeight,
      constraintReasons: c.constraints,
    });
  }

  // 5. 캡핑 완료 후 최종 목표 비중 기반 aggregateFactorExposure 정확한 재계산
  let aggregateRateBeta = 0;
  let aggregateGrowthBeta = 0;
  let aggregateCommodityBeta = 0;

  for (const a of targetAllocations) {
    const sig = signals.get(a.assetId);
    const rContrib = Math.abs(sig?.riskContributions.rates ?? (a.assetClass === 'BOND' ? 0.8 : 0.3));
    const gContrib = Math.abs(sig?.riskContributions.growth ?? (a.assetClass === 'STOCK' ? 0.7 : 0.1));
    const cContrib = Math.abs(sig?.riskContributions.commoditySupply ?? (a.assetClass === 'COMMODITY' ? 0.9 : 0.1));

    aggregateRateBeta += a.targetWeight * rContrib;
    aggregateGrowthBeta += a.targetWeight * gContrib;
    aggregateCommodityBeta += a.targetWeight * cContrib;
  }

  return {
    accountId: agentProfile.agentId,
    simulationTime,
    totalNav: nav,
    availableCash,
    targetAllocations,
    aggregateFactorExposure: {
      rateBeta: Number(aggregateRateBeta.toFixed(4)),
      growthBeta: Number(aggregateGrowthBeta.toFixed(4)),
      commodityBeta: Number(aggregateCommodityBeta.toFixed(4)),
    },
    heldReasons,
    converged: true,
    appliedConstraints: Array.from(appliedConstraintsSet),
  };
}

/**
 * 포트폴리오 목표 배분을 실제 주문(AgentOrderIntent)으로 변환하는 실행 어댑터
 * - 지원되지 않는 자산군은 명확한 이유와 함께 fail-closed 처리
 * - 가격 결측/비정상 시 fail-closed 보류
 * - 미체결 매수 주문 예약금 및 수수료(0.25%)를 반영한 가용 현금 내 매수 수량 산출
 * - 미체결 매도 주문 예약 수량을 반영한 가용 보유량 내 매도 수량 산출
 */
export function convertAllocationsToOrderIntents(
  allocations: readonly TargetExposure[],
  availableCash: number,
  currentPrices: ReadonlyMap<string, number>,
  availableHoldingsMap?: ReadonlyMap<string, number>
): {
  intents: AgentOrderIntent[];
  heldIntents: Array<{ assetId: string; reason: string }>;
} {
  const intents: AgentOrderIntent[] = [];
  const heldIntents: Array<{ assetId: string; reason: string }> = [];
  let remainingCash = availableCash;

  for (const alloc of allocations) {
    const execCheck = checkAssetExecutionSupport(alloc.assetClass, alloc.assetId);
    if (!execCheck.supported) {
      heldIntents.push({
        assetId: alloc.assetId,
        reason: execCheck.reason || 'EXECUTION_NOT_SUPPORTED',
      });
      continue;
    }

    const price = currentPrices.get(alloc.assetId);
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) {
      heldIntents.push({
        assetId: alloc.assetId,
        reason: 'INVALID_OR_MISSING_PRICE',
      });
      continue;
    }

    if (alloc.deltaQuantity === 0) {
      continue;
    }

    if (alloc.deltaQuantity > 0) {
      // 매수 의향: 수수료(0.25%)를 감안한 가용 현금 범위 내로 클램핑
      const costPerShare = price * 1.0025;
      if (remainingCash < costPerShare) {
        heldIntents.push({ assetId: alloc.assetId, reason: 'INSUFFICIENT_AVAILABLE_CASH' });
        continue;
      }
      const affordableQty = Math.min(alloc.deltaQuantity, Math.floor(remainingCash / costPerShare));
      if (affordableQty > 0) {
        intents.push({
          action: 'buy',
          stockId: alloc.assetId,
          price,
          size: affordableQty,
          reason: 'cross_asset_target_rebalance',
        });
        remainingCash -= affordableQty * costPerShare;
      }
    } else {
      // 매도 의향: 예약 매도를 제외한 실제 가용 보유량(availableHolding)으로 제한
      const desiredSellQty = Math.abs(alloc.deltaQuantity);
      const availableToSell = availableHoldingsMap?.get(alloc.assetId) ?? desiredSellQty;
      const actualSellQty = Math.min(desiredSellQty, Math.max(0, availableToSell));
      if (actualSellQty > 0) {
        intents.push({
          action: 'sell',
          stockId: alloc.assetId,
          price,
          size: actualSellQty,
          reason: 'cross_asset_target_rebalance',
        });
      } else {
        heldIntents.push({ assetId: alloc.assetId, reason: 'INSUFFICIENT_AVAILABLE_HOLDING' });
      }
    }
  }

  return { intents, heldIntents };
}

/**
 * 에이전트 계정 정보를 기반으로 기본 거시 프로필을 파생합니다.
 */
export function createDefaultMacroProfile(
  agentId: string,
  strategyType: string,
  riskTolerance: number = 0.5
): AgentMacroProfile {
  const riskAversion = Math.max(0.1, (1.0 - riskTolerance) * 2.0);

  if (strategyType === 'value') {
    return {
      agentId,
      strategyType: 'value',
      macroSensitivity: 0.75,
      microSensitivity: 0.25,
      riskAversion,
      maxAssetConcentration: 0.25,
      maxSectorConcentration: 0.40,
      minCashBuffer: 0.15,
      maxFactorExposure: {
        rateBeta: 0.5,
        growthBeta: 0.8,
        commodityBeta: 0.3,
      },
    };
  }

  if (strategyType === 'trend') {
    return {
      agentId,
      strategyType: 'trend',
      macroSensitivity: 0.45,
      microSensitivity: 0.70,
      riskAversion: Math.max(0.1, riskAversion * 0.8),
      maxAssetConcentration: 0.30,
      maxSectorConcentration: 0.50,
      minCashBuffer: 0.10,
      maxFactorExposure: {
        rateBeta: 0.7,
        growthBeta: 0.9,
        commodityBeta: 0.4,
      },
    };
  }

  if (strategyType === 'market_maker' || strategyType === 'lp') {
    return {
      agentId,
      strategyType: 'lp',
      macroSensitivity: 0.20,
      microSensitivity: 0.95,
      riskAversion: Math.max(0.8, riskAversion * 1.5),
      maxAssetConcentration: 0.15,
      maxSectorConcentration: 0.30,
      minCashBuffer: 0.30,
      maxFactorExposure: {
        rateBeta: 0.3,
        growthBeta: 0.3,
        commodityBeta: 0.2,
      },
    };
  }

  return {
    agentId,
    strategyType: 'macro',
    macroSensitivity: 0.60,
    microSensitivity: 0.40,
    riskAversion,
    maxAssetConcentration: 0.25,
    maxSectorConcentration: 0.40,
    minCashBuffer: 0.20,
    maxFactorExposure: {
      rateBeta: 0.5,
      growthBeta: 0.6,
      commodityBeta: 0.3,
    },
  };
}
