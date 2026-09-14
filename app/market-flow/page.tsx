'use client';

import React, { useEffect, useState, useCallback, useRef } from 'react';
import { SynchronizedFlowChart } from '@/app/components/market-flow/SynchronizedFlowChart';
import { LeaderStockTable } from '@/app/components/market-flow/LeaderStockTable';
import { SectorCirculationWidget } from '@/app/components/market-flow/SectorCirculationWidget';
import { CausalTraceStream } from '@/app/components/market-flow/CausalTraceStream';
import {
  LeaderStockScore,
  SectorFlowSummary,
  MarketFlowTimeSeriesPoint,
  CausalTraceLog,
} from '@/lib/engine/simulation/marketDiagnostics';

interface MarketFlowApiResponse {
  success: boolean;
  data?: {
    simTime: number;
    formattedSimTime: string;
    leaderBoard: LeaderStockScore[];
    sectorSummary: SectorFlowSummary[];
    timeSeries: MarketFlowTimeSeriesPoint[];
    causalLogs: CausalTraceLog[];
    recentNews: Array<{
      id: string;
      title: string;
      content: string;
      stock_id: string | null;
      sector_id?: string | null;
      sentiment_score?: number | null;
      urgency?: number | null;
      created_at: string;
      simulation_time?: number;
    }>;
    engineRunning?: boolean;
    activeAgentsCount?: number;
  };
  message?: string;
}

export default function MarketFlowDashboardPage() {
  const [data, setData] = useState<MarketFlowApiResponse['data'] | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshIntervalSec, setRefreshIntervalSec] = useState<number>(2); // 1, 2, 5, 0(pause)
  const [isAdvancing, setIsAdvancing] = useState<boolean>(false);
  const [selectedStockId, setSelectedStockId] = useState<string | null>(null);

  const isMountedRef = useRef<boolean>(true);

  const fetchData = useCallback(async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);
      const res = await fetch('/api/market-flow?points=80', {
        cache: 'no-store',
      });
      const json: MarketFlowApiResponse = await res.json();
      if (json.success && json.data && isMountedRef.current) {
        setData(json.data);
      }
    } catch (err) {
      console.error('[MarketFlowDashboard] Fetch error:', err);
    } finally {
      if (isMountedRef.current && isInitial) setLoading(false);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchData(true);

    return () => {
      isMountedRef.current = false;
    };
  }, [fetchData]);

  // 폴링 인터벌 제어
  useEffect(() => {
    if (refreshIntervalSec <= 0) return;

    const interval = setInterval(() => {
      fetchData(false);
    }, refreshIntervalSec * 1000);

    return () => clearInterval(interval);
  }, [fetchData, refreshIntervalSec]);

  // 수동 1스텝 전진 핸들러
  const handleStepSimulation = async () => {
    if (isAdvancing) return;
    setIsAdvancing(true);
    try {
      const res = await fetch('/api/market-flow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'step', dt: 1.0 }),
      });
      const json = await res.json();
      if (json.success) {
        fetchData(false);
      }
    } catch (err) {
      console.error('[MarketFlowDashboard] Step simulation error:', err);
    } finally {
      setIsAdvancing(false);
    }
  };

  // 총 누적 거래대금 계산
  const totalMarketTurnover = data?.timeSeries?.length
    ? data.timeSeries[data.timeSeries.length - 1].totalTurnover
    : 0;

  const formatKrw = (val: number) => {
    if (Math.abs(val) >= 1e8) return `${(val / 1e8).toFixed(1)}억원`;
    if (Math.abs(val) >= 1e4) return `${(val / 1e4).toFixed(0)}만원`;
    return `${Math.round(val).toLocaleString()}원`;
  };

  return (
    <div className="min-h-screen bg-[#05070A] text-[#F4F5F6] font-sans p-6 max-w-7xl mx-auto space-y-6">
      {/* ── 1. 탑 헤더 배너 및 시뮬레이션 제어 바 ── */}
      <header className="bg-[#0E1117] border border-[#1F2937] p-6 rounded-3xl flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 shadow-2xl">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-950/40 px-3.5 py-1 text-xs font-bold text-cyan-400 mb-2 font-mono">
            <span className="inline-block h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
            MARKET FLOW TERMINAL · 인과 분석 대시보드
          </div>
          <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">
            시장 인과 흐름 실시간 터미널
          </h1>
          <p className="text-[12.5px] text-[#8E939D] mt-1 font-medium leading-relaxed">
            산업별 거래대금, 봇 실체결 순수급, 정보지연 관심도, 호가 스프레드 및 주도주 순위를 동일 시간축에서 실시간 동기화 분석합니다.
          </p>
        </div>

        {/* 제어 컨트롤러 */}
        <div className="flex flex-wrap items-center gap-3 text-xs font-mono shrink-0">
          {/* 시뮬레이션 시계 */}
          <div className="bg-[#161B22] border border-[#2D3748] px-3.5 py-2 rounded-2xl flex items-center gap-2">
            <span className="text-slate-400">시뮬시각:</span>
            <span className="text-cyan-400 font-extrabold text-sm">
              {data?.formattedSimTime || '--:--:--'}
            </span>
          </div>

          {/* 총 거래대금 */}
          <div className="bg-[#161B22] border border-[#2D3748] px-3.5 py-2 rounded-2xl flex items-center gap-2">
            <span className="text-slate-400">총 거래대금:</span>
            <span className="text-white font-extrabold">
              {formatKrw(totalMarketTurnover)}
            </span>
          </div>

          {/* 갱신 주기 셀렉터 */}
          <div className="bg-[#161B22] border border-[#2D3748] px-3 py-1.5 rounded-2xl flex items-center gap-2">
            <span className="text-slate-400 text-[11px]">갱신주기:</span>
            <select
              value={refreshIntervalSec}
              onChange={(e) => setRefreshIntervalSec(Number(e.target.value))}
              className="bg-transparent text-white font-bold outline-none cursor-pointer text-xs"
            >
              <option value={1} className="bg-[#0E1117] text-white">1초 (초고속)</option>
              <option value={2} className="bg-[#0E1117] text-white">2초 (기본)</option>
              <option value={5} className="bg-[#0E1117] text-white">5초 (여유)</option>
              <option value={0} className="bg-[#0E1117] text-white">일시정지</option>
            </select>
          </div>

          {/* 수동 1스텝 전진 버튼 */}
          <button
            onClick={handleStepSimulation}
            disabled={isAdvancing}
            className="bg-cyan-500 hover:bg-cyan-400 disabled:bg-cyan-900 text-black font-extrabold px-3.5 py-2 rounded-2xl transition-all shadow-[0_0_12px_rgba(6,182,212,0.3)] active:scale-95 cursor-pointer"
          >
            {isAdvancing ? '전진 중...' : '+1.0s 스텝 전진'}
          </button>
        </div>
      </header>

      {/* ── 2. 동일 시간축 멀티 차트 (Full Width) ── */}
      {data?.timeSeries && data.timeSeries.length > 0 ? (
        <SynchronizedFlowChart
          data={data.timeSeries}
          selectedStockId={selectedStockId}
          onSelectStock={(id) => setSelectedStockId(id)}
        />
      ) : (
        <div className="bg-[#0E1117] border border-[#1F2937] p-12 rounded-3xl text-center text-slate-400 font-mono">
          시계열 데이터를 수집 중입니다... 잠시만 기다려주세요.
        </div>
      )}

      {/* ── 3. 주도주 리더보드 & 산업별 자금 순환 (2열 분할) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 좌측: 실시간 주도주 리더보드 (7열) */}
        <div className="lg:col-span-7">
          <LeaderStockTable
            leaderBoard={data?.leaderBoard || []}
            selectedStockId={selectedStockId}
            onSelectStock={(id) => setSelectedStockId(id)}
          />
        </div>

        {/* 우측: 산업별 자금 순환 및 봇 수급 (5열) */}
        <div className="lg:col-span-5">
          <SectorCirculationWidget
            sectorSummary={data?.sectorSummary || []}
            onSelectSector={(secId) => {
              // 해당 섹터의 대장주 선택
              const leadInSec = data?.leaderBoard?.find((lb) => lb.sectorId === secId);
              if (leadInSec) setSelectedStockId(leadInSec.stockId);
            }}
          />
        </div>
      </div>

      {/* ── 4. 실시간 인과 추적 피드 & 최근 주요 공시 ── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* 인과 추적 피드 (8열) */}
        <div className="lg:col-span-8">
          <CausalTraceStream logs={data?.causalLogs || []} />
        </div>

        {/* 최근 뉴스 및 공시 (4열) */}
        <div className="lg:col-span-4 bg-[#0E1117] border border-[#1F2937] rounded-3xl p-5 shadow-2xl space-y-3 font-mono text-xs">
          <div className="flex justify-between items-center border-b border-[#1F2937] pb-3">
            <div className="flex items-center gap-2">
              <span className="text-base">📰</span>
              <h3 className="text-sm font-black text-white">최근 주요 공시 및 뉴스</h3>
            </div>
            <span className="text-[10px] text-slate-400">최신 10건</span>
          </div>

          <div className="max-h-[360px] overflow-y-auto space-y-2.5">
            {(!data?.recentNews || data.recentNews.length === 0) ? (
              <div className="text-center py-8 text-slate-500 font-sans">
                등록된 최근 뉴스가 없습니다.
              </div>
            ) : (
              data.recentNews.map((news) => {
                const isPositive = (news.sentiment_score ?? 0) >= 0;

                return (
                  <div
                    key={news.id}
                    className="p-3 rounded-2xl bg-[#07090E] border border-[#1F2937] hover:border-[#374151] space-y-1.5 transition-all"
                  >
                    <div className="flex justify-between items-center text-[10px]">
                      <span
                        className={`font-black px-1.5 py-0.5 rounded ${
                          isPositive
                            ? 'bg-rose-950/60 text-[#F04452] border border-rose-800/60'
                            : 'bg-blue-950/60 text-[#3182F6] border border-blue-800/60'
                        }`}
                      >
                        {isPositive ? '호재 (Bullish)' : '악재 (Bearish)'}
                      </span>
                      <span className="text-slate-500 font-mono">
                        긴급도: {news.urgency ?? 0.5}
                      </span>
                    </div>
                    <div className="text-white font-extrabold text-[12px] font-sans leading-snug">
                      {news.title}
                    </div>
                    <div className="text-[11px] text-slate-400 font-sans line-clamp-2 leading-relaxed">
                      {news.content}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
