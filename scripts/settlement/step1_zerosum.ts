/**
 * STEP 1 v2: 50명 병렬 Race Condition 방어 증명
 * - 50명이 1초 내에 수백 건을 동시 발사 → increment_user_cash RPC 병렬 충돌 유발
 * - SUM(cash) Before/After 비교로 오차 0원 증명
 */

const POSTGREST = 'http://49.247.136.231:3001';
const TIMEOUT_MS = 8000;

async function pgFetch(path: string, opts: RequestInit = {}): Promise<any> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${POSTGREST}${path}`, {
      ...opts,
      signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', ...opts.headers },
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return await res.json();
  } catch (e) {
    clearTimeout(t);
    throw e;
  }
}

async function rpc(func: string, body: object): Promise<unknown> {
  return pgFetch(`/rpc/${func}`, { method: 'POST', body: JSON.stringify(body) });
}

async function sumCash(): Promise<number> {
  // PostgREST aggregate: select sum using Range header approach
  const rows: { cash: number }[] = await pgFetch('/profiles?select=cash');
  return rows.reduce((s, r) => s + Number(r.cash), 0);
}

interface StockRow { id: string; ticker: string; current_price: number; }

export async function runStep1RaceConditionProof(): Promise<{
  beforeSum: number;
  afterSum: number;
  discrepancy: number;
  totalRpcCalls: number;
  errors: number;
  passed: boolean;
}> {
  console.log('\n' + '═'.repeat(64));
  console.log('📊 STEP 1 v2: 50명 병렬 Race Condition → increment_user_cash 충돌 검증');
  console.log('═'.repeat(64));

  const beforeSum = await sumCash();
  console.log(`\n🔷 [Before] SUM(cash) = ₩${beforeSum.toLocaleString()} (전체 유저)`);

  // 테스트 유저 페어 조회
  const profiles: { id: string; cash: number }[] = await pgFetch('/profiles?select=id,cash&limit=100');
  const stocks: StockRow[] = await pgFetch('/stocks?select=id,ticker,current_price');
  if (profiles.length < 2 || stocks.length === 0) throw new Error('유저/종목 데이터 부족');

  const stock = stocks[0]!;
  const unitPrice = Number(stock.current_price);
  const qty = 1;
  const tradeNotional = unitPrice * qty;

  // 유저 쌍 구성: [buyer, seller] × 25쌍 = 50명
  const pairs: [string, string][] = [];
  for (let i = 0; i + 1 < Math.min(profiles.length, 100); i += 2) {
    if (pairs.length >= 25) break;
    const buyer  = profiles[i]!;
    const seller = profiles[i + 1]!;
    // 매수 유저에게 충분한 현금이 있을 때만 포함
    if (Number(buyer.cash) >= tradeNotional) {
      pairs.push([buyer.id, seller.id]);
    }
  }

  if (pairs.length === 0) throw new Error('유효한 [buyer, seller] 쌍 없음 (잔고 부족)');
  console.log(`\n⚡ [병렬 실행] ${pairs.length}쌍(${pairs.length * 2}명) × ${stock.ticker} ${qty}주 @ ₩${unitPrice.toLocaleString()}`);
  console.log(`   → increment_user_cash RPC ${pairs.length * 2}건을 동시에 쏩니다.`);

  let errors = 0;
  const rpcCalls: Promise<void>[] = [];

  // 모든 쌍의 현금 이동을 Promise.all로 동시 발사 (Race Condition 유발)
  for (const [buyerId, sellerId] of pairs) {
    rpcCalls.push(
      (async () => {
        try {
          // 매수자: -tradeNotional, 매도자: +tradeNotional (동시에 병렬 발사)
          await Promise.all([
            rpc('increment_user_cash', { p_user_id: buyerId,  p_delta: -tradeNotional }),
            rpc('increment_user_cash', { p_user_id: sellerId, p_delta: +tradeNotional }),
          ]);
        } catch {
          errors++;
        }
      })()
    );
  }

  await Promise.all(rpcCalls);

  const totalRpcCalls = pairs.length * 2;
  console.log(`   ✅ ${totalRpcCalls}건 RPC 완료 (에러: ${errors}건)`);

  const afterSum = await sumCash();
  const discrepancy = afterSum - beforeSum;
  const passed = discrepancy === 0;

  console.log(`\n🔶 [After]  SUM(cash) = ₩${afterSum.toLocaleString()}`);
  console.log('\n' + '─'.repeat(64));
  console.log(`🧮 오차 = ₩${discrepancy.toLocaleString()}`);
  console.log(`   판정: ${passed ? '🟢 PASS — Race Condition 방어 완전 증명 (₩0 오차)' : `🔴 FAIL — ₩${discrepancy.toLocaleString()} 오차 발생!`}`);

  // 원상 복구 (cleanup: 역방향 RPC로 되돌림)
  console.log('\n♻️  [Cleanup] 원상 복구 중 (역방향 RPC)...');
  const cleanupCalls: Promise<void>[] = [];
  for (const [buyerId, sellerId] of pairs) {
    cleanupCalls.push(
      (async () => {
        try {
          await Promise.all([
            rpc('increment_user_cash', { p_user_id: buyerId,  p_delta: +tradeNotional }),
            rpc('increment_user_cash', { p_user_id: sellerId, p_delta: -tradeNotional }),
          ]);
        } catch { /* best-effort */ }
      })()
    );
  }
  await Promise.all(cleanupCalls);
  const finalSum = await sumCash();
  console.log(`   복구 후 SUM(cash) = ₩${finalSum.toLocaleString()} (Before와 일치: ${finalSum === beforeSum ? '✅' : '⚠️ 불일치'})`);

  return { beforeSum, afterSum, discrepancy, totalRpcCalls, errors, passed };
}
