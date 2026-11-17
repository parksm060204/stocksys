"use client";

import React, { useState, useEffect } from 'react';

export type OrderType = 'LIMIT' | 'MARKET';

interface OptionOrderEntryProps {
  contractId?: string;
  ticker: string;
  currentPrice: number;
  multiplier?: number;
  userBalance?: number | null;
  onOrderSubmit?: (order: {
    contractId?: string;
    ticker: string;
    side: 'BUY' | 'SELL';
    type: OrderType;
    price: number;
    qty: number;
  }) => Promise<any>;
}

export const OptionOrderEntry: React.FC<OptionOrderEntryProps> = ({
  contractId,
  ticker,
  currentPrice,
  multiplier = 250000,
  userBalance = null,
  onOrderSubmit,
}) => {
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderType, setOrderType] = useState<OrderType>('LIMIT');
  const [price, setPrice] = useState<number>(currentPrice);
  const [qty, setQty] = useState<number>(1);
  const [fixedQty, setFixedQty] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    setPrice(currentPrice);
  }, [currentPrice, ticker]);

  const effectivePrice = orderType === 'MARKET' ? currentPrice : price;
  const totalAmount = Math.round(effectivePrice * qty * multiplier);

  const handleQuickQty = (amount: number) => {
    setQty(amount);
  };

  const handlePctQty = (pct: number) => {
    const unitCost = effectivePrice * multiplier;
    if (userBalance !== null && userBalance > 0 && unitCost > 0) {
      const maxPossible = Math.floor((userBalance * (pct / 100)) / unitCost);
      setQty(Math.max(1, maxPossible));
    }
  };

  const handlePriceTickOffset = (ticks: number) => {
    const tickSize = 0.05;
    setPrice((prev) => Math.max(0.01, Math.round((prev + ticks * tickSize) * 100) / 100));
  };

  const handleSubmit = async (actionSide: 'BUY' | 'SELL') => {
    if (submitting) return;
    if (!onOrderSubmit) {
      setFeedback({ type: 'error', message: '주문 제출 경로가 연결되지 않았습니다.' });
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    try {
      const res = await onOrderSubmit({
        contractId,
        ticker,
        side: actionSide,
        type: orderType,
        price: orderType === 'MARKET' ? 0 : price,
        qty,
      });
      const ordStatus = res?.order?.status;
      const defaultMsg =
        ordStatus === 'open'
          ? `[미체결 접수] ${ticker} ${actionSide === 'BUY' ? '매수' : '매도'} ${qty}계약 (체결 대기)`
          : `[체결 완료] ${ticker} ${actionSide === 'BUY' ? '매수' : '매도'} ${res?.order?.filledQty ?? qty}계약`;
      setFeedback({
        type: 'success',
        message: res?.message || defaultMsg,
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err?.message || '옵션 주문 처리에 실패했습니다.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full text-xs font-mono select-none bg-[#0E1117] p-4 rounded-2xl border border-border space-y-4 shadow-xl">
      {/* Header & Order Mode Switcher */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          <span className="font-extrabold text-white text-[13.5px]">HTS 파생 주문 실행</span>
          <span className="text-[10.5px] font-bold text-up bg-up/10 px-2 py-0.5 rounded border border-[#F04452]/30">
            {ticker}
          </span>
        </div>
        <div className="flex items-center gap-1 bg-[#161B22] p-1 rounded-xl border border-border">
          <button
            onClick={() => setSide('BUY')}
            className={`px-3 py-1 font-extrabold rounded-lg transition-all ${
              side === 'BUY' ? 'bg-up text-white' : 'text-[#8E939D] hover:text-white'
            }`}
          >
            매수
          </button>
          <button
            onClick={() => setSide('SELL')}
            className={`px-3 py-1 font-extrabold rounded-lg transition-all ${
              side === 'SELL' ? 'bg-down text-white' : 'text-[#8E939D] hover:text-white'
            }`}
          >
            매도
          </button>
        </div>
      </div>

      {/* 1. 지원 주문 유형 선택 탭 (지정가, 시장가) */}
      <div className="space-y-1.5">
        <span className="text-xs font-extrabold text-[#8E939D] block">주문 방식 (ORDER TYPE)</span>
        <div className="grid grid-cols-2 gap-1.5 text-xs font-extrabold">
          {[
            { id: 'LIMIT', label: '지정가 (LIMIT)' },
            { id: 'MARKET', label: '시장가 (MARKET)' },
          ].map((t) => (
            <button
              key={t.id}
              onClick={() => setOrderType(t.id as OrderType)}
              className={`py-1.5 rounded-lg border text-center transition-all ${
                orderType === t.id
                  ? 'bg-[#161B22] text-white border-white/20 shadow-sm'
                  : 'bg-[#05070A] text-[#8E939D] border-border hover:text-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* 2. 주문 수량 설정 (직접입력, 퀵 버튼, % 비율, 수량고정) */}
      <div className="space-y-2 bg-[#05070A] p-3 rounded-xl border border-border">
        <div className="flex items-center justify-between">
          <span className="text-xs font-extrabold text-[#8E939D]">주문 수량 (계약)</span>
          <label className="flex items-center gap-1.5 text-[10.5px] text-[#8E939D] cursor-pointer">
            <input
              type="checkbox"
              checked={fixedQty}
              onChange={(e) => setFixedQty(e.target.checked)}
              className="rounded border-border bg-[#161B22] text-up focus:ring-0"
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
            className="flex-1 rounded-xl border border-border bg-[#0E1117] px-3 py-2 text-right font-mono text-[13.5px] font-black text-white outline-none focus:border-[#F04452]"
          />
          <span className="text-[#8E939D] font-bold">계약</span>
        </div>

        {/* 수량 프리셋 버튼 */}
        <div className="flex gap-1">
          {[1, 5, 10, 50, 100].map((q) => (
            <button
              key={q}
              onClick={() => handleQuickQty(q)}
              className="flex-1 rounded-lg border border-border bg-[#161B22] py-1 text-[10.5px] font-bold text-[#8E939D] hover:bg-white/10 hover:text-white transition-all"
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
              className="flex-1 rounded-lg border border-[#F04452]/20 bg-up/5 py-1 text-[10.5px] font-bold text-up hover:bg-up/15 transition-all"
            >
              {pct}% 가능
            </button>
          ))}
        </div>
      </div>

      {/* 3. 주문 가격 설정 (직접입력, 현재가, 틱 조정) */}
      <div className="space-y-2 bg-[#05070A] p-3 rounded-xl border border-border">
        <div className="flex items-center justify-between">
          <span className="text-xs font-extrabold text-[#8E939D]">주문 가격 (원)</span>
          <button
            onClick={() => setPrice(currentPrice)}
            className="text-[10px] bg-[#161B22] text-white px-2 py-0.5 rounded border border-border font-bold hover:bg-[#212631]"
          >
            현재가 적용
          </button>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={orderType === 'MARKET' ? currentPrice : price}
            disabled={orderType === 'MARKET'}
            onChange={(e) => setPrice(Math.max(0.01, parseFloat(e.target.value) || 0))}
            className="flex-1 rounded-xl border border-border bg-[#0E1117] px-3 py-2 text-right font-mono text-[13.5px] font-black text-white outline-none focus:border-[#F04452]"
          />
          <span className="text-[#8E939D] font-bold">pt</span>
        </div>

        {/* 틱 조절 버튼 */}
        <div className="grid grid-cols-4 gap-1">
          <button
            onClick={() => handlePriceTickOffset(+2)}
            className="rounded-lg border border-border bg-[#161B22] py-1 text-[10.5px] font-bold text-up hover:bg-white/10"
          >
            +2틱
          </button>
          <button
            onClick={() => handlePriceTickOffset(+1)}
            className="rounded-lg border border-border bg-[#161B22] py-1 text-[10.5px] font-bold text-up hover:bg-white/10"
          >
            +1틱
          </button>
          <button
            onClick={() => handlePriceTickOffset(-1)}
            className="rounded-lg border border-border bg-[#161B22] py-1 text-[10.5px] font-bold text-down hover:bg-white/10"
          >
            -1틱
          </button>
          <button
            onClick={() => handlePriceTickOffset(-2)}
            className="rounded-lg border border-border bg-[#161B22] py-1 text-[10.5px] font-bold text-down hover:bg-white/10"
          >
            -2틱
          </button>
        </div>
      </div>

      {/* 4. 총 주문 금액 및 계좌 잔액 표시 */}
      <div className="space-y-1.5 bg-[#161B22] px-3.5 py-2.5 rounded-xl border border-border">
        <div className="flex justify-between items-center">
          <span className="text-[#8E939D] font-medium">총 주문 예상금액 (승수 {multiplier.toLocaleString()})</span>
          <span className="font-mono text-[14px] font-black text-white tabular-nums">
            ₩{totalAmount.toLocaleString()}
          </span>
        </div>
        <div className="flex justify-between items-center text-[11px]">
          <span className="text-[#8E939D]">주문 가능 예수금</span>
          <span className="font-mono font-bold text-[#F4F5F6] tabular-nums">
            {userBalance !== null ? `₩${Math.floor(userBalance).toLocaleString()}` : '로그인 필요'}
          </span>
        </div>
      </div>

      {feedback && (
        <div
          className={`px-3 py-2 rounded-xl border text-[11px] font-bold ${
            feedback.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
              : 'bg-up/10 border-[#F04452]/30 text-up'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* 5. 매수 / 매도 주문 실행 버튼 바 */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          disabled={submitting}
          onClick={() => handleSubmit('BUY')}
          className="py-3 bg-up hover:bg-[#ff5252] disabled:opacity-50 text-white font-black text-xs rounded-full shadow-[0_0_15px_rgba(240,68,82,0.35)] transition-all active:scale-[0.98]"
        >
          {submitting ? '처리 중...' : '신규 매수 제출 (BUY)'}
        </button>
        <button
          disabled={submitting}
          onClick={() => handleSubmit('SELL')}
          className="py-3 bg-down hover:bg-[#4092ff] disabled:opacity-50 text-white font-black text-xs rounded-full shadow-[0_0_15px_rgba(49,130,246,0.35)] transition-all active:scale-[0.98]"
        >
          {submitting ? '처리 중...' : '신규 매도 제출 (SELL)'}
        </button>
      </div>
    </div>
  );
};
