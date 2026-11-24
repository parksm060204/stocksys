import type { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";

import { memoryDb } from "@/lib/memoryDb/memoryStore";
import { ensureMemoryDbReady, persistConfirmedState } from "@/lib/engine/localStandaloneServer";
import { withAccountLocks } from "@/lib/memoryDb/accountLocks";
import { runWithCommitGate } from "@/lib/memoryDb/PersistenceManager";

const inFlightProfileEnsures = new Map<string, Promise<void>>();

export async function ensureRestoredAndPersistUserProfile(
  userId: string,
  initialData: { username: string; nickname: string; email?: string }
): Promise<void> {
  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    return;
  }

  while (inFlightProfileEnsures.has(userId)) {
    await inFlightProfileEnsures.get(userId)!.catch(() => undefined);
  }

  const task = (async () => {
    await ensureMemoryDbReady();
    while (true) {
      if (memoryDb.resolveProfileByUserId(userId)) {
        return;
      }
      let candidatePk = !memoryDb.profiles.has(userId) ? userId : memoryDb.generateId('prof');
      while (memoryDb.profiles.has(candidatePk) || (candidatePk !== userId && memoryDb.resolveProfileByUserId(candidatePk))) {
        candidatePk = memoryDb.generateId('prof');
      }
      const lockKeys = candidatePk === userId ? [userId] : [userId, candidatePk];
      const status = await withAccountLocks(lockKeys, async () => {
        if (memoryDb.resolveProfileByUserId(userId)) {
          return 'done';
        }
        if (memoryDb.profiles.has(candidatePk)) {
          return 'retry';
        }
        await runWithCommitGate(persistConfirmedState, async () => {
          if (memoryDb.resolveProfileByUserId(userId)) {
            return;
          }
          const prevIndexedId = memoryDb.profileUserIdIndex.get(userId);
          const createdProfile = memoryDb.ensureUserProfile(userId, { ...initialData, id: candidatePk });
          let saved = false;
          let persistError: unknown = null;
          try {
            saved = await persistConfirmedState();
          } catch (err) {
            persistError = err;
          }
          if (!saved) {
            if (memoryDb.profiles.get(createdProfile.id) === createdProfile) {
              memoryDb.profiles.delete(createdProfile.id);
            }
            if (memoryDb.profileUserIdIndex.get(userId) === createdProfile.id) {
              if (prevIndexedId !== undefined && prevIndexedId !== createdProfile.id) {
                memoryDb.profileUserIdIndex.set(userId, prevIndexedId);
              } else {
                memoryDb.profileUserIdIndex.delete(userId);
              }
            }
            if (persistError) {
              console.error('[Auth] Error persisting newly created user profile; rolled back:', persistError);
              throw persistError;
            }
            console.error('[Auth] Failed to persist newly created user profile; rolled back');
          }
        });
        return 'done';
      });
      if (status === 'done') {
        return;
      }
    }
  })();

  inFlightProfileEnsures.set(userId, task);
  try {
    await task;
  } finally {
    if (inFlightProfileEnsures.get(userId) === task) {
      inFlightProfileEnsures.delete(userId);
    }
  }
}

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
    async signIn({ user, account, profile }) {
      try {
        const userId = user?.id || (account?.providerAccountId as string) || (profile as any)?.sub;
        if (userId) {
          await ensureRestoredAndPersistUserProfile(userId, {
            username: user.name || (user.email ? user.email.split('@')[0] : '익명 투자자'),
            nickname: user.name || '익명 투자자',
            email: user.email || undefined,
          });
        }
        return true;
      } catch (e) {
        console.error('[Auth] signIn error (ignored):', e);
        return true;
      }
    },
    async jwt({ token, user, account }) {
      try {
        if (user?.id) {
          token.userId = user.id;
        } else if (account?.providerAccountId) {
          token.userId = account.providerAccountId;
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
          const resolvedId = (token.userId as string) || token.sub || '';
          session.user.id = resolvedId;
          if (resolvedId) {
            await ensureRestoredAndPersistUserProfile(resolvedId, {
              username: session.user.name || (session.user.email ? session.user.email.split('@')[0] : '익명 투자자'),
              nickname: session.user.name || '익명 투자자',
              email: session.user.email || undefined,
            });
          }
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
