import { getServerSession } from 'next-auth';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { memoryDb } from '@/lib/memoryDb/memoryStore';

export interface AdminAuthResult {
  isAdmin: boolean;
  adminUser: string;
  error?: string;
}

/**
 * 서버 세션 및 관리자 권한 검증.
 * - 하드코딩된 헤더 키(x-admin-key) 우회를 원천 배제.
 * - 환경변수 ADMIN_EMAILS 목록 또는 신뢰할 수 있는 서버 프로필을 확인.
 * - Production에서는 미인증/비관리자 요청을 엄격히 거절.
 * - Development 환경이라도 ALLOW_DEV_ADMIN=true 플래그가 있거나 세션 유저가 관리자인 경우에만 허용.
 */
export async function verifyAdminSession(req?: Request): Promise<AdminAuthResult> {
  const isProd = process.env.NODE_ENV === 'production';
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  let session: any = null;
  try {
    session = await getServerSession(authOptions);
  } catch (err: any) {
    if (!String(err?.message || err).includes('request scope')) {
      console.error('[AdminAuth] Failed to get session:', err);
    }
  }

  const email = session?.user?.email?.toLowerCase();
  const userId = session?.user?.id;

  // 1. 세션 이메일이 관리자 이메일 목록에 포함된 경우
  if (email && adminEmails.includes(email)) {
    return { isAdmin: true, adminUser: email };
  }

  // 2. 서버 메모리 DB의 프로필 확인 (클라이언트에서 직접 수정 불가능한 서버 필드)
  if (userId) {
    const profile = memoryDb.profiles.get(userId);
    if (profile?.is_admin) {
      return { isAdmin: true, adminUser: profile.email || userId };
    }
  }

  // 3. 로컬 개발 환경(비프로덕션)에서의 명시적 개발 관리자 플래그
  if (!isProd && process.env.ALLOW_DEV_ADMIN === 'true') {
    return { isAdmin: true, adminUser: 'dev_admin' };
  }

  return {
    isAdmin: false,
    adminUser: '',
    error: '관리자 권한이 필요합니다.',
  };
}
