/**
 * Local Standalone Mode 감지 및 콘솔 배너 출력 헬퍼
 * 
 * 규칙:
 * 1. NODE_ENV === 'production' 에서는 절대로 로컬 메모리 모드로 자동 전환되지 않음 (외부 DB 필수).
 * 2. NODE_ENV === 'development' 이면서 유효한 외부 DB URL이 없으면 자동으로 standalone mode 활성화.
 * 3. 최초 활성화 시 [STOCKSYS] 콘솔 로그 4줄 출력.
 */

let hasPrintedBanner = false;

export function isLocalStandaloneMode(): boolean {
  // 1. Production 환경에서는 어떤 플래그가 설정되어도 절대로 로컬 메모리 모드 진입 금지! (절대 보안 원칙)
  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  // 2. 명시적 환경변수 플래그가 있는 경우 (로컬 개발 전용)
  if (process.env.NEXT_PUBLIC_USE_IN_MEMORY === 'true' || process.env.LOCAL_MEMORY_MODE === 'true') {
    printLocalBannerOnce();
    return true;
  }

  // Development 환경: 외부 DB URL 및 KEY 존재 여부 확인
  const extUrl = process.env.NEXT_PUBLIC_ENGINE_DB_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const extKey = process.env.ENGINE_DB_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_ENGINE_DB_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const hasExternalDb = Boolean(extUrl && extKey && !extUrl.includes('localhost:3001') && !extUrl.includes('49.247.136.231'));

  // 유효한 외부 프로덕션/VM DB 설정이 없으면 자동으로 로컬 독립 개발 모드 가동
  if (!hasExternalDb) {
    printLocalBannerOnce();
    return true;
  }

  return false;
}

export function printLocalBannerOnce(): void {
  if (hasPrintedBanner) return;
  hasPrintedBanner = true;

  console.log('==================================================');
  console.log('[STOCKSYS] Local standalone mode');
  console.log('[STOCKSYS] Memory DB initialized');
  console.log('[STOCKSYS] Local Market Engine started');
  console.log('[STOCKSYS] No external database required');
  console.log('==================================================');
}
