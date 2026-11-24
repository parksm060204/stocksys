import { WindowRateLimiter } from './windowLimiter';

const globalForStockOrderLimiter = globalThis as unknown as {
  __STOCKSYS_STOCK_ORDER_RATE_LIMITER__?: WindowRateLimiter;
};

/**
 * Shared fixed-window rate limiter across all public stock order entrypoints
 * (/api/orders and /api/local-db submit_and_match_order), keyed by authenticated userId.
 */
export const stockOrderRateLimiter: WindowRateLimiter =
  globalForStockOrderLimiter.__STOCKSYS_STOCK_ORDER_RATE_LIMITER__ ??
  new WindowRateLimiter(15, 1000, 60_000, 256, true);

if (!globalForStockOrderLimiter.__STOCKSYS_STOCK_ORDER_RATE_LIMITER__) {
  globalForStockOrderLimiter.__STOCKSYS_STOCK_ORDER_RATE_LIMITER__ = stockOrderRateLimiter;
}

export function allowStockOrderRequest(userId: string, now?: number): boolean {
  return stockOrderRateLimiter.allow(userId, now);
}

/** @internal Test-only helper to clear shared rate-limiter state between isolated tests. */
export function __resetStockOrderRateLimiterForTesting(): void {
  stockOrderRateLimiter.clear();
}
