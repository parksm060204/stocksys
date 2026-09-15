'use client';

import React, { useState, useRef, useMemo } from 'react';
import { MarketFlowTimeSeriesPoint, SECTOR_METADATA } from '@/lib/engine/simulation/marketDiagnostics';

interface SynchronizedFlowChartProps {
  data: MarketFlowTimeSeriesPoint[];
  selectedStockId?: string | null;
  onSelectStock?: (stockId: string) => void;
}

export const SynchronizedFlowChart: React.FC<SynchronizedFlowChartProps> = ({
  data,
  selectedStockId,
  onSelectStock,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  // 차트 기본 규격
  const chartWidth = 900;
  const panelHeight1 = 140; // 산업별 거래대금 (Turnover)
  const panelHeight2 = 100; // 봇 순매수 거래대금 (Bot Net Buy Turnover +/- Bar)
  const panelHeight3 = 110; // 주도주 관심도 & 스프레드/깊이
  const panelHeight4 = 40;  // 뉴스 및 공시 이벤트 타임라인
  const padding = { top: 20, right: 60, bottom: 25, left: 75 };

  const innerWidth = chartWidth - padding.left - padding.right;

  const pointsCount = data.length;

  // X 좌표 매핑 헬퍼
  const getX = (index: number) => {
    if (pointsCount <= 1) return padding.left + innerWidth / 2;
    return padding.left + (index / (pointsCount - 1)) * innerWidth;
  };

  // ── 1. 패널 1: 산업별 거래대금 스케일 계산 ──
  const maxTurnover = useMemo(() => {
    let max = 1;
    for (const pt of data) {
      if (pt.totalTurnover > max) max = pt.totalTurnover;
      for (const val of Object.values(pt.sectorTurnover)) {
        if (val > max) max = val;
      }
    }
    return max * 1.15; // 15% 여유
  }, [data]);

  const getY1 = (val: number) => {
    return padding.top + panelHeight1 - (val / maxTurnover) * panelHeight1;
  };

  // ── 2. 패널 2: 봇 순매수 거래대금 스케일 (+/- 대칭) ──
  const maxBotNetTurnover = useMemo(() => {
    let max = 1000;
    for (const pt of data) {
      for (const val of Object.values(pt.sectorBotNetTurnover)) {
        const absVal = Math.abs(val);
        if (absVal > max) max = absVal;
      }
    }
    return max * 1.25;
  }, [data]);

  const p2Top = padding.top + panelHeight1 + 25;
  const p2ZeroY = p2Top + panelHeight2 / 2;
  const getY2 = (val: number) => {
    // val > 0 이면 위로, val < 0 이면 아래로
    return p2ZeroY - (val / maxBotNetTurnover) * (panelHeight2 / 2);
  };

  // ── 3. 패널 3: 주도주 1위 관심도(0~1) & 스프레드(bps) ──
  const p3Top = p2Top + panelHeight2 + 25;
  const maxSpreadBps = useMemo(() => {
    let max = 50;
    for (const pt of data) {
      for (const l of pt.topLeaders) {
        if (l.spreadBps > max) max = l.spreadBps;
      }
    }
    return Math.min(200, Math.max(50, max * 1.2));
  }, [data]);

  const getY3Attention = (att: number) => {
    const clamped = Math.max(0, Math.min(1.0, att));
    return p3Top + panelHeight3 - clamped * panelHeight3;
  };

  const getY3Spread = (bps: number) => {
    const clamped = Math.max(0, Math.min(maxSpreadBps, bps));
    return p3Top + panelHeight3 - (clamped / maxSpreadBps) * panelHeight3;
  };

  // ── 4. 패널 4: 뉴스 타임라인 ──
  const p4Top = p3Top + panelHeight3 + 25;
  const totalSvgHeight = p4Top + panelHeight4 + padding.bottom;

  // 마우스 이동 핸들러 (동기화 크로스헤어)
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!containerRef.current || pointsCount === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * chartWidth;

    if (mouseX < padding.left || mouseX > padding.left + innerWidth) {
      setHoverIndex(null);
      return;
    }

    const relX = mouseX - padding.left;
    const idx = Math.round((relX / innerWidth) * (pointsCount - 1));
    setHoverIndex(Math.max(0, Math.min(pointsCount - 1, idx)));
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  const activePoint = hoverIndex !== null && data[hoverIndex] ? data[hoverIndex] : data[data.length - 1];

  // 숫자 포맷터
  const fmtKrw = (val: number) => {
    if (Math.abs(val) >= 1e8) return `${(val / 1e8).toFixed(1)}억원`;
    if (Math.abs(val) >= 1e4) return `${(val / 1e4).toFixed(0)}만원`;
    return `${Math.round(val).toLocaleString()}원`;
  };

  // 7대 섹터 라인 패스 생성
  const sectors = ['semiconductor', 'finance', 'it', 'auto', 'bio', 'energy'];

  return (
    <div className="bg-[#0E1117] border border-[#1F2937] rounded-3xl p-5 shadow-2xl space-y-4">
      {/* 헤더 & 지표 범례 */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3 border-b border-[#1F2937] pb-3.5">
        <div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-cyan-400 animate-ping" />
            <h3 className="text-sm font-black text-white font-mono tracking-tight">
              동일 시간축(Synchronized Time Axis) 시장 인과 흐름 다중 차트
            </h3>
          </div>
          <p className="text-xs text-[#8E939D] mt-0.5 font-medium">
            동일 시간축 $t$ 상에서 산업별 거래대금, 봇 순매수 수급, 주도주 관심도·스프레드, 뉴스를 동기화하여 분석합니다.
          </p>
        </div>

        {/* 섹터 범례 */}
        <div className="flex flex-wrap items-center gap-2.5 text-[11px] font-mono">
          {sectors.map((secKey) => (
            <div key={secKey} className="flex items-center gap-1.5 bg-[#161B22] px-2 py-0.5 rounded-md border border-[#2D3748]">
              <span
                className="w-2 h-2 rounded-full inline-block"
                style={{ backgroundColor: SECTOR_METADATA[secKey]?.color || '#64748B' }}
              />
              <span className="text-slate-300 font-semibold">{SECTOR_METADATA[secKey]?.nameKo}</span>
            </div>
          ))}
        </div>
      </div>

      {/* SVG 차트 뷰포트 */}
      <div ref={containerRef} className="relative w-full overflow-hidden bg-[#07090E] rounded-2xl border border-[#1F2937]/80">
        <svg
          viewBox={`0 0 ${chartWidth} ${totalSvgHeight}`}
          className="w-full h-auto select-none cursor-crosshair"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            {/* 그리드 패턴 */}
            <pattern id="flowGrid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#161B22" strokeWidth="0.8" />
            </pattern>
            {/* 글로우 필터 */}
            <filter id="glowEffect" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>

          {/* 배경 그리드 */}
          <rect x={padding.left} y={padding.top} width={innerWidth} height={totalSvgHeight - padding.top - padding.bottom} fill="url(#flowGrid)" />

          {/* ══════════════════════════════════════════
              PANEL 1: 산업별 거래대금 (Turnover)
             ══════════════════════════════════════════ */}
          <g>
            <text x={padding.left - 8} y={padding.top + 12} textAnchor="end" className="text-[10px] font-mono fill-slate-400 font-bold">
              거래대금
            </text>
            <text x={padding.left - 8} y={padding.top + 24} textAnchor="end" className="text-[8.5px] font-mono fill-slate-500">
              (Turnover)
            </text>

            {/* Y축 기준선 */}
            <line x1={padding.left} y1={padding.top + panelHeight1} x2={padding.left + innerWidth} y2={padding.top + panelHeight1} stroke="#2D3748" strokeWidth="1" />
            <line x1={padding.left} y1={padding.top} x2={padding.left + innerWidth} y2={padding.top} stroke="#1F2937" strokeDasharray="3,3" />

            {/* 섹터별 거래대금 라인 */}
            {sectors.map((secKey) => {
              const color = SECTOR_METADATA[secKey]?.color || '#64748B';
              const points = data
                .map((pt, i) => {
                  const val = pt.sectorTurnover[secKey] || 0;
                  return `${getX(i)},${getY1(val)}`;
                })
                .join(' ');

              return (
                <polyline
                  key={secKey}
                  fill="none"
                  stroke={color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity="0.85"
                  points={points}
                />
              );
            })}
          </g>

          {/* ══════════════════════════════════════════
              PANEL 2: 봇 순매수 거래대금 (+/- Bar)
             ══════════════════════════════════════════ */}
          <g>
            <text x={padding.left - 8} y={p2Top + 14} textAnchor="end" className="text-[10px] font-mono fill-slate-400 font-bold">
              봇 순매수
            </text>
            <text x={padding.left - 8} y={p2Top + 26} textAnchor="end" className="text-[8.5px] font-mono fill-slate-500">
              (Net Buy)
            </text>

            {/* Zero Line (중심선) */}
            <line x1={padding.left} y1={p2ZeroY} x2={padding.left + innerWidth} y2={p2ZeroY} stroke="#4B5563" strokeWidth="1.2" />
            <text x={padding.left + innerWidth + 6} y={p2ZeroY + 3} className="text-[8.5px] font-mono fill-slate-500">
              0
            </text>

            {/* 섹터별 봇 순매수 바 렌더링 */}
            {data.map((pt, i) => {
              const x = getX(i);
              const barWidth = Math.max(2, (innerWidth / pointsCount) * 0.7);

              // 상위 순매수 섹터 추출
              const secEntries = Object.entries(pt.sectorBotNetTurnover).filter(([_, v]) => Math.abs(v) > 100);
              if (secEntries.length === 0) return null;

              return (
                <g key={`bot-bars-${i}`}>
                  {secEntries.slice(0, 2).map(([secKey, netVal], secIdx) => {
                    const y = getY2(netVal);
                    const h = Math.abs(y - p2ZeroY);
                    const isPositive = netVal >= 0;
                    const color = isPositive ? '#F04452' : '#3182F6';
                    const offsetX = (secIdx - 0.5) * (barWidth / 2);

                    return (
                      <rect
                        key={`${secKey}-${secIdx}`}
                        x={x + offsetX - barWidth / 4}
                        y={isPositive ? y : p2ZeroY}
                        width={barWidth / 2}
                        height={Math.max(1, h)}
                        fill={color}
                        opacity="0.8"
                        rx="1"
                      />
                    );
                  })}
                </g>
              );
            })}
          </g>

          {/* ══════════════════════════════════════════
              PANEL 3: 주도주 1위 관심도 & 호가 스프레드
             ══════════════════════════════════════════ */}
          <g>
            <text x={padding.left - 8} y={p3Top + 14} textAnchor="end" className="text-[10px] font-mono fill-amber-400 font-bold">
              관심도·호가
            </text>
            <text x={padding.left - 8} y={p3Top + 26} textAnchor="end" className="text-[8.5px] font-mono fill-slate-500">
              (Att / Spread)
            </text>

            <line x1={padding.left} y1={p3Top + panelHeight3} x2={padding.left + innerWidth} y2={p3Top + panelHeight3} stroke="#2D3748" strokeWidth="1" />

            {/* 관심도 라인 (Gold / Amber) */}
            {data.length > 1 && (
              <polyline
                fill="none"
                stroke="#F59E0B"
                strokeWidth="2.2"
                points={data
                  .map((pt, i) => {
                    const top1 = pt.topLeaders[0];
                    const att = top1 ? top1.attentionScore : 0.5;
                    return `${getX(i)},${getY3Attention(att)}`;
                  })
                  .join(' ')}
              />
            )}

            {/* 스프레드 라인 (Purple / Violet) */}
            {data.length > 1 && (
              <polyline
                fill="none"
                stroke="#A855F7"
                strokeWidth="1.8"
                strokeDasharray="4,3"
                points={data
                  .map((pt, i) => {
                    const top1 = pt.topLeaders[0];
                    const sp = top1 ? top1.spreadBps : 20;
                    return `${getX(i)},${getY3Spread(sp)}`;
                  })
                  .join(' ')}
              />
            )}

            {/* 우측 보조 라벨 */}
            <text x={padding.left + innerWidth + 6} y={p3Top + 12} className="text-[8.5px] font-mono fill-amber-400 font-bold">
              Att 1.0
            </text>
            <text x={padding.left + innerWidth + 6} y={p3Top + panelHeight3 - 4} className="text-[8.5px] font-mono fill-purple-400 font-bold">
              {maxSpreadBps}bps
            </text>
          </g>

          {/* ══════════════════════════════════════════
              PANEL 4: 뉴스 및 공시 이벤트 타임라인
             ══════════════════════════════════════════ */}
          <g>
            <text x={padding.left - 8} y={p4Top + 16} textAnchor="end" className="text-[10px] font-mono fill-rose-400 font-bold">
              뉴스·공시
            </text>

            <line x1={padding.left} y1={p4Top + 12} x2={padding.left + innerWidth} y2={p4Top + 12} stroke="#374151" strokeWidth="1.5" />

            {/* 뉴스 발생 마커 */}
            {data.flatMap((pt, i) => {
              const events = pt.newsEvents || (pt.newsEvent ? [pt.newsEvent] : []);
              const x = getX(i);
              return events.map((newsEvent, eventIndex) => {
                const isPositive = (newsEvent.impactDirection ?? 0) >= 0;
                const offset = (eventIndex - (events.length - 1) / 2) * 8;
                return (
                  <g key={`news-flag-${newsEvent.id}`} className="cursor-pointer">
                    <line x1={x + offset} y1={padding.top} x2={x + offset} y2={p4Top + 12} stroke={isPositive ? '#F04452' : '#3182F6'} strokeWidth="1" strokeDasharray="2,2" opacity="0.6" />
                    <circle cx={x + offset} cy={p4Top + 12} r="5.5" fill={isPositive ? '#F04452' : '#3182F6'} filter="url(#glowEffect)" />
                    <text x={x + offset} y={p4Top + 28} textAnchor="middle" className="text-[8.5px] font-mono fill-white font-extrabold">
                      {newsEvent.targetSector ? SECTOR_METADATA[newsEvent.targetSector]?.nameKo || '뉴스' : '뉴스'}
                    </text>
                  </g>
                );
              });
            })}
          </g>

          {/* ══════════════════════════════════════════
              동기화 크로스헤어 (Synchronized Crosshair)
             ══════════════════════════════════════════ */}
          {hoverIndex !== null && (
            <g pointerEvents="none">
              <line
                x1={getX(hoverIndex)}
                y1={padding.top}
                x2={getX(hoverIndex)}
                y2={p4Top + panelHeight4}
                stroke="#F4F5F6"
                strokeWidth="1.2"
                strokeDasharray="3,3"
                opacity="0.8"
              />
              <circle cx={getX(hoverIndex)} cy={p4Top + 12} r="4" fill="#F4F5F6" />
            </g>
          )}

          {/* X축 시간 라벨 (3~5개 분할) */}
          <g>
            {[0, Math.floor(pointsCount / 2), pointsCount - 1].map((idx) => {
              if (idx < 0 || idx >= pointsCount || !data[idx]) return null;
              return (
                <text
                  key={`time-${idx}`}
                  x={getX(idx)}
                  y={p4Top + panelHeight4 + 16}
                  textAnchor="middle"
                  className="text-[9.5px] font-mono fill-slate-400 font-semibold"
                >
                  {data[idx].timeLabel}
                </text>
              );
            })}
          </g>
        </svg>

        {/* ══════════════════════════════════════════
            호버 인텔리전스 툴팁 (Floating Crosshair Info)
           ══════════════════════════════════════════ */}
        {activePoint && (
          <div className="absolute top-3 right-3 bg-[#111622]/95 border border-[#2D3748] p-3 rounded-xl shadow-2xl backdrop-blur-md max-w-xs text-xs font-mono space-y-2 pointer-events-none transition-all">
            <div className="flex justify-between items-center border-b border-[#2D3748] pb-1.5">
              <span className="text-cyan-400 font-extrabold flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                시점: {activePoint.timeLabel}
              </span>
              <span className="text-slate-300 font-bold">
                총 거래대금: {fmtKrw(activePoint.totalTurnover)}
              </span>
            </div>

            {/* 섹터별 거래대금 & 봇 순매수 요약 */}
            <div className="space-y-1">
              <span className="text-[10px] text-slate-400 font-bold block">주요 산업별 거래대금 / 봇 순매수:</span>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10.5px]">
                {sectors.slice(0, 4).map((secKey) => {
                  const to = activePoint.sectorTurnover[secKey] || 0;
                  const net = activePoint.sectorBotNetTurnover[secKey] || 0;
                  const meta = SECTOR_METADATA[secKey];
                  return (
                    <div key={secKey} className="flex justify-between items-center">
                      <span className="truncate" style={{ color: meta?.color || '#94A3B8' }}>
                        {meta?.nameKo}:
                      </span>
                      <span className={`font-bold ${net > 0 ? 'text-[#F04452]' : net < 0 ? 'text-[#3182F6]' : 'text-slate-400'}`}>
                        {net !== 0 ? (net > 0 ? `+${fmtKrw(net)}` : fmtKrw(net)) : `${fmtKrw(to)}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 1위 주도주 상태 */}
            {activePoint.topLeaders[0] && (
              <div className="border-t border-[#2D3748] pt-1.5 text-[10.5px]">
                <div className="flex justify-between items-center">
                  <span className="text-amber-400 font-bold">
                    1위: {activePoint.topLeaders[0].name}
                  </span>
                  <span className="text-slate-300">
                    관심도: {(activePoint.topLeaders[0].attentionScore * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="flex justify-between text-[9.5px] text-slate-400 mt-0.5">
                  <span>스프레드: {activePoint.topLeaders[0].spreadBps}bps</span>
                  <span>호가잔량: {fmtKrw(activePoint.topLeaders[0].depthNotional)}</span>
                </div>
              </div>
            )}

            {/* 이벤트 발생 요약 */}
            {activePoint.newsEvent && (
              <div className="border-t border-[#2D3748] pt-1.5 text-[10px] text-rose-300 font-sans">
                <span className="font-extrabold text-[#F04452] mr-1">[공시/뉴스]</span>
                {activePoint.newsEvent.headline}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
