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
    <div className="bg-[#05070A] border border-[#212631] p-4 rounded-2xl space-y-3 font-mono text-xs shadow-xl">
      <div className="flex justify-between items-center border-b border-[#212631] pb-2">
        <span className="text-[12px] font-black text-amber-400 flex items-center gap-1.5">
          <span>🏦 내 계좌 보유 ETF의 실물 담보 주식 연계 내역 (AUM 비중 포함)</span>
        </span>
        <span className="text-[11px] font-bold text-white bg-[#161B22] px-2.5 py-0.5 rounded-full border border-[#212631]">
          보유 수량: {userEtfShares.toLocaleString()}주
        </span>
      </div>

      <p className="text-[11px] text-[#8E939D] font-medium font-sans">
        고객님이 보유하신 {etf.name} {userEtfShares.toLocaleString()}주 뒤에는 운용자산(AUM) 대비 아래 비중의 실물 주식이 안전하게 담보 보관되고 있습니다:
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
        {underlyingSharesBreakdown.map((item) => (
          <div
            key={item.ticker}
            className="flex items-center justify-between bg-[#0E1117] p-2.5 rounded-xl border border-[#212631]"
          >
            <div>
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-[#F04452] text-[12px]">{item.ticker}</span>
                <span className="text-[9.5px] font-bold bg-[#3182F6]/15 text-[#3182F6] px-1.5 py-0.2 rounded border border-[#3182F6]/30">
                  AUM 비중 {item.aumWeightPercent.toFixed(1)}%
                </span>
              </div>
              <span className="text-[10.5px] text-[#8E939D] block mt-0.5">
                1주당 {isUsOrGlobal ? `$${item.price.toFixed(2)}` : `₩${Math.round(item.price).toLocaleString('ko-KR')}`}
              </span>
            </div>
            <div className="text-right">
              <span className="font-black text-white text-[13px] block tabular-nums">
                {item.realPhysicalShares.toLocaleString()} 주
              </span>
              <span className="text-[10.5px] text-[#3182F6] font-bold tabular-nums">
                {isUsOrGlobal ? `$${item.totalPhysicalValue.toFixed(2)}` : `₩${Math.round(item.totalPhysicalValue).toLocaleString('ko-KR')}`}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
