"use client";

import React from 'react';
import { useOrderbookData } from '@/lib/hooks/useOrderbookData';
import type { TradeRecord } from '@/lib/hooks/useOrderbookData';
import type { SimTrade } from '@/lib/hooks/useStockBotSimulation';
import type { Stock } from '@/lib/types';
import { fmtKSTTime } from '@/lib/format';

interface TradeFeedProps {
  stock?: Stock;
  trades?: SimTrade[];
  rolloverEvents?: Array<{
    comboId: string;
    botId: string;
    quantity: number;
    executedSpread: number;
  }>;
}

export const TradeFeed: React.FC<TradeFeedProps> = ({ stock, trades: externalTrades, rolloverEvents = [] }) => {
  // DB 기반 훅 (DB 없으면 시뮬레이션 fallback)
  const { trades: dbTrades, source } = useOrderbookData(
    stock?.id ?? '__none__',
    stock?.ticker ?? '__none__',
    stock?.currentPrice ?? 0,
    800,
  );

  // 외부 trades 우선, 없으면 DB 시뮬레이션 결과 (stock이 없으면 빈 배열)
  // SimTrade[] → TradeRecord[] 변환
  const externalMapped: TradeRecord[] = externalTrades?.map((t: SimTrade) => ({
    tradeId: t.tradeId,
    price: t.price,
    quantity: t.quantity,
    side: t.side,
    isLiquidation: t.isLiquidation,
    timestamp: t.timestamp,
  })) ?? [];

  const trades = externalMapped.length > 0
    ? externalMapped
    : stock
      ? dbTrades
      : [];

  const fmtPrice = (priceVal: number) => {
    const isUSD = stock?.market === 'overseas' || stock?.market === 'europe' || stock?.market === 'commodities';
    return isUSD ? `$${priceVal.toFixed(2)}` : `₩${Math.round(priceVal).toLocaleString()}`;
  };

  return (
    <div className="flex flex-col h-full text-xs font-sans select-none bg-panel">
      {/* 헤더 */}
      <div className="bg-panel px-4 py-2 border-b border-border flex justify-between items-center shrink-0">
        <span className="text-[12.5px] font-black text-tx flex items-center gap-2">
          <span>실시간 체결</span>
          <span className="text-[10px] font-mono text-muted font-normal uppercase">Trade Feed</span>
        </span>
        <span
          className={`text-[10px] font-mono font-bold flex items-center gap-1.5 px-2 py-0.5 rounded-full border ${
            source === 'db' ? 'text-up bg-up/10 border-[#F04452]/30' : 'text-emerald-500 bg-emerald-500/10 border-emerald-500/30'
          }`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-current animate-ping" />
          <span>{source === 'db' ? 'LIVE (DB)' : 'LIVE FEED'}</span>
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-1.5 space-y-1 bg-bg scrollbar-thin scrollbar-thumb-gray-800">
        {/* 롤오버 특수 알림 */}
        {rolloverEvents.length > 0 && (
          <div className="p-2.5 bg-panel2 border border-border rounded-xl text-xs text-tx animate-pulse space-y-0.5">
            <div className="font-bold text-tx flex justify-between">
              <span>🔄 롤오버(Rollover) 수급 감지</span>
              <span>스프레드: +₩{rolloverEvents[0].executedSpread.toFixed(0)}</span>
            </div>
            <div className="text-muted text-[10.5px]">
              세력 ID: <span className="text-amber-500 font-bold">{rolloverEvents[0].botId}</span> | {rolloverEvents[0].quantity.toLocaleString()}계약 원자적 이월 완료
            </div>
          </div>
        )}

        {/* 체결 테이블 헤더 */}
        <div className="grid grid-cols-3 text-[10.5px] text-muted font-bold px-3 py-1 border-b border-border bg-panel2 rounded-lg">
          <span>시간</span>
          <span className="text-right">체결가</span>
          <span className="text-right">수량 (주)</span>
        </div>

        {/* 체결 피드 */}
        {trades.length === 0 ? (
          <div className="py-6 text-center text-[11.5px] text-[#8E939D] font-mono">체결 대기 중...</div>
        ) : (
          trades.map((t) => {
            if (t.isLiquidation) {
              return (
                <div key={t.tradeId} className="flex justify-between items-center px-3 py-1.5 bg-[#241335] border-l-2 border-purple-500 text-purple-300 font-bold rounded-lg text-xs">
                  <span className="text-[10px] font-black">🚨 [LIQUIDATION]</span>
                  <span className="font-mono tabular-nums">{fmtPrice(t.price)}</span>
                  <span className="font-mono tabular-nums font-black">{t.quantity.toLocaleString()}주</span>
                </div>
              );
            }

            const isUp = t.side === 'BUY';
            return (
              <div key={t.tradeId} className="grid grid-cols-3 items-center px-3 py-1 border-b border-border/40 text-[11.5px] hover:bg-hover transition-colors font-mono">
                <span className="text-muted text-[10.5px] tabular-nums">
                  {fmtKSTTime(t.timestamp)}
                </span>
                <span className={`text-right font-black tabular-nums ${isUp ? 'text-up' : 'text-down'}`}>
                  {fmtPrice(t.price)}
                </span>
                <span className={`text-right font-bold tabular-nums ${isUp ? 'text-up' : 'text-down'}`}>
                  {t.quantity.toLocaleString()}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default TradeFeed;