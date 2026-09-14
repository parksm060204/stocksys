import { ensureLocalStandaloneEngine } from './localStandaloneServer';
import { createMemoryDbClient } from '../memoryDb/memoryDbClient';
import { submitAndMatchOrder, MatchOrderResult } from './dbMatching';

export interface SubmitOrderParams {
  userId: string;
  stockId: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
}

/**
 * Per-stock async mutex (직렬화 큐)
 *
 * 동일 종목에 대한 동시 주문은 순차 처리된다. 서로 다른 종목은 독립적으로 진행 가능.
 * 외부 패키지 없이 Promise 체이닝으로 구현한 경량 뮤텍스.
 *
 * 동작 원리:
 *   stockLocks.get(stockId) = 현재 처리 중인 작업의 Promise
 *   새 주문은 해당 Promise가 끝난 뒤 실행됨
 *   finally 블록으로 예외 발생 시에도 항상 lock 해제 보장
 */
const stockLocks = new Map<string, Promise<void>>();

export function acquireStockLock(stockId: string): { wait: Promise<void>; release: () => void } {
  let release!: () => void;
  const existing = stockLocks.get(stockId) ?? Promise.resolve();
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  // 현재 실행 중인 작업이 끝나야 next가 실행 가능한 상태가 됨
  stockLocks.set(stockId, existing.then(() => next));
  return { wait: existing, release };
}

export async function withStockLock<T>(stockId: string, fn: () => Promise<T>): Promise<T> {
  const { wait, release } = acquireStockLock(stockId);
  await wait;
  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * 복수 종목(또는 시장 전체) 락 획득 (데드락 방지를 위해 알파벳순 정렬 후 순차 획득)
 */
export async function withAllStockLocks<T>(stockIds: string[], fn: () => Promise<T>): Promise<T> {
  const sortedIds = Array.from(new Set(stockIds)).sort();
  const releases: (() => void)[] = [];

  try {
    for (const id of sortedIds) {
      const { wait, release } = acquireStockLock(id);
      await wait;
      releases.push(release);
    }
    return await fn();
  } finally {
    // 역순으로 락 해제
    for (let i = releases.length - 1; i >= 0; i--) {
      releases[i]();
    }
  }
}

export class LocalMarketService {
  /**
   * 주문 제출, 검증, Price-Time Priority 매칭, 수수료 정산 및 오더북 반영을 단일 서비스 인터페이스로 처리.
   *
   * [Concurrent Matching Safety]
   * 동일 stockId에 대한 동시 요청을 per-stock 비동기 뮤텍스로 직렬화한다.
   * 서로 다른 종목은 독립적으로 병렬 처리된다.
   * Lock은 risk 검증 → 오더북 조회 → 매칭 → 정산 → 상태 업데이트 전체 임계 구간을 커버한다.
   */
  public static async submitOrder(params: SubmitOrderParams): Promise<MatchOrderResult> {
    ensureLocalStandaloneEngine();
    const client = createMemoryDbClient();

    return await withStockLock(params.stockId, async () => {
      return await submitAndMatchOrder(client, {
        stock_id: params.stockId,
        user_id: params.userId,
        side: params.side,
        price: params.price,
        size: params.size,
      });
    });
  }
}
