import { MarketEngine } from './MarketEngine';
import * as dotenv from 'dotenv';

dotenv.config();

function checkEnv() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("❌ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is missing in environment variables.");
    process.exit(1);
  }
}

async function main() {
  checkEnv();
  console.log("Initializing Market Engine...");

  const engine = new MarketEngine();
  engine.start();

  // Graceful Shutdown
  const shutdown = () => {
    console.log("\nReceived shutdown signal, stopping engine...");
    engine.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error("Failed to start Market Engine:", err);
  process.exit(1);
});
