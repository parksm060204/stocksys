"use client";

import React, { useState } from 'react';
import { OptionConfigState } from './OptionConfigModal';

interface OrderBookProps {
  ticker: string;
  orderBook: { bids: [number, number][]; asks: [number, number][] };
  config: OptionConfigState;
  unfilledOrders?: { id: string; side: 'BUY' | 'SELL'; price: number; qty: number }[];
  onCancelOrder?: (orderId: string) => void;
  onSelectPrice?: (price: number) => void;
}

export const OptionOrderBook: React.FC<OrderBookProps> = ({
  ticker,
  orderBook,
  config,
  unfilledOrders = [
    { id: 'UNF-1', side: 'BUY', price: 3350, qty: 5 },
    { id: 'UNF-2', side: 'SELL', price: 3500, qty: 2 },
  ],
  onCancelOrder,
  onSelectPrice,
}) => {
  const [draggedOrderId, setDraggedOrderId] = useState<string | null>(null);

  // 1. 호가 데이터 준비 (10단계 또는 5단계)
  const defaultAsks: [number, number][] = orderBook.asks.length > 0
    ? orderBook.asks
    : [
        [3600, 1200], [3570, 850], [3550, 2400], [3520, 1100], [3500, 1800],
        [3480, 1400], [3450, 950], [3420, 2100], [3400, 3100], [3380, 750]
      ];

  const defaultBids: [number, number][] = orderBook.bids.length > 0
    ? orderBook.bids
    : [
        [3350, 4200], [3330, 1600], [3300, 1900], [3280, 2200], [3250, 2800],
        [3230, 1100], [3200, 1500], [3180, 800], [3150, 3900], [3120, 900]
      ];

  const levelsCount = config.orderbookLevels;
  const asksToRender = defaultAsks.slice(0, levelsCount);
  const bidsToRender = defaultBids.slice(0, levelsCount);

  const maxAskVolume = Math.max(...asksToRender.map(([, qty]) => qty), 1);
  const maxBidVolume = Math.max(...bidsToRender.map(([, qty]) => qty), 1);

  const currentPrice = 3360; // 중앙 현재가 기준선

  // PIVOT 포인트 계산 (전일 고가 3600, 전일 저가 3100, 전일 종가 3350 기준)
  const pivot = 3350;
  const r1 = 3450; // 1차 저항선
  const r2 = 3550; // 2차 저항선
  const s1 = 3250; // 1차 지지선
  const s2 = 3150; // 2차 지지선

  const getPivotTag = (price: number) => {
    if (price === r2) return { label: 'R2 (2차저항)', color: 'text-[#F04452] bg-[#F04452]/20' };
    if (price === r1) return { label: 'R1 (1차저항)', color: 'text-[#F04452] bg-[#F04452]/10' };
    if (price === pivot) return { label: 'PIVOT 기준', color: 'text-amber-400 bg-amber-400/10' };
    if (price === s1) return { label: 'S1 (1차지지)', color: 'text-[#3182F6] bg-[#3182F6]/10' };
    if (price === s2) return { label: 'S2 (2차지지)', color: 'text-[#3182F6] bg-[#3182F6]/20' };
    return null;
  };

  const handleDropCancel = (e: React.DragEvent) => {
    e.preventDefault();
    if (draggedOrderId) {
      onCancelOrder?.(draggedOrderId);
      alert(`[정정/취소 실행] 주문 번호 ${draggedOrderId} 취소 접수 완료!`);
      setDraggedOrderId(null);
    }
  };

  return (
    <div className="flex flex-col h-full text-xs font-mono select-none">
      {/* 헤더 */}
      <div className="bg-[#090B0F] px-4 py-3 border-b border-[#212631] flex justify-between items-center">
        <span className="font-extrabold text-white text-[13px] tracking-wide flex items-center gap-2">
          <span>X-Ray {levelsCount}호가창</span>
          <span className="text-[10px] text-[#8E939D] font-bold">({config.layoutType === 'SYMMETRIC' ? '좌우대칭' : '일자형'})</span>
        </span>
        <span className="text-[10.5px] text-[#F04452] font-black">{ticker}</span>
      </div>

      {/* 실시간 체결량 이퀄라이저 바 */}
      {config.showEqualizer && (
        <div className="bg-[#161B22] border-b border-[#212631] px-3 py-1 flex items-center justify-between text-[10.5px]">
          <span className="text-[#8E939D] font-bold">매수/매도 세력 이퀄라이저:</span>
          <div className="flex items-center gap-1.5 flex-1 max-w-[140px] ml-2">
            <span className="text-[#F04452] font-bold text-[10px]">매수 62%</span>
            <div className="flex-1 bg-[#0E1117] h-2 rounded-full overflow-hidden flex border border-[#212631]">
              <div className="bg-[#F04452] h-full w-[62%]" />
              <div className="bg-[#3182F6] h-full w-[38%]" />
            </div>
            <span className="text-[#3182F6] font-bold text-[10px]">38%</span>
          </div>
        </div>
      )}

      {/* 호가 그리드 테이블 */}
      <div className="flex-1 flex flex-col justify-between overflow-hidden p-2 bg-[#05070A] space-y-1">
        {/* 매도 호가 (Asks) - 역순 출력 */}
        <div className="flex flex-col justify-end space-y-1 flex-1">
          {asksToRender.slice().reverse().map(([price, qty], idx) => {
            const pct = (qty / maxAskVolume) * 100;
            const isMaxQty = qty === maxAskVolume && config.boldMaxVolume;
            const isCurrentPrice = price === currentPrice;
            const pivotTag = getPivotTag(price);
            const unfilled = unfilledOrders.find((u) => u.price === price);

            return (
              <div
                key={`ask-${idx}`}
                onClick={() => onSelectPrice?.(price)}
                className={`relative flex justify-between items-center h-6 px-2.5 rounded-lg border transition-all cursor-pointer overflow-hidden ${
                  isCurrentPrice && config.showPriceOutline
                    ? 'border-[#F04452] ring-1 ring-[#F04452] bg-[#F04452]/10'
                    : 'border-[#212631] bg-[#0E1117] hover:border-white/20'
                }`}
              >
                {/* 잔량 막대 그래프 */}
                {config.showVolumeBar && (
                  <div
                    className="absolute right-0 top-0 bottom-0 bg-[#3182F6]/20 z-0 transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                )}

                {/* 가격 및 등락률 */}
                <div className="z-10 flex items-center space-x-1.5">
                  {unfilled && (
                    <span
                      draggable
                      onDragStart={() => setDraggedOrderId(unfilled.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`주문 ${unfilled.id} (${unfilled.qty}주)를 취소하시겠습니까?`)) {
                          onCancelOrder?.(unfilled.id);
                        }
                      }}
                      className="cursor-grab active:cursor-grabbing text-[11px] bg-[#3182F6]/20 text-[#3182F6] px-1 rounded font-bold border border-[#3182F6]/40"
                      title="드래그하거나 클릭하여 정정/취소"
                    >
                      🔴 {unfilled.qty}
                    </span>
                  )}
                  <span className={`font-bold tabular-nums ${config.useSideColors ? 'text-[#3182F6]' : 'text-white'}`}>
                    ₩{price.toLocaleString()}
                  </span>
                  {config.showChangeRate && (
                    <span className="text-[10px] text-[#8E939D] font-medium">+1.2%</span>
                  )}
                </div>

                {/* Pivot 태그 및 수량 */}
                <div className="z-10 flex items-center space-x-2">
                  {pivotTag && (
                    <span className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded border border-white/10 ${pivotTag.color}`}>
                      {pivotTag.label}
                    </span>
                  )}
                  <span className={`tabular-nums text-[#8E939D] ${isMaxQty ? 'font-black text-white' : 'font-medium'}`}>
                    {qty.toLocaleString()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* 현재가 경계선 (체결 중앙선) */}
        <div
          className={`my-1 py-1 px-3 text-center font-black border-y border-[#212631] text-[11px] rounded-lg flex justify-between items-center ${
            config.showPriceOutline ? 'bg-[#161B22] text-[#F04452] border-[#F04452]/40' : 'bg-[#161B22] text-white'
          }`}
        >
          <span className="text-[10px] text-[#8E939D] font-bold">현재가</span>
          <span className="font-mono text-[13px] tabular-nums">₩{currentPrice.toLocaleString()}</span>
          <span className="text-[10px] text-[#F04452] font-bold">기준선 SPREAD</span>
        </div>

        {/* 매수 호가 (Bids) */}
        <div className="flex flex-col justify-start space-y-1 flex-1">
          {bidsToRender.map(([price, qty], idx) => {
            const pct = (qty / maxBidVolume) * 100;
            const isMaxQty = qty === maxBidVolume && config.boldMaxVolume;
            const isCurrentPrice = price === currentPrice;
            const pivotTag = getPivotTag(price);
            const unfilled = unfilledOrders.find((u) => u.price === price);

            return (
              <div
                key={`bid-${idx}`}
                onClick={() => onSelectPrice?.(price)}
                className={`relative flex justify-between items-center h-6 px-2.5 rounded-lg border transition-all cursor-pointer overflow-hidden ${
                  isCurrentPrice && config.showPriceOutline
                    ? 'border-[#F04452] ring-1 ring-[#F04452] bg-[#F04452]/10'
                    : 'border-[#212631] bg-[#0E1117] hover:border-white/20'
                }`}
              >
                {/* 잔량 막대 그래프 */}
                {config.showVolumeBar && (
                  <div
                    className="absolute right-0 top-0 bottom-0 bg-[#F04452]/20 z-0 transition-all duration-300"
                    style={{ width: `${pct}%` }}
                  />
                )}

                {/* 가격 및 등락률 */}
                <div className="z-10 flex items-center space-x-1.5">
                  {unfilled && (
                    <span
                      draggable
                      onDragStart={() => setDraggedOrderId(unfilled.id)}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`주문 ${unfilled.id} (${unfilled.qty}주)를 취소하시겠습니까?`)) {
                          onCancelOrder?.(unfilled.id);
                        }
                      }}
                      className="cursor-grab active:cursor-grabbing text-[11px] bg-[#F04452]/20 text-[#F04452] px-1 rounded font-bold border border-[#F04452]/40"
                      title="드래그하거나 클릭하여 정정/취소"
                    >
                      🔵 {unfilled.qty}
                    </span>
                  )}
                  <span className={`font-bold tabular-nums ${config.useSideColors ? 'text-[#F04452]' : 'text-white'}`}>
                    ₩{price.toLocaleString()}
                  </span>
                  {config.showChangeRate && (
                    <span className="text-[10px] text-[#8E939D] font-medium">-0.8%</span>
                  )}
                </div>

                {/* Pivot 태그 및 수량 */}
                <div className="z-10 flex items-center space-x-2">
                  {pivotTag && (
                    <span className={`text-[9.5px] font-bold px-1.5 py-0.2 rounded border border-white/10 ${pivotTag.color}`}>
                      {pivotTag.label}
                    </span>
                  )}
                  <span className={`tabular-nums text-[#8E939D] ${isMaxQty ? 'font-black text-white' : 'font-medium'}`}>
                    {qty.toLocaleString()}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 정정 / 취소 드롭존 (하단 영역) */}
      {config.showCancelZone && (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDropCancel}
          className="border-t border-[#212631] bg-[#161B22] p-2 text-center transition-colors hover:bg-[#F04452]/10 cursor-pointer"
        >
          <span className="text-[11px] text-[#8E939D] font-bold flex items-center justify-center gap-1.5">
            <span>🗑️</span>
            <span>미체결 주문 아이콘을 이 구역으로 드래그하면 취소됩니다</span>
          </span>
        </div>
      )}
    </div>
  );
};
