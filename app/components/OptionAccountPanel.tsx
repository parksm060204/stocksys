"use client";

import React, { useState } from 'react';

type AccountTab = 'ALL' | 'POSITIONS' | 'UNFILLED' | 'TRADES' | 'MARGIN' | 'PIVOT';

export const OptionAccountPanel: React.FC = () => {
  const [tab, setTab] = useState<AccountTab>('ALL');

  // 샘플 미체결 데이터
  const [unfilled, setUnfilled] = useState([
    { id: 'ORD-101', ticker: 'IDX-K200-2607-C352.5', side: 'BUY', price: 3350, qty: 5, time: '14:20:05' },
    { id: 'ORD-102', ticker: 'IDX-K200-2607-P350.0', side: 'SELL', price: 3500, qty: 2, time: '14:21:42' },
  ]);

  // 샘플 잔고 데이터
  const [positions] = useState([
    { ticker: 'IDX-K200-2607-C352.5', qty: 10, avgPrice: 3300, currentPrice: 3350, pnl: 500000, pnlPct: 1.5 },
  ]);

  const handleCancelAll = () => {
    if (confirm('전체 미체결 주문을 일괄 취소하시겠습니까?')) {
      setUnfilled([]);
      alert('[일괄 취소] 전체 미체결 주문 취소 완료!');
    }
  };

  const handleLiquidateAll = () => {
    if (confirm('보유 중인 전체 옵션 포지션을 시장가로 일괄 청산하시겠습니까?')) {
      alert('[일괄 청산] 전체 포지션 시장가 청산 주문 발주 완료!');
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0E1117] border border-[#212631] rounded-2xl overflow-hidden font-mono select-none shadow-xl text-xs">
      {/* 탭 헤더 */}
      <div className="flex items-center bg-[#090B0F] border-b border-[#212631] px-2 py-1.5 overflow-x-auto no-scrollbar">
        {[
          { id: 'ALL', label: '잔고+미체결' },
          { id: 'POSITIONS', label: '보유 잔고' },
          { id: 'UNFILLED', label: '미체결 내역' },
          { id: 'TRADES', label: '주문 체결' },
          { id: 'MARGIN', label: '예탁금/증거금' },
          { id: 'PIVOT', label: '피봇 분석' },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id as AccountTab)}
            className={`px-3 py-1.5 font-extrabold rounded-lg whitespace-nowrap transition-all ${
              tab === t.id
                ? 'bg-[#161B22] text-white border border-white/10'
                : 'text-[#8E939D] hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 탭 본문 내용 */}
      <div className="flex-1 p-3 overflow-y-auto bg-[#05070A] space-y-3">
        {/* 1. 보유 잔고 탭 / 일괄 청산 */}
        {(tab === 'ALL' || tab === 'POSITIONS') && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold text-[#8E939D]">보유 옵션 포지션</span>
              <button
                onClick={handleLiquidateAll}
                className="px-2.5 py-1 bg-[#F04452]/20 hover:bg-[#F04452] text-[#F04452] hover:text-white font-extrabold text-[10.5px] rounded-lg border border-[#F04452]/40 transition-all"
              >
                🚨 전체 포지션 일괄 청산
              </button>
            </div>

            <div className="space-y-1.5">
              {positions.map((pos) => (
                <div
                  key={pos.ticker}
                  className="flex items-center justify-between bg-[#0E1117] p-2.5 rounded-xl border border-[#212631]"
                >
                  <div>
                    <div className="font-extrabold text-white text-[12px]">{pos.ticker}</div>
                    <div className="text-[10.5px] text-[#8E939D] mt-0.5">
                      수량: {pos.qty}계약 | 평단: ₩{pos.avgPrice.toLocaleString()}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-black text-[#F04452] text-[13px]">
                      +₩{pos.pnl.toLocaleString()} ({pos.pnlPct}%)
                    </div>
                    <div className="text-[10.5px] text-[#8E939D]">현재가: ₩{pos.currentPrice.toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 2. 미체결 내역 탭 / 일괄 취소 */}
        {(tab === 'ALL' || tab === 'UNFILLED') && (
          <div className="space-y-2 pt-2 border-t border-[#212631]">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-extrabold text-[#8E939D]">미체결 주문 내역 ({unfilled.length}건)</span>
              <button
                onClick={handleCancelAll}
                className="px-2.5 py-1 bg-[#161B22] hover:bg-[#212631] text-[#8E939D] hover:text-white font-extrabold text-[10.5px] rounded-lg border border-[#212631] transition-all"
              >
                일괄 미체결 취소
              </button>
            </div>

            <div className="space-y-1.5">
              {unfilled.length > 0 ? (
                unfilled.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between bg-[#0E1117] p-2.5 rounded-xl border border-[#212631]"
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className={`px-1.5 py-0.2 rounded text-[9.5px] font-bold ${
                          u.side === 'BUY' ? 'bg-[#F04452]/20 text-[#F04452]' : 'bg-[#3182F6]/20 text-[#3182F6]'
                        }`}>
                          {u.side === 'BUY' ? '매수' : '매도'}
                        </span>
                        <span className="font-extrabold text-white text-[11.5px]">{u.ticker}</span>
                      </div>
                      <div className="text-[10.5px] text-[#8E939D] mt-0.5">
                        가격: ₩{u.price.toLocaleString()} | {u.qty}계약 | {u.time}
                      </div>
                    </div>
                    <button
                      onClick={() => setUnfilled(unfilled.filter((item) => item.id !== u.id))}
                      className="px-2 py-1 bg-[#161B22] hover:bg-[#F04452]/20 text-[#8E939D] hover:text-[#F04452] font-bold rounded border border-[#212631]"
                    >
                      취소
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-center py-4 text-[#8E939D] text-[11px]">미체결 주문이 없습니다.</div>
              )}
            </div>
          </div>
        )}

        {/* 3. 예탁금 & 증거금 탭 */}
        {tab === 'MARGIN' && (
          <div className="space-y-3 bg-[#0E1117] p-3 rounded-xl border border-[#212631]">
            <span className="text-[11px] font-extrabold text-[#8E939D] block">예탁금 및 위탁증거금 현황</span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-[#05070A] p-2.5 rounded-lg border border-[#212631]">
                <span className="text-[#8E939D] text-[10px] block font-bold">예탁 총액</span>
                <span className="text-white font-black tabular-nums text-[13px]">₩10,000,000</span>
              </div>
              <div className="bg-[#05070A] p-2.5 rounded-lg border border-[#212631]">
                <span className="text-[#8E939D] text-[10px] block font-bold">주문 가능 현금</span>
                <span className="text-[#F04452] font-black tabular-nums text-[13px]">₩8,500,000</span>
              </div>
              <div className="bg-[#05070A] p-2.5 rounded-lg border border-[#212631]">
                <span className="text-[#8E939D] text-[10px] block font-bold">위탁 증거금율</span>
                <span className="text-white font-bold tabular-nums">15.0%</span>
              </div>
              <div className="bg-[#05070A] p-2.5 rounded-lg border border-[#212631]">
                <span className="text-[#8E939D] text-[10px] block font-bold">유지 증거금율</span>
                <span className="text-[#3182F6] font-bold tabular-nums">10.0%</span>
              </div>
            </div>
          </div>
        )}

        {/* 4. 피봇 분석 탭 */}
        {tab === 'PIVOT' && (
          <div className="space-y-2 bg-[#0E1117] p-3 rounded-xl border border-[#212631]">
            <span className="text-[11px] font-extrabold text-[#8E939D] block">KOSPI 200 피봇 분석 수치 (PIVOT)</span>
            <div className="space-y-1 text-[11px]">
              <div className="flex justify-between text-[#F04452]">
                <span>2차 저항선 (R2)</span>
                <span className="font-bold">355.00</span>
              </div>
              <div className="flex justify-between text-[#F04452]">
                <span>1차 저항선 (R1)</span>
                <span className="font-bold">345.00</span>
              </div>
              <div className="flex justify-between text-amber-400 font-bold border-y border-[#212631] py-1 my-1">
                <span>피봇 기준가 (PIVOT)</span>
                <span>335.00</span>
              </div>
              <div className="flex justify-between text-[#3182F6]">
                <span>1차 지지선 (S1)</span>
                <span className="font-bold">325.00</span>
              </div>
              <div className="flex justify-between text-[#3182F6]">
                <span>2차 지지선 (S2)</span>
                <span className="font-bold">315.00</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
