import { SupabaseClient } from '@supabase/supabase-js';
import { OptionContract, OptionPosition, OptionSettlementResult } from './types';

export class OptionSettlementEngine {
  private processedKeys: Set<string> = new Set();
  private readonly defaultMultiplier: number = 250000;

  constructor(private supabase?: SupabaseClient) {}

  /**
   * 멱등성 키 생성
   */
  public generateIdempotencyKey(optionId: string, userId: string, expiryDate: string): string {
    const formattedDate = expiryDate.split('T')[0] || expiryDate;
    return `opt_settle_${optionId}_${userId}_${formattedDate}`;
  }

  /**
   * 단일 옵션 계약 만기 결제 계산 (수학 모델)
   */
  public calculateSettlement(params: {
    contract: OptionContract;
    position: OptionPosition;
    underlyingClosePrice: number;
    multiplier?: number;
  }): OptionSettlementResult {
    const { contract, position, underlyingClosePrice, multiplier = this.defaultMultiplier } = params;
    const optionType = contract.option_type || contract.type || 'CALL';
    const strikePrice = contract.strike_price;
    const quantity = position.quantity;

    let isItm = false;
    let diffPerUnit = 0;

    if (optionType === 'CALL') {
      if (underlyingClosePrice > strikePrice) {
        isItm = true;
        diffPerUnit = underlyingClosePrice - strikePrice;
      }
    } else {
      if (strikePrice > underlyingClosePrice) {
        isItm = true;
        diffPerUnit = strikePrice - underlyingClosePrice;
      }
    }

    const payoutAmount = isItm ? Math.round(diffPerUnit * quantity * multiplier) : 0;
    const idempotencyKey = this.generateIdempotencyKey(contract.id, position.userId, contract.expiry_date);

    return {
      optionId: contract.id,
      userId: position.userId,
      optionType,
      strikePrice,
      underlyingClosePrice,
      isItm,
      quantity,
      multiplier,
      payoutAmount,
      idempotencyKey,
      settledAt: Date.now(),
    };
  }

  /**
   * [배치 실행] 만기 도래한 옵션 계약 일괄 정산
   */
  public async executeSettlementBatch(params: {
    contracts: OptionContract[];
    positions: OptionPosition[];
    underlyingPrices: Record<string, number>;
    currentDate?: Date;
  }): Promise<{
    settledCount: number;
    itmCount: number;
    otmCount: number;
    totalPayout: number;
    results: OptionSettlementResult[];
  }> {
    const now = params.currentDate ? params.currentDate.getTime() : Date.now();
    const results: OptionSettlementResult[] = [];
    let itmCount = 0;
    let otmCount = 0;
    let totalPayout = 0;

    // 만기일 도래 옵션 계약 필터링
    const expiredContracts = params.contracts.filter((c) => {
      const expTime = new Date(c.expiry_date).getTime();
      return expTime <= now;
    });

    for (const contract of expiredContracts) {
      const underlyingPrice =
        params.underlyingPrices[contract.underlying_stock_id] ??
        params.underlyingPrices[contract.id] ??
        contract.strike_price;

      // 해당 계약을 보유한 유저 포지션 검색
      const matchingPositions = params.positions.filter(
        (p) => p.optionId === contract.id && p.quantity > 0
      );

      for (const pos of matchingPositions) {
        const key = this.generateIdempotencyKey(contract.id, pos.userId, contract.expiry_date);

        // 멱등성 검사: 이미 처리된 계약이면 건너뜀
        if (this.processedKeys.has(key)) {
          continue;
        }

        const settlement = this.calculateSettlement({
          contract,
          position: pos,
          underlyingClosePrice: underlyingPrice,
        });

        this.processedKeys.add(key);
        results.push(settlement);

        if (settlement.isItm) {
          itmCount++;
          totalPayout += settlement.payoutAmount;
        } else {
          otmCount++;
        }

        // DB 연동이 있을 경우 DB 커밋
        if (this.supabase) {
          try {
            // 1. 정산 이력 기록 (ON CONFLICT DO NOTHING)
            await this.supabase.from('option_settlements').insert({
              option_id: settlement.optionId,
              user_id: settlement.userId,
              underlying_stock_id: contract.underlying_stock_id,
              option_type: settlement.optionType,
              strike_price: settlement.strikePrice,
              underlying_close_price: settlement.underlyingClosePrice,
              is_itm: settlement.isItm,
              quantity: settlement.quantity,
              multiplier: settlement.multiplier,
              payout_amount: settlement.payoutAmount,
              idempotency_key: settlement.idempotencyKey,
            });

            // 2. ITM인 경우 cash 입금
            if (settlement.payoutAmount > 0) {
              await this.supabase.rpc('increment_user_cash', {
                p_user_id: settlement.userId,
                p_delta: settlement.payoutAmount,
              });
            }

            // 3. 만기 포지션 holdings에서 소멸 처리
            await this.supabase
              .from('holdings')
              .delete()
              .eq('user_id', settlement.userId)
              .eq('stock_id', settlement.optionId);
          } catch (e) {
            console.error('[OptionSettlementEngine] DB Commit Error:', e);
          }
        }
      }
    }

    return {
      settledCount: results.length,
      itmCount,
      otmCount,
      totalPayout,
      results,
    };
  }

  /**
   * 멱등성 캐시 초기화 (테스트용)
   */
  public resetProcessedKeys(): void {
    this.processedKeys.clear();
  }

  public getProcessedCount(): number {
    return this.processedKeys.size;
  }
}
