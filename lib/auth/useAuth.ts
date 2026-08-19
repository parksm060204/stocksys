/**
 * useAuth — NextAuth 세션을 기존 supabase.auth.getSession() 패턴과 호환되게 래핑
 * 
 * 기존 코드:
 *   const { data: { session } } = await supabase.auth.getSession();
 *   session?.user?.id
 *
 * 변경 후:
 *   const { session } = useAuth();
 *   session?.user?.id
 */
"use client";

import { useSession, signIn, signOut } from "next-auth/react";
import type { Session } from "next-auth";

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

  const authSession: AuthSession | null = (session as Session | null)?.user?.id
    ? {
        user: {
          id: (session as Session).user.id,
          email: session?.user?.email,
          name: session?.user?.name,
          image: session?.user?.image,
        },
      }
    : null;

  return {
    session: authSession,
    user: authSession?.user ?? null,
    userId: authSession?.user?.id ?? null,
    loading: status === "loading",
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

