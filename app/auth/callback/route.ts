import { NextResponse } from "next/server";

/**
 * 기존 Supabase OAuth 콜백 라우트
 * NextAuth로 전환 후 이 라우트는 더 이상 사용되지 않습니다.
 * NextAuth가 /api/auth/callback/google 를 자동으로 처리합니다.
 * 구 URL로 들어오는 경우를 대비해 홈으로 리다이렉트.
 */
export async function GET(request: Request) {
  const { origin } = new URL(request.url);
  return NextResponse.redirect(origin);
}
