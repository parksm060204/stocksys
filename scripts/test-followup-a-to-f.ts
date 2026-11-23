import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import { MemoryDatabase, GUEST_USER_ID } from '../lib/memoryDb/memoryStore';
import { FileStorageAdapter, StorageWriterLockError } from '../lib/memoryDb/StorageAdapter';
import { PersistenceManager } from '../lib/memoryDb/PersistenceManager';
import { createInMemoryRepositoryBundle } from '../lib/repositories/inMemory';
import { submitAuthoritativeOptionOrder, OPTIONS_LP_ID } from '../lib/options/optionOrderService';
import { CommodityMarketEngine } from '../lib/commodities/CommodityMarketEngine';
import {
  reserveMarginAndSubmitCommodityOrder,
  settleCommodityTradeForUsers,
  calculateCommodityMarginPerContractKrw,
} from '../lib/commodities/commodityLedger';
import { executeCurrencyExchange } from '../lib/exchange/exchangeService';
import { submitAndMatchOrder } from '../lib/engine/dbMatching';
import { createMemoryDbClient } from '../lib/memoryDb/memoryDbClient';

async function testA_OptionsLimitAndConservation() {
  console.log('▶ [A] Testing Options Limit Semantics, LP Conservation, Overflow, License & Save-Fail Rollback...');
  const db = new MemoryDatabase();
  const user = db.profiles.get(GUEST_USER_ID)!;
  const lp = db.profiles.get(OPTIONS_LP_ID)!;
  user.cash = 10_000_000;
  const lpStartCash = lp.cash;
  const optionTicker = db.optionsContracts.get('opt_c_720')!.ticker;

  // 1. Unlicensed non-admin user rejected (403)
  const noLicUser = { ...user, id: 'user_nolic', user_id: 'user_nolic', is_admin: false, has_options_license: false };
  db.profiles.set(noLicUser.id, noLicUser);
  const resNoLic = await submitAuthoritativeOptionOrder({
    db,
    userId: noLicUser.id,
    ticker: optionTicker,
    side: 'BUY',
    orderType: 'LIMIT',
    price: 2.15,
    qty: 1,
  });
  assert.equal(resNoLic.success, false);
  assert.equal(resNoLic.statusCode, 403);

  // 2. Non-marketable low BUY limit (0.01 when current_price=2.15) stays open (filledQty=0), NO cash created
  const resLowBuy = await submitAuthoritativeOptionOrder({
    db,
    userId: GUEST_USER_ID,
    ticker: optionTicker,
    side: 'BUY',
    orderType: 'LIMIT',
    price: 0.01,
    qty: 1,
  });
  assert.equal(resLowBuy.success, true);
  assert.equal(resLowBuy.order?.status, 'open');
  assert.equal(resLowBuy.order?.filledQty, 0);
  assert.equal(user.cash, 10_000_000, 'Unfilled limit order must not change settled cash');

  // 3. Marketable BUY at LP ask (2.15 * 250000 = 537,500 + fee 538) then immediate SELL at LP bid (2.11 * 250000 = 527,500 - fee 528) -> strictly loses money
  const resBuy = await submitAuthoritativeOptionOrder({
    db,
    userId: GUEST_USER_ID,
    ticker: optionTicker,
    side: 'BUY',
    orderType: 'LIMIT',
    price: 5.0, // willing to pay up to 5.0, but fills at LP ask 2.15!
    qty: 1,
  });
  assert.equal(resBuy.success, true);
  assert.equal(resBuy.order?.filledQty, 1);
  assert.equal(resBuy.order?.avgExecPrice, 2.15);
  assert.equal(lp.cash, lpStartCash + 537500, 'LP must receive exact notional');

  // Non-marketable high SELL (99999) stays open (filledQty=0), cannot mint cash!
  const resHighSell = await submitAuthoritativeOptionOrder({
    db,
    userId: GUEST_USER_ID,
    ticker: optionTicker,
    side: 'SELL',
    orderType: 'LIMIT',
    price: 99999,
    qty: 1,
  });
  assert.equal(resHighSell.success, true);
  assert.equal(resHighSell.order?.status, 'open');
  assert.equal(resHighSell.order?.filledQty, 0);

  // 4. Safe integer overflow rejected (400)
  const resOverflow = await submitAuthoritativeOptionOrder({
    db,
    userId: GUEST_USER_ID,
    ticker: optionTicker,
    side: 'BUY',
    orderType: 'LIMIT',
    price: 1e12,
    qty: 100000,
  });
  assert.equal(resOverflow.success, false);
  assert.equal(resOverflow.statusCode, 400);

  // 5. Save failure rolls back user & LP cash, holdings, orders
  const cashBeforeFail = user.cash;
  const lpCashBeforeFail = lp.cash;
  const resSaveFail = await submitAuthoritativeOptionOrder({
    db,
    userId: GUEST_USER_ID,
    ticker: optionTicker,
    side: 'BUY',
    orderType: 'MARKET',
    qty: 1,
    onPersist: async () => false,
  });
  assert.equal(resSaveFail.success, false);
  assert.equal(resSaveFail.statusCode, 500);
  assert.equal(user.cash, cashBeforeFail);
  assert.equal(lp.cash, lpCashBeforeFail);

  // 6. Expired contract rejected
  const contract = db.optionsContracts.get('opt_c_720')!;
  contract.expiry_date = new Date(Date.now() - 60_000).toISOString();
  const resExpired = await submitAuthoritativeOptionOrder({
    db,
    userId: GUEST_USER_ID,
    contractId: 'opt_c_720',
    side: 'BUY',
    orderType: 'MARKET',
    qty: 1,
  });
  assert.equal(resExpired.success, false);
  assert.equal(resExpired.statusCode, 400);
  console.log('  ✅ [PASS] Option limit semantics, LP conservation, overflow, license & rollback verified.');
}

async function testB_StockLedgerTrimAndReplay() {
  console.log('▶ [B] Testing Stock Settlement Ledger Trim & Replay Protection (Real Repository Path)...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-b-'));
  try {
    const pm = new PersistenceManager(new FileStorageAdapter(tmpDir));
    const db = new MemoryDatabase();
    const repo = createInMemoryRepositoryBundle(db);
    const stock = Array.from(db.stocks.values())[0];
    const buyer = db.profiles.get(GUEST_USER_ID)!;
    const seller = { ...buyer, id: 'seller_b', user_id: 'seller_b', cash: 10_000_000 };
    db.profiles.set(seller.id, seller);
    db.addProfileToIndex(seller);
    const hRec = {
      id: `${seller.id}_${stock.id}`,
      user_id: seller.id,
      stock_id: stock.id,
      quantity: 100,
      avg_price: 1000,
      created_at: db.getIsoTimestamp(),
    };
    db.holdings.set(hRec.id, hRec);
    db.addHoldingToIndex(hRec);

    const buyOrd = {
      id: 'ord_b_buy_1',
      stock_id: stock.id,
      user_id: buyer.id,
      side: 'buy' as const,
      price: 1000,
      size: 10,
      filled: 0,
      status: 'open' as const,
      is_lp: false,
      created_at: db.getIsoTimestamp(),
    };
    const sellOrd = {
      id: 'ord_b_sell_1',
      stock_id: stock.id,
      user_id: seller.id,
      side: 'sell' as const,
      price: 1000,
      size: 10,
      filled: 0,
      status: 'open' as const,
      is_lp: false,
      created_at: db.getIsoTimestamp(),
    };
    db.orders.set(buyOrd.id, buyOrd);
    db.addOrderToIndex(buyOrd);
    db.orders.set(sellOrd.id, sellOrd);
    db.addOrderToIndex(sellOrd);

    // Settle 5 trades through real InMemorySettlementRepository.commitMatchedBatchAtomically
    for (let i = 1; i <= 5; i++) {
      const res = await repo.settlement.commitMatchedBatchAtomically({
        trades: [
          {
            id: `custom_tr_${i}`,
            stock_id: stock.id,
            buyer_id: buyer.id,
            seller_id: seller.id,
            buy_order_id: buyOrd.id,
            sell_order_id: sellOrd.id,
            buyer_is_bot: false,
            seller_is_bot: false,
            price: 1000,
            size: 1,
            fee_rates: { buyerFeeRate: 0.0025, sellerFeeRate: 0.0025 },
            created_at: new Date(1700000000000 + i * 1000).toISOString(),
          },
        ],
      });
      assert.equal(res.success, true, `commitMatchedBatchAtomically failed: ${JSON.stringify(res)}`);
    }

    // Trim settlementLedger down to 2 entries (custom_tr_1..3 evicted from map)
    const evicted = db.trimSettlementLedger(2);
    assert.equal(evicted, 3);
    assert.equal(db.settlementLedger.has('custom_tr_1'), false);

    const cashBeforeReplay = buyer.cash;
    const tradesLenBefore = db.trades.length;

    // Replay custom_tr_1 via real repository with SPOOFED future created_at and missing created_at
    assert.equal(repo.settlement.isTradeSettled('custom_tr_1'), true);
    const replayRes = await repo.settlement.commitMatchedBatchAtomically({
      trades: [
        {
          id: 'custom_tr_1',
          stock_id: stock.id,
          buyer_id: buyer.id,
          seller_id: seller.id,
          buy_order_id: buyOrd.id,
          sell_order_id: sellOrd.id,
          buyer_is_bot: false,
          seller_is_bot: false,
          price: 1000,
          size: 1,
          fee_rates: { buyerFeeRate: 0.0025, sellerFeeRate: 0.0025 },
          created_at: new Date(Date.now() + 86400_000).toISOString(),
        },
      ],
    });
    assert.equal(replayRes.settledTradesCount, 0, 'Evicted trade replay must be skipped');
    assert.equal(buyer.cash, cashBeforeReplay);
    assert.equal(db.trades.length, tradesLenBefore);

    // Save -> Restore into new MemoryDatabase -> new Repository -> replay STILL blocked, new trade STILL works
    assert.equal(await pm.saveSnapshot(db), true);
    pm.releaseWriterLock();

    const pm2 = new PersistenceManager(new FileStorageAdapter(tmpDir));
    const db2 = new MemoryDatabase();
    assert.equal(await pm2.loadSnapshot(db2), true);
    const repo2 = createInMemoryRepositoryBundle(db2);
    assert.equal(repo2.settlement.isTradeSettled('custom_tr_1'), true);

    const newRes = await repo2.settlement.commitMatchedBatchAtomically({
      trades: [
        {
          id: 'custom_tr_new_6',
          stock_id: stock.id,
          buyer_id: buyer.id,
          seller_id: seller.id,
          buy_order_id: buyOrd.id,
          sell_order_id: sellOrd.id,
          buyer_is_bot: false,
          seller_is_bot: false,
          price: 1000,
          size: 1,
          fee_rates: { buyerFeeRate: 0.0025, sellerFeeRate: 0.0025 },
          created_at: new Date().toISOString(),
        },
      ],
    });
    assert.equal(newRes.settledTradesCount, 1, 'Legitimate new trade must settle after trim + restore');
    pm2.releaseWriterLock();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log('  ✅ [PASS] Stock ledger trim + replay protection + restart persistence verified.');
}

async function testC_D_E_CommodityLedgerOrderAttributionRecovery() {
  console.log('▶ [C,D,E] Testing Commodity >5000 Ledger Trim, Restart Epoch, Order-Level Attribution, Rollback, Loss & Recovery...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-cde-'));
  try {
    const pm = new PersistenceManager(new FileStorageAdapter(tmpDir));
    const db = new MemoryDatabase();
    const engine = new CommodityMarketEngine({ totalBots: 0, db });
    await engine.reconcileWithDatabase(db);
    const commodity = engine.getCommodity('CRUDE_OIL')!;
    const buyer = db.profiles.get(GUEST_USER_ID)!;
    const seller = { ...buyer, id: 'seller_c', user_id: 'seller_c', cash: 100_000_000 };
    db.profiles.set(seller.id, seller);
    buyer.cash = 100_000_000;
    const marginPerContract = calculateCommodityMarginPerContractKrw(commodity, db);

    // [C] >5,000 ledger entries trim & replay block
    for (let i = 1; i <= 5005; i++) {
      db.commoditySettlementLedger.set(`cm_custom_${i}`, {
        id: `cm_custom_${i}`,
        commodity_id: 'CRUDE_OIL',
        tick: i,
        settled_at: db.getIsoTimestamp(),
      });
    }
    const trimmed = db.trimCommoditySettlementLedger(5000);
    assert.equal(trimmed, 5);
    assert.equal(db.isCommodityTradeSettled('cm_custom_1'), true, 'Old commodity trade ID must stay blocked after >5000 trim');

    // [D] Two same-direction BUY orders (order1 size=3, order2 size=2); second fills first!
    const b1 = await reserveMarginAndSubmitCommodityOrder({
      db, commodity, userId: buyer.id, side: 'buy', type: 'limit', price: 78, size: 3,
      submitToEngine: () => engine.submitUserOrder({ commodityId: 'CRUDE_OIL', userId: buyer.id, side: 'buy', type: 'limit', price: 78, size: 3 }),
      rollbackFromEngine: (id) => engine.removeUserOrder('CRUDE_OIL', id),
    });
    const b2 = await reserveMarginAndSubmitCommodityOrder({
      db, commodity, userId: buyer.id, side: 'buy', type: 'limit', price: 80, size: 2,
      submitToEngine: () => engine.submitUserOrder({ commodityId: 'CRUDE_OIL', userId: buyer.id, side: 'buy', type: 'limit', price: 80, size: 2 }),
      rollbackFromEngine: (id) => engine.removeUserOrder('CRUDE_OIL', id),
    });
    const s1 = await reserveMarginAndSubmitCommodityOrder({
      db, commodity, userId: seller.id, side: 'sell', type: 'limit', price: 80, size: 2,
      submitToEngine: () => engine.submitUserOrder({ commodityId: 'CRUDE_OIL', userId: seller.id, side: 'sell', type: 'limit', price: 80, size: 2 }),
      rollbackFromEngine: (id) => engine.removeUserOrder('CRUDE_OIL', id),
    });
    assert.ok(b1.order && b2.order && s1.order);

    // Fault injection rollback test before actual settle
    const buyerCashSnap = buyer.cash;
    const sellerCashSnap = seller.cash;
    await assert.rejects(() =>
      settleCommodityTradeForUsers(
        db,
        {
          id: 'cm_fail_1',
          commodityId: 'CRUDE_OIL',
          buyOrderId: b2.order!.id,
          sellOrderId: s1.order!.id,
          buyerId: buyer.id,
          sellerId: seller.id,
          price: 80,
          size: 2,
          tick: 1,
          timestamp: Date.now(),
        },
        commodity,
        { faultInjection: 'FAIL_AFTER_BUYER_SETTLED' }
      )
    );
    assert.equal(buyer.cash, buyerCashSnap);
    assert.equal(seller.cash, sellerCashSnap);
    assert.equal(db.commodityMarginReservations.get(b2.order!.id)?.remaining_size, 2);

    // Run authoritative stepTickAsync -> matches b2 (size 2) against s1 (size 2), leaves b1 (size 3) open!
    await engine.stepTickAsync();
    assert.equal(db.commodityMarginReservations.get(b2.order!.id)?.status, 'filled');
    assert.equal(db.commodityMarginReservations.get(b1.order!.id)?.status, 'open');
    assert.equal(db.commodityMarginReservations.get(b1.order!.id)?.remaining_size, 3);
    assert.equal(db.commodityPositions.get(`${buyer.id}_CRUDE_OIL`)?.quantity, 2);

    // [D] Loss preservation (no Math.max(0, cash+delta) erasing loss!)
    const lossUser = { ...buyer, id: 'loss_user', user_id: 'loss_user', cash: marginPerContract };
    db.profiles.set(lossUser.id, lossUser);
    const lb = await reserveMarginAndSubmitCommodityOrder({
      db, commodity, userId: lossUser.id, side: 'buy', type: 'limit', price: 100, size: 1,
      submitToEngine: () => engine.submitUserOrder({ commodityId: 'CRUDE_OIL', userId: lossUser.id, side: 'buy', type: 'limit', price: 100, size: 1 }),
      rollbackFromEngine: (id) => engine.removeUserOrder('CRUDE_OIL', id),
    });
    await settleCommodityTradeForUsers(db, {
      id: 'cm_loss_open', commodityId: 'CRUDE_OIL', buyOrderId: lb.order!.id, sellOrderId: 'bot_sell',
      buyerId: lossUser.id, sellerId: 'bot_1', price: 100, size: 1, tick: 2, timestamp: Date.now(),
    }, commodity);
    // Close at huge loss (price drops from 100 to 10 -> -$90 * 1000 * 1380 = -124.2M KRW > margin!)
    lossUser.cash = marginPerContract; // only enough for closing order margin
    const ls = await reserveMarginAndSubmitCommodityOrder({
      db, commodity, userId: lossUser.id, side: 'sell', type: 'limit', price: 10, size: 1,
      submitToEngine: () => engine.submitUserOrder({ commodityId: 'CRUDE_OIL', userId: lossUser.id, side: 'sell', type: 'limit', price: 10, size: 1 }),
      rollbackFromEngine: (id) => engine.removeUserOrder('CRUDE_OIL', id),
    });
    await settleCommodityTradeForUsers(db, {
      id: 'cm_loss_close', commodityId: 'CRUDE_OIL', buyOrderId: 'bot_buy', sellOrderId: ls.order!.id,
      buyerId: 'bot_1', sellerId: lossUser.id, price: 10, size: 1, tick: 3, timestamp: Date.now(),
    }, commodity);
    assert.ok(
      lossUser.cash >= 0 && (lossUser.margin_debt_krw ?? 0) > 0,
      `Realized loss exceeding margin must clamp cash >= 0 and record margin_debt_krw, got cash=${lossUser.cash}, debt=${lossUser.margin_debt_krw}`
    );

    // [E] Save snapshot with unfilled b1 (size=3) -> restore into fresh DB & engine -> b1 restored in book + new epoch IDs don't collide!
    assert.equal(await pm.saveSnapshot(db), true);
    pm.releaseWriterLock();

    const pm2 = new PersistenceManager(new FileStorageAdapter(tmpDir));
    const db2 = new MemoryDatabase();
    assert.equal(await pm2.loadSnapshot(db2), true);
    const engine2 = new CommodityMarketEngine({ totalBots: 0, db: db2 });
    await engine2.reconcileWithDatabase(db2);

    const restoredBook = engine2.getOrderBook('CRUDE_OIL')!;
    assert.equal(restoredBook.bids.some((o) => o.id === b1.order!.id && o.size === 3), true, 'Unfilled order must be restored in orderBook');
    assert.equal(db2.isCommodityTradeSettled('cm_custom_1'), true, 'Old commodity trade remains blocked after restore');

    // New order after restore gets higher epoch prefix (no ID collision)
    const postRestartOrder = engine2.submitUserOrder({
      commodityId: 'CRUDE_OIL', userId: buyer.id, side: 'buy', type: 'limit', price: 79, size: 1,
    });
    assert.notEqual(postRestartOrder.id, b1.order!.id);
    pm2.releaseWriterLock();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log('  ✅ [PASS] Commodity ledger trim, epoch separation, order attribution, rollback, loss preservation & recovery verified.');
}

async function testF_CommitBoundaryAndMultiProcessLock() {
  console.log('▶ [F] Testing Per-Account Rollback on Save Fail, Concurrent Account Preservation & Multi-Process Lock...');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-f-'));
  try {
    // 1. Exchange save failure rolls back ONLY failing account, preserving other account's concurrent success
    const db = new MemoryDatabase();
    const u1 = db.profiles.get(GUEST_USER_ID)!;
    const u2 = { ...u1, id: 'user_other_f', user_id: 'user_other_f', cash: 5_000_000, usd_balance: 0 };
    db.profiles.set(u2.id, u2);
    const u1CashBefore = u1.cash;
    const u1UsdBefore = u1.usd_balance;

    const okOther = await executeCurrencyExchange({
      db, userId: u2.id, fromCur: 'KRW', toCur: 'USD', amount: 138000,
    });
    assert.equal(okOther.success, true);

    const failU1 = await executeCurrencyExchange({
      db, userId: u1.id, fromCur: 'KRW', toCur: 'USD', amount: 138000,
      onPersist: async () => false,
    });
    assert.equal(failU1.success, false);
    assert.equal(failU1.statusCode, 500);
    assert.equal(u1.cash, u1CashBefore);
    assert.equal(u1.usd_balance, u1UsdBefore);
    assert.equal(u2.usd_balance, 100, 'Other account successful state must be preserved');

    // 2. Stock submitAndMatchOrder save failure rollback
    const client = createMemoryDbClient(db);
    const stock = Array.from(db.stocks.values())[0];
    const failOrder = await submitAndMatchOrder(client, {
      stock_id: stock.id,
      user_id: u2.id,
      side: 'buy',
      price: 1000,
      size: 1,
      onPersist: async () => false,
    });
    assert.equal(failOrder.success, false);

    // 3. Multi-process exclusive writer lock test
    const adapter1 = new FileStorageAdapter(tmpDir);
    adapter1.acquireWriterLock();

    const childScript = `
      import { FileStorageAdapter, StorageWriterLockError } from './lib/memoryDb/StorageAdapter';
      const a2 = new FileStorageAdapter(${JSON.stringify(tmpDir)});
      try {
        a2.acquireWriterLock();
        console.error('SHOULD_HAVE_FAILED');
        process.exit(1);
      } catch (err) {
        if (err instanceof StorageWriterLockError) {
          console.log('LOCK_REJECTED_OK');
          process.exit(0);
        }
        throw err;
      }
    `;
    const child = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', childScript],
      { cwd: process.cwd(), timeout: 5000, encoding: 'utf-8' }
    );
    adapter1.releaseWriterLock();
    assert.equal(child.status, 0, `Second writer process should be rejected: ${child.stderr || child.stdout}`);
    assert.ok(child.stdout.includes('LOCK_REJECTED_OK'));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  console.log('  ✅ [PASS] Commit rollback isolation & multi-process writer lock verified.');
}

async function main() {
  await testA_OptionsLimitAndConservation();
  await testB_StockLedgerTrimAndReplay();
  await testC_D_E_CommodityLedgerOrderAttributionRecovery();
  await testF_CommitBoundaryAndMultiProcessLock();
  console.log('\n🎉 ALL COORDINATOR FOLLOW-UP (A-F) REPRODUCTION & VERIFICATION TESTS PASSED');
}

main().catch((err) => {
  console.error('❌ Follow-up A-F verification failed:', err);
  process.exit(1);
});
