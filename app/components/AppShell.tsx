"use client";

import { Suspense, useState, useEffect } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden bg-bg text-tx">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <NavigationProgress />
        <main className="flex-1 overflow-y-auto relative">
          <Suspense fallback={<PageLoadingSkeleton />}>
            {children}
          </Suspense>
        </main>
      </div>
    </div>
  );
}

/**
 * Thin progress bar at the top of the main area that appears
 * instantly when a route change is detected.
 */
function NavigationProgress() {
  return (
    <Suspense fallback={null}>
      <NavigationProgressInner />
    </Suspense>
  );
}

function NavigationProgressInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [navigating, setNavigating] = useState(false);

  // Track route changes
  useEffect(() => {
    setNavigating(true);
    const timer = setTimeout(() => setNavigating(false), 300);
    return () => clearTimeout(timer);
  }, [pathname, searchParams]);

  if (!navigating) return null;

  return (
    <div className="absolute left-0 right-0 top-0 z-50 h-0.5 overflow-hidden">
      <div className="h-full w-1/3 animate-[slideProgress_1s_ease-in-out_infinite] bg-[#3182F6] rounded-full" />
    </div>
  );
}

function PageLoadingSkeleton() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-10 space-y-6 animate-pulse">
      {/* Title area */}
      <div className="space-y-2">
        <div className="h-6 w-52 rounded bg-[#222736]" />
        <div className="h-3 w-80 rounded bg-[#1c2030]" />
      </div>
      {/* Content cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="rounded-xl border border-[#222736] bg-[#151821] p-5 space-y-3">
            <div className="h-4 w-28 rounded bg-[#222736]" />
            <div className="h-7 w-40 rounded bg-[#222736]" />
            <div className="h-3 w-full rounded bg-[#1c2030]" />
          </div>
        ))}
      </div>
      <div className="flex items-center justify-center gap-2 pt-4 text-[12px] text-dim">
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[#3182F6] border-t-transparent" />
        페이지 불러오는 중...
      </div>
    </div>
  );
}
