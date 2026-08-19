'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { CommodityCategory } from '@/lib/commodities/types';
import { fmtSigned, fmtPrice } from '@/lib/format';

interface CommodityItem {
  id: string;
  ticker: string;
  name: string;
  nameKo: string;
  category: CommodityCategory;
  unit: string;
  currentPrice: number;
  previousPrice: number;
  openPrice: number;
  high: number;
  low: number;
  volume: number;
  priceHistory?: { tick: number; price: number }[];
  marginRequirement: number;
}

interface ActiveEvent {
  id: string;
  title: string;
  headline: string;
  magnitude: number;
  remainingTicks: number;
  totalTicks: number;
}

const CATEGORY_TABS: { id: CommodityCategory | 'all'; label: string; icon: string }[] = [
  { id: 'all', label: '전체 상품', icon: '🌐' },
  { id: 'energy', label: '에너지', icon: '⚡' },
  { id: 'precious_metals', label: '귀금속', icon: '👑' },
  { id: 'industrial_metals', label: '산업금속', icon: '⛏️' },
  { id: 'agriculture', label: '농산물', icon: '🌾' },
  { id: 'livestock', label: '축산물', icon: '🥩' },
];

export default function CommoditiesClientList({
  initialCommodities,
  initialEvents = [],
}: {
  initialCommodities: CommodityItem[];
  initialEvents?: ActiveEvent[];
}) {
  const [activeCategory, setActiveCategory] = useState<CommodityCategory | 'all'>('all');
  const [commodities, setCommodities] = useState<CommodityItem[]>(initialCommodities);
  const [events, setEvents] = useState<ActiveEvent[]>(initialEvents);

  // 실시간 폴링 (2초 간격)
  useEffect(() => {
    let isMounted = true;

    const fetchLatest = async () => {
      try {
        const res = await fetch('/api/commodities');
        const data = await res.json();
        if (data.success && isMounted) {
          if (data.commodities) setCommodities(data.commodities);
          if (data.activeEvents) setEvents(data.activeEvents);
        }
      } catch {
        // 폴링 에러 무시
      }
    };

    const interval = setInterval(fetchLatest, 2000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const filtered = commodities.filter((c) => {
    if (activeCategory === 'all') return true;
    return c.category === activeCategory;
  });

  const totalCount = commodities.length;
  const upCount = commodities.filter((c) => c.currentPrice > c.previousPrice).length;
  const downCount = commodities.filter((c) => c.currentPrice < c.previousPrice).length;

  return (
    <div className="space-y-6 select-none font-mono">
      {/* ── 1. 글로벌 활성 거시 이벤트 배너 ── */}
      {events.length > 0 && (
        <div className="bg-gradient-to-r from-amber-500/10 via-[#0E1117] to-amber-500/5 border border-amber-500/30 p-4 rounded-2xl flex items-center justify-between gap-4 shadow-xl">
          <div className="flex items-center gap-3 overflow-hidden">
            <span className="text-xl animate-pulse shrink-0">🚨</span>
            <div className="truncate">
              <div className="text-[10px] text-amber-400 font-bold tracking-wider uppercase">
                GLOBAL COMMODITY EVENT IN PROGRESS
              </div>
              <div className="text-[13px] font-extrabold text-white truncate">{events[0].headline}</div>
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <span className="text-[11px] text-[#8E939D] font-bold">
              지속 잔여: <strong className="text-white">{events[0].remainingTicks}</strong>/{events[0].totalTicks}틱
            </span>
          </div>
        </div>
      )}

      {/* ── 2. 요약 통계 & 카테고리 탭 ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[#212631] pb-4">
        {/* 카테고리 탭 스위처 */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
          {CATEGORY_TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveCategory(tab.id)}
              className={`px-4 py-2 rounded-xl font-bold text-[12px] flex items-center gap-1.5 transition-all cursor-pointer whitespace-nowrap ${
                activeCategory === tab.id
                  ? 'bg-[#F04452] text-white shadow-[0_0_16px_rgba(240,68,82,0.35)]'
                  : 'bg-[#161B22] text-[#8E939D] hover:text-white border border-[#212631]'
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* 시장 상태 요약 */}
        <div className="flex items-center gap-4 text-xs font-bold text-[#8E939D] bg-[#161B22] px-4 py-2 rounded-xl border border-[#212631] shrink-0">
          <span>
            총 <strong className="text-white">{totalCount}</strong>종목
          </span>
          <span>·</span>
          <span className="text-[#F04452]">상승 {upCount}</span>
          <span>·</span>
          <span className="text-[#3182F6]">하락 {downCount}</span>
        </div>
      </div>

      {/* ── 3. 12개 원자재 종목 카드 그리드 ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((c) => {
          const changeAmount = c.currentPrice - c.previousPrice;
          const changePct = c.previousPrice > 0 ? (changeAmount / c.previousPrice) * 100 : 0;
          const isUp = changeAmount > 0;
          const isDown = changeAmount < 0;

          // 미니 스파크라인 SVG 경로 생성
          const history = c.priceHistory && c.priceHistory.length > 5
            ? c.priceHistory.slice(-15)
            : [{ price: c.previousPrice }, { price: c.currentPrice }];

          const prices = history.map((h) => h.price);
          const minP = Math.min(...prices);
          const maxP = Math.max(...prices);
          const pRange = maxP - minP || 1;

          const sparkWidth = 100;
          const sparkHeight = 28;
          const sparkPoints = prices.map((p, idx) => {
            const x = (idx / (prices.length - 1)) * sparkWidth;
            const y = sparkHeight - ((p - minP) / pRange) * (sparkHeight - 6) - 3;
            return `${x},${y}`;
          });
          const sparkD = `M ${sparkPoints.join(' L ')}`;

          return (
            <Link
              key={c.id}
              href={`/commodities/${c.id}`}
              className="bg-[#0E1117] border border-[#212631] hover:border-[#F04452]/50 hover:bg-[#161B22]/80 transition-all rounded-2xl p-5 shadow-xl flex flex-col justify-between group space-y-4"
            >
              {/* 카드 헤더 */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-[#161B22] border border-[#212631] text-[#8E939D]">
                    {c.category.replace('_', ' ')}
                  </span>
                  <span className="text-[11px] font-black text-[#F04452] font-mono group-hover:scale-105 transition-transform">
                    {c.ticker}
                  </span>
                </div>
                <h3 className="text-[15px] font-black text-white group-hover:text-[#F04452] transition-colors truncate">
                  {c.nameKo}
                </h3>
                <div className="text-[10.5px] text-[#565A63] truncate">{c.name}</div>
              </div>

              {/* 가격 & 스파크라인 중앙 */}
              <div className="flex items-end justify-between gap-2 pt-2 border-t border-[#212631]/60">
                <div>
                  <div className="text-[17px] font-black text-white tabular-nums tracking-tight">
                    {fmtPrice(c.currentPrice, 'overseas')}
                  </div>
                  <div
                    className={`text-[12px] font-bold tabular-nums flex items-center gap-1 mt-0.5 ${
                      isUp ? 'text-[#F04452]' : isDown ? 'text-[#3182F6]' : 'text-[#8E939D]'
                    }`}
                  >
                    <span>{isUp ? '▲' : isDown ? '▼' : '―'}</span>
                    <span>{fmtSigned(changePct)}%</span>
                  </div>
                </div>

                {/* 미니 스파크라인 */}
                <div className="w-24 h-7">
                  <svg viewBox={`0 0 ${sparkWidth} ${sparkHeight}`} className="w-full h-full overflow-visible">
                    <path
                      d={sparkD}
                      fill="none"
                      stroke={isUp ? '#F04452' : isDown ? '#3182F6' : '#8E939D'}
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </div>
              </div>

              {/* 카드 푸터 (단위 & 증거금) */}
              <div className="grid grid-cols-2 gap-2 pt-3 border-t border-[#212631]/50 text-[10.5px] text-[#8E939D]">
                <div>
                  <span className="text-[#565A63] block text-[9.5px]">단위</span>
                  <span className="truncate font-bold text-white block">{c.unit}</span>
                </div>
                <div className="text-right">
                  <span className="text-[#565A63] block text-[9.5px]">위탁증거금</span>
                  <span className="font-bold text-[#F04452] block tabular-nums">
                    {fmtPrice(c.marginRequirement, 'overseas')}
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
