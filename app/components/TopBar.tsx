"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/db/client";
import { useAuth } from "@/lib/auth/useAuth";
import { ThemeToggle } from "./ThemeToggle";

interface SearchStockItem {
  id: string;
  ticker: string;
  name: string;
  market: string;
}

/**
 * 프로필 응답에서 수신한 cash 값을 런타임 검증한다.
 * ProfileRecord 계약(유한한 number)만 허용하며, undefined/null/NaN/Infinity/배열/객체/문자열은 null로 거부한다.
 */
export function parseValidCash(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Object.is(value, -0) ? 0 : value;
}

export default function TopBar() {
  const [now, setNow] = useState<Date | null>(null);
  const [cashState, setCashState] = useState<{ userId: string; amount: number } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [allStocks, setAllStocks] = useState<SearchStockItem[]>([]);

  const router = useRouter();
  const db = createClient();
  const { user, isLoggedIn, signIn, signOut } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    let active = true;
    db.from("stocks")
      .select("id, ticker, name, market, is_listed")
      .neq("is_listed", false)
      .then(
        ({ data }: { data: Array<SearchStockItem & { is_listed?: boolean }> | null }) => {
          if (active && Array.isArray(data)) {
            setAllStocks(data.filter((s) => s.is_listed !== false));
          }
        },
        () => {}
      );
    return () => {
      active = false;
    };
  }, [db]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return allStocks
      .filter(
        (s) =>
          s.ticker.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q)
      )
      .slice(0, 8);
  }, [allStocks, searchQuery]);

  useEffect(() => {
    let cancelled = false;
    setCashState(null);

    if (!isLoggedIn || !userId) {
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const res = await db
          .from("profiles")
          .select("cash")
          .eq("user_id", userId)
          .maybeSingle();

        if (cancelled) return;

        const data =
          res && typeof res === "object"
            ? (res as { data?: unknown }).data
            : null;
        const error =
          res && typeof res === "object"
            ? (res as { error?: unknown }).error
            : null;

        if (error) {
          setCashState(null);
          return;
        }

        const rawCash =
          data && typeof data === "object" && !Array.isArray(data)
            ? (data as { cash?: unknown }).cash
            : undefined;
        const validCash = parseValidCash(rawCash);
        setCashState(validCash !== null ? { userId, amount: validCash } : null);
      } catch {
        if (!cancelled) {
          setCashState(null);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isLoggedIn, userId, db]);

  useEffect(() => {
    const update = () => setNow(new Date());
    const t = setInterval(update, 1000);
    const id = setTimeout(update, 0);
    return () => {
      clearInterval(t);
      clearTimeout(id);
    };
  }, []);

  const displayCash =
    isLoggedIn && user?.id && cashState && cashState.userId === user.id
      ? parseValidCash(cashState.amount)
      : null;

  const timeStr = now
    ? now.toLocaleTimeString("ko-KR", {
        timeZone: "Asia/Seoul",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "--:--:--";

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-panel px-4 sm:px-6">
      {/* Search Input Bar (Robinhood Command Palette Style) */}
      <div className="flex items-center gap-3">
        <div className="relative w-60 sm:w-72 md:w-80">
          <svg className="absolute left-3 top-2.5 h-4 w-4 text-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && searchResults.length > 0) {
                const first = searchResults[0];
                setSearchQuery("");
                setSearchFocused(false);
                router.push(`/stocks/${first.id}`);
              }
            }}
            placeholder="종목명, 티커 검색 (예: AAPL, 삼성전자)"
            className="w-full rounded-full border border-border bg-panel2 pl-9 pr-4 py-1.5 text-[12px] text-tx placeholder:text-muted outline-none focus:border-[#F04452] focus:ring-1 focus:ring-[#F04452] transition-all"
          />
          {searchFocused && searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1.5 z-50 rounded-2xl border border-border bg-panel shadow-2xl overflow-hidden">
              {searchResults.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setSearchQuery("");
                    setSearchFocused(false);
                    router.push(`/stocks/${s.id}`);
                  }}
                  className="w-full flex items-center justify-between px-3.5 py-2 text-left text-xs hover:bg-hover transition-colors border-b border-border/40 last:border-none"
                >
                  <span className="font-bold text-tx truncate">{s.name}</span>
                  <span className="font-mono text-[11px] text-muted shrink-0 ml-2">{s.ticker}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="hidden lg:flex items-center gap-2 rounded-full border border-border bg-panel2 px-3 py-1 text-xs font-mono text-muted">
          <span className="inline-block h-2 w-2 rounded-full bg-up animate-pulse" />
          <span>실시간 봇 시뮬레이션 가동 중</span>
        </div>
      </div>

      <div className="flex items-center gap-2.5 sm:gap-3 md:gap-4">
        <ThemeToggle className="shrink-0" />

        <span className="font-mono text-[12px] tabular-nums text-muted bg-panel2 px-2.5 py-1 rounded-md border border-border">
          {timeStr}
        </span>

        {isLoggedIn && user ? (
          <div className="flex items-center gap-3">
            {user.image && (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={user.image}
                alt=""
                className="h-7 w-7 rounded-full border border-[#F04452]/40 shrink-0"
              />
            )}
            <div className="flex min-w-0 flex-col items-end">
              <span className="max-w-[160px] sm:max-w-[220px] truncate text-[13px] font-bold text-tx leading-none">
                {user.name ?? user.email}
              </span>
              {displayCash !== null && (
                <span
                  data-testid="topbar-cash"
                  className="text-xs text-up font-mono font-bold mt-1 tabular-nums whitespace-nowrap"
                >
                  ₩{displayCash.toLocaleString()}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => signOut()}
              className="shrink-0 rounded-xl border border-border bg-panel2 px-3 py-1.5 text-[12px] font-medium text-muted transition-all hover:border-[#3182F6]/40 hover:text-down"
            >
              로그아웃
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => signIn()}
            className="shrink-0 rounded-xl border border-[#F04452]/40 bg-up/10 px-4 py-1.5 text-[13px] font-bold text-up transition-all hover:bg-up hover:text-white shadow-[0_0_12px_rgba(240,68,82,0.2)]"
          >
            Google 로그인
          </button>
        )}
      </div>
    </header>
  );
}


