import { NextResponse } from 'next/server';
import { resolveAuthenticatedUserId } from '@/lib/auth/sessionAuth';
import { ensureLocalStandaloneReady, persistConfirmedState } from '@/lib/engine/localStandaloneServer';
import { memoryDb } from '@/lib/memoryDb/memoryStore';
import { withResolvedAccountLocks } from '@/lib/memoryDb/accountLocks';
import { runWithCommitGate } from '@/lib/memoryDb/PersistenceManager';
import { getAvailableCashKrw } from '@/lib/engine/orderRisk';
import {
  MEDIA_OUTLETS,
  calculateNewsSubscriptionPrice,
  getShopProductById,
  pruneExpiredProfileEntitlements,
} from '@/lib/shop/catalog';

function restoreProfileSnapshot(profile: Record<string, any>, snapshot: Record<string, any>): void {
  for (const key of Object.keys(profile)) {
    if (!(key in snapshot)) {
      delete profile[key];
    }
  }
  Object.assign(profile, snapshot);
}

function parseStrictPositiveInt(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

export async function POST(req: Request) {
  try {
    await ensureLocalStandaloneReady();

    const authenticatedUserId = await resolveAuthenticatedUserId();
    if (!authenticatedUserId) {
      return NextResponse.json(
        { success: false, message: '로그인이 필요한 서비스입니다.' },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, message: '올바른 요청 형식이 아닙니다.' },
        { status: 400 }
      );
    }

    const { itemType, productId, outletId, days } = body;

    if (itemType === 'product') {
      const product = getShopProductById(productId);
      if (!product) {
        return NextResponse.json(
          { success: false, message: '존재하지 않는 상점 상품입니다.' },
          { status: 400 }
        );
      }
      if (product.availableForPurchase === false) {
        return NextResponse.json(
          { success: false, message: `${product.name}은(는) 기능 개편으로 신규 판매가 일시 중단되었습니다.` },
          { status: 410 }
        );
      }
      const result = await withResolvedAccountLocks(() => [memoryDb.resolveAccountLockKey(authenticatedUserId)], async () => {
        return await runWithCommitGate(persistConfirmedState, async () => {
          const profile = memoryDb.resolveProfileByUserId(authenticatedUserId);
          if (!profile) {
            return { success: false, status: 404, message: '사용자 프로필을 찾을 수 없습니다.' };
          }
          if (typeof profile.cash !== 'number' || !Number.isFinite(profile.cash)) {
            return { success: false, status: 500, message: '계좌 예수금 상태가 유효하지 않습니다.' };
          }

          const profileSnapshot = structuredClone(profile);
          try {
            const nowMs = Date.now();
            const pruned = pruneExpiredProfileEntitlements(profile, nowMs);

            if (product.id === 'options_license' && profile.has_options_license) {
              restoreProfileSnapshot(profile, profileSnapshot);
              return { success: false, status: 409, message: '이미 파생상품 옵션 거래 자격증을 보유하고 있습니다.' };
            }
            if (product.id !== 'options_license' && pruned.unlocked_features.includes(product.id)) {
              restoreProfileSnapshot(profile, profileSnapshot);
              return { success: false, status: 409, message: `이미 보유 또는 활성화 중인 상품입니다: ${product.name}` };
            }

            const { availableCash, reservedCash } = getAvailableCashKrw(memoryDb, authenticatedUserId);
            if (!Number.isFinite(availableCash) || availableCash < product.price) {
              restoreProfileSnapshot(profile, profileSnapshot);
              return {
                success: false,
                status: 400,
                message: `가용 예수금이 부족합니다. 필요 금액: ₩${product.price.toLocaleString()}, 가용 예수금: ₩${Math.floor(availableCash).toLocaleString()} (주문 예약금: ₩${reservedCash.toLocaleString()})`,
              };
            }

            const nextCash = Math.round((profile.cash - product.price) * 100) / 100;
            if (!Number.isFinite(nextCash) || nextCash < 0) {
              restoreProfileSnapshot(profile, profileSnapshot);
              return { success: false, status: 400, message: '결제 후 잔액 계산이 유효하지 않습니다.' };
            }

            profile.cash = nextCash;
            if (product.id === 'options_license') {
              profile.has_options_license = true;
            } else {
              if (!profile.unlocked_features) profile.unlocked_features = [];
              if (!profile.unlocked_features.includes(product.id)) {
                profile.unlocked_features.push(product.id);
              }
              if (product.durationDays !== null) {
                const expiryMs = nowMs + product.durationDays * 24 * 60 * 60 * 1000;
                if (!Number.isFinite(expiryMs)) {
                  restoreProfileSnapshot(profile, profileSnapshot);
                  return { success: false, status: 400, message: '상품 만료 기간 계산이 유효하지 않습니다.' };
                }
                const expiryIso = new Date(expiryMs).toISOString();
                profile.feature_expiries = { ...(profile.feature_expiries || {}), [product.id]: expiryIso };
              }
            }

            const saved = await persistConfirmedState();
            if (!saved) {
              restoreProfileSnapshot(profile, profileSnapshot);
              return { success: false, status: 500, message: '구매 내역 영속 저장에 실패했습니다.' };
            }

            return {
              success: true,
              status: 200,
              message: `${product.name} 구매가 완료되었습니다.`,
              cash: profile.cash,
              has_options_license: Boolean(profile.has_options_license),
              unlocked_features: profile.unlocked_features || [],
              feature_expiries: profile.feature_expiries || {},
              news_subscriptions: profile.news_subscriptions || {},
            };
          } catch (err: any) {
            restoreProfileSnapshot(profile, profileSnapshot);
            return {
              success: false,
              status: 500,
              message: err?.message || '상점 구매 처리 중 오류가 발생하여 롤백되었습니다.',
            };
          }
        });
      });

      if (!result.success) {
        return NextResponse.json({ success: false, message: result.message }, { status: result.status });
      }
      return NextResponse.json(result);
    }

    if (itemType === 'news_subscription') {
      const numericOutletId = parseStrictPositiveInt(outletId);
      const numericDays = parseStrictPositiveInt(days);
      if (numericOutletId === null) {
        return NextResponse.json(
          { success: false, message: '존재하지 않는 언론사입니다.' },
          { status: 404 }
        );
      }
      const outlet = MEDIA_OUTLETS.find((o) => o.id === numericOutletId);
      if (!outlet) {
        return NextResponse.json(
          { success: false, message: '존재하지 않는 언론사입니다.' },
          { status: 404 }
        );
      }

      const price = numericDays !== null ? calculateNewsSubscriptionPrice(outlet.subscription_fee, numericDays) : null;
      if (price === null || !Number.isFinite(price) || price < 0) {
        return NextResponse.json(
          { success: false, message: '구독 기간은 30일, 90일, 365일 중 하나여야 합니다.' },
          { status: 400 }
        );
      }

      const result = await withResolvedAccountLocks(() => [memoryDb.resolveAccountLockKey(authenticatedUserId)], async () => {
        return await runWithCommitGate(persistConfirmedState, async () => {
          const profile = memoryDb.resolveProfileByUserId(authenticatedUserId);
          if (!profile) {
            return { success: false, status: 404, message: '사용자 프로필을 찾을 수 없습니다.' };
          }
          if (typeof profile.cash !== 'number' || !Number.isFinite(profile.cash)) {
            return { success: false, status: 500, message: '계좌 예수금 상태가 유효하지 않습니다.' };
          }

          const profileSnapshot = structuredClone(profile);
          try {
            const nowMs = Date.now();
            const pruned = pruneExpiredProfileEntitlements(profile, nowMs);
            const subKey = String(outlet.id);
            if (pruned.news_subscriptions[subKey]) {
              restoreProfileSnapshot(profile, profileSnapshot);
              return { success: false, status: 409, message: `이미 구독 중인 언론사입니다: ${outlet.name}` };
            }

            const { availableCash, reservedCash } = getAvailableCashKrw(memoryDb, authenticatedUserId);
            if (!Number.isFinite(availableCash) || availableCash < price) {
              restoreProfileSnapshot(profile, profileSnapshot);
              return {
                success: false,
                status: 400,
                message: `가용 예수금이 부족합니다. 필요 금액: ₩${price.toLocaleString()}, 가용 예수금: ₩${Math.floor(availableCash).toLocaleString()} (주문 예약금: ₩${reservedCash.toLocaleString()})`,
              };
            }

            const nextCash = Math.round((profile.cash - price) * 100) / 100;
            if (!Number.isFinite(nextCash) || nextCash < 0) {
              restoreProfileSnapshot(profile, profileSnapshot);
              return { success: false, status: 400, message: '결제 후 잔액 계산이 유효하지 않습니다.' };
            }

            const expiryIso = new Date(nowMs + numericDays! * 24 * 60 * 60 * 1000).toISOString();

            profile.cash = nextCash;
            profile.news_subscriptions = { ...(profile.news_subscriptions || {}), [subKey]: expiryIso };

            const saved = await persistConfirmedState();
            if (!saved) {
              restoreProfileSnapshot(profile, profileSnapshot);
              return { success: false, status: 500, message: '구독 결제 영속 저장에 실패했습니다.' };
            }

            return {
              success: true,
              status: 200,
              message: `${outlet.name} 구독권 결제가 완료되었습니다.`,
              cash: profile.cash,
              news_subscriptions: profile.news_subscriptions,
            };
          } catch (err: any) {
            restoreProfileSnapshot(profile, profileSnapshot);
            return {
              success: false,
              status: 500,
              message: err?.message || '구독 결제 처리 중 오류가 발생하여 롤백되었습니다.',
            };
          }
        });
      });

      if (!result.success) {
        return NextResponse.json({ success: false, message: result.message }, { status: result.status });
      }
      return NextResponse.json(result);
    }

    return NextResponse.json(
      { success: false, message: '유효하지 않은 itemType입니다.' },
      { status: 400 }
    );
  } catch (err: any) {
    console.error('[POST /api/shop/purchase Error]', err);
    return NextResponse.json(
      { success: false, message: err?.message || '상점 구매 처리 중 오류가 발생했습니다.' },
      { status: 500 }
    );
  }
}
