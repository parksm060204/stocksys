import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createMockSupabaseClient } from "../memoryDb/mockSupabaseClient";

export async function createClient() {
  const useInMemory = process.env.NEXT_PUBLIC_USE_IN_MEMORY === "true";
  if (useInMemory) {
    return createMockSupabaseClient() as any;
  }

  const url = process.env.NEXT_PUBLIC_ENGINE_DB_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "http://49.247.136.231:3001";
  const key = process.env.NEXT_PUBLIC_ENGINE_DB_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InBvc3RncmVzdCIsImV4cCI6OTk5OTk5OTk5OX0.ZVBYePzn3NGxFYWINT5qpYt7FxXjWwXfS2FFw3Oy474";

  const cookieStore = await cookies();

  return createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // The `setAll` method was called from a Server Component.
          }
        },
      },
    },
  );
}
