/**
 * STOCKSYS Regime Effects — 순수 파라미터 변환 계층 (Stage 2)
 *
 * 목적:
 * - 활성화된 시장 국면(MarketRegime)의 파라미터를 봇 주문 판단·LP 호가 공급에 적용하기 위한
 *   "읽기 전용" 유효 파라미터를 매 스텝 새로 계산한다.
 *
 * 원칙:
 * 1. 원본 AgentAccount / 전략 설정 / 종목 구조적 유동성 설정을 절대 변이하지 않는다.
 * 2. 매 스텝 원본과 활성 국면으로부터 유효 파라미터를 새로 계산하므로 이전 스텝 배수가 누적되지 않는다.
 * 3. 모든 값은 유한하고 유효 범위로 제한되며, 계좌·종목의 절대 한도를 상향하지 않는다.
 * 4. 효과가 꺼져 있으면(컨텍스트 null) 중립값(곱셈 1.0, cashPreference 0)만 반환하여
 *    기존 실행 경로와 완전히 동일한 결과를 만든다.
 */

import { MarketRegime, MarketRegimeParameters } from './regimeTypes';

/**
 * 한 스텝에 적용할 국면 컨텍스트 (불변).
 * - 같은 스텝의 모든 봇과 LP는 이 컨텍스트 하나를 공유한다.
 * - 스텝 종료 시 예약된 국면은 다음 스텝 시작 시 활성화되어 새 컨텍스트로 반영된다.
 */
export interface AppliedRegimeContext {
  readonly enabled: true;
  readonly regime: MarketRegime;
  readonly transitionId: number;
  readonly parameters: Readonly<MarketRegimeParameters>;
}

/** 효과 비활성 시 null. */
export type RegimeEffectsContext = Readonly<AppliedRegimeContext> | null;

/** 활성 국면 탐지 결과(효과 적용 여부와 무관한 원본 관측). */
export interface ActiveRegimeState {
  readonly regime: MarketRegime;
  readonly transitionId: number;
  readonly parameters: Readonly<MarketRegimeParameters>;
}

/** 봇 주문 판단에 적용되는 유효 파라미터 (모두 원본 불변, 매 스텝 재계산). */
export interface BotEffectParams {
  readonly buyArrivalMultiplier: number;
  readonly sellArrivalMultiplier: number;
  readonly orderSizeMultiplier: number;
  readonly riskToleranceMultiplier: number;
  readonly trendSensitivity: number;
  readonly valueSensitivity: number;
  readonly uncertaintyMultiplier: number;
  readonly newsHalfLifeMultiplier: number;
  readonly cashPreference: number;
}

/** LP 호가 공급에 적용되는 유효 파라미터. */
export interface LpEffectParams {
  readonly lpSpreadMultiplier: number;
  readonly lpDepthMultiplier: number;
  readonly uncertaintyMultiplier: number;
  /** true이면 기존 호가의 잔여 수량을 목표 깊이와 비교하여 불일치 시 취소·재호가한다. */
  readonly enforceDepthTarget: boolean;
}

/** 효과 OFF 시 봇 유효 파라미터(중립). */
export const NEUTRAL_BOT_EFFECT_PARAMS: Readonly<BotEffectParams> = Object.freeze({
  buyArrivalMultiplier: 1,
  sellArrivalMultiplier: 1,
  orderSizeMultiplier: 1,
  riskToleranceMultiplier: 1,
  trendSensitivity: 1,
  valueSensitivity: 1,
  uncertaintyMultiplier: 1,
  newsHalfLifeMultiplier: 1,
  cashPreference: 0,
});

/** 효과 OFF 시 LP 유효 파라미터(중립). */
export const NEUTRAL_LP_EFFECT_PARAMS: Readonly<LpEffectParams> = Object.freeze({
  lpSpreadMultiplier: 1,
  lpDepthMultiplier: 1,
  uncertaintyMultiplier: 1,
  enforceDepthTarget: false,
});

/** [0, 1] 범위로 안전 클램프 (NaN 방어 포함). */
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** 양수 유한 배수 보정 (비정상 값은 중립 1.0으로 대체). */
function safeMultiplier(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 1;
}

/**
 * 방향별 주문 발생 확률(순수 함수).
 * pBuy = 1 - exp(-activityRate * buyMultiplier * dt)
 * pSell = 1 - exp(-activityRate * sellMultiplier * dt)
 * pCandidate = max(pBuy, pSell)
 *
 * - pBuy/pSell은 [0, 1) 범위로 단순 곱셈으로 1을 초과하지 않는다.
 * - pCandidate를 활동 게이트로 사용하고, 전략 방향에 따라 pBuy/pSell로 제출을 필터링한다.
 */
export function computeDirectionalArrivalProbabilities(
  activityRate: number,
  buyArrivalMultiplier: number,
  sellArrivalMultiplier: number,
  dt: number
): { pBuy: number; pSell: number; pCandidate: number } {
  const rate = Number.isFinite(activityRate) && activityRate > 0 ? activityRate : 0;
  const duration = Number.isFinite(dt) && dt > 0 ? dt : 0;
  const buyMult = safeMultiplier(buyArrivalMultiplier);
  const sellMult = safeMultiplier(sellArrivalMultiplier);
  const pBuy = 1 - Math.exp(-rate * buyMult * duration);
  const pSell = 1 - Math.exp(-rate * sellMult * duration);
  return { pBuy, pSell, pCandidate: Math.max(pBuy, pSell) };
}

/** 활성 국면 컨텍스트 → 봇 유효 파라미터. 컨텍스트가 없으면 중립값. */
export function resolveBotEffectParams(ctx: RegimeEffectsContext): BotEffectParams {
  if (!ctx) return NEUTRAL_BOT_EFFECT_PARAMS;
  const p = ctx.parameters;
  return {
    buyArrivalMultiplier: p.buyArrivalMultiplier,
    sellArrivalMultiplier: p.sellArrivalMultiplier,
    orderSizeMultiplier: p.orderSizeMultiplier,
    riskToleranceMultiplier: p.riskToleranceMultiplier,
    trendSensitivity: p.trendSensitivity,
    valueSensitivity: p.valueSensitivity,
    uncertaintyMultiplier: p.uncertaintyMultiplier,
    newsHalfLifeMultiplier: p.newsHalfLifeMultiplier,
    cashPreference: clamp01(p.cashPreference),
  };
}

/** 활성 국면 컨텍스트 → LP 유효 파라미터. 컨텍스트가 없으면 중립값. */
export function resolveLpEffectParams(ctx: RegimeEffectsContext): LpEffectParams {
  if (!ctx) return NEUTRAL_LP_EFFECT_PARAMS;
  const p = ctx.parameters;
  return {
    lpSpreadMultiplier: p.lpSpreadMultiplier,
    lpDepthMultiplier: p.lpDepthMultiplier,
    uncertaintyMultiplier: p.uncertaintyMultiplier,
    enforceDepthTarget: true,
  };
}

/**
 * 목표 노출(주식 수)에 위험 허용 배수를 한 번 적용하고 절대 상한으로 제한한다.
 * - 절대 한도(maxPosition)를 상향하지 않는다.
 */
export function applyRiskToleranceToTarget(
  target: number,
  riskToleranceMultiplier: number,
  maxPosition: number
): number {
  const safeTarget = Number.isFinite(target) ? target : 0;
  const mult = safeMultiplier(riskToleranceMultiplier);
  const scaled = safeTarget * mult;
  const bounded = Math.max(0, Math.min(maxPosition, Math.round(scaled)));
  return bounded;
}

/**
 * 희망 주문 수량에 크기 배수를 한 번 적용한 뒤 기존 한도(노출/주문상한/참여율)로 최종 제한한다.
 * - 이미 제한된 수량에 배수를 다시 곱해 한도를 초과하지 않도록 최종 min을 다시 적용한다.
 */
export function applyOrderSizeMultiplier(
  neededShares: number,
  orderSizeMultiplier: number,
  maxOrderSize: number,
  participationCap: number
): number {
  const needed = Number.isFinite(neededShares) ? neededShares : 0;
  const participation = Number.isFinite(participationCap) ? participationCap : 0;
  const mult = safeMultiplier(orderSizeMultiplier);
  const rawDesired = Math.min(needed, participation);
  const scaled = rawDesired * mult;
  const bounded = Math.min(scaled, needed, maxOrderSize, participation);
  if (bounded < 1) return 0;
  return Math.floor(bounded);
}

/** 유효 불확실성: 원본 상태를 덮어쓰지 않고 배수 적용 후 [0,1] 제한. */
export function applyUncertaintyMultiplier(uncertainty: number, multiplier: number): number {
  return clamp01((Number.isFinite(uncertainty) ? uncertainty : 0) * safeMultiplier(multiplier));
}
