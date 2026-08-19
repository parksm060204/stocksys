'use client';

import React, { useState } from 'react';
import { iNAVData, LPQuote } from '@/lib/engine/etfTypes';

interface ETFMonitorProps {
  navData: iNAVData;
  lpQuote: LPQuote;
}

export const ETFMonitorWidget: React.FC<ETFMonitorProps> = ({ navData, lpQuote }) => {
  const [showGuideModal, setShowGuideModal] = useState<boolean>(false);
  const isPremium = navData.discrepancyRate > 0;

  return (
    <div className="bg-[#0E1117] border border-[#212631] p-4 text-xs font-mono rounded-2xl select-none shadow-xl">
      {/* 타이틀, 괴리율 뱃지 및 상세 가이드 버튼 */}
      <div className="flex justify-between items-center mb-3 pb-2 border-b border-[#212631]">
        <div className="flex items-center space-x-2">
          <span className="text-[#F04452] font-black text-[13px]">{navData.etfTicker}</span>
          <span className="text-[#8E939D] text-[11px] font-bold">ETF iNAV Monitor</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGuideModal(true)}
            className="bg-[#161B22] hover:bg-[#212631] text-amber-400 border border-amber-500/30 px-2.5 py-0.5 rounded-full text-[10.5px] font-bold transition-all cursor-pointer flex items-center gap-1"
          >
            <span>💡 iNAV 상세 가이드</span>
          </button>

          <div className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-extrabold border tabular-nums ${
            isPremium ? 'bg-[#F04452]/15 text-[#F04452] border-[#F04452]/30' : 'bg-[#3182F6]/15 text-[#3182F6] border-[#3182F6]/30'
          }`}>
            괴리율: {navData.discrepancyRate > 0 ? '+' : ''}{navData.discrepancyRate}%
          </div>
        </div>
      </div>

      {/* iNAV vs 시장가 비교 데이터 표 */}
      <div className="grid grid-cols-2 gap-2 mb-3 bg-[#05070A] p-3 rounded-xl border border-[#212631]">
        <div>
          <span className="text-[#8E939D] block text-[10px] font-bold">실시간 iNAV (순자산가치)</span>
          <span className="text-lg font-black text-white tabular-nums">₩{Math.round(navData.iNAV).toLocaleString('ko-KR')}</span>
        </div>
        <div>
          <span className="text-[#8E939D] block text-[10px] font-bold">현재 시장가</span>
          <span className={`text-lg font-black tabular-nums ${isPremium ? 'text-[#F04452]' : 'text-[#3182F6]'}`}>
            ₩{Math.round(navData.marketPrice).toLocaleString('ko-KR')}
          </span>
        </div>
      </div>

      {/* LP 앵커링 시세 안정화 상태 표시 */}
      <div className="bg-[#161B22] p-2.5 rounded-xl border border-[#212631] mb-3 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] text-amber-400 font-extrabold">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>🛡️ LP (유동성공급자) iNAV 앵커링 가동 중</span>
        </div>
        <span className="text-[10px] text-[#8E939D] font-mono">괴리율 ±0.15% 이내 밀착 관리</span>
      </div>

      {/* LP 유동성 공급자 호가 레벨 */}
      <div className="border-t border-[#212631] pt-2.5">
        <span className="text-[10px] text-[#8E939D] block mb-1 font-bold">LP (유동성공급자) 주문 스프레드</span>
        <div className="flex justify-between items-center text-[11.5px] bg-[#161B22] px-3 py-1.5 rounded-lg border border-[#212631]">
          <span className="text-[#F04452] font-black">매수 ₩{Math.round(lpQuote.bid).toLocaleString('ko-KR')} ({lpQuote.bidQty.toLocaleString()}주)</span>
          <span className="text-[#565A63]">|</span>
          <span className="text-[#3182F6] font-black">매도 ₩{Math.round(lpQuote.ask).toLocaleString('ko-KR')} ({lpQuote.askQty.toLocaleString()}주)</span>
        </div>
      </div>

      {/* iNAV & 괴리율 상세 안내 모달 */}
      {showGuideModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-sans select-none">
          <div className="w-full max-w-lg rounded-3xl border border-[#212631] bg-[#0E1117] p-6 shadow-2xl space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-[#212631] pb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg">💡</span>
                <h2 className="text-sm font-black text-white">iNAV (실시간 추정 순자산가치) & 괴리율 상세 가이드</h2>
              </div>
              <button
                onClick={() => setShowGuideModal(false)}
                className="text-[#8E939D] hover:text-white font-bold text-sm cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-[#C1C7D0] leading-relaxed">
              <div className="bg-[#05070A] p-3.5 rounded-2xl border border-[#212631] space-y-1.5">
                <span className="text-[#F04452] font-extrabold text-[12px] block">1. iNAV (indicative Net Asset Value) 란?</span>
                <p className="text-[11.5px] text-[#8E939D]">
                  ETF가 담고 있는 실물 기초주식 포트폴리오(PDF: Portfolio Deposit File)의 실시간 주가 변동을 반영하여 15초 단위로 실시간 산출되는 <strong>1주당 실제 본질 순자산가치</strong>입니다.
                </p>
                <div className="bg-[#161B22] p-2 rounded-xl text-[10.5px] font-mono text-white">
                  iNAV = [ (∑ 편입주식 실시간가 × CU당 수량) + 현금구성금 ] ÷ 1 CU 단위 수량 (50,000주)
                </div>
              </div>

              <div className="bg-[#05070A] p-3.5 rounded-2xl border border-[#212631] space-y-1.5">
                <span className="text-[#3182F6] font-extrabold text-[12px] block">2. 괴리율 (Discrepancy Rate) 과 매매 전략</span>
                <p className="text-[11.5px] text-[#8E939D]">
                  시장에서 거래되는 ETF 실시간 매매가격과 iNAV 간의 차이를 나타냅니다.
                </p>
                <div className="bg-[#161B22] p-2 rounded-xl text-[10.5px] font-mono text-white mb-1">
                  괴리율 (%) = [ (ETF 시장가격 - iNAV) ÷ iNAV ] × 100
                </div>
                <ul className="list-disc list-inside space-y-1 text-[11px]">
                  <li><strong className="text-[#F04452]">양수 (+) 괴리율 (프리미엄)</strong>: ETF가 실제 순자산가치보다 고평가되어 거래 중입니다. (AP 봇이 ETF 설정 후 매도 차익실현)</li>
                  <li><strong className="text-[#3182F6]">음수 (-) 괴리율 (디스카운트)</strong>: ETF가 실제 순자산가치보다 저평가되어 거래 중입니다. (AP 봇이 ETF 매수 후 해지 차익실현)</li>
                </ul>
              </div>

              <div className="bg-[#05070A] p-3.5 rounded-2xl border border-[#212631] space-y-1">
                <span className="text-amber-400 font-extrabold text-[12px] block">3. LP (유동성공급자) 의 역할</span>
                <p className="text-[11.5px] text-[#8E939D]">
                  증권사 LP는 iNAV를 기준으로 상하 일정 비율 범위 내에서 연속적으로 매수/매도 호가를 제공하여 괴리율이 과도하게 벌어지는 것을 방지합니다.
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowGuideModal(false)}
              className="w-full py-3 bg-[#F04452] hover:bg-[#ff5252] text-white font-extrabold rounded-2xl text-xs transition-all shadow-[0_0_15px_rgba(240,68,82,0.35)] cursor-pointer"
            >
              확인 및 닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
