import './loadEnv';
import { MarketEngine } from './MarketEngine';
import { EventDirector } from './EventDirector';
import * as dotenv from 'dotenv';
import * as http from 'http';

function checkEnv() {
  const url = process.env.NEXT_PUBLIC_ENGINE_DB_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.ENGINE_DB_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_ENGINE_DB_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("❌ ENGINE_DB_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE_KEY) or SUPABASE_URL is missing in environment variables.");
    process.exit(1);
  }
  if (!process.env.ENGINE_DB_SERVICE_ROLE_KEY && !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.warn("⚠️ [Index] Running with ANON key! Server database operations may be blocked by RLS.");
  }
}

async function main() {
  checkEnv();
  console.log("Initializing Market Engine and Event Director...");

  const engine = new MarketEngine();
  const eventDirector = new EventDirector(engine);

  engine.start();
  eventDirector.start();

  // Optional HTTP Healthcheck Server
  const port = process.env.PORT || 10000;
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('무명 Stock Engine is running.\n');
  });

  server.listen(port, () => {
    console.log(`✅ Dummy HTTP server listening on port ${port}`);
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
