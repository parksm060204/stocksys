import { SupabaseClient } from '@supabase/supabase-js';

export interface OrderInput {
  stock_id: string;
  user_id: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
}

export async function submitAndMatchOrder(
  supabase: SupabaseClient,
  input: OrderInput
): Promise<{ success: boolean; filledQty: number; message: string }> {
  const { stock_id, user_id, side, price: incomingPrice, size: incomingSize } = input;

  if (incomingSize <= 0 || incomingPrice <= 0) {
    return { success: false, filledQty: 0, message: "올바르지 않은 주문 가격 또는 수량입니다." };
  }

  try {
    // 0. 초기 잔고 / 보유 수량 엄격 사전 검증 (Race Condition & 허수 주문 차단)
    if (user_id) {
      if (side === 'buy') {
        const { data: profile } = await supabase.from('profiles').select('cash').eq('id', user_id).single();
        const availableCash = Number(profile?.cash || 0);
        if (availableCash < incomingPrice) {
          return { success: false, filledQty: 0, message: "예수금이 부족하여 주문을 접수할 수 없습니다." };
        }
      } else {
        const { data: holding } = await supabase.from('holdings').select('quantity').eq('user_id', user_id).eq('stock_id', stock_id).single();
        const availableQty = Number(holding?.quantity || 0);
        if (availableQty < incomingSize) {
          return { success: false, filledQty: 0, message: "보유 수량이 부족하여 주문을 접수할 수 없습니다." };
        }
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
      query = query.lte('price', incomingPrice).order('price', { ascending: true }).order('created_at', { ascending: true });
    } else {
      // 매도 주문: 같거나 비싼 매수호가 체결 (가격 내림차순, 접수시각 오름차순)
      query = query.gte('price', incomingPrice).order('price', { ascending: false }).order('created_at', { ascending: true });
    }

    const { data: oppOrders, error: fetchErr } = await query;
    if (fetchErr) throw fetchErr;

    // 메모리 상 잔고/보유량 추적 Map (체결 루프 중 연속 차감/증가)
    const userCashMap = new Map<string, number>();
    const userHoldingMap = new Map<string, { id?: string; qty: number; avgPrice: number }>();

    const getCash = async (uid: string): Promise<number> => {
      if (userCashMap.has(uid)) return userCashMap.get(uid)!;
      const { data } = await supabase.from('profiles').select('cash').eq('id', uid).single();
      const val = Number(data?.cash || 0);
      userCashMap.set(uid, val);
      return val;
    };

    const getHolding = async (uid: string): Promise<{ id?: string; qty: number; avgPrice: number }> => {
      const key = `${uid}_${stock_id}`;
      if (userHoldingMap.has(key)) return userHoldingMap.get(key)!;
      const { data } = await supabase.from('holdings').select('*').eq('user_id', uid).eq('stock_id', stock_id).single();
      const val = data
        ? { id: data.id, qty: Number(data.quantity || 0), avgPrice: Number(data.avg_price || 0) }
        : { qty: 0, avgPrice: 0 };
      userHoldingMap.set(key, val);
      return val;
    };

    // 배치 데이터 수집용
    const tradesToInsert: any[] = [];
    const oppOrdersToUpdate: { id: string; filled: number; status: string }[] = [];

    if (oppOrders && oppOrders.length > 0) {
      for (const opp of oppOrders) {
        if (remainingQty <= 0) break;

        const oppRemaining = Math.max(0, Number(opp.size) - Number(opp.filled));
        if (oppRemaining <= 0) continue;

        const execPrice = Number(opp.price);
        const buyerId = side === 'buy' ? user_id : opp.user_id;
        const sellerId = side === 'sell' ? user_id : opp.user_id;
        const buyerIsBot = side === 'buy' ? false : !opp.user_id;
        const sellerIsBot = side === 'sell' ? false : !opp.user_id;

        let desiredMatchQty = Math.min(remainingQty, oppRemaining);

        // 매수 유저 예수금 실재 검증 및 수량 안전 클램핑 (공짜 주식 익스플로잇 완전 차단)
        if (buyerId && !buyerIsBot) {
          const currentCash = await getCash(buyerId);
          const maxAffordable = Math.floor(currentCash / execPrice);
          if (maxAffordable <= 0) {
            // 매수자 돈이 부족함 -> 체결 불가
            if (side === 'buy') break; // 본인 매수 주문이면 잔고 부족으로 매칭 종료
            else continue; // 상대방 매수자의 돈이 부족하면 다음 주문으로 이동
          }
          desiredMatchQty = Math.min(desiredMatchQty, maxAffordable);
        }

        if (desiredMatchQty <= 0) continue;
        const matchQty = desiredMatchQty;
        const cost = execPrice * matchQty;
        lastExecPrice = execPrice;

        // A. 체결 기록 수집
        tradesToInsert.push({
          stock_id,
          buyer_id: buyerId,
          seller_id: sellerId,
          buyer_is_bot: buyerIsBot,
          seller_is_bot: sellerIsBot,
          price: execPrice,
          size: matchQty,
        });

        // B. 반대 주문 상태 수집
        const newOppFilled = Number(opp.filled) + matchQty;
        const newOppStatus = newOppFilled >= Number(opp.size) ? 'filled' : 'partial';
        oppOrdersToUpdate.push({ id: opp.id, filled: newOppFilled, status: newOppStatus });

        // C. 메모리 잔고/보유량 업데이트
        if (buyerId && !buyerIsBot) {
          const currentCash = await getCash(buyerId);
          userCashMap.set(buyerId, Math.max(0, currentCash - cost));

          const holding = await getHolding(buyerId);
          const oldQty = holding.qty;
          const oldAvg = holding.avgPrice;
          const newQty = oldQty + matchQty;
          const newAvg = (oldQty * oldAvg + cost) / newQty;
          userHoldingMap.set(`${buyerId}_${stock_id}`, { id: holding.id, qty: newQty, avgPrice: newAvg });
        }

        if (sellerId && !sellerIsBot) {
          const currentCash = await getCash(sellerId);
          userCashMap.set(sellerId, currentCash + cost);

          const holding = await getHolding(sellerId);
          const newQty = Math.max(0, holding.qty - matchQty);
          userHoldingMap.set(`${sellerId}_${stock_id}`, { id: holding.id, qty: newQty, avgPrice: holding.avgPrice });
        }

        remainingQty -= matchQty;
        totalFilledQty += matchQty;
      }
    }

    // 2. 배치 DB 반영 (Promise.all을 사용한 N+1 쿼리 최적화)
    const writePromises: PromiseLike<any>[] = [];


    // A. Trades 배치 Insert
    if (tradesToInsert.length > 0) {
      writePromises.push(supabase.from('trades').insert(tradesToInsert).then(res => res));
    }

    // B. Opp Orders 배치 Update
    for (const o of oppOrdersToUpdate) {
      writePromises.push(supabase.from('orders').update({ filled: o.filled, status: o.status }).eq('id', o.id).then(res => res));
    }

    // C. User Cash 배치 Update
    for (const [uid, newCash] of Array.from(userCashMap.entries())) {
      writePromises.push(supabase.from('profiles').update({ cash: newCash }).eq('id', uid).then(res => res));
    }

    // D. User Holdings 배치 Update/Insert/Delete
    for (const [key, h] of Array.from(userHoldingMap.entries())) {
      const [uid] = key.split('_');
      if (h.id) {
        if (h.qty === 0) {
          writePromises.push(supabase.from('holdings').delete().eq('id', h.id).then(res => res));
        } else {
          writePromises.push(supabase.from('holdings').update({ quantity: h.qty, avg_price: h.avgPrice }).eq('id', h.id).then(res => res));
        }
      } else if (h.qty > 0) {
        writePromises.push(supabase.from('holdings').insert({ user_id: uid, stock_id, quantity: h.qty, avg_price: h.avgPrice }).then(res => res));
      }
    }

    // E. 주식 현재가 / 체결량 / 고가 / 저가 업데이트
    if (totalFilledQty > 0) {
      const { data: stockData } = await supabase.from('stocks').select('high, low, volume').eq('id', stock_id).single();
      if (stockData) {
        const newHigh = Math.max(Number(stockData.high || 0), lastExecPrice);
        const newLow = Number(stockData.low || 0) === 0 ? lastExecPrice : Math.min(Number(stockData.low), lastExecPrice);
        const newVol = Number(stockData.volume || 0) + totalFilledQty;
        writePromises.push(
          supabase.from('stocks').update({
            current_price: lastExecPrice,
            high: newHigh,
            low: newLow,
            volume: newVol
          }).eq('id', stock_id).then(res => res)
        );
      }
    }

    // F. 미체결 남아있는 주문 등록 (orders insert)
    const initialStatus = totalFilledQty === 0 ? 'open' : remainingQty === 0 ? 'filled' : 'partial';
    writePromises.push(
      supabase.from('orders').insert({
        stock_id,
        user_id,
        side,
        price: incomingPrice,
        size: incomingSize,
        filled: totalFilledQty,
        status: initialStatus,
        is_lp: false,
      }).then(res => res)
    );

    // 병렬 실행
    await Promise.all(writePromises);

    if (totalFilledQty > 0) {
      return {
        success: true,
        filledQty: totalFilledQty,
        message: `🎉 ${totalFilledQty.toLocaleString()}주가 체결되었습니다! (평균 체결가: ₩${lastExecPrice.toLocaleString()})`
      };
    } else {
      return {
        success: true,
        filledQty: 0,
        message: `주문이 호가창에 정상 접수되었습니다! (${incomingPrice.toLocaleString()}원 ${incomingSize}주)`
      };
    }
  } catch (err: any) {
    console.error('[dbMatching Error]', err);
    return { success: false, filledQty: 0, message: err.message || "주문 처리 중 오류 발생" };
  }
}
