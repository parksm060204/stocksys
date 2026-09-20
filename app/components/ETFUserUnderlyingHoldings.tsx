'use client';

import React from 'react';
import { ExtendedETFDefinition } from '@/lib/engine/etfDefinitions';

interface ETFUserUnderlyingHoldingsProps {
  etf: ExtendedETFDefinition;
  userEtfShares: number;
  underlyingPrices: Map<string, number>;
}

export const ETFUserUnderlyingHoldings: React.FC<ETFUserUnderlyingHoldingsProps> = ({
  etf,
  userEtfShares,
  underlyingPrices,
}) => {
  if (userEtfShares <= 0) return null;

  let totalCUAssetValue = etf.cashComponent;
  etf.pdf.forEach((item) => {
    const price = underlyingPrices.get(item.ticker) ?? 0;
    totalCUAssetValue += price * item.sharesPerCU;
  });

  const isUsOrGlobal = etf.category === 'US' || etf.category === 'GLOBAL';

  const underlyingSharesBreakdown = etf.pdf.map((item) => {
    // 1 CU당 편입 주식 수에 비례하여 유저가 실물로 보유하게 되는 개별 주식 수 산출
    const realPhysicalShares = (userEtfShares / etf.cuSize) * item.sharesPerCU;
    const price = underlyingPrices.get(item.ticker) ?? 0;
    const valuePerCU = price * item.sharesPerCU;
    const aumWeightPercent = totalCUAssetValue > 0 ? (valuePerCU / totalCUAssetValue) * 100 : item.weight;
    const totalPhysicalValue = Math.round(realPhysicalShares * price);

    return {
      ...item,
      realPhysicalShares: Number(realPhysicalShares.toFixed(4)),
      price,
      valuePerCU,
      aumWeightPercent,
      totalPhysicalValue,
    };
  });

  return (
    <div className="bg-panel border border-border p-5 rounded-3xl space-y-3 font-mono text-xs shadow-xl select-none">
      <div className="flex justify-between items-center border-b border-border pb-2">
        <span className="text-[12px] font-black text-amber-500 flex items-center gap-1.5 font-sans">
          <span>🏦 내 계좌 보유 ETF의 실물 담보 주식 연계 내역 (AUM 비중 포함)</span>
        </span>
        <span className="text-xs font-bold text-tx bg-panel2 px-2.5 py-0.5 rounded-full border border-border font-mono">
          보유 수량: {userEtfShares.toLocaleString()}주
        </span>
      </div>

      <p className="text-xs text-muted font-medium font-sans">
        고객님이 보유하신 {etf.name} {userEtfShares.toLocaleString()}주 뒤에는 운용자산(AUM) 대비 아래 비중의 실물 주식이 안전하게 담보 보관되고 있습니다:
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
        {underlyingSharesBreakdown.map((item) => (
          <div
            key={item.ticker}
            className="flex items-center justify-between bg-panel2 p-3 rounded-2xl border border-border"
          >
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-up text-[12px]">{item.ticker}</span>
                <span className="text-[9.5px] font-bold bg-down/10 text-down px-1.5 py-0.5 rounded border border-down/30">
                  AUM 비중 {item.aumWeightPercent.toFixed(1)}%
                </span>
              </div>
              <span className="text-[10.5px] text-muted block mt-0.5">
                1주당 {isUsOrGlobal ? `$${item.price.toFixed(2)}` : `₩${Math.round(item.price).toLocaleString('ko-KR')}`}
              </span>
            </div>
            <div className="text-right">
              <span className="font-black text-tx text-[13px] block tabular-nums">
                {item.realPhysicalShares.toLocaleString()} 주
              </span>
              <span className="text-[10.5px] text-down font-bold tabular-nums">
                {isUsOrGlobal ? `$${item.totalPhysicalValue.toFixed(2)}` : `₩${Math.round(item.totalPhysicalValue).toLocaleString('ko-KR')}`}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
