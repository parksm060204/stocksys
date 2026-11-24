import { CommodityMarketEngine } from '@/lib/commodities/CommodityMarketEngine';
import { memoryDb } from '@/lib/memoryDb/memoryStore';
import { ensureLocalStandaloneReady, persistConfirmedState } from '@/lib/engine/localStandaloneServer';
import { runWithCommitGate, persistenceManager } from '@/lib/memoryDb/PersistenceManager';
import { syncScenarioManagerFromDatabase } from '@/lib/scenario/ScenarioManager';

// 글로벌 싱글톤 인스턴스 (Next.js HMR 안전)
const globalForCommodities = globalThis as unknown as {
  commodityEngine?: CommodityMarketEngine;
};

export const commodityEngineInstance: CommodityMarketEngine =
  globalForCommodities.commodityEngine ||
  new CommodityMarketEngine({
    totalBots: 50,
    eventProbability: 0.02,
    db: memoryDb,
  });

commodityEngineInstance.attachDatabase(memoryDb);

if (!globalForCommodities.commodityEngine) {
  globalForCommodities.commodityEngine = commodityEngineInstance;
}

export async function ensureCommodityEngineReady(): Promise<void> {
  await ensureLocalStandaloneReady();
  await commodityEngineInstance.reconcileWithDatabase(memoryDb);
  await commodityEngineInstance.runWithTickLock(() => runWithCommitGate(
    undefined,
    async () => {
      try {
        syncScenarioManagerFromDatabase(memoryDb, commodityEngineInstance.scenarioManager, {
          clearOnDbNull: true,
        });
      } catch { /* ignore invalid snapshot */ }
    },
    persistenceManager
  ));
  commodityEngineInstance.start(1500, persistConfirmedState);
}
