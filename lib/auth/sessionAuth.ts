import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth/authOptions';
import { GUEST_USER_ID } from '@/lib/memoryDb/memoryStore';
import { isDevGuestAuthEnabled } from '@/lib/engine/localDevMode';

/**
 * 서버 API 라우트에서 현재 요청의 인증된 사용자 ID를 결정한다.
 * - NextAuth 세션이 있으면 세션 사용자 ID를 반환한다.
 * - 세션이 없고 개발 환경 게스트 인증이 활성화된 경우에만 GUEST_USER_ID를 반환한다.
 * - 프로덕션 비로그인 요청은 null을 반환한다.
 */
export async function resolveAuthenticatedUserId(): Promise<string | null> {
  let session: any = null;
  try {
    session = await getServerSession(authOptions);
  } catch {
    session = null;
  }

  if (session?.user?.id) {
    return String(session.user.id);
  }

  return isDevGuestAuthEnabled() ? GUEST_USER_ID : null;
}
