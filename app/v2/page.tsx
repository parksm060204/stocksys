"use client";

import Link from "next/link";
import V2Card from "@/app/components/v2/V2Card";

export default function V2DashboardPage() {
  return (
    <div className="space-y-6">
      {/* Hero Welcome Banner */}
      <div className="rounded-3xl bg-gradient-to-r from-[#151821] via-[#1C1C1E] to-[#151821] p-8 border border-white/5 relative overflow-hidden shadow-lg">
        <div className="relative z-10 max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full bg-[#3182F6]/10 border border-[#3182F6]/20 px-3 py-1 text-[12px] font-mono text-[#3182F6] font-bold mb-4">
            <span>✨</span> FINTECH V2 ARCHITECTURE READY
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight leading-tight">
            토스 & 로빈후드 스타일의 <br />
            차세대 미니멀 다크 모드 V2 터미널
          </h1>
          <p className="mt-3 text-[14px] text-[#9CA3AF] leading-relaxed">
            기존 V1 라이브 버전을 그대로 유용하면서, 병렬 생성된 V2 공간에서 고성능 컴포넌트와 미니멀 다크 디자인을 실시간으로 구축하고 테스트할 수 있습니다.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/v2/stocks"
              className="rounded-xl bg-[#3182F6] px-5 py-2.5 text-[13.5px] font-bold text-white hover:bg-[#3182F6]/90 transition-all shadow-md"
            >
              V2 주식 시장 탐색하기 ➔
            </Link>
            <Link
              href="/v2/institutions"
              className="rounded-xl bg-[#1C1C1E] px-5 py-2.5 text-[13.5px] font-bold text-white hover:bg-white/10 transition-all border border-white/5"
            >
              기관 포트폴리오 관제 🏛️
            </Link>
          </div>
        </div>
      </div>

      {/* Grid of V2 Feature Modules */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <V2Card
          title="📈 V2 주식 거래소 (Stocks)"
          subtitle="KRX 상/하한가 및 해외주식 틱 단위 실시간 체결"
        >
          <p className="text-[13px] text-[#9CA3AF] mb-4">
            세로선을 완전히 제거한 미니멀 데이터 테이블과 tabular-nums 수치 최적화.
          </p>
          <Link
            href="/v2/stocks"
            className="text-[12px] font-bold text-[#3182F6] hover:underline inline-flex items-center gap-1"
          >
            V2 주식 시장으로 이동 ➔
          </Link>
        </V2Card>

        <V2Card
          title="💱 V2 다국어 환전소 (Exchange)"
          subtitle="USD, EUR, JPY, CNY, GBP 실시간 환율 및 지갑"
        >
          <p className="text-[13px] text-[#9CA3AF] mb-4">
            차콜 둥근 입력을 적용한 로빈후드 핀테크 입출금 및 환전 전용 인터페이스.
          </p>
          <Link
            href="/v2/exchange"
            className="text-[12px] font-bold text-[#3182F6] hover:underline inline-flex items-center gap-1"
          >
            V2 환전소로 이동 ➔
          </Link>
        </V2Card>

        <V2Card
          title="🏛️ V2 기관 포트폴리오 (Institutions)"
          subtitle="50개 글로벌 기관 투자자 실시간 자산 모니터링"
        >
          <p className="text-[13px] text-[#9CA3AF] mb-4">
            한국어 정규 기관 네임과 자산군별 (주식, 채권, 원자재, 현금) 델타 집계.
          </p>
          <Link
            href="/v2/institutions"
            className="text-[12px] font-bold text-[#3182F6] hover:underline inline-flex items-center gap-1"
          >
            V2 기관 터미널로 이동 ➔
          </Link>
        </V2Card>
      </div>
    </div>
  );
}
