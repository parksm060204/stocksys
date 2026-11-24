import { memoryDb, type MarketNewsRecord } from '@/lib/memoryDb/memoryStore';
import { authorizeNewsRecord, canReadRumor } from '@/lib/news/accessPolicy';
import { WindowRateLimiter } from '@/lib/rateLimit/windowLimiter';

const manualStepLimiter = new WindowRateLimiter(15, 1000, 60_000, 256, true);

export function allowManualStep(adminUser: string): boolean {
  return manualStepLimiter.allow(adminUser);
}

export function parseMarketFlowStepBody(body: unknown): { ok: true; dt: number } | { ok: false; message: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: 'Request body must be a JSON object.' };
  }
  const input = body as { action?: unknown; dt?: unknown };
  if (input.action !== 'step') {
    return { ok: false, message: 'action must be "step".' };
  }
  if (typeof input.dt !== 'number' || !Number.isFinite(input.dt) || input.dt < 0.1 || input.dt > 10) {
    return { ok: false, message: 'dt must be a finite number between 0.1 and 10 seconds.' };
  }
  return { ok: true, dt: input.dt };
}

export function parsePointsLimit(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) return 60;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return 60;
  return Math.min(120, Math.max(10, parsed));
}

export function resolveViewerRumorAccess(authenticatedUserId: string | null): boolean {
  if (!authenticatedUserId) return false;
  const viewerProfile = memoryDb.resolveProfileByUserId(authenticatedUserId);
  return canReadRumor(viewerProfile);
}

export function sanitizeMarketFlowRecentNews(recentNews: any[], hasRumorAccess: boolean) {
  if (!Array.isArray(recentNews)) return recentNews;
  const newsById = new Map<string, MarketNewsRecord>();
  for (const rec of memoryDb.marketNews) {
    if (rec?.id) newsById.set(rec.id, rec);
  }
  return recentNews.map((item) => {
    if (!item || typeof item !== 'object') return item;
    const source = typeof item.id === 'string' ? newsById.get(item.id) : undefined;
    const category =
      source?.category ??
      (source as any)?.news_type ??
      (source as any)?.eventType ??
      item.category ??
      item.news_type ??
      item.eventType;
    return authorizeNewsRecord(
      category !== undefined ? { ...item, category } : item,
      hasRumorAccess
    );
  });
}
