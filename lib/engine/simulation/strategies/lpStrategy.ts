/**
 * STOCKSYS Inventory-Based Liquidity Provider (LP) Strategy
 *
 * - Inventory-skewed quote center (Avellaneda-Stoikov heuristic)
 *   quoteCenter = referencePrice - (inventory - target) * kappa * tickSize
 * - Volatility & inventory risk-adjusted spread widening
 * - Strict multi-level aggregate asset budget constraint
 *   (Sum of all bid sizes * price <= available cash; Sum of ask sizes <= available holding)
 * - Time-priority preserving differential quoting (retains orders when price is unchanged)
 */

import { MarketObservation } from '../marketObservation';
import { AgentAccount, AgentOrderIntent, LpStrategyConfig } from '../agentTypes';
import { OrderRecord } from '../../../memoryDb/memoryStore';
import {
  LpEffectParams,
  NEUTRAL_LP_EFFECT_PARAMS,
  applyUncertaintyMultiplier,
} from '../regime/regimeEffects';

export interface LpQuotePlan {
  cancels: OrderRecord[];
  newOrders: { side: 'buy' | 'sell'; price: number; size: number; replacesOrderId?: string }[];
}

const DEPTH_MATCH_TOLERANCE = 0.1; // 목표 잔여 수량 대비 허용 오차 10%

export function evaluateLpStrategy(
  obs: MarketObservation,
  agent: AgentAccount,
  config: LpStrategyConfig,
  effectParams?: LpEffectParams
): LpQuotePlan {
  const effects = effectParams ?? NEUTRAL_LP_EFFECT_PARAMS;
  const cancels: OrderRecord[] = [];
  const newOrders: { side: 'buy' | 'sell'; price: number; size: number; replacesOrderId?: string }[] = [];

  const midPrice = obs.midPrice > 0 ? obs.midPrice : 10000;
  const tickSize = midPrice < 2000 ? 1 : midPrice < 5000 ? 5 : midPrice < 20000 ? 10 : midPrice < 50000 ? 50 : midPrice < 200000 ? 100 : 500;

  // 1. Inventory deviation from target
  const targetInv = config.targetInventory;
  const currentInv = obs.account.holdingQty;
  const q = currentInv - targetInv; // positive = excess inventory, negative = shortage

  // 2. Quote center with inventory skew (Avellaneda-Stoikov heuristic)
  // When q > 0 (excess inventory), quote center shifts downward to attract buyers and discourage sellers
  const skewTicks = (q / 100) * config.inventorySkewKappa;
  const inventorySkew = skewTicks * tickSize;
  const rawCenter = midPrice - inventorySkew;
  const quoteCenter = Math.max(tickSize * 2, rawCenter);

  // 3. Dynamic spread & depth calculation using stock structural profile & uncertainty shock
  const baseSpreadBps = obs.structural?.baseSpreadBps ?? config.baseSpreadBps;
  const baseDepthShares = obs.structural?.baseDepthShares ?? config.baseLevelSize;
  // 국면 uncertaintyMultiplier: 원본 불확실성 상태는 덮어쓰지 않고 유효 불확실성에만 1회 적용
  const uncertainty = applyUncertaintyMultiplier(obs.uncertaintyScore ?? 0, effects.uncertaintyMultiplier);

  // Base spread scales with stock profile, volatility, and uncertainty shock
  const baseSpread = midPrice * (baseSpreadBps / 10000);
  const uncertaintySpreadMultiplier = 1.0 + uncertainty * 2.5; // Uncertainty significantly widens spread
  const volPremium = midPrice * (obs.volatility * config.volatilityAlpha);
  const invRiskRatio = Math.min(1.0, Math.abs(q) / config.inventoryLimit);
  const invRiskPremium = midPrice * (invRiskRatio * config.inventoryRiskBeta);

  // 국면 lpSpreadMultiplier: 구조적 스프레드·불확실성·변동성·재고 위험이 반영된 목표 스프레드에 1회 적용.
  // 최소 호가 간격(tickSize*2) 하한은 배수 적용 후에도 보존한다.
  const rawTotalSpread = (baseSpread * uncertaintySpreadMultiplier) + volPremium + invRiskPremium;
  const totalSpread = Math.max(tickSize * 2, rawTotalSpread * effects.lpSpreadMultiplier);
  const halfSpread = totalSpread / 2;

  // Uncertainty contracts quote depth to protect LP from adverse selection
  const depthScale = Math.max(0.2, 1.0 - uncertainty * 0.7);
  // 국면 lpDepthMultiplier: 종목 구조적 깊이에 1회 적용 (이후 계좌 예산으로 제한)
  const effectiveBaseDepth = baseDepthShares * effects.lpDepthMultiplier;

  // 기존 호가 잔여 수량(size - filled)이 목표 깊이와 유의하게 다르면 취소·재호가 대상으로 본다.
  const isDepthMatching = (ord: OrderRecord, desiredSize: number): boolean => {
    if (!effects.enforceDepthTarget) return true; // 효과 OFF: 기존 가격 일치 유지 로직 보존
    const remaining = Math.max(0, ord.size - (ord.filled || 0));
    if (remaining <= 0) return false;
    const tol = Math.max(1, desiredSize * DEPTH_MATCH_TOLERANCE);
    return Math.abs(remaining - desiredSize) <= tol;
  };

  // 4. Determine desired quote levels
  const desiredBids: { price: number; size: number }[] = [];
  const desiredAsks: { price: number; size: number }[] = [];

  for (let level = 1; level <= config.numLevels; level++) {
    const rawBid = quoteCenter - halfSpread - (level - 1) * tickSize;
    const alignedBid = Math.floor(rawBid / tickSize) * tickSize;

    const rawAsk = quoteCenter + halfSpread + (level - 1) * tickSize;
    const alignedAsk = Math.ceil(rawAsk / tickSize) * tickSize;

    if (alignedBid > 0 && alignedBid < alignedAsk) {
      // Scale size with level and uncertainty depth scale (국면 깊이 배수 반영)
      const levelSize = Math.max(1, Math.round(effectiveBaseDepth * depthScale * (1 + (level - 1) * 0.15)));
      desiredBids.push({ price: alignedBid, size: levelSize });
      desiredAsks.push({ price: alignedAsk, size: levelSize });
    }
  }

  // 5. Strict Multi-Level Aggregate Asset Budget Constraint
  if (!effects.enforceDepthTarget) {
    // ── 효과 OFF: 기준 커밋(4701f11, a7c1987) 기존 LP 동작 100% 보존 ──
    const existingLpOrders = obs.activeOrders.filter((o) => o.is_lp || o.user_id === agent.accountId);
    const existingBids = existingLpOrders.filter((o) => o.side === 'buy');
    const existingAsks = existingLpOrders.filter((o) => o.side === 'sell');
    const retainedOrderIds = new Set<string>();

    let remainingNewOrderCash = obs.account.availableCash;
    for (const des of desiredBids) {
      const matchingResting = existingBids.find(
        (o) => !retainedOrderIds.has(o.id) && o.price === des.price && (o.status === 'open' || o.status === 'partial')
      );
      if (matchingResting) {
        retainedOrderIds.add(matchingResting.id);
        continue;
      }
      const costPerShare = des.price * 1.0025;
      const maxAffordable = Math.floor(remainingNewOrderCash / costPerShare);
      if (maxAffordable <= 0) {
        break;
      }
      const actualSize = Math.min(des.size, maxAffordable);
      if (actualSize > 0) {
        newOrders.push({ side: 'buy', price: des.price, size: actualSize });
        remainingNewOrderCash -= actualSize * costPerShare;
      }
    }

    let remainingNewOrderHolding = obs.account.availableHolding;
    for (const des of desiredAsks) {
      const matchingResting = existingAsks.find(
        (o) => !retainedOrderIds.has(o.id) && o.price === des.price && (o.status === 'open' || o.status === 'partial')
      );
      if (matchingResting) {
        retainedOrderIds.add(matchingResting.id);
        continue;
      }
      const maxSellable = Math.min(des.size, remainingNewOrderHolding);
      if (maxSellable <= 0) {
        break;
      }
      newOrders.push({ side: 'sell', price: des.price, size: maxSellable });
      remainingNewOrderHolding -= maxSellable;
    }

    for (const ord of existingLpOrders) {
      if (!retainedOrderIds.has(ord.id) && (ord.status === 'open' || ord.status === 'partial')) {
        cancels.push(ord);
      }
    }
    return { cancels, newOrders };
  }

  // ── 효과 ON: 2단계 LP 예산 제약 및 지속 가능 주문 유지 정책 ──
  // - obs.account.availableCash / availableHolding은 모든 활성 주문(기존 LP 호가 포함)의 예약 자산을 이미 차감한 상태이다.
  // - 기존 호가(resting)는 이미 예약금을 확보하고 있으므로, 해당 호가를 유지할 때 추가 가용 현금/주식을 요구하지 않는다.
  // - 예산 제한 전 구조적 목표 깊이(des.size)와 실제 유지 가능한 목표 깊이(sustainableTargetSize)를 구분한다.
  // - 가격과 예산이 동일하고 기존 잔량이 지속 가능한 목표에 부합하면 주문 ID와 시간 우선순위를 유지한다.
  // - 신규 주문은 unallocated 자산 범위 내에서만 레벨별로 순차 배정하여 자산 중복 배정을 방지한다.
  const existingLpOrders = obs.activeOrders.filter(
    (o) => o.user_id === agent.accountId && (o.is_lp || o.user_id === 'acc_lp_main')
  );
  const existingBids = existingLpOrders.filter((o) => o.side === 'buy');
  const existingAsks = existingLpOrders.filter((o) => o.side === 'sell');

  const retainedOrderIds = new Set<string>();

  // Process Bids:
  let unallocatedCash = Math.max(0, obs.account.availableCash);

  for (const des of desiredBids) {
    const costPerShare = des.price * 1.0025;
    const matchingResting = existingBids.find(
      (o) =>
        !retainedOrderIds.has(o.id) &&
        o.price === des.price &&
        (o.status === 'open' || o.status === 'partial')
    );

    if (matchingResting) {
      const remainingQty = Math.max(0, matchingResting.size - (matchingResting.filled || 0));

      // 효과 ON: 해당 레벨의 지속 가능한 목표 깊이 산출
      // 이미 확보된 주문 잔여 수량 + unallocatedCash로 추가 가능한 수량
      const additionalAffordable = Math.floor(unallocatedCash / costPerShare);
      const maxAffordableForLevel = remainingQty + Math.max(0, additionalAffordable);
      const sustainableTargetSize = Math.min(des.size, maxAffordableForLevel);

      const tol = Math.max(1, sustainableTargetSize * DEPTH_MATCH_TOLERANCE);
      const isMatching = remainingQty > 0 && Math.abs(remainingQty - sustainableTargetSize) <= tol;

      if (isMatching) {
        // 지속 가능한 목표와 잔량이 부합하므로 주문 ID 및 시간 우선순위 유지 (예약금 중복 차감 없음)
        retainedOrderIds.add(matchingResting.id);
        continue;
      }

      // 잔량이 지속 가능 목표와 크게 불일치(확장 가능하거나 국면 깊이 축소)하여 재호가 대상 (취소 예정)
      // 취소 전에는 unallocatedCash가 아직 해제되지 않았으므로 현재 가용 현금 내에서만 신규 수량 배정
      const maxAffordable = Math.floor(unallocatedCash / costPerShare);
      const actualSize = Math.min(sustainableTargetSize, maxAffordable);
      if (actualSize > 0) {
        newOrders.push({ side: 'buy', price: des.price, size: actualSize, replacesOrderId: matchingResting.id });
        unallocatedCash -= actualSize * costPerShare;
      }
    } else {
      // 신규 가격 레벨 호가: 순수 미배정 가용 현금 내에서 생성
      const maxAffordable = Math.floor(unallocatedCash / costPerShare);
      if (maxAffordable <= 0) {
        // 더 깊은 레벨은 예산 소진으로 중단
        continue;
      }
      const actualSize = Math.min(des.size, maxAffordable);
      if (actualSize > 0) {
        newOrders.push({ side: 'buy', price: des.price, size: actualSize });
        unallocatedCash -= actualSize * costPerShare;
      }
    }
  }

  // Process Asks:
  let unallocatedHolding = Math.max(0, obs.account.availableHolding);

  for (const des of desiredAsks) {
    const matchingResting = existingAsks.find(
      (o) =>
        !retainedOrderIds.has(o.id) &&
        o.price === des.price &&
        (o.status === 'open' || o.status === 'partial')
    );

    if (matchingResting) {
      const remainingQty = Math.max(0, matchingResting.size - (matchingResting.filled || 0));

      const maxSellableForLevel = remainingQty + unallocatedHolding;
      const sustainableTargetSize = Math.min(des.size, maxSellableForLevel);

      const tol = Math.max(1, sustainableTargetSize * DEPTH_MATCH_TOLERANCE);
      const isMatching = remainingQty > 0 && Math.abs(remainingQty - sustainableTargetSize) <= tol;

      if (isMatching) {
        retainedOrderIds.add(matchingResting.id);
        continue;
      }

      const maxSellable = Math.min(sustainableTargetSize, unallocatedHolding);
      if (maxSellable > 0) {
        newOrders.push({ side: 'sell', price: des.price, size: maxSellable, replacesOrderId: matchingResting.id });
        unallocatedHolding -= maxSellable;
      }
    } else {
      const maxSellable = Math.min(des.size, unallocatedHolding);
      if (maxSellable <= 0) {
        continue;
      }
      newOrders.push({ side: 'sell', price: des.price, size: maxSellable });
      unallocatedHolding -= maxSellable;
    }
  }

  // 6. Schedule cancellation for any active LP order not retained
  for (const ord of existingLpOrders) {
    if (!retainedOrderIds.has(ord.id) && (ord.status === 'open' || ord.status === 'partial')) {
      cancels.push(ord);
    }
  }

  return { cancels, newOrders };
}
