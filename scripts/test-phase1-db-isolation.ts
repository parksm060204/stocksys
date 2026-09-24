/**
 * Phase 1 Test: MarketEngine DB Dependency Instance Isolation
 *
 * Verifies that:
 * 1. Engine A and Engine B with distinct memory DBs never cross-contaminate data.
 * 2. Creating Engine B does not redirect or pollute Engine A's DB reference.
 * 3. SettlementBatchService on each engine strictly accesses its own assigned DB.
 * 4. Creation order independence: swapping initialization order yields identical isolated behavior.
 */

import { MarketEngine } from '../engine-server/src/MarketEngine';
import { createIsolatedMemoryDbClient } from '../lib/memoryDb/memoryDbClient';
import { createSimulationContext, StaticTimeSource } from '../lib/engine/simulation/runtime';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`[DB Isolation Test Failure] ${msg}`);
  }
}

async function runTest() {
  console.log('--- Testing MarketEngine DB Dependency Instance Isolation ---');

  // 1. Setup two completely separate isolated memory DB clients
  const dbA = createIsolatedMemoryDbClient();
  const dbB = createIsolatedMemoryDbClient();

  const contextA = createSimulationContext({ seed: 100, clock: new StaticTimeSource(100000) });
  const contextB = createSimulationContext({ seed: 200, clock: new StaticTimeSource(100000) });

  const engineA = new MarketEngine({
    simulationContext: contextA,
    databaseClient: dbA
  });

  const engineB = new MarketEngine({
    simulationContext: contextB,
    databaseClient: dbB
  });

  // Verify internal reference binding
  assert(engineA.getDbClient() === dbA, 'Engine A must hold dbA reference');
  assert(engineB.getDbClient() === dbB, 'Engine B must hold dbB reference');
  assert(engineA.getDbClient() !== engineB.getDbClient(), 'Engine A and B must not share the same DB client');

  // Verify SettlementBatchService DB reference
  assert(engineA.settlementService.getDbClient() === dbA, 'Engine A settlement service must use dbA');
  assert(engineB.settlementService.getDbClient() === dbB, 'Engine B settlement service must use dbB');

  // 2. Insert records into Engine A's DB and verify Engine B does not see them
  await dbA.from('stocks').insert([
    { id: 'STOCK_A_01', name: 'Alpha Corp', current_price: 50000, market: 'domestic' }
  ]);

  const { data: fetchFromA } = await engineA.getDbClient().from('stocks').select('*').eq('id', 'STOCK_A_01');
  assert(fetchFromA && fetchFromA.length === 1, 'Engine A must see STOCK_A_01');

  const { data: fetchFromB } = await engineB.getDbClient().from('stocks').select('*').eq('id', 'STOCK_A_01');
  assert(!fetchFromB || fetchFromB.length === 0, 'Engine B must NOT see STOCK_A_01');

  // 3. Insert records into Engine B's DB and verify Engine A does not see them
  await dbB.from('stocks').insert([
    { id: 'STOCK_B_01', name: 'Beta Ltd', current_price: 75000, market: 'domestic' }
  ]);

  const { data: checkBFromA } = await engineA.getDbClient().from('stocks').select('*').eq('id', 'STOCK_B_01');
  assert(!checkBFromA || checkBFromA.length === 0, 'Engine A must NOT see STOCK_B_01');

  const { data: checkBFromB } = await engineB.getDbClient().from('stocks').select('*').eq('id', 'STOCK_B_01');
  assert(checkBFromB && checkBFromB.length === 1, 'Engine B must see STOCK_B_01');

  // 4. Persistence adapter injection priority test
  const customAdapterDb = createIsolatedMemoryDbClient();
  const persistenceAdapter = {
    getClient: () => customAdapterDb,
    saveTrades: async () => {},
    savePriceHistory: async () => {},
    upsertPortfolios: async () => {},
  };

  const engineWithPersistence = new MarketEngine({
    simulationContext: contextA,
    persistence: persistenceAdapter
  });

  assert(engineWithPersistence.getDbClient() === customAdapterDb, 'Engine must use client from persistence adapter when no explicit client is passed');

  // 5. Creation order independence test (swapped order)
  const db1 = createIsolatedMemoryDbClient();
  const db2 = createIsolatedMemoryDbClient();

  const engine2 = new MarketEngine({ simulationContext: contextB, databaseClient: db2 });
  const engine1 = new MarketEngine({ simulationContext: contextA, databaseClient: db1 });

  await db1.from('orders').insert([{ id: 'ORD_1', stock_id: 'S1', side: 'buy', price: 100, size: 10, status: 'open' }]);
  const { data: ordCheck1 } = await engine1.getDbClient().from('orders').select('*').eq('id', 'ORD_1');
  const { data: ordCheck2 } = await engine2.getDbClient().from('orders').select('*').eq('id', 'ORD_1');

  assert(ordCheck1 && ordCheck1.length === 1, 'Swapped engine1 sees its order');
  assert(!ordCheck2 || ordCheck2.length === 0, 'Swapped engine2 must not see engine1 order');

  console.log('✅ DB Isolation Test Passed: Strict instance isolation and settlement service binding verified.');
}

runTest().catch(err => {
  console.error(err);
  process.exit(1);
});
