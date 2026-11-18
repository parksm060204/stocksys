import { NextResponse } from 'next/server';
import { resolveAuthenticatedUserId } from '@/lib/auth/sessionAuth';
import { ensureLocalStandaloneReady, persistConfirmedState } from '@/lib/engine/localStandaloneServer';
import { memoryDb } from '@/lib/memoryDb/memoryStore';
import { withAccountLocks } from '@/lib/memoryDb/accountLocks';
import { runWithCommitGate } from '@/lib/memoryDb/PersistenceManager';
import { getAvailableCashKrw } from '@/lib/engine/orderRisk';
import {
  MEDIA_OUTLETS,
  SHOP_PRODUCTS,
  calculateNewsSubscriptionPrice,
  pruneExpiredProfileEntitlements,
} from '@/lib/shop/catalog';

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
      if (typeof productId !== 'string' || !SHOP_PRODUCTS[productId]) {
        return NextResponse.json(
          { success: false, message: '존재하지 않는 상점 상품입니다.' },
          { status: 400 }
        );
      }

      const product = SHOP_PRODUCTS[productId];
      if (product.availableForPurchase === false) {
        return NextResponse.json(
          { success: false, message: `${product.name}은(는) 기능 개편으로 신규 판매가 일시 중단되었습니다.` },
          { status: 410 }
        );
      }
      const result = await withAccountLocks([authenticatedUserId], async () => {
        return await runWithCommitGate(persistConfirmedState, async () => {
          const profile = memoryDb.profiles.get(authenticatedUserId);
          if (!profile) {
            return { success: false, status: 404, message: '사용자 프로필을 찾을 수 없습니다.' };
          }

          const nowMs = Date.now();
          const pruned = pruneExpiredProfileEntitlements(profile, nowMs);

          if (product.id === 'options_license' && profile.has_options_license) {
            return { success: false, status: 409, message: '이미 파생상품 옵션 거래 자격증을 보유하고 있습니다.' };
          }
          if (product.id !== 'options_license' && pruned.unlocked_features.includes(product.id)) {
            return { success: false, status: 409, message: `이미 보유 또는 활성화 중인 상품입니다: ${product.name}` };
          }

          const { availableCash, reservedCash } = getAvailableCashKrw(memoryDb, authenticatedUserId);
          if (!Number.isFinite(availableCash) || availableCash < product.price) {
            return {
              success: false,
              status: 400,
              message: `가용 예수금이 부족합니다. 필요 금액: ₩${product.price.toLocaleString()}, 가용 예수금: ₩${Math.floor(availableCash).toLocaleString()} (주문 예약금: ₩${reservedCash.toLocaleString()})`,
            };
          }

          const prevCash = profile.cash;
          const prevLicense = profile.has_options_license;
          const prevUnlocked = [...(profile.unlocked_features || [])];
          const prevExpiries = { ...(profile.feature_expiries || {}) };

          profile.cash = Math.round((profile.cash - product.price) * 100) / 100;
          if (product.id === 'options_license') {
            profile.has_options_license = true;
          } else {
            if (!profile.unlocked_features) profile.unlocked_features = [];
            if (!profile.unlocked_features.includes(product.id)) {
              profile.unlocked_features.push(product.id);
            }
            if (product.durationDays !== null) {
              const expiryIso = new Date(nowMs + product.durationDays * 24 * 60 * 60 * 1000).toISOString();
              profile.feature_expiries = { ...(profile.feature_expiries || {}), [product.id]: expiryIso };
            }
          }

          const saved = await persistConfirmedState();
          if (!saved) {
            profile.cash = prevCash;
            profile.has_options_license = prevLicense;
            profile.unlocked_features = prevUnlocked;
            profile.feature_expiries = prevExpiries;
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
        });
      });

      if (!result.success) {
        return NextResponse.json({ success: false, message: result.message }, { status: result.status });
      }
      return NextResponse.json(result);
    }

    if (itemType === 'news_subscription') {
      const numericOutletId = Number(outletId);
      const numericDays = Number(days);
      const outlet = MEDIA_OUTLETS.find((o) => o.id === numericOutletId);
      if (!outlet) {
        return NextResponse.json(
          { success: false, message: '존재하지 않는 언론사입니다.' },
          { status: 404 }
        );
      }

      const price = calculateNewsSubscriptionPrice(outlet.subscription_fee, numericDays);
      if (price === null) {
        return NextResponse.json(
          { success: false, message: '구독 기간은 30일, 90일, 365일 중 하나여야 합니다.' },
          { status: 400 }
        );
      }

      const result = await withAccountLocks([authenticatedUserId], async () => {
        return await runWithCommitGate(persistConfirmedState, async () => {
          const profile = memoryDb.profiles.get(authenticatedUserId);
          if (!profile) {
            return { success: false, status: 404, message: '사용자 프로필을 찾을 수 없습니다.' };
          }

          const nowMs = Date.now();
          const pruned = pruneExpiredProfileEntitlements(profile, nowMs);
          const subKey = String(outlet.id);
          if (pruned.news_subscriptions[subKey]) {
            return { success: false, status: 409, message: `이미 구독 중인 언론사입니다: ${outlet.name}` };
          }

          const { availableCash, reservedCash } = getAvailableCashKrw(memoryDb, authenticatedUserId);
          if (!Number.isFinite(availableCash) || availableCash < price) {
            return {
              success: false,
              status: 400,
              message: `가용 예수금이 부족합니다. 필요 금액: ₩${price.toLocaleString()}, 가용 예수금: ₩${Math.floor(availableCash).toLocaleString()} (주문 예약금: ₩${reservedCash.toLocaleString()})`,
            };
          }

          const prevCash = profile.cash;
          const prevSubs = { ...(profile.news_subscriptions || {}) };
          const expiryIso = new Date(nowMs + numericDays * 24 * 60 * 60 * 1000).toISOString();

          profile.cash = Math.round((profile.cash - price) * 100) / 100;
          profile.news_subscriptions = { ...prevSubs, [subKey]: expiryIso };

          const saved = await persistConfirmedState();
          if (!saved) {
            profile.cash = prevCash;
            profile.news_subscriptions = prevSubs;
            return { success: false, status: 500, message: '구독 결제 영속 저장에 실패했습니다.' };
          }

          return {
            success: true,
            status: 200,
            message: `${outlet.name} 구독권 결제가 완료되었습니다.`,
            cash: profile.cash,
            news_subscriptions: profile.news_subscriptions,
          };
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
