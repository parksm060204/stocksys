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
    ? displayMarketPrice.toFixed(2)
    : displayMarketPrice.toLocaleString('ko-KR');

  const formattedINAV = isUsOrGlobal
    ? displayINAV.toFixed(2)
    : displayINAV.toLocaleString('ko-KR');

  const topHoldingsStr = etf.pdf
    .slice(0, 2)
    .map(p => `${p.ticker} (${p.weight}%)`)
    .join(' · ');

  return (
    <div
      onClick={onSelect}
      className={`p-4 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between space-y-3 select-none ${
        isSelected
          ? 'border-up/60 bg-up/5 text-tx shadow-[0_0_15px_rgba(240,68,82,0.15)]'
          : 'border-border bg-panel text-muted hover:border-border hover:bg-hover'
      }`}
    >
      {/* Top Header & Badges */}
      <div className="flex justify-between items-start gap-1">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-extrabold text-[14.5px] text-tx tracking-tight font-mono">{etf.etfTicker}</span>
            {isLeverage && (
              <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold border font-mono ${
                etf.leverageFactor > 0 ? 'bg-up/10 text-up border-up/30' : 'bg-down/10 text-down border-down/30'
              }`}>
                {etf.leverageFactor > 0 ? `+${etf.leverageFactor}X` : `${etf.leverageFactor}X`}
              </span>
            )}
          </div>
          <p className="text-[12px] text-muted font-sans line-clamp-1 mt-1 font-medium">{etf.name}</p>
        </div>

        {/* 괴리율 뱃지 */}
        <span className={`px-2 py-0.5 rounded-full text-[10.5px] font-bold border tabular-nums font-mono ${
          Math.abs(discrepancyRate) < 0.05
            ? 'bg-panel2 text-muted border-border'
            : isPremium
            ? 'bg-up/10 text-up border-up/30'
            : 'bg-down/10 text-down border-down/30'
        }`}>
          {isPremium ? '+' : ''}{discrepancyRate.toFixed(2)}%
        </span>
      </div>

      {/* Top Holdings AUM % Preview */}
      <div className="text-[11px] font-medium truncate flex items-center gap-1.5 bg-panel2 px-2.5 py-1.5 rounded-xl border border-border">
        <span className="text-dim font-bold shrink-0 text-[10.5px]">주요 비중:</span>
        <span className="truncate text-tx font-mono text-[11px]">{topHoldingsStr}</span>
      </div>

      {/* Price & iNAV Comparison */}
      <div className="grid grid-cols-2 gap-3 pt-2.5 border-t border-border">
        <div>
          <span className="text-[10.5px] text-dim block font-bold mb-0.5 font-sans">현재 시장가</span>
          <div className="font-mono font-extrabold text-tx tabular-nums text-[14px] flex items-baseline">
            <span className="text-xs font-normal text-muted mr-1">{currencySymbol}</span>
            <span>{formattedMarketPrice}</span>
          </div>
        </div>

        <div>
          <span className="text-[10.5px] text-dim block font-bold mb-0.5 font-sans">실시간 iNAV</span>
          <div className="font-mono font-extrabold text-tx tabular-nums text-[14px] flex items-baseline">
            <span className="text-xs font-normal text-muted mr-1">{currencySymbol}</span>
            <span>{formattedINAV}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
