/**
 * Phase 1 Settlement Integrity & Deterministic Idempotency Regression Suite
 *
 * 직접 재현하고 차단함을 증명하는 항목:
 *  1. NaN 거래 batch 전체 거부 (현금/보유/거래/원장 무변경)
 *  2. Infinity 거래 거부
 *  3. 음수/0/소수 수량 거부
 *  4. 총 거래대금 불일치 거부 (외부 total_amount 주입 자체가 불가)
 *  5. 수수료율 계산 정확성 (1,000원 × 0.0025 = 2.5원 → 반올림 3원 정책 명시)
 *  6. maker rebate 정확성 (음수 rate → 지급)
 *  7. ID 없는 거래 거부
 *  8. batch 내부 중복 ID 거부
 *  9. repository 재생성 후 멱등성 유지 (authoritative ledger)
 * 10. 실패 batch에서 멱등성 기록도 rollback
 * 11. 빈 ID / 동일 계좌 / 누락 참가자 거부
 * 12. 결과 객체에 NaN/Infinity 없음
 */

import assert from 'node:assert';
import { MemoryDatabase } from '../lib/memoryDb/memoryStore';
import { InMemorySettlementRepository } from '../lib/repositories/inMemory/InMemorySettlementRepository';
import { MAX_ABS_FEE_RATE } from '../lib/repositories/settlementPolicy';
import type { TradeSettlementInput } from '../lib/repositories/types';

const STOCK = 'STK_1';
const BUYER = 'buyer_1';
const SELLER = 'seller_1';

function makeDb(): MemoryDatabase {
  const db = new MemoryDatabase();
  db.profiles.set(BUYER, {
    id: BUYER, user_id: BUYER, username: 'b', nickname: 'b',
    cash: 100_000_000, net_worth: 100_000_000, rank_tier: 'BRONZE', created_at: '2026-01-01T00:00:00.000Z',
  });
  db.profiles.set(SELLER, {
    id: SELLER, user_id: SELLER, username: 's', nickname: 's',
    cash: 0, net_worth: 0, rank_tier: 'BRONZE', created_at: '2026-01-01T00:00:00.000Z',
  });
  db.profileUserIdIndex.set(BUYER, BUYER);
  db.profileUserIdIndex.set(SELLER, SELLER);
  const h = { id: `${SELLER}_${STOCK}`, user_id: SELLER, stock_id: STOCK, quantity: 10_000, avg_price: 1000, created_at: '2026-01-01T00:00:00.000Z' };
  db.holdings.set(h.id, h);
  db.addHoldingToIndex(h);
  return db;
}

function trade(overrides: Partial<TradeSettlementInput>): TradeSettlementInput {
  return {
    id: `t_${Math.random().toString(36).slice(2, 8)}`,
    stock_id: STOCK,
    buy_order_id: 'BO_1',
    sell_order_id: 'SO_1',
    buyer_id: BUYER,
    seller_id: SELLER,
    buyer_is_bot: false,
    seller_is_bot: false,
    price: 1000,
    size: 1,
    fee_rates: { buyerFeeRate: 0, sellerFeeRate: 0 },
    ...overrides,
  } as TradeSettlementInput;
}

function snapshotState(db: MemoryDatabase) {
  return JSON.stringify({
    buyer: db.profiles.get(BUYER)?.cash,
    seller: db.profiles.get(SELLER)?.cash,
    buyerHolding: db.holdings.get(`${BUYER}_${STOCK}`)?.quantity ?? 0,
    sellerHolding: db.holdings.get(`${SELLER}_${STOCK}`)?.quantity,
    trades: db.trades.length,
    ledger: db.settlementLedger.size,
  });
}

function assertNoNonFinite(result: Record<string, unknown>, label: string): void {
  for (const [k, v] of Object.entries(result)) {
    if (typeof v === 'number') {
      assert.ok(Number.isFinite(v), `${label}: result.${k} must be finite (got ${v})`);
    }
  }
}

async function main() {
  console.log('================================================================');
  console.log('[TEST] Phase 1 Settlement Integrity & Deterministic Idempotency');
  console.log('================================================================\n');

  // ── 1. NaN 거래 batch 전체 거부 ──
  console.log('▶ [TEST 1] NaN trade rejects entire batch, zero mutation');
  {
    const db = makeDb();
    const repo = new InMemorySettlementRepository(db);
    const before = snapshotState(db);

    // 정상 거래 + NaN 거래가 섞인 batch → 전체 거부
    const result = await repo.settleTradeBatchAtomically([
      trade({ id: 'nan_ok_1' }),
      trade({ id: 'nan_trade', price: Number.NaN }),
    ]);

    assert.strictEqual(result.success, false, 'NaN trade must reject the batch');
    assert.strictEqual(result.errorCode, 'TRADE_PRICE_NOT_FINITE', 'explicit error code for NaN price');
    assert.strictEqual(result.settledTradesCount, 0, 'no trade committed');
    assert.strictEqual(snapshotState(db), before, 'cash/holdings/trades/ledger must be unchanged');
    assertNoNonFinite(result as unknown as Record<string, unknown>, 'NaN batch result');
    assert.ok(Number.isFinite(db.profiles.get(BUYER)!.cash), 'buyer cash remains finite');
    console.log('  ✅ [PASS] NaN trade rejected; state fully preserved');
  }

  // ── 2. Infinity / -Infinity 거부 ──
  console.log('\n▶ [TEST 2] Infinity and -Infinity rejected');
  for (const [label, price, code] of [
    ['+Infinity', Number.POSITIVE_INFINITY, 'TRADE_PRICE_NOT_FINITE'],
    ['-Infinity', Number.NEGATIVE_INFINITY, 'TRADE_PRICE_NOT_FINITE'],
    ['0 price', 0, 'TRADE_PRICE_NOT_POSITIVE'],
    ['negative price', -1000, 'TRADE_PRICE_NOT_POSITIVE'],
  ] as const) {
    const db = makeDb();
    const repo = new InMemorySettlementRepository(db);
    const before = snapshotState(db);
    const res = await repo.settleTradeBatchAtomically([trade({ id: `inf_${label}`, price })]);
    assert.strictEqual(res.success, false, `${label} must be rejected`);
    assert.strictEqual(res.errorCode, code, `${label} error code`);
    assert.strictEqual(snapshotState(db), before, `${label} leaves state unchanged`);
  }
  console.log('  ✅ [PASS] Infinity / zero / negative price rejected');

  // ── 3. 음수/0/소수 수량 거부 ──
  console.log('\n▶ [TEST 3] negative / zero / fractional size rejected');
  for (const [label, size, code] of [
    ['negative', -5, 'TRADE_SIZE_NOT_POSITIVE'],
    ['zero', 0, 'TRADE_SIZE_NOT_POSITIVE'],
    ['fractional', 1.5, 'TRADE_SIZE_NOT_INTEGER'],
  ] as const) {
    const db = makeDb();
    const repo = new InMemorySettlementRepository(db);
    const before = snapshotState(db);
    const res = await repo.settleTradeBatchAtomically([trade({ id: `sz_${label}`, size })]);
    assert.strictEqual(res.success, false, `${label} size must be rejected`);
    assert.strictEqual(res.errorCode, code, `${label} size error code`);
    assert.strictEqual(snapshotState(db), before, `${label} size leaves state unchanged`);
  }
  console.log('  ✅ [PASS] invalid size rejected');

  // ── 4. 총 거래대금 불일치: 외부 주입 자체가 타입으로 불가 ──
  console.log('\n▶ [TEST 4] total amount is derived, never injected');
  {
    const db = makeDb();
    const repo = new InMemorySettlementRepository(db);
    const bogus = { ...trade({ id: 'amt_1' }), total_amount: 999_999 } as unknown as TradeSettlementInput;
    const res = await repo.settleTradeBatchAtomically([bogus]);
    // 알 수 없는 필드는 무시되고 price*size(=1000)로 정산된다 (주입 무력화)
    assert.strictEqual(res.success, true, 'trade settles with derived amount');
    assert.strictEqual(res.totalAmount, 1000, 'totalAmount must equal price × size, not the injected value');
    assert.strictEqual(db.profiles.get(BUYER)!.cash, 100_000_000 - 1000, 'buyer paid exactly price × size');
    console.log('  ✅ [PASS] injected total_amount ignored; derived amount used');
  }

  // ── 5/6. 수수료율 계산 정확성 + maker rebate ──
  console.log('\n▶ [TEST 5] fee rate → amount computation (taker fee & maker rebate)');
  {
    const db = makeDb();
    const repo = new InMemorySettlementRepository(db);
    // 1,000원 거래, taker rate 0.0025 → 2.5원 → 정수 반올림 3원
    // buyer(taker) pays +3, seller(maker, rebate -0.001) receives +1
    const res = await repo.settleTradeBatchAtomically([
      trade({ id: 'fee_1', price: 1000, size: 1, fee_rates: { buyerFeeRate: 0.0025, sellerFeeRate: -0.001 } }),
    ]);
    assert.strictEqual(res.success, true, 'fee trade settles');
    const buyer = db.profiles.get(BUYER)!.cash;
    const seller = db.profiles.get(SELLER)!.cash;
    assert.strictEqual(buyer, 100_000_000 - 1000 - 3, `buyer pays amount + 3 (got ${buyer})`);
    assert.strictEqual(seller, 1000 + 1, `maker receives amount + 1 rebate (got ${seller})`);
    // zero-sum: (매수자 지출 - 매도자 수취) == 당기 순 수수료(3 - 1 = 2)
    // 즉 대가 1000은 양측 사이에서 이동하고, 시스템에 남는 것은 순수수료뿐이다.
    const netFee = (100_000_000 - buyer) - seller;
    assert.strictEqual(netFee, 2, 'buyer outflow minus seller inflow equals net fee (2)');
    console.log('  ✅ [PASS] taker fee 2.5→3 and maker rebate -1 computed from rates');
  }

  // ── 6b. 과도한 수수료율 / NaN 수수료율 거부 ──
  console.log('\n▶ [TEST 6] out-of-range and NaN fee rates rejected');
  for (const [label, rate, code] of [
    ['too large', MAX_ABS_FEE_RATE + 0.01, 'FEE_RATE_OUT_OF_RANGE'],
    ['too negative', -(MAX_ABS_FEE_RATE + 0.01), 'FEE_RATE_OUT_OF_RANGE'],
    ['NaN', Number.NaN, 'FEE_RATE_NOT_FINITE'],
  ] as const) {
    const db = makeDb();
    const repo = new InMemorySettlementRepository(db);
    const before = snapshotState(db);
    const res = await repo.settleTradeBatchAtomically([
      trade({ id: `fr_${label}`, fee_rates: { buyerFeeRate: rate, sellerFeeRate: 0 } }),
    ]);
    assert.strictEqual(res.success, false, `${label} fee rate must be rejected`);
    assert.strictEqual(res.errorCode, code, `${label} fee rate error code`);
    assert.strictEqual(snapshotState(db), before, `${label} leaves state unchanged`);
  }
  console.log('  ✅ [PASS] invalid fee rates rejected');

  // ── 7. ID 없는 거래 거부 ──
  console.log('\n▶ [TEST 7] missing / empty trade id rejected');
  for (const [label, id] of [['undefined', undefined], ['empty', '']] as const) {
    const db = makeDb();
    const repo = new InMemorySettlementRepository(db);
    const before = snapshotState(db);
    const res = await repo.settleTradeBatchAtomically([trade({ id: id as unknown as string })]);
    assert.strictEqual(res.success, false, `${label} id must be rejected`);
    assert.strictEqual(res.errorCode, 'TRADE_ID_MISSING', `${label} id error code`);
    assert.strictEqual(snapshotState(db), before, `${label} leaves state unchanged`);
  }
  console.log('  ✅ [PASS] ID-less trade rejected');

  // ── 8. batch 내부 중복 ID 거부 ──
  console.log('\n▶ [TEST 8] duplicate trade id inside one batch rejected');
  {
    const db = makeDb();
    const repo = new InMemorySettlementRepository(db);
    const before = snapshotState(db);
    const res = await repo.settleTradeBatchAtomically([
      trade({ id: 'dup_1' }),
      trade({ id: 'dup_1' }),
    ]);
    assert.strictEqual(res.success, false, 'batch-internal duplicate must be rejected');
    assert.strictEqual(res.errorCode, 'TRADE_ID_DUPLICATE_IN_BATCH', 'duplicate error code');
    assert.strictEqual(snapshotState(db), before, 'state unchanged after duplicate rejection');
    console.log('  ✅ [PASS] batch-internal duplicate rejected');
  }

  // ── 9. 동일 ID 재실행 + repository 재생성 후 멱등성 유지 ──
  console.log('\n▶ [TEST 9] replay + repository recreation keeps idempotency (authoritative ledger)');
  {
    const db = makeDb();
    const repo1 = new InMemorySettlementRepository(db);
    const first = await repo1.settleTradeBatchAtomically([trade({ id: 'idem_1', price: 1000, size: 2 })]);
    assert.strictEqual(first.success, true, 'first settlement succeeds');
    const afterFirst = snapshotState(db);
    assert.strictEqual(first.settledTradesCount, 1, 'one trade settled');

    // (a) 같은 repository 재실행
    const replay1 = await repo1.settleTradeBatchAtomically([trade({ id: 'idem_1', price: 1000, size: 2 })]);
    assert.strictEqual(replay1.settledTradesCount, 0, 'replay must not re-settle');
    assert.ok(replay1.skippedTradeIds?.includes('idem_1'), 'replay reported as skipped');
    assert.strictEqual(snapshotState(db), afterFirst, 'replay leaves state unchanged');

    // (b) repository 인스턴스 재생성 (엔진 재시작 모사)
    const repo2 = new InMemorySettlementRepository(db);
    assert.strictEqual(repo2.isTradeSettled('idem_1'), true, 'new repository instance still knows the ledger');
    const replay2 = await repo2.settleTradeBatchAtomically([trade({ id: 'idem_1', price: 1000, size: 2 })]);
    assert.strictEqual(replay2.settledTradesCount, 0, 'recreated repository must not re-settle');
    assert.strictEqual(snapshotState(db), afterFirst, 'recreated repository leaves state unchanged');
    console.log('  ✅ [PASS] idempotency survives repository recreation');
  }

  // ── 10. 실패 batch의 ID는 settled로 기록되지 않음 ──
  console.log('\n▶ [TEST 10] failed batch ids are NOT recorded as settled');
  {
    const db = makeDb();
    const repo = new InMemorySettlementRepository(db);
    // 잔고 부족으로 실패하는 batch
    const res = await repo.settleTradeBatchAtomically([
      trade({ id: 'fail_1', price: 1000, size: 10_000_000 }),
    ]);
    assert.strictEqual(res.success, false, 'batch must fail (insufficient cash)');
    assert.strictEqual(repo.isTradeSettled('fail_1'), false, 'failed id must not be in ledger');
    assert.strictEqual(db.settlementLedger.has('fail_1'), false, 'authoritative ledger must not contain failed id');

    // 잔고가 확보되면 같은 ID로 정상 정산 가능해야 한다
    db.profiles.get(BUYER)!.cash = 100_000_000_000;
    const retry = await repo.settleTradeBatchAtomically([trade({ id: 'fail_1', price: 1000, size: 1 })]);
    assert.strictEqual(retry.success, true, 'previously failed id can settle once conditions allow');
    assert.strictEqual(repo.isTradeSettled('fail_1'), true, 'now marked settled');
    console.log('  ✅ [PASS] failed batch leaves no settlement ledger entry');
  }

  // ── 11. 빈 문자열 / 동일 계좌 / 참가자 누락 거부 ──
  console.log('\n▶ [TEST 11] empty ids / same account / missing party rejected');
  {
    const db = makeDb();
    const repo = new InMemorySettlementRepository(db);
    const before = snapshotState(db);

    const sameAccount = await repo.settleTradeBatchAtomically([trade({ id: 'same_1', buyer_id: BUYER, seller_id: BUYER })]);
    assert.strictEqual(sameAccount.errorCode, 'TRADE_SAME_ACCOUNT', 'buyer === seller must be rejected');

    const noParty = await repo.settleTradeBatchAtomically([trade({ id: 'nop_1', buyer_id: null, seller_id: null })]);
    assert.strictEqual(noParty.errorCode, 'TRADE_BOTH_PARTIES_MISSING', 'both parties missing must be rejected');

    const noStock = await repo.settleTradeBatchAtomically([trade({ id: 'nostock_1', stock_id: '' })]);
    assert.strictEqual(noStock.errorCode, 'STOCK_ID_MISSING', 'empty stock id must be rejected');

    const noBuyOrder = await repo.settleTradeBatchAtomically([trade({ id: 'nobo_1', buy_order_id: '' })]);
    assert.strictEqual(noBuyOrder.errorCode, 'TRADE_BUY_ORDER_ID_MISSING', 'empty buy order id must be rejected');

    const noSellOrder = await repo.settleTradeBatchAtomically([trade({ id: 'noso_1', sell_order_id: '' })]);
    assert.strictEqual(noSellOrder.errorCode, 'TRADE_SELL_ORDER_ID_MISSING', 'empty sell order id must be rejected');

    assert.strictEqual(snapshotState(db), before, 'all rejections leave state unchanged');
    console.log('  ✅ [PASS] identity/party validations enforced');
  }

  console.log('\n================================================================');
  console.log('🎉 ALL SETTLEMENT INTEGRITY & IDEMPOTENCY TESTS PASSED');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
