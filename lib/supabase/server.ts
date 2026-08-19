import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createMockSupabaseClient } from "../memoryDb/mockSupabaseClient";

export async function createClient() {
  const isProd = process.env.NODE_ENV === "production";
  const useInMemory = process.env.NEXT_PUBLIC_USE_IN_MEMORY === "true";
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // [1. 프로덕션 환경 가드]
  if (isProd) {
    if (useInMemory) {
      throw new Error(
        "[SECURITY CRITICAL] NEXT_PUBLIC_USE_IN_MEMORY=true는 프로덕션 환경(NODE_ENV=production)에서 절대 허용되지 않습니다. vm-db(PostgreSQL/PostgREST) 설정을 구성하세요."
      );
    }
    if (!url || !key || url.includes("placeholder") || url.includes("example.com")) {
      throw new Error(
        "[CONFIGURATION ERROR] 프로덕션 환경에서는 유효한 NEXT_PUBLIC_SUPABASE_URL 및 NEXT_PUBLIC_SUPABASE_ANON_KEY가 필수입니다. (Silent fallback 금지)"
      );
    }
  }

  // [2. 로컬 개발 / 오프라인 데모 환경 (NODE_ENV !== 'production')]
  if (useInMemory || !url || !key || url.includes("placeholder") || url.includes("example.com")) {
    return createMockSupabaseClient();
  }

  // [3. 실제 vm-db (PostgreSQL/PostgREST) 서버 클라이언트 연결]
  try {
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
  } catch (err) {
    if (isProd) {
      throw new Error(`[SUPABASE SERVER CLIENT INIT FAILED] ${err}`);
    }
    return createMockSupabaseClient();
  }
}
