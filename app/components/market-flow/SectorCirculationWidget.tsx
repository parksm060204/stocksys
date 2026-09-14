'use client';

import React from 'react';
import { SectorFlowSummary, SECTOR_METADATA } from '@/lib/engine/simulation/marketDiagnostics';

interface SectorCirculationWidgetProps {
  sectorSummary: SectorFlowSummary[];
  onSelectSector?: (sectorId: string) => void;
}

export const SectorCirculationWidget: React.FC<SectorCirculationWidgetProps> = ({
  sectorSummary,
  onSelectSector,
}) => {
  const formatKrw = (val: number) => {
    if (Math.abs(val) >= 1e8) return `${(val / 1e8).toFixed(1)}억원`;
    if (Math.abs(val) >= 1e4) return `${(val / 1e4).toFixed(0)}만원`;
    return `${Math.round(val).toLocaleString()}원`;
  };

  // 거래대금 비중 순 정렬
  const sortedSectors = [...sectorSummary].sort((a, b) => b.turnoverShare - a.turnoverShare);

  return (
    <div className="bg-[#0E1117] border border-[#1F2937] rounded-3xl p-5 shadow-2xl space-y-4 font-mono text-xs">
      {/* 헤더 */}
      <div className="flex justify-between items-center border-b border-[#1F2937] pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base">🔄</span>
            <h3 className="text-sm font-black text-white">
              산업별 자금 순환 및 봇 수급 (Sector Circulation & Net Flow)
            </h3>
          </div>
          <p className="text-[11px] text-[#8E939D] mt-0.5 font-sans font-medium">
            유한한 자금 하에서 산업별 거래대금 점유율과 봇 집단의 실질 순매수 유입/유출을 추적합니다.
          </p>
        </div>
        <span className="text-[10px] text-cyan-400 bg-cyan-950/40 px-2.5 py-1 rounded-full border border-cyan-800">
          실체결 기반 수급
        </span>
      </div>

      {/* 1. 전체 100% 누적 거래대금 점유율 스택 바 */}
      <div className="space-y-1.5 bg-[#07090E] p-3 rounded-2xl border border-[#1F2937]">
        <div className="flex justify-between text-[10.5px] text-[#8E939D] font-bold">
          <span>시장 전체 거래대금 비중 배분</span>
          <span className="text-slate-300">총 100%</span>
        </div>
        <div className="h-4 w-full bg-[#161B22] rounded-full overflow-hidden flex border border-[#2D3748]">
          {sortedSectors.map((sec) => {
            if (sec.turnoverShare <= 0) return null;
            const meta = SECTOR_METADATA[sec.sectorId] || { nameKo: sec.sectorName, color: '#64748B' };

            return (
              <div
                key={sec.sectorId}
                className="h-full transition-all duration-300 relative group cursor-pointer"
                style={{ width: `${sec.turnoverShare}%`, backgroundColor: meta.color }}
                title={`${sec.sectorName}: ${sec.turnoverShare}% (${formatKrw(sec.turnover)})`}
                onClick={() => onSelectSector?.(sec.sectorId)}
              />
            );
          })}
        </div>
      </div>

      {/* 2. 섹터별 카드 리스트 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {sortedSectors.map((sec) => {
          const meta = SECTOR_METADATA[sec.sectorId] || { nameKo: sec.sectorName, color: '#64748B' };
          const isNetBuy = sec.botNetTurnover > 0;
          const isNetSell = sec.botNetTurnover < 0;

          return (
            <div
              key={sec.sectorId}
              onClick={() => onSelectSector?.(sec.sectorId)}
              className="bg-[#0A0D14] border border-[#1F2937] hover:border-[#374151] rounded-2xl p-3.5 space-y-2 cursor-pointer transition-all hover:scale-[1.01]"
            >
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: meta.color }} />
                  <span className="text-white font-black text-[12px]">{sec.sectorName}</span>
                  <span className="text-[10px] text-slate-500 font-sans">({sec.stockCount}종목)</span>
                </div>
                <span className="font-extrabold text-[12px] text-cyan-400">
                  {sec.turnoverShare}%
                </span>
              </div>

              {/* 진행률 바 */}
              <div className="w-full bg-[#161B22] h-1.5 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, sec.turnoverShare)}%`, backgroundColor: meta.color }}
                />
              </div>

              {/* 세부 수치: 거래대금 vs 봇 순매수 */}
              <div className="flex justify-between items-center text-[10.5px] pt-0.5">
                <div className="text-slate-400">
                  대장: <strong className="text-slate-200">{sec.leadStockName}</strong>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-slate-500">봇 순수급:</span>
                  <span
                    className={`font-black px-1.5 py-0.5 rounded ${
                      isNetBuy
                        ? 'bg-rose-950/60 text-[#F04452] border border-rose-800/60'
                        : isNetSell
                        ? 'bg-blue-950/60 text-[#3182F6] border border-blue-800/60'
                        : 'text-slate-400'
                    }`}
                  >
                    {sec.botNetTurnover !== 0
                      ? isNetBuy
                        ? `+${formatKrw(sec.botNetTurnover)}`
                        : formatKrw(sec.botNetTurnover)
                      : '0원'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
