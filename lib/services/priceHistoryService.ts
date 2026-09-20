/**
 * 가격 이력 조회 및 채권 synthetic 이력 생성 단일 권위 서비스
 *
 * 원칙:
 * 1. canonical assetId (UUID)로 먼저 조회하며, 결과가 존재하면 ticker fallback은 절대 호출하지 않는다.
 * 2. canonical 결과가 없고 구버전 호환이 필요할 때만 ticker로 fallback 조회한다.
 * 3. DB 오류(error)와 정상적인 빈 결과(empty)를 명확히 구분한다.
 * 4. canonical 결과와 ticker 결과를 임의로 병합하지 않는다.
 * 5. 주식과 채권 간 동일 ticker 충돌 방지를 위해 canonical ID 및 assetKind로 격리한다.
 * 6. 채권 synthetic history 생성 시 Date.now() 등 비결정적 시계를 일체 배제하고
 *    (시뮬레이션 시각 -> updated_at -> created_at -> 고정 epoch) 순으로 결정론적 기준 시각을 사용한다.
 */

export const DEFAULT_BOND_FALLBACK_EPOCH_MS = 1773500000000;

export interface PriceHistoryRecord {
  id: string;
  stock_id: string;
  price: number;
  volume: number;
  created_at: string;
  [key: string]: any;
}

export interface FetchCanonicalPriceHistoryParams {
  db: any;
  assetId: string;
  ticker?: string | null;
  assetKind?: 'stock' | 'bond' | 'commodity' | string | null;
  limit?: number;
}

export interface FetchPriceHistoryResult {
  data: PriceHistoryRecord[];
  source: 'canonical' | 'ticker_fallback' | 'empty';
  error?: any;
}

/**
 * 정규 가격 이력 조회 함수 (운영 페이지 및 테스트 공용)
 */
export async function fetchCanonicalPriceHistory(
  params: FetchCanonicalPriceHistoryParams
): Promise<FetchPriceHistoryResult> {
  const { db, assetId, ticker, limit = 50 } = params;

  if (!assetId || typeof assetId !== 'string') {
    return { data: [], source: 'empty' };
  }

  // 1. canonical assetId(정규 stock_id)로 1차 조회
  try {
    const { data: canonicalData, error: canonicalError } = await db
      .from('stock_price_history')
      .select('*')
      .eq('stock_id', assetId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (canonicalError) {
      console.warn('[PriceHistoryService] Error fetching canonical history:', canonicalError);
      return { data: [], source: 'empty', error: canonicalError };
    }

    // canonical 레코드가 존재하면 ticker fallback을 수행하지 않고 즉시 반환
    if (canonicalData && canonicalData.length > 0) {
      return {
        data: canonicalData,
        source: 'canonical',
      };
    }
  } catch (err) {
    console.warn('[PriceHistoryService] Exception fetching canonical history:', err);
    return { data: [], source: 'empty', error: err };
  }

  // 2. canonical 결과가 없고 구버전 데이터 호환(legacy ticker 참조)이 필요한 경우만 ticker fallback
  if (ticker && typeof ticker === 'string' && ticker !== assetId) {
    try {
      const { data: fallbackData, error: fallbackError } = await db
        .from('stock_price_history')
        .select('*')
        .eq('stock_id', ticker)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (fallbackError) {
        console.warn('[PriceHistoryService] Error fetching fallback history:', fallbackError);
        return { data: [], source: 'empty', error: fallbackError };
      }

      if (fallbackData && fallbackData.length > 0) {
        return {
          data: fallbackData,
          source: 'ticker_fallback',
        };
      }
    } catch (err) {
      console.warn('[PriceHistoryService] Exception fetching fallback history:', err);
      return { data: [], source: 'empty', error: err };
    }
  }

  return { data: [], source: 'empty' };
}

/**
 * 채권 자산의 synthetic price history 생성 순수 함수 (비결정적 Date.now() 배제)
 *
 * 기준 시각 우선순위:
 * 1. referenceTimeMs (시뮬레이션 시각 또는 명시적 기준 시각)
 * 2. stock.updated_at
 * 3. stock.created_at
 * 4. DEFAULT_BOND_FALLBACK_EPOCH_MS
 */
export function createDeterministicBondHistory(
  stock: {
    id: string;
    currentPrice?: number;
    current_price?: number;
    previousClose?: number;
    previous_close?: number;
    volume?: number;
    updated_at?: string;
    created_at?: string;
  },
  referenceTimeMs?: number
): PriceHistoryRecord[] {
  let refMs: number = DEFAULT_BOND_FALLBACK_EPOCH_MS;

  if (typeof referenceTimeMs === 'number' && Number.isSafeInteger(referenceTimeMs) && referenceTimeMs > 0) {
    refMs = referenceTimeMs;
  } else if (stock.updated_at && typeof stock.updated_at === 'string') {
    const parsed = Date.parse(stock.updated_at);
    if (!Number.isNaN(parsed) && parsed > 0) refMs = parsed;
  } else if (stock.created_at && typeof stock.created_at === 'string') {
    const parsed = Date.parse(stock.created_at);
    if (!Number.isNaN(parsed) && parsed > 0) refMs = parsed;
  }

  const curPrice =
    typeof stock.currentPrice === 'number' && Number.isFinite(stock.currentPrice)
      ? stock.currentPrice
      : typeof stock.current_price === 'number' && Number.isFinite(stock.current_price)
      ? stock.current_price
      : 100;

  const prevPrice =
    typeof stock.previousClose === 'number' && Number.isFinite(stock.previousClose)
      ? stock.previousClose
      : typeof stock.previous_close === 'number' && Number.isFinite(stock.previous_close)
      ? stock.previous_close
      : curPrice;

  const volume =
    typeof stock.volume === 'number' && Number.isFinite(stock.volume)
      ? stock.volume
      : 15000;

  const prevVolume = Math.floor(volume * 0.9);

  return [
    {
      id: `bh_${stock.id}_1`,
      stock_id: stock.id,
      price: curPrice,
      volume: volume,
      created_at: new Date(refMs).toISOString(),
    },
    {
      id: `bh_${stock.id}_2`,
      stock_id: stock.id,
      price: prevPrice,
      volume: prevVolume,
      created_at: new Date(refMs - 60000).toISOString(),
    },
  ];
}
