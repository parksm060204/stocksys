"use client";

import React, { useState } from 'react';

export type OrderType = 'LIMIT' | 'MARKET' | 'CONDITIONAL' | 'BEST_LIMIT' | 'IOC' | 'FOK';

interface OptionOrderEntryProps {
  ticker: string;
  currentPrice: number;
  userBalance?: number | null;
  onOrderSubmit?: (order: { side: 'BUY' | 'SELL'; type: OrderType; price: number; qty: number }) => void;
}

export const OptionOrderEntry: React.FC<OptionOrderEntryProps> = ({
  ticker,
  currentPrice = 3360,
  userBalance = 10000000,
  onOrderSubmit,
}) => {
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<OrderType>('LIMIT');
  const [price, setPrice] = useState<number>(currentPrice);
  const [qty, setQty] = useState<number>(1);
  const [fixedQty, setFixedQty] = useState<boolean>(false);

  const totalAmount = price * qty;

  const handleQuickQty = (amount: number) => {
    setQty(amount);
  };

  const handlePctQty = (pct: number) => {
    if (userBalance && price > 0) {
      const maxPossible = Math.floor((userBalance * (pct / 100)) / price);
      setQty(Math.max(1, maxPossible));
    }
  };

  const handlePriceTickOffset = (ticks: number) => {
    const tickSize = 10;
    setPrice((prev) => Math.max(10, prev + ticks * tickSize));
  };

  const handleSubmit = (actionSide: 'BUY' | 'SELL') => {
    onOrderSubmit?.({
      side: actionSide,
      type: orderType,
      price: orderType === 'MARKET' ? 0 : price,
      qty,
    });
    alert(`[HTS 주문 접수] ${ticker} | ${actionSide === 'BUY' ? '매수' : '매도'} | ${orderType} | ${qty}계약 (₩${price.toLocaleString()})`);
  };

  return (
    <div className="flex flex-col h-full text-xs font-mono select-none bg-[#0E1117] p-4 rounded-2xl border border-[#212631] space-y-4 shadow-xl">
      {/* Header & Order Mode Switcher */}
      <div className="flex items-center justify-between border-b border-[#212631] pb-3">
        <div className="flex items-center gap-2">
          <span className="font-extrabold text-white text-[13.5px]">HTS 파생 주문 실행</span>
          <span className="text-[10.5px] font-bold text-[#F04452] bg-[#F04452]/10 px-2 py-0.5 rounded border border-[#F04452]/30">
            {ticker}
          </span>
        </div>
        <div className="flex items-center gap-1 bg-[#161B22] p-1 rounded-xl border border-[#212631]">
          <button
            onClick={() => setSide('BUY')}
            className={`px-3 py-1 font-extrabold rounded-lg transition-all ${
              side === 'BUY' ? 'bg-[#F04452] text-white' : 'text-[#8E939D] hover:text-white'
            }`}
          >
            매수
          </button>
          <button
            onClick={() => setSide('SELL')}
            className={`px-3 py-1 font-extrabold rounded-lg transition-all ${
              side === 'SELL' ? 'bg-[#3182F6] text-white' : 'text-[#8E939D] hover:text-white'
            }`}
          >
            매도
          </button>
        </div>
      </div>

      {/* 1. 6개 주문 유형 선택 탭 (지정가, 시장가, 조건부지정가, 최유리지정가, IOC, FOK) */}
      <div className="space-y-1.5">
        <span className="text-[11px] font-extrabold text-[#8E939D] block">주문 방식 (ORDER TYPE)</span>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-[11px] font-extrabold">
          {[
            { id: 'LIMIT', label: '지정가' },
            { id: 'MARKET', label: '시장가' },
            { id: 'CONDITIONAL', label: '조건부' },
            { id: 'BEST_LIMIT', label: '최유리' },
            { id: 'IOC', label: 'IOC' },
            { id: 'FOK', label: 'FOK' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setOrderType(t.id as OrderType)}
              className={`py-1.5 rounded-lg border text-center transition-all ${
                orderType === t.id
                  ? 'bg-[#161B22] text-white border-white/20 shadow-sm'
                  : 'bg-[#05070A] text-[#8E939D] border-[#212631] hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 2. 주문 수량 설정 (직접입력, 퀵 버튼, % 비율, 수량고정) */}
      <div className="space-y-2 bg-[#05070A] p-3 rounded-xl border border-[#212631]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-extrabold text-[#8E939D]">주문 수량 (계약)</span>
          <label className="flex items-center gap-1.5 text-[10.5px] text-[#8E939D] cursor-pointer">
            <input
              type="checkbox"
              checked={fixedQty}
              onChange={(e) => setFixedQty(e.target.checked)}
              className="rounded border-[#212631] bg-[#161B22] text-[#F04452] focus:ring-0"
            />
            <span>수량고정</span>
          </label>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            value={qty}
            disabled={fixedQty}
            onChange={(e) => setQty(Math.max(1, parseInt(e.target.value) || 1))}
            className="flex-1 rounded-xl border border-[#212631] bg-[#0E1117] px-3 py-2 text-right font-mono text-[13.5px] font-black text-white outline-none focus:border-[#F04452]"
          />
          <span className="text-[#8E939D] font-bold">계약</span>
        </div>

        {/* 수량 프리셋 버튼 */}
        <div className="flex gap-1">
          {[1, 5, 10, 50, 100].map((q) => (
            <button
              key={q}
              onClick={() => handleQuickQty(q)}
              className="flex-1 rounded-lg border border-[#212631] bg-[#161B22] py-1 text-[10.5px] font-bold text-[#8E939D] hover:bg-white/10 hover:text-white transition-all"
            >
              {q}계약
            </button>
          ))}
        </div>

        {/* 청산/가능 수량 % 버튼 */}
        <div className="flex gap-1 pt-1">
          {[10, 25, 50, 100].map((pct) => (
            <button
              key={pct}
              onClick={() => handlePctQty(pct)}
              className="flex-1 rounded-lg border border-[#F04452]/20 bg-[#F04452]/5 py-1 text-[10.5px] font-bold text-[#F04452] hover:bg-[#F04452]/15 transition-all"
            >
              {pct}% 가능
            </button>
          ))}
        </div>
      </div>

      {/* 3. 주문 가격 설정 (직접입력, 현재가, 틱 조정) */}
      <div className="space-y-2 bg-[#05070A] p-3 rounded-xl border border-[#212631]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-extrabold text-[#8E939D]">주문 가격 (원)</span>
          <button
            onClick={() => setPrice(currentPrice)}
            className="text-[10px] bg-[#161B22] text-white px-2 py-0.5 rounded border border-[#212631] font-bold hover:bg-[#212631]"
          >
            현재가 적용
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="number"
            value={orderType === 'MARKET' ? 0 : price}
            disabled={orderType === 'MARKET'}
            onChange={(e) => setPrice(parseInt(e.target.value) || 0)}
            className="flex-1 rounded-xl border border-[#212631] bg-[#0E1117] px-3 py-2 text-right font-mono text-[13.5px] font-black text-white outline-none focus:border-[#F04452]"
          />
          <span className="text-[#8E939D] font-bold">원</span>
        </div>

        {/* 틱 조절 버튼 */}
        <div className="grid grid-cols-4 gap-1">
          <button
            onClick={() => handlePriceTickOffset(+2)}
            className="rounded-lg border border-[#212631] bg-[#161B22] py-1 text-[10.5px] font-bold text-[#F04452] hover:bg-white/10"
          >
            +2틱
          </button>
          <button
            onClick={() => handlePriceTickOffset(+1)}
            className="rounded-lg border border-[#212631] bg-[#161B22] py-1 text-[10.5px] font-bold text-[#F04452] hover:bg-white/10"
          >
            +1틱
          </button>
          <button
            onClick={() => handlePriceTickOffset(-1)}
            className="rounded-lg border border-[#212631] bg-[#161B22] py-1 text-[10.5px] font-bold text-[#3182F6] hover:bg-white/10"
          >
            -1틱
          </button>
          <button
            onClick={() => handlePriceTickOffset(-2)}
            className="rounded-lg border border-[#212631] bg-[#161B22] py-1 text-[10.5px] font-bold text-[#3182F6] hover:bg-white/10"
          >
            -2틱
          </button>
        </div>
      </div>

      {/* 4. 총 주문 금액 표시 */}
      <div className="flex justify-between items-center bg-[#161B22] px-3.5 py-2.5 rounded-xl border border-[#212631]">
        <span className="text-[#8E939D] font-medium">총 주문 예상금액</span>
        <span className="font-mono text-[14px] font-black text-white tabular-nums">
          ₩{totalAmount.toLocaleString()}
        </span>
      </div>

      {/* 5. 매수 / 매도 / 정정 / 취소 주문 실행 버튼 바 */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          onClick={() => handleSubmit('BUY')}
          className="py-3 bg-[#F04452] hover:bg-[#ff5252] text-white font-black text-xs rounded-full shadow-[0_0_15px_rgba(240,68,82,0.35)] transition-all active:scale-[0.98]"
        >
          신규 매수 제출 (BUY)
        </button>
        <button
          onClick={() => handleSubmit('SELL')}
          className="py-3 bg-[#3182F6] hover:bg-[#4092ff] text-white font-black text-xs rounded-full shadow-[0_0_15px_rgba(49,130,246,0.35)] transition-all active:scale-[0.98]"
        >
          신규 매도 제출 (SELL)
        </button>
      </div>
    </div>
  );
};
