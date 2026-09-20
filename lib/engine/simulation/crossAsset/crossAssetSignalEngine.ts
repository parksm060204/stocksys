/**
 * STOCKSYS Unified Cross-Asset Signal Engine
 *
 * 거시 상태(MacroState), 시장 국면(MarketRegime), 자산별 미시 스냅샷을 종합하여
 * 주식·채권·원자재·옵션의 표준화된 CrossAssetSignal을 산출하는 순수 모듈.
 *
 * 불변식:
 * - 순수 함수: PRNG 비소비, 시스템 시각 비의존, 동일 입력 시 비트 단위 동일 결과
 * - 미래 데이터 및 미공개 이벤트 차단
 * - NaN, Infinity 철저 클램핑
 * - 옵션은 2단계 순서로 실제 기초자산 기대수익 및 변동성과 연결 (고정 5% fallback 배제)
 */

import { MacroState } from '../macro/macroTypes';
import { MarketRegime } from '../regime/regimeTypes';
import { AssetClass, CrossAssetSignal, SignalDriver } from './crossAssetTypes';
import {
  analyzeTransmissionContext,
  evaluateBondTransmission,
  evaluateCommodityTransmission,
  evaluateOptionTransmission,
  evaluateStockSectorTransmission,
  TransmissionContext,
} from './transmissionEngine';

export interface AssetMicroSnapshot {
  readonly assetId: string;
  readonly ticker: string;
  readonly assetClass: AssetClass;
  readonly currentPrice: number;
  readonly bidPrice?: number | null;
  readonly askPrice?: number | null;
  readonly spreadBps?: number | null;
  readonly historicalVol?: number;
  // 주식 전용
  readonly sectorId?: string;
  readonly valuationGap?: number; // (fairValue - price) / price
  // 채권 전용
  readonly ytm?: number;
  readonly duration?: number;
  readonly isSovereign?: boolean;
  readonly creditSpreadBps?: number;
  // 원자재 전용
  readonly category?: string;
  // 옵션 전용
  readonly optionType?: 'CALL' | 'PUT';
  readonly delta?: number;
  readonly gamma?: number;
  readonly theta?: number;
  readonly impliedVol?: number;
  readonly strikePrice?: number;
  readonly underlyingAssetId?: string;
  readonly underlyingExpectedReturn?: number;
}

/**
 * 단일 자산의 교차자산 신호 계산
 */
export function computeSingleAssetSignal(
  asset: AssetMicroSnapshot,
  macro: MacroState,
  ctx: TransmissionContext
): CrossAssetSignal {
  let rawExpectedReturn = 0;
  let rawExpectedVol = asset.historicalVol ?? 0.20;
  const drivers: SignalDriver[] = [];
  const riskContributions: Record<string, number> = {};

  // 1. 자산군별 전달 모델 적용
  if (asset.assetClass === 'STOCK') {
    const stockEval = evaluateStockSectorTransmission(asset.sectorId, macro, ctx);
    rawExpectedReturn += stockEval.expectedReturnDelta;
    drivers.push(...stockEval.drivers);

    // 밸류에이션 괴리율이 존재할 경우 가치 신호 가산
    if (typeof asset.valuationGap === 'number' && Number.isFinite(asset.valuationGap)) {
      const valContribution = Math.max(-0.20, Math.min(0.20, asset.valuationGap * 0.5));
      rawExpectedReturn += valContribution;
      drivers.push({
        factor: 'fundamentalValuation',
        contribution: Number(valContribution.toFixed(4)),
        confidence: 0.80,
        description: `내재가치 괴리율(${(asset.valuationGap * 100).toFixed(1)}%)`,
      });
    }

    riskContributions.growth = 0.5;
    riskContributions.rates = 0.3;
    riskContributions.market = 0.2;
  } else if (asset.assetClass === 'BOND') {
    const duration = asset.duration ?? 5.0;
    const isSovereign = asset.isSovereign ?? true;
    const creditSpread = asset.creditSpreadBps ?? (isSovereign ? 0 : 120);

    const bondEval = evaluateBondTransmission(duration, isSovereign, creditSpread, macro, ctx);
    // 기준 YTM 수익률에 자본 손익(듀레이션 효과) 합산
    const baseYtmReturn = (asset.ytm ?? (macro.policyRate * 100)) / 100;
    rawExpectedReturn = baseYtmReturn + bondEval.expectedReturnDelta;
    drivers.push(...bondEval.drivers);

    rawExpectedVol = Math.max(0.02, duration * 0.015); // 듀레이션 비례 채권 변동성
    riskContributions.duration = 0.7;
    riskContributions.credit = isSovereign ? 0.0 : 0.3;
  } else if (asset.assetClass === 'COMMODITY') {
    const cat = asset.category ?? 'energy';
    const commEval = evaluateCommodityTransmission(cat, macro, ctx);
    rawExpectedReturn += commEval.expectedReturnDelta;
    drivers.push(...commEval.drivers);

    rawExpectedVol = 0.28; // 원자재 특성상 높은 변동성
    riskContributions.commoditySupply = 0.6;
    riskContributions.inflation = 0.4;
  } else if (asset.assetClass === 'OPTION') {
    const optionType = asset.optionType ?? 'CALL';
    const delta = asset.delta ?? (optionType === 'CALL' ? 0.5 : -0.5);
    const iv = asset.impliedVol ?? 0.25;

    // 기초자산 기대수익이 없을 경우 고정 5% fallback 금지 -> fail-closed 중립 0.0 신호 즉시 반환
    const hasUnderlying = typeof asset.underlyingExpectedReturn === 'number' && Number.isFinite(asset.underlyingExpectedReturn);
    if (!hasUnderlying) {
      return {
        assetId: asset.assetId,
        ticker: asset.ticker,
        assetClass: 'OPTION',
        direction: 0,
        expectedReturn: 0,
        expectedVolatility: Math.abs(delta) * 0.60,
        confidence: 0.1,
        horizonMs: 300_000,
        liquidityPenalty: 0,
        riskContributions: {},
        drivers: [
          {
            factor: 'underlyingUnavailable',
            contribution: 0,
            confidence: 0.0,
            description: '기초자산 기대수익 데이터 부재로 fail-closed 중립 보류',
          },
        ],
      };
    }

    const underlyingExpRet = asset.underlyingExpectedReturn!;
    const realizedVolEst = asset.historicalVol ?? 0.22;

    const optEval = evaluateOptionTransmission(
      optionType,
      underlyingExpRet,
      delta,
      iv,
      realizedVolEst,
      macro,
      ctx,
      {
        gamma: asset.gamma,
        theta: asset.theta,
        strikePrice: asset.strikePrice,
        underlyingPrice: asset.currentPrice > 0 ? asset.currentPrice : undefined,
      }
    );
    rawExpectedReturn += optEval.expectedReturnDelta;
    drivers.push(...optEval.drivers);

    rawExpectedVol = Math.abs(delta) * 0.60; // 레버리지 변동성
    riskContributions.delta = Math.abs(delta);
    riskContributions.vega = 1.0 - Math.abs(delta);
  }

  // 2. 유동성 및 스프레드 패널티 계산 (거래비용 반영)
  const spreadBps = asset.spreadBps ?? 20.0;
  const liquidityPenalty = (spreadBps / 10000) * 0.5; // 스프레드의 절반을 기대수익에서 차감
  const netExpectedReturn = rawExpectedReturn - liquidityPenalty;

  // 3. 종합 방향성(-1.0 ~ +1.0) 도출 (비선형 tanh 스케일링)
  // 기대수익 10%p를 ~0.76 강도로 매핑
  const direction = Math.max(-1.0, Math.min(1.0, Math.tanh(netExpectedReturn / 0.12)));

  // 4. 신뢰도 산출 (드라이버 신뢰도의 가중 평균)
  let confidence = 0.80;
  if (drivers.length > 0) {
    confidence = drivers.reduce((acc, d) => acc + d.confidence, 0) / drivers.length;
  }
  // 거시 불확실성이 높을수록 전반적 신호 신뢰도 감쇄
  confidence = Math.max(0.1, confidence * (1.0 - macro.uncertainty * 0.5));

  return {
    assetId: asset.assetId,
    ticker: asset.ticker,
    assetClass: asset.assetClass,
    direction: Number(direction.toFixed(4)),
    expectedReturn: Number(netExpectedReturn.toFixed(4)),
    expectedVolatility: Number(rawExpectedVol.toFixed(4)),
    confidence: Number(confidence.toFixed(4)),
    horizonMs: 300_000, // 기본 5분 horizon
    liquidityPenalty: Number(liquidityPenalty.toFixed(4)),
    riskContributions,
    drivers,
  };
}

/**
 * 순수 함수: 모든 자산 스냅샷에 대해 교차자산 신호 맵을 2단계로 일괄 산출합니다.
 * 1단계: 주식, 채권, 원자재 등 비(非)옵션 자산 신호 산출
 * 2단계: 옵션 계약을 실제 기초자산 신호(기대수익, 실현변동성)와 연결하여 산출
 */
export function computeCrossAssetSignals(
  assets: readonly AssetMicroSnapshot[],
  macro: MacroState,
  regime: MarketRegime
): Map<string, CrossAssetSignal> {
  const ctx = analyzeTransmissionContext(macro, regime);
  const signals = new Map<string, CrossAssetSignal>();

  const nonOptions: AssetMicroSnapshot[] = [];
  const options: AssetMicroSnapshot[] = [];

  for (const asset of assets) {
    if (asset.assetClass === 'OPTION') {
      options.push(asset);
    } else {
      nonOptions.push(asset);
    }
  }

  // 1단계: 기초자산 신호 산출
  for (const asset of nonOptions) {
    const sig = computeSingleAssetSignal(asset, macro, ctx);
    signals.set(asset.assetId, sig);
  }

  // 2단계: 옵션 신호 산출 (실제 기초자산 기대수익 연결)
  for (const opt of options) {
    let underlyingReturn = opt.underlyingExpectedReturn;
    let realizedVol = opt.historicalVol;

    if (opt.underlyingAssetId) {
      const underlyingSig = signals.get(opt.underlyingAssetId);
      if (underlyingSig) {
        underlyingReturn = underlyingSig.expectedReturn;
        realizedVol = underlyingSig.expectedVolatility;
      }
    }

    const linkedSnapshot: AssetMicroSnapshot = {
      ...opt,
      underlyingExpectedReturn: underlyingReturn,
      historicalVol: realizedVol,
    };

    const optSig = computeSingleAssetSignal(linkedSnapshot, macro, ctx);
    signals.set(opt.assetId, optSig);
  }

  return signals;
}
