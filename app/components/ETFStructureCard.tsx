'use client';

import React from 'react';
import { ExtendedETFDefinition } from '@/lib/engine/etfDefinitions';

interface ETFStructureCardProps {
  etf: ExtendedETFDefinition;
  underlyingPrices: Map<string, number>;
}

export const ETFStructureCard: React.FC<ETFStructureCardProps> = ({ etf, underlyingPrices }) => {
  let totalCUAssetValue = etf.cashComponent;

  // Calculate total CU value first for accurate real-time AUM % calculations
  etf.pdf.forEach((item) => {
    const price = underlyingPrices.get(item.ticker) ?? 0;
    totalCUAssetValue += price * item.sharesPerCU;
  });

  const pdfDetails = etf.pdf.map((item) => {
    const price = underlyingPrices.get(item.ticker) ?? 0;
    const valuePerCU = price * item.sharesPerCU;
    const aumWeightPercent = totalCUAssetValue > 0 ? (valuePerCU / totalCUAssetValue) * 100 : item.weight;

    // 펀드 전체가 보유 중인 실물 주식 총 수량 (Total Outstanding Units / CU Size * SharesPerCU)
    const totalFundHoldingShares = Math.round((etf.totalOutstandingUnits / etf.cuSize) * item.sharesPerCU);

    return {
      ...item,
      currentPrice: price,
      valuePerCU,
      aumWeightPercent,
      totalFundHoldingShares,
    };
  });

  const cashWeightPercent = totalCUAssetValue > 0 ? (etf.cashComponent / totalCUAssetValue) * 100 : 0;
  const totalFundAUM = (totalCUAssetValue / etf.cuSize) * etf.totalOutstandingUnits;
  const isUsOrGlobal = etf.category === 'US' || etf.category === 'GLOBAL';

  return (
    <div className="bg-panel border border-border p-5 text-xs font-mono rounded-3xl select-none shadow-2xl space-y-4">
      {/* 헤더 타이틀 */}
      <div className="flex justify-between items-center border-b border-border pb-3">
        <div>
          <h3 className="text-sm font-black text-tx flex items-center gap-2">
            <span>📊 ETF 상품 구조 & PDF (납입자산구성내역)</span>
          </h3>
          <p className="text-xs text-muted mt-0.5 font-medium font-sans">
            펀드가 실제 매수·보관 중인 보유종목의 운용자산(AUM) 대비 실시간 비중(%) 및 1 CU 자산 구성
          </p>
        </div>
        <span className="text-xs font-bold text-up bg-up/10 px-2.5 py-1 rounded-full border border-up/30">
          AUM: {isUsOrGlobal ? `$${(totalFundAUM / 1000000).toFixed(2)}M` : `₩${Math.round(totalFundAUM / 100000000).toLocaleString()}억원`}
        </span>
      </div>

      {/* 상품 개요 요약 카드 (기초자산, 레버리지, CU 규격) */}
      <div className="grid grid-cols-3 gap-2 bg-panel2 p-3 rounded-2xl border border-border">
        <div>
          <span className="text-dim block text-[10px] font-bold font-sans">기초자산 유형</span>
          <span className="text-tx font-extrabold text-[12px]">{etf.underlyingType} ({etf.category})</span>
        </div>
        <div>
          <span className="text-dim block text-[10px] font-bold font-sans">연동 배율</span>
          <span className="text-up font-black text-[12px]">
            {etf.leverageFactor > 0 ? `+${etf.leverageFactor}X 정방향` : `${etf.leverageFactor}X 인버스`}
          </span>
        </div>
        <div>
          <span className="text-dim block text-[10px] font-bold font-sans">Creation Unit (1 CU)</span>
          <span className="text-tx font-mono font-bold text-[12px]">{etf.cuSize.toLocaleString()} 주</span>
        </div>
      </div>

      {/* PDF 구성종목 세부 테이블 */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-[11.5px] font-extrabold text-muted block font-sans">
            보유종목별 운용자산(AUM) 대비 비중 및 펀드 보유 실체 수량
          </span>
          <span className="text-[10px] text-amber-500 font-bold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 font-sans">
            AUM 비중 산출 완료
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border bg-panel2">
          <table className="w-full text-left border-collapse font-mono text-[11.5px]">
            <thead>
              <tr className="border-b border-border bg-panel text-muted text-[10.5px]">
                <th className="py-2.5 px-3">보유 종목 (Ticker)</th>
                <th className="py-2.5 px-3 text-right">CU당 수량</th>
                <th className="py-2.5 px-3 text-center text-down font-bold">운용자산(AUM) 대비 비중</th>
                <th className="py-2.5 px-3 text-right">현재 평가주가</th>
                <th className="py-2.5 px-3 text-right">1 CU당 평가액</th>
                <th className="py-2.5 px-3 text-right text-amber-500">펀드 실물 보유 주식수</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border text-tx">
              {pdfDetails.map((item) => (
                <tr key={item.ticker} className="hover:bg-hover transition-colors">
                  <td className="py-2.5 px-3 font-extrabold text-up">{item.ticker}</td>
                  <td className="py-2.5 px-3 text-right font-bold">{item.sharesPerCU.toLocaleString()} 주</td>
                  <td className="py-2.5 px-3 text-center">
                    <div className="flex items-center justify-end gap-2">
                      <div className="w-20 bg-panel h-2 rounded-full overflow-hidden border border-border">
                        <div
                          className="bg-gradient-to-r from-[#3182F6] to-[#00C853] h-full rounded-full"
                          style={{ width: `${Math.min(100, Math.max(2, item.aumWeightPercent))}%` }}
                        />
                      </div>
                      <span className="text-down font-black w-14 text-right tabular-nums">
                        {item.aumWeightPercent.toFixed(2)}%
                      </span>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                    {isUsOrGlobal ? `$${item.currentPrice.toFixed(2)}` : `₩${Math.round(item.currentPrice).toLocaleString('ko-KR')}`}
                  </td>
                  <td className="py-2.5 px-3 text-right font-bold tabular-nums">
                    {isUsOrGlobal ? `$${item.valuePerCU.toFixed(2)}` : `₩${Math.round(item.valuePerCU).toLocaleString('ko-KR')}`}
                  </td>
                  <td className="py-2.5 px-3 text-right text-amber-400 font-black tabular-nums">
                    {item.totalFundHoldingShares.toLocaleString()} 주
                  </td>
                </tr>
              ))}
              <tr className="bg-[#161B22]/80 font-bold border-t border-border">
                <td className="py-2.5 px-3 text-[#8E939D]">현금 구성금 (Cash)</td>
                <td className="py-2.5 px-3 text-right text-[#8E939D]">-</td>
                <td className="py-2.5 px-3 text-center">
                  <div className="flex items-center justify-end gap-2">
                    <div className="w-20 bg-[#161B22] h-2 rounded-full overflow-hidden border border-border">
                      <div
                        className="bg-amber-400 h-full rounded-full"
                        style={{ width: `${Math.min(100, Math.max(1, cashWeightPercent))}%` }}
                      />
                    </div>
                    <span className="text-amber-400 font-black w-14 text-right tabular-nums">
                      {cashWeightPercent.toFixed(2)}%
                    </span>
                  </div>
                </td>
                <td className="py-2.5 px-3 text-right text-[#8E939D]">-</td>
                <td className="py-2.5 px-3 text-right text-white">
                  {isUsOrGlobal ? `$${etf.cashComponent.toFixed(2)}` : `₩${etf.cashComponent.toLocaleString()}`}
                </td>
                <td className="py-2.5 px-3 text-right text-[#8E939D]">100% 현금 담보</td>
              </tr>
              <tr className="bg-[#161B22] font-black border-t-2 border-border text-xs">
                <td className="py-3 px-3 text-white">합계 (Total AUM)</td>
                <td className="py-3 px-3 text-right text-[#8E939D]">-</td>
                <td className="py-3 px-3 text-right text-[#00C853] tabular-nums">100.00%</td>
                <td className="py-3 px-3 text-right text-[#8E939D]">-</td>
                <td className="py-3 px-3 text-right text-[#00C853] tabular-nums">
                  {isUsOrGlobal ? `$${totalCUAssetValue.toFixed(2)}` : `₩${Math.round(totalCUAssetValue).toLocaleString('ko-KR')}`}
                </td>
                <td className="py-3 px-3 text-right text-[#8E939D]">1 CU 총 자산가치</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
