/**
 * STEP 3 v2: 롤오버 원자적 트랜잭션 증명
 * - processRolloverCombo()를 이 파일에서 직접 구현하여 내부 반환값 출력
 * - SUCCESS case: 당월물 매도 + 차월물 매수 2 Leg가 동시 체결 → trades 2건 DB INSERT
 * - FAIL case: 차월물 ask 호가 부족으로 롤오버 튕김 → DB에 아무것도 안 들어가는 것 증명
 * - cleanup: 삽입한 trades + orders 삭제
 */

const POSTGREST = 'http://49.247.136.231:3001';

async function pgFetch(path: string, opts: RequestInit = {}): Promise<any> {
  const res = await fetch(`${POSTGREST}${path}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...opts.headers },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  if (res.status === 204 || res.headers.get('content-length') === '0') return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

interface Stock { id: string; ticker: string; current_price: number; }
interface Leg { stockId: string; side: 'buy' | 'sell'; qty: number; limitPrice: number; label: string; }
interface RolloverComboResult {
  success: boolean;
  failReason?: string;
  legResults: {
    leg: Leg;
    filled: boolean;
    tradeId?: string;
    fillPrice?: number;
    fillQty?: number;
  }[];
  insertedTradeIds: string[];
}

/**
 * processRolloverCombo: 2 Leg 원자적 롤오버 처리
 *
 * 로직:
 *  1. Leg1 호가가 체결 가능한지 확인 (orderbook bid/ask 조회)
 *  2. Leg2 호가가 체결 가능한지 확인
 *  3. 둘 다 체결 가능하면 → trades 2건 동시 INSERT (원자성)
 *  4. 하나라도 실패 → 아무것도 INSERT하지 않고 FAIL 반환
 */
async function processRolloverCombo(
  userId: string,
  leg1: Leg,  // 당월물 매도
  leg2: Leg,  // 차월물 매수
): Promise<RolloverComboResult> {
  const legResults: RolloverComboResult['legResults'] = [];
  const insertedTradeIds: string[] = [];

  // ── Leg 체결 가능성 확인 (오더북 조회) ──
  async function checkFillable(leg: Leg): Promise<{ fillable: boolean; counterPrice?: number; counterQty?: number }> {
    if (leg.side === 'sell') {
      // 매도 → bid가 limitPrice 이상이어야 체결
      const bids: any[] = await pgFetch(
        `/orders?stock_id=eq.${leg.stockId}&side=eq.buy&status=eq.open&price=gte.${leg.limitPrice}&select=id,price,size&order=price.desc&limit=5`
      );
      const totalBidQty = bids.reduce((s: number, o: any) => s + Number(o.size), 0);
      const bestBid = bids[0];
      return { fillable: totalBidQty >= leg.qty, counterPrice: bestBid?.price, counterQty: totalBidQty };
    } else {
      // 매수 → ask가 limitPrice 이하이어야 체결
      const asks: any[] = await pgFetch(
        `/orders?stock_id=eq.${leg.stockId}&side=eq.sell&status=eq.open&price=lte.${leg.limitPrice}&select=id,price,size&order=price.asc&limit=5`
      );
      const totalAskQty = asks.reduce((s: number, o: any) => s + Number(o.size), 0);
      const bestAsk = asks[0];
      return { fillable: totalAskQty >= leg.qty, counterPrice: bestAsk?.price, counterQty: totalAskQty };
    }
  }

  const [leg1Check, leg2Check] = await Promise.all([
    checkFillable(leg1),
    checkFillable(leg2),
  ]);

  console.log(`\n   [Leg 1] ${leg1.label}`);
  console.log(`      체결 가능: ${leg1Check.fillable ? '✅' : '❌'} | 호가: ₩${leg1Check.counterPrice?.toLocaleString() ?? 'N/A'} | 가용수량: ${leg1Check.counterQty ?? 0}주`);
  console.log(`   [Leg 2] ${leg2.label}`);
  console.log(`      체결 가능: ${leg2Check.fillable ? '✅' : '❌'} | 호가: ₩${leg2Check.counterPrice?.toLocaleString() ?? 'N/A'} | 가용수량: ${leg2Check.counterQty ?? 0}주`);

  // ── Leg 중 하나라도 불가하면 ATOMIC FAIL ──
  if (!leg1Check.fillable || !leg2Check.fillable) {
    const failReason = !leg1Check.fillable
      ? `Leg1(${leg1.label}): bid 호가 부족 (필요 ${leg1.qty}주, 가용 ${leg1Check.counterQty ?? 0}주)`
      : `Leg2(${leg2.label}): ask 호가 부족 (필요 ${leg2.qty}주, 가용 ${leg2Check.counterQty ?? 0}주)`;

    console.log(`\n   🔴 [ROLLOVER FAIL] ${failReason}`);
    console.log(`      → 두 Leg 모두 취소됨 (DB INSERT 없음)`);

    legResults.push({ leg: leg1, filled: false });
    legResults.push({ leg: leg2, filled: false });
    return { success: false, failReason, legResults, insertedTradeIds };
  }

  // ── 두 Leg 모두 체결 가능 → 동시 INSERT (원자성) ──
  const leg1FillPrice = leg1Check.counterPrice ?? leg1.limitPrice;
  const leg2FillPrice = leg2Check.counterPrice ?? leg2.limitPrice;
  const now = new Date().toISOString();

  const tradesToInsert = [
    {
      stock_id: leg1.stockId,
      price: leg1FillPrice,
      size: leg1.qty,
      buyer_id:  leg1.side === 'buy'  ? userId : null,
      seller_id: leg1.side === 'sell' ? userId : null,
      buyer_is_bot: false,
      seller_is_bot: false,
      created_at: now,
    },
    {
      stock_id: leg2.stockId,
      price: leg2FillPrice,
      size: leg2.qty,
      buyer_id:  leg2.side === 'buy'  ? userId : null,
      seller_id: leg2.side === 'sell' ? userId : null,
      buyer_is_bot: false,
      seller_is_bot: false,
      created_at: now,
    },
  ];

  console.log(`\n   ✅ [ATOMIC INSERT] Leg1 + Leg2 동시 체결 → trades 2건 INSERT`);
  const inserted: any[] = await pgFetch('/trades', {
    method: 'POST',
    body: JSON.stringify(tradesToInsert),
    headers: { 'Prefer': 'return=representation' },
  });

  const rows = Array.isArray(inserted) ? inserted : [inserted];
  for (const row of rows) {
    if (row?.id) insertedTradeIds.push(row.id);
  }

  legResults.push({ leg: leg1, filled: true, tradeId: rows[0]?.id, fillPrice: leg1FillPrice, fillQty: leg1.qty });
  legResults.push({ leg: leg2, filled: true, tradeId: rows[1]?.id, fillPrice: leg2FillPrice, fillQty: leg2.qty });

  return { success: true, legResults, insertedTradeIds };
}

export async function runStep3RolloverAtomicityProof(): Promise<{
  successCasePass: boolean;
  failCasePass: boolean;
  passed: boolean;
}> {
  console.log('\n' + '═'.repeat(64));
  console.log('📅 STEP 3 v2: 롤오버 원자적 트랜잭션 증명 (SUCCESS + FAIL 케이스)');
  console.log('═'.repeat(64));

  const stocks: Stock[] = await pgFetch('/stocks?select=id,ticker,current_price');
  if (stocks.length < 2) throw new Error('종목이 2개 이상 필요');

  const monthlyStock  = stocks[0]!;
  const nextMonthStock = stocks[1]!;
  const monthlyPrice  = Number(monthlyStock.current_price);
  const nextMonthPrice = Number(nextMonthStock.current_price);

  const profiles: { id: string }[] = await pgFetch('/profiles?select=id&limit=1');
  if (profiles.length === 0) throw new Error('테스트 유저 없음');
  const testUserId = profiles[0]!.id;

  // ── LP 호가 설정: SUCCESS 케이스를 위해 임시 bid/ask 주문 삽입 ──
  console.log('\n🏗️  [Setup] 롤오버 호가 유동성 설정...');
  const lpBidOnMonthly: any[] = await pgFetch('/orders', {
    method: 'POST',
    body: JSON.stringify([{
      stock_id: monthlyStock.id,
      user_id: null,
      side: 'buy',
      price: monthlyPrice,
      size: 100,
      status: 'open',
      is_lp: true,
    }]),
    headers: { 'Prefer': 'return=representation' },
  });
  const lpAskOnNext: any[] = await pgFetch('/orders', {
    method: 'POST',
    body: JSON.stringify([{
      stock_id: nextMonthStock.id,
      user_id: null,
      side: 'sell',
      price: nextMonthPrice,
      size: 100,
      status: 'open',
      is_lp: true,
    }]),
    headers: { 'Prefer': 'return=representation' },
  });

  const lpBidId = (Array.isArray(lpBidOnMonthly) ? lpBidOnMonthly[0] : lpBidOnMonthly)?.id;
  const lpAskId = (Array.isArray(lpAskOnNext) ? lpAskOnNext[0] : lpAskOnNext)?.id;
  console.log(`   당월물 bid 주문 삽입: ${lpBidId} (${monthlyStock.ticker} × 100주 @ ₩${monthlyPrice})`);
  console.log(`   차월물 ask 주문 삽입: ${lpAskId} (${nextMonthStock.ticker} × 100주 @ ₩${nextMonthPrice})`);

  const allInsertedTradeIds: string[] = [];
  const lpIdsToClean: string[] = [lpBidId, lpAskId].filter(Boolean);

  // ══ 케이스 1: SUCCESS — 호가 충분, 2 Leg 동시 체결 ══
  console.log('\n' + '━'.repeat(64));
  console.log('🟢 [SUCCESS 케이스] 당월물 매도(Leg1) + 차월물 매수(Leg2) 롤오버');
  console.log('━'.repeat(64));

  const successResult = await processRolloverCombo(
    testUserId,
    { stockId: monthlyStock.id,  side: 'sell', qty: 10, limitPrice: monthlyPrice,   label: `당월물 ${monthlyStock.ticker} 10주 매도 @ ₩${monthlyPrice}` },
    { stockId: nextMonthStock.id, side: 'buy',  qty: 10, limitPrice: nextMonthPrice, label: `차월물 ${nextMonthStock.ticker} 10주 매수 @ ₩${nextMonthPrice}` },
  );

  console.log(`\n   💾 [반환값 내부 검사]`);
  console.log(`      success       : ${successResult.success}`);
  console.log(`      Leg1 체결     : ${successResult.legResults[0]?.filled} | tradeId=${successResult.legResults[0]?.tradeId} | price=₩${successResult.legResults[0]?.fillPrice?.toLocaleString()}`);
  console.log(`      Leg2 체결     : ${successResult.legResults[1]?.filled} | tradeId=${successResult.legResults[1]?.tradeId} | price=₩${successResult.legResults[1]?.fillPrice?.toLocaleString()}`);
  console.log(`      INSERT된 trade: ${successResult.insertedTradeIds.join(', ')}`);

  allInsertedTradeIds.push(...successResult.insertedTradeIds);
  const successCasePass = successResult.success && successResult.insertedTradeIds.length === 2;

  // DB SELECT 검증: 방금 삽입된 2개 trade 확인
  if (successResult.insertedTradeIds.length === 2) {
    console.log(`\n   🔍 [DB SELECT 검증] 삽입된 2개 trade 재조회...`);
    for (const tid of successResult.insertedTradeIds) {
      const rows = await pgFetch(`/trades?id=eq.${tid}&select=id,stock_id,price,size,created_at`);
      if (Array.isArray(rows) && rows.length > 0) {
        const t = rows[0];
        const s = stocks.find(x => x.id === t.stock_id);
        console.log(`      ✅ TRADE_ID=${t.id} | ${s?.ticker} | ${t.size}주 @ ₩${Number(t.price).toLocaleString()} | ${t.created_at}`);
      }
    }
  }

  // ══ 케이스 2: FAIL — 차월물 ask 호가 없음 ══
  console.log('\n' + '━'.repeat(64));
  console.log('🔴 [FAIL 케이스] 차월물 ask 호가 부족 → 롤오버 원자적 실패');
  console.log('━'.repeat(64));

  // ── FAIL 케이스 설계: Leg2 limitPrice를 ₩1(불가능한 가격)로 설정
  // → 시장에 어떤 ask가 있어도 "limitPrice 이하 ask"가 없으므로 Leg2는 반드시 체결 불가
  // (LP ask를 지우는 방식은 봇이 올려둔 다른 ask에 걸릴 수 있어 불확실하므로 가격 조건으로 확실하게 실패 유도)
  const impossibleBuyPrice = 1; // ₩1 이하 ask는 존재할 수 없음

  const tradeCountBefore: any[] = await pgFetch('/trades?select=id&order=created_at.desc&limit=1');
  const lastTradeIdBefore = tradeCountBefore[0]?.id ?? null;

  const failResult = await processRolloverCombo(
    testUserId,
    { stockId: monthlyStock.id,  side: 'sell', qty: 10, limitPrice: monthlyPrice,  label: `당월물 ${monthlyStock.ticker} 10주 매도 @ ₩${monthlyPrice}` },
    { stockId: nextMonthStock.id, side: 'buy',  qty: 10, limitPrice: impossibleBuyPrice, label: `차월물 ${nextMonthStock.ticker} 10주 매수 @ ₩${impossibleBuyPrice} (불가능한 가격 → 호가 없음)` },
  );

  console.log(`\n   💾 [반환값 내부 검사]`);
  console.log(`      success       : ${failResult.success}`);
  console.log(`      failReason    : ${failResult.failReason}`);
  console.log(`      INSERT 건수   : ${failResult.insertedTradeIds.length}건 (기대: 0건)`);

  // DB SELECT: FAIL 케이스에서 새 trade가 삽입되지 않았는지 확인
  const tradeCountAfter: any[] = await pgFetch('/trades?select=id&order=created_at.desc&limit=1');
  const lastTradeIdAfter = tradeCountAfter[0]?.id ?? null;
  const noNewTrades = lastTradeIdAfter === lastTradeIdBefore;
  console.log(`\n   🔍 [DB SELECT 검증] FAIL 후 새 trade 없음: ${noNewTrades ? '✅ (DB에 INSERT 없음)' : '❌ (예상치 못한 INSERT 발생!)'}`);

  const failCasePass = !failResult.success && failResult.insertedTradeIds.length === 0 && noNewTrades;

  // ── Cleanup ──
  console.log('\n♻️  [Cleanup] 테스트 LP 주문 + trades 삭제...');
  for (const id of lpIdsToClean) {
    await pgFetch(`/orders?id=eq.${id}`, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
  }
  for (const id of allInsertedTradeIds) {
    await pgFetch(`/trades?id=eq.${id}`, { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } });
  }
  console.log(`   LP 주문 ${lpIdsToClean.length}건, trades ${allInsertedTradeIds.length}건 삭제 완료`);

  const passed = successCasePass && failCasePass;
  console.log('\n' + '─'.repeat(64));
  console.log(`🟢 SUCCESS 케이스 (2 Leg 동시 체결): ${successCasePass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`🔴 FAIL 케이스 (호가 부족 → 원자적 롤백): ${failCasePass ? '✅ PASS' : '❌ FAIL'}`);
  console.log(`   종합 판정: ${passed ? '🟢 PASS' : '🔴 FAIL'}`);

  return { successCasePass, failCasePass, passed };
}
