import { sanitizePublicNewsRecord } from '@/lib/engine/simulation/marketEventTypes';

export interface NewsAccessProfile {
  is_admin?: boolean;
  news_subscriptions?: Record<string, string>;
}

export const MASKED_RUMOR_MESSAGE =
  '[프리미엄 구독 필요] 언론사 구독 후 전체 찌라시 본문을 열람할 수 있습니다.';

/**
 * Pure entitlement check for RUMOR news content.
 * Grants access only when the viewer is an admin or holds at least one
 * unexpired news subscription relative to `nowMs`. Never mutates `profile`.
 */
export function canReadRumor(
  profile?: { is_admin?: boolean; news_subscriptions?: Record<string, string> } | null,
  nowMs?: number
): boolean {
  if (!profile || typeof profile !== 'object') {
    return false;
  }
  if (profile.is_admin === true) {
    return true;
  }
  const subs = profile.news_subscriptions;
  if (!subs || typeof subs !== 'object' || Array.isArray(subs)) {
    return false;
  }
  const effectiveNowMs =
    typeof nowMs === 'number' && Number.isFinite(nowMs) ? nowMs : Date.now();
  for (const expIso of Object.values(subs)) {
    if (typeof expIso !== 'string' || expIso.trim() === '') {
      continue;
    }
    const expMs = Date.parse(expIso);
    if (Number.isFinite(expMs) && expMs > effectiveNowMs) {
      return true;
    }
  }
  return false;
}

/**
 * Strips internal simulation truth fields and masks RUMOR body fields when
 * `hasRumorAccess` is false. Returns a new object without mutating `record`.
 */
export function authorizeNewsRecord(record: any, hasRumorAccess: boolean): any {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return record;
  }
  const sanitized = sanitizePublicNewsRecord(record) as Record<string, any>;
  const {
    is_rumor_fake: _isRumorFakeSnake,
    corrected_at: _correctedAtSnake,
    ...safe
  } = sanitized;

  const rawCategory = safe.category ?? safe.news_type ?? safe.eventType;
  const isRumor =
    typeof rawCategory === 'string' && rawCategory.trim().toUpperCase() === 'RUMOR';

  if (isRumor && !hasRumorAccess) {
    const maskedRecord: Record<string, any> = {
      ...safe,
      content: MASKED_RUMOR_MESSAGE,
      locked: true,
    };
    if ('summary' in safe && safe.summary !== undefined && safe.summary !== null && safe.summary !== '') {
      maskedRecord.summary = MASKED_RUMOR_MESSAGE;
    }
    if ('body' in safe && safe.body !== undefined && safe.body !== null && safe.body !== '') {
      maskedRecord.body = MASKED_RUMOR_MESSAGE;
    }
    return maskedRecord;
  }

  return {
    ...safe,
    locked: false,
  };
}
