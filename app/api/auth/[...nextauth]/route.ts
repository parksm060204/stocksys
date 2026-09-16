import NextAuth, { NextAuthOptions } from "next-auth";
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

const handler = NextAuth(authOptions);
export { handler as GET, handler as POST };
