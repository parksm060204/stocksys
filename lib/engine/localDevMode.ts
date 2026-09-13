/**
 * Local Standalone Mode 감지 및 콘솔 배너 출력 헬퍼
 *
 * STOCKSYS는 완전 독립형 Local Standalone Mode로 구동됩니다.
 * 외부 DB, Supabase, Render 없이 인메모리 DB 및 Next.js 내부 마켓 엔진으로 모든 기능이 동작합니다.
 */

let hasPrintedBanner = false;

export function isLocalStandaloneMode(): boolean {
  printLocalBannerOnce();
  return true;
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
