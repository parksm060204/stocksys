import { createMemoryDbClient } from "../memoryDb/memoryDbClient";
import { ensureLocalStandaloneEngine } from "../engine/localStandaloneServer";

export async function createClient() {
  ensureLocalStandaloneEngine();
  return createMemoryDbClient() as any;
}
