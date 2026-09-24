/**
 * Canonical Safety Module for Legacy Child Orders in STOCKSYS.
 *
 * CRITICAL POLICY:
 * - This module is the single authoritative source of truth for legacy child order limits.
 * - 5,000,000 KRW max notional and 5,000 shares max quantity are TEMPORARY legacy child order
 *   safety caps to prevent runaway matching until full parent/child execution desks are deployed.
 * - Target allocations and strategic targets must NEVER be confused with these child order limits.
 */

export const LEGACY_CHILD_ORDER_LIMITS = {
  MAX_NOTIONAL_PER_ORDER: 5000000, // 5,000,000 KRW (5 million KRW)
  MAX_QTY_PER_ORDER: 5000,         // 5,000 shares
  DEPTH_RATIO_CAP: 0.10,           // Max 10% of LOB Depth
  DEFAULT_LOB_DEPTH: 50000         // Default assumed depth
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
  if (price <= 0) return 1;
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
  [key: string]: any;
}

/**
 * Enforces institutional safety bounds on a child order.
 * - Clamps notional <= 5,000,000 KRW
 * - Clamps size <= 5,000 shares
 * - Clamps size <= 10% of LOB depth
 * - Aligns price to KRX tick ladder
 */
export function applyLegacyChildOrderSafetyLimits<T extends LegacyOrderInput>(
  order: T,
  currentPrice: number,
  lobDepth: number = LEGACY_CHILD_ORDER_LIMITS.DEFAULT_LOB_DEPTH
): T {
  let safeQty = Math.abs(order.size || 1);

  if (currentPrice > 0) {
    const notionalCapQty = Math.floor(LEGACY_CHILD_ORDER_LIMITS.MAX_NOTIONAL_PER_ORDER / currentPrice);
    safeQty = Math.min(safeQty, Math.max(1, notionalCapQty));
  }

  safeQty = Math.min(safeQty, LEGACY_CHILD_ORDER_LIMITS.MAX_QTY_PER_ORDER);

  if (lobDepth > 0) {
    const depthCapQty = Math.floor(lobDepth * LEGACY_CHILD_ORDER_LIMITS.DEPTH_RATIO_CAP);
    safeQty = Math.min(safeQty, Math.max(1, depthCapQty));
  }

  const rawPrice = order.price !== undefined ? order.price : currentPrice;
  const alignedPrice = alignToLegacyTickSize(rawPrice);

  return {
    ...order,
    price: alignedPrice,
    size: Math.max(1, Math.floor(safeQty))
  };
}
