"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  { label: "대시보드", href: "/v2" },
  { label: "주식 시장", href: "/v2/stocks" },
  { label: "실시간 환전", href: "/v2/exchange" },
  { label: "AI 찌라시/뉴스", href: "/v2/news" },
  { label: "기관 포트폴리오", href: "/v2/institutions" },
  { label: "요금제/상점", href: "/v2/shop" },
];

export default function V2Navbar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-40 bg-[#0C0E12]/80 backdrop-blur-md border-b border-white/5 px-6 py-3.5">
      <div className="mx-auto max-w-7xl flex items-center justify-between">
        {/* Brand */}
        <Link href="/v2" className="flex items-center gap-2.5 group">
          <div className="h-8 w-8 rounded-xl bg-gradient-to-tr from-[#3182F6] to-[#F04452] grid place-items-center font-bold text-white text-sm shadow-md">
            S2
          </div>
          <div className="flex flex-col">
            <span className="font-bold text-white text-[15px] tracking-tight group-hover:text-[#3182F6] transition-colors">
              Antigravity <span className="text-[10px] bg-[#F04452]/20 text-[#F04452] px-1.5 py-0.5 rounded font-mono border border-[#F04452]/30 ml-1">V2</span>
            </span>
            <span className="text-[10px] text-[#6B7280] font-mono">FINTECH NEXT-GEN</span>
          </div>
        </Link>

        {/* Navigation Links */}
        <div className="hidden md:flex items-center gap-1 bg-[#151821] p-1 rounded-xl border border-white/5 text-[13px] font-medium">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/v2" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`px-3.5 py-1.5 rounded-lg transition-all ${
                  isActive
                    ? "bg-[#1C1C1E] text-white font-bold shadow-sm"
                    : "text-[#9CA3AF] hover:text-white hover:bg-white/5"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* Status Indicator */}
        <div className="flex items-center gap-3 text-[12px] font-mono">
          <span className="hidden sm:inline-flex items-center gap-1.5 text-emerald-400 font-bold bg-emerald-500/10 px-2.5 py-1 rounded-lg border border-emerald-500/20">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            ENGINE ONLINE
          </span>
        </div>
      </div>
    </nav>
  );
}
