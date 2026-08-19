'use client';

import React from 'react';
import { ActiveCommodityEvent, CommodityNewsItem } from '@/lib/commodities/types';
import { fmtKSTTime } from '@/lib/format';

interface EventPanelProps {
  activeEvents: ActiveCommodityEvent[];
  newsFeed: CommodityNewsItem[];
  currentCommodityId?: string;
  onTriggerEvent?: (templateId: string) => void;
}

export default function CommodityEventPanel({
  activeEvents,
  newsFeed,
  currentCommodityId,
}: EventPanelProps) {
  // 현재 종목과 관련된 활성 이벤트 필터링
  const relevantEvents = activeEvents.filter((ev) => {
    if (!currentCommodityId) return true;
    if (ev.targetCommodityIds && ev.targetCommodityIds.includes(currentCommodityId)) return true;
    return true; // 카테고리 포함
  });

  return (
    <div className="flex flex-col h-full bg-[#0E1117] border border-[#212631] rounded-2xl p-5 font-mono text-xs shadow-xl space-y-4 overflow-hidden">
      {/* ── 1. 활성 이벤트 섹션 ── */}
      <div className="space-y-2.5">
        <div className="border-b border-[#212631] pb-2 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base animate-pulse">⚡</span>
            <h3 className="font-extrabold text-white text-[13.5px]">글로벌 거시 충격 이벤트</h3>
          </div>
          <span className="text-[10px] font-bold text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded border border-amber-400/30">
            진행 중: {relevantEvents.length}건
          </span>
        </div>

        {relevantEvents.length === 0 ? (
          <div className="p-4 bg-[#05070A] rounded-xl border border-[#212631]/60 text-center text-[#565A63] text-[11px]">
            현재 시장에 진행 중인 돌발 이벤트가 없습니다. (수급 및 계절성 정상 국면)
          </div>
        ) : (
          <div className="space-y-2 max-h-40 overflow-y-auto no-scrollbar">
            {relevantEvents.map((ev) => {
              const decayPct = (ev.remainingTicks / ev.totalTicks) * 100;
              const isBull = ev.magnitude > 0;

              return (
                <div
                  key={ev.id}
                  className="p-3 bg-[#05070A] rounded-xl border border-[#212631] hover:border-[#3182F6]/40 transition-all space-y-1.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-[9.5px] font-black px-1.5 py-0.2 rounded border ${
                          isBull
                            ? 'bg-[#F04452]/10 text-[#F04452] border-[#F04452]/30'
                            : 'bg-[#3182F6]/10 text-[#3182F6] border-[#3182F6]/30'
                        }`}
                      >
                        {isBull ? `+${(ev.magnitude * 100).toFixed(1)}% 충격` : `${(ev.magnitude * 100).toFixed(1)}% 충격`}
                      </span>
                      <span className="font-extrabold text-white text-[12px] truncate">{ev.title}</span>
                    </div>
                    <span className="text-[10px] text-[#8E939D] font-bold shrink-0 tabular-nums">
                      {ev.remainingTicks} / {ev.totalTicks} 틱
                    </span>
                  </div>

                  {/* 감쇄 진행 바 */}
                  <div className="w-full bg-[#161B22] h-1 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all duration-300 ${
                        isBull ? 'bg-[#F04452]' : 'bg-[#3182F6]'
                      }`}
                      style={{ width: `${Math.max(5, decayPct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── 2. 실시간 시황 뉴스 피드 ── */}
      <div className="flex-1 flex flex-col min-h-0 space-y-2">
        <div className="border-b border-[#212631] pb-1.5 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-sm">📰</span>
            <h4 className="font-extrabold text-white text-[12.5px]">원자재 시황 뉴스 피드</h4>
          </div>
          <span className="text-[9.5px] text-[#565A63]">실시간 자동 집계</span>
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 no-scrollbar pr-1">
          {newsFeed.length === 0 ? (
            <div className="p-4 text-center text-[#565A63] text-[11px]">발행된 최근 뉴스가 없습니다.</div>
          ) : (
            newsFeed.map((news) => {
              const isBull = news.impactSentiment === 'bullish';
              return (
                <div
                  key={news.id}
                  className="p-2.5 rounded-xl bg-[#05070A] border border-[#212631]/60 hover:bg-[#161B22] transition-colors space-y-1"
                >
                  <div className="flex items-center justify-between gap-2 text-[10px]">
                    <span className="text-[#565A63]">{fmtKSTTime(new Date(news.timestamp).toISOString())}</span>
                    <span
                      className={`font-black ${
                        isBull ? 'text-[#F04452]' : 'text-[#3182F6]'
                      }`}
                    >
                      {isBull ? '▲ 호재/상승' : '▼ 악재/하락'}
                    </span>
                  </div>
                  <div className="font-extrabold text-white text-[11.5px] leading-snug">{news.title}</div>
                  <p className="text-[10.5px] text-[#8E939D] leading-relaxed font-sans line-clamp-2">{news.content}</p>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
