/**
 * Canonical Safety and Risk Policy Module for Orders in STOCKSYS.
 *
 * CRITICAL POLICY:
 * - This module is the single authoritative source of truth for order risk and child order limits.
 * - All order pathways (MarketEngine batch, LP orders, bot orders, human orders) must pass through
 *   this canonical policy.
 * - Discriminated union return type: Rejected orders provide NO safeOrder object.
 * - NaN, Infinity, negative sizes, zero/negative prices, and unauthorized strategic attempts
 *   are strictly rejected fail-closed.
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
  orderType?: string;
  [key: string]: unknown;
}

export interface OrderRiskContext {
  readonly participantKind?: 'HUMAN' | 'RETAIL' | 'DOMESTIC_INSTITUTION' | 'FOREIGN_INSTITUTION' | 'LIQUIDITY_PROVIDER' | 'UNKNOWN';
  readonly participantIdentity?: string;
  readonly accountEquity?: number;
  readonly availableCash?: number;
  readonly adv?: number;
  readonly lobDepth?: number;
  readonly isEmergencyLiquidation?: boolean;
  readonly riskBudget?: number;
  readonly positionLimit?: number;
  readonly currentPosition?: number;
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

export type OrderSafetyResult<T extends LegacyOrderInput> =
  | {
      readonly accepted: true;
      readonly isAccepted: true;
      readonly order: T & { price: number; size: number };
      readonly safeOrder: T & { price: number; size: number };
      readonly diagnostics: OrderRiskDiagnostic;
      readonly diagnostic: OrderRiskDiagnostic;
    }
  | {
      readonly accepted: false;
      readonly isAccepted: false;
      readonly order?: never;
      readonly safeOrder?: never;
      readonly diagnostics: OrderRiskDiagnostic;
      readonly diagnostic: OrderRiskDiagnostic;
    };

/**
 * Authoritative canonical risk gate that evaluates and bounds an order.
 * Strictly fail-closed: returns discriminated union with NO order when rejected.
 */
export function evaluateOrderSafety<T extends LegacyOrderInput>(
  order: T,
  currentPrice: number,
  context?: OrderRiskContext
): OrderSafetyResult<T> {
  const reasonCodes: string[] = [];
  const stockId = String(order.stock_id || 'UNKNOWN');
  const rawSize = order.size !== undefined ? Number(order.size) : NaN;
  const rawPrice = order.price !== undefined ? Number(order.price) : currentPrice;

  // 1. Absolute Fail-Safe Validations (NaN, Infinity, Negative, Zero, Non-Integer)
  if (isNaN(rawPrice) || !isFinite(rawPrice) || rawPrice <= 0) {
    reasonCodes.push('REJECTED_INVALID_PRICE');
  }
  if (isNaN(rawSize) || !isFinite(rawSize) || rawSize <= 0) {
    reasonCodes.push('REJECTED_NON_POSITIVE_QTY');
  } else if (!Number.isInteger(rawSize)) {
    reasonCodes.push('REJECTED_FRACTIONAL_QTY');
  }

  // 2. Check Strategic Order Constraints
  const isStrategicRequested =
    context?.orderType === 'STRATEGIC_ORDER' ||
    context?.bypassLegacyChildOrderCap === true ||
    order.orderType === 'STRATEGIC_ORDER';

  const isLp =
    order.is_lp === true ||
    context?.orderType === 'LP_QUOTE' ||
    context?.participantKind === 'LIQUIDITY_PROVIDER';

  const isEmergency = context?.isEmergencyLiquidation === true;

  if (isStrategicRequested && !isEmergency && !isLp) {
    // 2a. Must be an authorized institutional participant
    const isAuthorizedKind =
      context?.participantKind === 'DOMESTIC_INSTITUTION' ||
      context?.participantKind === 'FOREIGN_INSTITUTION';

    if (!isAuthorizedKind) {
      reasonCodes.push('REJECTED_UNAUTHORIZED_STRATEGIC_PARTICIPANT');
    }

    // 2b. ADV must be known and > 0
    if (context?.adv === undefined || context.adv <= 0) {
      reasonCodes.push('REJECTED_ZERO_OR_UNKNOWN_ADV');
    }

    // 2c. Cash validation for BUY orders
    if (order.side === 'buy') {
      if (context?.availableCash === undefined || context.availableCash <= 0) {
        reasonCodes.push('REJECTED_ZERO_CASH_BUY');
      }
    }

    // 2d. Missing required context cannot quietly fallback
    if (!context || context.participantKind === undefined) {
      reasonCodes.push('REJECTED_MISSING_STRATEGIC_CONTEXT');
    }
  }

  // If any rejection reason exists, immediately fail-closed without constructing safeOrder
  if (reasonCodes.some((code) => code.startsWith('REJECTED_'))) {
    const diagnostic: OrderRiskDiagnostic = Object.freeze({
      stockId,
      originalSize: isNaN(rawSize) ? 0 : rawSize,
      safeSize: 0,
      originalPrice: isNaN(rawPrice) ? 0 : rawPrice,
      safePrice: 0,
      reasonCodes: Object.freeze(reasonCodes),
    });

    if (context?.diagnostics) {
      context.diagnostics.push(diagnostic);
    }

    return {
      accepted: false,
      isAccepted: false,
      diagnostics: diagnostic,
      diagnostic: diagnostic,
    };
  }

  // 3. Price alignment to KRX tick
  const safePrice = alignToLegacyTickSize(rawPrice);
  if (safePrice !== rawPrice) {
    reasonCodes.push('ALIGNED_TO_KRX_TICK');
  }

  let safeQty = rawSize;

  // 4. Absolute Systemic Ceilings
  if (safeQty > ABSOLUTE_SYSTEMIC_LIMITS.MAX_ABSOLUTE_QTY) {
    safeQty = ABSOLUTE_SYSTEMIC_LIMITS.MAX_ABSOLUTE_QTY;
    reasonCodes.push('REDUCED_BY_ABSOLUTE_QTY_CEILING');
  }
  const absoluteNotional = safeQty * safePrice;
  if (absoluteNotional > ABSOLUTE_SYSTEMIC_LIMITS.MAX_ABSOLUTE_NOTIONAL) {
    safeQty = Math.floor(ABSOLUTE_SYSTEMIC_LIMITS.MAX_ABSOLUTE_NOTIONAL / safePrice);
    reasonCodes.push('REDUCED_BY_ABSOLUTE_NOTIONAL_CEILING');
  }

  // 5. Quantity capping by Order Type
  if (!isEmergency) {
    if (isStrategicRequested && !isLp) {
      // Strategic institutional order scaling
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
      if (context?.positionLimit !== undefined && context.positionLimit > 0) {
        const curPos = context.currentPosition || 0;
        const remainingCapacity = Math.max(0, context.positionLimit - curPos);
        if (safeQty > remainingCapacity) {
          safeQty = Math.max(1, remainingCapacity);
          reasonCodes.push('REDUCED_BY_POSITION_LIMIT');
        }
      }
    } else if (!isLp) {
      // Normal Child Order Limits (5M KRW / 5K Shares)
      const notionalCapQty = Math.floor(LEGACY_CHILD_ORDER_LIMITS.MAX_NOTIONAL_PER_ORDER / safePrice);
      if (safeQty > notionalCapQty) {
        safeQty = Math.max(1, notionalCapQty);
        reasonCodes.push('REDUCED_BY_NOTIONAL_CAP');
      }
      if (safeQty > LEGACY_CHILD_ORDER_LIMITS.MAX_QTY_PER_ORDER) {
        safeQty = LEGACY_CHILD_ORDER_LIMITS.MAX_QTY_PER_ORDER;
        reasonCodes.push('REDUCED_BY_QTY_CAP');
      }
    }

    // 6. LOB Depth limit (10% of depth) for child orders
    const effectiveDepth = context?.lobDepth !== undefined && context.lobDepth > 0
      ? context.lobDepth
      : (isLp || isStrategicRequested ? 0 : LEGACY_CHILD_ORDER_LIMITS.DEFAULT_LOB_DEPTH);

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
    reasonCodes: Object.freeze(reasonCodes),
  });

  if (context?.diagnostics) {
    context.diagnostics.push(diagnostic);
  }

  const safeOrder = {
    ...order,
    price: safePrice,
    size: finalSafeSize,
  };

  return {
    accepted: true,
    isAccepted: true,
    order: safeOrder,
    safeOrder: safeOrder,
    diagnostics: diagnostic,
    diagnostic: diagnostic,
  };
}

/**
 * Helper that returns the safe order, or undefined if the order was rejected.
 */
export function applyLegacyChildOrderSafetyLimits<T extends LegacyOrderInput>(
  order: T,
  currentPrice: number,
  lobDepth: number = LEGACY_CHILD_ORDER_LIMITS.DEFAULT_LOB_DEPTH,
  context?: OrderRiskContext
): (T & { price: number; size: number }) | undefined {
  const mergedContext: OrderRiskContext = {
    lobDepth,
    ...context,
  };
  const result = evaluateOrderSafety(order, currentPrice, mergedContext);
  if (!result.accepted) {
    return undefined;
  }
  return result.order;
}
