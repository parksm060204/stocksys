import NextAuth from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import { createClient } from "@supabase/supabase-js";

// VM DB 서버용 클라이언트 (서비스 롤로 사용자 생성 가능)
const supabaseUrl = process.env.NEXT_PUBLIC_ENGINE_DB_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "http://49.247.136.231:3001";
const supabaseKey = process.env.ENGINE_DB_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_ENGINE_DB_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InBvc3RncmVzdCIsImV4cCI6OTk5OTk5OTk5OX0.ZVBYePzn3NGxFYWINT5qpYt7FxXjWwXfS2FFw3Oy474";

const adminSupabase = createClient(supabaseUrl, supabaseKey);

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID || "dummy-client-id",
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || "dummy-client-secret",
    }),
  ],
  callbacks: {
    /**
     * 첫 로그인 시 VM DB에 auth.users + profiles INSERT
     */
    async signIn({ user }: { user: any }) {
      if (!user?.email) return true;
      try {
        // 1. auth.users에 유저가 없으면 INSERT
        const { data: existing } = await adminSupabase
          .from("auth_users_view") // PostgREST는 직접 auth 스키마 접근 불가 → public 뷰 사용
          .select("id")
          .eq("email", user.email)
          .maybeSingle();

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
            console.warn("[NextAuth] create_user_with_profile warning:", insertErr.message);
          } else {
            const createdId = Array.isArray(newUser) ? newUser[0]?.id : newUser?.id;
            user.dbId = createdId || null;
          }
        } else {
          user.dbId = existing.id;
        }
      } catch (e: any) {
        console.warn("[NextAuth] signIn callback caught error:", e?.message || e);
      }
      return true;
    },

    /**
     * JWT에 DB UUID(sub) 포함
     */
    async jwt({ token, user }: { token: any; user: any }) {
      if (user?.dbId) {
        token.dbId = user.dbId;
      }
      if (!token.dbId && token.email) {
        try {
          const { data } = await adminSupabase
            .from("auth_users_view")
            .select("id")
            .eq("email", token.email)
            .maybeSingle();
          if (data) token.dbId = data.id;
        } catch (e: any) {
          console.warn("[NextAuth] jwt callback caught error:", e?.message || e);
        }
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
    signIn: "/",
    error: "/",
  },
  session: {
    strategy: "jwt" as const,
    maxAge: 30 * 24 * 60 * 60, // 30일
  },
  secret: process.env.NEXTAUTH_SECRET || "moo_stock_sys_nextauth_secret_2026_very_long_random_string_xkd92ms",
};

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
