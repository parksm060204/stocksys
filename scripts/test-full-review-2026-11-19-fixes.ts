import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MemoryDatabase,
  K200_INDEX_UNDERLYING_ID,
  STOCK_UUID_MAP,
} from '../lib/memoryDb/memoryStore';
import { createInMemoryRepositoryBundle } from '../lib/repositories/inMemory';
import { PersistenceManager, persistenceManager } from '../lib/memoryDb/PersistenceManager';
import { FileStorageAdapter } from '../lib/memoryDb/StorageAdapter';
import { createSimulationContext } from '../lib/engine/simulation/runtime';
import { MarketEngine } from '../engine-server/src/MarketEngine';
import { BondCouponEngine } from '../engine-server/src/settlement/BondCouponEngine';
import { resolvePlayerEventChoice } from '../lib/events/playerEventService';
import { LocalMarketService } from '../lib/engine/marketService';
import {
  applyCashDeltaWithMarginDebt,
  cancelCommodityOrders,
  reserveMarginAndSubmitCommodityOrder,
} from '../lib/commodities/commodityLedger';
import {
  submitAuthoritativeOptionOrder,
  cancelOptionOrder,
  getOptionLpQuotes,
} from '../lib/options/optionOrderService';
import {
  ensureLocalStandaloneReady,
  getLocalStandaloneEngine,
  stopLocalStandaloneEngine,
} from '../lib/engine/localStandaloneServer';
import { memoryDb } from '../lib/memoryDb/memoryStore';
import { POST as localDbPostHandler } from '../app/api/local-db/route';
import { POST as ordersPostHandler } from '../app/api/orders/route';
import { GET as commoditiesGetHandler } from '../app/api/commodities/route';
import { runOptionBotTradingEngine, processOptionExpiration } from '../lib/engine/optionBotEngine';

async function main(): Promise<void> {
  console.log('================================================================');
  console.log('🧪 2026-11-19 Code Review F-01 ~ F-19 Comprehensive Regression');
  console.log('================================================================\n');

  await ensureLocalStandaloneReady();
  // These checks drive matching explicitly. A live timer would introduce unrelated
  // orders and prices while fixtures await another engine's persistence checks.
  getLocalStandaloneEngine()!.stop();
  persistenceManager.stopAutoSave();

  try {
    // ── [F-01 & F-11] /api/local-db trades filter oracle, internal tables, profileUserIdIndex ──
    console.log('▶ [F-01 & F-11] /api/local-db projection & filter/order whitelist + profileUserIdIndex');
    {
      const stockId = Array.from(memoryDb.stocks.values())[0]!.id;
      const secretUid = 'usr_f01_secret_probe';
      memoryDb.ensureUserProfile(secretUid, { email: 'f01@test.local' });
      memoryDb.trades.push({
        id: 'tr_f01_probe',
        stock_id: stockId,
        buyer_id: secretUid,
        seller_id: 'bot_as_mm_001',
        buy_order_id: 'ord_secret_buy',
        sell_order_id: 'ord_secret_sell',
        buyer_is_bot: false,
        seller_is_bot: true,
        price: 70000,
        size: 3,
        buyer_fee: 525,
        seller_fee: -210,
        created_at: memoryDb.getIsoTimestamp(),
      });
      memoryDb.rebuildIndexes();

      for (const badCol of ['buyer_id', 'seller_id', 'buy_order_id', 'sell_order_id', 'buyer_fee']) {
        const res = await localDbPostHandler(
          new Request('http://localhost/api/local-db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'execute',
              tableName: 'trades',
              query: { action: 'select', filters: [{ col: badCol, op: 'eq', val: secretUid }] },
            }),
          })
        );
        assert.equal(res.status, 403, `trades filter on ${badCol} must be rejected with 403`);
      }

      const okRes = await localDbPostHandler(
        new Request('http://localhost/api/local-db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'execute',
            tableName: 'trades',
            query: { action: 'select', filters: [{ col: 'stock_id', op: 'eq', val: stockId }], limitCount: 10 },
          }),
        })
      );
      assert.equal(okRes.status, 200);
      const okJson = await okRes.json();
      const probe = (okJson.data as any[]).find((r) => r.id === 'tr_f01_probe');
      assert.ok(probe, 'public trade record must still be returned for stock_id filter');
      assert.equal('buyer_id' in probe, false);
      assert.equal('seller_id' in probe, false);
      assert.equal('buy_order_id' in probe, false);
      assert.equal('sell_order_id' in probe, false);
      assert.equal('buyer_fee' in probe, false);

      // Internal tables blocked for non-admin
      for (const internalTbl of ['active_manipulations', 'admin_settings']) {
        const res = await localDbPostHandler(
          new Request('http://localhost/api/local-db', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'execute', tableName: internalTbl, query: { action: 'select' } }),
          })
        );
        assert.equal(res.status, 403, `${internalTbl} must require admin`);
      }

      // F-11: profile lookup by user_id when id !== user_id
      memoryDb.profiles.set('prof_custom_11', {
        id: 'prof_custom_11',
        user_id: 'auth_uid_11',
        username: 'alias11',
        nickname: 'Alias11',
        cash: 123456,
        net_worth: 123456,
        rank_tier: 'RETAIL',
        created_at: memoryDb.getIsoTimestamp(),
      });
      memoryDb.rebuildIndexes();
      const profRes = await localDbPostHandler(
        new Request('http://localhost/api/local-db', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'execute',
            tableName: 'profiles',
            query: { action: 'select', filters: [{ col: 'user_id', op: 'eq', val: 'auth_uid_11' }], isMaybeSingle: true },
          }),
        })
      );
      assert.equal(profRes.status, 200);
      const profJson = await profRes.json();
      assert.equal(profJson.data?.id, 'prof_custom_11');
      assert.equal('cash' in profJson.data, false, 'non-owner profile query must strip cash');
    }
    console.log('  ✅ PASS [F-01 & F-11]');

    // ── [F-02 & F-03] Bond maturity ISO, migration, quarterly coupon schedule, 100x unit alignment, margin debt credit priority ──
    console.log('▶ [F-02 & F-03] Bond maturity/coupon schedule/quote unit alignment + margin debt priority');
    {
      const db = new MemoryDatabase();
      const bundle = createInMemoryRepositoryBundle(db);
      const seedBond = db.bonds.get('bond_kr_2y')!;
      assert.ok(seedBond.maturity_date && Number.isFinite(Date.parse(seedBond.maturity_date)), 'seed bond must have explicit ISO maturity_date');
      assert.equal(seedBond.quote_base, 100);

      // Relative tenor on unmigrated custom bond must fail closed
      db.bonds.set('bond_rel_only', {
        id: 'bond_rel_only',
        ticker: 'REL_2Y',
        name: 'Relative Only Bond',
        bond_type: 'govt',
        maturity: '2Y',
        coupon_rate: 4.0,
        face_value: 10000,
        current_price: 100,
        ytm: 4.0,
        duration: 2,
        volume: 100,
      });
      const uid = 'usr_f02_test';
      db.ensureUserProfile(uid, { email: 'f02@test.local' });
      db.profiles.get(uid)!.cash = 0;
      db.profiles.get(uid)!.margin_debt_krw = 5000;
      db.holdings.set(`${uid}_bond_rel_only`, {
        id: `${uid}_bond_rel_only`,
        user_id: uid,
        stock_id: 'bond_rel_only',
        quantity: 2,
        avg_price: 100,
        created_at: db.getIsoTimestamp(),
      });
      const failRel = await bundle.settlement.settleBondMaturityAtomically({
        userId: uid,
        bondId: 'bond_rel_only',
        idempotencyKey: 'f02_rel_fail',
      });
      assert.equal(failRel.success, false);
      assert.equal(failRel.errorCode, 'INVALID_MATURITY_DATE');

      // Legacy snapshot migration repairs built-in seed bond without touching invalid custom bond
      const legacySnap = db.exportSnapshot();
      const legacySeedEntry = legacySnap.bonds.find(([id]: [string, any]) => id === 'bond_kr_2y');
      delete legacySeedEntry[1].maturity_date;
      delete legacySeedEntry[1].quote_base;
      const migratedDb = new MemoryDatabase();
      migratedDb.importSnapshot(legacySnap, { migrateCatalog: true });
      assert.ok(migratedDb.bonds.get('bond_kr_2y')?.maturity_date, 'seed bond maturity_date must be migrated');
      assert.equal(migratedDb.bonds.get('bond_kr_2y')?.quote_base, 100);
      assert.equal(migratedDb.bonds.get('bond_rel_only')?.maturity_date, undefined, 'custom invalid bond must not be guessed');

      // Low-level bond trade settlement uses face_value / quote_base (100x)
      const bBuyer = 'usr_bond_buyer';
      const bSeller = 'usr_bond_seller';
      db.ensureUserProfile(bBuyer, { email: 'bb@test.local' });
      db.ensureUserProfile(bSeller, { email: 'bs@test.local' });
      db.profiles.get(bBuyer)!.cash = 100_000;
      db.profiles.get(bSeller)!.cash = 100_000;
      db.holdings.set(`${bSeller}_bond_kr_2y`, {
        id: `${bSeller}_bond_kr_2y`,
        user_id: bSeller,
        stock_id: 'bond_kr_2y',
        quantity: 5,
        avg_price: 99.8,
        created_at: db.getIsoTimestamp(),
      });
      db.rebuildIndexes();
      const bondTradeRes = await bundle.settlement.commitMatchedBatchAtomically({
        newOrders: [
          { id: 'ob_1', stock_id: 'bond_kr_2y', user_id: bBuyer, side: 'buy', price: 99.80, size: 1, filled: 0, status: 'open', is_lp: false, created_at: db.getIsoTimestamp(), version: 1 } as any,
          { id: 'os_1', stock_id: 'bond_kr_2y', user_id: bSeller, side: 'sell', price: 99.80, size: 1, filled: 0, status: 'open', is_lp: false, created_at: db.getIsoTimestamp(), version: 1 } as any,
        ],
        trades: [{
          id: 'tr_bond_unit_check',
          stock_id: 'bond_kr_2y',
          buy_order_id: 'ob_1',
          sell_order_id: 'os_1',
          buyer_id: bBuyer,
          seller_id: bSeller,
          price: 99.80,
          size: 1,
          buyer_is_bot: false,
          seller_is_bot: false,
          fee_rates: { buyerFeeRate: 0, sellerFeeRate: 0 },
        }],
      });
      assert.equal(bondTradeRes.success, true);
      // 1 unit at 99.80 * (10000 / 100) = 9,980 KRW (NOT 99.80 KRW)
      assert.equal(db.profiles.get(bBuyer)!.cash, 100_000 - 9_980);

      // Quarterly coupon already paid -> maturity pays principal only & repays margin_debt_krw first
      const bondPaid = db.bonds.get('bond_kr_2y')!;
      const nowMs = db.getNowMs();
      bondPaid.maturity_date = new Date(nowMs - 1000).toISOString();
      db.holdings.set(`${uid}_${bondPaid.id}`, {
        id: `${uid}_${bondPaid.id}`,
        user_id: uid,
        stock_id: bondPaid.id,
        quantity: 10,
        avg_price: 99.8,
        created_at: db.getIsoTimestamp(),
      });
      const bondEngine = new BondCouponEngine(bundle, { now: () => nowMs });
      // Pay Q1 coupon before maturity
      await bundle.settlement.settleBondCoupon(uid, bondPaid.id, 813, `bond_coupon_${bondPaid.id}_${uid}_2026_Q1`);
      // Debt 5000 paid down by 813 -> debt=4187, cash=0
      assert.equal(db.profiles.get(uid)!.margin_debt_krw, 4187);
      assert.equal(db.profiles.get(uid)!.cash, 0);

      // Now run maturity batch for same period 2026_Q1 -> principal 100,000 ONLY (no extra coupon!), pays remaining 4187 debt
      const mRes = await bondEngine.executeCouponBatch({
        bonds: [{ ...bondPaid, maturity_date: bondPaid.maturity_date }],
        positions: [{ userId: uid, bondId: bondPaid.id, quantity: 10, avgPrice: 99.8 }],
        periodKey: '2026_Q1',
        now: nowMs,
      });
      assert.equal(mRes.redemptionCount, 1);
      assert.equal(db.profiles.get(uid)!.margin_debt_krw, undefined);
      assert.equal(db.profiles.get(uid)!.cash, 100_000 - 4187);

      // User bond order via /api/orders must be rejected (400)
      const bondApiRes = await ordersPostHandler(
        new Request('http://localhost/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ stock_id: 'bond_kr_2y', side: 'buy', price: 99.8, size: 1 }),
        })
      );
      assert.equal(bondApiRes.status, 400);

      // Option expiry payout repays margin_debt_krw first (F-03)
      const optUid = 'usr_f03_opt';
      db.ensureUserProfile(optUid, { email: 'f03opt@test.local' });
      db.profiles.get(optUid)!.cash = 0;
      db.profiles.get(optUid)!.margin_debt_krw = 5000;
      const optContract = db.optionsContracts.get('opt_c_720')!;
      optContract.expiry_date = new Date(nowMs - 1000).toISOString();
      db.holdings.set(`${optUid}_${optContract.id}`, {
        id: `${optUid}_${optContract.id}`,
        user_id: optUid,
        stock_id: optContract.id,
        quantity: 1,
        avg_price: 2.0,
        created_at: db.getIsoTimestamp(),
      });
      const optExpRes = await bundle.settlement.settleOptionExpiryAtomically({
        userId: optUid,
        optionId: optContract.id,
        underlyingClosePrice: 280,
        now: nowMs,
        idempotencyKey: 'f03_opt_exp_1',
      });
      assert.equal(optExpRes.success, true);
      // (280 - 260) * 1 * 250000 = 5,000,000 -> minus 5000 debt = 4,995,000
      assert.equal(db.profiles.get(optUid)!.margin_debt_krw, undefined);
      assert.equal(db.profiles.get(optUid)!.cash, 4_995_000);
    }
    console.log('  ✅ PASS [F-02 & F-03]');

    // ── [F-04 & F-05] Negative cost event debt priority + resting buy block & cancel sweep across stock/option/commodity ──
    console.log('▶ [F-04 & F-05] Event negative cost debt priority & resting buy block / cancel cash sweep');
    {
      const evUid = 'usr_f04_event';
      memoryDb.ensureUserProfile(evUid, { email: 'f04@test.local' });
      memoryDb.profiles.get(evUid)!.cash = 0;
      memoryDb.profiles.get(evUid)!.margin_debt_krw = 500_000;
      memoryDb.playerEvents.push({
        id: 'ev_def_f04',
        title: 'Negative Cost Cash Credit Event',
        choice_a_cost: -200_000,
        choice_a_passive: null,
        choice_b_cost: 0,
        choice_b_passive: null,
      });
      memoryDb.activePlayerEvents.push({
        id: 'act_ev_f04',
        event_id: 'ev_def_f04',
        user_id: evUid,
        status: 'pending',
      });
      const evRes = await resolvePlayerEventChoice({ db: memoryDb, userId: evUid, activeEventId: 'act_ev_f04', choice: 'A' });
      assert.equal(evRes.success, true, `resolvePlayerEventChoice failed: ${evRes.message}`);
      assert.equal(memoryDb.profiles.get(evUid)!.cash, 0);
      assert.equal(memoryDb.profiles.get(evUid)!.margin_debt_krw, 300_000);

      // F-05 stock: resting buy before debt -> debt occurs -> seller tries to hit -> indebted buy skipped -> cancel sweeps cash
      const stockId = STOCK_UUID_MAP['0010'] || Array.from(memoryDb.stocks.values())[0]!.id;
      // Clear resting LP orders on stockId for clean F-05 resting-buy isolation
      for (const oid of Array.from(memoryDb.orderStockIndex.get(stockId) || [])) {
        const o = memoryDb.orders.get(oid);
        if (o) memoryDb.removeOrderFromIndex(o);
        memoryDb.orders.delete(oid);
      }
      const buyer = 'usr_f05_buyer';
      const seller = 'usr_f05_seller';
      memoryDb.ensureUserProfile(buyer, { email: 'b5@test.local' });
      memoryDb.ensureUserProfile(seller, { email: 's5@test.local' });
      memoryDb.profiles.get(buyer)!.cash = 1_000_000;
      memoryDb.profiles.get(seller)!.cash = 1_000_000;
      memoryDb.holdings.set(`${seller}_${stockId}`, {
        id: `${seller}_${stockId}`,
        user_id: seller,
        stock_id: stockId,
        quantity: 20,
        avg_price: 70000,
        created_at: memoryDb.getIsoTimestamp(),
      });
      memoryDb.rebuildIndexes();

      const restBuy = await LocalMarketService.submitOrder({
        userId: buyer,
        stockId,
        side: 'buy',
        price: 80_000,
        size: 10,
      });
      assert.equal(restBuy.success, true, `restBuy failed: ${restBuy.message}`);
      // Reserved cash ~802,000; apply -500,000 loss -> debt 302,000
      applyCashDeltaWithMarginDebt(memoryDb, memoryDb.profiles.get(buyer)!, -500_000);
      assert.ok((memoryDb.profiles.get(buyer)!.margin_debt_krw ?? 0) > 0);

      const sellAttempt = await LocalMarketService.submitOrder({
        userId: seller,
        stockId,
        side: 'sell',
        price: 80_000,
        size: 5,
      });
      assert.equal(sellAttempt.success, true);
      assert.equal(sellAttempt.filledQty, 0, 'indebted buyer resting buy order must NOT fill');
      await LocalMarketService.cancelOrder({ orderId: sellAttempt.orderId!, userId: seller });

      const cancelRes = await LocalMarketService.cancelOrder({ orderId: restBuy.orderId!, userId: buyer });
      assert.equal(cancelRes.success, true);
      // Debt (302,000) was swept from released cash (802,000) -> debt=0, cash=500,000
      assert.equal(memoryDb.profiles.get(buyer)!.margin_debt_krw, undefined);
      assert.equal(memoryDb.profiles.get(buyer)!.cash, 500_000);

      // F-05 commodity: cancelCommodityOrders rollback restores margin_debt_krw when onPersist fails
      const cmdUid = 'usr_f05_cmd';
      memoryDb.ensureUserProfile(cmdUid, { email: 'cmd5@test.local' });
      memoryDb.profiles.get(cmdUid)!.cash = 10_000_000;
      const commDef = { id: 'CRUDE_OIL', name: 'WTI', nameKo: '원유', ticker: 'CL', category: 'energy' as const, basePrice: 75, unit: 'bbl', tickSize: 0.01, tickValue: 10, marginRequirement: 3000, baseVolatility: 0.02, drift: 0, eventSensitivity: 1.0, averageVolume: 1000, description: 'WTI Crude Oil' };
      const cmdRes = await reserveMarginAndSubmitCommodityOrder({
        db: memoryDb,
        commodity: commDef,
        userId: cmdUid,
        side: 'buy',
        type: 'limit',
        price: 75,
        size: 1,
        submitToEngine: () => ({ id: 'cm_ord_f05', commodityId: 'CRUDE_OIL', userId: cmdUid, side: 'buy', type: 'limit', price: 75, size: 1, filled: 0, createdAtTick: 1, createdAtTime: Date.now() }),
        rollbackFromEngine: () => {},
      });
      assert.equal(cmdRes.success, true);
      memoryDb.profiles.get(cmdUid)!.margin_debt_krw = 1_000_000;
      const cashBeforeRollback = memoryDb.profiles.get(cmdUid)!.cash;
      const failCancelCmd = await cancelCommodityOrders({
        db: memoryDb,
        userId: cmdUid,
        orderIds: ['cm_ord_f05'],
        removeFromBook: () => null,
        restoreToBook: () => {},
        onPersist: async () => false,
      });
      assert.equal(failCancelCmd.success, false);
      assert.equal(memoryDb.profiles.get(cmdUid)!.cash, cashBeforeRollback);
      assert.equal(memoryDb.profiles.get(cmdUid)!.margin_debt_krw, 1_000_000, 'margin_debt_krw must be restored on commodity cancel rollback');

      // F-05 option: resting option buy skipped if buyer later has margin_debt_krw > 0
      const optBuyer = 'usr_f05_opt_b';
      const optSeller = 'usr_f05_opt_s';
      memoryDb.ensureUserProfile(optBuyer, { email: 'ob5@test.local' });
      memoryDb.ensureUserProfile(optSeller, { email: 'os5@test.local' });
      memoryDb.profiles.get(optBuyer)!.has_options_license = true;
      memoryDb.profiles.get(optSeller)!.has_options_license = true;
      memoryDb.profiles.get(optBuyer)!.cash = 10_000_000;
      memoryDb.profiles.get(optSeller)!.cash = 10_000_000;
      const activeOpt = Array.from(memoryDb.optionsContracts.values()).find(
        (c) => Date.parse(c.expiry_date) > Date.now() + 86400_000 && Number(c.current_price) >= 1.5
      )!;
      const { lpBidPrice, lpAskPrice } = getOptionLpQuotes(activeOpt);
      const midOptPrice = Math.round(((lpBidPrice + lpAskPrice) / 2) * 100) / 100;
      memoryDb.holdings.set(`${optSeller}_${activeOpt.id}`, {
        id: `${optSeller}_${activeOpt.id}`,
        user_id: optSeller,
        stock_id: activeOpt.id,
        quantity: 2,
        avg_price: 2.0,
        created_at: memoryDb.getIsoTimestamp(),
      });
      memoryDb.rebuildIndexes();
      const optBuyRes = await submitAuthoritativeOptionOrder({
        db: memoryDb,
        userId: optBuyer,
        contractId: activeOpt.id,
        side: 'BUY',
        orderType: 'LIMIT',
        price: midOptPrice,
        qty: 1,
      });
      assert.equal(optBuyRes.success, true);
      assert.equal(optBuyRes.order?.status, 'open');
      memoryDb.profiles.get(optBuyer)!.margin_debt_krw = 200_000;
      const optSellRes = await submitAuthoritativeOptionOrder({
        db: memoryDb,
        userId: optSeller,
        contractId: activeOpt.id,
        side: 'SELL',
        orderType: 'LIMIT',
        price: midOptPrice,
        qty: 1,
      });
      assert.equal(optSellRes.success, true);
      assert.equal(optSellRes.order?.filledQty, 0, 'indebted option buyer resting buy must be skipped');
      assert.equal(memoryDb.orders.get(optBuyRes.order!.orderId)?.filled, 0);
      await cancelOptionOrder({ db: memoryDb, orderId: optBuyRes.order!.orderId, userId: optBuyer });
      assert.equal(memoryDb.profiles.get(optBuyer)!.margin_debt_krw, undefined, 'cancelling option buy sweeps cash to clear margin debt');
    }
    console.log('  ✅ PASS [F-04 & F-05]');

    // ── [F-06 & F-07 & F-08 & F-17 & F-18] MarketEngine commitGate, bot pools, LP handover, SimulationContext, kind alignment ──
    console.log('▶ [F-06, F-07, F-08, F-17, F-18] MarketEngine commitGate, bot pools, LP single-slot handover');
    {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys_ce_me_'));
      try {
        const db = new MemoryDatabase();
        const pm = new PersistenceManager(new FileStorageAdapter(tmpDir));
        await pm.saveSnapshot(db);
        const origPrice = Array.from(db.stocks.values())[0]!.current_price;

        const engine = new MarketEngine({
          simulationContext: createSimulationContext({ seed: 42 }),
          repositories: createInMemoryRepositoryBundle(db),
          persistence: pm,
          onTickCommitPersist: async () => await pm.saveSnapshot(db),
        });
        await engine.initializeBots();

        // F-07: all 7 specialized pools populated
        assert.ok((engine as any).retailSwarmAgents.length > 0, 'retailSwarmAgents must be > 0');
        assert.ok((engine as any).hedgeFundAgents.length > 0, 'hedgeFundAgents must be > 0');
        assert.ok((engine as any).propDeskAgents.length > 0, 'propDeskAgents must be > 0');
        assert.ok((engine as any).quantAgents.length > 0, 'quantAgents must be > 0');
        assert.ok((engine as any).optionsMMBots.length > 0, 'optionsMMBots must be > 0');
        assert.ok((engine as any).ctaBots.length > 0, 'ctaBots must be > 0');
        assert.ok((engine as any).commercialHedgerAgents.length > 0, 'commercialHedgerAgents must be > 0');

        // F-18: bot_hf_001, bot_prop_001, bot_cta_001 have FOREIGN_INSTITUTION consistently
        for (const id of ['bot_hf_001', 'bot_hf_002', 'bot_prop_001', 'bot_prop_002', 'bot_cta_001']) {
          const cfg = db.botsConfig.find((c) => c.id === id);
          assert.equal(cfg?.participant_kind, 'FOREIGN_INSTITUTION', `${id} must be FOREIGN_INSTITUTION`);
        }

        // F-17: all bots share engine simulationContext clock
        for (const bot of (engine as any).getAllBotAgents()) {
          assert.equal(bot.clock, (engine as any).simClock, 'every bot must share engine simClock');
        }

        // F-08: partial-fill of new LP order in tick 1 creates NO duplicate open/partial ord_... alongside lp_..._slot*
        const s0 = Array.from(db.stocks.values())[0]!;
        db.ensureUserProfile('usr_ce2b', { email: 'ce2b@test.local' });
        db.holdings.set(`usr_ce2b_${s0.id}`, {
          id: `usr_ce2b_${s0.id}`,
          user_id: 'usr_ce2b',
          stock_id: s0.id,
          quantity: 100,
          avg_price: s0.current_price,
          created_at: db.getIsoTimestamp(),
        });
        db.orders.set('ord_ce2b_sell', {
          id: 'ord_ce2b_sell',
          stock_id: s0.id,
          user_id: 'usr_ce2b',
          side: 'sell',
          price: Math.max(100, Math.round(s0.current_price * 0.95)),
          size: 1,
          filled: 0,
          status: 'open',
          is_lp: false,
          created_at: db.getIsoTimestamp(),
        });
        db.rebuildIndexes();

        const tick1 = await engine.tick();
        assert.equal(tick1.success, true);
        assert.equal(tick1.commitStatus, 'COMMITTED');
        const openOrPartialLpForS0 = Array.from(db.orders.values()).filter(
          (o) => o.stock_id === s0.id && o.is_lp && (o.status === 'open' || o.status === 'partial')
        );
        const ordOpenLp = openOrPartialLpForS0.filter((o) => o.id.startsWith('ord_'));
        assert.equal(
          ordOpenLp.length,
          0,
          `no open/partial ord_... LP order should remain alongside lp_..._slot*: ${JSON.stringify(ordOpenLp)}`
        );

        // Exact CE-2b scenario on clean book of s1: 1 resting sell order partial-fills new LP bid -> only lp_..._slot0 remains
        const s1 = Array.from(db.stocks.values())[1]!;
        for (const oid of Array.from(db.orderStockIndex.get(s1.id) || [])) {
          const ord = db.orders.get(oid);
          if (ord) db.removeOrderFromIndex(ord);
          db.orders.delete(oid);
        }
        db.holdings.set(`usr_ce2b_${s1.id}`, {
          id: `usr_ce2b_${s1.id}`,
          user_id: 'usr_ce2b',
          stock_id: s1.id,
          quantity: 100,
          avg_price: s1.current_price,
          created_at: db.getIsoTimestamp(),
        });
        db.orders.set('ord_ce2b_sell_s1', {
          id: 'ord_ce2b_sell_s1',
          stock_id: s1.id,
          user_id: 'usr_ce2b',
          side: 'sell',
          price: Math.max(100, Math.round(s1.current_price * 0.90)),
          size: 1,
          filled: 0,
          status: 'open',
          is_lp: false,
          created_at: db.getIsoTimestamp(),
        });
        db.rebuildIndexes();
        (engine as any).tickCount = 4; // next tick=5 -> shouldRefreshLp = true
        const tick5 = await engine.tick();
        assert.equal(tick5.success, true);
        const openLpS1 = Array.from(db.orders.values()).filter(
          (o) => o.stock_id === s1.id && o.is_lp && (o.status === 'open' || o.status === 'partial')
        );
        assert.equal(openLpS1.filter((o) => !o.id.startsWith(`lp_${s1.id}_`)).length, 0, 'CE-2b: only lp_..._slot* open LP orders may remain');

        // F-06: mid-tick mutation + concurrent external-timer saveSnapshot (started outside tick ALS context) cannot leak uncommitted state to disk on tick error
        const origFetch = (engine as any).fetchMarketState.bind(engine);
        let saveWhileInTickPromise: Promise<boolean> | null = null;
        let triggerExternalSave = false;
        let resolvedExternalTrigger!: () => void;
        const externalTriggered = new Promise<void>((r) => {
          resolvedExternalTrigger = r;
        });
        const externalAutoSaveSim = setInterval(() => {
          if (triggerExternalSave && !saveWhileInTickPromise) {
            triggerExternalSave = false;
            saveWhileInTickPromise = pm.saveSnapshot(db);
            resolvedExternalTrigger();
          }
        }, 5);
        (engine as any).fetchMarketState = async (macro: any) => {
          const state = await origFetch(macro);
          Array.from(db.stocks.values())[0]!.current_price = 999999;
          triggerExternalSave = true;
          await externalTriggered;
          await new Promise((r) => setTimeout(r, 20));
          throw new Error('SIMULATED_PRE_COMMIT_CRASH_F06');
        };
        const failedTick = await engine.tick();
        clearInterval(externalAutoSaveSim);
        (engine as any).fetchMarketState = origFetch;
        assert.equal(failedTick.success, false);
        assert.equal(failedTick.commitStatus, 'NOT_COMMITTED');
        assert.ok(saveWhileInTickPromise, 'external timer should have triggered saveSnapshot while tick held commitGate');
        await saveWhileInTickPromise!;
        const diskDb = new MemoryDatabase();
        await pm.loadSnapshot(diskDb);
        assert.notEqual(Array.from(diskDb.stocks.values())[0]!.current_price, 999999, 'disk must not contain aborted tick mutation');
        assert.equal(Array.from(db.stocks.values())[0]!.current_price, tick1.success ? db.stocks.get(s0.id)!.current_price : origPrice);

        // Also confirm re-entrant onTickCommitPersist succeeds and flushes committed tick state
        let commitPersistCalled = false;
        const origOnCommit = (engine as any).onTickCommitPersist;
        (engine as any).onTickCommitPersist = async () => {
          commitPersistCalled = true;
          return pm.saveSnapshot(db);
        };
        const tickAfterFail = await engine.tick();
        (engine as any).onTickCommitPersist = origOnCommit;
        assert.equal(tickAfterFail.success, true);
        assert.equal(commitPersistCalled, true);
      } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    }
    console.log('  ✅ PASS [F-06, F-07, F-08, F-17, F-18]');

    // ── [F-09 & F-10] Seed option IDX alignment & optionBotEngine no forbidden writes ──
    console.log('▶ [F-09 & F-10] Option seed IDX consistency & client optionBotEngine zero writes');
    {
      const db = new MemoryDatabase();
      const c720 = db.optionsContracts.get('opt_c_720')!;
      const p720 = db.optionsContracts.get('opt_p_720')!;
      assert.equal(c720.asset_class, 'IDX');
      assert.equal(c720.underlying_stock_id, K200_INDEX_UNDERLYING_ID);
      assert.equal(c720.strike_price, 260);
      assert.equal(p720.asset_class, 'IDX');
      assert.equal(p720.underlying_stock_id, K200_INDEX_UNDERLYING_ID);
      assert.equal(p720.strike_price, 260);

      // Never silently rewrite an existing holder's ambiguous legacy terms.
      const legacyDb = new MemoryDatabase();
      const legacyUser = legacyDb.ensureUserProfile('legacy_terms_owner', { email: 'legacy@test.local' });
      legacyUser.has_options_license = true;
      const legacyCall = legacyDb.optionsContracts.get('opt_c_720')!;
      Object.assign(legacyCall, {
        asset_class: 'STK',
        underlying_stock_id: STOCK_UUID_MAP['0010'],
        strike_price: 72000,
      });
      const legacyHolding = {
        id: `${legacyUser.id}_${legacyCall.id}`,
        user_id: legacyUser.id,
        stock_id: legacyCall.id,
        quantity: 1,
        avg_price: 2.15,
        created_at: legacyDb.getIsoTimestamp(),
      };
      legacyDb.holdings.set(legacyHolding.id, legacyHolding);
      const legacyBond = legacyDb.bonds.get('bond_kr_2y')!;
      delete legacyBond.maturity_date;
      legacyDb.holdings.set(`${legacyUser.id}_${legacyBond.id}`, {
        ...legacyHolding,
        id: `${legacyUser.id}_${legacyBond.id}`,
        stock_id: legacyBond.id,
      });
      const restoredLegacyDb = new MemoryDatabase();
      restoredLegacyDb.importSnapshot(legacyDb.exportSnapshot());
      assert.equal(restoredLegacyDb.optionsContracts.get(legacyCall.id)!.strike_price, 72000);
      assert.equal(restoredLegacyDb.bonds.get(legacyBond.id)!.maturity_date, undefined, 'held bond tenor must not turn into a new maturity on restart');
      const rejectedLegacyOrder = await submitAuthoritativeOptionOrder({
        db: restoredLegacyDb, userId: legacyUser.id, contractId: legacyCall.id,
        side: 'BUY', orderType: 'LIMIT', price: 2.15, qty: 1,
      });
      assert.equal(rejectedLegacyOrder.statusCode, 409);
      const legacyCash = restoredLegacyDb.profiles.get(legacyUser.id)!.cash;
      const rejectedLegacyPayout = await createInMemoryRepositoryBundle(restoredLegacyDb).settlement.settleOptionExpiryAtomically({
        userId: legacyUser.id, optionId: legacyCall.id, underlyingClosePrice: 80000,
        now: Date.parse(legacyCall.expiry_date) + 1, idempotencyKey: 'legacy_ambiguous_expiry',
      });
      assert.equal(rejectedLegacyPayout.errorCode, 'HELD_UNDERLYING_UNIT_MISMATCH');
      assert.equal(restoredLegacyDb.profiles.get(legacyUser.id)!.cash, legacyCash);

      // F-10: optionBotEngine must not throw or perform DB writes when called on browser/client fallback
      const origFetch = globalThis.fetch;
      let writeAttempts = 0;
      globalThis.fetch = (async (_url: any, init: any) => {
        if (init?.body) {
          const parsed = JSON.parse(String(init.body));
          if (parsed?.action === 'rpc' || (parsed?.query?.action && parsed.query.action !== 'select')) {
            writeAttempts++;
          }
        }
        return new Response(JSON.stringify({ data: [], error: null }), { status: 200 });
      }) as any;
      try {
        const res = await runOptionBotTradingEngine('stock_no_opts', '005930', 70000);
        assert.equal(res.success, true);
        const expRes = await processOptionExpiration('stock_no_opts', 70000);
        assert.equal(expRes, 0);
        assert.equal(writeAttempts, 0, 'optionBotEngine must never issue DB write/RPC requests');
      } finally {
        globalThis.fetch = origFetch;
      }
    }
    console.log('  ✅ PASS [F-09 & F-10]');

    // ── [F-13, F-14, F-15, F-16] Standalone fee_booster, optionOrderService gate/rollback, non-fixed getNowMs & epoch IDs, commodities depth ──
    console.log('▶ [F-13, F-14, F-15, F-16] Standalone fee_booster, option rollback keys, clock/IDs, commodity depth');
    {
      // F-15: unbound MemoryDatabase.getNowMs() uses real Date.now()
      const liveDb = new MemoryDatabase();
      const nowDiff = Math.abs(liveDb.getNowMs() - Date.now());
      assert.ok(nowDiff < 5000, `unbound getNowMs must reflect real wall clock, diff=${nowDiff}`);

      // F-15: restart importSnapshot bumps tradeEpoch so generateId never collides
      const id1 = liveDb.generateId('ord_restart');
      const snap = liveDb.exportSnapshot();
      const restartedDb = new MemoryDatabase();
      restartedDb.importSnapshot(snap);
      const id2 = restartedDb.generateId('ord_restart');
      assert.notEqual(id1, id2, 'post-restart generateId must not collide with pre-restart id');

      // F-13: LocalMarketEngineInstance.processMatching respects fee_booster 50% discount
      const s0 = {
        ...Array.from(memoryDb.stocks.values())[0]!,
        id: 'stock_f13_fee_fixture',
        ticker: 'F13FEE',
        current_price: 100_000,
        previous_close: 100_000,
        market: 'domestic',
      };
      memoryDb.stocks.set(s0.id, s0);
      memoryDb.addStockToIndex(s0);
      const feeBuyer = 'usr_f13_fee_buyer';
      const feeSeller = 'usr_f13_fee_seller';
      memoryDb.ensureUserProfile(feeBuyer, { email: 'f13b@test.local' });
      memoryDb.ensureUserProfile(feeSeller, { email: 'f13s@test.local' });
      const futureIso = new Date(Date.now() + 10 * 86400_000).toISOString();
      memoryDb.profiles.get(feeBuyer)!.cash = 1_001_250; // exact for 1,000,000 + 0.125% fee
      memoryDb.profiles.get(feeBuyer)!.unlocked_features = ['fee_booster'];
      memoryDb.profiles.get(feeBuyer)!.feature_expiries = { fee_booster: futureIso };
      memoryDb.profiles.get(feeSeller)!.cash = 1_000_000;
      memoryDb.holdings.set(`${feeSeller}_${s0.id}`, {
        id: `${feeSeller}_${s0.id}`,
        user_id: feeSeller,
        stock_id: s0.id,
        quantity: 20,
        avg_price: 100_000,
        created_at: memoryDb.getIsoTimestamp(),
      });
      memoryDb.orders.set('ord_f13_buy', {
        id: 'ord_f13_buy',
        stock_id: s0.id,
        user_id: feeBuyer,
        side: 'buy',
        price: 100_000,
        size: 10,
        filled: 0,
        status: 'open',
        is_lp: false,
        created_at: new Date(Date.now() - 1000).toISOString(),
      });
      memoryDb.orders.set('ord_f13_sell', {
        id: 'ord_f13_sell',
        stock_id: s0.id,
        user_id: feeSeller,
        side: 'sell',
        price: 100_000,
        size: 10,
        filled: 0,
        status: 'open',
        is_lp: false,
        created_at: new Date(Date.now() - 2000).toISOString(),
      });
      memoryDb.rebuildIndexes();
      await getLocalStandaloneEngine()!.processMatching([]);
      assert.equal(memoryDb.orders.get('ord_f13_buy')?.status, 'filled', 'fee_booster resting taker buy with 1,001,250 must fill');
      assert.equal(memoryDb.profiles.get(feeBuyer)!.cash, 0);

      // F-14: optionOrderService doesn't mutate expired entitlement on validation failure & cleans new keys on rollback
      const optU = 'usr_f14_opt';
      memoryDb.ensureUserProfile(optU, { email: 'f14@test.local' });
      const p14 = memoryDb.profiles.get(optU)!;
      p14.cash = 100; // insufficient
      p14.has_options_license = true;
      p14.unlocked_features = ['fee_booster'];
      p14.feature_expiries = { fee_booster: new Date(Date.now() - 60_000).toISOString() };
      const c14 = Array.from(memoryDb.optionsContracts.values()).find((c) => Date.parse(c.expiry_date) > Date.now() + 86400_000)!;
      const failOpt14 = await submitAuthoritativeOptionOrder({
        db: memoryDb,
        userId: optU,
        contractId: c14.id,
        side: 'BUY',
        orderType: 'LIMIT',
        price: 2.0,
        qty: 1,
      });
      assert.equal(failOpt14.success, false);
      assert.deepEqual(p14.unlocked_features, ['fee_booster'], 'rejected option order must not mutate unlocked_features before commitGate');

      // F-12: scenarioRuntimeState & commodityEventRuntimeState persist in snapshot + removeStockFromIndex cleans marketIndex
      const f12Db = new MemoryDatabase();
      const customStk: any = {
        id: 'stk_f12_rollback',
        ticker: 'F12TEST',
        name: 'F12 Test',
        market: 'f12_custom_mkt',
        sector: 'IT',
        current_price: 10000,
        previous_close: 10000,
        volume: 100,
      };
      f12Db.stocks.set(customStk.id, customStk);
      f12Db.addStockToIndex(customStk);
      assert.equal(f12Db.marketIndex.get('f12_custom_mkt')?.has(customStk.id), true);
      f12Db.stocks.delete(customStk.id);
      f12Db.removeStockFromIndex(customStk);
      assert.equal(f12Db.tickerIndex.has('F12TEST'), false);
      assert.equal(f12Db.marketIndex.get('f12_custom_mkt')?.has(customStk.id) ?? false, false);

      f12Db.scenarioRuntimeState = { activeScenarios: [{ id: 'sc_1' }], activeMacroShocks: [], actionLogs: [] };
      f12Db.commodityEventRuntimeState = { activeEvents: [{ id: 'ev_1' }] };
      const f12Snap = f12Db.exportSnapshot();
      const f12Restored = new MemoryDatabase();
      f12Restored.importSnapshot(f12Snap);
      assert.deepEqual(f12Restored.scenarioRuntimeState, f12Db.scenarioRuntimeState);
      assert.deepEqual(f12Restored.commodityEventRuntimeState, f12Db.commodityEventRuntimeState);

      // F-16.4: GET /api/commodities?id=CRUDE_OIL returns depth & spread
      const commRes = await commoditiesGetHandler(new Request('http://localhost/api/commodities?id=CRUDE_OIL'));
      assert.equal(commRes.status, 200);
      const commJson = await commRes.json();
      assert.equal(commJson.success, true);
      assert.ok(commJson.depth && Array.isArray(commJson.depth.bids) && Array.isArray(commJson.depth.asks));
      assert.ok('spread' in commJson);
    }
    console.log('  ✅ PASS [F-13, F-14, F-15, F-16]');

    console.log('\n================================================================');
    console.log('🎉 ALL 2026-11-19 REVIEW REGRESSION TESTS PASSED (EXIT 0)');
    console.log('================================================================');
  } finally {
    (globalThis as any).commodityEngine?.stop?.();
    stopLocalStandaloneEngine();
  }
}

main().catch((err) => {
  console.error('❌ Test failed:', err);
  process.exitCode = 1;
});
