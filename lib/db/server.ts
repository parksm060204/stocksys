import { createMockSupabaseClient } from "../memoryDb/mockSupabaseClient";
import { ensureLocalStandaloneEngine } from "../engine/localStandaloneServer";

export async function createClient() {
  ensureLocalStandaloneEngine();
  return createMockSupabaseClient() as any;
}
