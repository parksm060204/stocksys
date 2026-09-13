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

export class LocalMarketService {
  /**
   * 주문 제출, 검증, Price-Time Priority 매칭, 수수료 정산 및 오더북 반영을 단일 서비스 인터페이스로 처리
   */
  public static async submitOrder(params: SubmitOrderParams): Promise<MatchOrderResult> {
    ensureLocalStandaloneEngine();
    const client = createMemoryDbClient();

    return submitAndMatchOrder(client, {
      stock_id: params.stockId,
      user_id: params.userId,
      side: params.side,
      price: params.price,
      size: params.size,
    });
  }
}
