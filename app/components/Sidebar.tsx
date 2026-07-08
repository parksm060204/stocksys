"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useCallback, useEffect } from "react";
import { MARKETS } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";

const ADMIN_PASSWORD = "dlcks123";

const STOCK_MARKET_IDS = ["domestic", "overseas", "europe"];
const NON_STOCK_MARKETS = MARKETS.filter((m) => !STOCK_MARKET_IDS.includes(m.id));

const EXTRA = [
  { href: "/news", label: "뉴스 · 공시", icon: "📰" },
  { href: "/mypage", label: "마이페이지", icon: "👤" },
  { href: "/admin", label: "관리자", icon: "🛠️" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [clicks, setClicks] = useState<number[]>([]);
  const [showPrompt, setShowPrompt] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  
  const [unlockedFeatures, setUnlockedFeatures] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  const supabase = createClient();

  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUserId(session.user.id);
        const { data } = await supabase.from('profiles').select('unlocked_features').eq('id', session.user.id).single();
        if (data && data.unlocked_features) {
          setUnlockedFeatures(data.unlocked_features);
        }
      }
    };
    fetchProfile();
  }, [supabase]);

  const handleAdminClick = useCallback(() => {
    const now = Date.now();
    const recent = [...clicks.filter((t) => now - t < 2000), now];
    if (recent.length >= 3) {
      setClicks([]);
      setShowPrompt(true);
    } else {
      setClicks(recent);
    }
  }, [clicks]);

  const handleSubmit = () => {
    if (password === ADMIN_PASSWORD) {
      setShowPrompt(false);
      setPassword("");
      setError(false);
      router.push("/admin");
    } else {
      setError(true);
      setTimeout(() => setError(false), 1500);
    }
  };

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const hasEcoCalendar = unlockedFeatures.includes("eco_calendar");

  return (
    <>
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-panel">
        <Link href="/" className="flex items-center gap-3 border-b border-border px-5 py-5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-to-br from-accent/80 to-up/70 text-base font-black text-black">
            A
          </span>
          <div className="leading-tight">
            <div className="text-[15px] font-bold tracking-tight text-tx">무명</div>
            <div className="text-[11px] text-dim">가상 주식 거래소</div>
          </div>
        </Link>

        <nav className="flex-1 overflow-y-auto px-3 py-4 flex flex-col">
          <NavItem href="/" label="메인홈" icon="📈" active={isActive("/")} />
          
          <div className="mt-4 mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-dim">
            시장
          </div>
          <NavItem href="/stocks" label="주식" icon="📊" active={pathname === "/stocks" || STOCK_MARKET_IDS.some((id) => pathname.startsWith(`/markets/${id}`))} />
          {NON_STOCK_MARKETS.map((m) => (
            <NavItem
              key={m.id}
              href={`/markets/${m.id}`}
              label={m.nameKo}
              icon={m.icon}
              active={isActive(`/markets/${m.id}`)}
            />
          ))}

          <div className="mt-4 mb-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-dim">
            기타
          </div>
          {EXTRA.map((e) =>
            e.href === "/admin" ? (
              <div key={e.href}>
                <div
                  onClick={handleAdminClick}
                  className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-[13px] opacity-0 select-none"
                >
                  <span className="w-5 text-center text-sm">{e.icon}</span>
                  <span>{e.label}</span>
                </div>
              </div>
            ) : (
              <NavItem
                key={e.href}
                href={e.href}
                label={e.label}
                icon={e.icon}
                active={isActive(e.href)}
              />
            ),
          )}

          {hasEcoCalendar && (
            <NavItem href="/eco" label="경제지표 일정" icon="🗓️" active={isActive("/eco")} />
          )}

          <div className="mt-auto pt-4 pb-2">
            <Link
              href="/shop"
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] text-dim hover:bg-panel2/40 hover:text-tx transition-colors opacity-80"
            >
              <span>🔒</span>
              <span>상점에서 프로 기능 해금하기</span>
            </Link>
          </div>
        </nav>

        <div className="border-t border-border px-4 py-3 text-[10px] text-dim">
          거래시간 18:00 – 22:30
        </div>
      </aside>

      {showPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="w-80 rounded-xl border border-border bg-panel p-6 shadow-2xl">
            <h2 className="mb-1 text-[15px] font-bold text-tx">관리자 인증</h2>
            <p className="mb-4 text-[12px] text-muted">비밀번호를 입력하세요</p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="password"
              autoFocus
              className="mb-3 w-full rounded-lg border border-border bg-bg px-3 py-2 text-[13px] text-tx outline-none placeholder:text-dim focus:border-accent/50"
            />
            {error && (
              <p className="mb-2 text-[11px] text-up">비밀번호가 일치하지 않습니다</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setShowPrompt(false); setPassword(""); setError(false); }}
                className="flex-1 rounded-lg border border-border py-2 text-[13px] text-dim transition-colors hover:text-tx"
              >
                취소
              </button>
              <button
                onClick={handleSubmit}
                className="flex-1 rounded-lg bg-accent py-2 text-[13px] font-bold text-black transition-opacity hover:opacity-90"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function NavItem({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] transition-colors ${
        active
          ? "bg-panel2 text-tx font-semibold"
          : "text-muted hover:bg-panel2/60 hover:text-tx"
      }`}
    >
      <span className="w-5 text-center text-sm">{icon}</span>
      <span>{label}</span>
      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-accent" />}
    </Link>
  );
}
