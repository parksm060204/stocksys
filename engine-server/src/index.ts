import { MarketEngine } from './MarketEngine';
import { NewsFetcher } from './newsFetcher';
import { EventDirector } from './EventDirector';
import * as dotenv from 'dotenv';
import * as http from 'http';

dotenv.config();

function checkEnv() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in environment variables.");
    process.exit(1);
  }
}

async function main() {
  checkEnv();
  console.log("Initializing Market Engine, News Fetcher, and Event Director...");

  const engine = new MarketEngine();
  const newsFetcher = new NewsFetcher();
  const eventDirector = new EventDirector(engine);

  engine.start();
  newsFetcher.start();
  eventDirector.start();

  // Render Web Service용 Dummy HTTP Server (무료 티어 우회용)
  const port = process.env.PORT || 10000;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Antigravity Stock Engine is running.\n');
  });

  server.listen(port, () => {
    console.log(`✅ Dummy HTTP server listening on port ${port} (for Render Web Service health checks)`);
  });

  // Graceful Shutdown
  const shutdown = () => {
    console.log("\nReceived shutdown signal, stopping systems...");
    engine.stop();
    newsFetcher.stop();
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
