import Link from "next/link";
import DashboardGate from "@/app/components/DashboardGate";

export const revalidate = 0;

export default function Home() {
  return (
    <DashboardGate>
      <StaticIntroPage />
    </DashboardGate>
  );
}

function StaticIntroPage() {
  return (
    <div className="mx-auto max-w-7xl px-6 py-10 space-y-10">
      {/* Robinhood Style Hero Banner */}
      <div className="relative overflow-hidden rounded-3xl border border-[#212631] bg-[#0E1117] p-8 md:p-12 shadow-2xl">
        <div className="relative z-10 max-w-3xl space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#F04452]/40 bg-[#F04452]/10 px-3.5 py-1 text-[11px] font-bold text-[#F04452] shadow-[0_0_12px_rgba(240,68,82,0.2)]">
            <span className="inline-block h-2 w-2 rounded-full bg-[#F04452] animate-ping" />
            LIVE SIMULATION · 실시간 자산 시장
          </div>
          <h1 className="text-3xl md:text-5xl font-black tracking-tight text-white leading-tight">
            무명 가상 주식 거래소<br />
            <span className="text-[#F04452]">
              알고리즘 시장 시뮬레이션
            </span>
          </h1>
          <p className="text-[14.5px] text-[#8E939D] leading-relaxed max-w-2xl">
            국민연금, 블랙록, 시타델 등 50개 기관 봇들이 호가창을 주고받는 자산 시장입니다. 주식, 채권, 원자재, 파생상품 옵션 시장의 가격 흐름과 체결을 실시간으로 관측할 수 있습니다.
          </p>
          <div className="pt-3 flex flex-wrap items-center gap-3">
            <Link
              href="/stocks"
              className="inline-flex items-center justify-center px-6 py-3 rounded-full bg-[#F04452] hover:bg-[#ff5252] text-white font-extrabold text-[13.5px] transition-all shadow-[0_0_20px_rgba(240,68,82,0.35)] hover:scale-[1.02] active:scale-[0.98]"
            >
              주식 시장 탐색하기
            </Link>
            <Link
              href="/shop"
              className="inline-flex items-center justify-center px-6 py-3 rounded-full border border-[#212631] bg-[#161B22] hover:bg-[#1C222D] text-white font-bold text-[13.5px] transition-all hover:border-white/20 active:scale-[0.98]"
            >
              상점 기능 해금
            </Link>
          </div>
        </div>

        {/* Decorative Financial Chart Grid */}
        <div className="absolute right-0 top-0 h-full w-1/2 opacity-15 bg-[radial-gradient(#F04452_1.5px,transparent_1.5px)] [background-size:24px_24px] pointer-events-none" />
      </div>

      {/* System Tutorial Guide */}
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-bold text-white tracking-tight">거래소 이용 가이드</h2>
          <p className="text-[12.5px] text-[#8E939D]">기초 사용 방법 및 실시간 트레이딩 순서</p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-[#212631] bg-[#0E1117] p-6 space-y-3 hover:border-white/20 transition-colors">
            <div className="text-[11px] font-mono font-bold text-[#F04452] tracking-wider">STEP 01</div>
            <h3 className="text-[15px] font-bold text-white">시장의 흐름과 종목 탐색</h3>
            <p className="text-[13px] text-[#8E939D] leading-relaxed">
              상단 메뉴의 주식, 채권, 원자재, 옵션 탭에서 다양한 자산군의 실시간 체결가와 호가창을 확인할 수 있습니다.
            </p>
          </div>

          <div className="rounded-2xl border border-[#212631] bg-[#0E1117] p-6 space-y-3 hover:border-white/20 transition-colors">
            <div className="text-[11px] font-mono font-bold text-[#F04452] tracking-wider">STEP 02</div>
            <h3 className="text-[15px] font-bold text-white">50개 기관 봇과의 실시간 거래</h3>
            <p className="text-[13px] text-[#8E939D] leading-relaxed">
              호가창에서 매수/매도 지정가 및 시장가 주문을 제출하면 50개 기관 봇들의 알고리즘 주문과 체결됩니다.
            </p>
          </div>

          <div className="rounded-2xl border border-[#212631] bg-[#0E1117] p-6 space-y-3 hover:border-white/20 transition-colors">
            <div className="text-[11px] font-mono font-bold text-[#F04452] tracking-wider">STEP 03</div>
            <h3 className="text-[15px] font-bold text-white">뉴스 탐색 및 기능 해금</h3>
            <p className="text-[13px] text-[#8E939D] leading-relaxed">
              뉴스 탭에서 시장 호재/악재 이슈를 확인하거나, 상점 페이지에서 다양한 라이선스와 기능을 해금할 수 있습니다.
            </p>
          </div>
        </div>
      </div>

      {/* Shop Custom Dashboard Unlock Banner */}
      <div className="rounded-2xl border border-[#212631] bg-[#0E1117] p-6 md:p-8 flex flex-col md:flex-row items-center justify-between gap-6 hover:border-white/20 transition-colors">
        <div className="space-y-1.5 text-center md:text-left">
          <div className="text-[11px] font-bold tracking-wider text-[#F04452] font-mono">
            FEATURE UNLOCK
          </div>
          <h3 className="text-xl font-extrabold text-white">메인 대시보드 커스텀 기능</h3>
          <p className="text-[13.5px] text-[#8E939D] max-w-xl leading-relaxed">
            상점에서 해금 기능을 획득하면 주요 시장 지수, TOP 5 상승/하락 종목, 최신 뉴스 위젯으로 구성된 메인 대시보드를 사용할 수 있습니다.
          </p>
        </div>
        <Link
          href="/shop"
          className="shrink-0 px-6 py-3 rounded-full bg-[#161B22] hover:bg-[#1F2631] text-white font-bold text-[13px] transition-all border border-[#212631] hover:border-[#F04452]/50"
        >
          상점 페이지로 이동
        </Link>
      </div>
    </div>
  );
}


