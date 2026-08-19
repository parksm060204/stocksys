"use client";

import { useState } from "react";
import Link from "next/link";
import type { Stock, ChatMessage } from "@/lib/types";
import { fmtPrice, fmtVolume } from "@/lib/format";
import OrderEntry from "@/app/components/OrderEntry";
import StockChartV2 from "@/app/components/v2/StockChartV2";
import OrderbookV2 from "@/app/components/v2/OrderbookV2";
import TradeFeedV2 from "@/app/components/v2/TradeFeedV2";
import PriceHeroV2 from "@/app/components/v2/PriceHeroV2";
import RealtimePriceHeader from "@/app/components/RealtimePriceHeader";
import ActiveOrdersPanel from "@/app/components/ActiveOrdersPanel";

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
          ? "bg-accent text-white shadow-[0_0_16px_rgba(49,130,246,0.45)]"
          : "bg-panel2 text-dim hover:bg-white/10 hover:text-white"
      }`}
      aria-label="Pro 모드 전환"
      id="pro-mode-toggle"
    >
      <span
        className={`relative inline-flex h-4 w-7 items-center rounded-full transition-all duration-300 ${
          isProMode ? "bg-white/30" : "bg-dim/30"
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
function DefaultLayout(
  props: {
    stock: Stock;
    relatedNews: NewsItem[];
    messages: ChatMessage[];
    tradingValueStr: string;
  }
) {
  const { stock, relatedNews } = props;
  void props.messages; void props.tradingValueStr;
  return (
    <div className="flex flex-col gap-4 w-full">
      {/* ── Hero 가격 타이포그래피 ── text-7xl, tabular-nums, Toss 컬러 */}
      <PriceHeroV2 stock={stock} />

      {/* OHLCV 요약 바 — tabular-nums font-mono 강화 */}
      <div className="grid grid-cols-4 gap-px bg-panel rounded-xl overflow-hidden">
        <MetaCell label="시가" value={fmtPrice(stock.openPrice, stock.market)} />
        <MetaCell label="고가" value={fmtPrice(stock.high, stock.market)} tone="up" />
        <MetaCell label="저가" value={fmtPrice(stock.low, stock.market)} tone="down" />
        <MetaCell label="거래량" value={fmtVolume(stock.volume)} />
      </div>

      {/* 메인 차트 — 풀 와이드 (Default 선 차트) */}
      <div
        className="w-full rounded-2xl overflow-hidden bg-bg"
        style={{ height: "clamp(280px, 36vh, 460px)" }}
      >
        <StockChartV2
          ticker={stock.ticker}
          currentPrice={stock.currentPrice}
          isProMode={false}
        />
      </div>

      {/* 빅 매수/매도 버튼 — Default 모드 핵심 CTA */}
      <BigTradeButtons stock={stock} />

      {/* 하단 그리드 — 주문창 + 미체결 주문 + 관련 뉴스 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4" id="v2-order-entry">
        <div className="rounded-2xl bg-panel overflow-hidden">
          <SectionHeader title="주문" />
          <div className="p-4">
            <OrderEntry stock={stock} />
          </div>
        </div>

        <div className="rounded-2xl bg-panel overflow-hidden flex flex-col min-h-[300px]">
          <SectionHeader title="내 미체결 주문" />
          <div className="flex-1 overflow-hidden">
            <ActiveOrdersPanel currentStockId={stock.id} compact />
          </div>
        </div>

        <div className="rounded-2xl bg-panel overflow-hidden">
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
function ProLayout(
  props: {
    stock: Stock;
    relatedNews: NewsItem[];
    messages: ChatMessage[];
    tradingValueStr: string;
  }
) {
  const { stock, relatedNews, tradingValueStr } = props;
  void props.messages;
  return (
    <div
      className="grid gap-2 w-full h-full"
      style={{
        gridTemplateColumns: "1fr 320px 280px",
        gridTemplateRows: "auto 1fr 1fr",
      }}
    >
      {/* ① 차트 — 중앙 상단 tall (Pro 봉 차트 + BB + RSI) */}
      <div
        className="rounded-xl overflow-hidden bg-bg"
        style={{ gridColumn: "1", gridRow: "1 / 3" }}
      >
        <StockChartV2
          ticker={stock.ticker}
          currentPrice={stock.currentPrice}
          isProMode={true}
        />
      </div>

      {/* ② 가격 요약 바 — 차트 하단 */}
      <div
        className="rounded-xl bg-panel overflow-hidden"
        style={{ gridColumn: "1", gridRow: "3" }}
      >
        <div className="grid grid-cols-4 h-full">
          <MetaCell label="시가" value={fmtPrice(stock.openPrice, stock.market)} />
          <MetaCell label="고가" value={fmtPrice(stock.high, stock.market)} tone="up" />
          <MetaCell label="저가" value={fmtPrice(stock.low, stock.market)} tone="down" />
          <MetaCell label="거래대금" value={tradingValueStr} />
        </div>
      </div>

      {/* ③ 호가창 V2 */}
      <div
        className="rounded-xl overflow-hidden flex flex-col bg-bg"
        style={{ gridColumn: "2", gridRow: "1 / 3" }}
      >
        <OrderbookV2
          ticker={stock.ticker}
          currentPrice={stock.currentPrice}
          stockId={stock.id}
        />
      </div>

      {/* ④ 주문 패널 */}
      <div
        className="rounded-xl bg-panel overflow-hidden flex flex-col"
        style={{ gridColumn: "2", gridRow: "3" }}
      >
        <SectionHeader title="주문" />
        <div className="flex-1 overflow-y-auto p-3">
          <OrderEntry stock={stock} />
        </div>
      </div>

      {/* ⑤ 체결 피드 V2 */}
      <div
        className="rounded-xl overflow-hidden flex flex-col bg-bg"
        style={{ gridColumn: "3", gridRow: "1 / 3" }}
      >
        <TradeFeedV2 stock={stock} />
      </div>

      {/* ⑥ 뉴스 / 내 미체결 탭 패널 */}
      <div
        className="rounded-xl bg-panel overflow-hidden flex flex-col"
        style={{ gridColumn: "3", gridRow: "3" }}
      >
        <ProSideTabSection relatedNews={relatedNews} stockId={stock.id} />
      </div>
    </div>
  );
}

function ProSideTabSection({ relatedNews, stockId }: { relatedNews: NewsItem[]; stockId: string }) {
  const [tab, setTab] = useState<'news' | 'orders'>('orders');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between border-b border-border bg-panel2 px-3 py-1.5 shrink-0">
        <div className="flex gap-1">
          <button
            onClick={() => setTab('orders')}
            className={`px-2.5 py-0.5 rounded text-[11px] font-bold transition-colors cursor-pointer ${
              tab === 'orders' ? 'bg-accent/20 text-accent border border-accent/40' : 'text-dim hover:text-white'
            }`}
          >
            내 미체결
          </button>
          <button
            onClick={() => setTab('news')}
            className={`px-2.5 py-0.5 rounded text-[11px] font-bold transition-colors cursor-pointer ${
              tab === 'news' ? 'bg-accent/20 text-accent border border-accent/40' : 'text-dim hover:text-white'
            }`}
          >
            뉴스
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {tab === 'orders' ? (
          <ActiveOrdersPanel currentStockId={stockId} compact />
        ) : (
          <NewsList news={relatedNews} compact />
        )}
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
      className={`flex flex-col bg-black text-tx font-sans transition-all duration-300 ${
        isProMode ? "h-screen overflow-hidden" : "min-h-screen"
      }`}
    >
      {/* ── 헤더 ── */}
      <header className="shrink-0 px-4 pt-3 pb-2 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          {/* 브레드크럼 */}
          <nav className="flex items-center gap-1.5 text-[11px] text-dim">
            <Link href="/v2" className="hover:text-white transition-colors">홈</Link>
            <span>/</span>
            <Link href="/v2/stocks" className="hover:text-white transition-colors">주식</Link>
            <span>/</span>
            <span className="text-muted">{stock.name}</span>
          </nav>

          {/* 종목명 + 배지 */}
          <div className="flex items-center gap-2.5 mt-0.5">
            <h1 className="text-[22px] font-bold text-white tracking-tight leading-none">
              {stock.name}
            </h1>
            <span className="rounded-md bg-panel2 px-2 py-0.5 font-mono text-[11px] text-muted">
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
      <div className="h-px bg-panel2 mx-4 mb-3 shrink-0" />

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
        <div className="shrink-0 px-4 pb-2 flex items-center gap-2 text-[10px] text-dim">
          <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
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
    <div className="flex items-center justify-between px-3 py-2 border-b border-panel2 shrink-0">
      <span className="text-[11px] font-bold text-muted uppercase tracking-widest">
        {title}
      </span>
      {badge && (
        <span className="text-[9px] font-bold text-accent bg-accent/10 px-1.5 py-px rounded tracking-widest">
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
  const colorClass =
    tone === "up" ? "text-bid" : tone === "down" ? "text-ask" : "text-tx";
  return (
    <div className="px-4 py-3 bg-panel">
      <div className="text-[9px] text-dim uppercase tracking-widest mb-1.5 font-semibold">
        {label}
      </div>
      <div className={`font-mono text-[13px] tabular-nums font-bold leading-none ${colorClass}`}>
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
      <p className="px-4 py-6 text-center text-[11px] text-dim">
        관련 뉴스 없음
      </p>
    );
  }
  return (
    <div className="divide-y divide-panel2">
      {news.map((n) => (
        <div key={n.id} className={`px-4 ${compact ? "py-2" : "py-3"}`}>
          <div className="flex items-center gap-1.5 mb-1">
            <span
              className={`rounded px-1.5 py-px text-[9px] font-bold ${
                n.sentiment === "positive"
                  ? "bg-bid/15 text-bid"
                  : n.sentiment === "negative"
                  ? "bg-ask/15 text-ask"
                  : "bg-panel2 text-dim"
              }`}
            >
              {n.sentiment === "positive"
                ? "호재"
                : n.sentiment === "negative"
                ? "악재"
                : "중립"}
            </span>
            <span className="text-[9px] text-dim">
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
            <p className="mt-0.5 text-[11px] text-dim line-clamp-1">
              {n.content}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   BigTradeButtons — Default 모드 핵심 CTA
   클릭 시 주문창으로 스크롤
───────────────────────────────────────────────────────── */
function BigTradeButtons({ stock }: { stock: Stock }) {
  const isUSD =
    stock.market === "overseas" ||
    stock.market === "europe" ||
    stock.market === "commodities";
  const currency = isUSD ? "$" : "₩";
  const priceStr = isUSD
    ? stock.currentPrice.toFixed(2)
    : Math.round(stock.currentPrice).toLocaleString();

  const scrollToOrder = () => {
    const el = document.getElementById("v2-order-entry");
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="w-full grid grid-cols-2 gap-3">
      {/* ── 매수 버튼 ── */}
      <button
        onClick={scrollToOrder}
        id="v2-buy-btn"
        className="group relative flex flex-col items-center justify-center rounded-2xl py-8 px-6 overflow-hidden cursor-pointer transition-all duration-200 active:scale-[0.98] bg-bid/8 border border-bid/15 hover:bg-bid/12"
        aria-label="매수"
      >
        <span className="relative z-10 text-[11px] font-semibold tracking-widest uppercase text-bid/60 mb-2">
          매수 Buy
        </span>
        <span className="relative z-10 font-mono text-[28px] font-black tabular-nums text-bid leading-none">
          {currency}{priceStr}
        </span>
        <span className="relative z-10 text-[12px] text-bid/50 mt-2 font-medium">
          {stock.name} · {stock.ticker}
        </span>
        <span className="relative z-10 mt-4 text-[20px] opacity-60">↑</span>
      </button>

      {/* ── 매도 버튼 ── */}
      <button
        onClick={scrollToOrder}
        id="v2-sell-btn"
        className="group relative flex flex-col items-center justify-center rounded-2xl py-8 px-6 overflow-hidden cursor-pointer transition-all duration-200 active:scale-[0.98] bg-ask/8 border border-ask/15 hover:bg-ask/12"
        aria-label="매도"
      >
        <span className="relative z-10 text-[11px] font-semibold tracking-widest uppercase text-ask/60 mb-2">
          매도 Sell
        </span>
        <span className="relative z-10 font-mono text-[28px] font-black tabular-nums text-ask leading-none">
          {currency}{priceStr}
        </span>
        <span className="relative z-10 text-[12px] text-ask/50 mt-2 font-medium">
          {stock.name} · {stock.ticker}
        </span>
        <span className="relative z-10 mt-4 text-[20px] opacity-60">↓</span>
      </button>
    </div>
  );
}
