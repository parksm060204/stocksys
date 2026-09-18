import NextAuth, { type NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

const providers = [];

if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  providers.push(
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    })
  );
}

export const authOptions: NextAuthOptions = {
  providers,
  callbacks: {
    async signIn({ user }) {
      try {
        return true;
      } catch (e) {
        console.error('[Auth] signIn error (ignored):', e);
        return true;
      }
    },
    async jwt({ token, user }) {
      try {
        if (user?.id) {
          token.userId = user.id;
        }
        return token;
      } catch (e) {
        console.error('[Auth] jwt error (ignored):', e);
        return token;
      }
    },
    async session({ session, token }) {
      try {
        if (session.user) {
          session.user.id = (token.userId as string) || token.sub || '';
        }
        return session;
      } catch (e) {
        console.error('[Auth] session error (ignored):', e);
        return session;
      }
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
  secret: process.env.NEXTAUTH_SECRET || (process.env.NODE_ENV === 'development' ? 'stocksys-dev-local-secret' : undefined),
};

const nextAuthHandler = NextAuth(authOptions);

/**
 * Next.js 15/16 App Router 호환 안전 래퍼:
 * 내부 핸들러에서 예외가 발생하거나 HTML 에러 페이지가 반환되더라도,
 * NextAuth 클라이언트가 JSON 파싱 실패(`Unexpected token '<'`)를 겪지 않도록
 * 반드시 유효한 JSON(null session 또는 error json)을 보장합니다.
 */
async function safeAuthHandler(req: Request, context: any) {
  try {
    // Next.js 15/16 App Router 호환성: req.nextUrl이 없는 일반 Request인 경우 URL 객체 주입
    const reqWithNextUrl = req as any;
    if (!reqWithNextUrl.nextUrl && req.url) {
      try {
        reqWithNextUrl.nextUrl = new URL(req.url);
      } catch {
        // ignore url parsing error
      }
    }

    const res = await nextAuthHandler(reqWithNextUrl, context);
    // 만약 NextAuth 응답이 HTML(에러 페이지)인 경우 JSON으로 치환하여 CLIENT_FETCH_ERROR 방어
    const contentType = res?.headers?.get('content-type') || '';
    if (res && res.status >= 400 && contentType.includes('text/html')) {
      console.warn(`[NextAuth] Caught HTML error response (${res.status}), returning fallback JSON.`);
      return Response.json(
        { error: 'AuthenticationError', message: 'An error occurred during authentication.' },
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return res;
  } catch (error) {
    console.error('[NextAuth] Unexpected route handler error (safely handled):', error);
    const url = req.url || '';
    // 세션 요청은 빈 세션(null)을 반환하여 클라이언트가 게스트 모드로 정상 폴백하도록 허용
    if (url.includes('/api/auth/session')) {
      return Response.json(null, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return Response.json(
      { error: 'InternalAuthenticationError', message: (error as Error)?.message || String(error) },
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export { safeAuthHandler as GET, safeAuthHandler as POST };
