import { SupabaseClient } from '@supabase/supabase-js';
import { OptionSettlementEngine } from './OptionSettlementEngine';
import { BondCouponEngine } from './BondCouponEngine';
import { OptionContract, OptionPosition, BondItem, BondPosition } from './types';

export class SettlementBatchService {
  public optionEngine: OptionSettlementEngine;
  public bondEngine: BondCouponEngine;
  private isRunning: boolean = false;
  private lastRunDate: string = '';

  constructor(private supabase?: SupabaseClient) {
    this.optionEngine = new OptionSettlementEngine(supabase);
    this.bondEngine = new BondCouponEngine(supabase);
  }

  /**
   * [정기 배치 실행] 매 게임-일 또는 스케줄러 틱에서 호출
   */
  public async runDailySettlementBatch(): Promise<{
    optionSettled: number;
    optionPayout: number;
    bondCouponsPaid: number;
    bondPrincipalRedeemed: number;
  }> {
    if (this.isRunning) {
      return { optionSettled: 0, optionPayout: 0, bondCouponsPaid: 0, bondPrincipalRedeemed: 0 };
    }

    this.isRunning = true;
    const todayStr = new Date().toISOString().split('T')[0] || '';
    const currentPeriodKey = `period_${todayStr.slice(0, 7)}`; // 'period_2026-08'

    let optionSettled = 0;
    let optionPayout = 0;
    let bondCouponsPaid = 0;
    let bondPrincipalRedeemed = 0;

    try {
      if (this.supabase) {
        // 1. 만기 도래 옵션 계약 및 보유 포지션 조회
        const { data: optionsData } = await this.supabase
          .from('options_contracts')
          .select('*');

        const { data: stocksData } = await this.supabase
          .from('stocks')
          .select('id, current_price');

        const underlyingPrices: Record<string, number> = {};
        (stocksData || []).forEach((s) => {
          underlyingPrices[s.id] = Number(s.current_price || 0);
        });

        const { data: holdingsData } = await this.supabase
          .from('holdings')
          .select('*')
          .gt('quantity', 0);

        const optionPositions: OptionPosition[] = (holdingsData || [])
          .filter((h) => (optionsData || []).some((o) => o.id === h.stock_id))
          .map((h) => ({
            userId: h.user_id,
            optionId: h.stock_id,
            quantity: Number(h.quantity || 0),
            avgPrice: Number(h.avg_price || 0),
          }));

        const contracts: OptionContract[] = (optionsData || []).map((o) => ({
          id: o.id,
          underlying_stock_id: o.underlying_stock_id,
          ticker: o.ticker,
          type: o.type || o.option_type,
          option_type: o.option_type || o.type,
          strike_price: Number(o.strike_price || 0),
          current_price: Number(o.current_price || 0),
          expiry_date: o.expiry_date,
          open_interest: Number(o.open_interest || 0),
          volume: Number(o.volume || 0),
        }));

        // 옵션 정산 실행
        const optRes = await this.optionEngine.executeSettlementBatch({
          contracts,
          positions: optionPositions,
          underlyingPrices,
        });

        optionSettled = optRes.settledCount;
        optionPayout = optRes.totalPayout;

        // 2. 채권 쿠폰 및 만기 상환 처리
        const { data: bondsData } = await this.supabase
          .from('bonds')
          .select('*');

        const bonds: BondItem[] = (bondsData || []).map((b) => ({
          id: b.id,
          ticker: b.ticker,
          name: b.name,
          bond_type: b.bond_type,
          maturity: b.maturity,
          maturity_date: b.maturity_date || undefined,
          coupon_rate: Number(b.coupon_rate || 0),
          face_value: Number(b.face_value || 10000),
          current_price: Number(b.current_price || 100),
        }));

        const bondPositions: BondPosition[] = (holdingsData || [])
          .filter((h) => (bondsData || []).some((b) => b.id === h.stock_id))
          .map((h) => ({
            userId: h.user_id,
            bondId: h.stock_id,
            quantity: Number(h.quantity || 0),
            avgPrice: Number(h.avg_price || 0),
          }));

        const bondRes = await this.bondEngine.executeCouponBatch({
          bonds,
          positions: bondPositions,
          currentPeriodKey,
        });

        bondCouponsPaid = bondRes.totalCouponPaid;
        bondPrincipalRedeemed = bondRes.totalPrincipalRedeemed;

        if (optionSettled > 0 || bondRes.couponCount > 0 || bondRes.redemptionCount > 0) {
          console.log(
            `🏦 [SettlementBatch] 정산 완료: 옵션 ${optionSettled}건(₩${optionPayout.toLocaleString()}), 채권이자 ₩${bondCouponsPaid.toLocaleString()}, 만기상환 ₩${bondPrincipalRedeemed.toLocaleString()}`
          );
        }
      }

      this.lastRunDate = todayStr;
    } catch (e) {
      console.error('[SettlementBatchService] Batch Run Error:', e);
    } finally {
      this.isRunning = false;
    }

    return {
      optionSettled,
      optionPayout,
      bondCouponsPaid,
      bondPrincipalRedeemed,
    };
  }

  public getLastRunDate(): string {
    return this.lastRunDate;
  }
}
