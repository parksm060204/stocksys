/**
 * useAuth — NextAuth 세션을 인증 세션 패턴과 호환되게 래핑
 * Local Standalone Mode에서는 구글 로그인 없이도 즉시 테스트할 수 있도록 guest_user 자동 인증 제공
 */
"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import type { Session } from "next-auth";
import { isLocalStandaloneMode } from "@/lib/engine/localDevMode";
import { GUEST_USER_ID } from "@/lib/memoryDb/memoryStore";

// next-auth의 Session.user에 id 필드를 추가하는 확장
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

export interface AuthSession {
  user: {
    id: string;
    email?: string | null;
    name?: string | null;
    image?: string | null;
  };
}

export function useAuth() {
  const { data: session, status } = useSession();

  let authSession: AuthSession | null = (session as Session | null)?.user?.id
    ? {
        user: {
          id: (session as Session).user.id,
          email: session?.user?.email,
          name: session?.user?.name,
          image: session?.user?.image,
        },
      }
    : null;

  // 로컬 독립형 개발 모드이고 OAuth 세션이 없는 경우 자동 게스트 로그인 제공
  if (!authSession && isLocalStandaloneMode()) {
    authSession = {
      user: {
        id: GUEST_USER_ID,
        email: "guest@stocksys.local",
        name: "서학개미 (로컬 테스트)",
        image: null,
      },
    };
  }

  return {
    session: authSession,
    user: authSession?.user ?? null,
    userId: authSession?.user?.id ?? null,
    loading: status === "loading" && !authSession,
    isLoggedIn: !!authSession,
    signIn: () => signIn("google"),
    signOut: () => signOut(),
  };
}

/**
 * 서버 컴포넌트에서 세션을 가져오는 헬퍼
 */
export { getServerSession } from "next-auth";
export { authOptions } from "@/app/api/auth/[...nextauth]/route";
