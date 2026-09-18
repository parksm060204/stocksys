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
    async signIn() {
      // 명시적 인증 허용 정책 (추가 인가 검증이 필요할 경우 여기에 정책 작성)
      return true;
    },
    async jwt({ token, user }) {
      if (user?.id) {
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = (token.userId as string) || token.sub || '';
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
  secret: process.env.NEXTAUTH_SECRET || (process.env.NODE_ENV === 'development' ? 'stocksys-dev-local-secret' : undefined),
};

const nextAuthHandler = NextAuth(authOptions);

type RouteContext = {
  params: Promise<{ nextauth: string[] }> | { nextauth: string[] };
};

/**
 * Next.js App Router 호환 안전 래퍼:
 * - JSON 전용 엔드포인트(session, csrf, providers)에서 서버 내부 장애 발생 시
 *   HTML 500 에러 페이지 대신 규격화된 HTTP 500 JSON 응답을 반환하여 파싱 오류를 방지합니다.
 * - 오류 상태를 200 OK로 위장하지 않으며, 올바른 HTTP 500 상태 코드를 유지합니다.
 * - 내부 예외 스택/메시지를 외부에 노출하지 않고 안전한 고정 메시지를 제공합니다.
 * - signin, signout, callback 등 브라우저 redirect/HTML이 필요한 경로는 NextAuth 기본 계약을 그대로 보존합니다.
 */
async function safeAuthHandler(req: Request, context: RouteContext) {
  let action: string | undefined;

  try {
    const resolvedParams = context && context.params ? await context.params : null;
    action = resolvedParams?.nextauth?.[0];
  } catch {
    // context.params 언래핑 실패 시 URL에서 action 추출 시도
    try {
      const url = new URL(req.url);
      const segments = url.pathname.split('/').filter(Boolean);
      const authIdx = segments.indexOf('auth');
      if (authIdx !== -1 && authIdx + 1 < segments.length) {
        action = segments[authIdx + 1];
      }
    } catch {
      action = undefined;
    }
  }

  const isJsonEndpoint = action === 'session' || action === 'csrf' || action === 'providers';

  try {
    const res = await nextAuthHandler(req, context as any);

    // JSON 엔드포인트인데 응답이 HTML 4xx/5xx 에러인 경우에만 규격화된 JSON 에러로 변환 (상태 코드 보존)
    if (isJsonEndpoint && res && res.status >= 400) {
      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('text/html')) {
        console.warn(`[NextAuth] JSON endpoint '${action}' returned HTML error (${res.status}). Converting to JSON error.`);
        return Response.json(
          {
            error: 'AuthenticationError',
            message: 'Authentication service encountered an error.',
          },
          { status: res.status, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    return res;
  } catch (error) {
    console.error(`[NextAuth] Unhandled route handler exception for action '${action}':`, error);

    // JSON 엔드포인트인 경우 서버 장애를 의미하는 정식 HTTP 500 JSON 반환 (200 위장 금지, 내부 메시지 은닉)
    if (isJsonEndpoint) {
      return Response.json(
        {
          error: 'InternalAuthenticationError',
          message: 'Authentication service is temporarily unavailable.',
        },
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // signin, signout, callback 등 redirect/HTML 경로는 표준 에러 전파 또는 500 반환
    return Response.json(
      {
        error: 'InternalAuthenticationError',
        message: 'Authentication service is temporarily unavailable.',
      },
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

export { safeAuthHandler as GET, safeAuthHandler as POST };
