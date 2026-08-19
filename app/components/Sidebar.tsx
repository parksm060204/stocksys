"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, useCallback, useEffect } from "react";
import { MARKETS } from "@/lib/constants";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/auth/useAuth";

const STOCK_MARKET_IDS = ["domestic", "overseas", "europe"];
const NON_STOCK_MARKETS = MARKETS.filter((m) => !STOCK_MARKET_IDS.includes(m.id));

// Sleek SVG Icon Helper
function SidebarIcon({ name }: { name: string }) {
  switch (name) {
    case "home":
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      );
    case "stocks":
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      );
    case "bonds":
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    case "commodities":
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      );
    case "options":
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
        </svg>
      );
    case "etf":
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      );
    case "institutions":
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5m0 0h4m-4 0v-4a1 1 0 011-1h2a1 1 0 011 1v4m-6 0h6" />
        </svg>
      );
    case "news":
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 20H5a2 2 0 01-2-2V6a2 2 0 012-2h10a2 2 0 012 2v1m2 13a2 2 0 01-2-2V7m2 13a2 2 0 002-2V9a2 2 0 00-2-2h-2m-4-3H9M7 16h6M7 8h6v4H7V8z" />
        </svg>
      );
    case "exchange":
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      );
    case "shop":
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
        </svg>
      );
    case "mypage":
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      );
    case "eco":
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    case "admin":
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      );
    default:
      return (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      );
  }
}

const EXTRA = [
  { href: "/institutions", label: "기관 포트폴리오", icon: "institutions" },
  { href: "/news", label: "뉴스 · 공시", icon: "news" },
  { href: "/exchange", label: "환전소", icon: "exchange" },
  { href: "/shop", label: "상점", icon: "shop" },
  { href: "/mypage", label: "마이페이지", icon: "mypage" },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  
  const [unlockedFeatures, setUnlockedFeatures] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  const supabase = createClient();
  const { userId, isLoggedIn } = useAuth();

  useEffect(() => {
    const fetchProfile = async () => {
      if (isLoggedIn && userId) {
        const { data } = await supabase.from('profiles').select('is_admin, unlocked_features').eq('id', userId).single();
        if (data) {
          setIsAdmin(data.is_admin || false);
          if (data.unlocked_features) setUnlockedFeatures(data.unlocked_features);
        }
      }
    };
    fetchProfile();
  }, [supabase, isLoggedIn, userId]);

  const handleAdminClick = useCallback(() => {
    if (isAdmin) {
      router.push("/admin");
    } else {
      alert("관리자 권한이 있는 계정으로 로그인해야 접근 가능합니다.");
    }
  }, [isAdmin, router]);

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const hasEcoCalendar = unlockedFeatures.includes("eco_calendar") || isAdmin;

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-[#212631] bg-[#090B0F]">
      {/* Robinhood Style Brand Header */}
      <Link href="/" className="flex items-center gap-3 border-b border-[#212631] px-5 py-4 group">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#F04452] text-xs font-black text-white shadow-[0_0_12px_rgba(240,68,82,0.4)] group-hover:scale-105 transition-transform">
          <svg className="h-4 w-4 fill-current" viewBox="0 0 24 24">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
        </div>
        <div className="leading-tight">
          <div className="text-[14px] font-extrabold tracking-tight text-white group-hover:text-[#F04452] transition-colors">무명증권</div>
          <div className="text-[10px] text-[#8E939D] font-medium tracking-wide">ROBINHOOD SIM</div>
        </div>
      </Link>


      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4 flex flex-col gap-1">
        <NavItem href="/" label="메인홈" icon="home" active={isActive("/")} />
        
        <div className="mt-5 mb-1 px-3 text-[10px] font-bold uppercase tracking-wider text-[#565A63]">
          MARKETS
        </div>
        <NavItem href="/stocks" label="주식" icon="stocks" active={pathname === "/stocks" || STOCK_MARKET_IDS.some((id) => pathname.startsWith(`/markets/${id}`))} />
        {NON_STOCK_MARKETS.map((m) => {
          const isCustom = ['commodities', 'options', 'etf'].includes(m.id);
          const href = isCustom ? `/${m.id}` : `/markets/${m.id}`;
          const iconName = m.id === 'bonds' ? 'bonds' : m.id === 'commodities' ? 'commodities' : m.id === 'options' ? 'options' : 'etf';
          return (
            <NavItem
              key={m.id}
              href={href}
              label={m.nameKo}
              icon={iconName}
              active={isActive(href)}
            />
          );
        })}

        <div className="mt-5 mb-1 px-3 text-[10px] font-bold uppercase tracking-wider text-[#565A63]">
          SERVICES
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
          <NavItem href="/eco" label="경제지표 일정" icon="eco" active={isActive("/eco")} />
        )}

        {(isAdmin || unlockedFeatures.includes("super_admin")) && (
          <NavItem href="/admin" label="관리자 센터" icon="admin" active={isActive("/admin")} />
        )}
      </nav>

      {/* Footer */}
      <div className="border-t border-[#212631] px-4 py-3 text-[11px] text-[#565A63] flex flex-col gap-1.5">
        <div className="text-[10px] font-mono tracking-tight text-[#8E939D]">정규 장 18:00 – 22:30</div>
        <div
          onClick={handleAdminClick}
          className="cursor-pointer rounded py-1 text-[10px] text-[#8E939D]/70 hover:text-white hover:bg-[#161B22] transition-all select-none text-center font-bold"
        >
          {isAdmin ? "👑 슈퍼 관리자 모드" : "관리자 센터"}
        </div>
      </div>
    </aside>
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
      className={`flex items-center gap-3 rounded-xl px-3 py-2 text-[13px] font-medium transition-all ${
        active
          ? "bg-[#161B22] text-white font-bold border border-white/10 shadow-sm"
          : "text-[#8E939D] hover:bg-[#12161F] hover:text-white"
      }`}
    >
      <span className={`transition-colors ${active ? "text-[#F04452]" : "text-[#8E939D]"}`}>
        <SidebarIcon name={icon} />
      </span>
      <span>{label}</span>
      {active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-[#F04452] shadow-[0_0_6px_#F04452]" />}
    </Link>
  );
}


