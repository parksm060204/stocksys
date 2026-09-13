/**
 * MUMYEONG: Shared Settlement Layer
 * Local Standalone Mode와 Production 모두에서 동일하게 사용되는 단일 원자적 체결 정산 레이어
 */

export interface SettlementTrade {
  stock_id: string;
  buyer_id: string | null;
  seller_id: string | null;
  buyer_is_bot: boolean;
  seller_is_bot: boolean;
  price: number;
  size: number;
  buyer_fee: number;
  seller_fee: number;
  created_at?: string;
}

export const MAKER_REBATE_RATE = -0.001; // -0.1% (메이커 리베이트)
export const TAKER_FEE_RATE = 0.0025;   // +0.25% (테이커 수수료)

/**
 * Maker/Taker 상태에 따른 매수자/매도자 수수료율 계산
 */
export function calculateTradeFees(buyerIsMaker: boolean, sellerIsMaker: boolean): {
  buyer_fee: number;
  seller_fee: number;
} {
  return {
    buyer_fee: buyerIsMaker ? MAKER_REBATE_RATE : TAKER_FEE_RATE,
    seller_fee: sellerIsMaker ? MAKER_REBATE_RATE : TAKER_FEE_RATE,
  };
}

/**
 * 체결 거래 내역을 일괄 원자적 정산 RPC(bulk_settle_trades)로 실행
 * @param client SupabaseClient 또는 MockSupabaseClient
 * @param trades 정산 대상 체결 배열
 */
export async function executeSettlement(
  client: any,
  trades: SettlementTrade[]
): Promise<{ success: boolean; settled_count: number; error?: any }> {
  if (!trades || trades.length === 0) {
    return { success: true, settled_count: 0 };
  }

  const { data, error } = await client.rpc('bulk_settle_trades', { p_trades: trades });

  if (error) {
    console.error('[Settlement] Failed bulk_settle_trades:', error);
    return { success: false, settled_count: 0, error };
  }

  return {
    success: true,
    settled_count: data?.settled_count ?? trades.length,
  };
}
