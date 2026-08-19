"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export default function V2VersionToggle() {
  const pathname = usePathname();
  const isV2 = pathname.startsWith("/v2");

  const v1Target = isV2 ? pathname.replace(/^\/v2/, "") || "/" : pathname;
  const v2Target = isV2 ? pathname : `/v2${pathname === "/" ? "" : pathname}`;

  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-1.5 rounded-full bg-[#151821]/90 backdrop-blur-md p-1.5 border border-white/10 shadow-2xl font-mono text-[12px] transition-all">
      <Link
        href={v1Target}
        className={`px-3 py-1.5 rounded-full font-bold transition-all ${
          !isV2
            ? "bg-[#3182F6] text-white shadow-sm"
            : "text-[#9CA3AF] hover:text-white hover:bg-white/5"
        }`}
      >
        V1 라이브
      </Link>
      <Link
        href={v2Target}
        className={`px-3 py-1.5 rounded-full font-bold transition-all flex items-center gap-1.5 ${
          isV2
            ? "bg-[#F04452] text-white shadow-sm"
            : "text-[#9CA3AF] hover:text-white hover:bg-white/5"
        }`}
      >
        <span className="h-2 w-2 rounded-full bg-white animate-ping" />
        V2 베타
      </Link>
    </div>
  );
}
