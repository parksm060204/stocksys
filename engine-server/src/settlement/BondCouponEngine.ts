/**
 * BondCouponEngine — 채권 쿠폰/만기 상환 정산 (repository 전용, 벽시계 금지)
 *
 * - client.from / client.rpc 금지: RepositoryBundle만 사용
 * - 주입된 simulation clock만 사용 (Date.now()/new Date() 금지)
 * - 상환 + 포지션 제거를 하나의 transaction 경계로 처리
 * - 멱등성 상태는 authoritative settlement ledger에 보관
 */

import type { RepositoryBundle } from '../../../lib/repositories/repositoryBundle';
import type { SimulationTimeSource } from '../../../lib/engine/simulation/runtime/simulationTimeSource';
import type { BondItem, BondPosition, BondPaymentResult } from './types';

export interface BondSettlementBatchResult {
  readonly couponCount: number;
  readonly redemptionCount: number;
  readonly totalCouponPaid: number;
  readonly totalPrincipalRedeemed: number;
  readonly results: readonly BondPaymentResult[];
}

export class BondCouponEngine {
  private readonly defaultFaceValue: number = 10000;
  private readonly defaultPaymentsPerYear: number = 4;

  constructor(
    private readonly repositories: RepositoryBundle,
    private readonly clock: SimulationTimeSource
  ) {}

  public generateIdempotencyKey(
    bondId: string,
    userId: string,
    periodKey: string,
    paymentType: 'COUPON' | 'MATURITY_REDEMPTION'
  ): string {
    return `bond_${paymentType.toLowerCase()}_${bondId}_${userId}_${periodKey}`;
  }

  public calculateCouponPayment(params: {
    bond: BondItem;
    position: BondPosition;
    periodKey: string;
    paymentsPerYear?: number;
  }): BondPaymentResult {
    const { bond, position, periodKey, paymentsPerYear = this.defaultPaymentsPerYear } = params;
    const faceValue = bond.face_value || this.defaultFaceValue;
    const couponRateDecimal = bond.coupon_rate / 100;
    const quantity = position.quantity;
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new RangeError(`[BondCouponEngine] quantity must be finite and non-negative: ${quantity}`);
    }
    const paymentAmount = Math.round(quantity * faceValue * (couponRateDecimal / paymentsPerYear));
    if (!Number.isFinite(paymentAmount)) {
      throw new RangeError(`[BondCouponEngine] computed coupon is not finite: ${paymentAmount}`);
    }
    return {
      bondId: bond.id,
      userId: position.userId,
      paymentType: 'COUPON',
      couponRate: bond.coupon_rate,
      faceValue,
      quantity,
      paymentAmount,
      idempotencyKey: this.generateIdempotencyKey(bond.id, position.userId, periodKey, 'COUPON'),
      paymentDate: this.clock.now(),
    };
  }

  public calculateMaturityRedemption(params: {
    bond: BondItem;
    position: BondPosition;
    periodKey: string;
  }): BondPaymentResult {
    const { bond, position, periodKey } = params;
    const faceValue = bond.face_value || this.defaultFaceValue;
    const quantity = position.quantity;
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new RangeError(`[BondCouponEngine] quantity must be finite and non-negative: ${quantity}`);
    }
    const paymentAmount = Math.round(quantity * faceValue);
    if (!Number.isFinite(paymentAmount)) {
      throw new RangeError(`[BondCouponEngine] computed redemption is not finite: ${paymentAmount}`);
    }
    return {
      bondId: bond.id,
      userId: position.userId,
      paymentType: 'MATURITY_REDEMPTION',
      couponRate: bond.coupon_rate,
      faceValue,
      quantity,
      paymentAmount,
      idempotencyKey: this.generateIdempotencyKey(bond.id, position.userId, periodKey, 'MATURITY_REDEMPTION'),
      paymentDate: this.clock.now(),
    };
  }

  private getLegacyMonthlyPeriodKeys(periodKey: string): string[] {
    const qMatch = /^(?:period_)?(\d{4})[-_]Q([1-4])$/.exec(periodKey);
    if (!qMatch) return [];
    const year = qMatch[1];
    const q = Number(qMatch[2]);
    const startMonth = (q - 1) * 3 + 1;
    return [0, 1, 2].map((offset) => {
      const m = String(startMonth + offset).padStart(2, '0');
      return `period_${year}-${m}`;
    });
  }

  private isLegacyQuarterPaymentSettled(
    bondId: string,
    userId: string,
    periodKey: string,
    paymentType: 'COUPON' | 'MATURITY_REDEMPTION'
  ): boolean {
    const legacyPeriodKeys = this.getLegacyMonthlyPeriodKeys(periodKey);
    for (const legacyKey of legacyPeriodKeys) {
      const key = this.generateIdempotencyKey(bondId, userId, legacyKey, paymentType);
      if (this.repositories.settlement.isTradeSettled(key)) {
        return true;
      }
    }
    return false;
  }

  public async executeCouponBatch(params: {
    bonds: readonly BondItem[];
    positions: readonly BondPosition[];
    periodKey: string;
    now: number;
  }): Promise<BondSettlementBatchResult> {
    const { now } = params;
    if (!Number.isFinite(now)) {
      throw new RangeError(`[BondCouponEngine] now must be finite: ${now}`);
    }

    const results: BondPaymentResult[] = [];
    const failures: string[] = [];
    let couponCount = 0;
    let redemptionCount = 0;
    let totalCouponPaid = 0;
    let totalPrincipalRedeemed = 0;

    for (const bond of params.bonds) {
      const parsedMaturity = bond.maturity_date ? Date.parse(bond.maturity_date) : NaN;
      const isMatured = Number.isFinite(parsedMaturity) && parsedMaturity <= now;

      for (const pos of params.positions) {
        if (pos.bondId !== bond.id || pos.quantity <= 0) continue;

        if (isMatured) {
          const mKey = this.generateIdempotencyKey(
            bond.id,
            pos.userId,
            params.periodKey,
            'MATURITY_REDEMPTION'
          );
          if (
            this.repositories.settlement.isTradeSettled(mKey) ||
            this.isLegacyQuarterPaymentSettled(bond.id, pos.userId, params.periodKey, 'MATURITY_REDEMPTION')
          ) {
            continue;
          }

          const cKey = this.generateIdempotencyKey(bond.id, pos.userId, params.periodKey, 'COUPON');
          const periodCouponAlreadyPaid =
            this.repositories.settlement.isTradeSettled(cKey) ||
            this.isLegacyQuarterPaymentSettled(bond.id, pos.userId, params.periodKey, 'COUPON') ||
            Boolean(
              this.repositories.settlement.hasBondCouponPaidInWindow?.(
                pos.userId,
                bond.id,
                parsedMaturity,
                now,
                this.defaultPaymentsPerYear
              )
            );
          const finalCoupon = periodCouponAlreadyPaid
            ? null
            : this.calculateCouponPayment({ bond, position: pos, periodKey: params.periodKey });

          const redemption = this.calculateMaturityRedemption({
            bond,
            position: pos,
            periodKey: params.periodKey,
          });

          const settlementRes = await this.repositories.settlement.settleBondMaturityAtomically({
            userId: pos.userId,
            bondId: bond.id,
            principalAmount: redemption.paymentAmount,
            couponAmount: finalCoupon ? finalCoupon.paymentAmount : 0,
            couponIdempotencyKey: cKey,
            paymentsPerYear: this.defaultPaymentsPerYear,
            now,
            idempotencyKey: mKey,
          });
          if (!settlementRes.success) {
            failures.push(
              `[MATURITY ${bond.id}/${pos.userId}] ${settlementRes.errorCode || 'FAILED'}: ${settlementRes.error || 'Unknown error'}`
            );
            continue;
          }

          results.push(redemption);
          redemptionCount++;
          totalPrincipalRedeemed += redemption.paymentAmount;
          if (finalCoupon && finalCoupon.paymentAmount > 0) {
            totalCouponPaid += finalCoupon.paymentAmount;
          }
        } else {
          const cKey = this.generateIdempotencyKey(bond.id, pos.userId, params.periodKey, 'COUPON');
          if (
            this.repositories.settlement.isTradeSettled(cKey) ||
            this.isLegacyQuarterPaymentSettled(bond.id, pos.userId, params.periodKey, 'COUPON')
          ) {
            continue;
          }

          const coupon = this.calculateCouponPayment({ bond, position: pos, periodKey: params.periodKey });

          const paid = await this.repositories.settlement.settleBondCoupon(
            pos.userId,
            bond.id,
            coupon.paymentAmount,
            cKey,
            now
          );
          if (!paid) {
            failures.push(`[COUPON ${bond.id}/${pos.userId}] settleBondCoupon returned false`);
            continue;
          }

          results.push(coupon);
          couponCount++;
          totalCouponPaid += coupon.paymentAmount;
        }
      }
    }

    if (failures.length > 0) {
      throw new Error(`[BondCouponEngine] Settlement batch failed (${failures.length}): ${failures.join('; ')}`);
    }

    return { couponCount, redemptionCount, totalCouponPaid, totalPrincipalRedeemed, results };
  }
}
