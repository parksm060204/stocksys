/**
 * Lightweight in-memory fixed-window rate limiter with periodic expired-entry pruning
 * so long-running server processes do not accumulate unbounded Map entries.
 */
export class WindowRateLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();
  private lastPrunedAt: number = 0;

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
    private readonly pruneIntervalMs: number = 60_000,
    private readonly pruneSizeThreshold: number = 256,
    private readonly resetInclusive: boolean = false
  ) {}

  public allow(key: string, now: number = Date.now()): boolean {
    if (
      this.entries.size >= this.pruneSizeThreshold ||
      now - this.lastPrunedAt >= this.pruneIntervalMs
    ) {
      this.prune(now);
    }

    const current = this.entries.get(key);
    const isExpired = current
      ? this.resetInclusive
        ? now >= current.resetAt
        : now > current.resetAt
      : true;

    if (!current || isExpired) {
      this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }

    if (current.count >= this.maxRequests) {
      return false;
    }

    current.count += 1;
    return true;
  }

  public prune(now: number = Date.now()): number {
    let removed = 0;
    for (const [k, entry] of this.entries.entries()) {
      const expired = this.resetInclusive ? now >= entry.resetAt : now > entry.resetAt;
      if (expired) {
        this.entries.delete(k);
        removed += 1;
      }
    }
    this.lastPrunedAt = now;
    return removed;
  }

  public get size(): number {
    return this.entries.size;
  }
}
