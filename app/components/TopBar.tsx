"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";
import { ThemeToggle } from "./ThemeToggle";

export default function TopBar() {
  const [now, setNow] = useState<Date | null>(null);
  const [cash, setCash] = useState<number | null>(null);

  const supabase = createClient();
  const { user, isLoggedIn, signIn, signOut } = useAuth();

  useEffect(() => {
    let cancelled = false;
    if (isLoggedIn && user?.id) {
      supabase.from('profiles').select('cash').eq('id', user.id).single().then(({ data }: { data: { cash: number } | null }) => {
        if (!cancelled && data) setCash(data.cash);
      });
    } else {
      setCash(null);
    }
    return () => { cancelled = true; };
  }, [isLoggedIn, user?.id, supabase]);

  useEffect(() => {
    const update = () => setNow(new Date());
    const t = setInterval(update, 1000);
    const id = setTimeout(update, 0);
    return () => {
      clearInterval(t);
      clearTimeout(id);
    };
  }, []);

  const timeStr = now
    ? now.toLocaleTimeString("ko-KR", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "--:--:--";

  return (
    <header className="flex h-14 items-center justify-between border-b border-[#212631] bg-[#090B0F] px-6">
      {/* Search Input Bar (Robinhood Command Palette Style) */}
      <div className="flex items-center gap-3">
        <div className="relative w-64 md:w-80">
          <svg className="absolute left-3 top-2.5 h-4 w-4 text-[#8E939D]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="종목명, 티커 검색 (예: AAPL, 삼성전자)"
            className="w-full rounded-full border border-[#212631] bg-[#161B22] pl-9 pr-4 py-1.5 text-[12px] text-white placeholder:text-[#565A63] outline-none focus:border-[#F04452] focus:ring-1 focus:ring-[#F04452] transition-all"
          />
        </div>
        <div className="hidden lg:flex items-center gap-2 rounded-full border border-[#212631] bg-[#12161F] px-3 py-1 text-[11px] font-mono text-[#8E939D]">
          <span className="inline-block h-2 w-2 rounded-full bg-[#F04452] animate-pulse" />
          <span>실시간 봇 시뮬레이션 가동 중</span>
        </div>
      </div>

      <div className="flex items-center gap-3 md:gap-4">
        {/* 테마 감지 및 토글 드롭다운 */}
        <ThemeToggle />

        <span className="font-mono text-[12px] tabular-nums text-[#8E939D] bg-[#161B22] px-2.5 py-1 rounded-md border border-[#212631]">
          {timeStr}
        </span>

        {isLoggedIn && user ? (
          <div className="flex items-center gap-3">
            {user.image && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={user.image}
                alt=""
                className="h-7 w-7 rounded-full border border-[#F04452]/40"
              />
            )}
            <div className="flex flex-col items-end">
              <span className="text-[13px] font-bold text-white leading-none">
                {user.name ?? user.email}
              </span>
              {cash !== null && (
                <span className="text-[11px] text-[#F04452] font-mono font-bold mt-1">
                  ₩{cash.toLocaleString()}
                </span>
              )}
            </div>
            <button
              onClick={() => signOut()}
              className="rounded-xl border border-[#212631] bg-[#161B22] px-3 py-1.5 text-[12px] font-medium text-[#8E939D] transition-all hover:border-[#3182F6]/40 hover:text-[#3182F6]"
            >
              로그아웃
            </button>
          </div>
        ) : (
          <button
            onClick={() => signIn()}
            className="rounded-xl border border-[#F04452]/40 bg-[#F04452]/10 px-4 py-1.5 text-[13px] font-bold text-[#F04452] transition-all hover:bg-[#F04452] hover:text-white shadow-[0_0_12px_rgba(240,68,82,0.2)]"
          >
            Google 로그인
          </button>
        )}
      </div>
    </header>
  );
}


