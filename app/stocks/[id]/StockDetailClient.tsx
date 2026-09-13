"use client";

import { useState } from "react";
import type { Stock, ChatMessage, PriceHistoryPoint } from "@/lib/types";
import { fmtPrice, fmtVolume, fmtCap, change, fmtSigned } from "@/lib/format";
import Orderbook from "@/app/components/Orderbook";
import TradeFeed from "@/app/components/TradeFeed";
import ChatPanel from "@/app/components/ChatPanel";
import OrderEntry from "@/app/components/OrderEntry";
import TickChart from "@/app/components/TickChart";
import FinancialPanel from "@/app/components/FinancialPanel";
import BondDetailPanel from "@/app/components/BondDetailPanel";
import OptionsPanel from "@/app/components/OptionsPanel";
import ActiveOrdersPanel from "@/app/components/ActiveOrdersPanel";

type TabId = "chart" | "orderbook" | "orders" | "history" | "info" | "news";

// ─────────────────────────────────────────────────────────────
// Default 모드용 심플 SVG 라인 차트 (priceHistory 기반)
// ─────────────────────────────────────────────────────────────
function SimpleLineChart({
  priceHistory,
  currentPrice,
  isUp,
}: {
  priceHistory: PriceHistoryPoint[];
  currentPrice: number;
  isUp: boolean;
}) {
  const points = priceHistory.length > 0 ? [...priceHistory].reverse() : [];
  const prices = points.length > 0 ? points.map((p) => Number(p.price)) : [currentPrice, currentPrice];
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);
  const range = maxP - minP || 1;
  const W = 600;
  const H = 120;
  const pad = 4;

  const coords = prices.map((p, i) => {
    const x = pad + (i / Math.max(prices.length - 1, 1)) * (W - pad * 2);
    const y = H - pad - ((p - minP) / range) * (H - pad * 2);
    return `${x},${y}`;
  });
  const pathD = `M ${coords.join(" L ")}`;

  // Gradient fill
  const fillD = `M ${pad},${H} L ${coords.join(" L ")} L ${W - pad},${H} Z`;
  const strokeColor = isUp ? "#F04452" : "#3182F6";
  const gradientId = isUp ? "gradUp" : "gradDown";
  const gradientColor = isUp ? "#F04452" : "#3182F6";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="w-full h-full"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={gradientColor} stopOpacity="0.18" />
          <stop offset="100%" stopColor={gradientColor} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillD} fill={`url(#${gradientId})`} />
      <path d={pathD} fill="none" stroke={strokeColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────
// StockDetailClient
// ─────────────────────────────────────────────────────────────
export default function StockDetailClient({
  stock,
  relatedNews,
  messages,
  tradingValueStr,
  priceHistory = [],
}: {
  stock: Stock;
  relatedNews: Array<{
    id: string;
    publisher?: string;
    headline?: string;
    content?: string;
    title?: string;
    body?: string;
    source?: string;
    sentiment?: string;
    created_at?: string;
  }>;
  messages: ChatMessage[];
  tradingValueStr: string;
  priceHistory?: PriceHistoryPoint[];
}) {
  const [isProMode, setIsProMode] = useState(true);
  const [activeTab, setActiveTab] = useState<TabId>("chart");

  const { percent, dir } = change(stock.currentPrice, stock.previousClose);
  const isUp = dir === "up";
  const changeColor = isUp ? "text-up" : dir === "down" ? "text-down" : "text-white/40";

  const tabs: { id: TabId; label: string }[] = [
    { id: "chart", label: "차트 / 호가 / 주문" },
    { id: "orderbook", label: "호가 상세 / 체결" },
    { id: "orders", label: "내 미체결" },
    { id: "history", label: "과거 기록" },
    { id: "info", label: "기업 분석" },
    { id: "news", label: "뉴스 / 주주톡" },
  ];

  // ───── DEFAULT MODE ─────
  if (!isProMode) {
    return (
      <div className="flex flex-col flex-1 h-full overflow-hidden">
        {/* PRO MODE 토글 — 우상단 */}
        <div className="flex justify-end px-4 py-2 shrink-0">
          <button
            onClick={() => setIsProMode(true)}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-xl border border-white/[0.1] bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/[0.2] transition-all text-[12px] font-bold text-white/60 hover:text-white group cursor-pointer"
          >
            <span className="text-xs opacity-70 group-hover:opacity-100 transition-opacity">⚡️</span>
            <span>PRO MODE (10분봉 & 호가창)</span>
          </button>
        </div>

        {/* 중앙 콘텐츠 */}
        <div className="flex-1 flex flex-col items-center justify-start px-6 pb-6 overflow-y-auto no-scrollbar gap-6">

          {/* 현재가 섹션 */}
          <div className="text-center space-y-1 pt-2">
            <p className="text-[12px] text-white/30 font-mono tracking-wider uppercase">{stock.ticker} · {stock.sector}</p>
            <div className={`text-5xl font-bold tabular-nums font-mono ${changeColor}`}>
              {fmtPrice(stock.currentPrice, stock.market)}
            </div>
            <div className={`font-mono text-[15px] font-semibold tabular-nums ${changeColor}`}>
              {isUp ? "▲" : dir === "down" ? "▼" : "–"} {fmtSigned(percent)}%
            </div>
          </div>

          {/* 심플 라인 차트 */}
          <div className="w-full max-w-2xl h-[160px] px-2">
            {priceHistory.length > 1 ? (
              <SimpleLineChart
                priceHistory={priceHistory}
                currentPrice={stock.currentPrice}
                isUp={isUp}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[12px] text-white/20 font-mono">
                차트 데이터 누적 중…
              </div>
            )}
          </div>

          {/* 보조 지표 행 */}
          <div className="w-full max-w-2xl grid grid-cols-4 gap-3">
            <MiniStat label="시가" value={fmtPrice(stock.openPrice, stock.market)} />
            <MiniStat label="고가" value={fmtPrice(stock.high, stock.market)} color="text-up" />
            <MiniStat label="저가" value={fmtPrice(stock.low, stock.market)} color="text-down" />
            <MiniStat label="거래량" value={fmtVolume(stock.volume)} />
          </div>

          {/* 매수 / 매도 버튼 → Pro 모드 전환 */}
          <div className="w-full max-w-sm flex gap-3">
            <button
              onClick={() => setIsProMode(true)}
              className="flex-1 py-4 rounded-2xl bg-up hover:bg-[#ff5060] text-white font-black text-[16px] transition-all active:scale-[0.97] shadow-[0_0_24px_rgba(240,68,82,0.3)] cursor-pointer"
            >
              매수 (호가창 열기)
            </button>
            <button
              onClick={() => setIsProMode(true)}
              className="flex-1 py-4 rounded-2xl bg-down hover:bg-[#4590ff] text-white font-black text-[16px] transition-all active:scale-[0.97] shadow-[0_0_24px_rgba(49,130,246,0.3)] cursor-pointer"
            >
              매도 (호가창 열기)
            </button>
          </div>

          <p className="text-xs text-white/40 font-mono -mt-2">
            ⚡️ 상단 또는 매수/매도 버튼을 눌러 10분봉 캔들차트 및 10단계 호가창을 이용하세요
          </p>
        </div>
      </div>
    );
  }

  // ───── PRO MODE ─────
  return (
    <div className="flex flex-col flex-1 min-h-0 animate-fade-in-up">
      {/* 탭 바 + PRO 토글 */}
      <div className="flex items-center border-b border-border bg-panel px-4 shrink-0 gap-2 justify-between font-sans">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-[13px] font-bold border-b-2 transition-all cursor-pointer whitespace-nowrap ${
                activeTab === tab.id
                  ? "border-[#F04452] text-up bg-up/5"
                  : "border-transparent text-muted hover:text-tx"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* PRO 토글 — 켜져 있을 때 */}
        <button
          onClick={() => setIsProMode(false)}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#F04452]/30 bg-up/10 hover:bg-up/20 transition-all text-[11.5px] font-bold text-up shrink-0 mr-1 cursor-pointer font-sans"
        >
          <span className="text-xs">⚡️</span>
          <span>HTS 터미널</span>
        </button>
      </div>

      {/* 탭 컨텐츠 */}
      <div className="flex-1 p-2 md:p-3 relative bg-bg pb-12">
        {activeTab === "chart" && (
          <div className="grid grid-cols-12 gap-3">
            {/* 좌측 (7) — 10분봉 캔들스틱 틱 차트 + 체결 피드 */}
            <div className="col-span-12 lg:col-span-7 flex flex-col gap-3">
              <div className="h-[440px] md:h-[480px] border border-border bg-panel rounded-2xl shadow-xl overflow-hidden">
                <TickChart ticker={stock.ticker} currentPrice={stock.currentPrice} />
              </div>
              <div className="h-[280px] md:h-[320px] border border-border bg-panel rounded-2xl shadow-xl overflow-hidden">
                <TradeFeed stock={stock} />
              </div>
            </div>

            {/* 우측 (5) — 10단계 실시간 호가창 + 주문 입력창 */}
            <div className="col-span-12 lg:col-span-5 flex flex-col gap-3">
              <div className="h-[440px] md:h-[480px] border border-border bg-panel rounded-2xl shadow-xl overflow-hidden">
                <Orderbook
                  ticker={stock.ticker}
                  currentPrice={stock.currentPrice}
                  stockId={stock.id}
                  openPrice={stock.openPrice || (stock as any).open_price || stock.previousClose}
                />
              </div>
              <div className="border border-border bg-panel rounded-2xl shadow-xl p-4">
                <OrderEntry stock={stock} />
              </div>
            </div>
          </div>
        )}

        {activeTab === "orderbook" && (
          <div className="grid grid-cols-12 gap-3">
            {/* 좌측 (5) — 호가창 */}
            <div className="col-span-12 lg:col-span-5 h-[520px] border border-border bg-panel rounded-2xl shadow-xl overflow-hidden">
              <Orderbook
                ticker={stock.ticker}
                currentPrice={stock.currentPrice}
                stockId={stock.id}
                openPrice={stock.openPrice || (stock as any).open_price || stock.previousClose}
              />
            </div>
            {/* 우측 (7) — 체결창 + 주문창 */}
            <div className="col-span-12 lg:col-span-7 flex flex-col gap-3">
              <div className="h-[300px] border border-border bg-panel rounded-2xl shadow-xl overflow-hidden">
                <TradeFeed stock={stock} />
              </div>
              <div className="border border-border bg-panel rounded-2xl shadow-xl p-4">
                <OrderEntry stock={stock} />
              </div>
            </div>
          </div>
        )}

        {activeTab === "orders" && (
          <div className="min-h-[400px] flex flex-col border border-border bg-panel rounded-2xl shadow-xl overflow-hidden">
            <ActiveOrdersPanel currentStockId={stock.id} />
          </div>
        )}

        {activeTab === "history" && (
          <div className="h-full overflow-hidden flex flex-col border border-border bg-panel rounded-2xl shadow-xl">
            <div className="border-b border-border px-5 py-4 bg-panel font-mono font-black text-tx text-[13.5px]">
              과거 주가 변동 기록 (TIME SERIES)
            </div>
            {priceHistory.length === 0 ? (
              <div className="p-12 text-center text-muted text-[13px] font-mono">
                저장된 과거 주가 이력이 없습니다. 엔터프라이즈 엔진 가동 시 자동으로 기록됩니다.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto no-scrollbar">
                <table className="w-full text-left border-collapse text-[12.5px] font-mono">
                  <thead>
                    <tr className="border-b border-border bg-panel2 text-muted uppercase text-xs font-extrabold">
                      <th className="py-3 px-5 border-none">기록 시각</th>
                      <th className="py-3 px-5 text-right border-none">주가 (Price)</th>
                      <th className="py-3 px-5 text-right border-none">거래량 (Volume)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {priceHistory.map((item) => (
                      <tr key={item.id} className="hover:bg-hover transition-colors">
                        <td className="py-3 px-5 text-muted font-medium border-none">
                          {new Date(item.created_at).toLocaleString("ko-KR")}
                        </td>
                        <td className="py-3 px-5 text-right font-black text-tx border-none tabular-nums">
                          {fmtPrice(Number(item.price), stock.market)}
                        </td>
                        <td className="py-3 px-5 text-right text-muted font-bold border-none tabular-nums">
                          {fmtVolume(Number(item.volume || 0))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === "info" && (
          <div className="grid grid-cols-12 gap-3 h-full overflow-y-auto no-scrollbar pb-10">
            <div className="col-span-6 flex flex-col gap-3">
              <div className="border border-border bg-panel rounded-2xl overflow-hidden shadow-xl p-5 font-mono space-y-3">
                <h3 className="text-[14px] font-black text-tx border-b border-border pb-2">기업 분석 및 스펙</h3>
                <div className="grid grid-cols-2 gap-3">
                  <Info label="섹터" value={stock.sector} />
                  <Info label="시가총액" value={fmtCap(stock.marketCap)} />
                  <Info label="거래대금" value={tradingValueStr} />
                  <Info label="거래량" value={fmtVolume(stock.volume)} />
                  <Info label="상장일" value={stock.listedAt} />
                  <Info label="전일 종가" value={fmtPrice(stock.previousClose, stock.market)} />
                </div>
              </div>

              {stock.market === "bonds" ? (
                <BondDetailPanel stock={stock} />
              ) : (
                <FinancialPanel stock={stock} />
              )}
            </div>

            <div className="col-span-6 flex flex-col gap-3">
              <OptionsPanel stockId={stock.id} ticker={stock.ticker} />
            </div>
          </div>
        )}

        {activeTab === "news" && (
          <div className="grid grid-cols-12 gap-3 h-full overflow-hidden">
            <div className="col-span-6 h-full overflow-hidden flex flex-col border border-border bg-panel rounded-2xl shadow-xl">
              <div className="border-b border-border px-5 py-4 bg-panel font-mono font-black text-tx text-[13.5px]">
                관련 뉴스 · 공시
              </div>
              <div className="flex-1 overflow-y-auto no-scrollbar p-2">
                {relatedNews.length === 0 ? (
                  <p className="px-4 py-8 text-center text-[12px] text-muted font-mono">관련 뉴스가 없습니다</p>
                ) : (
                  <div className="divide-y divide-border">
                    {relatedNews.map((n) => (
                      <div key={n.id} className="px-4 py-3.5 font-mono">
                        <div className="flex items-center gap-2">
                          <span className="rounded-full bg-panel2 border border-border px-2.5 py-0.5 text-[10px] font-bold text-muted">
                            {n.publisher || "언론사"}
                          </span>
                          <span className={`text-[10.5px] font-black rounded-full px-2 py-0.5 border ${
                            n.sentiment === "positive"
                              ? "bg-up/10 border-[#F04452]/30 text-up"
                              : n.sentiment === "negative"
                              ? "bg-down/10 border-[#3182F6]/30 text-down"
                              : "bg-panel2 border-border text-muted"
                          }`}>
                            {n.sentiment === "positive" ? "호재" : n.sentiment === "negative" ? "악재" : "중립"}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[13px] font-bold text-tx font-sans">{n.headline}</p>
                        <p className="mt-1 line-clamp-2 text-[11.5px] text-muted font-sans font-medium">{n.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="col-span-6 h-full overflow-hidden flex flex-col border border-border bg-panel rounded-2xl shadow-xl">
              <ChatPanel stockId={stock.id} initial={messages} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// 보조 컴포넌트
// ─────────────────────────────────────────────────────────────
function MiniStat({ label, value, color = "text-tx" }: { label: string; value: string; color?: string }) {
  return (
    <div className="bg-panel border border-border rounded-xl px-4 py-3 text-center">
      <div className="text-[9.5px] uppercase font-bold tracking-widest text-muted font-mono mb-1">{label}</div>
      <div className={`font-mono text-[13px] font-black tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-tx";
  return (
    <div className="bg-transparent px-3 py-3 font-mono">
      <div className="text-[10px] uppercase font-bold tracking-wider text-muted">{label}</div>
      <div className={`mt-0.5 font-mono text-[12.5px] font-black tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel2 border border-border rounded-xl px-4 py-3 font-mono">
      <div className="text-[10px] uppercase tracking-wider text-muted font-bold">{label}</div>
      <div className="mt-1 font-mono text-[13.5px] font-black tabular-nums text-tx">{value}</div>
    </div>
  );
}
