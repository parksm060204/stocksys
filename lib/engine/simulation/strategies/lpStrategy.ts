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
  newOrders: { side: 'buy' | 'sell'; price: number; size: number }[];
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
  const newOrders: { side: 'buy' | 'sell'; price: number; size: number }[] = [];

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
  // Crucial bugfix:
  // - obs.account.availableCash already subtracts reserved cash from ALL active orders (including resting LP orders).
  // - Retained resting orders are ALREADY funded in reservedCash and must NOT be subtracted again.
  // - Partial fills use remaining shares: (size - filled).
  // - New orders must collectively fit within the stock's allocated available cash.
  const existingLpOrders = obs.activeOrders.filter((o) => o.is_lp || o.user_id === agent.accountId);
  const existingBids = existingLpOrders.filter((o) => o.side === 'buy');
  const existingAsks = existingLpOrders.filter((o) => o.side === 'sell');

  const retainedOrderIds = new Set<string>();

  // Process Bids:
  // Budget for NEW orders is capped by availableCash
  let remainingNewOrderCash = obs.account.availableCash;

  for (const des of desiredBids) {
    // Check if an existing open order already sits at this price level
    const matchingResting = existingBids.find(
      (o) =>
        !retainedOrderIds.has(o.id) &&
        o.price === des.price &&
        (o.status === 'open' || o.status === 'partial') &&
        isDepthMatching(o, des.size)
    );

    if (matchingResting) {
      // Retain existing resting order (preserves time-priority, already reserved in DB)
      retainedOrderIds.add(matchingResting.id);
      continue;
    }

    // New order: verify against remaining new order cash budget
    const costPerShare = des.price * 1.0025;
    const maxAffordable = Math.floor(remainingNewOrderCash / costPerShare);

    if (maxAffordable <= 0) {
      // No more cash budget for deeper levels
      break;
    }

    const actualSize = Math.min(des.size, maxAffordable);
    if (actualSize > 0) {
      newOrders.push({ side: 'buy', price: des.price, size: actualSize });
      remainingNewOrderCash -= actualSize * costPerShare;
    }
  }

  // Process Asks:
  // Budget for NEW orders is capped by availableHolding
  let remainingNewOrderHolding = obs.account.availableHolding;

  for (const des of desiredAsks) {
    const matchingResting = existingAsks.find(
      (o) =>
        !retainedOrderIds.has(o.id) &&
        o.price === des.price &&
        (o.status === 'open' || o.status === 'partial') &&
        isDepthMatching(o, des.size)
    );

    if (matchingResting) {
      // Retain existing resting order (already reserved in holding)
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

  // 6. Schedule cancellation for any active LP order not retained
  for (const ord of existingLpOrders) {
    if (!retainedOrderIds.has(ord.id) && (ord.status === 'open' || ord.status === 'partial')) {
      cancels.push(ord);
    }
  }

  return { cancels, newOrders };
}
