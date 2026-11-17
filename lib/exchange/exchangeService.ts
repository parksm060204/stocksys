import type { MemoryDatabase, ProfileRecord } from '@/lib/memoryDb/memoryStore';
import type { ExchangeRateRecord } from '@/lib/repositories/types';
import { withAccountLocks } from '@/lib/memoryDb/accountLocks';
import { runWithCommitGate } from '@/lib/memoryDb/PersistenceManager';
import { getAvailableCashKrw } from '@/lib/engine/orderRisk';

export type SupportedCurrency = 'KRW' | 'USD' | 'EUR' | 'JPY' | 'CNY' | 'GBP';

const CURRENCY_FIELD_MAP: Record<SupportedCurrency, keyof ProfileRecord> = {
  KRW: 'cash',
  USD: 'usd_balance',
  EUR: 'eur_balance',
  JPY: 'jpy_balance',
  CNY: 'cny_balance',
  GBP: 'gbp_balance',
};

const CURRENCY_SCALE_MAP: Record<SupportedCurrency, number> = {
  KRW: 1,
  JPY: 1,
  USD: 100,
  EUR: 100,
  CNY: 100,
  GBP: 100,
};

export function isSupportedCurrency(code: unknown): code is SupportedCurrency {
  return typeof code === 'string' && code in CURRENCY_FIELD_MAP;
}

function roundCurrency(currency: SupportedCurrency, amount: number): number {
  const scale = CURRENCY_SCALE_MAP[currency];
  return Math.round(amount * scale) / scale;
}

function floorCurrency(currency: SupportedCurrency, amount: number): number {
  const scale = CURRENCY_SCALE_MAP[currency];
  return Math.floor(amount * scale + 1e-11) / scale;
}

/**
 * 권위 ExchangeRateRecord 스키마(currency_code, rate_to_krw)에서 기준 환율 조회.
 */
export function getCurrencyRateToKrw(
  db: Pick<MemoryDatabase, 'exchangeRates'>,
  currencyCode: string
): number | null {
  const target = currencyCode.trim().toUpperCase();
  const row: ExchangeRateRecord | undefined = db.exchangeRates?.find(
    (r) => String(r.currency_code || '').toUpperCase() === target
  );
  if (!row) return null;
  const rate = Number(row.rate_to_krw);
  return Number.isFinite(rate) && rate > 0 ? rate : null;
}

export interface ExchangeResult {
  success: boolean;
  statusCode: number;
  message: string;
  data?: {
    from_cur: SupportedCurrency;
    to_cur: SupportedCurrency;
    from_amount: number;
    to_amount: number;
    conversion_rate: number;
    fee_amount: number;
    from_balance: number;
    to_balance: number;
  };
}

export async function executeCurrencyExchange(params: {
  db: MemoryDatabase;
  userId: string;
  fromCur: unknown;
  toCur: unknown;
  amount: unknown;
  onPersist?: () => Promise<boolean>;
}): Promise<ExchangeResult> {
  const { db, userId, fromCur, toCur, amount, onPersist } = params;

  if (!isSupportedCurrency(fromCur) || !isSupportedCurrency(toCur)) {
    return {
      success: false,
      statusCode: 400,
      message: '지원하지 않는 통화 코드입니다. (KRW, USD, EUR, JPY, CNY, GBP만 지원)',
    };
  }

  if (fromCur === toCur) {
    return {
      success: false,
      statusCode: 400,
      message: '동일한 통화 간의 환전은 불가능합니다.',
    };
  }

  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
    return {
      success: false,
      statusCode: 400,
      message: '환전 금액은 0보다 큰 유한한 숫자여야 합니다.',
    };
  }

  const fromRate = getCurrencyRateToKrw(db, fromCur);
  const toRate = getCurrencyRateToKrw(db, toCur);

  if (fromRate === null || toRate === null) {
    return {
      success: false,
      statusCode: 500,
      message: '서버 환율 정보를 확인할 수 없습니다.',
    };
  }

  // 송금 금액과 수취 금액 모두 통화 최소 정산 단위로 내림(floor)하여 반올림 차익(무한 왕복 가치 생성)을 차단
  const normalizedFromAmount = floorCurrency(fromCur, amount);
  if (!Number.isFinite(normalizedFromAmount) || normalizedFromAmount <= 0) {
    return {
      success: false,
      statusCode: 400,
      message: '환전 금액이 최소 단위보다 작습니다.',
    };
  }

  const conversionRate = fromRate / toRate;
  const rawToAmount = (normalizedFromAmount * fromRate) / toRate;
  const toAmount = floorCurrency(toCur, rawToAmount);
  if (!Number.isFinite(toAmount) || toAmount <= 0) {
    return {
      success: false,
      statusCode: 400,
      message: '환전 결과 금액이 최소 정산 단위보다 작습니다.',
    };
  }

  return withAccountLocks([userId], async () => {
    return runWithCommitGate(onPersist, async () => {
      const profile = db.profiles.get(userId);
      if (!profile) {
        return {
          success: false,
          statusCode: 404,
          message: '사용자 프로필을 찾을 수 없습니다.',
        };
      }

      const fromField = CURRENCY_FIELD_MAP[fromCur];
      const toField = CURRENCY_FIELD_MAP[toCur];
      const currentFromBal = Number(profile[fromField] ?? 0);
      const currentToBal = Number(profile[toField] ?? 0);

      if (fromCur === 'KRW') {
        const { availableCash, reservedCash } = getAvailableCashKrw(db, userId);
        if (!Number.isFinite(availableCash) || availableCash < normalizedFromAmount) {
          return {
            success: false,
            statusCode: 400,
            message: `가용 KRW 잔액이 부족합니다. (가용: ${availableCash.toLocaleString()}, 주문 예약: ${reservedCash.toLocaleString()}, 요청: ${normalizedFromAmount.toLocaleString()})`,
          };
        }
      } else if (!Number.isFinite(currentFromBal) || currentFromBal < normalizedFromAmount) {
        return {
          success: false,
          statusCode: 400,
          message: `보유 ${fromCur} 잔액이 부족합니다. (보유: ${currentFromBal.toLocaleString()}, 요청: ${normalizedFromAmount.toLocaleString()})`,
        };
      }

      const nextFromBal = roundCurrency(fromCur, currentFromBal - normalizedFromAmount);
      const nextToBal = roundCurrency(toCur, currentToBal + toAmount);

      (profile as any)[fromField] = nextFromBal;
      (profile as any)[toField] = nextToBal;

      if (onPersist) {
        const saved = await onPersist();
        if (!saved) {
          (profile as any)[fromField] = currentFromBal;
          (profile as any)[toField] = currentToBal;
          return {
            success: false,
            statusCode: 500,
            message: '환전 내역 영속 저장에 실패하여 환전을 롤백했습니다.',
          };
        }
      }

      return {
        success: true,
        statusCode: 200,
        message: '환전이 완료되었습니다.',
        data: {
          from_cur: fromCur,
          to_cur: toCur,
          from_amount: normalizedFromAmount,
          to_amount: toAmount,
          conversion_rate: conversionRate,
          fee_amount: 0,
          from_balance: nextFromBal,
          to_balance: nextToBal,
        },
      };
    });
  });
}
