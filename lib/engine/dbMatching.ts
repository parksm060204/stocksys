import { SupabaseClient } from '@supabase/supabase-js';
import { validateOrderCapacity, OpenOrderForRisk } from '@/lib/engine/orderRisk';
import { SettlementTrade, calculateTradeFees, executeSettlement } from '@/lib/engine/settlement';

export interface OrderInput {
  stock_id: string;
  user_id: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
}

export interface MatchOrderResult {
  success: boolean;
  filledQty: number;
  message: string;
  orderId?: string;
  execPrice?: number;
}

/**
 * 연속 쌍방 경매(Continuous Double Auction) 주문 검증, 즉시 대조 매칭 및 정산
 * 1. orderRisk를 통한 미체결 주문 예약금/수량 감안 엄격 사전 검증
 * 2. resting maker price 기반 Price-Time Priority 매칭
 * 3. Maker Rebate / Taker Fee 일원화 적용
 * 4. Shared Settlement Layer(bulk_settle_trades RPC)로 원자적 자산 정산 위임
 */
export async function submitAndMatchOrder(
  supabase: SupabaseClient,
  input: OrderInput
): Promise<MatchOrderResult> {
  const { stock_id, user_id, side, price: incomingPrice, size: incomingSize } = input;

  if (incomingSize <= 0 || incomingPrice <= 0) {
    return { success: false, filledQty: 0, message: '올바르지 않은 주문 가격 또는 수량입니다.' };
  }

  try {
    // 0. 초기 잔고 / 보유 수량 및 미체결 주문 예약금 엄격 사전 검증
    if (user_id) {
      // 유저의 모든 open/partial 주문 조회 (동적 예약금/예약수량 계산용)
      const { data: userOpenOrders, error: ordersErr } = await supabase
        .from('orders')
        .select('id, user_id, stock_id, side, price, size, filled, status')
        .eq('user_id', user_id)
        .in('status', ['open', 'partial']);

      if (ordersErr) throw ordersErr;

      // 현금 조회
      const { data: profile } = await supabase
        .from('profiles')
        .select('cash')
        .eq('id', user_id)
        .single();
      const currentCash = Number(profile?.cash || 0);

      // 보유 주식 조회
      const { data: holding } = await supabase
        .from('holdings')
        .select('quantity')
        .eq('user_id', user_id)
        .eq('stock_id', stock_id)
        .maybeSingle();
      const currentHoldingQty = Number(holding?.quantity || 0);

      // Order Capacity 검증 (이중 주문 차단)
      const capacityCheck = validateOrderCapacity({
        userId: user_id,
        stockId: stock_id,
        side,
        incomingPrice,
        incomingSize,
        currentCash,
        currentHoldingQty,
        openOrders: (userOpenOrders as OpenOrderForRisk[]) || [],
      });

      if (!capacityCheck.valid) {
        return {
          success: false,
          filledQty: 0,
          message: capacityCheck.message || '가용 자산이 부족하여 주문을 접수할 수 없습니다.',
        };
      }
    }

    let remainingQty = incomingSize;
    let totalFilledQty = 0;
    let lastExecPrice = incomingPrice;

    // 1. 반대 방향 미체결 주문 검색
    const oppSide = side === 'buy' ? 'sell' : 'buy';
    let query = supabase
      .from('orders')
      .select('*')
      .eq('stock_id', stock_id)
      .eq('side', oppSide)
      .in('status', ['open', 'partial']);

    if (side === 'buy') {
      // 매수 주문: 같거나 저렴한 매도호가 체결 (가격 오름차순, 접수시각 오름차순)
      query = query
        .lte('price', incomingPrice)
        .order('price', { ascending: true })
        .order('created_at', { ascending: true });
    } else {
      // 매도 주문: 같거나 비싼 매수호가 체결 (가격 내림차순, 접수시각 오름차순)
      query = query
        .gte('price', incomingPrice)
        .order('price', { ascending: false })
        .order('created_at', { ascending: true });
    }

    const { data: oppOrders, error: fetchErr } = await query;
    if (fetchErr) throw fetchErr;

    const tradesToSettle: SettlementTrade[] = [];
    const oppOrdersToUpdate: { id: string; filled: number; status: string }[] = [];

    if (oppOrders && oppOrders.length > 0) {
      for (const opp of oppOrders) {
        if (remainingQty <= 0) break;

        const oppRemaining = Math.max(0, Number(opp.size) - Number(opp.filled || 0));
        if (oppRemaining <= 0) continue;

        // 체결 가격은 Price-Time Priority에 따라 먼저 대기 중이던 Maker(Resting Order)의 지정가 우선
        const execPrice = Number(opp.price);
        const matchQty = Math.min(remainingQty, oppRemaining);
        if (matchQty <= 0) continue;

        lastExecPrice = execPrice;

        const buyerId = side === 'buy' ? user_id : opp.user_id;
        const sellerId = side === 'sell' ? user_id : opp.user_id;
        const buyerIsBot = side === 'buy' ? false : !opp.user_id;
        const sellerIsBot = side === 'sell' ? false : !opp.user_id;

        // Maker-Taker 판별: opp는 호가창에 미리 등록되어 대기하던 주문이므로 Maker, 신규 들어온 input은 Taker
        const buyerIsMaker = side === 'sell';
        const sellerIsMaker = side === 'buy';
        const { buyer_fee, seller_fee } = calculateTradeFees(buyerIsMaker, sellerIsMaker);

        tradesToSettle.push({
          stock_id,
          buyer_id: buyerId || null,
          seller_id: sellerId || null,
          buyer_is_bot: buyerIsBot,
          seller_is_bot: sellerIsBot,
          price: execPrice,
          size: matchQty,
          buyer_fee,
          seller_fee,
          created_at: new Date().toISOString(),
        });

        // 상대 주문 진행도 갱신
        const newOppFilled = Number(opp.filled || 0) + matchQty;
        const newOppStatus = newOppFilled >= Number(opp.size) ? 'filled' : 'partial';
        oppOrdersToUpdate.push({ id: opp.id, filled: newOppFilled, status: newOppStatus });

        remainingQty -= matchQty;
        totalFilledQty += matchQty;
      }
    }

    // 2. Shared Settlement Layer를 통한 일괄 원자적 정산 실행
    if (tradesToSettle.length > 0) {
      const settleResult = await executeSettlement(supabase, tradesToSettle);
      if (!settleResult.success) {
        throw new Error(settleResult.error?.message || '체결 정산 트랜잭션 실패');
      }
    }

    // 3. 반대 주문 상태 배치 업데이트
    const writePromises: PromiseLike<any>[] = [];
    for (const o of oppOrdersToUpdate) {
      writePromises.push(
        supabase
          .from('orders')
          .update({ filled: o.filled, status: o.status })
          .eq('id', o.id)
          .then((res) => res)
      );
    }

    // 4. 주식 통계(현재가, high, low, volume) 업데이트 (Canonical 스키마: high, low)
    if (totalFilledQty > 0) {
      const { data: stockData } = await supabase
        .from('stocks')
        .select('high, low, volume')
        .eq('id', stock_id)
        .single();

      if (stockData) {
        const curHigh = Number(stockData.high || 0);
        const curLow = Number(stockData.low || 0);
        const newHigh = Math.max(curHigh, lastExecPrice);
        const newLow = curLow === 0 ? lastExecPrice : Math.min(curLow, lastExecPrice);
        const newVol = Number(stockData.volume || 0) + totalFilledQty;

        writePromises.push(
          supabase
            .from('stocks')
            .update({
              current_price: lastExecPrice,
              high: newHigh,
              low: newLow,
              volume: newVol,
            })
            .eq('id', stock_id)
            .then((res) => res)
        );
      }
    }

    // 5. 유저 신규 주문 등록 (전액 체결이 아닌 경우 호가창에 잔량 등재)
    const initialStatus =
      totalFilledQty === 0 ? 'open' : remainingQty === 0 ? 'filled' : 'partial';

    writePromises.push(
      supabase
        .from('orders')
        .insert({
          stock_id,
          user_id,
          side,
          price: incomingPrice,
          size: incomingSize,
          filled: totalFilledQty,
          status: initialStatus,
          is_lp: false,
        })
        .then((res) => res)
    );

    await Promise.all(writePromises);

    if (totalFilledQty > 0) {
      return {
        success: true,
        filledQty: totalFilledQty,
        execPrice: lastExecPrice,
        message: `🎉 ${totalFilledQty.toLocaleString()}주가 체결되었습니다! (체결가: ₩${lastExecPrice.toLocaleString()})`,
      };
    } else {
      return {
        success: true,
        filledQty: 0,
        message: `주문이 호가창에 정상 접수되었습니다! (${incomingPrice.toLocaleString()}원 ${incomingSize}주)`,
      };
    }
  } catch (err: any) {
    console.error('[dbMatching Error]', err);
    return { success: false, filledQty: 0, message: err.message || '주문 처리 중 오류 발생' };
  }
}
