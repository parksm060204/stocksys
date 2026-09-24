/**
 * Canonical Safety and Risk Policy Module for Orders in STOCKSYS.
 *
 * CRITICAL POLICY:
 * - This module is the single authoritative source of truth for order risk and child order limits.
 * - All order pathways (MarketEngine batch, LP orders, bot orders, human orders) must pass through
 *   this canonical policy.
 * - Legacy limits (5,000,000 KRW and 5,000 shares) are applied to child orders by default.
 * - Strategic institutional orders may scale safely under AUM/ADV risk budgets without arbitrary capping,
 *   while maintaining absolute systemic fail-safes (no negative, NaN, Infinity, or overflow).
 */

export const LEGACY_CHILD_ORDER_LIMITS = {
  MAX_NOTIONAL_PER_ORDER: 5000000, // 5,000,000 KRW (5 million KRW)
  MAX_QTY_PER_ORDER: 5000,         // 5,000 shares
  DEPTH_RATIO_CAP: 0.10,           // Max 10% of LOB Depth
  DEFAULT_LOB_DEPTH: 50000         // Default assumed depth
} as const;

export const ABSOLUTE_SYSTEMIC_LIMITS = {
  MAX_ABSOLUTE_QTY: 10000000,              // 10,000,000 shares
  MAX_ABSOLUTE_NOTIONAL: 100000000000,      // 100 Billion KRW
  MIN_TICK_PRICE: 1,
  MAX_ADV_PARTICIPATION_RATE: 0.25,        // Max 25% of ADV
} as const;

export function getLegacyTickSize(price: number): number {
  if (price < 2000) return 1;
  if (price < 5000) return 5;
  if (price < 20000) return 10;
  if (price < 50000) return 50;
  if (price < 200000) return 100;
  if (price < 500000) return 500;
  return 1000;
}

export function alignToLegacyTickSize(price: number): number {
  if (price <= 0 || !isFinite(price) || isNaN(price)) return ABSOLUTE_SYSTEMIC_LIMITS.MIN_TICK_PRICE;
  const tick = getLegacyTickSize(price);
  return Math.round(price / tick) * tick;
}

export interface LegacyOrderInput {
  stock_id?: string;
  user_id?: string | null;
  side: 'buy' | 'sell';
  price?: number;
  size?: number;
  status?: string;
  is_lp?: boolean;
  [key: string]: unknown;
}

export interface OrderRiskContext {
  readonly participantKind?: 'HUMAN' | 'RETAIL' | 'DOMESTIC_INSTITUTION' | 'FOREIGN_INSTITUTION' | 'LIQUIDITY_PROVIDER';
  readonly accountEquity?: number;
  readonly availableCash?: number;
  readonly adv?: number;
  readonly lobDepth?: number;
  readonly isEmergencyLiquidation?: boolean;
  readonly riskBudget?: number;
  readonly orderType?: 'CHILD_ORDER' | 'STRATEGIC_ORDER' | 'LP_QUOTE';
  readonly bypassLegacyChildOrderCap?: boolean;
  readonly diagnostics?: OrderRiskDiagnostic[];
}

export interface OrderRiskDiagnostic {
  readonly stockId: string;
  readonly originalSize: number;
  readonly safeSize: number;
  readonly originalPrice: number;
  readonly safePrice: number;
  readonly reasonCodes: readonly string[];
}

export interface OrderSafetyEvaluationResult<T extends LegacyOrderInput> {
  readonly safeOrder: T;
  readonly diagnostic: OrderRiskDiagnostic;
  readonly isAccepted: boolean;
}

/**
 * Authoritative canonical risk gate that evaluates and bounds an order.
 */
export function evaluateOrderSafety<T extends LegacyOrderInput>(
  order: T,
  currentPrice: number,
  context?: OrderRiskContext
): OrderSafetyEvaluationResult<T> {
  const reasonCodes: string[] = [];
  const stockId = String(order.stock_id || 'UNKNOWN');
  const rawSize = Number(order.size ?? 1);
  const rawPrice = order.price !== undefined ? Number(order.price) : currentPrice;

  // 1. Absolute Fail-Safe Validations (NaN, Infinity, Negative)
  if (isNaN(rawPrice) || !isFinite(rawPrice) || rawPrice <= 0) {
    reasonCodes.push('REJECTED_INVALID_PRICE');
  }
  if (isNaN(rawSize) || !isFinite(rawSize) || rawSize <= 0) {
    reasonCodes.push('REJECTED_NON_POSITIVE_QTY');
  }

  const safePrice = Math.max(ABSOLUTE_SYSTEMIC_LIMITS.MIN_TICK_PRICE, alignToLegacyTickSize(rawPrice));
  if (safePrice !== rawPrice && !reasonCodes.includes('REJECTED_INVALID_PRICE')) {
    reasonCodes.push('ALIGNED_TO_KRX_TICK');
  }

  let safeQty = Math.max(1, Math.floor(Math.abs(rawSize)));

  // 2. Absolute Systemic Ceilings
  if (safeQty > ABSOLUTE_SYSTEMIC_LIMITS.MAX_ABSOLUTE_QTY) {
    safeQty = ABSOLUTE_SYSTEMIC_LIMITS.MAX_ABSOLUTE_QTY;
    reasonCodes.push('REDUCED_BY_ABSOLUTE_QTY_CEILING');
  }
  const absoluteNotional = safeQty * safePrice;
  if (absoluteNotional > ABSOLUTE_SYSTEMIC_LIMITS.MAX_ABSOLUTE_NOTIONAL) {
    safeQty = Math.floor(ABSOLUTE_SYSTEMIC_LIMITS.MAX_ABSOLUTE_NOTIONAL / safePrice);
    reasonCodes.push('REDUCED_BY_ABSOLUTE_NOTIONAL_CEILING');
  }

  // 3. Child Order Limits vs Strategic / Institutional Limits
  const isLp = order.is_lp === true || context?.orderType === 'LP_QUOTE' || context?.participantKind === 'LIQUIDITY_PROVIDER';
  const isEmergency = context?.isEmergencyLiquidation === true;
  const isBypassedStrategic = context?.bypassLegacyChildOrderCap === true || context?.orderType === 'STRATEGIC_ORDER';

  if (!isEmergency) {
    if (!isBypassedStrategic) {
      // Apply Standard Child Order Limits (5M KRW / 5K Shares)
      if (safePrice > 0) {
        const notionalCapQty = Math.floor(LEGACY_CHILD_ORDER_LIMITS.MAX_NOTIONAL_PER_ORDER / safePrice);
        if (safeQty > notionalCapQty) {
          safeQty = Math.max(1, notionalCapQty);
          reasonCodes.push('REDUCED_BY_NOTIONAL_CAP');
        }
      }
      if (safeQty > LEGACY_CHILD_ORDER_LIMITS.MAX_QTY_PER_ORDER) {
        safeQty = LEGACY_CHILD_ORDER_LIMITS.MAX_QTY_PER_ORDER;
        reasonCodes.push('REDUCED_BY_QTY_CAP');
      }
    } else {
      // Strategic institutional order: bound by ADV participation & available cash
      if (context?.adv && context.adv > 0) {
        const maxAdvQty = Math.floor(context.adv * ABSOLUTE_SYSTEMIC_LIMITS.MAX_ADV_PARTICIPATION_RATE);
        if (safeQty > maxAdvQty) {
          safeQty = Math.max(1, maxAdvQty);
          reasonCodes.push('REDUCED_BY_ADV_LIMIT');
        }
      }
      if (order.side === 'buy' && context?.availableCash !== undefined && context.availableCash > 0) {
        const maxAffordableQty = Math.floor(context.availableCash / safePrice);
        if (safeQty > maxAffordableQty) {
          safeQty = Math.max(1, maxAffordableQty);
          reasonCodes.push('REDUCED_BY_AVAILABLE_CASH');
        }
      }
    }

    // 4. LOB Depth limit (10% of depth)
    const effectiveDepth = context?.lobDepth !== undefined && context.lobDepth > 0
      ? context.lobDepth
      : (isLp || isBypassedStrategic ? 0 : LEGACY_CHILD_ORDER_LIMITS.DEFAULT_LOB_DEPTH);

    if (effectiveDepth > 0) {
      const depthCapQty = Math.floor(effectiveDepth * LEGACY_CHILD_ORDER_LIMITS.DEPTH_RATIO_CAP);
      if (safeQty > depthCapQty) {
        safeQty = Math.max(1, depthCapQty);
        reasonCodes.push('REDUCED_BY_LOB_DEPTH');
      }
    }
  } else {
    reasonCodes.push('EMERGENCY_LIQUIDATION_UNBOUNDED');
  }

  const finalSafeSize = Math.max(1, Math.floor(safeQty));
  const diagnostic: OrderRiskDiagnostic = Object.freeze({
    stockId,
    originalSize: rawSize,
    safeSize: finalSafeSize,
    originalPrice: rawPrice,
    safePrice,
    reasonCodes: Object.freeze(reasonCodes)
  });

  if (context?.diagnostics) {
    context.diagnostics.push(diagnostic);
  }

  const safeOrder = {
    ...order,
    price: safePrice,
    size: finalSafeSize
  };

  const isAccepted = !reasonCodes.includes('REJECTED_INVALID_PRICE') && !reasonCodes.includes('REJECTED_NON_POSITIVE_QTY');

  return {
    safeOrder,
    diagnostic,
    isAccepted
  };
}

/**
 * Backwards compatible helper that directly returns the safe child order.
 */
export function applyLegacyChildOrderSafetyLimits<T extends LegacyOrderInput>(
  order: T,
  currentPrice: number,
  lobDepth: number = LEGACY_CHILD_ORDER_LIMITS.DEFAULT_LOB_DEPTH,
  context?: OrderRiskContext
): T {
  const mergedContext: OrderRiskContext = {
    lobDepth,
    ...context
  };
  const { safeOrder } = evaluateOrderSafety(order, currentPrice, mergedContext);
  return safeOrder;
}
