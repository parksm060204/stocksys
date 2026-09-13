import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createMockSupabaseClient } from "../memoryDb/mockSupabaseClient";
import { isLocalStandaloneMode } from "../engine/localDevMode";
import { ensureLocalStandaloneEngine } from "../engine/localStandaloneServer";

export async function createClient() {
  if (isLocalStandaloneMode()) {
    ensureLocalStandaloneEngine();
    return createMockSupabaseClient() as any;
  }

  const url = process.env.NEXT_PUBLIC_ENGINE_DB_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_ENGINE_DB_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error("❌ [Supabase Server] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in production!");
    }
    // 개발 모드 안전 폴백
    ensureLocalStandaloneEngine();
    return createMockSupabaseClient() as any;
  }

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
            // Server Component ignore
          }
        },
      },
    },
  );
}
