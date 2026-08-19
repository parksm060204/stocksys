"use client";

import { useState } from "react";
import type { Stock, ChatMessage, PriceHistoryPoint } from "@/lib/types";
import { fmtPrice, fmtVolume, fmtCap } from "@/lib/format";
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
  const [activeTab, setActiveTab] = useState<TabId>("chart");

  const tabs: { id: TabId; label: string }[] = [
    { id: "chart", label: "차트 / 주문" },
    { id: "orderbook", label: "호가 / 체결" },
    { id: "orders", label: "내 미체결" },
    { id: "history", label: "과거 주가 기록" },
    { id: "info", label: "기업 분석" },
    { id: "news", label: "뉴스 / 주주톡" },
  ];

  return (
    <div className="flex flex-col flex-1 overflow-hidden h-full">
      {/* 탭 바 */}
      <div className="flex border-b border-[#212631] bg-[#090B0F] px-4 shrink-0 gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-6 py-3.5 text-[13px] font-mono font-black border-b-2 transition-all cursor-pointer ${
              activeTab === tab.id
                ? "border-[#F04452] text-[#F04452] bg-[#F04452]/5"
                : "border-transparent text-[#8E939D] hover:text-white"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 탭 컨텐츠 영역 */}
      <div className="flex-1 overflow-hidden p-3 relative h-full bg-[#05070A]">
        {activeTab === "chart" && (
          <div className="grid grid-cols-12 gap-3 h-full overflow-hidden">
            {/* 좌측 (8) - 틱 차트 */}
            <div className="col-span-8 flex flex-col gap-3 h-full overflow-hidden">
              <div className="flex-1 overflow-hidden border border-[#212631] bg-[#0E1117] rounded-2xl shadow-xl">
                <TickChart ticker={stock.ticker} currentPrice={stock.currentPrice} />
              </div>
              <div className="shrink-0 border border-[#212631] bg-[#0E1117] rounded-2xl overflow-hidden shadow-xl font-mono">
                <div className="grid grid-cols-4 divide-x divide-[#212631] text-center text-[11px] bg-[#090B0F]">
                  <Cell label="시가" value={fmtPrice(stock.openPrice, stock.market)} />
                  <Cell label="고가" value={fmtPrice(stock.high, stock.market)} tone="up" />
                  <Cell label="저가" value={fmtPrice(stock.low, stock.market)} tone="down" />
                  <Cell label="거래량" value={fmtVolume(stock.volume)} />
                </div>
              </div>
            </div>
            {/* 우측 (4) - 주문창 */}
            <div className="col-span-4 flex flex-col h-full overflow-hidden border border-[#212631] bg-[#0E1117] rounded-2xl shadow-xl">
              <div className="p-4 overflow-y-auto flex-1 no-scrollbar">
                <OrderEntry stock={stock} />
              </div>
            </div>
          </div>
        )}

        {activeTab === "orderbook" && (
          <div className="grid grid-cols-12 gap-3 h-full overflow-hidden">
            {/* 좌측 (6) - 호가창 */}
            <div className="col-span-6 h-full overflow-hidden border border-[#212631] bg-[#0E1117] rounded-2xl shadow-xl">
              <Orderbook ticker={stock.ticker} currentPrice={stock.currentPrice} stockId={stock.id} />
            </div>
            {/* 우측 (6) - 체결창 */}
            <div className="col-span-6 h-full overflow-hidden border border-[#212631] bg-[#0E1117] rounded-2xl shadow-xl">
              <TradeFeed stock={stock} />
            </div>
          </div>
        )}

        {activeTab === "orders" && (
          <div className="h-full overflow-hidden flex flex-col border border-[#212631] bg-[#0E1117] rounded-2xl shadow-xl">
            <ActiveOrdersPanel currentStockId={stock.id} />
          </div>
        )}

        {activeTab === "history" && (
          <div className="h-full overflow-hidden flex flex-col border border-[#212631] bg-[#0E1117] rounded-2xl shadow-xl">
            <div className="border-b border-[#212631] px-5 py-4 bg-[#090B0F] font-mono font-black text-white text-[13.5px]">
              과거 주가 변동 기록 (TIME SERIES)
            </div>
            {priceHistory.length === 0 ? (
              <div className="p-12 text-center text-[#8E939D] text-[13px] font-mono">
                저장된 과거 주가 이력이 없습니다. 엔터프라이즈 엔진 가동 시 자동으로 기록됩니다.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto no-scrollbar">
                <table className="w-full text-left border-collapse text-[12.5px] font-mono">
                  <thead>
                    <tr className="border-b border-[#212631] bg-[#090B0F] text-[#8E939D] uppercase text-[11px] font-extrabold">
                      <th className="py-3 px-5 border-none">기록 시각</th>
                      <th className="py-3 px-5 text-right border-none">주가 (Price)</th>
                      <th className="py-3 px-5 text-right border-none">거래량 (Volume)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#212631]">
                    {priceHistory.map((item) => (
                      <tr key={item.id} className="hover:bg-[#161B22] transition-colors border-b border-[#212631] last:border-none">
                        <td className="py-3 px-5 text-[#8E939D] font-medium border-none">
                          {new Date(item.created_at).toLocaleString("ko-KR")}
                        </td>
                        <td className="py-3 px-5 text-right font-black text-white border-none tabular-nums">
                          {fmtPrice(Number(item.price), stock.market)}
                        </td>
                        <td className="py-3 px-5 text-right text-[#8E939D] font-bold border-none tabular-nums">
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
            {/* 좌측 (6) - 기본 정보 */}
            <div className="col-span-6 flex flex-col gap-3">
              <div className="border border-[#212631] bg-[#0E1117] rounded-2xl overflow-hidden shadow-xl p-5 font-mono space-y-3">
                <h3 className="text-[14px] font-black text-white border-b border-[#212631] pb-2">기업 분석 및 스펙</h3>
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

            {/* 우측 (6) - 옵션 */}
            <div className="col-span-6 flex flex-col gap-3">
              <OptionsPanel stockId={stock.id} ticker={stock.ticker} />
            </div>
          </div>
        )}

        {activeTab === "news" && (
          <div className="grid grid-cols-12 gap-3 h-full overflow-hidden">
            {/* 좌측 (6) - 관련 뉴스 */}
            <div className="col-span-6 h-full overflow-hidden flex flex-col border border-[#212631] bg-[#0E1117] rounded-2xl shadow-xl">
              <div className="border-b border-[#212631] px-5 py-4 bg-[#090B0F] font-mono font-black text-white text-[13.5px]">
                관련 뉴스 · 공시
              </div>
              <div className="flex-1 overflow-y-auto no-scrollbar p-2">
                {relatedNews.length === 0 ? (
                  <p className="px-4 py-8 text-center text-[12px] text-[#8E939D] font-mono">관련 뉴스가 없습니다</p>
                ) : (
                  <div className="divide-y divide-[#212631]">
                    {relatedNews.map((n) => (
                      <div key={n.id} className="px-4 py-3.5 font-mono">
                        <div className="flex items-center gap-2">
                          <span
                            className="rounded-full bg-[#161B22] border border-[#212631] px-2.5 py-0.5 text-[10px] font-bold text-[#8E939D]"
                          >
                            {n.publisher || "언론사"}
                          </span>
                          <span className={`text-[10.5px] font-black rounded-full px-2 py-0.5 border ${
                            n.sentiment === "positive" ? "bg-[#F04452]/10 border-[#F04452]/30 text-[#F04452]" : n.sentiment === "negative" ? "bg-[#3182F6]/10 border-[#3182F6]/30 text-[#3182F6]" : "bg-[#161B22] border-[#212631] text-[#8E939D]"
                          }`}>
                            {n.sentiment === "positive" ? "호재" : n.sentiment === "negative" ? "악재" : "중립"}
                          </span>
                        </div>
                        <p className="mt-1.5 text-[13px] font-bold text-white font-sans">{n.headline}</p>
                        <p className="mt-1 line-clamp-2 text-[11.5px] text-[#8E939D] font-sans font-medium">{n.content}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
            {/* 우측 (6) - 주주톡 */}
            <div className="col-span-6 h-full overflow-hidden flex flex-col border border-[#212631] bg-[#0E1117] rounded-2xl shadow-xl">
              <ChatPanel stockId={stock.id} initial={messages} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-[#F04452]" : tone === "down" ? "text-[#3182F6]" : "text-white";
  return (
    <div className="bg-transparent px-3 py-3 font-mono">
      <div className="text-[10px] uppercase font-bold tracking-wider text-[#8E939D]">{label}</div>
      <div className={`mt-0.5 font-mono text-[12.5px] font-black tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-[#05070A] border border-[#212631] rounded-xl px-4 py-3 font-mono">
      <div className="text-[10px] uppercase tracking-wider text-[#8E939D] font-bold">{label}</div>
      <div className="mt-1 font-mono text-[13.5px] font-black tabular-nums text-white">{value}</div>
    </div>
  );
}

