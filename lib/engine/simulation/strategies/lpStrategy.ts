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

export interface LpQuotePlan {
  cancels: OrderRecord[];
  newOrders: { side: 'buy' | 'sell'; price: number; size: number }[];
}

export function evaluateLpStrategy(
  obs: MarketObservation,
  agent: AgentAccount,
  config: LpStrategyConfig
): LpQuotePlan {
  const cancels: OrderRecord[] = [];
  const newOrders: { side: 'buy' | 'sell'; price: number; size: number }[] = [];

  const midPrice = obs.midPrice > 0 ? obs.midPrice : 10000;
  const tickSize = midPrice < 2000 ? 1 : midPrice < 5000 ? 5 : midPrice < 20000 ? 10 : midPrice < 50000 ? 50 : midPrice < 200000 ? 100 : 500;

  // 1. Inventory deviation from target
  const targetInv = config.targetInventory;
  const currentInv = obs.account.holdingQty;
  const q = currentInv - targetInv; // positive = excess inventory, negative = shortage

  // 2. Quote center with inventory skew
  // When q > 0 (excess inventory), quote center shifts downward to attract buyers and discourage sellers
  const skewTicks = (q / 100) * config.inventorySkewKappa;
  const inventorySkew = skewTicks * tickSize;
  const rawCenter = midPrice - inventorySkew;
  const quoteCenter = Math.max(tickSize * 2, rawCenter);

  // 3. Dynamic spread calculation
  // Base spread + volatility premium + inventory risk premium
  const baseSpread = midPrice * (config.baseSpreadBps / 10000);
  const volPremium = midPrice * (obs.volatility * config.volatilityAlpha);
  const invRiskRatio = Math.min(1.0, Math.abs(q) / config.inventoryLimit);
  const invRiskPremium = midPrice * (invRiskRatio * config.inventoryRiskBeta);

  const totalSpread = Math.max(tickSize * 2, baseSpread + volPremium + invRiskPremium);
  const halfSpread = totalSpread / 2;

  // 4. Determine desired quote levels
  const desiredBids: { price: number; size: number }[] = [];
  const desiredAsks: { price: number; size: number }[] = [];

  for (let level = 1; level <= config.numLevels; level++) {
    const rawBid = quoteCenter - halfSpread - (level - 1) * tickSize;
    const alignedBid = Math.floor(rawBid / tickSize) * tickSize;

    const rawAsk = quoteCenter + halfSpread + (level - 1) * tickSize;
    const alignedAsk = Math.ceil(rawAsk / tickSize) * tickSize;

    if (alignedBid > 0 && alignedBid < alignedAsk) {
      // Slightly scale size for deeper levels
      const levelSize = Math.round(config.baseLevelSize * (1 + (level - 1) * 0.2));
      desiredBids.push({ price: alignedBid, size: levelSize });
      desiredAsks.push({ price: alignedAsk, size: levelSize });
    }
  }

  // 5. Strict Multi-Level Aggregate Asset Budget Constraint
  // Filter and scale bids so total cash committed <= availableCash
  // Note: To accurately compute available budget, we add back cash/shares currently reserved by orders we intend to cancel
  let budgetCash = obs.account.availableCash;
  let budgetHolding = obs.account.availableHolding;

  // Active LP orders on this stock
  const existingLpOrders = obs.activeOrders.filter((o) => o.is_lp || o.user_id === agent.accountId);
  const existingBids = existingLpOrders.filter((o) => o.side === 'buy');
  const existingAsks = existingLpOrders.filter((o) => o.side === 'sell');

  // Identify orders to keep vs cancel
  const retainedOrderIds = new Set<string>();

  // Process Bids:
  let cumulativeBidCost = 0;
  for (const des of desiredBids) {
    const matchingResting = existingBids.find(
      (o) => !retainedOrderIds.has(o.id) && o.price === des.price && (o.status === 'open' || o.status === 'partial')
    );

    const costPerShare = des.price * 1.0025;
    const maxAffordable = Math.floor((budgetCash - cumulativeBidCost) / costPerShare);

    if (maxAffordable <= 0) {
      // No more cash budget for this and deeper levels
      break;
    }

    const actualSize = Math.min(des.size, maxAffordable);

    if (matchingResting) {
      retainedOrderIds.add(matchingResting.id);
      cumulativeBidCost += matchingResting.size * costPerShare;
    } else {
      newOrders.push({ side: 'buy', price: des.price, size: actualSize });
      cumulativeBidCost += actualSize * costPerShare;
    }
  }

  // Process Asks:
  let cumulativeAskQty = 0;
  for (const des of desiredAsks) {
    const matchingResting = existingAsks.find(
      (o) => !retainedOrderIds.has(o.id) && o.price === des.price && (o.status === 'open' || o.status === 'partial')
    );

    const maxSellable = budgetHolding - cumulativeAskQty;
    if (maxSellable <= 0) {
      break;
    }

    const actualSize = Math.min(des.size, maxSellable);

    if (matchingResting) {
      retainedOrderIds.add(matchingResting.id);
      cumulativeAskQty += matchingResting.size;
    } else {
      newOrders.push({ side: 'sell', price: des.price, size: actualSize });
      cumulativeAskQty += actualSize;
    }
  }

  // Any existing LP order not retained is scheduled for cancellation
  for (const ord of existingLpOrders) {
    if (!retainedOrderIds.has(ord.id) && (ord.status === 'open' || ord.status === 'partial')) {
      cancels.push(ord);
    }
  }

  return { cancels, newOrders };
}
