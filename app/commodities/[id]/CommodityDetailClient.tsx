'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { CommodityDefinition, ActiveCommodityEvent, CommodityNewsItem } from '@/lib/commodities/types';
import { fmtSigned, fmtPrice } from '@/lib/format';
import RealtimePriceHeader from '@/app/components/RealtimePriceHeader';
import TickChart from '@/app/components/TickChart';
import Orderbook from '@/app/components/Orderbook';
import TradeFeed from '@/app/components/TradeFeed';
import StrictWidget from '@/app/components/StrictWidget';
import CommoditySeasonalityPanel from '@/app/components/commodities/CommoditySeasonalityPanel';
import CommodityEventPanel from '@/app/components/commodities/CommodityEventPanel';
import CommodityOrderEntry from '@/app/components/commodities/CommodityOrderEntry';
import ActiveOrdersPanel from '@/app/components/ActiveOrdersPanel';

type TabId = 'chart' | 'orderbook' | 'seasonality' | 'events' | 'orders';

interface DetailClientProps {
  initialCommodity: CommodityDefinition & {
    currentPrice: number;
    previousPrice: number;
    openPrice: number;
    high: number;
    low: number;
    volume: number;
  };
  initialEvents: ActiveCommodityEvent[];
  initialNews: CommodityNewsItem[];
}

export default function CommodityDetailClient({
  initialCommodity,
  initialEvents,
  initialNews,
}: DetailClientProps) {
  const [commodity, setCommodity] = useState(initialCommodity);
  const [activeEvents, setActiveEvents] = useState<ActiveCommodityEvent[]>(initialEvents);
  const [newsFeed, setNewsFeed] = useState<CommodityNewsItem[]>(initialNews);
  const [currentTick, setCurrentTick] = useState<number>(100);
  const [activeTab, setActiveTab] = useState<TabId>('chart');

  // 실시간 1.5초 주기 폴링
  useEffect(() => {
    let isMounted = true;

    const fetchDetail = async () => {
      try {
        const res = await fetch(`/api/commodities?id=${commodity.id}`);
        const data = await res.json();
        if (data.success && isMounted) {
          if (data.commodity) setCommodity(data.commodity);
          if (data.activeEvents) setActiveEvents(data.activeEvents);
          if (data.newsFeed) setNewsFeed(data.newsFeed);
          if (data.tick) setCurrentTick(data.tick);
        }
      } catch {
        // 폴링 에러 무시
      }
    };

    const interval = setInterval(fetchDetail, 1500);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [commodity.id]);

  const changeAmount = commodity.currentPrice - commodity.previousPrice;
  const changePct = commodity.previousPrice > 0 ? (changeAmount / commodity.previousPrice) * 100 : 0;
  const isUp = changeAmount > 0;
  const isDown = changeAmount < 0;
  const changeColor = isUp ? 'text-[#F04452]' : isDown ? 'text-[#3182F6]' : 'text-[#8E939D]';

  const tabs: { id: TabId; label: string; icon: string }[] = [
    { id: 'chart', label: '차트 / 선물 주문', icon: '📈' },
    { id: 'orderbook', label: '호가 / 실시간 체결', icon: '📖' },
    { id: 'seasonality', label: '계절성 분석', icon: '📅' },
    { id: 'events', label: '거시 이벤트 / 뉴스', icon: '⚡' },
    { id: 'orders', label: '내 미체결', icon: '📋' },
  ];

  // Stock 타입 호환 객체
  const stockCompat = {
    id: commodity.id,
    ticker: commodity.ticker,
    name: commodity.nameKo,
    market: 'commodities',
    currentPrice: commodity.currentPrice,
    previousClose: commodity.previousPrice,
    openPrice: commodity.openPrice,
    high: commodity.high,
    low: commodity.low,
    volume: commodity.volume,
  };

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col bg-[#05070A] text-white font-mono overflow-hidden select-none">
      {/* ── 1. 상단 글로벌 시세 헤더 ── */}
      <div className="flex-none border-b border-[#212631] bg-[#0E1117] px-6 py-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-4">
          <Link
            href="/commodities"
            className="text-[#8E939D] hover:text-white text-xs font-bold flex items-center gap-1 transition-colors bg-[#161B22] px-3 py-1.5 rounded-xl border border-[#212631]"
          >
            ← 원자재 목록
          </Link>
          <div className="h-4 w-px bg-[#212631]" />
          <div className="flex items-center gap-2.5">
            <h1 className="text-base font-black tracking-tight text-white">{commodity.nameKo}</h1>
            <span className="text-[11px] text-[#F04452] font-mono font-extrabold bg-[#F04452]/10 border border-[#F04452]/30 px-2 py-0.5 rounded-full">
              {commodity.ticker}
            </span>
          </div>
          <RealtimePriceHeader stock={stockCompat as any} />
        </div>

        <div className="flex items-center gap-6 text-xs tabular-nums font-bold">
          <div>
            <span className="text-[#565A63] mr-1.5">단위</span>
            <span className="text-white">{commodity.unit}</span>
          </div>
          <div className="border-l border-[#212631] pl-4">
            <span className="text-[#565A63] mr-1.5">증거금</span>
            <span className="text-[#F04452] font-black">{fmtPrice(commodity.marginRequirement, 'overseas')}</span>
          </div>
          <div className="border-l border-[#212631] pl-4">
            <span className="text-[#8E939D] mr-1.5">전일대비</span>
            <span className={`font-black text-sm ${changeColor}`}>
              {fmtSigned(changeAmount)} ({fmtSigned(changePct)}%)
            </span>
          </div>
        </div>
      </div>

      {/* ── 2. HTS 탭 바 ── */}
      <div className="flex border-b border-[#212631] bg-[#090B0F] px-4 shrink-0 gap-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-5 py-3 text-[12.5px] font-bold border-b-2 flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === tab.id
                ? 'border-[#F04452] text-[#F04452] bg-[#F04452]/5 font-black'
                : 'border-transparent text-[#8E939D] hover:text-white'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* ── 3. 탭 컨텐츠 영역 ── */}
      <div className="flex-1 overflow-hidden p-3 relative h-full bg-[#05070A]">
        {/* ① 차트 / 선물 주문 탭 */}
        {activeTab === 'chart' && (
          <div className="grid grid-cols-12 gap-3 h-full overflow-hidden">
            {/* 좌측 (8) - 차트 & 스펙 바 */}
            <div className="col-span-12 lg:col-span-8 flex flex-col gap-3 h-full overflow-hidden">
              <div className="flex-1 overflow-hidden border border-[#212631] bg-[#0E1117] rounded-2xl shadow-xl">
                <StrictWidget title="COMMODITY REALTIME TICK / CANDLE CHART">
                  <TickChart ticker={commodity.ticker} currentPrice={commodity.currentPrice} />
                </StrictWidget>
              </div>

              {/* 스펙 및 OHLCV 요약 바 */}
              <div className="shrink-0 border border-[#212631] bg-[#0E1117] rounded-2xl overflow-hidden shadow-xl p-3 grid grid-cols-4 divide-x divide-[#212631] text-center text-[11px]">
                <div>
                  <div className="text-[#565A63] font-bold">시가</div>
                  <div className="font-black text-white">{fmtPrice(commodity.openPrice, 'overseas')}</div>
                </div>
                <div>
                  <div className="text-[#565A63] font-bold">고가</div>
                  <div className="font-black text-[#F04452]">{fmtPrice(commodity.high, 'overseas')}</div>
                </div>
                <div>
                  <div className="text-[#565A63] font-bold">저가</div>
                  <div className="font-black text-[#3182F6]">{fmtPrice(commodity.low, 'overseas')}</div>
                </div>
                <div>
                  <div className="text-[#565A63] font-bold">틱 가치</div>
                  <div className="font-black text-white">{fmtPrice(commodity.tickValue, 'overseas')}</div>
                </div>
              </div>
            </div>

            {/* 우측 (4) - 원자재 선물 주문 패널 */}
            <div className="col-span-12 lg:col-span-4 h-full overflow-hidden">
              <CommodityOrderEntry commodity={commodity} />
            </div>
          </div>
        )}

        {/* ② 호가 / 실시간 체결 탭 */}
        {activeTab === 'orderbook' && (
          <div className="grid grid-cols-12 gap-3 h-full overflow-hidden">
            <div className="col-span-6 h-full overflow-hidden border border-[#212631] bg-[#0E1117] rounded-2xl shadow-xl">
              <Orderbook ticker={commodity.ticker} currentPrice={commodity.currentPrice} />
            </div>
            <div className="col-span-6 h-full overflow-hidden border border-[#212631] bg-[#0E1117] rounded-2xl shadow-xl">
              <TradeFeed stock={stockCompat as any} />
            </div>
          </div>
        )}

        {/* ③ 계절성 분석 탭 */}
        {activeTab === 'seasonality' && (
          <div className="grid grid-cols-12 gap-3 h-full overflow-hidden">
            <div className="col-span-12 lg:col-span-8 h-full">
              <CommoditySeasonalityPanel
                name={commodity.nameKo}
                seasonality={commodity.seasonality}
                currentTick={currentTick}
              />
            </div>
            <div className="col-span-12 lg:col-span-4 h-full">
              <CommodityOrderEntry commodity={commodity} />
            </div>
          </div>
        )}

        {/* ④ 거시 이벤트 / 뉴스 탭 */}
        {activeTab === 'events' && (
          <div className="grid grid-cols-12 gap-3 h-full overflow-hidden">
            <div className="col-span-12 lg:col-span-8 h-full">
              <CommodityEventPanel
                activeEvents={activeEvents}
                newsFeed={newsFeed}
                currentCommodityId={commodity.id}
              />
            </div>
            <div className="col-span-12 lg:col-span-4 h-full">
              <CommodityOrderEntry commodity={commodity} />
            </div>
          </div>
        )}

        {/* ⑤ 내 미체결 탭 */}
        {activeTab === 'orders' && (
          <div className="h-full overflow-hidden flex flex-col border border-[#212631] bg-[#0E1117] rounded-2xl shadow-xl">
            <ActiveOrdersPanel />
          </div>
        )}
      </div>
    </div>
  );
}
