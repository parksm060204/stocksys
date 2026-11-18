import type { ProfileRecord } from '@/lib/memoryDb/memoryStore';

export interface MediaOutletCatalogItem {
  id: number;
  name: string;
  type: string;
  reliability: number;
  subscription_fee: number;
  description: string;
}

export interface ShopProductDefinition {
  id: 'options_license' | 'custom_dashboard' | 'fee_booster' | 'scanner_item' | 'ai_predictor';
  name: string;
  price: number;
  durationDays: number | null; // null = 영구
  availableForPurchase?: boolean;
}

export const MEDIA_OUTLETS: MediaOutletCatalogItem[] = [
  {
    id: 1,
    name: '여의도 블룸버그 데스크',
    type: '속보/기관',
    reliability: 95,
    subscription_fee: 800000,
    description: '기관 수급, 블록딜, 외국인 매매 동향 및 M&A 속보를 가장 빠르게 전달하는 프리미엄 매체',
  },
  {
    id: 2,
    name: '글로벌 매크로 와이어',
    type: '거시경제',
    reliability: 90,
    subscription_fee: 650000,
    description: '연준 금리, 환율, 원자재, 글로벌 CPI 등 거시지표와 중앙은행 시그널 전문 분석 매체',
  },
  {
    id: 3,
    name: '테크 인사이더 코리아',
    type: '산업/테마',
    reliability: 85,
    subscription_fee: 500000,
    description: '반도체·AI·2차전지·바이오 섹터의 공급망 및 신기술 모멘텀 리포트 제공',
  },
  {
    id: 4,
    name: '마켓 루머스 데일리',
    type: '루머/테마',
    reliability: 62,
    subscription_fee: 300000,
    description: '시장 루머와 단기 급등락 테마를 빠르게 포착하지만 검증되지 않은 정보도 포함된 고위험 채널',
  },
];

export const SHOP_PRODUCTS: Record<string, ShopProductDefinition> = {
  options_license: {
    id: 'options_license',
    name: '파생상품 옵션 거래 자격증',
    price: 5000000,
    durationDays: null,
  },
  custom_dashboard: {
    id: 'custom_dashboard',
    name: '메인 대시보드 커스텀 라이선스',
    price: 3000000,
    durationDays: null,
  },
  fee_booster: {
    id: 'fee_booster',
    name: '거래 수수료 50% 감면 부스터 (30일)',
    price: 1000000,
    durationDays: 30,
    availableForPurchase: true,
  },
  scanner_item: {
    id: 'scanner_item',
    name: '기관 수급 실시간 스캐너 (30일)',
    price: 2000000,
    durationDays: 30,
    availableForPurchase: false,
  },
  ai_predictor: {
    id: 'ai_predictor',
    name: 'AI 시황 예측 신호 부스터 (30일)',
    price: 1500000,
    durationDays: 30,
    availableForPurchase: false,
  },
};

export function hasActiveFeeBooster(
  profile?: Pick<ProfileRecord, 'unlocked_features' | 'feature_expiries' | 'acquired_passives'> | null,
  nowMs: number = Date.now()
): boolean {
  if (!profile) return false;
  if (Array.isArray(profile.acquired_passives) && profile.acquired_passives.includes('fee_booster')) {
    return true;
  }
  if (!Array.isArray(profile.unlocked_features)) return false;
  if (!profile.unlocked_features.includes('fee_booster')) return false;
  const expiryIso = profile.feature_expiries?.fee_booster;
  if (!expiryIso) return true;
  const expMs = Date.parse(expiryIso);
  return Number.isFinite(expMs) && expMs > nowMs;
}

export function calculateNewsSubscriptionPrice(monthlyFee: number, days: number): number | null {
  if (days === 30) return monthlyFee;
  if (days === 90) return Math.round(monthlyFee * 3 * 0.95);
  if (days === 365) return Math.round(monthlyFee * 12 * 0.8);
  return null;
}

/**
 * 만료된 30일 기간제 기능 및 뉴스 구독을 정리하여 현재 유효한 권한만 반환한다.
 */
export function pruneExpiredProfileEntitlements(
  profile: ProfileRecord,
  nowMs: number = Date.now()
): {
  unlocked_features: string[];
  feature_expiries: Record<string, string>;
  news_subscriptions: Record<string, string>;
} {
  const rawUnlocked = Array.isArray(profile.unlocked_features) ? [...profile.unlocked_features] : [];
  const rawExpiries =
    profile.feature_expiries && typeof profile.feature_expiries === 'object'
      ? { ...profile.feature_expiries }
      : {};

  const activeExpiries: Record<string, string> = {};
  const activeUnlocked: string[] = [];

  for (const feat of rawUnlocked) {
    const expIso = rawExpiries[feat];
    if (expIso) {
      const expMs = Date.parse(expIso);
      if (Number.isFinite(expMs) && expMs > nowMs) {
        activeUnlocked.push(feat);
        activeExpiries[feat] = expIso;
      }
    } else {
      // 영구 해금 기능
      activeUnlocked.push(feat);
    }
  }

  const rawSubs =
    profile.news_subscriptions && typeof profile.news_subscriptions === 'object' && !Array.isArray(profile.news_subscriptions)
      ? profile.news_subscriptions
      : {};
  const activeSubs: Record<string, string> = {};
  for (const [outletId, expIso] of Object.entries(rawSubs)) {
    const expMs = Date.parse(String(expIso));
    if (Number.isFinite(expMs) && expMs > nowMs) {
      activeSubs[outletId] = String(expIso);
    }
  }

  profile.unlocked_features = activeUnlocked;
  profile.feature_expiries = activeExpiries;
  profile.news_subscriptions = activeSubs;

  return {
    unlocked_features: activeUnlocked,
    feature_expiries: activeExpiries,
    news_subscriptions: activeSubs,
  };
}
