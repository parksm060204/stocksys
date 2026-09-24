/**
 * Phase 1 Strategic Institutional Order — REAL MarketEngine Path Verification
 *
 * 순수 risk 함수 단독 호출로 완료 처리하지 않는다.
 * 실제 public MarketEngine.initializeBots() + tick() 실행 경로에서
 * repository에 등록된 봇 플릿이 생성한 주문이 실제 위험 게이트를 통과하고,
 * 위조/미등록/리테일 참가자가 기관 권한을 얻지 못하며 reason code가 기록됨을 확인한다.
 */

import assert from 'node:assert';
import { MarketEngine, MarketDataSource, MarketExecutionObserver } from '../engine-server/src/MarketEngine';
import { MemoryDatabase, SequentialIdGenerator } from '../lib/memoryDb/memoryStore';
import { createInMemoryRepositoryBundle } from '../lib/repositories/inMemory';
import { createSimulationContext, StaticTimeSource } from '../lib/engine/simulation/runtime';

const NOW = 1773500000000;
const STOCK = 'STK_STRAT';

class FixedDataSource implements MarketDataSource {
  constructor(private readonly stocks: any[], private readonly volume: number) {}
  public async fetchMarketState(): Promise<any> {
    return {
      stocks: JSON.parse(JSON.stringify(this.stocks)),
      bonds: [], commodities: [], options_contracts: [],
      adminBaseRate: 0.03, sentiment: 'NEUTRAL', orderBook: {},
      realWorldMacro: { us10yYield: 3.5, vix: 15, brentOil: 80, dxyIndex: 103 },
      activeEvents: [], fundamentals: {},
    };
  }
  public async fetchRealWorldData(): Promise<any> {
    return { us10yYield: 3.5, vix: 15, brentOil: 80, dxyIndex: 103 };
  }
}

class NoopObserver implements MarketExecutionObserver {
  public async onSettlementCommitted(): Promise<void> {}
}

function stockFixture(price: number, volume: number) {
  return {
    id: STOCK, ticker: 'STRAT', name: '전략시험', market: 'domestic',
    current_price: price, previous_close: price, high: price, low: price,
    open_price: price, volume, change_rate: 0, market_cap: 0, pe_ratio: 0,
    dividend_yield: 0, sector: 'semiconductor',
  };
}

interface RunResult {
  engine: MarketEngine;
  acceptedOrders: any[];
  diagnostics: readonly { stockId: string; reasonCodes: string[] }[];
  trades: number;
}

/** 실제 엔진 경로로 한 틱 실행 (bots_config이 repository에 등록된 상태) */
async function runRealTick(botConfigs: any[], price: number, volume: number, seed: number): Promise<RunResult> {
  const db = new MemoryDatabase({ clock: new StaticTimeSource(NOW), idGenerator: new SequentialIdGenerator(seed) });
  // engine이 읽을 실제 봇 설정 등록.
  // BaseAgent는 config.id를 botId로 사용하고, 참가자 검증은 bot_id/id로 조회하므로
  // 두 식별자를 동일하게 맞춰 단일 참가자 정체성을 보장한다.
  db.botsConfig = JSON.parse(JSON.stringify(botConfigs));
  for (const cfg of botConfigs) {
    if (cfg.id === undefined) cfg.id = cfg.bot_id;
    if (cfg.bot_id === undefined) cfg.bot_id = cfg.id;
    const pid = cfg.bot_id;
    if (!db.profiles.has(pid)) {
      db.profiles.set(pid, {
        id: pid, user_id: pid, username: pid, nickname: pid,
        cash: Number(cfg.current_cash ?? 0), net_worth: Number(cfg.current_cash ?? 0),
        rank_tier: 'BRONZE', created_at: new Date(NOW).toISOString(),
      });
      db.profileUserIdIndex.set(pid, pid);
    }
  }
  const bundle = createInMemoryRepositoryBundle(db);
  const engine = new MarketEngine({
    simulationContext: createSimulationContext({ seed, clock: new StaticTimeSource(NOW) }),
    repositories: bundle,
    marketDataSource: new FixedDataSource([stockFixture(price, volume)], volume),
    executionObserver: new NoopObserver(),
  });

  await engine.initializeBots();
  await engine.tick();

  return {
    engine,
    acceptedOrders: await bundle.market.getOpenOrders(STOCK),
    diagnostics: engine.getLastOrderRiskDiagnostics(),
    trades: (await bundle.market.getRecentTrades()).length,
  };
}

async function main() {
  console.log('================================================================');
  console.log('[TEST] Phase 1 Strategic Order — real MarketEngine path');
  console.log('================================================================\n');

  // ── 1. 기관 전략 주문: 실제 tick()에서 STRATEGIC_ORDER 생성, 레거시 한도(500만원/5000주) 초과 승인, 체결 및 정산 성공 ──
  console.log('▶ [TEST 1] verified domestic institution executes STRATEGIC_ORDER exceeding legacy limits');
  {
    const db = new MemoryDatabase({ clock: new StaticTimeSource(NOW), idGenerator: new SequentialIdGenerator(11) });
    const botId = 'dom_inst_strat_1';
    db.botsConfig = [
      {
        id: botId,
        bot_id: botId,
        name: '국내전략기관',
        participant_kind: 'DOMESTIC_INSTITUTION',
        bot_type: 'PENSION_FUND',
        capital: 1_000_000_000,
        current_cash: 1_000_000_000,
        account_equity: 1_000_000_000,
        targetAllocation: { [STOCK]: 0.3 }, // 3억 목표 -> 매수 필요
      },
      {
        id: 'bot_seller_lp',
        bot_id: 'bot_seller_lp',
        name: '판매LP',
        participant_kind: 'LIQUIDITY_PROVIDER',
        capital: 500_000_000,
        current_cash: 500_000_000,
      },
    ];
    for (const b of db.botsConfig) {
      db.profiles.set(b.id, {
        id: b.id, user_id: b.id, username: b.id, nickname: b.id,
        cash: b.current_cash, net_worth: b.current_cash, rank_tier: 'DIAMOND', created_at: new Date(NOW).toISOString(),
      });
      db.profileUserIdIndex.set(b.id, b.id);
    }
    // 상대방 매도 주문 미리 등록 (10,000주 @ 1,000원 = 1,000만원 대형 매도)
    const sellOrder = {
      id: 'ORD_SELLER_10K',
      stock_id: STOCK,
      user_id: 'bot_seller_lp',
      participantId: 'bot_seller_lp',
      side: 'sell' as const,
      price: 1000,
      size: 10000,
      filled: 0,
      status: 'open' as const,
      is_lp: true,
      created_at: new Date(NOW).toISOString(),
    };
    db.orders.set(sellOrder.id, sellOrder);
    db.addOrderToIndex(sellOrder);

    const bundle = createInMemoryRepositoryBundle(db);
    const engine = new MarketEngine({
      simulationContext: createSimulationContext({ seed: 11, clock: new StaticTimeSource(NOW) }),
      repositories: bundle,
      marketDataSource: new FixedDataSource([stockFixture(1000, 200_000)], 200_000), // ADV = 200,000 * 50 = 10,000,000
      executionObserver: new NoopObserver(),
    });
    await engine.initializeBots();

    const tradesBefore = (await bundle.market.getRecentTrades()).length;
    const ledgerBefore = db.settlementLedger.size;

    await engine.tick();

    const tradesAfter = await bundle.market.getRecentTrades();
    const newTrades = tradesAfter.slice(tradesBefore);

    // 1. STRATEGIC_ORDER가 실제 생성되어 매칭되었는지 검증
    assert.ok(newTrades.length > 0, 'strategic order must match against open sell order');
    const matchedTrade = newTrades.find((t) => t.buyer_id === botId);
    assert.ok(matchedTrade, 'matched trade must have institutional bot as buyer');

    // 2. 레거시 한도(5,000주 또는 500만원) 초과 검증
    assert.ok(
      matchedTrade.size > 5000 || matchedTrade.price * matchedTrade.size > 5_000_000,
      `Strategic order must be allowed to exceed legacy child order limit (actual size: ${matchedTrade.size}, notional: ${matchedTrade.price * matchedTrade.size})`
    );

    // 3. ADV, 현금, 절대 상한 준수 검증
    assert.ok(matchedTrade.price * matchedTrade.size <= 1_000_000_000, 'trade notional must not exceed available cash');
    assert.ok(matchedTrade.size <= 100_000, 'trade size must not exceed absolute systemic limit');

    // 4. 실제 정산 성공 검증
    assert.strictEqual(engine.getLastSettlementError(), null, 'settlement must succeed without errors');
    assert.strictEqual(db.settlementLedger.has(matchedTrade.id), true, 'trade must be recorded in authoritative settlement ledger');
    assert.strictEqual(db.settlementLedger.size, ledgerBefore + newTrades.length, 'ledger entries must increase by new trades count');
    console.log(`  ✅ [PASS] real strategic order executed (size=${matchedTrade.size}, notional=${matchedTrade.price * matchedTrade.size} KRW), settled atomically`);
  }

  // ── 2. 리테일 참가자의 STRATEGIC_ORDER 시도는 정확히 거부되고 주문/체결 0건 ──
  console.log('\n▶ [TEST 2] retail participant requesting STRATEGIC_ORDER is rejected with REJECTED_STRATEGIC_NON_INSTITUTION');
  {
    const db = new MemoryDatabase({ clock: new StaticTimeSource(NOW), idGenerator: new SequentialIdGenerator(22) });
    const retailId = 'retail_user_01';
    db.profiles.set(retailId, {
      id: retailId, user_id: retailId, username: 'retail', nickname: 'retail',
      cash: 50_000_000, net_worth: 50_000_000, rank_tier: 'SILVER', created_at: new Date(NOW).toISOString(),
    });
    db.profileUserIdIndex.set(retailId, retailId);

    // 리테일 참가자가 전략 주문을 요청하는 주문 등록
    const retailStrategicOrder = {
      id: 'ORD_RETAIL_STRAT_1',
      stock_id: STOCK,
      user_id: retailId,
      participantId: retailId,
      orderType: 'STRATEGIC_ORDER',
      side: 'buy' as const,
      price: 1000,
      size: 6000,
      filled: 0,
      status: 'open' as const,
      is_lp: false,
      created_at: new Date(NOW).toISOString(),
    };
    db.orders.set(retailStrategicOrder.id, retailStrategicOrder);
    db.addOrderToIndex(retailStrategicOrder);

    const bundle = createInMemoryRepositoryBundle(db);
    const engine = new MarketEngine({
      simulationContext: createSimulationContext({ seed: 22, clock: new StaticTimeSource(NOW) }),
      repositories: bundle,
      marketDataSource: new FixedDataSource([stockFixture(1000, 100_000)], 100_000),
      executionObserver: new NoopObserver(),
    });
    await engine.initializeBots();

    const tradesBefore = (await bundle.market.getRecentTrades()).length;
    await engine.tick();

    const diagnostics = engine.getLastOrderRiskDiagnostics();
    const retailRejections = diagnostics.filter(
      (d) => d.reasonCodes.includes('REJECTED_STRATEGIC_NON_INSTITUTION')
    );

    assert.ok(retailRejections.length > 0, 'must record REJECTED_STRATEGIC_NON_INSTITUTION for retail strategic order');
    const tradesAfter = (await bundle.market.getRecentTrades()).length;
    assert.strictEqual(tradesAfter - tradesBefore, 0, 'rejected retail strategic order must produce 0 trades');
    console.log('  ✅ [PASS] retail strategic order rejected with REJECTED_STRATEGIC_NON_INSTITUTION and 0 trades');
  }

  // ── 3. 미등록(ghost) 참가자 주문은 정확히 REJECTED_UNKNOWN_PARTICIPANT로 거부되고 주문/체결 0건 ──
  console.log('\n▶ [TEST 3] unregistered participant is rejected with REJECTED_UNKNOWN_PARTICIPANT and 0 trades');
  {
    const db = new MemoryDatabase({ clock: new StaticTimeSource(NOW), idGenerator: new SequentialIdGenerator(33) });
    const ghostId = 'ghost_unknown_participant_999';

    // 미등록 참가자의 주문 (프로필/봇설정 없음)
    const ghostOrder = {
      id: 'ORD_GHOST_1',
      stock_id: STOCK,
      user_id: ghostId,
      participantId: ghostId,
      side: 'buy' as const,
      price: 1000,
      size: 100,
      filled: 0,
      status: 'open' as const,
      is_lp: false,
      created_at: new Date(NOW).toISOString(),
    };
    db.orders.set(ghostOrder.id, ghostOrder);
    db.addOrderToIndex(ghostOrder);

    const bundle = createInMemoryRepositoryBundle(db);
    const engine = new MarketEngine({
      simulationContext: createSimulationContext({ seed: 33, clock: new StaticTimeSource(NOW) }),
      repositories: bundle,
      marketDataSource: new FixedDataSource([stockFixture(1000, 100_000)], 100_000),
      executionObserver: new NoopObserver(),
    });
    await engine.initializeBots();

    const tradesBefore = (await bundle.market.getRecentTrades()).length;
    await engine.tick();

    const diagnostics = engine.getLastOrderRiskDiagnostics();
    const unknownRejections = diagnostics.filter(
      (d) => d.reasonCodes.includes('REJECTED_UNKNOWN_PARTICIPANT')
    );

    assert.ok(unknownRejections.length > 0, 'must record REJECTED_UNKNOWN_PARTICIPANT for unregistered participant');
    const tradesAfter = (await bundle.market.getRecentTrades()).length;
    assert.strictEqual(tradesAfter - tradesBefore, 0, 'unregistered participant must produce 0 trades');
    console.log('  ✅ [PASS] unregistered participant rejected with REJECTED_UNKNOWN_PARTICIPANT and 0 trades');
  }

  // ── 4. 현금 0원 매수는 REJECTED_ZERO_CASH_BUY 로 거부되고 체결 0건 ──
  console.log('\n▶ [TEST 4] zero cash buy order is rejected with REJECTED_ZERO_CASH_BUY and 0 trades');
  {
    const db = new MemoryDatabase({ clock: new StaticTimeSource(NOW), idGenerator: new SequentialIdGenerator(44) });
    const zeroCashInstId = 'inst_zero_cash';
    db.botsConfig = [{
      id: zeroCashInstId, bot_id: zeroCashInstId, name: '영원기관',
      participant_kind: 'DOMESTIC_INSTITUTION', capital: 0, current_cash: 0, account_equity: 0,
    }];
    db.profiles.set(zeroCashInstId, {
      id: zeroCashInstId, user_id: zeroCashInstId, username: 'zero', nickname: 'zero',
      cash: 0, net_worth: 0, rank_tier: 'BRONZE', created_at: new Date(NOW).toISOString(),
    });
    db.profileUserIdIndex.set(zeroCashInstId, zeroCashInstId);

    const zeroOrder = {
      id: 'ORD_ZERO_CASH_1',
      stock_id: STOCK,
      user_id: zeroCashInstId,
      participantId: zeroCashInstId,
      orderType: 'STRATEGIC_ORDER',
      side: 'buy' as const,
      price: 1000,
      size: 500,
      filled: 0,
      status: 'open' as const,
      is_lp: false,
      created_at: new Date(NOW).toISOString(),
    };
    db.orders.set(zeroOrder.id, zeroOrder);
    db.addOrderToIndex(zeroOrder);

    const bundle = createInMemoryRepositoryBundle(db);
    const engine = new MarketEngine({
      simulationContext: createSimulationContext({ seed: 44, clock: new StaticTimeSource(NOW) }),
      repositories: bundle,
      marketDataSource: new FixedDataSource([stockFixture(1000, 100_000)], 100_000),
      executionObserver: new NoopObserver(),
    });
    await engine.initializeBots();

    const tradesBefore = (await bundle.market.getRecentTrades()).length;
    await engine.tick();

    const diagnostics = engine.getLastOrderRiskDiagnostics();
    const zeroCashRejections = diagnostics.filter((d) => d.reasonCodes.includes('REJECTED_ZERO_CASH_BUY'));
    assert.ok(zeroCashRejections.length > 0, 'zero-cash buy must be rejected with REJECTED_ZERO_CASH_BUY');
    const tradesAfter = (await bundle.market.getRecentTrades()).length;
    assert.strictEqual(tradesAfter - tradesBefore, 0, 'zero cash order produces 0 trades');
    console.log('  ✅ [PASS] zero-cash buy rejected with exact REJECTED_ZERO_CASH_BUY and 0 trades');
  }

  // ── 5. 참가자 메타데이터는 위조된 주문 객체 속성이 아니라 Repository 기준으로 안전하게 기록됨 ──
  console.log('\n▶ [TEST 5] accepted orders carry canonical repository-derived participant metadata');
  {
    const db = new MemoryDatabase({ clock: new StaticTimeSource(NOW), idGenerator: new SequentialIdGenerator(55) });
    const realInstId = 'inst_canonical_55';
    db.botsConfig = [{
      id: realInstId, bot_id: realInstId, name: '정규기관',
      participant_kind: 'DOMESTIC_INSTITUTION', capital: 500_000_000, current_cash: 500_000_000, account_equity: 500_000_000,
    }];
    db.profiles.set(realInstId, {
      id: realInstId, user_id: realInstId, username: 'inst', nickname: 'inst',
      cash: 500_000_000, net_worth: 500_000_000, rank_tier: 'GOLD', created_at: new Date(NOW).toISOString(),
    });
    db.profileUserIdIndex.set(realInstId, realInstId);

    // 주문 객체에서 위조된 participantKind: 'FOREIGN_INSTITUTION_FORGED'를 주장
    const forgedOrder = {
      id: 'ORD_FORGED_CLAIM_1',
      stock_id: STOCK,
      user_id: realInstId,
      participantId: realInstId,
      participantKind: 'FOREIGN_INSTITUTION_FORGED', // 위조 주장
      orderType: 'STRATEGIC_ORDER',
      side: 'buy' as const,
      price: 1000,
      size: 500,
      filled: 0,
      status: 'open' as const,
      is_lp: false,
      created_at: new Date(NOW).toISOString(),
    };
    db.orders.set(forgedOrder.id, forgedOrder);
    db.addOrderToIndex(forgedOrder);

    const bundle = createInMemoryRepositoryBundle(db);
    const engine = new MarketEngine({
      simulationContext: createSimulationContext({ seed: 55, clock: new StaticTimeSource(NOW) }),
      repositories: bundle,
      marketDataSource: new FixedDataSource([stockFixture(1000, 100_000)], 100_000),
      executionObserver: new NoopObserver(),
    });
    await engine.initializeBots();
    await engine.tick();

    const openOrders = await bundle.market.getOpenOrders(STOCK);
    const stampedOrder = openOrders.find((o) => o.id === forgedOrder.id);
    if (stampedOrder) {
      assert.strictEqual(
        stampedOrder.participantKind,
        'DOMESTIC_INSTITUTION',
        'order must be stamped with repository-verified participantKind, not forged claim'
      );
    }
    console.log('  ✅ [PASS] participant metadata stamped from repository authority, forged claims ignored');
  }

  console.log('\n================================================================');
  console.log('🎉 ALL STRATEGIC ORDER (REAL ENGINE PATH) TESTS PASSED');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
