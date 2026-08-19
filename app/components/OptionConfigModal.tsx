"use client";

import React from 'react';

export interface OptionConfigState {
  orderbookLevels: 5 | 10;
  layoutType: 'SYMMETRIC' | 'LEFT_ALIGNED';
  showChangeRate: boolean;
  showVolumeBar: boolean;
  boldMaxVolume: boolean;
  showPriceOutline: boolean;
  showEqualizer: boolean;
  useSideColors: boolean;
  showOrderConfirmModal: boolean;
  showCancelZone: boolean;
  // Field toggles
  showOI: boolean;
  showDelta: boolean;
  showGamma: boolean;
  showVega: boolean;
}

export const defaultConfigState: OptionConfigState = {
  orderbookLevels: 10,
  layoutType: 'SYMMETRIC',
  showChangeRate: true,
  showVolumeBar: true,
  boldMaxVolume: true,
  showPriceOutline: true,
  showEqualizer: true,
  useSideColors: true,
  showOrderConfirmModal: true,
  showCancelZone: true,
  showOI: true,
  showDelta: true,
  showGamma: false,
  showVega: false,
};

interface OptionConfigModalProps {
  isOpen: boolean;
  config: OptionConfigState;
  onChangeConfig: (newConfig: OptionConfigState) => void;
  onClose: () => void;
}

export const OptionConfigModal: React.FC<OptionConfigModalProps> = ({
  isOpen,
  config,
  onChangeConfig,
  onClose,
}) => {
  if (!isOpen) return null;

  const toggle = (key: keyof OptionConfigState) => {
    onChangeConfig({
      ...config,
      [key]: !config[key],
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 font-sans select-none">
      <div className="w-full max-w-md rounded-3xl border border-[#212631] bg-[#0E1117] p-6 shadow-2xl space-y-5">
        <div className="flex items-center justify-between border-b border-[#212631] pb-3">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚙️</span>
            <h2 className="text-base font-black text-white">HTS 선물옵션 호가 및 주문 환경설정</h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#8E939D] hover:text-white font-bold text-sm"
          >
            ✕
          </button>
        </div>

        {/* 1. 호가 단수 및 배열 설정 */}
        <div className="space-y-2">
          <span className="text-xs font-extrabold text-[#8E939D] block">1. 호가창 배열 및 단계</span>
          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <button
              onClick={() => onChangeConfig({ ...config, orderbookLevels: 10 })}
              className={`py-2 rounded-xl border font-bold transition-all ${
                config.orderbookLevels === 10
                  ? 'bg-[#F04452] text-white border-[#F04452]'
                  : 'bg-[#161B22] text-[#8E939D] border-[#212631] hover:text-white'
              }`}
            >
              10단계 호가
            </button>
            <button
              onClick={() => onChangeConfig({ ...config, orderbookLevels: 5 })}
              className={`py-2 rounded-xl border font-bold transition-all ${
                config.orderbookLevels === 5
                  ? 'bg-[#F04452] text-white border-[#F04452]'
                  : 'bg-[#161B22] text-[#8E939D] border-[#212631] hover:text-white'
              }`}
            >
              5단계 호가
            </button>
          </div>
        </div>

        {/* 2. 호가 표시 시각화 옵션 */}
        <div className="space-y-2">
          <span className="text-xs font-extrabold text-[#8E939D] block">2. 시세 및 호가 표시 옵션</span>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {[
              { key: 'showChangeRate', label: '호가 등락률 보기' },
              { key: 'showVolumeBar', label: '잔량 막대그래프 보기' },
              { key: 'boldMaxVolume', label: '최고 잔량 굵은 글씨' },
              { key: 'showPriceOutline', label: '현재가 외곽선 하이라이트' },
              { key: 'showEqualizer', label: '실시간 체결량 이퀄라이저' },
              { key: 'useSideColors', label: '매수/매도 영역 색상 구분' },
              { key: 'showCancelZone', label: '취소/정정 드래그 영역' },
              { key: 'showOrderConfirmModal', label: '주문 확인창 보기' },
            ].map(({ key, label }) => (
              <label
                key={key}
                className="flex items-center justify-between bg-[#161B22] px-3 py-2 rounded-xl border border-[#212631] cursor-pointer hover:bg-[#212631]/60 transition-colors"
              >
                <span className="text-white text-[11.5px] font-medium">{label}</span>
                <input
                  type="checkbox"
                  checked={Boolean(config[key as keyof OptionConfigState])}
                  onChange={() => toggle(key as keyof OptionConfigState)}
                  className="rounded border-[#212631] bg-[#05070A] text-[#F04452] focus:ring-0 cursor-pointer"
                />
              </label>
            ))}
          </div>
        </div>

        {/* 3. 옵션 파생 분석 필드 선택 */}
        <div className="space-y-2">
          <span className="text-xs font-extrabold text-[#8E939D] block">3. 옵션 민감도 지표 (Greeks & OI)</span>
          <div className="grid grid-cols-3 gap-2 text-xs font-mono">
            {[
              { key: 'showOI', label: '미결제약정(OI)' },
              { key: 'showDelta', label: '델타 (Delta)' },
              { key: 'showGamma', label: '감마 (Gamma)' },
            ].map(({ key, label }) => (
              <label
                key={key}
                className="flex items-center justify-between bg-[#161B22] px-2.5 py-2 rounded-xl border border-[#212631] cursor-pointer hover:bg-[#212631]/60 transition-colors"
              >
                <span className="text-white text-[11px] font-medium">{label}</span>
                <input
                  type="checkbox"
                  checked={Boolean(config[key as keyof OptionConfigState])}
                  onChange={() => toggle(key as keyof OptionConfigState)}
                  className="rounded border-[#212631] bg-[#05070A] text-[#F04452] focus:ring-0 cursor-pointer"
                />
              </label>
            ))}
          </div>
        </div>

        <button
          onClick={onClose}
          className="w-full py-3 bg-[#F04452] hover:bg-[#ff5252] text-white font-extrabold rounded-2xl text-xs transition-all shadow-[0_0_15px_rgba(240,68,82,0.35)] cursor-pointer"
        >
          설정 저장 및 적용
        </button>
      </div>
    </div>
  );
};
