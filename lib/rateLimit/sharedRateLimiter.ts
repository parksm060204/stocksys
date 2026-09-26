/**
 * Distributed Shared Rate Limiter for STOCKSYS Multi-Server Architecture
 *
 * Requirements:
 * 1. Multi-server production:
 *    - Atomic sliding-window rate limiting shared across all instances.
 *    - Backed by PostgreSQL VM-DB (via PostgREST /rpc/check_ai_rate_limit) or Upstash/Redis REST.
 *    - Fails closed: On store error, connection failure, 404, or auth error, throws RateLimiterServiceUnavailableError
 *      so that the API route returns 503 without invoking external AI APIs.
 * 2. Secure transport & credentials:
 *    - No default external IP or insecure HTTP fallbacks in production.
 *    - Requires HTTPS for remote database and Redis endpoints.
 *    - Requires server-only ENGINE_DB_SERVICE_ROLE_KEY (no fallback to anon key).
 * 3. Local development mode:
 *    - Explicitly distinguished in-memory store without external dependencies.
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

export class RateLimiterConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimiterConfigurationError';
  }
}

export class RateLimiterServiceUnavailableError extends Error {
  constructor(message: string, public cause?: unknown) {
    super(message);
    this.name = 'RateLimiterServiceUnavailableError';
  }
}

/**
 * 1. In-Memory Store for Explicit Local Development & Testing
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
 * Performs atomic row-locked rate limiting inside PostgreSQL.
 * In production:
 * - Requires server-only DB URL and ENGINE_DB_SERVICE_ROLE_KEY.
 * - Forbids unencrypted HTTP and anonymous keys.
 * - On connection failure, 404, or auth error, fails closed with RateLimiterServiceUnavailableError.
 */
export class PostgresRateLimiterStore implements IRateLimiterStore {
  constructor(
    private getBaseUrl: () => string | undefined = () =>
      process.env.ENGINE_DB_URL,
    private getServiceRoleKey: () => string | undefined = () =>
      process.env.ENGINE_DB_SERVICE_ROLE_KEY
  ) {}

  public async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const rawUrl = this.getBaseUrl();
    if (!rawUrl || !rawUrl.trim()) {
      throw new RateLimiterConfigurationError('ENGINE_DB_URL is required for production shared rate limiting');
    }

    const baseUrl = rawUrl.trim().replace(/\/$/, '');
    if (!baseUrl.startsWith('https://')) {
      throw new RateLimiterConfigurationError(
        `Insecure HTTP protocol is prohibited for production rate limiting: ${baseUrl}. Must use HTTPS.`
      );
    }

    const serviceKey = this.getServiceRoleKey();
    if (!serviceKey || !serviceKey.trim()) {
      throw new RateLimiterConfigurationError(
        'ENGINE_DB_SERVICE_ROLE_KEY is required for production rate limiting (anonymous key fallback is prohibited)'
      );
    }

    let res: Response;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);

      try {
        res = await fetch(`${baseUrl}/rpc/check_ai_rate_limit`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            p_key: key,
            p_limit: limit,
            p_window_seconds: Math.ceil(windowMs / 1000),
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      throw new RateLimiterServiceUnavailableError(
        `Shared rate limit database connection failed: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }

    if (res.status === 404) {
      throw new RateLimiterServiceUnavailableError(
        'Shared rate limit RPC (/rpc/check_ai_rate_limit) not found on database server'
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw new RateLimiterServiceUnavailableError(
        `Shared rate limit database authentication error (HTTP ${res.status})`
      );
    }

    if (!res.ok) {
      throw new RateLimiterServiceUnavailableError(
        `Shared rate limit database error (HTTP ${res.status})`
      );
    }

    try {
      const data = await res.json();
      return {
        allowed: Boolean(data.allowed),
        count: Number(data.count ?? 1),
        resetAt: Number(data.reset_at ?? Date.now() + windowMs),
      };
    } catch (err) {
      throw new RateLimiterServiceUnavailableError('Failed to parse database rate limit response', err);
    }
  }

  public reset(_key?: string): void {
    // In production, reset on remote DB is not supported via client side
  }
}

/**
 * 3. Upstash Redis REST Store (Optional for Serverless / Cloud Multi-region deployments)
 * In production:
 * - Requires HTTPS.
 * - Requires UPSTASH_REDIS_REST_TOKEN.
 * - On failure, fails closed with RateLimiterServiceUnavailableError.
 */
export class UpstashRedisRateLimiterStore implements IRateLimiterStore {
  constructor(
    private getRestUrl: () => string | undefined = () => process.env.UPSTASH_REDIS_REST_URL,
    private getRestToken: () => string | undefined = () => process.env.UPSTASH_REDIS_REST_TOKEN
  ) {}

  public async consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const rawUrl = this.getRestUrl();
    if (!rawUrl || !rawUrl.trim()) {
      throw new RateLimiterConfigurationError('UPSTASH_REDIS_REST_URL is required for Redis rate limiting');
    }

    const restUrl = rawUrl.trim().replace(/\/$/, '');
    if (!restUrl.startsWith('https://')) {
      throw new RateLimiterConfigurationError(
        `Insecure HTTP protocol is prohibited for Redis rate limiting: ${restUrl}. Must use HTTPS.`
      );
    }

    const restToken = this.getRestToken();
    if (!restToken || !restToken.trim()) {
      throw new RateLimiterConfigurationError('UPSTASH_REDIS_REST_TOKEN is required for Redis rate limiting');
    }

    const windowSec = Math.ceil(windowMs / 1000);
    let res: Response;
    try {
      const redisKey = `ratelimit:ai:${key}`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);

      try {
        res = await fetch(`${restUrl}/pipeline`, {
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
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (err) {
      throw new RateLimiterServiceUnavailableError(
        `Redis rate limit connection failed: ${err instanceof Error ? err.message : String(err)}`,
        err
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw new RateLimiterServiceUnavailableError(
        `Redis rate limit authentication error (HTTP ${res.status})`
      );
    }

    if (!res.ok) {
      throw new RateLimiterServiceUnavailableError(
        `Redis rate limit server error (HTTP ${res.status})`
      );
    }

    try {
      const results = await res.json();
      const count = Number(results[0]?.result ?? 1);
      const ttl = Number(results[2]?.result ?? windowSec);
      const resetAt = Date.now() + Math.max(ttl, 1) * 1000;
      return {
        allowed: count <= limit,
        count,
        resetAt,
      };
    } catch (err) {
      throw new RateLimiterServiceUnavailableError('Failed to parse Redis rate limit response', err);
    }
  }

  public reset(_key?: string): void {}
}

// Global default instances
export const defaultMemoryStore = new MemoryRateLimiterStore();
export const defaultPostgresStore = new PostgresRateLimiterStore();
export const defaultUpstashStore = new UpstashRedisRateLimiterStore();

let customLimiterStore: IRateLimiterStore | null = null;

export function setCustomLimiterStore(store: IRateLimiterStore | null): void {
  customLimiterStore = store;
}

/**
 * Checks whether the environment is explicit local development/testing mode.
 * In production (NODE_ENV === 'production'), local in-memory rate limiting is strictly prohibited
 * and cannot be enabled via flags to prevent bypassing multi-server distributed limits.
 */
export function isLocalDevMode(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }
  if (process.env.USE_LOCAL_IN_MEMORY_RATE_LIMIT === 'true') return true;
  if (process.env.NEXT_PUBLIC_USE_IN_MEMORY === 'true') return true;
  return true;
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
  if (process.env.UPSTASH_REDIS_REST_URL) {
    return defaultUpstashStore;
  }

  return defaultPostgresStore;
}
