import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stocksys-ar-20261120-'));
process.env.STOCKSYS_DATA_DIR = tempDir;

async function main() {
  try {
    const { MemoryDatabase, GUEST_USER_ID, SequentialIdGenerator } = await import('../lib/memoryDb/memoryStore');
    const { createInMemoryRepositoryBundle } = await import('../lib/repositories/inMemory');
    const { StaticTimeSource } = await import('../lib/engine/simulation/runtime/simulationTimeSource');
    const { createSimulationContext } = await import('../lib/engine/simulation/runtime/simulationContext');
    const { MarketEngine } = await import('../engine-server/src/MarketEngine');
    const { LocalMarketEngineInstance, stopLocalStandaloneEngine } = await import('../lib/engine/localStandaloneServer');
    const { LocalMarketService } = await import('../lib/engine/marketService');
    const { withAccountLocks } = await import('../lib/memoryDb/accountLocks');
    const { persistenceManager } = await import('../lib/memoryDb/PersistenceManager');
    const { submitAuthoritativeOptionOrder, getOptionAccountSummary } = await import('../lib/options/optionOrderService');
    const { getAvailableCashKrw } = await import('../lib/engine/orderRisk');
    const { CommodityMarketEngine } = await import('../lib/commodities/CommodityMarketEngine');
    const { reserveMarginAndSubmitCommodityOrder } = await import('../lib/commodities/commodityLedger');
    const { COMMODITY_DEFINITIONS } = await import('../lib/commodities/definitions');
    const { syncScenarioManagerFromDatabase, ScenarioManager } = await import('../lib/scenario/ScenarioManager');

    // ───────────────────────────────────────────────────────────────────────────
    // AR-01: 독립 엔진(MarketEngine)의 거래 동결 준수 + 의무 정산 유지 + 주입 저장소 격리
    // ───────────────────────────────────────────────────────────────────────────
    console.log('▶ [AR-01] MarketEngine trading_halt enforcement inside commit gate & mandatory settlement');
    {
      // 전역 singleton memoryDb는 동결 해제 상태여도, 주입된 db의 trading_halt=true를 따라야 한다.
      const { memoryDb: globalDb } = await import('../lib/memoryDb/memoryStore');
      globalDb.resetToSeedData();
      globalDb.adminSettings.set('1', { id: 1, base_rate: 0.025, market_sentiment: 'NEUTRAL', trading_halt: false });

      const baseNow = Date.parse('2026-06-01T10:00:00Z');
      const simNow = baseNow;
      const clock = { now: () => simNow };
      const simCtx = createSimulationContext({ seed: 101, clock });
      const db = new MemoryDatabase({ clock, idGenerator: new SequentialIdGenerator(101) });
      db.adminSettings.set('1', { id: 1, base_rate: 0.025, market_sentiment: 'NEUTRAL', trading_halt: true });

      const stock = Array.from(db.stocks.values()).find((s) => s.ticker === '005930')!;
      const buyer = 'ar01_buyer';
      const seller = 'ar01_seller';
      db.ensureUserProfile(buyer, { email: 'ar01b@test.local' });
      db.ensureUserProfile(seller, { email: 'ar01s@test.local' });
      db.profiles.get(buyer)!.cash = 10_000_000;
      db.profiles.get(seller)!.cash = 1_000_000;
      const sellerHolding = {
        id: `${seller}_${stock.id}`,
        user_id: seller,
        stock_id: stock.id,
        quantity: 100,
        avg_price: stock.current_price,
        created_at: db.getIsoTimestamp(),
      };
      db.holdings.set(sellerHolding.id, sellerHolding);
      db.addHoldingToIndex(sellerHolding);

      const buyOrd: any = {
        id: 'ar01_buy_1',
        stock_id: stock.id,
        user_id: buyer,
        side: 'buy',
        price: stock.current_price,
        size: 1,
        filled: 0,
        status: 'open',
        is_lp: false,
        created_at: new Date(baseNow - 2000).toISOString(),
        version: 1,
      };
      const sellOrd: any = {
        id: 'ar01_sell_1',
        stock_id: stock.id,
        user_id: seller,
        side: 'sell',
        price: stock.current_price,
        size: 1,
        filled: 0,
        status: 'open',
        is_lp: false,
        created_at: new Date(baseNow - 1000).toISOString(),
        version: 1,
      };
      db.orders.set(buyOrd.id, buyOrd);
      db.addOrderToIndex(buyOrd);
      db.orders.set(sellOrd.id, sellOrd);
      db.addOrderToIndex(sellOrd);

      const fixedDataSource = {
        fetchRealWorldData: async () => null,
        fetchMarketState: async () => ({
          stocks: Array.from(db.stocks.values()),
          bonds: [],
          commodities: [],
          options_contracts: [],
          adminBaseRate: 0.025,
          sentiment: 'NEUTRAL',
        }),
      };

      const persistCalls: number[] = [];
      const engine = new MarketEngine({
        simulationContext: simCtx,
        repositories: createInMemoryRepositoryBundle(db),
        marketDataSource: fixedDataSource,
        onTickCommitPersist: async ({ tickCount }) => {
          persistCalls.push(tickCount);
          return true;
        },
      });

      const tradesBefore = db.trades.length;
      const buyerCashBefore = db.profiles.get(buyer)!.cash;
      const sellerCashBefore = db.profiles.get(seller)!.cash;

      // 1) trading_halt=true 상태에서 tick() -> 체결 0, 현금/보유/filled 불변
      const haltedTick = await engine.tick();
      assert.equal(haltedTick.success, true);
      assert.equal(haltedTick.commitStatus, 'NOT_COMMITTED');
      assert.equal(db.trades.length, tradesBefore, 'No trades may execute while trading_halt=true');
      assert.equal(db.profiles.get(buyer)!.cash, buyerCashBefore, 'Buyer cash must remain unchanged');
      assert.equal(db.profiles.get(seller)!.cash, sellerCashBefore, 'Seller cash must remain unchanged');
      assert.equal(db.holdings.get(`${buyer}_${stock.id}`), undefined, 'Buyer must not receive shares while halted');
      assert.equal(db.holdings.get(`${seller}_${stock.id}`)!.quantity, 100, 'Seller shares must remain 100');
      assert.equal(db.orders.get(buyOrd.id)!.filled, 0);
      assert.equal(db.orders.get(sellOrd.id)!.filled, 0);
      assert.equal(db.orders.get(buyOrd.id)!.status, 'open');

      // 2) 동결 중에도 50번째 틱 만기 정산 의무는 정상 유지됨을 확인
      const opt = Array.from(db.optionsContracts.values())[0]!;
      opt.asset_class = 'IDX';
      opt.type = 'CALL';
      opt.option_type = 'CALL';
      opt.strike_price = 200;
      opt.multiplier = 250000;
      opt.expiry_date = new Date(baseNow - 10_000).toISOString();
      const optH = {
        id: `${buyer}_${opt.id}`,
        user_id: buyer,
        stock_id: opt.id,
        quantity: 1,
        avg_price: 5,
        created_at: db.getIsoTimestamp(),
      };
      db.holdings.set(optH.id, optH);
      db.addHoldingToIndex(optH);

      for (let t = 2; t <= 49; t++) {
        const res = await engine.tick();
        assert.equal(res.commitStatus, t % 20 === 0 ? 'COMMITTED' : 'NOT_COMMITTED');
      }
      assert.equal(db.holdings.has(optH.id), true, 'Option must not settle before tick 50');

      const haltedTick50 = await engine.tick();
      assert.equal(haltedTick50.success, true);
      assert.equal(haltedTick50.commitStatus, 'COMMITTED', 'Mandatory expiry settlement at tick 50 must commit even during trading halt');
      assert.equal(db.holdings.has(optH.id), false, 'Expired option holding must settle at tick 50 during halt');
      assert.ok(db.profiles.get(buyer)!.cash > buyerCashBefore, 'Option payout must credit during halt');
      assert.equal(db.trades.length, tradesBefore, 'Equity orders must STILL not execute while halted');

      // 3) 동결 해제 후 정상 체결 확인
      const buyerCashAfterOpt = db.profiles.get(buyer)!.cash;
      db.adminSettings.get('1')!.trading_halt = false;
      const resumedTick = await engine.tick();
      assert.equal(resumedTick.success, true);
      assert.equal(resumedTick.commitStatus, 'COMMITTED');
      assert.equal(db.trades.length, tradesBefore + 1, 'Resting matching orders must execute once halt is lifted');
      assert.equal(db.holdings.get(`${buyer}_${stock.id}`)?.quantity, 1);
      assert.equal(db.holdings.get(`${seller}_${stock.id}`)?.quantity, 99);
      assert.equal(db.orders.get(buyOrd.id)?.status, 'filled');
      assert.equal(db.orders.get(sellOrd.id)?.status, 'filled');
      assert.ok(db.profiles.get(buyer)!.cash < buyerCashAfterOpt);
      assert.ok(persistCalls.includes(50));
    }
    console.log('  ✅ PASS [AR-01]');

    // ───────────────────────────────────────────────────────────────────────────
    // AR-02: 잠금 대기 중 거래 동결 확정 시 주식·옵션·원자재 주문 거절 & 선행 커밋 보존
    // ───────────────────────────────────────────────────────────────────────────
    console.log('▶ [AR-02] Re-check trading_halt inside commit gate after lock contention (stock/option/commodity)');
    {
      const { memoryDb } = await import('../lib/memoryDb/memoryStore');
      memoryDb.resetToSeedData();
      process.env.ALLOW_DEV_ADMIN = 'true';
      const { POST: adminPost } = await import('../app/api/admin/scenarios/route');

      const userId = GUEST_USER_ID;
      const profile = memoryDb.profiles.get(userId)!;
      profile.cash = 100_000_000;
      profile.has_options_license = true;

      const stock = Array.from(memoryDb.stocks.values()).find((s) => s.ticker === '005930')!;
      const opt = Array.from(memoryDb.optionsContracts.values())[0]!;
      opt.expiry_date = new Date(memoryDb.getNowMs() + 86_400_000).toISOString();
      opt.current_price = 5.0;
      opt.multiplier = 250000;
      const gold = COMMODITY_DEFINITIONS.find((c) => c.id === 'GOLD')!;

      const setHalt = async (tradingHalt: boolean) => {
        const res = await adminPost(new Request('http://localhost/api/admin/scenarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'set_trading_halt', tradingHalt }),
        }));
        assert.equal(res.status, 200);
      };

      // 1) 주식 경로: 동결 전 선행 주문 1건 확정 후, 계좌 락 대기 중 동결
      await setHalt(false);
      const preStockOrder = await LocalMarketService.submitOrder({
        userId,
        stockId: stock.id,
        side: 'buy',
        price: Math.max(1000, stock.current_price - 5000),
        size: 1,
      });
      assert.equal(preStockOrder.success, true, preStockOrder.message);
      const preOrderId = preStockOrder.orderId!;

      let releaseBarrier1!: () => void;
      let notifyBarrier1Entered!: () => void;
      const barrier1Entered = new Promise<void>((r) => { notifyBarrier1Entered = r; });
      const barrier1 = new Promise<void>((r) => { releaseBarrier1 = r; });

      const holder1 = withAccountLocks([userId], async () => {
        notifyBarrier1Entered();
        await barrier1;
      });
      await barrier1Entered;

      const queuedStockOrderPromise = LocalMarketService.submitOrder({
        userId,
        stockId: stock.id,
        side: 'buy',
        price: Math.max(1000, stock.current_price - 6000),
        size: 1,
      });

      // 잠금 대기 중 관리자가 거래 동결 확정
      await setHalt(true);
      const ordersBeforeRelease1 = memoryDb.orders.size;
      const cashBeforeRelease1 = profile.cash;
      releaseBarrier1();

      const [_, queuedStockRes] = await Promise.all([holder1, queuedStockOrderPromise]);
      assert.equal(queuedStockRes.success, false, 'Queued stock order must be rejected after halt commits');
      assert.match(queuedStockRes.message, /거래 동결|서킷브레이커/);
      assert.equal(memoryDb.orders.size, ordersBeforeRelease1, 'No new stock order may be persisted');
      assert.equal(memoryDb.orders.has(preOrderId), true, 'Pre-halt committed stock order must NOT be rolled back');
      assert.equal(profile.cash, cashBeforeRelease1);

      // 2) 옵션 경로: 동결 전 선행 주문 확정 후, 계좌 락 대기 중 동결
      await setHalt(false);
      const preOptRes = await submitAuthoritativeOptionOrder({
        db: memoryDb,
        userId,
        contractId: opt.id,
        side: 'BUY',
        orderType: 'LIMIT',
        price: 0.01,
        qty: 1,
      });
      assert.equal(preOptRes.success, true, preOptRes.message);
      const preOptOrderId = preOptRes.order!.orderId;
      const reservedAfterPreOpt = getAvailableCashKrw(memoryDb, userId).reservedCash;

      let releaseBarrier2!: () => void;
      let notifyBarrier2Entered!: () => void;
      const barrier2Entered = new Promise<void>((r) => { notifyBarrier2Entered = r; });
      const barrier2 = new Promise<void>((r) => { releaseBarrier2 = r; });

      const holder2 = withAccountLocks([userId], async () => {
        notifyBarrier2Entered();
        await barrier2;
      });
      await barrier2Entered;

      const queuedOptOrderPromise = submitAuthoritativeOptionOrder({
        db: memoryDb,
        userId,
        contractId: opt.id,
        side: 'BUY',
        orderType: 'LIMIT',
        price: 0.02,
        qty: 1,
      });

      await setHalt(true);
      const ordersBeforeRelease2 = memoryDb.orders.size;
      const cashBeforeRelease2 = profile.cash;
      releaseBarrier2();

      const [__, queuedOptRes] = await Promise.all([holder2, queuedOptOrderPromise]);
      assert.equal(queuedOptRes.success, false, 'Queued option order must be rejected after halt commits');
      assert.equal(queuedOptRes.statusCode, 403);
      assert.equal(memoryDb.orders.size, ordersBeforeRelease2, 'No new option order may be persisted');
      assert.equal(memoryDb.orders.has(preOptOrderId), true, 'Pre-halt option order must remain intact');
      assert.equal(getAvailableCashKrw(memoryDb, userId).reservedCash, reservedAfterPreOpt);
      assert.equal(profile.cash, cashBeforeRelease2);

      // 3) 원자재 경로: tickLock barrier 대기 중 동결 확정 + 선행 주문 보존
      await setHalt(false);
      const commEngine = new CommodityMarketEngine({ db: memoryDb, totalBots: 4 });
      const preCommRes = await reserveMarginAndSubmitCommodityOrder({
        db: memoryDb,
        commodity: gold,
        userId,
        side: 'buy',
        type: 'limit',
        price: 2300,
        size: 1,
        submitToEngine: () =>
          commEngine.submitUserOrder({
            commodityId: gold.id,
            userId,
            side: 'buy',
            type: 'limit',
            price: 2300,
            size: 1,
          }),
        rollbackFromEngine: (oid) => { commEngine.removeUserOrder(gold.id, oid); },
        runWithEngineLock: (fn) => commEngine.runWithTickLock(fn),
      });
      assert.equal(preCommRes.success, true, preCommRes.message);
      const preCommOrderId = preCommRes.order!.id;
      const cashAfterPreComm = profile.cash;
      const resCountAfterPreComm = memoryDb.commodityMarginReservations.size;
      const openCommAfterPreComm = memoryDb.commodityOpenOrders.size;

      let releaseBarrier3!: () => void;
      let notifyBarrier3Entered!: () => void;
      const barrier3Entered = new Promise<void>((r) => { notifyBarrier3Entered = r; });
      const barrier3 = new Promise<void>((r) => { releaseBarrier3 = r; });

      const holder3 = commEngine.runWithTickLock(async () => {
        notifyBarrier3Entered();
        await barrier3;
      });
      await barrier3Entered;

      const queuedCommOrderPromise = reserveMarginAndSubmitCommodityOrder({
        db: memoryDb,
        commodity: gold,
        userId,
        side: 'buy',
        type: 'limit',
        price: 2305,
        size: 1,
        submitToEngine: () =>
          commEngine.submitUserOrder({
            commodityId: gold.id,
            userId,
            side: 'buy',
            type: 'limit',
            price: 2305,
            size: 1,
          }),
        rollbackFromEngine: (oid) => { commEngine.removeUserOrder(gold.id, oid); },
        runWithEngineLock: (fn) => commEngine.runWithTickLock(fn),
      });

      await setHalt(true);
      releaseBarrier3();

      const [___, queuedCommRes] = await Promise.all([holder3, queuedCommOrderPromise]);
      assert.equal(queuedCommRes.success, false, 'Queued commodity order must be rejected after halt commits');
      assert.equal(queuedCommRes.statusCode, 403);
      assert.equal(profile.cash, cashAfterPreComm, 'Cash must not be deducted for halted commodity order');
      assert.equal(memoryDb.commodityMarginReservations.size, resCountAfterPreComm);
      assert.equal(memoryDb.commodityOpenOrders.size, openCommAfterPreComm);
      assert.equal(memoryDb.commodityOpenOrders.has(preCommOrderId), true, 'Pre-halt commodity order must remain intact');

      // 3b) 원자재 계좌 락(withAccountLocks) 대기 중 동결 확정 시에도 거절 & 불변
      await setHalt(false);
      let releaseBarrier3b!: () => void;
      let notifyBarrier3bEntered!: () => void;
      const barrier3bEntered = new Promise<void>((r) => { notifyBarrier3bEntered = r; });
      const barrier3b = new Promise<void>((r) => { releaseBarrier3b = r; });
      const holder3b = withAccountLocks([userId], async () => {
        notifyBarrier3bEntered();
        await barrier3b;
      });
      await barrier3bEntered;
      const queuedCommAccPromise = reserveMarginAndSubmitCommodityOrder({
        db: memoryDb,
        commodity: gold,
        userId,
        side: 'buy',
        type: 'limit',
        price: 2306,
        size: 1,
        submitToEngine: () =>
          commEngine.submitUserOrder({
            commodityId: gold.id,
            userId,
            side: 'buy',
            type: 'limit',
            price: 2306,
            size: 1,
          }),
        rollbackFromEngine: (oid) => { commEngine.removeUserOrder(gold.id, oid); },
        runWithEngineLock: (fn) => commEngine.runWithTickLock(fn),
      });
      await setHalt(true);
      releaseBarrier3b();
      const [____, queuedCommAccRes] = await Promise.all([holder3b, queuedCommAccPromise]);
      assert.equal(queuedCommAccRes.success, false);
      assert.equal(queuedCommAccRes.statusCode, 403);
      assert.equal(profile.cash, cashAfterPreComm);
      assert.equal(memoryDb.commodityMarginReservations.size, resCountAfterPreComm);

      await setHalt(false);
      stopLocalStandaloneEngine();
      delete process.env.ALLOW_DEV_ADMIN;
    }
    console.log('  ✅ PASS [AR-02]');

    // ───────────────────────────────────────────────────────────────────────────
    // AR-03: 시나리오 진행 상태 일관성 (주식/원자재 교차, 관리자 GET/POST, 완료 재활성화 방지, 롤백)
    // ───────────────────────────────────────────────────────────────────────────
    console.log('▶ [AR-03] Scenario progress consistency across standalone, commodity engine, admin API & rollback');
    {
      const { memoryDb } = await import('../lib/memoryDb/memoryStore');
      memoryDb.resetToSeedData();
      process.env.ALLOW_DEV_ADMIN = 'true';
      const { GET: adminGet, POST: adminPost } = await import('../app/api/admin/scenarios/route');
      const { commodityEngineInstance } = await import('../lib/commodities/commodityEngineInstance');

      const stock = Array.from(memoryDb.stocks.values())[0]!;

      // 1) 10틱 stock 시나리오 주입
      const injStockRes = await adminPost(new Request('http://localhost/api/admin/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'inject_scenario',
          assetType: 'stock',
          assetId: stock.id,
          ticker: stock.ticker,
          name: stock.name,
          mode: 'pump',
          durationTicks: 10,
          targetChangePct: 40,
          volumeMultiplier: 3,
        }),
      }));
      assert.equal(injStockRes.status, 200);
      const stockScenarioId = (await injStockRes.json()).scenario.id as string;

      // Standalone 인스턴스에서 거래 스텝만 no-op으로 두고 실제 tick() 3회 진행
      const standalone = new LocalMarketEngineInstance();
      standalone.__getAgentManagerForTesting().step = async () => {};
      standalone.setOnPersist(() => persistenceManager.saveSnapshot(memoryDb));
      for (let i = 0; i < 3; i++) {
        await standalone.tick();
      }

      const dbScenAfter3 = new Map<string, any>(memoryDb.scenarioRuntimeState.activeScenarios).get(stockScenarioId);
      assert.equal(dbScenAfter3?.remainingTicks, 7, 'DB remainingTicks must be 7 after 3 stock ticks');

      const getAfter3 = await (await adminGet(new Request('http://localhost/api/admin/scenarios'))).json();
      const apiScenAfter3 = getAfter3.activeScenarios.find((s: any) => s.id === stockScenarioId);
      assert.equal(apiScenAfter3?.remainingTicks, 7, 'Admin GET must observe remainingTicks=7');

      // 2) 다른 시나리오(commodity 12틱) 추가 후에도 기존 stock 시나리오 remainingTicks=7 보존
      const injCommRes = await adminPost(new Request('http://localhost/api/admin/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'inject_scenario',
          assetType: 'commodity',
          assetId: 'GOLD',
          ticker: 'GC',
          name: 'Gold',
          mode: 'pump',
          durationTicks: 12,
          targetChangePct: 30,
          volumeMultiplier: 3,
        }),
      }));
      assert.equal(injCommRes.status, 200);
      const commScenarioId = (await injCommRes.json()).scenario.id as string;

      const dbScenAfterNew = new Map<string, any>(memoryDb.scenarioRuntimeState.activeScenarios).get(stockScenarioId);
      assert.equal(dbScenAfterNew?.remainingTicks, 7, 'Injecting another scenario must not revert stock remainingTicks');
      const getAfterNew = await (await adminGet(new Request('http://localhost/api/admin/scenarios'))).json();
      assert.equal(getAfterNew.activeScenarios.find((s: any) => s.id === stockScenarioId)?.remainingTicks, 7);
      assert.equal(getAfterNew.activeScenarios.find((s: any) => s.id === commScenarioId)?.remainingTicks, 12);

      // 3) stock tick과 commodity tick(stepTickAsync) 번갈아 실행 -> 양쪽 진행도 보존
      await standalone.tick(); // stock: 6, comm: 12
      await commodityEngineInstance.stepTickAsync(); // stock: 6, comm: 11
      await standalone.tick(); // stock: 5, comm: 11
      await commodityEngineInstance.stepTickAsync(); // stock: 5, comm: 10
      await commodityEngineInstance.stepTickAsync(); // stock: 5, comm: 9

      const getAfterAlt = await (await adminGet(new Request('http://localhost/api/admin/scenarios'))).json();
      assert.equal(getAfterAlt.activeScenarios.find((s: any) => s.id === stockScenarioId)?.remainingTicks, 5);
      assert.equal(getAfterAlt.activeScenarios.find((s: any) => s.id === commScenarioId)?.remainingTicks, 9);

      // 4) 완료한 시나리오가 새 주입/조회/스냅샷 복원 후 재활성화되지 않음 검증
      for (let i = 0; i < 5; i++) {
        await standalone.tick();
      }
      const getAfterComplete = await (await adminGet(new Request('http://localhost/api/admin/scenarios'))).json();
      assert.equal(
        getAfterComplete.activeScenarios.some((s: any) => s.id === stockScenarioId),
        false,
        'Completed stock scenario must not remain active in admin GET'
      );

      // 새 시나리오 주입 후에도 완료된 stock 시나리오 재활성화 금지
      const injSecondStock = await adminPost(new Request('http://localhost/api/admin/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'inject_scenario',
          assetType: 'stock',
          assetId: stock.id,
          ticker: stock.ticker,
          name: stock.name,
          mode: 'dump',
          durationTicks: 10,
          targetChangePct: -20,
          volumeMultiplier: 2,
        }),
      }));
      assert.equal(injSecondStock.status, 200);
      const secondStockId = (await injSecondStock.json()).scenario.id as string;

      const getAfterSecondInj = await (await adminGet(new Request('http://localhost/api/admin/scenarios'))).json();
      assert.equal(getAfterSecondInj.activeScenarios.some((s: any) => s.id === stockScenarioId), false);
      assert.equal(getAfterSecondInj.activeScenarios.find((s: any) => s.id === secondStockId)?.remainingTicks, 10);
      assert.equal(getAfterSecondInj.activeScenarios.find((s: any) => s.id === commScenarioId)?.remainingTicks, 9);

      // 스냅샷 저장 및 신규 MemoryDatabase 복원 후에도 완료 시나리오 부활 없음 검증
      const savedOk = await persistenceManager.saveSnapshot(memoryDb);
      assert.equal(savedOk, true);
      const reloadedDb = new MemoryDatabase();
      const loaded = await persistenceManager.loadSnapshot(reloadedDb);
      assert.equal(loaded, true);
      const syncedMgr = new ScenarioManager();
      syncScenarioManagerFromDatabase(reloadedDb, syncedMgr, { clearOnDbNull: true });
      const reloadedIds = syncedMgr.getActiveScenarios().map((s) => s.id);
      assert.equal(reloadedIds.includes(stockScenarioId), false, 'Completed scenario must not resurrect on snapshot load');
      assert.equal(reloadedIds.includes(secondStockId), true);
      assert.equal(reloadedIds.includes(commScenarioId), true);

      // 5) 영속 실패 시 원본 상태 보존 (Standalone / Commodity / Admin POST)
      const secondBeforeFail = new Map<string, any>(memoryDb.scenarioRuntimeState.activeScenarios).get(secondStockId).remainingTicks;
      standalone.setOnPersist(async () => false);
      await standalone.tick();
      assert.equal(standalone.lastPersistOk, false);
      assert.equal(
        new Map<string, any>(memoryDb.scenarioRuntimeState.activeScenarios).get(secondStockId).remainingTicks,
        secondBeforeFail,
        'Standalone stock scenario remainingTicks must roll back when persist fails'
      );

      // Commodity tick persist fail rollback
      const commBeforeFail = new Map<string, any>(memoryDb.scenarioRuntimeState.activeScenarios).get(commScenarioId).remainingTicks;
      const commFailEngine = new CommodityMarketEngine({
        db: memoryDb,
        totalBots: 4,
        onPersist: async () => false,
      });
      await assert.rejects(() => commFailEngine.stepTickAsync(), /영속 저장에 실패/);
      assert.equal(
        new Map<string, any>(memoryDb.scenarioRuntimeState.activeScenarios).get(commScenarioId).remainingTicks,
        commBeforeFail,
        'Commodity scenario remainingTicks must roll back when persist fails'
      );

      // Admin POST persist fail rollback (adapter error injection)
      const activeCountBeforeFail = memoryDb.scenarioRuntimeState.activeScenarios.length;
      const origAdapter = (persistenceManager as any).adapter;
      (persistenceManager as any).adapter = {
        ...origAdapter,
        saveSnapshot: async () => false,
      };
      try {
        const failAdminRes = await adminPost(new Request('http://localhost/api/admin/scenarios', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'inject_scenario',
            assetType: 'stock',
            assetId: stock.id,
            ticker: stock.ticker,
            name: stock.name,
            mode: 'pump',
            durationTicks: 15,
            targetChangePct: 25,
            volumeMultiplier: 2,
          }),
        }));
        assert.equal(failAdminRes.status, 500);
        assert.equal(memoryDb.scenarioRuntimeState.activeScenarios.length, activeCountBeforeFail);
      } finally {
        (persistenceManager as any).adapter = origAdapter;
      }

      // 6) 거시경제 충격(macro shock) + rollback_scenario + emergency_halt 후 진행도 일관성 확인
      const macroRes = await adminPost(new Request('http://localhost/api/admin/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger_macro_shock', shockType: 'RATE_HIKE_SHOCK' }),
      }));
      assert.equal(macroRes.status, 200);
      const getAfterMacro = await (await adminGet(new Request('http://localhost/api/admin/scenarios'))).json();
      assert.equal(getAfterMacro.activeMacroShocks.length, 1);
      assert.equal(getAfterMacro.activeScenarios.find((s: any) => s.id === secondStockId)?.remainingTicks, secondBeforeFail);

      const rbRes = await adminPost(new Request('http://localhost/api/admin/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rollback_scenario', scenarioId: secondStockId }),
      }));
      assert.equal(rbRes.status, 200);
      assert.equal((await rbRes.json()).success, true);
      const getAfterRb = await (await adminGet(new Request('http://localhost/api/admin/scenarios'))).json();
      assert.equal(getAfterRb.activeScenarios.some((s: any) => s.id === secondStockId), false);
      assert.equal(getAfterRb.activeScenarios.find((s: any) => s.id === commScenarioId)?.remainingTicks, commBeforeFail);

      const haltAllRes = await adminPost(new Request('http://localhost/api/admin/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'emergency_halt' }),
      }));
      assert.equal(haltAllRes.status, 200);
      const getAfterHaltAll = await (await adminGet(new Request('http://localhost/api/admin/scenarios'))).json();
      assert.equal(getAfterHaltAll.activeScenarios.length, 0);
      assert.equal(getAfterHaltAll.activeMacroShocks.length, 0);
      assert.equal(memoryDb.scenarioRuntimeState.activeScenarios.length, 0);

      stopLocalStandaloneEngine();
      delete process.env.ALLOW_DEV_ADMIN;
    }
    console.log('  ✅ PASS [AR-03]');

    // ───────────────────────────────────────────────────────────────────────────
    // AR-04: 옵션 만기 미체결 주문 및 예약금 해제 (Standalone 50틱 & MarketEngine 50틱)
    // ───────────────────────────────────────────────────────────────────────────
    console.log('▶ [AR-04] Expired option open/partial order expiry & reservation release (Standalone & MarketEngine)');
    {
      // Part A: Standalone 50틱 경로
      const { memoryDb } = await import('../lib/memoryDb/memoryStore');
      memoryDb.resetToSeedData();

      const engine = new LocalMarketEngineInstance();
      engine.__getAgentManagerForTesting().step = async () => {};
      let allowPersist = true;
      engine.setOnPersist(async () => allowPersist);

      const nowMs = memoryDb.getNowMs();
      const opt = Array.from(memoryDb.optionsContracts.values())[0]!;
      opt.asset_class = 'IDX';
      opt.type = 'CALL';
      opt.option_type = 'CALL';
      opt.strike_price = 300; // KOSPI200(~260) 대비 OTM (지급액 0 -> 이중 현금 환급 여부 정밀 검증 가능)
      opt.current_price = 1.0; // lpBid=0.98, lpAsk=1.00 -> 0.99 매도/매수 부분체결 및 0.01 매수 미체결 테스트
      opt.multiplier = 250000;
      opt.expiry_date = new Date(nowMs + 3_600_000).toISOString();

      const uHolder = 'ar04_holder';
      const uOrderOnly = 'ar04_order_only';
      const uPartialAndSell = 'ar04_partial_sell';
      const uCounterSeller = 'ar04_counter_seller';
      for (const uid of [uHolder, uOrderOnly, uPartialAndSell, uCounterSeller]) {
        memoryDb.ensureUserProfile(uid, { email: `${uid}@test.local` });
        const p = memoryDb.profiles.get(uid)!;
        p.cash = 10_000_000;
        p.has_options_license = true;
      }

      // 1) uHolder: 지정가 매수 0.01 x 250000 1계약 open 접수 (예약금 2503) + 보유 1계약
      const holderOrderRes = await submitAuthoritativeOptionOrder({
        db: memoryDb,
        userId: uHolder,
        contractId: opt.id,
        side: 'BUY',
        orderType: 'LIMIT',
        price: 0.01,
        qty: 1,
        nowMs,
      });
      assert.equal(holderOrderRes.success, true, holderOrderRes.message);
      assert.equal(holderOrderRes.order!.status, 'open');
      assert.equal(getAvailableCashKrw(memoryDb, uHolder).reservedCash, 2503);

      const h1 = {
        id: `${uHolder}_${opt.id}`,
        user_id: uHolder,
        stock_id: opt.id,
        quantity: 1,
        avg_price: 5,
        created_at: memoryDb.getIsoTimestamp(),
      };
      memoryDb.holdings.set(h1.id, h1);
      memoryDb.addHoldingToIndex(h1);

      // 2) uOrderOnly: 보유 전혀 없는 미체결-only 계좌 (예약금 2503)
      const orderOnlyRes = await submitAuthoritativeOptionOrder({
        db: memoryDb,
        userId: uOrderOnly,
        contractId: opt.id,
        side: 'BUY',
        orderType: 'LIMIT',
        price: 0.01,
        qty: 1,
        nowMs,
      });
      assert.equal(orderOnlyRes.success, true, orderOnlyRes.message);
      assert.equal(getAvailableCashKrw(memoryDb, uOrderOnly).reservedCash, 2503);

      // 3) uPartialAndSell: partial 매수(3계약 주문 중 1계약 체결, 2계약 잔여) + open 매도(1계약)
      const hSeller = {
        id: `${uCounterSeller}_${opt.id}`,
        user_id: uCounterSeller,
        stock_id: opt.id,
        quantity: 1,
        avg_price: 0.99,
        created_at: memoryDb.getIsoTimestamp(),
      };
      memoryDb.holdings.set(hSeller.id, hSeller);
      memoryDb.addHoldingToIndex(hSeller);

      const restingSellRes = await submitAuthoritativeOptionOrder({
        db: memoryDb,
        userId: uCounterSeller,
        contractId: opt.id,
        side: 'SELL',
        orderType: 'LIMIT',
        price: 0.99,
        qty: 1,
        nowMs,
      });
      assert.equal(restingSellRes.success, true);
      assert.equal(restingSellRes.order!.status, 'open');

      const partialBuyRes = await submitAuthoritativeOptionOrder({
        db: memoryDb,
        userId: uPartialAndSell,
        contractId: opt.id,
        side: 'BUY',
        orderType: 'LIMIT',
        price: 0.99,
        qty: 3,
        nowMs,
      });
      assert.equal(partialBuyRes.success, true, partialBuyRes.message);
      assert.equal(partialBuyRes.order!.status, 'partial');
      assert.equal(partialBuyRes.order!.filledQty, 1);
      assert.equal(partialBuyRes.order!.remainingQty, 2);

      // uPartialAndSell의 보유 1계약에 대한 높은 가격 미체결 매도 주문 (LP bid ~4.9보다 비싼 10.0)
      const openSellRes = await submitAuthoritativeOptionOrder({
        db: memoryDb,
        userId: uPartialAndSell,
        contractId: opt.id,
        side: 'SELL',
        orderType: 'LIMIT',
        price: 10.0,
        qty: 1,
        nowMs,
      });
      assert.equal(openSellRes.success, true, openSellRes.message);
      assert.equal(openSellRes.order!.status, 'open');

      // 만기 도래
      opt.expiry_date = new Date(nowMs - 10_000).toISOString();

      const holderCashBefore = memoryDb.profiles.get(uHolder)!.cash;
      const orderOnlyCashBefore = memoryDb.profiles.get(uOrderOnly)!.cash;
      const partialSellCashBefore = memoryDb.profiles.get(uPartialAndSell)!.cash;

      for (let t = 1; t <= 49; t++) {
        await engine.tick();
      }
      assert.equal(memoryDb.holdings.has(h1.id), true);
      assert.equal(getAvailableCashKrw(memoryDb, uHolder).reservedCash, 2503);

      // 50번째 틱: 영속 실패 -> 모든 보유/주문/예약금/현금/정산장부 롤백
      allowPersist = false;
      await engine.tick(); // tick 50
      assert.equal(engine.lastPersistOk, false);
      assert.equal(memoryDb.holdings.has(h1.id), true, 'Holding must roll back on persist failure');
      assert.equal(memoryDb.orders.get(holderOrderRes.order!.orderId)!.status, 'open');
      assert.equal(memoryDb.orders.get(orderOnlyRes.order!.orderId)!.status, 'open');
      assert.equal(memoryDb.orders.get(partialBuyRes.order!.orderId)!.status, 'partial');
      assert.equal(memoryDb.orders.get(openSellRes.order!.orderId)!.status, 'open');
      assert.equal(getAvailableCashKrw(memoryDb, uHolder).reservedCash, 2503);
      assert.equal(getAvailableCashKrw(memoryDb, uOrderOnly).reservedCash, 2503);

      // 재시도 (100번째 틱, allowPersist = true) -> holding 제거 + 주문 expired + 예약금 0 + 이중 환급 없음
      allowPersist = true;
      for (let t = 51; t <= 100; t++) {
        await engine.tick();
      }

      assert.equal(memoryDb.holdings.has(h1.id), false, 'Expired option holding must be removed');
      assert.equal(memoryDb.orders.get(holderOrderRes.order!.orderId)!.status, 'expired');
      assert.equal(memoryDb.orders.get(orderOnlyRes.order!.orderId)!.status, 'expired');
      assert.equal(memoryDb.orders.get(partialBuyRes.order!.orderId)!.status, 'expired');
      assert.equal(memoryDb.orders.get(openSellRes.order!.orderId)!.status, 'expired');

      // 수량/버전/인덱스 정합 검증
      const expiredPartialOrd = memoryDb.orders.get(partialBuyRes.order!.orderId)!;
      assert.equal(expiredPartialOrd.size, 3);
      assert.equal(expiredPartialOrd.filled, 1);
      assert.ok((expiredPartialOrd.version ?? 1) >= 2, 'Expired order version must increment');
      assert.equal(memoryDb.orderStockIndex.get(opt.id)?.has(expiredPartialOrd.id), true);
      assert.equal(memoryDb.orderUserIndex.get(uPartialAndSell)?.has(expiredPartialOrd.id), true);

      // 예약금 2503 -> 0 & 미체결 요약 비어 있음
      assert.equal(getAvailableCashKrw(memoryDb, uHolder).reservedCash, 0);
      assert.equal(getAvailableCashKrw(memoryDb, uOrderOnly).reservedCash, 0);
      assert.equal(getAvailableCashKrw(memoryDb, uPartialAndSell).reservedCash, 0);
      assert.equal(getOptionAccountSummary(memoryDb, uHolder).unfilled.length, 0);
      assert.equal(getOptionAccountSummary(memoryDb, uOrderOnly).unfilled.length, 0);
      assert.equal(getOptionAccountSummary(memoryDb, uPartialAndSell).unfilled.length, 0);

      // 동적 예약이므로 현금 이중 환급 없음 (OTM이므로 변동 0)
      assert.equal(memoryDb.profiles.get(uHolder)!.cash, holderCashBefore);
      assert.equal(memoryDb.profiles.get(uOrderOnly)!.cash, orderOnlyCashBefore);
      assert.equal(memoryDb.profiles.get(uPartialAndSell)!.cash, partialSellCashBefore);

      // Part B: MarketEngine 50틱 경로
      const baseNow = Date.parse('2026-06-01T10:00:00Z');
      const clockB = new StaticTimeSource(baseNow);
      const simCtxB = createSimulationContext({ seed: 202, clock: clockB });
      const dbB = new MemoryDatabase({ clock: clockB, idGenerator: new SequentialIdGenerator(202) });
      const optB = Array.from(dbB.optionsContracts.values())[0]!;
      optB.asset_class = 'IDX';
      optB.type = 'CALL';
      optB.option_type = 'CALL';
      optB.strike_price = 300;
      optB.current_price = 5;
      optB.multiplier = 250000;
      optB.expiry_date = new Date(baseNow + 3_600_000).toISOString();

      const meUser1 = 'ar04_me_holder';
      const meUser2 = 'ar04_me_order_only';
      for (const uid of [meUser1, meUser2]) {
        dbB.ensureUserProfile(uid, { email: `${uid}@test.local` });
        dbB.profiles.get(uid)!.cash = 10_000_000;
        dbB.profiles.get(uid)!.has_options_license = true;
      }

      const meOrd1 = await submitAuthoritativeOptionOrder({
        db: dbB,
        userId: meUser1,
        contractId: optB.id,
        side: 'BUY',
        orderType: 'LIMIT',
        price: 0.01,
        qty: 1,
        nowMs: baseNow,
      });
      const meOrd2 = await submitAuthoritativeOptionOrder({
        db: dbB,
        userId: meUser2,
        contractId: optB.id,
        side: 'BUY',
        orderType: 'LIMIT',
        price: 0.01,
        qty: 1,
        nowMs: baseNow,
      });
      assert.equal(meOrd1.success, true);
      assert.equal(meOrd2.success, true);
      assert.equal(getAvailableCashKrw(dbB, meUser1).reservedCash, 2503);
      assert.equal(getAvailableCashKrw(dbB, meUser2).reservedCash, 2503);

      const meHolding = {
        id: `${meUser1}_${optB.id}`,
        user_id: meUser1,
        stock_id: optB.id,
        quantity: 1,
        avg_price: 5,
        created_at: dbB.getIsoTimestamp(),
      };
      dbB.holdings.set(meHolding.id, meHolding);
      dbB.addHoldingToIndex(meHolding);

      optB.expiry_date = new Date(baseNow - 10_000).toISOString();
      const meUser1CashBefore = dbB.profiles.get(meUser1)!.cash;
      const meUser2CashBefore = dbB.profiles.get(meUser2)!.cash;

      let allowMePersist = true;
      const meEngine = new MarketEngine({
        simulationContext: simCtxB,
        repositories: createInMemoryRepositoryBundle(dbB),
        marketDataSource: {
          fetchRealWorldData: async () => null,
          fetchMarketState: async () => ({
            stocks: Array.from(dbB.stocks.values()),
            bonds: [],
            commodities: [],
            options_contracts: Array.from(dbB.optionsContracts.values()),
            adminBaseRate: 0.025,
            sentiment: 'NEUTRAL',
          }),
        },
        onTickCommitPersist: async () => allowMePersist,
      });

      for (let t = 1; t <= 49; t++) {
        await meEngine.tick();
      }
      assert.equal(dbB.holdings.has(meHolding.id), true);

      // Tick 50 persist fail -> full rollback
      allowMePersist = false;
      const failMeTick = await meEngine.tick();
      assert.equal(failMeTick.success, false);
      assert.equal(failMeTick.commitStatus, 'NOT_COMMITTED');
      assert.equal(dbB.holdings.has(meHolding.id), true);
      assert.equal(dbB.orders.get(meOrd1.order!.orderId)!.status, 'open');
      assert.equal(dbB.orders.get(meOrd2.order!.orderId)!.status, 'open');
      assert.equal(getAvailableCashKrw(dbB, meUser1).reservedCash, 2503);
      assert.equal(getAvailableCashKrw(dbB, meUser2).reservedCash, 2503);

      // Note: MarketEngine.tick() rolled back tickCount from 50 -> 49 on persist fail, so next tick() is tick 50 retry!
      allowMePersist = true;
      const okMeTick = await meEngine.tick();
      assert.equal(okMeTick.success, true);
      assert.equal(okMeTick.commitStatus, 'COMMITTED');
      assert.equal(dbB.holdings.has(meHolding.id), false);
      assert.equal(dbB.orders.get(meOrd1.order!.orderId)!.status, 'expired');
      assert.equal(dbB.orders.get(meOrd2.order!.orderId)!.status, 'expired');
      assert.equal(getAvailableCashKrw(dbB, meUser1).reservedCash, 0);
      assert.equal(getAvailableCashKrw(dbB, meUser2).reservedCash, 0);
      assert.equal(dbB.profiles.get(meUser1)!.cash, meUser1CashBefore);
      assert.equal(dbB.profiles.get(meUser2)!.cash, meUser2CashBefore);
    }
    console.log('  ✅ PASS [AR-04]');

    console.log('\n🎉 ALL AR-01 ~ AR-04 POST-FIX REGRESSION TESTS PASSED!');
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('❌ Post-fix review AR-01~04 regression test failed:', err);
  process.exit(1);
});
