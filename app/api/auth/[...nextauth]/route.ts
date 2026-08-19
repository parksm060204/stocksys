import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { createClient } from "@supabase/supabase-js";

// VM DB 서버용 클라이언트 (서비스 롤로 사용자 생성 가능)
const adminSupabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    /**
     * 첫 로그인 시 VM DB에 auth.users + profiles INSERT
     */
    async signIn({ user }: { user: any }) {
      try {
        // 1. auth.users에 유저가 없으면 INSERT
        const { data: existing } = await adminSupabase
          .from("auth_users_view") // PostgREST는 직접 auth 스키마 접근 불가 → public 뷰 사용
          .select("id")
          .eq("email", user.email)
          .single();

        if (!existing) {
          // auth.users INSERT는 RPC로 처리
          const { data: newUser, error: insertErr } = await adminSupabase.rpc(
            "create_user_with_profile",
            {
              p_email: user.email,
              p_full_name: user.name || "익명 투자자",
              p_avatar_url: user.image || null,
            }
          );
          if (insertErr) {
            console.error("[NextAuth] create_user_with_profile error:", insertErr);
            return false;
          }
          // user 객체에 DB UUID 주입
          const createdId = Array.isArray(newUser) ? newUser[0]?.id : newUser?.id;
          user.dbId = createdId || null;
        } else {
          user.dbId = existing.id;
        }
        return true;
      } catch (e) {
        console.error("[NextAuth] signIn callback error:", e);
        return false;
      }
    },

    /**
     * JWT에 DB UUID(sub) 포함
     */
    async jwt({ token, user }: { token: any; user: any }) {
      if (user?.dbId) {
        token.dbId = user.dbId;
      }
      // dbId가 아직 없을 경우 email로 auth.users 조회하여 주입
      if (!token.dbId && token.email) {
        const { data } = await adminSupabase
          .from("auth_users_view")
          .select("id")
          .eq("email", token.email)
          .single();
        if (data) token.dbId = data.id;
      }
      return token;
    },

    /**
     * 클라이언트 session 객체에 dbId 노출
     */
    async session({ session, token }: { session: any; token: any }) {
      if (session.user) {
        session.user.id = token.dbId || token.sub;
      }
      return session;
    },
  },
  pages: {
    signIn: "/",        // 로그인 페이지 없음 → 홈으로
    error: "/",
  },
  session: {
    strategy: "jwt" as const,
    maxAge: 30 * 24 * 60 * 60, // 30일
  },
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
