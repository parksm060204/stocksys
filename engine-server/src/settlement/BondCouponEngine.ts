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

  private paymentsPerYear(bond: BondItem): number {
    const frequency = bond.payments_per_year;
    return typeof frequency === 'number' && Number.isInteger(frequency) && frequency > 0
      ? frequency
      : this.defaultPaymentsPerYear;
  }

  public calculateCouponPayment(params: {
    bond: BondItem;
    position: BondPosition;
    periodKey: string;
    paymentsPerYear?: number;
  }): BondPaymentResult {
    const { bond, position, periodKey, paymentsPerYear = this.paymentsPerYear(bond) } = params;
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

  private getCouponPeriod(
    bond: BondItem,
    now: number,
    fallback: string
  ): { key: string; startMs: number; endMs: number } {
    const frequency = this.paymentsPerYear(bond);
    const date = new Date(now);
    const year = date.getUTCFullYear();
    const start = new Date(now);
    start.setUTCMonth(0, 1);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setUTCFullYear(year + 1);
    const period = 12 % frequency === 0
      ? Math.floor(date.getUTCMonth() * frequency / 12)
      : Math.floor((now - start.getTime()) * frequency / (end.getTime() - start.getTime()));
    const startMs = 12 % frequency === 0
      ? Date.UTC(year, period * 12 / frequency, 1)
      : start.getTime() + Math.ceil(period * (end.getTime() - start.getTime()) / frequency);
    const endMs = 12 % frequency === 0
      ? Date.UTC(year, (period + 1) * 12 / frequency, 1)
      : start.getTime() + Math.ceil((period + 1) * (end.getTime() - start.getTime()) / frequency);
    const key = frequency === this.defaultPaymentsPerYear
      ? fallback
      : 'period_' + year + '-F' + frequency + '-' + (period + 1);
    return { key, startMs, endMs };
  }

  private getOverlappingLegacyCouponPeriodKeys(
    startMs: number,
    endMs: number,
    fallbackPeriodKey: string
  ): string[] {
    const keys = new Set<string>();
    const startDate = new Date(startMs);
    const endInclusiveDate = new Date(Math.max(startMs, endMs - 1));
    const startYear = startDate.getUTCFullYear();
    const endYear = endInclusiveDate.getUTCFullYear();

    for (let y = startYear; y <= endYear; y++) {
      for (let q = 1; q <= 4; q++) {
        const qStart = Date.UTC(y, (q - 1) * 3, 1);
        const qEnd = Date.UTC(y, q * 3, 1);
        if (qStart < endMs && startMs < qEnd) {
          keys.add(`period_${y}-Q${q}`);
        }
      }
      for (let m = 1; m <= 12; m++) {
        const mStart = Date.UTC(y, m - 1, 1);
        const mEnd = Date.UTC(y, m, 1);
        if (mStart < endMs && startMs < mEnd) {
          keys.add(`period_${y}-${String(m).padStart(2, '0')}`);
        }
      }
    }

    const fallbackMatch = /^(?:period_)?(\d{4})[-_]Q([1-4])$/.exec(fallbackPeriodKey);
    if (fallbackMatch) {
      const fy = Number(fallbackMatch[1]);
      const fq = Number(fallbackMatch[2]);
      const fqStart = Date.UTC(fy, (fq - 1) * 3, 1);
      const fqEnd = Date.UTC(fy, fq * 3, 1);
      if (fqStart < endMs && startMs < fqEnd) {
        keys.add(fallbackPeriodKey);
      }
    }

    return Array.from(keys);
  }

  /**
   * 레거시 키 호환 정책 (v1 스냅샷 및 지급 주기 변경 채권):
   * 1. 실제 지급 시각(bondCouponPayments.paid_at)이 존재하는 경우, 실측 이력의 [startMs, now] 겹침 판정이 우선한다.
   *    (예: 월지급 채권이 1월에 period_2026-Q1 키로 실측 지급되었으면 1월은 차단하고 2월은 정상 지급한다.)
   * 2. 지급 이력 배열이 비어 있거나 해당 키의 실측 시각이 없는 경우(v1 스냅샷·원장 트리밍 압축 키 등),
   *    레거시 분기(period_YYYY-Qq) 및 월(period_YYYY-MM) 키는 그 UTC 달력 구간이 현재 쿠폰 주기
   *    [startMs, endMs)와 겹칠 때만 기지급 증거로 취급한다. 달력 구간이 끝난 다음 유효 주기
   *    (startMs >= legacyEndMs)는 절대 차단하지 않는다.
   */
  private isCurrentCouponAlreadyPaid(params: {
    bondId: string;
    userId: string;
    couponPeriodKey: string;
    fallbackPeriodKey: string;
    startMs: number;
    endMs: number;
    now: number;
  }): boolean {
    const { bondId, userId, couponPeriodKey, fallbackPeriodKey, startMs, endMs, now } = params;
    const settlement = this.repositories.settlement;
    const cKey = this.generateIdempotencyKey(bondId, userId, couponPeriodKey, 'COUPON');
    if (settlement.isTradeSettled(cKey)) {
      return true;
    }

    if (settlement.hasBondCouponPaidDuring?.(userId, bondId, startMs, now)) {
      return true;
    }

    const legacyPeriodKeys = this.getOverlappingLegacyCouponPeriodKeys(startMs, endMs, fallbackPeriodKey);
    for (const legacyPeriodKey of legacyPeriodKeys) {
      const legacyKey = this.generateIdempotencyKey(bondId, userId, legacyPeriodKey, 'COUPON');
      if (!settlement.isTradeSettled(legacyKey)) {
        continue;
      }
      if (settlement.hasBondCouponPaymentRecord?.(legacyKey)) {
        continue;
      }
      return true;
    }

    return false;
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
      const { key: couponPeriodKey, startMs, endMs } = this.getCouponPeriod(bond, now, params.periodKey);

      for (const pos of params.positions) {
        if (pos.bondId !== bond.id || pos.quantity <= 0) continue;

        const cKey = this.generateIdempotencyKey(bond.id, pos.userId, couponPeriodKey, 'COUPON');
        const currentCouponAlreadyPaid = this.isCurrentCouponAlreadyPaid({
          bondId: bond.id,
          userId: pos.userId,
          couponPeriodKey,
          fallbackPeriodKey: params.periodKey,
          startMs,
          endMs,
          now,
        });

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

          const periodCouponAlreadyPaid = currentCouponAlreadyPaid ||
            Boolean(
              this.repositories.settlement.hasBondCouponPaidInWindow?.(
                pos.userId,
                bond.id,
                parsedMaturity,
                now,
                this.paymentsPerYear(bond)
              )
            );
          const finalCoupon = periodCouponAlreadyPaid
            ? null
            : this.calculateCouponPayment({ bond, position: pos, periodKey: couponPeriodKey });

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
            paymentsPerYear: this.paymentsPerYear(bond),
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
          if (currentCouponAlreadyPaid) continue;

          const coupon = this.calculateCouponPayment({ bond, position: pos, periodKey: couponPeriodKey });

          if (coupon.paymentAmount <= 0) continue;

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
