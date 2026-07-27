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
  { href: "/institutions", label: "기관 포트폴리오", icon: "🏛️" },
  { href: "/news", label: "뉴스 · 공시", icon: "📰" },
  { href: "/exchange", label: "환전소", icon: "💱" },
  { href: "/shop", label: "상점", icon: "🛒" },
  { href: "/mypage", label: "마이페이지", icon: "👤" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [clicks, setClicks] = useState<number[]>([]);
  const [showPrompt, setShowPrompt] = useState(false);
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  
  const [unlockedFeatures, setUnlockedFeatures] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  const supabase = createClient();

  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        const { data } = await supabase.from('profiles').select('is_admin, unlocked_features').eq('id', session.user.id).single();
        if (data) {
          setIsAdmin(data.is_admin || false);
          if (data.unlocked_features) setUnlockedFeatures(data.unlocked_features);
        }
      }
    };
    fetchProfile();
  }, [supabase]);

  const handleAdminClick = useCallback(() => {
    if (isAdmin) {
      router.push("/admin");
      return;
    }
    const now = Date.now();
    const recent = [...clicks.filter((t) => now - t < 2000), now];
    if (recent.length >= 3) {
      setClicks([]);
      setShowPrompt(true);
    } else {
      setClicks(recent);
    }
  }, [clicks, isAdmin, router]);

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

  const hasEcoCalendar = unlockedFeatures.includes("eco_calendar") || isAdmin;

  return (
    <>
      <aside className="flex w-56 shrink-0 flex-col border-r border-[#222736] bg-[#12151e]">
        {/* Brand Header */}
        <Link href="/" className="flex items-center gap-3 border-b border-[#222736] px-5 py-4">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#3182F6] text-xs font-black text-white">
            M
          </div>
          <div className="leading-tight">
            <div className="text-[14px] font-bold tracking-tight text-tx">무명증권</div>
            <div className="text-[10px] text-muted">Virtual Exchange</div>
          </div>
        </Link>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-4 flex flex-col gap-0.5">
          <NavItem href="/" label="메인홈" icon="📈" active={isActive("/")} />
          
          <div className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-dim">
            시장
          </div>
          <NavItem href="/stocks" label="주식" icon="📊" active={pathname === "/stocks" || STOCK_MARKET_IDS.some((id) => pathname.startsWith(`/markets/${id}`))} />
          {NON_STOCK_MARKETS.map((m) => {
            const isCustom = ['commodities', 'options', 'etf'].includes(m.id);
            const href = isCustom ? `/${m.id}` : `/markets/${m.id}`;
            return (
              <NavItem
                key={m.id}
                href={href}
                label={m.nameKo}
                icon={m.icon}
                active={isActive(href)}
              />
            );
          })}

          <div className="mt-4 mb-1 px-3 text-[10px] font-semibold uppercase tracking-wider text-dim">
            서비스
          </div>
          {EXTRA.map((e) => (
            <NavItem
              key={e.href}
              href={e.href}
              label={e.label}
              icon={e.icon}
              active={isActive(e.href)}
            />
          ))}

          {hasEcoCalendar && (
            <NavItem href="/eco" label="경제지표 일정" icon="🗓️" active={isActive("/eco")} />
          )}

          {(isAdmin || unlockedFeatures.includes("super_admin")) && (
            <NavItem href="/admin" label="👑 관리자 센터" icon="⚡" active={isActive("/admin")} />
          )}
        </nav>

        {/* Footer */}
        <div className="border-t border-[#222736] px-4 py-3 text-[11px] text-dim flex flex-col gap-1">
          <div className="text-[10px]">정규 거래시간 18:00 – 22:30</div>
          <div
            onClick={handleAdminClick}
            className="cursor-pointer rounded py-0.5 text-[10px] text-dim/60 hover:text-dim transition-colors select-none text-center font-bold"
          >
            {isAdmin ? "👑 슈퍼 관리자 모드" : "관리자"}
          </div>
        </div>
      </aside>

      {showPrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
          <div className="w-80 rounded-xl border border-[#222736] bg-[#151821] p-6 shadow-xl">
            <h2 className="mb-1 text-[15px] font-bold text-tx">관리자 인증</h2>
            <p className="mb-4 text-[12px] text-muted">비밀번호를 입력하세요</p>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              placeholder="비밀번호"
              autoFocus
              className="mb-3 w-full rounded-lg border border-[#222736] bg-[#0c0e12] px-3 py-2 text-[13px] text-tx outline-none placeholder:text-dim focus:border-[#3182F6]"
            />
            {error && (
              <p className="mb-2 text-[11px] text-up">비밀번호가 일치하지 않습니다</p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => { setShowPrompt(false); setPassword(""); setError(false); }}
                className="flex-1 rounded-lg border border-[#222736] py-2 text-[12px] text-dim transition-colors hover:text-tx"
              >
                취소
              </button>
              <button
                onClick={handleSubmit}
                className="flex-1 rounded-lg bg-[#3182F6] py-2 text-[12px] font-bold text-white transition-opacity hover:opacity-90"
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
      className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13px] font-medium transition-colors ${
        active
          ? "bg-[#1f2433] text-white font-semibold"
          : "text-[#9ca3af] hover:bg-[#191d29] hover:text-white"
      }`}
    >
      <span className="text-sm opacity-80">{icon}</span>
      <span>{label}</span>
      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#3182F6]" />}
    </Link>
  );
}
