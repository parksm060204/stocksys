import { createMemoryDbClient } from "../memoryDb/memoryDbClient";
import { ensureMemoryDbReady, ensureLocalStandaloneEngine } from "../engine/localStandaloneServer";

export async function createClient() {
  await ensureMemoryDbReady();
  if (process.env.NEXT_PHASE !== 'phase-production-build') {
    ensureLocalStandaloneEngine();
  }
  return createMemoryDbClient() as any;
}
