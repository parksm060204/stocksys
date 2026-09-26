/**
 * Distributed Shared Rate Limiter for STOCKSYS Multi-Server Architecture
 *
 * Requirements:
 * 1. Multi-server production: Atomic sliding-window rate limiting shared across all instances.
 *    - Backed by PostgreSQL VM-DB (via PostgREST /rpc/check_ai_rate_limit) or Upstash/Redis REST.
 * 2. Local development mode: Explicitly distinguished in-memory store without external dependencies.
 * 3. Graceful resiliency: Transient network/DB failures fallback to in-memory without crashing API routes.
 */

export interface RateLimitResult {
  allowed: boolean;
  count: number;
  resetAt: number;
}

export interface IRateLimiterStore {
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  reset?(key?: string): Promise<void> | void;
}

/**
 * 1. In-Memory Store for Local Development & Testing
 */
export class MemoryRateLimiterStore implements IRateLimiterStore {
  public readonly map = new Map<string, { count: number; resetAt: number }>();

  public async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const entry = this.map.get(key);

    if (!entry || now > entry.resetAt) {
      const resetAt = now + windowMs;
      this.map.set(key, { count: 1, resetAt });
      return { allowed: true, count: 1, resetAt };
    }

    if (entry.count >= limit) {
      return { allowed: false, count: entry.count, resetAt: entry.resetAt };
    }

    entry.count += 1;
    return { allowed: true, count: entry.count, resetAt: entry.resetAt };
  }

  public reset(key?: string): void {
    if (key) {
      this.map.delete(key);
    } else {
      this.map.clear();
    }
  }
}

/**
 * 2. PostgreSQL VM-DB Store via PostgREST RPC (/rpc/check_ai_rate_limit)
 * Atomically performs INSERT ... ON CONFLICT DO UPDATE inside PostgreSQL
 */
export class PostgresRateLimiterStore implements IRateLimiterStore {
  private fallbackStore = new MemoryRateLimiterStore();

  constructor(
    private getBaseUrl: () => string = () =>
      process.env.NEXT_PUBLIC_ENGINE_DB_URL || process.env.ENGINE_DB_URL || 'http://49.247.136.231:3001',
    private getApiKey: () => string = () =>
      process.env.ENGINE_DB_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_ENGINE_DB_ANON_KEY || ''
  ) {}

  public async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const baseUrl = this.getBaseUrl().replace(/\/$/, '');
    const apiKey = this.getApiKey();

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const res = await fetch(`${baseUrl}/rpc/check_ai_rate_limit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(apiKey ? { apikey: apiKey, Authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          p_key: key,
          p_limit: limit,
          p_window_seconds: Math.ceil(windowMs / 1000),
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        return {
          allowed: Boolean(data.allowed),
          count: Number(data.count ?? 1),
          resetAt: Number(data.reset_at ?? Date.now() + windowMs),
        };
      }

      // If PostgREST returns 404 or other non-200, fallback to memory
      console.warn(`[RateLimit] Shared DB rate limit returned HTTP ${res.status}, falling back to memory store`);
      return await this.fallbackStore.consume(key, limit, windowMs);
    } catch (err) {
      console.warn('[RateLimit] Shared DB rate limit call failed, falling back to memory store:', err);
      return await this.fallbackStore.consume(key, limit, windowMs);
    }
  }

  public reset(key?: string): void {
    this.fallbackStore.reset(key);
  }
}

/**
 * 3. Upstash Redis REST Store (Optional for Serverless / Cloud Multi-region deployments)
 */
export class UpstashRedisRateLimiterStore implements IRateLimiterStore {
  private fallbackStore = new MemoryRateLimiterStore();

  constructor(
    private getRestUrl: () => string = () => process.env.UPSTASH_REDIS_REST_URL || '',
    private getRestToken: () => string = () => process.env.UPSTASH_REDIS_REST_TOKEN || ''
  ) {}

  public async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const restUrl = this.getRestUrl().replace(/\/$/, '');
    const restToken = this.getRestToken();

    if (!restUrl || !restToken) {
      return await this.fallbackStore.consume(key, limit, windowMs);
    }

    try {
      const windowSec = Math.ceil(windowMs / 1000);
      const redisKey = `ratelimit:ai:${key}`;

      // Run pipeline: INCR then EXPIRE with NX
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      const res = await fetch(`${restUrl}/pipeline`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${restToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify([
          ['INCR', redisKey],
          ['EXPIRE', redisKey, windowSec, 'NX'],
          ['TTL', redisKey],
        ]),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        const results = await res.json();
        const count = Number(results[0]?.result ?? 1);
        const ttl = Number(results[2]?.result ?? windowSec);
        const resetAt = Date.now() + Math.max(ttl, 1) * 1000;
        return {
          allowed: count <= limit,
          count,
          resetAt,
        };
      }

      return await this.fallbackStore.consume(key, limit, windowMs);
    } catch (err) {
      console.warn('[RateLimit] Upstash Redis call failed, falling back to memory store:', err);
      return await this.fallbackStore.consume(key, limit, windowMs);
    }
  }

  public reset(key?: string): void {
    this.fallbackStore.reset(key);
  }
}

// Global shared instances
export const defaultMemoryStore = new MemoryRateLimiterStore();
export const defaultPostgresStore = new PostgresRateLimiterStore();
export const defaultUpstashStore = new UpstashRedisRateLimiterStore();

let customLimiterStore: IRateLimiterStore | null = null;

export function setCustomLimiterStore(store: IRateLimiterStore | null): void {
  customLimiterStore = store;
}

/**
 * Checks whether the environment is local development mode
 */
export function isLocalDevMode(): boolean {
  if (process.env.USE_LOCAL_IN_MEMORY_RATE_LIMIT === 'true') return true;
  if (process.env.NEXT_PUBLIC_USE_IN_MEMORY === 'true') return true;
  return process.env.NODE_ENV !== 'production';
}

/**
 * Resolves the appropriate rate limiter store based on current deployment environment
 */
export function getActiveRateLimiterStore(): IRateLimiterStore {
  if (customLimiterStore) {
    return customLimiterStore;
  }

  if (isLocalDevMode()) {
    return defaultMemoryStore;
  }

  // Production: Check Upstash Redis first if configured, else default to PostgreSQL VM-DB
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    return defaultUpstashStore;
  }

  return defaultPostgresStore;
}
