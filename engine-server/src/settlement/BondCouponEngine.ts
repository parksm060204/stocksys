import { SupabaseClient } from '@supabase/supabase-js';
import { BondItem, BondPosition, BondPaymentResult } from './types';

export class BondCouponEngine {
  private processedKeys: Set<string> = new Set();
  private readonly defaultFaceValue: number = 10000;
  private readonly defaultPaymentsPerYear: number = 4; // 분기 지급 (연 4회)

  constructor(private supabase?: SupabaseClient) {}

  /**
   * 멱등성 키 생성
   */
  public generateIdempotencyKey(
    bondId: string,
    userId: string,
    periodKey: string,
    paymentType: 'COUPON' | 'MATURITY_REDEMPTION'
  ): string {
    return `bond_${paymentType.toLowerCase()}_${bondId}_${userId}_${periodKey}`;
  }

  /**
   * 단일 채권 쿠폰 지급액 계산
   */
  public calculateCouponPayment(params: {
    bond: BondItem;
    position: BondPosition;
    periodKey: string;
    paymentsPerYear?: number;
  }): BondPaymentResult {
    const { bond, position, periodKey, paymentsPerYear = this.defaultPaymentsPerYear } = params;
    const faceValue = bond.face_value || this.defaultFaceValue;
    const couponRateDecimal = bond.coupon_rate / 100; // 3.5% -> 0.035
    const quantity = position.quantity;

    // 분기별 쿠폰 이자 = 수량 * 액면가 * (연간쿠폰금리 / 지급횟수)
    const paymentAmount = Math.round(quantity * faceValue * (couponRateDecimal / paymentsPerYear));
    const idempotencyKey = this.generateIdempotencyKey(bond.id, position.userId, periodKey, 'COUPON');

    return {
      bondId: bond.id,
      userId: position.userId,
      paymentType: 'COUPON',
      couponRate: bond.coupon_rate,
      faceValue,
      quantity,
      paymentAmount,
      idempotencyKey,
      paymentDate: Date.now(),
    };
  }

  /**
   * 만기 도래 채권 원금 상환 계산
   */
  public calculateMaturityRedemption(params: {
    bond: BondItem;
    position: BondPosition;
    periodKey: string;
  }): BondPaymentResult {
    const { bond, position, periodKey } = params;
    const faceValue = bond.face_value || this.defaultFaceValue;
    const quantity = position.quantity;

    // 만기 원금 상환액 = 수량 * 액면가 (10,000원)
    const paymentAmount = Math.round(quantity * faceValue);
    const idempotencyKey = this.generateIdempotencyKey(bond.id, position.userId, periodKey, 'MATURITY_REDEMPTION');

    return {
      bondId: bond.id,
      userId: position.userId,
      paymentType: 'MATURITY_REDEMPTION',
      couponRate: bond.coupon_rate,
      faceValue,
      quantity,
      paymentAmount,
      idempotencyKey,
      paymentDate: Date.now(),
    };
  }

  /**
   * [배치 실행] 채권 정기 쿠폰 지급 및 만기 상환 일괄 처리
   */
  public async executeCouponBatch(params: {
    bonds: BondItem[];
    positions: BondPosition[];
    currentPeriodKey: string; // 예: '2026_Q3', '2026-08'
    currentDate?: Date;
  }): Promise<{
    couponCount: number;
    redemptionCount: number;
    totalCouponPaid: number;
    totalPrincipalRedeemed: number;
    results: BondPaymentResult[];
  }> {
    const now = params.currentDate ? params.currentDate.getTime() : Date.now();
    const results: BondPaymentResult[] = [];
    let couponCount = 0;
    let redemptionCount = 0;
    let totalCouponPaid = 0;
    let totalPrincipalRedeemed = 0;

    for (const bond of params.bonds) {
      const isMatured = bond.maturity_date
        ? new Date(bond.maturity_date).getTime() <= now
        : false;

      const matchingPositions = params.positions.filter(
        (p) => p.bondId === bond.id && p.quantity > 0
      );

      for (const pos of matchingPositions) {
        if (isMatured) {
          // 1. 만기 도래 채권: 원금 전액 상환 + 포지션 청산
          const mKey = this.generateIdempotencyKey(bond.id, pos.userId, params.currentPeriodKey, 'MATURITY_REDEMPTION');
          if (!this.processedKeys.has(mKey)) {
            const redemption = this.calculateMaturityRedemption({
              bond,
              position: pos,
              periodKey: params.currentPeriodKey,
            });

            this.processedKeys.add(mKey);
            results.push(redemption);
            redemptionCount++;
            totalPrincipalRedeemed += redemption.paymentAmount;

            if (this.supabase) {
              try {
                await this.supabase.from('bond_coupon_payments').insert({
                  bond_id: redemption.bondId,
                  user_id: redemption.userId,
                  payment_type: redemption.paymentType,
                  coupon_rate: redemption.couponRate,
                  face_value: redemption.faceValue,
                  quantity: redemption.quantity,
                  payment_amount: redemption.paymentAmount,
                  idempotency_key: redemption.idempotencyKey,
                });

                await this.supabase.rpc('increment_user_cash', {
                  p_user_id: redemption.userId,
                  p_delta: redemption.paymentAmount,
                });

                await this.supabase
                  .from('holdings')
                  .delete()
                  .eq('user_id', redemption.userId)
                  .eq('stock_id', redemption.bondId);
              } catch (e) {
                console.error('[BondCouponEngine] Redemption DB Error:', e);
              }
            }
          }
        } else {
          // 2. 정기 쿠폰 이자 지급
          const cKey = this.generateIdempotencyKey(bond.id, pos.userId, params.currentPeriodKey, 'COUPON');
          if (!this.processedKeys.has(cKey)) {
            const coupon = this.calculateCouponPayment({
              bond,
              position: pos,
              periodKey: params.currentPeriodKey,
            });

            this.processedKeys.add(cKey);
            results.push(coupon);
            couponCount++;
            totalCouponPaid += coupon.paymentAmount;

            if (this.supabase) {
              try {
                await this.supabase.from('bond_coupon_payments').insert({
                  bond_id: coupon.bondId,
                  user_id: coupon.userId,
                  payment_type: coupon.paymentType,
                  coupon_rate: coupon.couponRate,
                  face_value: coupon.faceValue,
                  quantity: coupon.quantity,
                  payment_amount: coupon.paymentAmount,
                  idempotency_key: coupon.idempotencyKey,
                });

                await this.supabase.rpc('increment_user_cash', {
                  p_user_id: coupon.userId,
                  p_delta: coupon.paymentAmount,
                });
              } catch (e) {
                console.error('[BondCouponEngine] Coupon DB Error:', e);
              }
            }
          }
        }
      }
    }

    return {
      couponCount,
      redemptionCount,
      totalCouponPaid,
      totalPrincipalRedeemed,
      results,
    };
  }

  public resetProcessedKeys(): void {
    this.processedKeys.clear();
  }

  public getProcessedCount(): number {
    return this.processedKeys.size;
  }
}
