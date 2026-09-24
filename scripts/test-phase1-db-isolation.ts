/**
 * Phase 1 Test: MarketEngine RepositoryBundle Isolation (authoritative single data layer)
 *
 * Verifies via ACTUAL READ/WRITE RESULTS (not private field comparison):
 *  1. Engine A and Engine B use distinct repository bundles and never cross-contaminate.
 *  2. A's orders/trades/settlements are invisible to B (and vice versa).
 *  3. Within one engine, market repository and settlement repository observe the SAME state.
 *  4. An order written through the repository is readable by SettlementBatchService.
 *  5. No hidden second MemoryDatabase is created by the engine.
 */

import { MarketEngine } from '../engine-server/src/MarketEngine';
import { MemoryDatabase } from '../lib/memoryDb/memoryStore';
import { createInMemoryRepositoryBundle } from '../lib/repositories/inMemory';
import { createSimulationContext, StaticTimeSource } from '../lib/engine/simulation/runtime';
import type { RepositoryBundle } from '../lib/repositories/repositoryBundle';
import type { TradeSettlementInput } from '../lib/repositories/types';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`[DB Isolation Test Failure] ${msg}`);
  }
}

const NOW = 1773500000000;

async function runTest() {
  console.log('--- Testing MarketEngine RepositoryBundle Isolation ---');

  // 1. Two distinct MemoryDatabase-backed bundles
  const dbA = new MemoryDatabase();
  const dbB = new MemoryDatabase();
  const bundleA: RepositoryBundle = createInMemoryRepositoryBundle(dbA);
  const bundleB: RepositoryBundle = createInMemoryRepositoryBundle(dbB);

  const contextA = createSimulationContext({ seed: 100, clock: new StaticTimeSource(NOW) });
  const contextB = createSimulationContext({ seed: 200, clock: new StaticTimeSource(NOW) });

  const engineA = new MarketEngine({ simulationContext: contextA, repositories: bundleA });
  const engineB = new MarketEngine({ simulationContext: contextB, repositories: bundleB });

  // 2. Read/write proof: A sees only A's stock
  await bundleA.market.upsertStocks([{ id: 'STOCK_A_01', name: 'Alpha', current_price: 50000 } as never]);
  await bundleB.market.upsertStocks([{ id: 'STOCK_B_01', name: 'Beta', current_price: 75000 } as never]);

  const aStock = await bundleA.market.getStockById('STOCK_A_01');
  assert(aStock !== null, 'Engine A market repository must see STOCK_A_01 it wrote');
  const bSeesA = await bundleB.market.getStockById('STOCK_A_01');
  assert(bSeesA === null, 'Engine B must NOT see STOCK_A_01 (A data must not leak into B)');
  const aSeesB = await bundleA.market.getStockById('STOCK_B_01');
  assert(aSeesB === null, 'Engine A must NOT see STOCK_B_01 (B data must not leak into A)');
  const bStock = await bundleB.market.getStockById('STOCK_B_01');
  assert(bStock !== null, 'Engine B market repository must see STOCK_B_01 it wrote');

  // 3. Within one engine, market repository and settlement repository share the SAME state
  await bundleA.market.insertOrders([
    { id: 'ORD_BUY', stock_id: 'STOCK_A_01', user_id: 'buyer', side: 'buy', price: 50000, size: 10, filled: 0, status: 'open', is_lp: false, created_at: new Date(NOW).toISOString() } as never,
    { id: 'ORD_SELL', stock_id: 'STOCK_A_01', user_id: 'seller', side: 'sell', price: 50000, size: 10, filled: 0, status: 'open', is_lp: false, created_at: new Date(NOW).toISOString() } as never,
  ]);
  // SettlementBatchService shares the bundle — it reads orders written via the market repository.
  const svcOrders = await engineA.settlementService.getRepositories().market.getOpenOrders('STOCK_A_01');
  assert(svcOrders.length === 2, 'SettlementBatchService (same bundle) must read the 2 orders written via market repository');

  // 4. Settlement is visible to the market repository of the SAME engine (shared authoritative ledger)
  const buyerId = 'buyer';
  const sellerId = 'seller';
  dbA.profiles.set(buyerId, { id: buyerId, user_id: buyerId, username: 'B', nickname: 'B', cash: 10_000_000, net_worth: 10_000_000, rank_tier: 'BRONZE', created_at: new Date(NOW).toISOString() });
  dbA.profiles.set(sellerId, { id: sellerId, user_id: sellerId, username: 'S', nickname: 'S', cash: 0, net_worth: 0, rank_tier: 'BRONZE', created_at: new Date(NOW).toISOString() });
  dbA.profileUserIdIndex.set(buyerId, buyerId);
  dbA.profileUserIdIndex.set(sellerId, sellerId);
  dbA.holdings.set(`${sellerId}_STOCK_A_01`, { id: `${sellerId}_STOCK_A_01`, user_id: sellerId, stock_id: 'STOCK_A_01', quantity: 100, avg_price: 50000, created_at: new Date(NOW).toISOString() });

  const tradeInput: TradeSettlementInput = {
    id: 'trade_iso_1', stock_id: 'STOCK_A_01', buy_order_id: 'ORD_BUY', sell_order_id: 'ORD_SELL',
    buyer_id: buyerId, seller_id: sellerId, buyer_is_bot: false, seller_is_bot: false,
    price: 50000, size: 5, fee_rates: { buyerFeeRate: 0.001, sellerFeeRate: -0.001 },
    simulation_time: NOW, sequence: 1,
  };
  const settlement = await bundleA.settlement.settleTradeBatchAtomically([tradeInput]);
  assert(settlement.success === true, 'Engine A settlement must succeed');
  const tradesInA = await bundleA.market.getRecentTrades('STOCK_A_01');
  assert(tradesInA.length === 1, 'Trade written by A settlement must be visible via A market repository (single state)');
  const tradesInB = await bundleB.market.getRecentTrades('STOCK_A_01');
  assert(tradesInB.length === 0, 'Engine B must NOT see A settlement trade');

  // 5. No hidden second MemoryDatabase: engine only holds the injected bundle's DB.
  //    Proof: data written via the injected bundle's DB is visible to the engine's repositories.
  const engineAStockCount = (await engineA.getRepositories().market.getStocks()).length;
  const rawDbACount = dbA.stocks.size;
  assert(engineAStockCount === rawDbACount, 'Engine A repositories must read the SAME MemoryDatabase that was injected (no hidden second DB)');
  const engineBStockCount = (await engineB.getRepositories().market.getStocks()).length;
  assert(engineBStockCount === dbB.stocks.size, 'Engine B repositories must read the SAME MemoryDatabase that was injected (no hidden second DB)');

  // 6. Order is stored but not visible across engines
  const ordInA = await bundleA.market.getOrderById('ORD_BUY');
  const ordInB = await bundleB.market.getOrderById('ORD_BUY');
  assert(ordInA !== null, 'Engine A must see its own order');
  assert(ordInB === null, 'Engine B must NOT see Engine A order');

  console.log('✅ DB Isolation Test Passed: bundle isolation proven via actual read/write results, single authoritative DB confirmed.');
}

runTest().catch((err) => {
  console.error(err);
  process.exit(1);
});
