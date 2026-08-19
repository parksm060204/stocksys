'use client';

import React from 'react';
import { ExtendedETFDefinition, roundToETFTick } from '@/lib/engine/etfDefinitions';

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

  // KRX ETF 호가단위 (2,000원 이상 ~ 50,000원 미만 5원 단위) 적용
  const displayMarketPrice = roundToETFTick(currentMarketPrice, isUsOrGlobal);
  const displayINAV = roundToETFTick(iNAV, isUsOrGlobal);

  const formattedMarketPrice = isUsOrGlobal
    ? `${currencySymbol}${displayMarketPrice.toFixed(2)}`
    : `${currencySymbol}${displayMarketPrice.toLocaleString('ko-KR')}`;

  const formattedINAV = isUsOrGlobal
    ? `${currencySymbol}${displayINAV.toFixed(2)}`
    : `${currencySymbol}${displayINAV.toLocaleString('ko-KR')}`;

  const topHoldingsStr = etf.pdf
    .slice(0, 2)
    .map(p => `${p.ticker} (${p.weight}%)`)
    .join(' · ');

  return (
    <div
      onClick={onSelect}
      className={`p-4 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between space-y-3 select-none font-mono ${
        isSelected
          ? 'border-[#F04452] bg-[#F04452]/10 text-white shadow-[0_0_20px_rgba(240,68,82,0.2)]'
          : 'border-[#212631] bg-[#0E1117] text-[#8E939D] hover:border-white/20 hover:bg-[#161B22]'
      }`}
    >
      {/* Top Header & Badges */}
      <div className="flex justify-between items-start gap-1">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-black text-[14px] text-white tracking-tight">{etf.etfTicker}</span>
            {isLeverage && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                etf.leverageFactor > 0 ? 'bg-[#F04452]/15 text-[#F04452] border border-[#F04452]/30' : 'bg-[#3182F6]/15 text-[#3182F6] border border-[#3182F6]/30'
              }`}>
                {etf.leverageFactor > 0 ? `+${etf.leverageFactor}X` : `${etf.leverageFactor}X`}
              </span>
            )}
          </div>
          <p className="text-[12px] text-[#8E939D] font-sans line-clamp-1 mt-1 font-medium">{etf.name}</p>
        </div>

        {/* 괴리율 뱃지 */}
        <span className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-extrabold border tabular-nums ${
          isPremium
            ? 'bg-[#F04452]/15 text-[#F04452] border-[#F04452]/30'
            : 'bg-[#3182F6]/15 text-[#3182F6] border-[#3182F6]/30'
        }`}>
          {isPremium ? '+' : ''}{discrepancyRate.toFixed(2)}%
        </span>
      </div>

      {/* Top Holdings AUM % Preview */}
      <div className="text-[10.5px] text-[#8E939D] font-medium truncate flex items-center gap-1.5 bg-[#05070A]/60 px-2.5 py-1 rounded-lg border border-[#212631]/60">
        <span className="text-[#3182F6] font-bold shrink-0">주요 비중:</span>
        <span className="truncate text-white font-mono">{topHoldingsStr}</span>
      </div>

      {/* Price & iNAV Comparison */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#212631] text-xs">
        <div>
          <span className="text-[10px] text-[#565A63] block font-bold">현재 시장가</span>
          <span className="font-black text-white tabular-nums text-[13.5px]">
            {formattedMarketPrice}
          </span>
        </div>

        <div>
          <span className="text-[10px] text-[#565A63] block font-bold">실시간 iNAV</span>
          <span className="font-black text-[#F04452] tabular-nums text-[13.5px]">
            {formattedINAV}
          </span>
        </div>
      </div>
    </div>
  );
};
