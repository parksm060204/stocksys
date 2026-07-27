'use client';

import React from 'react';
import { iNAVData, LPQuote } from '@/lib/engine/etfTypes';

interface ETFMonitorProps {
  navData: iNAVData;
  lpQuote: LPQuote;
}

export const ETFMonitorWidget: React.FC<ETFMonitorProps> = ({ navData, lpQuote }) => {
  const isPremium = navData.discrepancyRate > 0;

  return (
    <div className="bg-[#0d0e12] border border-[#2a2e39] p-3 text-xs font-mono rounded select-none">
      {/* 타이틀 및 괴리율 뱃지 */}
      <div className="flex justify-between items-center mb-3 pb-2 border-b border-[#1e222d]">
        <div className="flex items-center space-x-2">
          <span className="text-yellow-400 font-bold">{navData.etfTicker}</span>
          <span className="text-gray-400 text-[11px]">ETF NAV Monitor</span>
        </div>
        <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${
          isPremium ? 'bg-red-950 text-red-400 border border-red-800' : 'bg-blue-950 text-blue-400 border border-blue-800'
        }`}>
          괴리율: {navData.discrepancyRate > 0 ? '+' : ''}{navData.discrepancyRate}%
        </div>
      </div>

      {/* iNAV vs 시장가 비교 데이터 표 */}
      <div className="grid grid-cols-2 gap-2 mb-3 bg-[#16181d] p-2 rounded border border-[#222736]">
        <div>
          <span className="text-gray-500 block text-[10px]">실시간 iNAV</span>
          <span className="text-lg font-bold text-white tabular-nums">₩{navData.iNAV.toLocaleString()}</span>
        </div>
        <div>
          <span className="text-gray-500 block text-[10px]">현재 시장가</span>
          <span className={`text-lg font-bold tabular-nums ${isPremium ? 'text-red-400' : 'text-blue-400'}`}>
            ₩{navData.marketPrice.toLocaleString()}
          </span>
        </div>
      </div>

      {/* LP 유동성 공급자 호가 레벨 */}
      <div className="border-t border-[#1e222d] pt-2">
        <span className="text-[10px] text-gray-400 block mb-1 font-bold">🏛️ LP(유동성공급자) 주문 스프레드</span>
        <div className="flex justify-between items-center text-[11px]">
          <span className="text-blue-400 font-semibold">매수 ₩{lpQuote.bid.toLocaleString()} ({lpQuote.bidQty.toLocaleString()}주)</span>
          <span className="text-gray-600">|</span>
          <span className="text-red-400 font-semibold">매도 ₩{lpQuote.ask.toLocaleString()} ({lpQuote.askQty.toLocaleString()}주)</span>
        </div>
      </div>
    </div>
  );
};
