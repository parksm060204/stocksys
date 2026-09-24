/**
 * SettlementBatchService — 옵션/채권 정기 정산 오케스트레이터
 *
 * 필수 구조:
 *  - RepositoryBundle + SimulationTimeSource 만 주입받는다 (client.from / client.rpc 금지)
 *  - 실제 시각(Date.now/new Date()) 대신 주입된 simulation clock을 사용한다
 *  - 오류를 catch하고 성공처럼 반환하지 않는다 (rollback 후 오류 전파)
 *  - 멱등성 상태는 authoritative repository(settlement ledger)에 보관한다
 */

import type { RepositoryBundle } from '../../../lib/repositories/repositoryBundle';
import type { SimulationTimeSource } from '../../../lib/engine/simulation/runtime/simulationTimeSource';
import type { BondRecord, OptionContractRecord, HoldingRecord } from '../../../lib/repositories/types';
import { OptionSettlementEngine } from './OptionSettlementEngine';
import { BondCouponEngine } from './BondCouponEngine';
import type { OptionContract, OptionPosition, BondPosition } from './types';

export interface DailySettlementBatchResult {
  readonly optionSettled: number;
  readonly optionPayout: number;
  readonly bondCouponsPaid: number;
  readonly bondPrincipalRedeemed: number;
}

export class SettlementBatchService {
  public optionEngine: OptionSettlementEngine;
  public bondEngine: BondCouponEngine;
  private isRunning: boolean = false;
  private lastRunPeriodKey: string = '';

  constructor(
    private readonly repositories: RepositoryBundle,
    private readonly clock: SimulationTimeSource
  ) {
    this.optionEngine = new OptionSettlementEngine(repositories, clock);
    this.bondEngine = new BondCouponEngine(repositories, clock);
  }

  public getRepositories(): RepositoryBundle {
    return this.repositories;
  }

  /**
   * simulation clock 기준 기간 키를 계산한다 (예: period_2026-09).
   * 실제 벽시계 시각을 사용하지 않는다.
   */
  private currentPeriodKey(nowMs: number): string {
    const iso = new Date(nowMs).toISOString();
    return `period_${iso.slice(0, 7)}`;
  }

  /**
   * [정기 배치 실행] simulation clock 기준 만기 옵션/채권 정산.
   * 오류는 성공으로 위장하지 않고 전파한다.
   */
  public async runDailySettlementBatch(): Promise<DailySettlementBatchResult> {
    if (this.isRunning) {
      return { optionSettled: 0, optionPayout: 0, bondCouponsPaid: 0, bondPrincipalRedeemed: 0 };
    }

    this.isRunning = true;
    const now = this.clock.now();

    try {
      const expiredOptions: readonly OptionContractRecord[] =
        this.repositories.settlement.getExpiredOptionContracts(now);
      const optionHoldingRecords: readonly HoldingRecord[] =
        this.repositories.settlement.getPositionsForAssetIds(expiredOptions.map((o) => o.id));
      // holding 레코드 → 옵션 포지션 DTO 매핑 (quantity > 0은 repository에서 이미 보장)
      const optionPositions: OptionPosition[] = optionHoldingRecords.map((h) => ({
        userId: h.user_id,
        optionId: h.stock_id,
        quantity: Number(h.quantity || 0),
        avgPrice: Number(h.avg_price || 0),
      }));

      const stockIds = Array.from(
        new Set(expiredOptions.map((o) => o.underlying_stock_id).filter((id): id is string => !!id))
      );
      const underlyingPrices = this.repositories.market.getUnderlyingPrices(stockIds);
      const contracts: OptionContract[] = this.repositories.market
        .getOptionContracts(expiredOptions.map((o) => o.id))
        .map((o) => ({
          id: o.id,
          underlying_stock_id: o.underlying_stock_id,
          ticker: o.ticker,
          type: o.type,
          option_type: o.option_type,
          strike_price: Number(o.strike_price || 0),
          current_price: Number(o.current_price || 0),
          expiry_date: o.expiry_date,
          open_interest: Number(o.open_interest || 0),
          volume: Number(o.volume || 0),
        }));

      const optRes = await this.optionEngine.executeSettlementBatch({
        contracts,
        positions: optionPositions,
        underlyingPrices,
        now,
      });

      const bonds: readonly BondRecord[] = this.repositories.settlement.getBonds(now);
      const bondHoldingRecords: readonly HoldingRecord[] =
        this.repositories.settlement.getPositionsForAssetIds(bonds.map((b) => b.id));
      const bondPositions: BondPosition[] = bondHoldingRecords.map((h) => ({
        userId: h.user_id,
        bondId: h.stock_id,
        quantity: Number(h.quantity || 0),
        avgPrice: Number(h.avg_price || 0),
      }));

      const bondRes = await this.bondEngine.executeCouponBatch({
        bonds,
        positions: bondPositions,
        periodKey: this.currentPeriodKey(now),
        now,
      });

      this.lastRunPeriodKey = this.currentPeriodKey(now);

      const result: DailySettlementBatchResult = {
        optionSettled: optRes.settledCount,
        optionPayout: optRes.totalPayout,
        bondCouponsPaid: bondRes.totalCouponPaid,
        bondPrincipalRedeemed: bondRes.totalPrincipalRedeemed,
      };

      if (result.optionSettled > 0 || bondRes.couponCount > 0 || bondRes.redemptionCount > 0) {
        console.log(
          `🏦 [SettlementBatch] 정산 완료: 옵션 ${result.optionSettled}건(₩${result.optionPayout.toLocaleString()}), 채권이자 ₩${result.bondCouponsPaid.toLocaleString()}, 만기상환 ₩${result.bondPrincipalRedeemed.toLocaleString()}`
        );
      }
      return result;
    } catch (err) {
      // 오류를 성공처럼 반환하지 않는다.
      console.error('[SettlementBatchService] Batch Run Error:', err);
      throw err;
    } finally {
      this.isRunning = false;
    }
  }

  public getLastRunPeriodKey(): string {
    return this.lastRunPeriodKey;
  }
}
