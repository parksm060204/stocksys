import { createBrowserClient } from "@supabase/ssr";
import { createMockSupabaseClient } from "../memoryDb/mockSupabaseClient";

let browserClient: any = null;

export function createClient() {
  if (browserClient) return browserClient;

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
    console.warn(
      "⚠️ [DEV MODE] 오프라인 인메모리(Mock) 데이터베이스 모드로 동작합니다. (vm-db 미연결)"
    );
    browserClient = createMockSupabaseClient();
    return browserClient;
  }

  // [3. 실제 vm-db (PostgreSQL/PostgREST) 브라우저 클라이언트 연결]
  try {
    browserClient = createBrowserClient(url, key);
  } catch (err) {
    if (isProd) {
      throw new Error(`[SUPABASE CLIENT INIT FAILED] ${err}`);
    }
    console.warn("⚠️ [DEV MODE] Supabase 클라이언트 초기화 실패로 인메모리 모드로 폴백합니다.");
    browserClient = createMockSupabaseClient();
  }

  return browserClient;
}
