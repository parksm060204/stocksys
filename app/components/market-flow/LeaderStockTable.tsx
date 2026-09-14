'use client';

import React from 'react';
import { LeaderStockScore, SECTOR_METADATA } from '@/lib/engine/simulation/marketDiagnostics';

interface LeaderStockTableProps {
  leaderBoard: LeaderStockScore[];
  selectedStockId?: string | null;
  onSelectStock?: (stockId: string) => void;
}

export const LeaderStockTable: React.FC<LeaderStockTableProps> = ({
  leaderBoard,
  selectedStockId,
  onSelectStock,
}) => {
  const fmtPct = (val: number) => {
    const sign = val > 0 ? '+' : '';
    return `${sign}${(val * 100).toFixed(1)}%`;
  };

  return (
    <div className="bg-[#0E1117] border border-[#1F2937] rounded-3xl p-5 shadow-2xl space-y-3 font-mono text-xs">
      {/* 헤더 타이틀 */}
      <div className="flex justify-between items-center border-b border-[#1F2937] pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base">🏆</span>
            <h3 className="text-sm font-black text-white">
              실시간 주도주 리더보드 (Market Leaders vs Attention)
            </h3>
          </div>
          <p className="text-[11px] text-[#8E939D] mt-0.5 font-sans font-medium">
            체결 기반 <strong className="text-white">주도주 순위</strong>와 봇들의 <strong className="text-amber-400">관심도 순위</strong>를 분리하여 인과관계를 관찰합니다.
          </p>
        </div>
        <span className="text-[10px] bg-[#161B22] text-slate-300 px-2.5 py-1 rounded-full border border-[#2D3748]">
          Top 10 모니터링
        </span>
      </div>

      {/* 테이블 그리드 */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-[#1F2937] text-[10px] text-slate-400 uppercase tracking-wider font-bold">
              <th className="py-2.5 px-2 text-center w-12">주도주</th>
              <th className="py-2.5 px-2">종목명 / 티커</th>
              <th className="py-2.5 px-2 text-center">섹터</th>
              <th className="py-2.5 px-2 text-right">주도점수</th>
              <th className="py-2.5 px-2 text-center">관심순위</th>
              <th className="py-2.5 px-2 text-right">관심도</th>
              <th className="py-2.5 px-2 text-right">상대수익률</th>
              <th className="py-2.5 px-2 text-right">상대거래대금</th>
              <th className="py-2.5 px-2 text-right">순체결(Flow)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#1F2937]/60 text-[11px]">
            {leaderBoard.map((item) => {
              const isSelected = selectedStockId === item.stockId;
              const sectorMeta = SECTOR_METADATA[item.sectorId] || { nameKo: '기타', color: '#64748B' };

              // 주도 순위 vs 관심 순위 차이 계산 (선행/후행)
              const rankDiff = item.attentionRank - item.leaderRank;

              return (
                <tr
                  key={item.stockId}
                  onClick={() => onSelectStock?.(item.stockId)}
                  className={`cursor-pointer transition-colors ${
                    isSelected ? 'bg-cyan-950/40 border-l-4 border-cyan-400' : 'hover:bg-[#161B22]/80'
                  }`}
                >
                  {/* 주도주 순위 (Leader Rank) */}
                  <td className="py-2.5 px-2 text-center font-black">
                    <span
                      className={`inline-flex items-center justify-center w-5 h-5 rounded-md ${
                        item.leaderRank === 1
                          ? 'bg-amber-400 text-black font-extrabold shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                          : item.leaderRank === 2
                          ? 'bg-slate-300 text-black font-extrabold'
                          : item.leaderRank === 3
                          ? 'bg-amber-700 text-white font-extrabold'
                          : 'text-slate-400'
                      }`}
                    >
                      {item.leaderRank}
                    </span>
                  </td>

                  {/* 종목명 & 티커 */}
                  <td className="py-2.5 px-2">
                    <div className="font-extrabold text-white text-[12px] truncate max-w-[130px]">
                      {item.name}
                    </div>
                    <div className="text-[9.5px] text-slate-500 font-mono">{item.ticker}</div>
                  </td>

                  {/* 섹터 배지 */}
                  <td className="py-2.5 px-2 text-center">
                    <span
                      className="px-2 py-0.5 rounded-full text-[9.5px] font-bold border"
                      style={{
                        backgroundColor: `${sectorMeta.color}15`,
                        color: sectorMeta.color,
                        borderColor: `${sectorMeta.color}40`,
                      }}
                    >
                      {sectorMeta.nameKo}
                    </span>
                  </td>

                  {/* 주도주 종합 점수 */}
                  <td className="py-2.5 px-2 text-right font-black text-cyan-400">
                    {item.leaderScore.toFixed(2)}
                  </td>

                  {/* 관심 순위 (Attention Rank) */}
                  <td className="py-2.5 px-2 text-center">
                    <span className="font-bold text-slate-300 mr-1.5">{item.attentionRank}위</span>
                    {rankDiff !== 0 && (
                      <span
                        className={`text-[9px] font-bold ${
                          rankDiff > 0 ? 'text-[#F04452]' : 'text-[#3182F6]'
                        }`}
                        title={
                          rankDiff > 0
                            ? `관심 순위보다 주도 순위가 ${rankDiff}단계 더 높음 (실제 거래 집중)`
                            : `관심 순위가 주도 순위보다 ${Math.abs(rankDiff)}단계 더 높음 (관심 선행)`
                        }
                      >
                        {rankDiff > 0 ? `▲${rankDiff}` : `▼${Math.abs(rankDiff)}`}
                      </span>
                    )}
                  </td>

                  {/* 관심도 게이지 & 점수 */}
                  <td className="py-2.5 px-2 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <div className="w-12 h-1.5 bg-[#161B22] rounded-full overflow-hidden border border-[#2D3748]">
                        <div
                          className="h-full bg-amber-400 rounded-full transition-all"
                          style={{ width: `${Math.min(100, item.attentionScore * 100)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-amber-400 font-bold">
                        {(item.attentionScore * 100).toFixed(0)}%
                      </span>
                    </div>
                  </td>

                  {/* 상대수익률 */}
                  <td
                    className={`py-2.5 px-2 text-right font-extrabold ${
                      item.relativeReturn > 0
                        ? 'text-[#F04452]'
                        : item.relativeReturn < 0
                        ? 'text-[#3182F6]'
                        : 'text-slate-400'
                    }`}
                  >
                    {fmtPct(item.relativeReturn)}
                  </td>

                  {/* 상대거래대금 (시장 평균 대비 배수) */}
                  <td className="py-2.5 px-2 text-right font-bold text-slate-200">
                    {item.relativeTurnover > 0 ? `${item.relativeTurnover.toFixed(1)}x` : '-'}
                  </td>

                  {/* 순 체결량 (signedFlow) */}
                  <td
                    className={`py-2.5 px-2 text-right font-bold ${
                      item.signedFlow > 0
                        ? 'text-[#F04452]'
                        : item.signedFlow < 0
                        ? 'text-[#3182F6]'
                        : 'text-slate-500'
                    }`}
                  >
                    {item.signedFlow > 0 ? `+${item.signedFlow}` : item.signedFlow}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
