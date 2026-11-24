import './loadEnv';
import * as path from 'path';
import { MarketEngine } from './MarketEngine';
import { EventDirector } from './EventDirector';
import * as http from 'http';
import { MemoryDatabase } from '../../lib/memoryDb/memoryStore';
import { PersistenceManager } from '../../lib/memoryDb/PersistenceManager';
import { FileStorageAdapter } from '../../lib/memoryDb/StorageAdapter';
import { createInMemoryRepositoryBundle } from '../../lib/repositories/inMemory';
import { prepareEngineRestartRuntime } from './restartRuntime';

async function main() {
  console.log("Initializing Market Engine and Event Director with MemoryDatabase Repository Bundle...");

  const memoryDb = new MemoryDatabase();
  // Next.js standalone(.data/snapshot.json)과 저장소 소유권을 분리하여 파일 덮어쓰기 경합을 방지
  const engineDataDir = process.env.ENGINE_SERVER_DATA_DIR || path.resolve(process.cwd(), '.data', 'engine-server');
  const enginePersistence = new PersistenceManager(new FileStorageAdapter(engineDataDir));
  const restartRuntime = await prepareEngineRestartRuntime(memoryDb, enginePersistence);

  const repositories = createInMemoryRepositoryBundle(memoryDb);
  const context = restartRuntime.context;

  const engine = new MarketEngine({
    simulationContext: context,
    repositories,
    persistence: enginePersistence,
    initialTickCount: restartRuntime.initialTickCount,
    initialPartialFillSequence: restartRuntime.initialPartialFillSequence,
    onTickCommitPersist: async ({ tickCount, partialFillSequence, hadTrades, hasPersistentStateChanges }) => {
      memoryDb.engineTickCount = tickCount;
      memoryDb.enginePartialFillSequence = partialFillSequence;
      if (hadTrades || hasPersistentStateChanges || tickCount % 20 === 0) {
        return await enginePersistence.saveSnapshot(memoryDb);
      }
      return true;
    },
  });
  const eventDirector = new EventDirector(engine, context, repositories.event, undefined, {
    onPersist: () => enginePersistence.saveSnapshot(memoryDb),
    persistence: enginePersistence,
    epoch: restartRuntime.epoch,
  });
  await eventDirector.restorePendingCorrections();

  engine.start();
  eventDirector.start();
  enginePersistence.startAutoSave(memoryDb, 30000);

  // Optional HTTP Healthcheck Server
  const port = process.env.PORT || 10000;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('STOCKSYS Market Engine is running.\n');
  });

  server.listen(port, () => {
    console.log(`✅ HTTP server listening on port ${port}`);
  });

  // Graceful Shutdown
  const shutdown = async () => {
    console.log("\nReceived shutdown signal, stopping systems...");
    enginePersistence.stopAutoSave();
    engine.stop();
    eventDirector.stop();
    const counters = engine.getRuntimeCounters();
    memoryDb.engineTickCount = counters.tickCount;
    memoryDb.enginePartialFillSequence = counters.partialFillSequence;
    await enginePersistence.saveSnapshot(memoryDb).catch((err) => {
      console.error("Failed to flush final snapshot on shutdown:", err);
    });
    enginePersistence.releaseWriterLock();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', () => { void shutdown(); });
  process.on('SIGTERM', () => { void shutdown(); });
}

main().catch(err => {
  console.error("Failed to start Market Engine:", err);
  process.exit(1);
});
