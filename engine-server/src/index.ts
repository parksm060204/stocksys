import './loadEnv';
import { MarketEngine } from './MarketEngine';
import { EventDirector } from './EventDirector';
import * as http from 'http';
import { createSimulationContext } from '../../lib/engine/simulation/runtime';
import { MemoryDatabase } from '../../lib/memoryDb/memoryStore';
import { createInMemoryRepositoryBundle } from '../../lib/repositories/inMemory';

async function main() {
  console.log("Initializing Market Engine and Event Director with MemoryDatabase Repository Bundle...");

  const memoryDb = new MemoryDatabase();
  const repositories = createInMemoryRepositoryBundle(memoryDb);
  const context = createSimulationContext();

  const engine = new MarketEngine({
    simulationContext: context,
    repositories
  });
  const eventDirector = new EventDirector(engine, context, repositories.event);

  engine.start();
  eventDirector.start();

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
  const shutdown = () => {
    console.log("\nReceived shutdown signal, stopping systems...");
    engine.stop();
    eventDirector.stop();
    server.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error("Failed to start Market Engine:", err);
  process.exit(1);
});
