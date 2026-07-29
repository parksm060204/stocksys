"use client";

import { useState } from "react";
import type { Stock, ChatMessage } from "@/lib/types";
import { fmtPrice, fmtVolume, fmtCap } from "@/lib/format";
import Orderbook from "@/app/components/Orderbook";
import TradeFeed from "@/app/components/TradeFeed";
import ChatPanel from "@/app/components/ChatPanel";
import OrderEntry from "@/app/components/OrderEntry";
import TickChart from "@/app/components/TickChart";
import FinancialPanel from "@/app/components/FinancialPanel";
import BondDetailPanel from "@/app/components/BondDetailPanel";
import OptionsPanel from "@/app/components/OptionsPanel";
import RealtimePriceHeader from "@/app/components/RealtimePriceHeader";

/* ─────────────────────────────────────────────────────────
   Types
───────────────────────────────────────────────────────── */
type NewsItem = {
  id: string;
  publisher?: string;
  headline?: string;
  content?: string;
  title?: string;
  body?: string;
  source?: string;
  sentiment?: string;
  created_at?: string;
};

/* ─────────────────────────────────────────────────────────
   Pro Mode Toggle Switch
───────────────────────────────────────────────────────── */
function ProToggle({
  isProMode,
  onToggle,
}: {
  isProMode: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`group relative flex items-center gap-2 rounded-full px-4 py-1.5 text-[12px] font-bold tracking-wide transition-all duration-300 cursor-pointer select-none ${
        isProMode
          ? "bg-[#3182F6] text-white shadow-[0_0_16px_rgba(49,130,246,0.45)]"
          : "bg-[#1C1C1E] text-[#6B7280] hover:bg-[#252525] hover:text-white"
      }`}
      aria-label="Pro 모드 전환"
      id="pro-mode-toggle"
    >
      {/* 슬라이딩 인디케이터 */}
      <span
        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-all duration-300 ${
          isProMode ? "bg-white/30" : "bg-[#333]"
        }`}
      >
        <span
          className={`inline-block h-2.5 w-2.5 rounded-full bg-white shadow transition-transform duration-300 ${
            isProMode ? "translate-x-3.5" : "translate-x-0.5"
          }`}
        />
      </span>
      <span className="flex items-center gap-1">
        <span>⚡</span>
        <span>Pro</span>
      </span>
    </button>
  );
}

/* ─────────────────────────────────────────────────────────
   Default Mode — 단일 컬럼 (차트 중심)
───────────────────────────────────────────────────────── */
function DefaultLayout({
  stock,
  relatedNews,
  messages,
  tradingValueStr,
}: {
  stock: Stock;
  relatedNews: NewsItem[];
  messages: ChatMessage[];
  tradingValueStr: string;
}) {
  return (
    <div className="flex flex-col gap-4 w-full">
      {/* 가격 요약 바 */}
      <div className="grid grid-cols-4 gap-px bg-[#1C1C1E] rounded-xl overflow-hidden">
        <MetaCell label="시가" value={fmtPrice(stock.openPrice, stock.market)} />
        <MetaCell label="고가" value={fmtPrice(stock.high, stock.market)} tone="up" />
        <MetaCell label="저가" value={fmtPrice(stock.low, stock.market)} tone="down" />
        <MetaCell label="거래량" value={fmtVolume(stock.volume)} />
      </div>

      {/* 메인 차트 — 풀 와이드 */}
      <div
        className="w-full rounded-2xl overflow-hidden bg-[#111316]"
        style={{ height: "clamp(320px, 42vh, 520px)" }}
      >
        <TickChart ticker={stock.ticker} currentPrice={stock.currentPrice} />
      </div>

      {/* 하단 2단 — 주문창 + 뉴스 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl bg-[#111316] overflow-hidden">
          <SectionHeader title="주문" />
          <div className="p-4">
            <OrderEntry stock={stock} />
          </div>
        </div>

        <div className="rounded-2xl bg-[#111316] overflow-hidden">
          <SectionHeader title="관련 뉴스" />
          <NewsList news={relatedNews} />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Pro Mode — 3단 HTS 레이아웃
───────────────────────────────────────────────────────── */
function ProLayout({
  stock,
  relatedNews,
  messages,
  tradingValueStr,
}: {
  stock: Stock;
  relatedNews: NewsItem[];
  messages: ChatMessage[];
  tradingValueStr: string;
}) {
  return (
    <div
      className="grid gap-2 w-full h-full"
      style={{
        gridTemplateColumns: "1fr 320px 280px",
        gridTemplateRows: "auto 1fr 1fr",
      }}
    >
      {/* ① 차트 — 중앙 상단 tall */}
      <div
        className="rounded-xl bg-[#111316] overflow-hidden"
        style={{ gridColumn: "1", gridRow: "1 / 3" }}
      >
        <SectionHeader title="틱 차트" badge="LIVE" />
        <div style={{ height: "calc(100% - 36px)" }}>
          <TickChart ticker={stock.ticker} currentPrice={stock.currentPrice} />
        </div>
      </div>

      {/* ② 가격 요약 바 — 차트 하단 */}
      <div
        className="rounded-xl bg-[#111316] overflow-hidden"
        style={{ gridColumn: "1", gridRow: "3" }}
      >
        <div className="grid grid-cols-4 h-full">
          <MetaCell label="시가" value={fmtPrice(stock.openPrice, stock.market)} />
          <MetaCell label="고가" value={fmtPrice(stock.high, stock.market)} tone="up" />
          <MetaCell label="저가" value={fmtPrice(stock.low, stock.market)} tone="down" />
          <MetaCell label="거래대금" value={tradingValueStr} />
        </div>
      </div>

      {/* ③ 호가창 — 우측 상단 */}
      <div
        className="rounded-xl bg-[#111316] overflow-hidden flex flex-col"
        style={{ gridColumn: "2", gridRow: "1 / 3" }}
      >
        <SectionHeader title="호가" badge="매도/매수" />
        <div className="flex-1 overflow-hidden">
          <Orderbook
            ticker={stock.ticker}
            currentPrice={stock.currentPrice}
            stockId={stock.id}
          />
        </div>
      </div>

      {/* ④ 주문 패널 — 우측 하단 */}
      <div
        className="rounded-xl bg-[#111316] overflow-hidden flex flex-col"
        style={{ gridColumn: "2", gridRow: "3" }}
      >
        <SectionHeader title="주문" />
        <div className="flex-1 overflow-y-auto p-3">
          <OrderEntry stock={stock} />
        </div>
      </div>

      {/* ⑤ 체결 피드 — 맨 우측 상단 */}
      <div
        className="rounded-xl bg-[#111316] overflow-hidden flex flex-col"
        style={{ gridColumn: "3", gridRow: "1 / 3" }}
      >
        <SectionHeader title="실시간 체결" badge="FEED" />
        <div className="flex-1 overflow-hidden">
          <TradeFeed stock={stock} />
        </div>
      </div>

      {/* ⑥ 뉴스 — 맨 우측 하단 */}
      <div
        className="rounded-xl bg-[#111316] overflow-hidden flex flex-col"
        style={{ gridColumn: "3", gridRow: "3" }}
      >
        <SectionHeader title="뉴스" />
        <div className="flex-1 overflow-y-auto">
          <NewsList news={relatedNews} compact />
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Main Export
───────────────────────────────────────────────────────── */
export default function StockDetailV2Client({
  stock,
  relatedNews,
  messages,
  tradingValueStr,
}: {
  stock: Stock;
  relatedNews: NewsItem[];
  messages: ChatMessage[];
  tradingValueStr: string;
}) {
  const [isProMode, setIsProMode] = useState(false);

  return (
    <div
      className={`flex flex-col bg-black text-[#E6EDF6] font-sans transition-all duration-300 ${
        isProMode ? "h-screen overflow-hidden" : "min-h-screen"
      }`}
    >
      {/* ── 헤더 ── */}
      <header className="shrink-0 px-4 pt-3 pb-2 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          {/* 브레드크럼 */}
          <nav className="flex items-center gap-1.5 text-[11px] text-[#6B7280]">
            <a href="/v2" className="hover:text-white transition-colors">홈</a>
            <span>/</span>
            <a href="/v2/stocks" className="hover:text-white transition-colors">주식</a>
            <span>/</span>
            <span className="text-[#9CA3AF]">{stock.name}</span>
          </nav>

          {/* 종목명 + 배지 */}
          <div className="flex items-center gap-2.5 mt-0.5">
            <h1 className="text-[22px] font-bold text-white tracking-tight leading-none">
              {stock.name}
            </h1>
            <span className="rounded-md bg-[#1C1C1E] px-2 py-0.5 font-mono text-[11px] text-[#9CA3AF]">
              {stock.ticker}
            </span>
            {stock.isCore && (
              <span className="rounded-md bg-yellow-500/15 px-2 py-0.5 text-[10px] font-bold text-yellow-400 tracking-wider">
                CORE
              </span>
            )}
          </div>
        </div>

        {/* 우측: 실시간 가격 + Pro 토글 */}
        <div className="flex items-center gap-4">
          <RealtimePriceHeader stock={stock} />
          <ProToggle isProMode={isProMode} onToggle={() => setIsProMode((v) => !v)} />
        </div>
      </header>

      {/* ── 구분선 ── */}
      <div className="h-px bg-[#1C1C1E] mx-4 mb-3 shrink-0" />

      {/* ── 레이아웃 전환 ── */}
      <main
        className={`flex-1 px-4 pb-4 transition-all duration-500 ${
          isProMode ? "overflow-hidden" : "overflow-y-auto"
        }`}
        style={isProMode ? { display: "grid" } : undefined}
      >
        {isProMode ? (
          <ProLayout
            stock={stock}
            relatedNews={relatedNews}
            messages={messages}
            tradingValueStr={tradingValueStr}
          />
        ) : (
          <DefaultLayout
            stock={stock}
            relatedNews={relatedNews}
            messages={messages}
            tradingValueStr={tradingValueStr}
          />
        )}
      </main>

      {/* ── 모드 전환 애니메이션 오버레이 힌트 ── */}
      {isProMode && (
        <div className="shrink-0 px-4 pb-2 flex items-center gap-2 text-[10px] text-[#374151]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#3182F6] animate-pulse" />
          HTS Pro 모드 — 3단 레이아웃 활성화됨
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   Sub-components
───────────────────────────────────────────────────────── */
function SectionHeader({ title, badge }: { title: string; badge?: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-[#1C1C1E] shrink-0">
      <span className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-widest">
        {title}
      </span>
      {badge && (
        <span className="text-[9px] font-bold text-[#3182F6] bg-[#3182F6]/10 px-1.5 py-px rounded tracking-widest">
          {badge}
        </span>
      )}
    </div>
  );
}

function MetaCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
}) {
  const color =
    tone === "up"
      ? "text-[#F04452]"
      : tone === "down"
      ? "text-[#3182F6]"
      : "text-white";
  return (
    <div className="px-4 py-3">
      <div className="text-[10px] text-[#6B7280] uppercase tracking-widest mb-1">
        {label}
      </div>
      <div className={`font-mono text-[13px] tabular-nums font-bold ${color}`}>
        {value}
      </div>
    </div>
  );
}

function NewsList({
  news,
  compact = false,
}: {
  news: NewsItem[];
  compact?: boolean;
}) {
  if (news.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-[11px] text-[#6B7280]">
        관련 뉴스 없음
      </p>
    );
  }
  return (
    <div className="divide-y divide-[#1C1C1E]">
      {news.map((n) => (
        <div key={n.id} className={`px-4 ${compact ? "py-2" : "py-3"}`}>
          <div className="flex items-center gap-1.5 mb-1">
            <span
              className={`rounded px-1.5 py-px text-[9px] font-bold ${
                n.sentiment === "positive"
                  ? "bg-[#F04452]/15 text-[#F04452]"
                  : n.sentiment === "negative"
                  ? "bg-[#3182F6]/15 text-[#3182F6]"
                  : "bg-[#1C1C1E] text-[#6B7280]"
              }`}
            >
              {n.sentiment === "positive"
                ? "호재"
                : n.sentiment === "negative"
                ? "악재"
                : "중립"}
            </span>
            <span className="text-[9px] text-[#4B5563]">
              {n.publisher || "언론사"}
            </span>
          </div>
          <p
            className={`text-white font-medium leading-snug ${
              compact ? "text-[11px] line-clamp-1" : "text-[12px] line-clamp-2"
            }`}
          >
            {n.headline}
          </p>
          {!compact && (
            <p className="mt-0.5 text-[11px] text-[#6B7280] line-clamp-1">
              {n.content}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
