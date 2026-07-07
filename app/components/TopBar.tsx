"use client";

import { useEffect, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";

import { LP_ENGINE } from "@/lib/mock-data";

function marketOpen(d: Date): boolean {
  const mins = d.getHours() * 60 + d.getMinutes();
  return mins >= 18 * 60 && mins < 22 * 60 + 30;
}

export default function TopBar() {
  const [now, setNow] = useState<Date | null>(null);
  const [user, setUser] = useState<User | null>(null);

  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    const update = () => setNow(new Date());
    const t = setInterval(update, 1000);
    const id = setTimeout(update, 0);
    return () => {
      clearInterval(t);
      clearTimeout(id);
      listener?.subscription.unsubscribe();
    };
  }, []);

  const emergency = LP_ENGINE?.emergencyClosed;
  const open = now ? (marketOpen(now) && !emergency) : false;
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
        {/* Market status removed as requested */}
      </div>

      <div className="flex items-center gap-5">
        <span className="font-mono text-[13px] tabular-nums text-muted">
          {timeStr}
        </span>

        {user ? (
          <div className="flex items-center gap-3">
            {user.user_metadata?.avatar_url && (
              <img
                src={user.user_metadata.avatar_url}
                alt=""
                className="h-7 w-7 rounded-full"
              />
            )}
            <span className="text-[13px] font-medium text-tx">
              {user.user_metadata?.full_name ?? user.email}
            </span>
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
