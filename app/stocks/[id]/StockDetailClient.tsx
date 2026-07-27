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
import StrictWidget from "@/app/components/StrictWidget";

type TabId = "chart" | "orderbook" | "info" | "news";

export default function StockDetailClient({
  stock,
  relatedNews,
  messages,
  tradingValueStr,
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
}) {
  const [activeTab, setActiveTab] = useState<TabId>("chart");

  const tabs: { id: TabId; label: string }[] = [
    { id: "chart", label: "차트 / 주문" },
    { id: "orderbook", label: "호가 / 체결" },
    { id: "info", label: "기업 분석" },
    { id: "news", label: "뉴스 / 주주톡" },
  ];

  return (
    <div className="flex flex-col flex-1 overflow-hidden h-full">
      {/* 탭 바 */}
      <div className="flex border-b border-[#222] bg-[#0a0a0a] px-2 shrink-0">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-6 py-3 text-[13px] font-bold border-b-2 transition-all cursor-pointer ${
              activeTab === tab.id
                ? "border-accent text-accent bg-accent/5"
                : "border-transparent text-gray-500 hover:text-gray-300"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 탭 컨텐츠 영역 */}
      <div className="flex-1 overflow-hidden p-2 relative h-full">
        {activeTab === "chart" && (
          <div className="grid grid-cols-12 gap-2 h-full overflow-hidden">
            {/* 좌측 (8) - 틱 차트 */}
            <div className="col-span-8 flex flex-col gap-2 h-full overflow-hidden">
              <div className="flex-1 overflow-hidden">
                <TickChart ticker={stock.ticker} currentPrice={stock.currentPrice} />
              </div>
              <StrictWidget className="shrink-0">
                <div className="grid grid-cols-4 border-b border-[#222] text-center text-[11px] bg-[#0a0a0a]">
                  <Cell label="시가" value={fmtPrice(stock.openPrice, stock.market)} />
                  <Cell label="고가" value={fmtPrice(stock.high, stock.market)} tone="up" />
                  <Cell label="저가" value={fmtPrice(stock.low, stock.market)} tone="down" />
                  <Cell label="거래량" value={fmtVolume(stock.volume)} />
                </div>
              </StrictWidget>
            </div>
            {/* 우측 (4) - 주문창 */}
            <div className="col-span-4 flex flex-col gap-2 h-full overflow-hidden">
              <StrictWidget title="주문" className="h-full overflow-hidden" overflowClass="overflow-hidden">
                <div className="p-4 overflow-y-auto flex-1 no-scrollbar">
                  <OrderEntry stock={stock} />
                </div>
              </StrictWidget>
            </div>
          </div>
        )}

        {activeTab === "orderbook" && (
          <div className="grid grid-cols-12 gap-2 h-full overflow-hidden">
            {/* 좌측 (6) - 호가창 */}
            <div className="col-span-6 h-full overflow-hidden">
              <Orderbook ticker={stock.ticker} currentPrice={stock.currentPrice} stockId={stock.id} />
            </div>
            {/* 우측 (6) - 체결창 */}
            <div className="col-span-6 h-full overflow-hidden">
              <TradeFeed stock={stock} />
            </div>
          </div>
        )}

        {activeTab === "info" && (
          <div className="grid grid-cols-12 gap-2 h-full overflow-y-auto no-scrollbar pb-10">
            {/* 좌측 (6) - 기본 정보 */}
            <div className="col-span-6 flex flex-col gap-2">
              <StrictWidget title="기업 정보">
                <div className="grid grid-cols-2 gap-px bg-[#222]">
                  <Info label="섹터" value={stock.sector} />
                  <Info label="시가총액" value={fmtCap(stock.marketCap)} />
                  <Info label="거래대금" value={tradingValueStr} />
                  <Info label="거래량" value={fmtVolume(stock.volume)} />
                  <Info label="상장일" value={stock.listedAt} />
                  <Info label="전일 종가" value={fmtPrice(stock.previousClose, stock.market)} />
                </div>
              </StrictWidget>
              
              {stock.market === "bonds" ? (
                <BondDetailPanel stock={stock} />
              ) : (
                <FinancialPanel stock={stock} />
              )}
            </div>

            {/* 우측 (6) - 옵션 */}
            <div className="col-span-6 flex flex-col gap-2">
              <OptionsPanel stockId={stock.id} ticker={stock.ticker} />
            </div>
          </div>
        )}

        {activeTab === "news" && (
          <div className="grid grid-cols-12 gap-2 h-full overflow-hidden">
            {/* 좌측 (6) - 관련 뉴스 */}
            <div className="col-span-6 h-full overflow-hidden flex flex-col">
              <StrictWidget title="관련 뉴스 · 공시" className="flex-1 overflow-hidden" overflowClass="overflow-y-auto no-scrollbar">
                {relatedNews.length === 0 ? (
                  <p className="px-4 py-6 text-center text-[12px] text-gray-500">관련 뉴스가 없습니다</p>
                ) : (
                  <div className="divide-y divide-[#222]">
                    {relatedNews.map((n) => (
                      <div key={n.id} className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-px text-[9px] font-semibold ${
                              n.publisher?.includes("스트리트 리포트") || n.publisher?.includes("피드 터미널") || n.publisher?.includes("와이어 넷")
                                ? "bg-blue-500/15 text-blue-400"
                                : "bg-red-500/15 text-red-400"
                            }`}
                          >
                            {n.publisher || "언론사"}
                          </span>
                          <span className={`text-[10px] ${n.sentiment === "positive" ? "text-red-400" : n.sentiment === "negative" ? "text-blue-400" : "text-gray-500"}`}>
                            {n.sentiment === "positive" ? "호재" : n.sentiment === "negative" ? "악재" : "중립"}
                          </span>
                        </div>
                        <p className="mt-1 text-[12px] text-white">{n.headline}</p>
                        <p className="mt-0.5 line-clamp-2 text-[11px] text-gray-400">{n.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </StrictWidget>
            </div>
            {/* 우측 (6) - 주주톡 */}
            <div className="col-span-6 h-full overflow-hidden flex flex-col">
              <ChatPanel stockId={stock.id} initial={messages} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-red-400" : tone === "down" ? "text-blue-400" : "text-white";
  return (
    <div className="bg-transparent px-2 py-2.5">
      <div className="text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
      <div className={`mt-0.5 font-mono text-[12px] tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-panel px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-dim">{label}</div>
      <div className="mt-0.5 font-mono text-[13px] tabular-nums text-tx">{value}</div>
    </div>
  );
}
