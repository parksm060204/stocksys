'use client';

import React from 'react';
import { CausalTraceLog } from '@/lib/engine/simulation/marketDiagnostics';

interface CausalTraceStreamProps {
  logs: CausalTraceLog[];
}

export const CausalTraceStream: React.FC<CausalTraceStreamProps> = ({ logs }) => {
  const getStageBadge = (stage: CausalTraceLog['stage']) => {
    switch (stage) {
      case 'NEWS_RECEIVED':
        return <span className="bg-rose-950/60 text-[#F04452] border border-rose-800/80 px-2 py-0.5 rounded text-[9.5px] font-black">뉴스수신</span>;
      case 'STRATEGY_DECISION':
        return <span className="bg-amber-950/60 text-amber-400 border border-amber-800/80 px-2 py-0.5 rounded text-[9.5px] font-black">전략판단</span>;
      case 'ORDER_SUBMIT':
        return <span className="bg-cyan-950/60 text-cyan-400 border border-cyan-800/80 px-2 py-0.5 rounded text-[9.5px] font-black">주문제출</span>;
      case 'ORDER_FILL':
        return <span className="bg-emerald-950/60 text-emerald-400 border border-emerald-800/80 px-2 py-0.5 rounded text-[9.5px] font-black">실체결</span>;
      case 'LEADER_UPDATE':
        return <span className="bg-purple-950/60 text-purple-400 border border-purple-800/80 px-2 py-0.5 rounded text-[9.5px] font-black">주도순위</span>;
      default:
        return <span className="bg-slate-800 text-slate-400 px-2 py-0.5 rounded text-[9.5px] font-black">기타</span>;
    }
  };

  const formatTime = (ts: number) => {
    const date = new Date(ts);
    return isFinite(date.getTime()) ? date.toTimeString().split(' ')[0] : 'Invalid time';
  };

  return (
    <div className="bg-[#0E1117] border border-[#1F2937] rounded-3xl p-5 shadow-2xl space-y-3 font-mono text-xs">
      <div className="flex justify-between items-center border-b border-[#1F2937] pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base">⚡</span>
            <h3 className="text-sm font-black text-white">
              실시간 시장 인과 추적 피드 (Live Causal Trace Stream)
            </h3>
          </div>
          <p className="text-[11px] text-[#8E939D] mt-0.5 font-sans font-medium">
            뉴스 발생부터 봇 판단, 호가 제출, 실제 체결 및 주도주 점수 갱신까지의 체인을 실시간 기록합니다.
          </p>
        </div>
        <span className="text-[10px] text-emerald-400 bg-emerald-950/40 px-2 py-1 rounded-full border border-emerald-800 animate-pulse">
          실시간 스트림
        </span>
      </div>

      {/* 로그 리스트 (스크롤 가능한 터미널 뷰) */}
      <div className="bg-[#07090E] border border-[#1F2937] rounded-2xl p-3 max-h-[360px] overflow-y-auto space-y-2 select-text">
        {logs.length === 0 ? (
          <div className="text-center py-8 text-slate-500 font-sans">
            기록된 시장 인과 로그가 없습니다. 시뮬레이션이 진행되면 자동으로 수집됩니다.
          </div>
        ) : (
          [...logs].reverse().map((log, idx) => (
            <div
              key={`${log.timestamp}-${idx}`}
              className="flex items-start gap-2.5 p-2 rounded-xl bg-[#0E1117]/60 border border-[#1F2937]/40 hover:bg-[#161B22] transition-colors"
            >
              <span className="text-[10px] text-slate-500 font-mono shrink-0 pt-0.5">
                {formatTime(log.timestamp)}
              </span>
              <div className="shrink-0">{getStageBadge(log.stage)}</div>
              <div className="flex-1 text-[11px] text-slate-300 break-all leading-snug">
                {log.stockId && (
                  <span className="text-cyan-400 font-bold mr-1.5">[{log.stockId}]</span>
                )}
                {log.agentId && (
                  <span className="text-amber-400 font-bold mr-1.5">({log.agentId})</span>
                )}
                <span>{log.details}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
