'use client';

import React, { useState } from 'react';
import {
  MACRO_REGIME_REGISTRY,
  MacroRegimeType,
  MacroRegimeEngine,
} from '@/lib/engine/macroRegimeEngine';

interface MacroRegimeWidgetProps {
  onRegimeChange?: (regime: MacroRegimeType) => void;
}

export const MacroRegimeRebalanceWidget: React.FC<MacroRegimeWidgetProps> = ({ onRegimeChange }) => {
  const [activeRegime, setActiveRegime] = useState<MacroRegimeType>('NORMAL');
  const [customNewsTitle, setCustomNewsTitle] = useState<string>('');
  const [customNewsResult, setCustomNewsResult] = useState<any>(null);

  const currentProfile = MACRO_REGIME_REGISTRY[activeRegime];

  const handleSelectRegime = (regimeKey: MacroRegimeType) => {
    setActiveRegime(regimeKey);
    if (onRegimeChange) {
      onRegimeChange(regimeKey);
    }
  };

  const handleAnalyzeCustomNews = () => {
    if (!customNewsTitle.trim()) return;
    const res = MacroRegimeEngine.analyzeAINewsText(customNewsTitle, '');
    setCustomNewsResult(res);

    if (res.isThresholdExceeded) {
      if (res.targetSector === 'BIO_HEALTH') handleSelectRegime('BIO_REVOLUTION');
      else if (res.targetSector === 'BATTERY_ENERGY') handleSelectRegime('CLIMATE_CLEAN_ENERGY');
      else if (res.targetSector === 'TECH_SEMI') handleSelectRegime('QUANTUM_AI_SINGULARITY');
      else if (res.targetSector === 'DEFENSE_AERO') handleSelectRegime('DEFENSE_SPACE_COLONIZATION');
    }
  };

  return (
    <div className="bg-[#0E1117] border border-[#212631] p-5 text-xs font-mono rounded-3xl select-none shadow-2xl space-y-4">
      {/* 타이틀 및 헤더 */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 border-b border-[#212631] pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-base">🌍</span>
            <h3 className="text-sm font-black text-white">거시경제(Macro) & AI 뉴스 패러다임 시프트 장기 자산배분(SAA) 터미널</h3>
          </div>
          <p className="text-[11px] text-[#8E939D] mt-0.5 font-sans font-medium">
            거시 변동 및 AI 가중치 점수(S_news ≥ 0.70) 감지 시 50개 기관의 7대 섹터 포트폴리오를 N% 특수 대폭 재편
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className={`px-3 py-1 rounded-full text-[11px] font-black border ${
            currentProfile.isSpecialParadigm
              ? 'bg-[#F04452]/20 text-[#F04452] border-[#F04452]/40 animate-pulse'
              : 'bg-[#00C805]/15 text-[#00C805] border-[#00C805]/30'
          }`}>
            {currentProfile.isSpecialParadigm ? '⚡ AI 패러다임 시프트 N% 특수 리밸런싱 가동 중' : '🟢 표준 거시경제 모드'}
          </span>
        </div>
      </div>

      {/* 5대 표준 거시 국면 선택 탭 */}
      <div className="space-y-1.5">
        <span className="text-[10.5px] text-[#8E939D] font-bold block">1. 표준 거시경제 국면 선택 (Macro Regimes):</span>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[
            { key: 'NORMAL', label: '🟢 평상시 모드' },
            { key: 'HIGH_RATE_INFLATION', label: '📈 고금리/인플레이션' },
            { key: 'RATE_CUT_EASING', label: '🏦 금리 인하/유동성' },
            { key: 'AI_BOOM_TECH_RALLY', label: '💻 AI 슈퍼사이클' },
            { key: 'RECESSION_STAGFLATION', label: '🛡️ 경기 후퇴/스태그플' },
            { key: 'GEOPOLITICAL_DEFENSE_RISK', label: '⚔️ 지정학/공급망 리스크' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => handleSelectRegime(tab.key as MacroRegimeType)}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-extrabold whitespace-nowrap transition-all cursor-pointer ${
                activeRegime === tab.key
                  ? 'bg-[#161B22] text-white border border-amber-400/50 shadow-lg'
                  : 'bg-[#05070A] text-[#8E939D] border border-[#212631] hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4대 AI 패러다임 시프트 특수 버튼 (S_news >= 0.70 N% 대폭 재편) */}
      <div className="bg-[#05070A] p-3.5 rounded-2xl border border-[#212631] space-y-2">
        <div className="flex justify-between items-center">
          <span className="text-[11px] text-amber-400 font-extrabold flex items-center gap-1.5">
            <span>🔥 2. AI 뉴스 가중치 점수(S_news ≥ 0.70) N% 특수 대폭 리밸런싱 발동 시뮬레이션:</span>
          </span>
          <span className="text-[10px] text-[#8E939D]">문턱값 0.70 초과 시 N% 자금 강제 주입</span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <button
            onClick={() => handleSelectRegime('BIO_REVOLUTION')}
            className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
              activeRegime === 'BIO_REVOLUTION'
                ? 'bg-[#A855F7]/20 border-[#A855F7] text-white shadow-[0_0_15px_rgba(168,85,247,0.3)]'
                : 'bg-[#161B22] border-[#212631] text-[#C1C7D0] hover:border-[#A855F7]/50'
            }`}
          >
            <span className="font-extrabold text-[11.5px] block text-[#A855F7]">🧬 바이오 퀀텀점프</span>
            <span className="text-[9.5px] text-[#8E939D] block mt-0.5">AI 가중치: 0.88 (≥0.70)</span>
            <span className="text-[10px] text-amber-400 font-bold block mt-1">바이오 +35% 특수 증대</span>
          </button>

          <button
            onClick={() => handleSelectRegime('CLIMATE_CLEAN_ENERGY')}
            className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
              activeRegime === 'CLIMATE_CLEAN_ENERGY'
                ? 'bg-[#F04452]/20 border-[#F04452] text-white shadow-[0_0_15px_rgba(240,68,82,0.3)]'
                : 'bg-[#161B22] border-[#212631] text-[#C1C7D0] hover:border-[#F04452]/50'
            }`}
          >
            <span className="font-extrabold text-[11.5px] block text-[#F04452]">🌱 친환경 대전환</span>
            <span className="text-[9.5px] text-[#8E939D] block mt-0.5">AI 가중치: 0.85 (≥0.70)</span>
            <span className="text-[10px] text-amber-400 font-bold block mt-1">2차전지/에너지 +34% 증대</span>
          </button>

          <button
            onClick={() => handleSelectRegime('QUANTUM_AI_SINGULARITY')}
            className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
              activeRegime === 'QUANTUM_AI_SINGULARITY'
                ? 'bg-[#00C805]/20 border-[#00C805] text-white shadow-[0_0_15px_rgba(0,200,5,0.3)]'
                : 'bg-[#161B22] border-[#212631] text-[#C1C7D0] hover:border-[#00C805]/50'
            }`}
          >
            <span className="font-extrabold text-[11.5px] block text-[#00C805]">⚛️ 양자 AI 싱귤래리티</span>
            <span className="text-[9.5px] text-[#8E939D] block mt-0.5">AI 가중치: 0.92 (≥0.70)</span>
            <span className="text-[10px] text-amber-400 font-bold block mt-1">반도체/빅테크 +37% 증대</span>
          </button>

          <button
            onClick={() => handleSelectRegime('DEFENSE_SPACE_COLONIZATION')}
            className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
              activeRegime === 'DEFENSE_SPACE_COLONIZATION'
                ? 'bg-[#EC4899]/20 border-[#EC4899] text-white shadow-[0_0_15px_rgba(236,72,153,0.3)]'
                : 'bg-[#161B22] border-[#212631] text-[#C1C7D0] hover:border-[#EC4899]/50'
            }`}
          >
            <span className="font-extrabold text-[11.5px] block text-[#EC4899]">🚀 우주/방산 퀀텀점프</span>
            <span className="text-[9.5px] text-[#8E939D] block mt-0.5">AI 가중치: 0.82 (≥0.70)</span>
            <span className="text-[10px] text-amber-400 font-bold block mt-1">방산/우주항공 +33% 증대</span>
          </button>
        </div>
      </div>

      {/* 3. AI 뉴스 임의 텍스트 실시간 가중치 산출 입력창 */}
      <div className="bg-[#05070A] p-3 rounded-xl border border-[#212631] space-y-2">
        <span className="text-[10.5px] text-[#8E939D] font-bold block">📰 3. AI 뉴스 가중치 실시간 계산기:</span>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="예: FDA 암 완치 3상 승인 발표 / 탄소 국경세 300% 인상 / 양자 컴퓨터 개발"
            value={customNewsTitle}
            onChange={(e) => setCustomNewsTitle(e.target.value)}
            className="flex-1 bg-[#161B22] border border-[#212631] rounded-xl px-3 py-1.5 text-xs text-white outline-none focus:border-amber-400 font-sans"
          />
          <button
            onClick={handleAnalyzeCustomNews}
            className="bg-amber-400 hover:bg-amber-300 text-black font-black px-4 py-1.5 rounded-xl text-xs transition-all cursor-pointer"
          >
            AI 분석 & N% 적용
          </button>
        </div>

        {customNewsResult && (
          <div className="bg-[#161B22] p-2.5 rounded-xl border border-[#212631] text-[11px] text-amber-300 font-sans">
            {customNewsResult.impactSummary}
          </div>
        )}
      </div>

      {/* 현재 적용된 거시 국면 / AI 가중치 피드 카드 */}
      <div className="bg-[#05070A] p-4 rounded-2xl border border-[#212631] space-y-2.5">
        <div className="flex justify-between items-center border-b border-[#212631] pb-2">
          <span className="font-extrabold text-white text-[12.5px] flex items-center gap-1.5">
            <span>{currentProfile.icon}</span>
            <span>{currentProfile.title}</span>
          </span>
          <span className="text-amber-400 font-extrabold bg-amber-400/10 px-2.5 py-0.5 rounded-full border border-amber-400/30">
            AI 가중치 Score: {currentProfile.aiWeightScore.toFixed(2)} (문턱값 0.70 기준)
          </span>
        </div>

        <p className="text-[11.5px] text-[#C1C7D0] font-sans leading-relaxed">
          {currentProfile.description}
        </p>

        <div className="flex justify-between items-center text-[11px] bg-[#161B22] p-2.5 rounded-xl border border-[#212631]">
          <span className="text-[#8E939D]">50개 기관 장기 리밸런싱 지침:</span>
          <span className="text-[#00C805] font-black">{currentProfile.recommendedAction}</span>
        </div>
      </div>
    </div>
  );
};
