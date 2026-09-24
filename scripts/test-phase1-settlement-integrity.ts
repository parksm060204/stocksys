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

let detSeq = 1000;
function trade(overrides: Partial<TradeSettlementInput>): TradeSettlementInput {
  detSeq += 1;
  return {
    id: overrides.id || `t_det_${detSeq}`,
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

  // ── 12. 봇-봇 체결 (정산 성공, 양쪽 participant ID, ledger 1건 증가, lastSettlementError === null) ──
  console.log('\n▶ [TEST 12] bot-bot settlement with explicit participant identity');
  {
    const db = makeDb();
    const repo = new InMemorySettlementRepository(db);
    const ledgerBefore = db.settlementLedger.size;
    const tradesBefore = db.trades.length;

    const res = await repo.settleTradeBatchAtomically([
      trade({
        id: 'bot_vs_bot_01',
        buyer_id: 'bot_gamma',
        seller_id: 'bot_delta',
        buyer_is_bot: true,
        seller_is_bot: true,
        price: 50000,
        size: 20,
        fee_rates: { buyerFeeRate: 0.001, sellerFeeRate: 0.001 },
      }),
    ]);

    assert.strictEqual(res.success, true, 'bot-bot trade must settle successfully');
    assert.strictEqual(res.settledTradesCount, 1, 'exactly 1 trade settled');
    assert.strictEqual(db.settlementLedger.size, ledgerBefore + 1, 'ledger count increased by 1');
    assert.strictEqual(db.trades.length, tradesBefore + 1, 'trades count increased by 1');

    const settled = db.trades.find((t) => t.id === 'bot_vs_bot_01');
    assert.ok(settled, 'settled trade must be present in trades list');
    assert.strictEqual(settled?.buyer_id, 'bot_gamma', 'buyer_id must be bot participantId');
    assert.strictEqual(settled?.seller_id, 'bot_delta', 'seller_id must be bot participantId');
    assert.strictEqual(settled?.buyer_is_bot, true, 'buyer_is_bot flag must be true');
    assert.strictEqual(settled?.seller_is_bot, true, 'seller_is_bot flag must be true');
    assert.strictEqual(repo.getLastSettlementError(), null, 'lastSettlementError must be null on success');
    console.log('  ✅ [PASS] bot-bot trade settled with valid participant IDs and ledger increment');
  }

  // ── 13. 사용자-봇 체결 (사용자 현금·보유 수량 정확 변경, 수수료 정확 계산) ──
  console.log('\n▶ [TEST 13] user-bot trade: precise balance, holdings, and fee updates');
  {
    const db = makeDb();
    const repo = new InMemorySettlementRepository(db);

    const userProfileBefore = db.profiles.get(BUYER)!;
    const userCashBefore = userProfileBefore.cash;
    const userHoldingBefore = db.holdings.get(`${BUYER}_${STOCK}`)?.quantity || 0;

    const tradePrice = 25000;
    const tradeSize = 10;
    const notional = tradePrice * tradeSize; // 250,000 KRW
    const buyerFeeRate = 0.0015; // 15 bps -> 375 KRW
    const sellerFeeRate = 0.0005; // 5 bps -> 125 KRW
    const expectedBuyerFee = Math.round(notional * buyerFeeRate); // 375

    const res = await repo.settleTradeBatchAtomically([
      trade({
        id: 'user_vs_bot_01',
        buyer_id: BUYER,
        seller_id: 'bot_lp_omega',
        buyer_is_bot: false,
        seller_is_bot: true,
        price: tradePrice,
        size: tradeSize,
        fee_rates: { buyerFeeRate, sellerFeeRate },
      }),
    ]);

    assert.strictEqual(res.success, true, 'user-bot trade must settle successfully');
    const userProfileAfter = db.profiles.get(BUYER)!;
    const expectedCash = userCashBefore - notional - expectedBuyerFee;
    assert.strictEqual(userProfileAfter.cash, expectedCash, `user cash must decrease by notional + taker fee (expected: ${expectedCash}, got: ${userProfileAfter.cash})`);

    const userHoldingAfter = db.holdings.get(`${BUYER}_${STOCK}`)?.quantity || 0;
    assert.strictEqual(userHoldingAfter, userHoldingBefore + tradeSize, 'user stock holding must increase by exact size');

    assert.strictEqual(res.totalFeeAmount, expectedBuyerFee + Math.round(notional * sellerFeeRate), 'fees accurately computed');
    console.log('  ✅ [PASS] user-bot trade settled with exact balance, holding, and fee calculation');
  }

  // ── 14. 정산 강제 실패: 원자적 롤백 및 무변경 증명 (주문/시세/가격이력/봇포트폴리오 불변) ──
  console.log('\n▶ [TEST 14] forced settlement failure: strict zero-mutation across all domains');
  {
    const db = makeDb();
    const repo = new InMemorySettlementRepository(db);

    // 주문 및 시세 초기 상태 세팅
    db.orders.set('ORD_TEST_1', {
      id: 'ORD_TEST_1', stock_id: STOCK, user_id: BUYER, side: 'buy',
      price: 1000, size: 100, filled: 0, status: 'open', is_lp: false,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    db.orders.set('ORD_TEST_2', {
      id: 'ORD_TEST_2', stock_id: STOCK, user_id: SELLER, side: 'sell',
      price: 1000, size: 100, filled: 0, status: 'open', is_lp: false,
      created_at: '2026-01-01T00:00:00.000Z',
    });
    db.stocks.set(STOCK, {
      id: STOCK, name: '시험주', ticker: 'TEST', current_price: 1000,
      previous_close: 1000, market: 'domestic', volume: 50000,
    } as any);
    db.stockPriceHistory.push({
      id: 'hist_1', stock_id: STOCK, price: 1000, recorded_at: '2026-01-01T00:00:00.000Z',
    });

    const historyBefore = db.stockPriceHistory.length;
    const stateBefore = snapshotState(db);

    // 정산 실패를 유발하는 잘못된 거래 (음수 가격)
    const res = await repo.commitMatchedBatchAtomically({
      trades: [
        trade({ id: 'forced_fail_01', price: -500, size: 10 }),
      ],
      orderUpdates: [
        { id: 'ORD_TEST_1', size: 90, status: 'partial' },
        { id: 'ORD_TEST_2', size: 90, status: 'partial' },
      ],
      marketPriceUpdates: [
        { stock_id: STOCK, price: 1050 },
      ],
      priceHistory: [
        { stock_id: STOCK, price: 1050, recorded_at: '2026-01-01T00:01:00.000Z' },
      ],
    });

    assert.strictEqual(res.success, false, 'atomic commit must fail on invalid trade');
    assert.strictEqual(res.errorCode, 'TRADE_PRICE_NOT_POSITIVE', 'exact reason code must be returned');
    assert.strictEqual(repo.getLastSettlementError(), 'TRADE_PRICE_NOT_POSITIVE', 'lastSettlementError must record reason code');

    // 모든 상태 무변경 검증
    assert.strictEqual(snapshotState(db), stateBefore, 'order, stock price, price history, portfolio state must be 100% unchanged');

    const ord1 = db.orders.get('ORD_TEST_1');
    assert.strictEqual(ord1?.status, 'open', 'order status must remain open');
    assert.strictEqual(ord1?.filled, 0, 'order filled must remain 0');

    const stock = db.stocks.get(STOCK);
    assert.strictEqual(stock?.current_price, 1000, 'stock price must remain 1000');
    assert.strictEqual(db.stockPriceHistory.length, historyBefore, 'price history must not have new entries');
    console.log('  ✅ [PASS] forced settlement failure leaves 0 mutation in orders, prices, and history');
  }

  // ── 15. 옵션·채권 정산 fault injection: 부분 성공 절대 불허 및 멱등 재시도 ──
  console.log('\n▶ [TEST 15] option and bond settlement fault-injection atomic rollback');
  {
    const db = makeDb();
    const repo = new InMemorySettlementRepository(db);

    // 옵션 포지션 등록
    const optHolding = {
      id: `${BUYER}_OPT_CALL`, user_id: BUYER, stock_id: 'OPT_CALL',
      quantity: 5, avg_price: 200, created_at: '2026-01-01T00:00:00.000Z',
    };
    db.holdings.set(optHolding.id, optHolding);
    db.addHoldingToIndex(optHolding);

    const initialCash = db.profiles.get(BUYER)!.cash;
    const initialLedger = db.settlementLedger.size;

    // 15a. Option: FAIL_AT_CLOSE -> 100% 롤백
    const failClose = await repo.settleOptionExpiryAtomically({
      userId: BUYER,
      optionId: 'OPT_CALL',
      payoutAmount: 500000,
      idempotencyKey: 'opt_idem_fail1',
      faultInjection: 'FAIL_AT_CLOSE',
    });
    assert.strictEqual(failClose.success, false, 'fault injection FAIL_AT_CLOSE must fail');
    assert.strictEqual(db.profiles.get(BUYER)!.cash, initialCash, 'cash must not be partially paid out');
    assert.ok(db.holdings.has(optHolding.id), 'option holding must not be deleted');
    assert.strictEqual(db.settlementLedger.size, initialLedger, 'ledger must not be recorded');

    // 15b. Option: FAIL_AT_LEDGER -> 100% 롤백
    const failLedger = await repo.settleOptionExpiryAtomically({
      userId: BUYER,
      optionId: 'OPT_CALL',
      payoutAmount: 500000,
      idempotencyKey: 'opt_idem_fail2',
      faultInjection: 'FAIL_AT_LEDGER',
    });
    assert.strictEqual(failLedger.success, false, 'fault injection FAIL_AT_LEDGER must fail');
    assert.strictEqual(db.profiles.get(BUYER)!.cash, initialCash, 'cash must be rolled back');
    assert.ok(db.holdings.has(optHolding.id), 'option holding must be restored');
    assert.strictEqual(db.settlementLedger.size, initialLedger, 'ledger must not be recorded');

    // 15c. Option: 정상 실행 -> 성공
    const optSuccess = await repo.settleOptionExpiryAtomically({
      userId: BUYER,
      optionId: 'OPT_CALL',
      payoutAmount: 500000,
      idempotencyKey: 'opt_idem_success',
    });
    assert.strictEqual(optSuccess.success, true, 'clean option expiry must succeed');
    assert.strictEqual(db.profiles.get(BUYER)!.cash, initialCash + 500000, 'cash must be credited');
    assert.strictEqual(db.holdings.has(optHolding.id), false, 'option holding must be removed');
    assert.strictEqual(db.settlementLedger.size, initialLedger + 1, 'ledger must be recorded');

    // 15d. Option: 동일 idempotencyKey 재시도 -> 멱등 처리 (중복 지급 0건)
    const optRetry = await repo.settleOptionExpiryAtomically({
      userId: BUYER,
      optionId: 'OPT_CALL',
      payoutAmount: 500000,
      idempotencyKey: 'opt_idem_success',
    });
    assert.strictEqual(optRetry.success, true, 'retry must be marked success');
    assert.strictEqual(db.profiles.get(BUYER)!.cash, initialCash + 500000, 'cash must not be double-paid');

    // 15e. Bond: FAIL_AT_CLOSE -> 100% 롤백
    const bondHolding = {
      id: `${BUYER}_BOND_10Y`, user_id: BUYER, stock_id: 'BOND_10Y',
      quantity: 10, avg_price: 10000, created_at: '2026-01-01T00:00:00.000Z',
    };
    db.holdings.set(bondHolding.id, bondHolding);
    db.addHoldingToIndex(bondHolding);

    const cashBeforeBond = db.profiles.get(BUYER)!.cash;
    const bondFail = await repo.settleBondMaturityAtomically({
      userId: BUYER,
      bondId: 'BOND_10Y',
      principalAmount: 100000,
      couponAmount: 5000,
      idempotencyKey: 'bond_fail_1',
      faultInjection: 'FAIL_AT_CLOSE',
    });
    assert.strictEqual(bondFail.success, false, 'bond FAIL_AT_CLOSE must fail');
    assert.strictEqual(db.profiles.get(BUYER)!.cash, cashBeforeBond, 'bond cash must not be partially paid');
    assert.ok(db.holdings.has(bondHolding.id), 'bond holding must not be deleted');

    // 15f. Bond: 정상 실행 -> 성공
    const bondSuccess = await repo.settleBondMaturityAtomically({
      userId: BUYER,
      bondId: 'BOND_10Y',
      principalAmount: 100000,
      couponAmount: 5000,
      idempotencyKey: 'bond_success_1',
    });
    assert.strictEqual(bondSuccess.success, true, 'bond maturity settlement must succeed');
    assert.strictEqual(db.profiles.get(BUYER)!.cash, cashBeforeBond + 105000, 'principal + coupon paid');
    assert.strictEqual(db.holdings.has(bondHolding.id), false, 'bond holding removed');

    // 15g. Bond: 멱등 재시도 -> 중복 지급 없음
    const bondRetry = await repo.settleBondMaturityAtomically({
      userId: BUYER,
      bondId: 'BOND_10Y',
      principalAmount: 100000,
      couponAmount: 5000,
      idempotencyKey: 'bond_success_1',
    });
    assert.strictEqual(bondRetry.success, true, 'bond retry must succeed');
    assert.strictEqual(db.profiles.get(BUYER)!.cash, cashBeforeBond + 105000, 'no double payment');
    console.log('  ✅ [PASS] option and bond fault injection verified; atomicity and idempotency enforced');
  }

  console.log('\n================================================================');
  console.log('🎉 ALL SETTLEMENT INTEGRITY & IDEMPOTENCY TESTS PASSED');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
