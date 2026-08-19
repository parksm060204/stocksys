'use client';

import React, { useState } from 'react';
import {
  INDIVIDUAL_INSTITUTION_REGISTRY,
} from '@/lib/engine/crossAssetLinkageEngine';
import {
  InstitutionalSectorEngine,
} from '@/lib/engine/institutionalSectorEngine';

import { MacroRegimeType } from '@/lib/engine/macroRegimeEngine';

interface InstitutionalSectorPortfolioWidgetProps {
  activeRegime?: MacroRegimeType;
}

export const InstitutionalSectorPortfolioWidget: React.FC<InstitutionalSectorPortfolioWidgetProps> = ({
  activeRegime = 'NORMAL'
}) => {
  const [selectedInstId, setSelectedInstId] = useState<string>("NPS_KOREA");

  const instList = Object.values(INDIVIDUAL_INSTITUTION_REGISTRY);
  const profile = InstitutionalSectorEngine.getProfile(selectedInstId, activeRegime);

  return (
    <div className="bg-[#0E1117] border border-[#212631] p-5 text-xs font-mono rounded-3xl select-none shadow-2xl space-y-4">
      {/* 헤더 타이틀 및 기관 선택 드롭다운 */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-[#212631] pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base">📊</span>
            <h3 className="text-sm font-black text-white">기관별 구체적 7대 섹터 주식 포트폴리오 터미널</h3>
          </div>
          <p className="text-[11px] text-[#8E939D] mt-0.5 font-sans font-medium">
            월스트리트 & 여의도 50개 금융기관의 섹터별 편입 비중(%) 및 실물 주요 편입 종목 상세 현황
          </p>
        </div>

        {/* 기관 선택 셀렉터 */}
        <div className="bg-[#161B22] border border-[#212631] px-3 py-1.5 rounded-xl">
          <select
            value={selectedInstId}
            onChange={(e) => setSelectedInstId(e.target.value)}
            className="bg-transparent text-white font-extrabold outline-none cursor-pointer text-xs font-sans"
          >
            {instList.map((inst) => (
              <option key={inst.id} value={inst.id} className="bg-[#0E1117] text-white">
                {inst.name} ({inst.weights.mandateName})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 개요 정보 카드 */}
      <div className="bg-[#05070A] p-4 rounded-2xl border border-[#212631] space-y-3">
        <div className="flex justify-between items-center text-[11.5px]">
          <div>
            <span className="text-white font-black text-[13.5px]">{profile.institution.name}</span>
            <span className="text-[#8E939D] font-bold text-[10.5px] ml-2">({profile.institution.nameEn})</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[#00C805] font-black bg-[#00C805]/10 px-2.5 py-0.5 rounded-full border border-[#00C805]/30">
              주식 AUM: ${profile.totalStockAumBillion.toLocaleString()}B (약 {(profile.totalStockAumBillion * 1.3).toFixed(0)}조원)
            </span>
            <span className="text-amber-400 font-extrabold bg-amber-400/10 px-2.5 py-0.5 rounded-full border border-amber-400/30">
              최대 비중: {profile.primarySector.name}
            </span>
          </div>
        </div>

        {/* 7대 섹터 가중치 스택 게이지 바 */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-[10px] text-[#8E939D] font-bold">
            <span>7대 산업 섹터 자산배분 구성비</span>
            <span>총 100%</span>
          </div>
          <div className="h-3.5 w-full bg-[#161B22] rounded-full overflow-hidden flex border border-[#212631]">
            {profile.sectorAllocations.map((sec) => (
              <div
                key={sec.sectorId}
                className="h-full transition-all duration-300 relative group"
                style={{ width: `${sec.weightPercent}%`, backgroundColor: sec.color }}
                title={`${sec.sectorName}: ${sec.weightPercent}% ($${sec.allocatedAmountBillion}B)`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* 7대 섹터 세부 포트폴리오 리스트 */}
      <div className="space-y-2">
        <span className="text-[11px] font-extrabold text-[#8E939D] block">
          섹터별 할당 비중(%) & 실물 핵심 편입 종목 (Sector Breakdown & Top Holdings)
        </span>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {profile.sectorAllocations.map((sec) => (
            <div
              key={sec.sectorId}
              className="bg-[#05070A] p-3.5 rounded-2xl border border-[#212631] space-y-2.5 hover:border-white/20 transition-all"
            >
              <div className="flex justify-between items-center border-b border-[#212631] pb-2">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm">{sec.icon}</span>
                  <span className="font-extrabold text-white text-[12.5px]">{sec.sectorName}</span>
                </div>
                <div className="text-right">
                  <span className="font-black text-[13px] block" style={{ color: sec.color }}>
                    {sec.weightPercent}%
                  </span>
                  <span className="text-[10px] text-[#8E939D]">
                    ${sec.allocatedAmountBillion}B (약 {(sec.allocatedAmountBillion * 1.3).toFixed(0)}조원)
                  </span>
                </div>
              </div>

              {/* 핵심 편입 종목 세부 카드 */}
              <div className="space-y-1 font-sans">
                <span className="text-[10px] text-[#8E939D] font-bold block">핵심 편입 주식 Breakdown:</span>
                <div className="flex flex-wrap gap-1.5">
                  {sec.topConstituentStocks.map((stk) => (
                    <span
                      key={stk.name}
                      className="bg-[#161B22] border border-[#212631] px-2 py-1 rounded-lg text-[10.5px] text-[#C1C7D0] flex items-center gap-1"
                    >
                      <strong className="text-white">{stk.name}</strong>
                      <span className="text-[9.5px] text-[#8E939D] font-mono">${stk.estimatedAmountBillion}B</span>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
