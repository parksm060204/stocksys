'use client';

import React, { useState } from 'react';
import {
  INDIVIDUAL_INSTITUTION_REGISTRY,
  CrossAssetLinkageEngine,
  MarketStateSnapshot,
} from '@/lib/engine/crossAssetLinkageEngine';

export const CrossAssetLinkageWidget: React.FC = () => {
  const [selectedInstId, setSelectedInstId] = useState<string>("NPS_KOREA");

  // 샘플 시장 데이터 스냅샷
  const [marketSnapshot] = useState<MarketStateSnapshot>({
    equitySpotPrices: { "SAMSUNG_ELEC": 72000, "SK_HYNIX": 145000 },
    bondYield10Y: 3.52,
    bondYield3Y: 3.20,
    futuresPrice: 350.50,
    spotIndexPrice: 350.20,
    callOptionPrice: 2.15,
    putOptionPrice: 2.57,
    strikePrice: 260.00,
  });

  const instList = Object.values(INDIVIDUAL_INSTITUTION_REGISTRY);
  const currentInst = INDIVIDUAL_INSTITUTION_REGISTRY[selectedInstId] || instList[0];
  const signalResult = CrossAssetLinkageEngine.calculateSignal(selectedInstId, marketSnapshot);

  const { wSpot, wDeriv, wBond } = currentInst.weights;

  return (
    <div className="bg-[#0E1117] border border-[#212631] p-5 text-xs font-mono rounded-3xl select-none shadow-2xl space-y-4">
      {/* 헤더 타이틀 및 기관 선택 드롭다운 */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-[#212631] pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base">🏛️</span>
            <h3 className="text-sm font-black text-white">현실 모티브 기관 3원 연계(파생-채권-현물) 통합 엔진</h3>
          </div>
          <p className="text-[11px] text-[#8E939D] mt-0.5 font-sans font-medium">
            파생상품(옵션/선물) · 채권(국채/금리) · 현물(주식/원자재) 3대 시장 동시 연계 매매
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

      {/* 선택된 기관의 현실 모티브 & 3원 시장 가중치 게이지 바 */}
      <div className="bg-[#05070A] p-4 rounded-2xl border border-[#212631] space-y-3">
        <div className="flex justify-between items-center text-[11.5px]">
          <div>
            <span className="text-white font-black text-[13px]">{currentInst.name}</span>
            <span className="text-[#8E939D] font-bold text-[10.5px] ml-2">({currentInst.nameEn})</span>
          </div>
          <span className="text-amber-400 font-extrabold bg-amber-400/10 px-2.5 py-0.5 rounded-full border border-amber-400/30">
            AUM: ${currentInst.aumBillionUsd.toLocaleString()}B (약 {(currentInst.aumBillionUsd * 1.3).toFixed(0)}조원)
          </span>
        </div>

        <div className="text-[11px] text-[#8E939D] font-sans">
          <strong>현실 모티브:</strong> {currentInst.weights.realWorldMotif} | <strong>운용 전략:</strong> {currentInst.weights.strategyDescription}
        </div>

        {/* 3원 가중치 게이지 프로그레스 바 (현물 GREEN, 파생 RED, 채권 BLUE) */}
        <div className="space-y-1">
          <div className="flex justify-between text-[10.5px] font-bold">
            <span className="text-[#00C805]">현물(주식/원자재): {Math.round(wSpot * 100)}%</span>
            <span className="text-[#F04452]">파생(선물/옵션): {Math.round(wDeriv * 100)}%</span>
            <span className="text-[#3182F6]">채권(국채/금리): {Math.round(wBond * 100)}%</span>
          </div>
          <div className="h-3 w-full bg-[#161B22] rounded-full overflow-hidden flex border border-[#212631]">
            <div className="bg-[#00C805] h-full" style={{ width: `${wSpot * 100}%` }} title="현물 가중치" />
            <div className="bg-[#F04452] h-full" style={{ width: `${wDeriv * 100}%` }} title="파생 가중치" />
            <div className="bg-[#3182F6] h-full" style={{ width: `${wBond * 100}%` }} title="채권 가중치" />
          </div>
        </div>
      </div>

      {/* 3대 시장 지표 실시간 계산 패널 (ERP, Basis, Parity) */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-[#05070A] p-3 rounded-xl border border-[#212631]">
          <span className="text-[#8E939D] block text-[10px] font-bold">Equity Risk Premium (ERP)</span>
          <span className="text-white font-black text-[13px] tabular-nums">+{signalResult.equityRiskPremium}%</span>
          <span className="text-[9.5px] text-[#8E939D] block mt-0.5">10년물 금리 {marketSnapshot.bondYield10Y}%</span>
        </div>

        <div className="bg-[#05070A] p-3 rounded-xl border border-[#212631]">
          <span className="text-[#8E939D] block text-[10px] font-bold">Futures Basis (선물-현물)</span>
          <span className="text-[#F04452] font-black text-[13px] tabular-nums">+{signalResult.basis} pt</span>
          <span className="text-[9.5px] text-[#F04452] block mt-0.5">Contango 차익 시그널</span>
        </div>

        <div className="bg-[#05070A] p-3 rounded-xl border border-[#212631]">
          <span className="text-[#8E939D] block text-[10px] font-bold">통합 3원 연계 시그널</span>
          <span className={`text-[13px] font-black tabular-nums ${
            signalResult.unifiedSignalScore > 0 ? 'text-[#F04452]' : 'text-[#3182F6]'
          }`}>
            {signalResult.unifiedSignalScore > 0 ? '+' : ''}{signalResult.unifiedSignalScore}
          </span>
          <span className="text-[9.5px] text-white block mt-0.5 font-bold">
            {signalResult.unifiedSignalScore > 0.2 ? 'Risk-On 확충' : 'Risk-Off 방어'}
          </span>
        </div>
      </div>

      {/* 3-Leg 동시 연계 실행 주문 레그 (Leg 1: 현물, Leg 2: 파생, Leg 3: 채권) */}
      <div className="bg-[#05070A] p-3.5 rounded-2xl border border-[#212631] space-y-2">
        <div className="flex justify-between items-center border-b border-[#212631] pb-2">
          <span className="text-[11px] font-extrabold text-white">⚡ 3-Leg 동시 연계 매매 레그 (Execution Plan)</span>
          <span className="text-[10px] text-amber-400 font-bold">LIVE EXECUTION</span>
        </div>

        <div className="text-[11px] text-[#C1C7D0] font-sans font-medium">
          {signalResult.recommendedLegOrders.tradeReason}
        </div>

        <div className="grid grid-cols-3 gap-2 pt-1 font-mono text-[11px]">
          {/* Leg 1: 현물 */}
          <div className="bg-[#161B22] p-2.5 rounded-xl border border-[#212631]">
            <span className="text-[9.5px] text-[#00C805] font-bold block">Leg 1: 현물 시장</span>
            <span className="text-white font-extrabold block mt-0.5">
              {signalResult.recommendedLegOrders.spotAction === 'BUY' ? '🟢 주식 1,500주 매수' : '🔴 주식 매도'}
            </span>
          </div>

          {/* Leg 2: 파생 */}
          <div className="bg-[#161B22] p-2.5 rounded-xl border border-[#212631]">
            <span className="text-[9.5px] text-[#F04452] font-bold block">Leg 2: 파생상품</span>
            <span className="text-white font-extrabold block mt-0.5">
              {signalResult.recommendedLegOrders.derivAction}
            </span>
          </div>

          {/* Leg 3: 채권 */}
          <div className="bg-[#161B22] p-2.5 rounded-xl border border-[#212631]">
            <span className="text-[9.5px] text-[#3182F6] font-bold block">Leg 3: 채권/금리</span>
            <span className="text-white font-extrabold block mt-0.5">
              {signalResult.recommendedLegOrders.bondAction === 'BUY_BOND' ? '🔵 국채 10년물 매수' : '중립'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
