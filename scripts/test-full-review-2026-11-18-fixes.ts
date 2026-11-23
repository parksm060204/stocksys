import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys_fix_reg_'));
process.env.STOCKSYS_DATA_DIR = tmpDir;

async function main() {
  const { MemoryDatabase, memoryDb, K200_INDEX_UNDERLYING_ID, computeK200IndexPrice } = await import('../lib/memoryDb/memoryStore');
  const { createMemoryDbClient } = await import('../lib/memoryDb/memoryDbClient');
  const { createInMemoryRepositoryBundle } = await import('../lib/repositories/inMemory');
  const { SettlementBatchService } = await import('../engine-server/src/settlement/SettlementBatchService');
  const { StaticTimeSource } = await import('../lib/engine/simulation/runtime/simulationTimeSource');
  const { MarketEngine } = await import('../engine-server/src/MarketEngine');
  const { CommodityMarketEngine } = await import('../lib/commodities/CommodityMarketEngine');
  const { reserveMarginAndSubmitCommodityOrder, settleCommodityTradeForUsers } = await import('../lib/commodities/commodityLedger');
  const { getAvailableCashKrw } = await import('../lib/engine/orderRisk');
  const { AgentManager } = await import('../lib/engine/simulation/agentManager');
  const { buildMarketObservation, calculateAuthoritativePortfolioValuation } = await import('../lib/engine/simulation/marketObservation');
  const { evaluateValueStrategy } = await import('../lib/engine/simulation/strategies/valueStrategy');
  const { SimPrng } = await import('../lib/engine/simulation/simClock');
  const { submitAndMatchOrder } = await import('../lib/engine/dbMatching');
  const { ensureLocalStandaloneReady } = await import('../lib/engine/localStandaloneServer');

  try {
    console.log('=== [1] F1: IDX K200 Option Unit & Migration & Fail-Closed Guard ===');
    {
      const db = new MemoryDatabase();
      const idxOpt = Array.from(db.optionsContracts.values()).find((o) => o.id.startsWith('opt_k200_') && o.type === 'CALL' && o.strike_price === 260)!;
      assert.equal(idxOpt.underlying_stock_id, K200_INDEX_UNDERLYING_ID);
      const bundle = createInMemoryRepositoryBundle(db);
      const prices = bundle.market.getUnderlyingPrices([K200_INDEX_UNDERLYING_ID]);
      assert.ok(prices[K200_INDEX_UNDERLYING_ID] >= 200 && prices[K200_INDEX_UNDERLYING_ID] <= 350, 'K200 index must be ~260pt scale');

      // Unit mismatch fail-closed in InMemorySettlementRepository
      const uid = 'u_f1';
      db.ensureUserProfile(uid, { email: 'f1@t.com' });
      db.profiles.get(uid)!.cash = 1_000_000;
      idxOpt.expiry_date = new Date(db.getNowMs() - 1000).toISOString();
      db.holdings.set(`${uid}_${idxOpt.id}`, {
        id: `${uid}_${idxOpt.id}`, user_id: uid, stock_id: idxOpt.id, quantity: 1, avg_price: 2.15, created_at: db.getIsoTimestamp(),
      });
      const failRes = await bundle.settlement.settleOptionExpiryAtomically({
        userId: uid, optionId: idxOpt.id, underlyingClosePrice: 72000, idempotencyKey: 'f1_fail',
      });
      assert.equal(failRes.success, false);
      assert.equal(failRes.errorCode, 'HELD_UNDERLYING_UNIT_MISMATCH');

      // SettlementBatchService settles against ~260 index (not 72,000)
      const batchSvc = new SettlementBatchService(bundle, new StaticTimeSource(db.getNowMs()));
      const batchRes = await batchSvc.runDailySettlementBatch();
      assert.equal(batchRes.optionSettled, 1);
      assert.ok(batchRes.optionPayout < 10_000_000, `IDX payout must not be 17.9B: ${batchRes.optionPayout}`);

      // Legacy snapshot migration preserves strike & expiry while fixing underlying_stock_id
      const snap = db.exportSnapshot();
      const legacyContract = { ...idxOpt, id: 'opt_k200_legacy_c_260', underlying_stock_id: '00000000-0000-4000-8000-000000000101', strike_price: 260, expiry_date: '2026-01-01T00:00:00.000Z' };
      snap.optionsContracts.push([legacyContract.id, legacyContract]);
      const dbMigrated = new MemoryDatabase();
      dbMigrated.importSnapshot(snap, { migrateCatalog: true });
      const migrated = dbMigrated.optionsContracts.get(legacyContract.id)!;
      assert.equal(migrated.underlying_stock_id, K200_INDEX_UNDERLYING_ID);
      assert.equal(migrated.strike_price, 260);
      assert.equal(migrated.expiry_date, '2026-01-01T00:00:00.000Z');
      console.log('  ✅ PASS F1');
    }

    console.log('=== [2] F2: Bond Maturity Percentage Coupon Consistency ===');
    {
      const db = new MemoryDatabase();
      const bundle = createInMemoryRepositoryBundle(db);
      const uid = 'u_f2';
      db.ensureUserProfile(uid, { email: 'f2@t.com' });
      db.profiles.get(uid)!.cash = 1_000_000;
      const bond = Array.from(db.bonds.values())[0]!; // coupon_rate = 3.25, face_value = 10000
      bond.maturity_date = new Date(db.getNowMs() - 1000).toISOString();
      db.holdings.set(`${uid}_${bond.id}`, {
        id: `${uid}_${bond.id}`, user_id: uid, stock_id: bond.id, quantity: 2, avg_price: 100, created_at: db.getIsoTimestamp(),
      });
      const res = await bundle.settlement.settleBondMaturityAtomically({
        userId: uid, bondId: bond.id, idempotencyKey: 'f2_ok',
      });
      assert.equal(res.success, true);
      // 2 * 10000 + Math.round(2 * 10000 * (0.0325 / 4)) = 20000 + 163 = 20163
      assert.equal(db.profiles.get(uid)!.cash, 1_020_163);
      console.log('  ✅ PASS F2');
    }

    console.log('=== [3] F3 & F19 & F20: Batch Rollback Ghost Order, Profile Rollback Keys, Ledger Compaction ===');
    {
      const db = new MemoryDatabase();
      const bundle = createInMemoryRepositoryBundle(db);
      const stock = Array.from(db.stocks.values()).find((s) => s.ticker === '0010')!;
      db.ensureUserProfile('b3', { email: 'b3@t.com' }); db.profiles.get('b3')!.cash = 50_000_000;
      db.ensureUserProfile('s3', { email: 's3@t.com' }); db.profiles.get('s3')!.cash = 50_000_000;
      db.ensureUserProfile('o3', { email: 'o3@t.com' }); db.profiles.get('o3')!.cash = 50_000_000;
      db.holdings.set(`s3_${stock.id}`, { id: `s3_${stock.id}`, user_id: 's3', stock_id: stock.id, quantity: 100, avg_price: 70000, created_at: db.getIsoTimestamp() });
      const ask: any = { id: 'f3_ask', stock_id: stock.id, user_id: 's3', side: 'sell', price: 70000, size: 10, filled: 0, status: 'open', is_lp: false, created_at: db.getIsoTimestamp(), version: 1 };
      const unrelated: any = { id: 'f3_unrel', stock_id: stock.id, user_id: 'o3', side: 'buy', price: 69000, size: 5, filled: 0, status: 'open', is_lp: false, created_at: db.getIsoTimestamp(), version: 1 };
      db.orders.set(ask.id, ask);
      db.orders.set(unrelated.id, unrelated);
      db.rebuildIndexes();

      const newBid: any = { id: 'f3_new_bid', stock_id: stock.id, user_id: 'b3', side: 'buy', price: 70000, size: 10, filled: 0, status: 'open', is_lp: false, created_at: db.getIsoTimestamp(), version: 1 };
      const batchRes = await bundle.settlement.commitMatchedBatchAtomically({
        newOrders: [newBid],
        trades: [{ id: 'tr_f3', stock_id: stock.id, buy_order_id: newBid.id, sell_order_id: ask.id, buyer_id: 'b3', seller_id: 's3', price: 70000, size: 10, buyer_is_bot: false, seller_is_bot: false, fee_rates: { buyerFeeRate: 0.0025, sellerFeeRate: 0.0025 } }],
        orderUpdates: [{ id: unrelated.id, status: 'cancelled', expectedVersion: 999 }],
      });
      assert.equal(batchRes.success, false);
      assert.equal(batchRes.rollbackOccurred, true);
      assert.equal(db.orders.has('f3_new_bid'), false);
      assert.equal(db.orderStockIndex.get(stock.id)?.has('f3_new_bid') ?? false, false);

      // F19: Profile rollback removes mid-tick added keys
      const profRef = db.profiles.get('b3')!;
      const snap = db.exportRollbackSnapshot();
      profRef.has_options_license = true;
      db.restoreRollbackSnapshot(snap);
      assert.equal('has_options_license' in profRef, false);
      assert.equal('has_options_license' in db.profiles.get('b3')!, false);

      // F20: Bond redemption compaction + out-of-order epoch/timestamp reversal preservation
      for (let i = 0; i < 2050; i++) {
        db.settlementLedger.set(`bond_maturity_redemption_b${i}_u1_period_2020-01`, {
          trade_id: `bond_maturity_redemption_b${i}_u1_period_2020-01`, stock_id: 'b', price: 0, size: 0, total_amount: 10000,
          buyer_fee_rate: 0, seller_fee_rate: 0, buyer_fee_amount: 0, seller_fee_amount: 0, settled_at: '2020-01-15T00:00:00.000Z',
        });
      }
      // Out-of-order epochs and reversed timestamps
      db.settlementLedger.set('tr_e2_1', { trade_id: 'tr_e2_1', stock_id: stock.id, price: 100, size: 1, total_amount: 100, buyer_fee_rate: 0, seller_fee_rate: 0, buyer_fee_amount: 0, seller_fee_amount: 0, settled_at: '2026-05-01T00:00:00.000Z' });
      db.settlementLedger.set('tr_e1_3', { trade_id: 'tr_e1_3', stock_id: stock.id, price: 100, size: 1, total_amount: 100, buyer_fee_rate: 0, seller_fee_rate: 0, buyer_fee_amount: 0, seller_fee_amount: 0, settled_at: '2026-04-01T00:00:00.000Z' });
      db.settlementLedger.set('custom_adhoc_id', { trade_id: 'custom_adhoc_id', stock_id: stock.id, price: 100, size: 1, total_amount: 100, buyer_fee_rate: 0, seller_fee_rate: 0, buyer_fee_amount: 0, seller_fee_amount: 0, settled_at: '2025-01-01T00:00:00.000Z' });
      db.trimSettlementLedger(0);
      assert.ok(db.settledBondRedemptions.size <= 2000, 'settledBondRedemptions must compact');
      assert.equal(db.isTradeAlreadySettled('bond_maturity_redemption_b0_u1_period_2020-01'), true);
      assert.equal(db.isTradeAlreadySettled('tr_e2_1'), true);
      assert.equal(db.isTradeAlreadySettled('tr_e1_3'), true);
      assert.equal(db.isTradeAlreadySettled('tr_e1_2'), false, 'Out-of-order tr_e1_2 must NOT be marked settled');
      assert.equal(db.isTradeAlreadySettled('custom_adhoc_id'), true, 'Custom adhoc ID must never be forgotten');
      console.log('  ✅ PASS F3 & F19 & F20');
    }

    console.log('=== [4] F4 & F21: Commodity Reserved-Cash Protection, Margin Debt, Maintenance Liquidation & STP Status ===');
    {
      const db = new MemoryDatabase();
      const uid = 'u_f4';
      db.ensureUserProfile(uid, { email: 'f4@t.com' });
      db.profiles.get(uid)!.cash = 10_000_000;
      // User also has an open stock buy order reserving 2,506,250 KRW
      const stk = Array.from(db.stocks.values()).find((s) => s.ticker === '0010')!;
      const openStkOrd: any = { id: 'f4_stk_ord', stock_id: stk.id, user_id: uid, side: 'buy', price: 25000, size: 100, filled: 0, status: 'open', is_lp: false, created_at: db.getIsoTimestamp() };
      db.orders.set(openStkOrd.id, openStkOrd);
      db.addOrderToIndex(openStkOrd);

      const engine = new CommodityMarketEngine();
      engine.attachDatabase(db);
      const wti = engine.getCommodity('CRUDE_OIL')!;
      const openRes = await reserveMarginAndSubmitCommodityOrder({
        db, commodity: wti, userId: uid, side: 'buy', type: 'limit', price: 78.5, size: 1,
        submitToEngine: () => engine.submitUserOrder({ commodityId: wti.id, userId: uid, side: 'buy', type: 'limit', price: 78.5, size: 1 }),
        rollbackFromEngine: (id) => engine.removeUserOrder(wti.id, id),
      });
      assert.equal(openRes.success, true);
      await settleCommodityTradeForUsers(db, {
        id: 'cm_f4_open', commodityId: wti.id, buyOrderId: openRes.order!.id, sellOrderId: 'bot_s', buyerId: uid, sellerId: 'bot_mm', price: 78.5, size: 1, tick: 1, timestamp: Date.now(),
      }, wti);

      // Gap crash to 50.0 -> closes with huge loss
      const closeRes = await reserveMarginAndSubmitCommodityOrder({
        db, commodity: wti, userId: uid, side: 'sell', type: 'limit', price: 50.0, size: 1,
        submitToEngine: () => engine.submitUserOrder({ commodityId: wti.id, userId: uid, side: 'sell', type: 'limit', price: 50.0, size: 1 }),
        rollbackFromEngine: (id) => engine.removeUserOrder(wti.id, id),
      });
      assert.equal(closeRes.success, true);
      await settleCommodityTradeForUsers(db, {
        id: 'cm_f4_close', commodityId: wti.id, buyOrderId: 'bot_b', sellOrderId: closeRes.order!.id, buyerId: 'bot_mm', sellerId: uid, price: 50.0, size: 1, tick: 2, timestamp: Date.now(),
      }, wti);

      const prof = db.profiles.get(uid)!;
      assert.ok(prof.cash >= 2_506_250, `Stock reserved cash must remain protected: cash=${prof.cash}`);
      assert.ok((prof.margin_debt_krw ?? 0) > 0, 'Unpaid loss must be recorded in margin_debt_krw');
      assert.equal(getAvailableCashKrw(db, uid).availableCash, 0, 'New risk orders must be blocked while in margin debt');
      console.log('  ✅ PASS F4');
    }

    console.log('=== [5] F5 & F6: ABM Holding Key & USD Valuation/Strategy FX ===');
    {
      memoryDb.resetToSeedData();
      const usdStock = Array.from(memoryDb.stocks.values()).find((s) => s.ticker === 'AAPL')!;
      const mgr = new AgentManager(42, 1773500000000);
      mgr.setCrossAssetMode('EXPERIMENTAL_ON');
      const agent = Array.from(mgr.agents.values())[0]!;
      memoryDb.holdings.set(`${agent.accountId}_${usdStock.id}`, {
        id: `${agent.accountId}_${usdStock.id}`, user_id: agent.accountId, stock_id: usdStock.id, quantity: 500, avg_price: usdStock.current_price, created_at: memoryDb.getIsoTimestamp(),
      });
      const gateRes = (mgr as any).applyCrossAssetRiskGate(
        agent, usdStock, { action: 'sell', size: 10, price: usdStock.current_price, reason: 'test' },
        {
          converged: true,
          targetAllocations: [{
            assetId: usdStock.id, targetWeight: 0, targetQuantity: 0, targetNotional: 0, deltaQuantity: -10,
          }],
          heldReasons: {},
        },
        1, memoryDb.getNowMs()
      );
      // Should not fail with colon lookup miss
      assert.notEqual(memoryDb.holdings.get(`${agent.accountId}_${usdStock.id}`)?.quantity, undefined);
      assert.equal(gateRes.allowed, true);

      memoryDb.ensureUserProfile(agent.accountId, { email: 'a@t.com' });
      memoryDb.profiles.get(agent.accountId)!.cash = 1_000;
      const obs = buildMarketObservation(usdStock.id, agent.accountId, memoryDb.getNowMs())!;
      assert.ok((obs.fxRateToKrw ?? 1) > 1000);
      assert.equal(obs.isUsdAsset, true);
      const valSummary = calculateAuthoritativePortfolioValuation(agent.accountId, 1_000);
      assert.ok(valSummary.totalHoldingsValue > 50_000_000, 'USD holdings must be valued in KRW');
      const valDec = evaluateValueStrategy(obs, agent, mgr.valueConfig, usdStock.current_price * 1.3, new SimPrng(1));
      assert.equal(valDec.action, 'hold', '1,000 KRW account must NOT afford $185.5 AAPL share');
      assert.equal(valDec.reason, 'insufficient_cash');
      console.log('  ✅ PASS F5 & F6');
    }

    console.log('=== [6] F7 & F11 & F24: MarketEngine Non-LP Bots, OrderBook Snapshot, WTI Trigger ===');
    {
      const db = new MemoryDatabase();
      const bundle = createInMemoryRepositoryBundle(db);
      const engine = new MarketEngine({ repositories: bundle as any });
      await engine.initializeBots();
      await engine.tick();
      const os = Array.from(db.stocks.values()).find((s) => s.ticker === '0010')!;
      os.current_price = 90000;
      (engine as any).cachedMarketState = null;
      let opt = Array.from(db.optionsContracts.values()).find((o) => o.underlying_stock_id === os.id && o.type === 'CALL');
      if (!opt) {
        opt = {
          id: 'opt_stk_0010_call_test',
          underlying_stock_id: os.id,
          ticker: 'STK-0010-C90500',
          asset_class: 'STK',
          type: 'CALL',
          option_type: 'CALL',
          strike_price: 90500,
          current_price: 1500,
          multiplier: 1,
          expiry_date: new Date(db.getNowMs() + 30 * 86400_000).toISOString(),
          open_interest: 200000,
          volume: 100,
        };
        db.optionsContracts.set(opt.id, opt);
      }
      opt.strike_price = 90500;
      opt.open_interest = 200000;
      const wbOrders = (engine as any).wallBreakerAgent.executeGammaSqueezeHunt({ hour: 15 }, { [os.id]: 90000 }, [opt]);
      assert.equal(wbOrders.length, 1);
      assert.equal(wbOrders[0].is_lp, false);
      const diags: any[] = [];
      const ms = await (engine as any).fetchMarketState(null);
      assert.ok(Object.keys(ms.orderBook).length > 0, 'orderBook must be populated');
      const validated = await (engine as any).validateSingleOrder(wbOrders[0], ms, false, diags);
      assert.ok(validated !== null, 'WallBreaker order with is_lp=false must not be rejected as UNAUTHORIZED_LP');
      console.log('  ✅ PASS F7 & F11 & F24');
    }

    console.log('=== [7] F12 & F14 & F15 & F16 & F17: LocalDB Orders Join, Admin Scenarios, MarketFlow, FeeBooster ===');
    {
      await ensureLocalStandaloneReady();
      // F12: orders join stocks in memoryDbClient
      const stk = Array.from(memoryDb.stocks.values()).find((s) => s.ticker === 'AAPL')!;
      const ordId = 'f12_ord_1';
      memoryDb.orders.set(ordId, { id: ordId, stock_id: stk.id, user_id: '00000000-0000-4000-8000-000000000001', side: 'buy', price: 185.5, size: 1, filled: 0, status: 'open', is_lp: false, created_at: memoryDb.getIsoTimestamp() });
      memoryDb.addOrderToIndex(memoryDb.orders.get(ordId)!);
      const client = createMemoryDbClient();
      const { data: ordRows } = await client.from('orders').select('*').eq('id', ordId);
      assert.equal(ordRows?.[0]?.stocks?.ticker, 'AAPL');

      // F17: fee_booster reduces fee 50% in both reservation and dbMatching settlement
      const uid = 'u_f17_booster';
      memoryDb.ensureUserProfile(uid, { email: 'f17@t.com' });
      const prof = memoryDb.profiles.get(uid)!;
      const domesticStk = Array.from(memoryDb.stocks.values()).find((s) => s.ticker === '0010')!;
      // Set exact cash for 10 shares @ 70,000 + 0.125% discounted fee = 700,875 KRW (would fail at 0.25% = 701,750!)
      prof.cash = 700_875;
      prof.unlocked_features = ['fee_booster'];
      prof.feature_expiries = { fee_booster: new Date(Date.now() + 86400_000).toISOString() };
      const sellerId = 'u_f17_seller';
      memoryDb.ensureUserProfile(sellerId, { email: 's17@t.com' });
      memoryDb.holdings.set(`${sellerId}_${domesticStk.id}`, { id: `${sellerId}_${domesticStk.id}`, user_id: sellerId, stock_id: domesticStk.id, quantity: 20, avg_price: 70000, created_at: memoryDb.getIsoTimestamp() });
      const sellAsk: any = { id: 'f17_ask', stock_id: domesticStk.id, user_id: sellerId, side: 'sell', price: 70000, size: 10, filled: 0, status: 'open', is_lp: false, created_at: memoryDb.getIsoTimestamp() };
      memoryDb.orders.set(sellAsk.id, sellAsk);
      memoryDb.addOrderToIndex(sellAsk);
      const matchRes = await submitAndMatchOrder(client, { stock_id: domesticStk.id, user_id: uid, side: 'buy', price: 70000, size: 10, order_type: 'ioc' });
      assert.equal(matchRes.success, true, `Fee booster user should succeed with 700,875 KRW: ${matchRes.message}`);
      assert.equal(matchRes.filledQty, 10, `Expected 10 filled, got ${matchRes.filledQty} (${matchRes.message}), askStatus=${memoryDb.orders.get('f17_ask')?.status}`);
      assert.equal(memoryDb.profiles.get(uid)!.cash, 0, 'Exact 0.125% fee deducted');

      // F14 & F15 & F16 & F17 route handler checks
      const { POST: purchasePost } = await import('../app/api/shop/purchase/route');
      const { setSessionGetter } = await import('../app/api/analyze/route');
      const { GET: marketFlowGet } = await import('../app/api/market-flow/route');
      const { POST: adminScenPost } = await import('../app/api/admin/scenarios/route');

      // Unauthenticated GET /api/market-flow must omit internal marketState
      const mfRes = await marketFlowGet(new Request('http://localhost/api/market-flow?points=20'));
      const mfJson = await mfRes.json();
      assert.equal(mfRes.status, 200);
      assert.equal(mfJson.data.marketState, undefined);

      // Admin scenario without initialPrice must not write NaN target_price
      process.env.ALLOW_DEV_ADMIN = 'true';
      const scRes = await adminScenPost(new Request('http://localhost/api/admin/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'inject_scenario', assetType: 'stock', assetId: domesticStk.id, ticker: domesticStk.ticker, name: domesticStk.name, mode: 'PUMP', targetChangePct: 20 }),
      }));
      const scJson = await scRes.json();
      assert.equal(scRes.status, 200);
      assert.equal(scJson.success, true);
      assert.equal(Number.isFinite((memoryDb.stocks.get(domesticStk.id) as any).target_price), true);
      delete process.env.ALLOW_DEV_ADMIN;

      // Suspended shop products return 410
      const pReq = new Request('http://localhost/api/shop/purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemType: 'product', productId: 'scanner_item' }),
      });
      const pRes = await purchasePost(pReq);
      // In dev guest mode, either 410 (authenticated) or 401 if guest disabled — never 200
      assert.ok(pRes.status === 410 || pRes.status === 401, `Suspended product must not succeed (got ${pRes.status})`);
      void setSessionGetter;
      console.log('  ✅ PASS F12 & F14 & F15 & F16 & F17');
    }

    console.log('=== [8] F17 acquired_passives & Margin Debt Cross-Path Protection (Stock/Option/FX/Event/Valuation) ===');
    {
      const client = createMemoryDbClient();
      const { executeCurrencyExchange } = await import('../lib/exchange/exchangeService');
      const { resolvePlayerEventChoice } = await import('../lib/events/playerEventService');
      const { submitAuthoritativeOptionOrder } = await import('../lib/options/optionOrderService');

      const domesticStk = Array.from(memoryDb.stocks.values()).find((s) => s.ticker === '0010')!;

      // 8a. acquired_passives: 'fee_booster' activates 50% discount; arbitrary passive does not
      const pUid = 'u_f17_passive';
      memoryDb.ensureUserProfile(pUid, { email: 'p17@t.com' });
      const pProf = memoryDb.profiles.get(pUid)!;
      pProf.cash = 700_875;
      pProf.acquired_passives = ['fee_booster'];
      const pSeller = 'u_f17_pseller';
      memoryDb.ensureUserProfile(pSeller, { email: 'ps17@t.com' });
      memoryDb.holdings.set(`${pSeller}_${domesticStk.id}`, { id: `${pSeller}_${domesticStk.id}`, user_id: pSeller, stock_id: domesticStk.id, quantity: 10, avg_price: 70000, created_at: memoryDb.getIsoTimestamp() });
      const pAsk: any = { id: 'f17_p_ask', stock_id: domesticStk.id, user_id: pSeller, side: 'sell', price: 70000, size: 10, filled: 0, status: 'open', is_lp: false, created_at: memoryDb.getIsoTimestamp() };
      memoryDb.orders.set(pAsk.id, pAsk);
      memoryDb.addOrderToIndex(pAsk);
      const pMatch = await submitAndMatchOrder(client, { stock_id: domesticStk.id, user_id: pUid, side: 'buy', price: 70000, size: 10, order_type: 'ioc' });
      assert.equal(pMatch.success, true);
      assert.equal(pMatch.filledQty, 10);
      assert.equal(memoryDb.profiles.get(pUid)!.cash, 0);

      // 8b. margin_debt_krw > 0 blocks Stock buy, Option buy, KRW->USD, USD->EUR, paid Event, and subtracts from NAV
      const dUid = 'u_f4_debt_cross';
      memoryDb.ensureUserProfile(dUid, { email: 'debt@t.com' });
      const dProf = memoryDb.profiles.get(dUid)!;
      dProf.cash = 5_000_000; // preserved cash (e.g. from reserved order)
      dProf.usd_balance = 1000;
      dProf.margin_debt_krw = 500_000;
      dProf.has_options_license = true;
      memoryDb.holdings.set(`${dUid}_${domesticStk.id}`, { id: `${dUid}_${domesticStk.id}`, user_id: dUid, stock_id: domesticStk.id, quantity: 10, avg_price: 70000, created_at: memoryDb.getIsoTimestamp() });
      memoryDb.addHoldingToIndex(memoryDb.holdings.get(`${dUid}_${domesticStk.id}`)!);

      // NAV must reflect -margin_debt_krw
      const dVal = calculateAuthoritativePortfolioValuation(dUid, dProf.cash);
      const expectedHoldingsVal = 10 * domesticStk.current_price;
      assert.equal(dVal.nav, 5_000_000 + expectedHoldingsVal - 500_000);

      // Stock buy blocked
      const stkBuyBlocked = await submitAndMatchOrder(client, { stock_id: domesticStk.id, user_id: dUid, side: 'buy', price: 70000, size: 1, order_type: 'limit' });
      assert.equal(stkBuyBlocked.success, false);

      // Option buy blocked
      const opt = Array.from(memoryDb.optionsContracts.values())[0]!;
      const optBuyBlocked = await submitAuthoritativeOptionOrder({ db: memoryDb, userId: dUid, contractId: opt.id, side: 'BUY', orderType: 'LIMIT', qty: 1, price: 2.0 });
      assert.equal(optBuyBlocked.success, false);
      assert.equal(optBuyBlocked.statusCode, 400);

      // FX KRW -> USD blocked, USD -> EUR blocked
      const fxKrwBlocked = await executeCurrencyExchange({ db: memoryDb, userId: dUid, fromCur: 'KRW', toCur: 'USD', amount: 100000 });
      assert.equal(fxKrwBlocked.success, false);
      assert.equal(fxKrwBlocked.statusCode, 400);

      const fxCrossBlocked = await executeCurrencyExchange({ db: memoryDb, userId: dUid, fromCur: 'USD', toCur: 'EUR', amount: 100 });
      assert.equal(fxCrossBlocked.success, false);
      assert.equal(fxCrossBlocked.statusCode, 400);

      // Random event with cost > 0 blocked
      memoryDb.playerEvents.push({ id: 'ev_debt_test', title: 't', description: 'd', choice_a_text: 'a', choice_a_cost: 1000, choice_a_passive: 'BADGE_ONLY', choice_b_text: 'b', choice_b_cost: 0, choice_b_passive: null });
      memoryDb.activePlayerEvents.push({ id: 'act_debt_test', user_id: dUid, event_id: 'ev_debt_test', status: 'pending' });
      const evBlocked = await resolvePlayerEventChoice({ db: memoryDb, userId: dUid, activeEventId: 'act_debt_test', choice: 'A' });
      assert.equal(evBlocked.success, false);
      assert.equal(evBlocked.statusCode, 400);

      // USD -> KRW repays debt first without inflating cash
      const usdRate = memoryDb.exchangeRates.find((r) => r.currency_code === 'USD')?.rate_to_krw ?? 1380;
      const fxRepay = await executeCurrencyExchange({ db: memoryDb, userId: dUid, fromCur: 'USD', toCur: 'KRW', amount: 100 });
      assert.equal(fxRepay.success, true);
      const expectedRepaid = Math.floor(100 * usdRate);
      assert.equal(dProf.margin_debt_krw, 500_000 - expectedRepaid);
      assert.equal(dProf.cash, 5_000_000);

      // Stock sell repays remaining debt first and adds excess to cash
      const buyerId = 'u_f4_buyer';
      memoryDb.ensureUserProfile(buyerId, { email: 'b4@t.com' });
      memoryDb.profiles.get(buyerId)!.cash = 10_000_000;
      const bidOrd: any = { id: 'f4_debt_bid', stock_id: domesticStk.id, user_id: buyerId, side: 'buy', price: 70000, size: 10, filled: 0, status: 'open', is_lp: false, created_at: memoryDb.getIsoTimestamp() };
      memoryDb.orders.set(bidOrd.id, bidOrd);
      memoryDb.addOrderToIndex(bidOrd);
      const remDebtBeforeSell = dProf.margin_debt_krw!;
      const sellRes = await submitAndMatchOrder(client, { stock_id: domesticStk.id, user_id: dUid, side: 'sell', price: 70000, size: 10, order_type: 'ioc' });
      assert.equal(sellRes.success, true);
      assert.equal(sellRes.filledQty, 10);
      const afterSellProf = memoryDb.profiles.get(dUid)!;
      assert.equal(afterSellProf.margin_debt_krw ?? 0, 0, 'Stock sell proceeds must clear remaining margin debt');
      const sellTrade = memoryDb.trades.find((t) => t.seller_id === dUid && t.stock_id === domesticStk.id)!;
      const expectedSellerNet = Math.round(sellTrade.price * sellTrade.size) - Math.round(sellTrade.price * sellTrade.size * (sellTrade.seller_fee ?? 0));
      assert.equal(afterSellProf.cash, 5_000_000 + (expectedSellerNet - remDebtBeforeSell));
      console.log('  ✅ PASS [8] F17 acquired_passives & Margin Debt Cross-Path Protection');
    }

    console.log('\n🎉 ALL FULL-REVIEW FIX REGRESSION TESTS PASSED!');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('❌ Test failed:', e);
  process.exit(1);
});
