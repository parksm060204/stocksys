'use client';

import React from 'react';
import { ExtendedETFDefinition } from '@/lib/engine/etfDefinitions';

interface ETFItemCardProps {
  etf: ExtendedETFDefinition;
  currentMarketPrice: number;
  iNAV: number;
  discrepancyRate: number;
  isSelected: boolean;
  onSelect: () => void;
}

export const ETFItemCard: React.FC<ETFItemCardProps> = ({
  etf,
  currentMarketPrice,
  iNAV,
  discrepancyRate,
  isSelected,
  onSelect
}) => {
  const isPremium = discrepancyRate > 0;
  const isLeverage = etf.leverageFactor !== 1;
  const isUsOrGlobal = etf.category === 'US' || etf.category === 'GLOBAL';
  const currencySymbol = isUsOrGlobal ? '$' : '₩';

  return (
    <div
      onClick={onSelect}
      className={`p-3.5 rounded border cursor-pointer transition-all flex flex-col justify-between space-y-2 select-none font-mono ${
        isSelected
          ? 'border-yellow-400 bg-yellow-500/10 text-white shadow-[0_0_15px_rgba(245,197,24,0.2)]'
          : 'border-[#222736] bg-[#141721] text-gray-300 hover:border-gray-500 hover:bg-[#1a1e2b]'
      }`}
    >
      {/* Top Header & Badges */}
      <div className="flex justify-between items-start gap-1">
        <div>
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-sm text-white">{etf.etfTicker}</span>
            {isLeverage && (
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                etf.leverageFactor > 0 ? 'bg-red-500/20 text-[#ef5350]' : 'bg-blue-500/20 text-[#42a5f5]'
              }`}>
                {etf.leverageFactor > 0 ? `+${etf.leverageFactor}X` : `${etf.leverageFactor}X`}
              </span>
            )}
          </div>
          <p className="text-[11px] text-gray-400 font-sans line-clamp-1 mt-0.5">{etf.name}</p>
        </div>

        {/* 괴리율 뱃지 */}
        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border tabular-nums ${
          isPremium
            ? 'bg-red-950/60 text-red-400 border-red-800'
            : 'bg-blue-950/60 text-blue-400 border-blue-800'
        }`}>
          {isPremium ? '🔴 +' : '🔵 '}{discrepancyRate.toFixed(2)}%
        </span>
      </div>

      {/* Price & iNAV Comparison */}
      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#1e222f] text-xs">
        <div>
          <span className="text-[10px] text-gray-500 block">현재 시장가</span>
          <span className="font-bold text-white tabular-nums">
            {currencySymbol}{currentMarketPrice.toLocaleString()}
          </span>
        </div>

        <div>
          <span className="text-[10px] text-gray-500 block">실시간 iNAV</span>
          <span className="font-semibold text-amber-300 tabular-nums">
            {currencySymbol}{iNAV.toLocaleString()}
          </span>
        </div>
      </div>
    </div>
  );
};
