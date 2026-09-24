/**
 * OptionSettlementEngine — 옵션 만기 정산 (repository 전용, 벽시계 금지)
 *
 * - client.from / client.rpc 금지: RepositoryBundle만 사용
 * - 주입된 simulation clock만 사용 (Date.now()/new Date() 금지)
 * - 지급 + 포지션 제거를 하나의 transaction 경계로 처리하고 부분 실패 시 rollback
 * - 멱등성 상태는 authoritative settlement ledger에 보관
 */

import type { RepositoryBundle } from '../../../lib/repositories/repositoryBundle';
import type { SimulationTimeSource } from '../../../lib/engine/simulation/runtime/simulationTimeSource';
import type { OptionContract, OptionPosition, OptionSettlementResult } from './types';

export interface OptionSettlementBatchResult {
  readonly settledCount: number;
  readonly itmCount: number;
  readonly otmCount: number;
  readonly totalPayout: number;
  readonly results: readonly OptionSettlementResult[];
}

export class OptionSettlementEngine {
  private readonly defaultMultiplier: number = 250000;

  constructor(
    private readonly repositories: RepositoryBundle,
    private readonly clock: SimulationTimeSource
  ) {}

  public generateIdempotencyKey(optionId: string, userId: string, expiryDate: string): string {
    const formattedDate = expiryDate.split('T')[0] || expiryDate;
    return `opt_settle_${optionId}_${userId}_${formattedDate}`;
  }

  /**
   * 단일 옵션 계약 만기 결제 계산 (순수 계산).
   * settledAt는 주입된 simulation clock에서 가져온다.
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

    if (!Number.isFinite(underlyingClosePrice) || underlyingClosePrice < 0) {
      throw new RangeError(
        `[OptionSettlementEngine] underlyingClosePrice must be finite and non-negative: ${underlyingClosePrice}`
      );
    }
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new RangeError(`[OptionSettlementEngine] quantity must be finite and non-negative: ${quantity}`);
    }

    let isItm = false;
    let diffPerUnit = 0;
    if (optionType === 'CALL') {
      if (underlyingClosePrice > strikePrice) {
        isItm = true;
        diffPerUnit = underlyingClosePrice - strikePrice;
      }
    } else if (strikePrice > underlyingClosePrice) {
      isItm = true;
      diffPerUnit = strikePrice - underlyingClosePrice;
    }

    const payoutAmount = isItm ? Math.round(diffPerUnit * quantity * multiplier) : 0;
    if (!Number.isFinite(payoutAmount)) {
      throw new RangeError(`[OptionSettlementEngine] computed payout is not finite: ${payoutAmount}`);
    }

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
      idempotencyKey: this.generateIdempotencyKey(contract.id, position.userId, contract.expiry_date),
      settledAt: this.clock.now(),
    };
  }

  /**
   * [배치 실행] 만기 도래 옵션 정산.
   * now는 호출자가 simulation clock에서 주입한다 (기본값 없음).
   */
  public async executeSettlementBatch(params: {
    contracts: readonly OptionContract[];
    positions: readonly OptionPosition[];
    underlyingPrices: Record<string, number>;
    now: number;
  }): Promise<OptionSettlementBatchResult> {
    const { now } = params;
    if (!Number.isFinite(now)) {
      throw new RangeError(`[OptionSettlementEngine] now must be finite: ${now}`);
    }

    const results: OptionSettlementResult[] = [];
    let itmCount = 0;
    let otmCount = 0;
    let totalPayout = 0;

    for (const contract of params.contracts) {
      const expTime = Date.parse(contract.expiry_date);
      if (!Number.isFinite(expTime) || expTime > now) continue;

      const underlyingPrice =
        params.underlyingPrices[contract.underlying_stock_id] ?? contract.strike_price;

      for (const pos of params.positions) {
        if (pos.optionId !== contract.id || pos.quantity <= 0) continue;

        const key = this.generateIdempotencyKey(contract.id, pos.userId, contract.expiry_date);
        // authoritative ledger 기준 멱등성 검사
        if (this.repositories.settlement.isTradeSettled(key)) continue;

        const settlement = this.calculateSettlement({
          contract,
          position: pos,
          underlyingClosePrice: underlyingPrice,
        });

        const settlementRes = await this.repositories.settlement.settleOptionExpiryAtomically({
          userId: pos.userId,
          optionId: contract.id,
          payoutAmount: settlement.payoutAmount,
          idempotencyKey: key,
        });

        if (!settlementRes.success) continue;

        results.push(settlement);
        if (settlement.isItm) {
          itmCount++;
          totalPayout += settlement.payoutAmount;
        } else {
          otmCount++;
        }
      }
    }

    return { settledCount: results.length, itmCount, otmCount, totalPayout, results };
  }
}
