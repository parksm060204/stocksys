/**
 * 가격 이력 조회 및 채권 synthetic 이력 생성 단일 권위 서비스
 *
 * 원칙:
 * 1. canonical assetId (UUID)로 먼저 조회하며, 결과가 존재하면 ticker fallback은 절대 호출하지 않는다.
 * 2. canonical 결과가 없고 구버전 호환이 필요할 때만 ticker로 fallback 조회한다.
 * 3. DB 오류(error)와 정상적인 빈 결과(empty)를 명확히 구분한다.
 *    - source: 'error' → DB 조회 실패. 오류 객체에 민감정보 포함하지 않음.
 *    - source: 'empty' → 정상 조회됐으나 데이터 없음.
 * 4. canonical 결과와 ticker 결과를 임의로 병합하지 않는다.
 * 5. assetKind 격리:
 *    - 현재 stock_price_history 스키마에는 asset_kind 컬럼이 없다.
 *    - 따라서 동일 ticker를 가진 이종 자산(주식/채권)의 스키마상 완전 격리는 불가능하다.
 *    - ticker fallback은 canonical ID로 구분되므로 실제 충돌 위험이 최소화된다.
 *    - 스키마 변경(asset_kind 컬럼 추가 또는 테이블 분리) 전까지 이 제한이 존재함을 명시한다.
 * 6. 채권 synthetic history 생성 시 Date.now() 등 비결정적 시계를 일체 배제하고
 *    (시뮬레이션 시각 → updated_at → created_at → 고정 epoch) 순으로 결정론적 기준 시각을 사용한다.
 * 7. DB 오류가 발생했을 때 synthetic bond history를 생성하지 않는다.
 *    정상 empty(source: 'empty')인 경우에만 채권 synthetic fallback을 허용한다.
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

/**
 * 민감정보를 제거한 안전한 가격 이력 오류 DTO.
 * DB 내부 세부사항, 연결 문자열, 계정 정보 등은 포함하지 않는다.
 */
export interface SafePriceHistoryError {
  readonly code: 'DB_QUERY_ERROR' | 'DB_EXCEPTION' | 'TICKER_FALLBACK_ERROR' | 'TICKER_FALLBACK_EXCEPTION';
  readonly message: string;
}

export type PriceHistorySource = 'canonical' | 'ticker_fallback' | 'empty' | 'error';

export interface FetchPriceHistoryResult {
  data: PriceHistoryRecord[];
  source: PriceHistorySource;
  error?: SafePriceHistoryError;
}

export interface FetchCanonicalPriceHistoryParams {
  db: any;
  assetId: string;
  ticker?: string | null;
  /**
   * assetKind는 현재 stock_price_history 스키마에 asset_kind 컬럼이 없어 쿼리에 사용되지 않는다.
   * 향후 스키마 확장(asset_kind 컬럼 추가 또는 테이블 분리) 시 이종 자산 격리에 활용 예정.
   * 현재는 문서화 목적으로만 유지한다.
   *
   * 현재 제한: 동일 ticker의 주식과 채권을 DB 쿼리 수준에서 완전 격리할 수 없다.
   * canonical assetId(UUID)로 조회하므로 실제 충돌 위험은 최소화된다.
   */
  assetKind?: 'stock' | 'bond' | 'commodity' | string | null;
  limit?: number;
}

/**
 * 정규 가격 이력 조회 함수 (운영 페이지 및 테스트 공용)
 *
 * 오류 정책:
 * - DB 오류 → source: 'error', error 포함 (민감정보 제거)
 * - 정상 조회 후 데이터 없음 → source: 'empty'
 * - 이 둘을 절대 혼용하지 않는다.
 *
 * assetKind 격리 한계:
 * - stock_price_history 테이블에 asset_kind 컬럼이 없어 쿼리 수준 격리 불가.
 * - canonical assetId(UUID)로 1차 조회하여 충돌을 최소화한다.
 * - ticker fallback은 legacy 호환용으로만 사용하며, 동일 ticker 이종 자산 충돌 가능성을 내포한다.
 * - 스키마 개선 전까지 이 제한을 인식하고 사용해야 한다.
 */
export async function fetchCanonicalPriceHistory(
  params: FetchCanonicalPriceHistoryParams
): Promise<FetchPriceHistoryResult> {
  const { db, assetId, ticker, limit = 50 } = params;
  // assetKind는 현재 스키마에 컬럼이 없어 쿼리에 사용하지 않음 (위 주석 참조)

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
      // DB 오류 → source: 'error' (정상 empty와 명확히 구분)
      console.warn('[PriceHistoryService] DB 오류 (canonical):', canonicalError?.message ?? 'unknown');
      return {
        data: [],
        source: 'error',
        error: {
          code: 'DB_QUERY_ERROR',
          message: '가격 이력 조회 중 DB 오류가 발생했습니다.',
        },
      };
    }

    // canonical 레코드가 존재하면 ticker fallback을 수행하지 않고 즉시 반환
    if (canonicalData && canonicalData.length > 0) {
      return {
        data: canonicalData,
        source: 'canonical',
      };
    }
  } catch (err) {
    console.warn('[PriceHistoryService] 예외 발생 (canonical):', err instanceof Error ? err.message : 'unknown');
    return {
      data: [],
      source: 'error',
      error: {
        code: 'DB_EXCEPTION',
        message: '가격 이력 조회 중 예외가 발생했습니다.',
      },
    };
  }

  // 2. canonical 결과가 없고 구버전 데이터 호환(legacy ticker 참조)이 필요한 경우만 ticker fallback
  //    주의: 동일 ticker를 가진 이종 자산(주식/채권)의 스키마상 구분이 불가하므로
  //    ticker fallback 결과가 의도하지 않은 자산의 이력일 수 있다.
  if (ticker && typeof ticker === 'string' && ticker !== assetId) {
    try {
      const { data: fallbackData, error: fallbackError } = await db
        .from('stock_price_history')
        .select('*')
        .eq('stock_id', ticker)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (fallbackError) {
        // ticker fallback DB 오류도 source: 'error'로 반환
        console.warn('[PriceHistoryService] DB 오류 (ticker fallback):', fallbackError?.message ?? 'unknown');
        return {
          data: [],
          source: 'error',
          error: {
            code: 'TICKER_FALLBACK_ERROR',
            message: '가격 이력 ticker fallback 조회 중 DB 오류가 발생했습니다.',
          },
        };
      }

      if (fallbackData && fallbackData.length > 0) {
        return {
          data: fallbackData,
          source: 'ticker_fallback',
        };
      }
    } catch (err) {
      console.warn('[PriceHistoryService] 예외 발생 (ticker fallback):', err instanceof Error ? err.message : 'unknown');
      return {
        data: [],
        source: 'error',
        error: {
          code: 'TICKER_FALLBACK_EXCEPTION',
          message: '가격 이력 ticker fallback 조회 중 예외가 발생했습니다.',
        },
      };
    }
  }

  // 정상 조회됐으나 데이터 없음 → source: 'empty' (오류와 명확히 구분)
  return { data: [], source: 'empty' };
}

/**
 * 채권 자산의 synthetic price history 생성 순수 함수 (비결정적 Date.now() 배제)
 *
 * 사용 조건:
 * - DB 조회 결과 source === 'empty' (정상 빈 결과)인 경우에만 호출한다.
 * - DB 오류(source === 'error') 시에는 이 함수를 호출하지 않는다.
 *
 * 기준 시각 우선순위:
 * 1. referenceTimeMs (시뮬레이션 시각 또는 명시적 기준 시각)
 * 2. stock.updated_at
 * 3. stock.created_at
 * 4. DEFAULT_BOND_FALLBACK_EPOCH_MS
 *
 * 결정론 보장:
 * - 동일 입력에서 항상 동일한 id, price, volume, created_at 반환
 * - Date.now() 사용 금지
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
