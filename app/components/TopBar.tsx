"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { User } from "@supabase/supabase-js";

export default function TopBar() {
  const [now, setNow] = useState<Date | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [cash, setCash] = useState<number | null>(null);

  const supabase = createClient();

  useEffect(() => {
    const fetchProfile = async (userId: string) => {
      const { data } = await supabase.from('profiles').select('cash').eq('id', userId).single();
      if (data) setCash(data.cash);
    };

    supabase.auth.getSession().then(({ data }: { data: { session: { user: { id: string } } | null } }) => {
      setUser((data.session?.user ?? null) as User | null);
      if (data.session?.user) fetchProfile(data.session.user.id);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event: unknown, session: { user: { id: string } } | null) => {
      setUser((session?.user ?? null) as User | null);
      if (session?.user) fetchProfile(session.user.id);
      else setCash(null);
    });

    const update = () => setNow(new Date());
    const t = setInterval(update, 1000);
    const id = setTimeout(update, 0);
    return () => {
      clearInterval(t);
      clearTimeout(id);
      listener?.subscription.unsubscribe();
    };
  }, [supabase]);

  const timeStr = now
    ? now.toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "--:--:--";

  const login = () => {
    supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/auth/callback` },
    });
  };

  const logout = () => {
    supabase.auth.signOut();
  };

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-panel px-6">
      <div className="flex items-center gap-4">
        {/* Market status */}
      </div>

      <div className="flex items-center gap-5">
        <span className="font-mono text-[13px] tabular-nums text-muted">
          {timeStr}
        </span>

        {user ? (
          <div className="flex items-center gap-3">
            {user.user_metadata?.avatar_url && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={user.user_metadata.avatar_url}
                alt=""
                className="h-7 w-7 rounded-full"
              />
            )}
            <div className="flex flex-col items-end">
              <span className="text-[13px] font-medium text-tx leading-none">
                {user.user_metadata?.full_name ?? user.email}
              </span>
              {cash !== null && (
                <span className="text-[11px] text-up font-mono mt-1">
                  ₩{cash.toLocaleString()}
                </span>
              )}
            </div>
            <button
              onClick={logout}
              className="rounded-lg border border-border px-3 py-1.5 text-[12px] text-dim transition-colors hover:border-up/40 hover:text-up"
            >
              로그아웃
            </button>
          </div>
        ) : (
          <button
            onClick={login}
            className="rounded-lg border border-border bg-panel2 px-4 py-1.5 text-[13px] font-medium text-tx transition-colors hover:border-accent/50 hover:text-accent"
          >
            Google 로그인
          </button>
        )}
      </div>
    </header>
  );
}
