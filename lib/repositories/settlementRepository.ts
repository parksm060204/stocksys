/**
 * SettlementRepository Interface for STOCKSYS
 */

import type {
  TradeSettlementInput,
  SettlementBatchResult,
  BondRecord,
  OptionContractRecord,
  HoldingRecord,
  MatchedBatchCommitInput,
  OptionExpirySettlementParams,
  BondMaturitySettlementParams,
  NonTradeSettlementResult
} from './types';

export interface SettlementRepository {
  /**
   * Atomically settles a batch of trades with full pre-validation,
   * rollback on failure, fee accounting, and idempotency.
   *
   * 모든 거래는 상태 조회/합산 이전에 완전 검증되며, 하나라도 유효하지 않으면
   * batch 전체가 거부되고 어떤 상태도 변경되지 않는다.
   */
  settleTradeBatchAtomically(
    trades: readonly TradeSettlementInput[]
  ): Promise<SettlementBatchResult>;

  /**
   * 단일 Unit-of-Work 원자적 커밋 API:
   * 동일한 MemoryDatabase를 사용하는 거래 정산, 주문 상태, 시세, 가격 이력을
   * 하나의 스냅샷/롤백 경계 안에서 원자적으로 반영한다.
   * 사전 검증 실패나 실행 오류 시 모든 상태가 100% 원복된다.
   */
  commitMatchedBatchAtomically(
    batch: MatchedBatchCommitInput
  ): Promise<SettlementBatchResult>;

  /**
   * 옵션 만기 지급과 포지션 청산을 단일 원자적 작업으로 처리한다.
   * 멱등성 검사, 지급액 검증, 현금 지급, 정산 이력 기록, 만기 포지션 제거, settlement ledger 기록을
   * 단일 트랜잭션 경계에서 수행하며, 실패 시 100% 롤백된다.
   */
  settleOptionExpiryAtomically(
    params: OptionExpirySettlementParams
  ): Promise<NonTradeSettlementResult>;

  /**
   * 채권 만기 원금 상환과 포지션 청산을 단일 원자적 작업으로 처리한다.
   * 멱등성 검사, 원금/최종쿠폰 검증, 현금 지급, 지급 이력 기록, 채권 포지션 제거, settlement ledger 기록을
   * 단일 트랜잭션 경계에서 수행하며, 실패 시 100% 롤백된다.
   */
  settleBondMaturityAtomically(
    params: BondMaturitySettlementParams
  ): Promise<NonTradeSettlementResult>;

  /**
   * Authoritative settlement ledger를 조회한다 (인스턴스 재생성과 무관).
   */
  isTradeSettled(tradeId: string): boolean;

  /**
   * 최근 정산 실패 시의 reason code를 조회한다 (성공 시 null).
   */
  getLastSettlementError(): string | null;

  /**
   * 만기 도래 옵션 계약 조회 (simulation clock 기준).
   */
  getExpiredOptionContracts(now: number): readonly OptionContractRecord[];

  /**
   * 옵션/채권 보유 포지션 조회 (quantity > 0).
   */
  getPositionsForAssetIds(assetIds: readonly string[]): readonly HoldingRecord[];

  /**
   * 옵션 지급 + 만기 포지션 제거를 하나의 원자적 경계로 처리한다.
   */
  settleOptionPayout(
    userId: string,
    optionId: string,
    payoutAmount: number,
    idempotencyKey: string
  ): Promise<boolean>;

  /**
   * 만기 옵션 포지션을 원자적으로 청산한다.
   */
  closeExpiredOptionPosition(userId: string, optionId: string, idempotencyKey: string): boolean;

  /**
   * 쿠폰 지급 대상 채권과 만기 채권을 simulation clock 기준으로 분류한다.
   */
  getBonds(now: number): readonly BondRecord[];

  /**
   * 주기 쿠폰 지급.
   */
  settleBondCoupon(
    userId: string,
    bondId: string,
    couponAmount: number,
    idempotencyKey: string
  ): Promise<boolean>;

  /**
   * 만기 원금 상환.
   */
  settleBondRedemption(
    userId: string,
    bondId: string,
    principalAmount: number,
    idempotencyKey: string
  ): Promise<boolean>;

  /**
   * 만기 채권 포지션을 원자적으로 청산한다.
   */
  closeMaturedBondPosition(userId: string, bondId: string, idempotencyKey: string): boolean;
}
