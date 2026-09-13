import { createBrowserClient } from "@supabase/ssr";
import { createMockSupabaseClient } from "../memoryDb/mockSupabaseClient";

let browserClient: any = null;

export function createClient() {
  if (browserClient) return browserClient;

  const useInMemory = process.env.NEXT_PUBLIC_USE_IN_MEMORY === "true";
  if (useInMemory) {
    browserClient = createMockSupabaseClient();
    return browserClient;
  }

  const url = process.env.NEXT_PUBLIC_ENGINE_DB_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "http://49.247.136.231:3001";
  const key = process.env.NEXT_PUBLIC_ENGINE_DB_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InBvc3RncmVzdCIsImV4cCI6OTk5OTk5OTk5OX0.ZVBYePzn3NGxFYWINT5qpYt7FxXjWwXfS2FFw3Oy474";

  browserClient = createBrowserClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  return browserClient;
}
