"use client";

import React, { useCallback, useEffect, useState } from 'react';

type AccountTab = 'ALL' | 'POSITIONS' | 'UNFILLED' | 'TRADES' | 'MARGIN' | 'PIVOT';

interface OptionPositionItem {
  contractId: string;
  ticker: string;
  type: 'CALL' | 'PUT';
  strikePrice: number;
  expiryDate: string;
  qty: number;
  avgPrice: number;
  currentPrice: number;
  multiplier: number;
  pnl: number;
  pnlPct: number;
}

interface OptionUnfilledItem {
  id: string;
  contractId: string;
  ticker: string;
  side: 'BUY' | 'SELL';
  price: number;
  qty: number;
  filled: number;
  remaining: number;
  status: string;
  createdAt: string;
}

interface OptionTradeItem {
  id: string;
  contractId: string;
  ticker: string;
  side: 'BUY' | 'SELL';
  price: number;
  qty: number;
  feeKrw: number;
  createdAt: string;
}

interface OptionAccountState {
  cash: number;
  reservedCash: number;
  availableCash: number;
  positions: OptionPositionItem[];
  unfilled: OptionUnfilledItem[];
  trades: OptionTradeItem[];
}

interface OptionAccountPanelProps {
  isLoggedIn?: boolean;
  refreshTrigger?: number;
  onAccountChanged?: () => void;
}

const EMPTY_ACCOUNT: OptionAccountState = {
  cash: 0,
  reservedCash: 0,
  availableCash: 0,
  positions: [],
  unfilled: [],
  trades: [],
};

export const OptionAccountPanel: React.FC<OptionAccountPanelProps> = ({
  isLoggedIn = false,
  refreshTrigger = 0,
  onAccountChanged,
}) => {
  const [tab, setTab] = useState<AccountTab>('ALL');
  const [account, setAccount] = useState<OptionAccountState>(EMPTY_ACCOUNT);
  const [loading, setLoading] = useState<boolean>(false);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const fetchAccount = useCallback(async () => {
    if (!isLoggedIn) {
      setAccount(EMPTY_ACCOUNT);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/options/account', { cache: 'no-store' });
      const data = await res.json();
      if (res.ok && data.success && data.account) {
        setAccount(data.account);
      } else if (res.status === 401) {
        setAccount(EMPTY_ACCOUNT);
      }
    } catch {
      // ignore transient poll error
    } finally {
      setLoading(false);
    }
  }, [isLoggedIn]);

  useEffect(() => {
    void fetchAccount();
  }, [fetchAccount, refreshTrigger]);

  const executeAccountAction = async (
    payload: { action: 'cancel_one'; orderId: string } | { action: 'cancel_all' } | { action: 'liquidate_all' }
  ) => {
    if (actionBusy) return;
    setActionBusy(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/options/account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.account) {
        setAccount(data.account);
      }
      if (!res.ok || !data.success) {
        setFeedback({ type: 'error', message: data.message || '요청 처리에 실패했습니다.' });
        return;
      }
      setFeedback({ type: 'success', message: data.message });
      onAccountChanged?.();
    } catch (err: any) {
      setFeedback({ type: 'error', message: err?.message || '서버 통신 오류가 발생했습니다.' });
    } finally {
      setActionBusy(false);
    }
  };

  const handleCancelOne = (orderId: string) => {
    void executeAccountAction({ action: 'cancel_one', orderId });
  };

  const handleCancelAll = () => {
    if (account.unfilled.length === 0) return;
    if (confirm('전체 미체결 옵션 주문을 일괄 취소하시겠습니까?')) {
      void executeAccountAction({ action: 'cancel_all' });
    }
  };

  const handleLiquidateAll = () => {
    if (account.positions.length === 0) return;
    if (confirm('보유 중인 전체 옵션 포지션을 시장가로 일괄 청산하시겠습니까?')) {
      void executeAccountAction({ action: 'liquidate_all' });
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#0E1117] border border-border rounded-2xl overflow-hidden font-mono select-none shadow-xl text-xs">
      {/* 탭 헤더 */}
      <div className="flex items-center bg-[#090B0F] border-b border-border px-2 py-1.5 overflow-x-auto no-scrollbar">
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

      {feedback && (
        <div
          className={`mx-3 mt-2 px-3 py-2 rounded-lg border text-[11px] font-bold ${
            feedback.type === 'success'
              ? 'bg-up/10 border-[#F04452]/40 text-up'
              : 'bg-red-950/60 border-red-500/50 text-red-300'
          }`}
        >
          {feedback.message}
        </div>
      )}

      {/* 탭 본문 내용 */}
      <div className="flex-1 p-3 overflow-y-auto bg-[#05070A] space-y-3">
        {!isLoggedIn ? (
          <div className="text-center py-8 text-[#8E939D] text-xs">
            로그인 후 본인 옵션 계좌 잔고와 미체결 내역을 확인할 수 있습니다.
          </div>
        ) : null}

        {/* 1. 보유 잔고 탭 / 일괄 청산 */}
        {isLoggedIn && (tab === 'ALL' || tab === 'POSITIONS') && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-[#8E939D]">
                보유 옵션 포지션 ({account.positions.length}건)
              </span>
              <button
                disabled={actionBusy || account.positions.length === 0}
                onClick={handleLiquidateAll}
                className="px-2.5 py-1 bg-up/20 hover:bg-up disabled:opacity-40 text-up hover:text-white font-extrabold text-[10.5px] rounded-lg border border-[#F04452]/40 transition-all"
              >
                전체 포지션 일괄 청산
              </button>
            </div>

            <div className="space-y-1.5">
              {account.positions.length > 0 ? (
                account.positions.map((pos) => (
                  <div
                    key={pos.contractId}
                    className="flex items-center justify-between bg-[#0E1117] p-2.5 rounded-xl border border-border"
                  >
                    <div>
                      <div className="font-extrabold text-white text-[12px]">{pos.ticker}</div>
                      <div className="text-[10.5px] text-[#8E939D] mt-0.5">
                        수량: {pos.qty}계약 | 평단: {pos.avgPrice.toFixed(2)} | 승수: ₩{pos.multiplier.toLocaleString()}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-black text-[13px] ${pos.pnl >= 0 ? 'text-up' : 'text-down'}`}>
                        {pos.pnl >= 0 ? '+' : '-'}₩{Math.abs(pos.pnl).toLocaleString()} ({pos.pnlPct}%)
                      </div>
                      <div className="text-[10.5px] text-[#8E939D]">현재가: {pos.currentPrice.toFixed(2)}</div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-4 text-[#8E939D] text-xs">
                  {loading ? '잔고 조회 중...' : '보유 중인 옵션 포지션이 없습니다.'}
                </div>
              )}
            </div>
          </div>
        )}

        {/* 2. 미체결 내역 탭 / 일괄 취소 */}
        {isLoggedIn && (tab === 'ALL' || tab === 'UNFILLED') && (
          <div className="space-y-2 pt-2 border-t border-border">
            <div className="flex items-center justify-between">
              <span className="text-xs font-extrabold text-[#8E939D]">
                미체결 주문 내역 ({account.unfilled.length}건)
              </span>
              <button
                disabled={actionBusy || account.unfilled.length === 0}
                onClick={handleCancelAll}
                className="px-2.5 py-1 bg-[#161B22] hover:bg-[#212631] disabled:opacity-40 text-[#8E939D] hover:text-white font-extrabold text-[10.5px] rounded-lg border border-border transition-all"
              >
                일괄 미체결 취소
              </button>
            </div>

            <div className="space-y-1.5">
              {account.unfilled.length > 0 ? (
                account.unfilled.map((u) => (
                  <div
                    key={u.id}
                    className="flex items-center justify-between bg-[#0E1117] p-2.5 rounded-xl border border-border"
                  >
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span
                          className={`px-1.5 py-0.2 rounded text-[9.5px] font-bold ${
                            u.side === 'BUY' ? 'bg-up/20 text-up' : 'bg-down/20 text-down'
                          }`}
                        >
                          {u.side === 'BUY' ? '매수' : '매도'}
                        </span>
                        <span className="font-extrabold text-white text-[11.5px]">{u.ticker}</span>
                      </div>
                      <div className="text-[10.5px] text-[#8E939D] mt-0.5">
                        가격: {u.price.toFixed(2)} | 잔여 {u.remaining}/{u.qty}계약
                      </div>
                    </div>
                    <button
                      disabled={actionBusy}
                      onClick={() => handleCancelOne(u.id)}
                      className="px-2 py-1 bg-[#161B22] hover:bg-up/20 disabled:opacity-40 text-[#8E939D] hover:text-up font-bold rounded border border-border"
                    >
                      취소
                    </button>
                  </div>
                ))
              ) : (
                <div className="text-center py-4 text-[#8E939D] text-xs">미체결 주문이 없습니다.</div>
              )}
            </div>
          </div>
        )}

        {/* 3. 주문 체결 내역 탭 */}
        {isLoggedIn && tab === 'TRADES' && (
          <div className="space-y-1.5">
            <span className="text-xs font-extrabold text-[#8E939D] block">
              최근 옵션 체결 내역 ({account.trades.length}건)
            </span>
            {account.trades.length > 0 ? (
              account.trades.map((tr) => (
                <div
                  key={tr.id}
                  className="flex items-center justify-between bg-[#0E1117] p-2.5 rounded-xl border border-border"
                >
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`px-1.5 py-0.2 rounded text-[9.5px] font-bold ${
                          tr.side === 'BUY' ? 'bg-up/20 text-up' : 'bg-down/20 text-down'
                        }`}
                      >
                        {tr.side === 'BUY' ? '매수' : '매도'}
                      </span>
                      <span className="font-extrabold text-white text-[11.5px]">{tr.ticker}</span>
                    </div>
                    <div className="text-[10.5px] text-[#8E939D] mt-0.5">
                      체결가: {tr.price.toFixed(2)} | {tr.qty}계약 | 수수료 ₩{tr.feeKrw.toLocaleString()}
                    </div>
                  </div>
                  <div className="text-[10px] text-[#8E939D]">
                    {new Date(tr.createdAt).toLocaleTimeString('ko-KR', { hour12: false })}
                  </div>
                </div>
              ))
            ) : (
              <div className="text-center py-4 text-[#8E939D] text-xs">체결 내역이 없습니다.</div>
            )}
          </div>
        )}

        {/* 4. 예탁금 & 증거금 탭 */}
        {isLoggedIn && tab === 'MARGIN' && (
          <div className="space-y-3 bg-[#0E1117] p-3 rounded-xl border border-border">
            <span className="text-xs font-extrabold text-[#8E939D] block">예탁금 및 주문 예약 현황</span>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="bg-[#05070A] p-2.5 rounded-lg border border-border">
                <span className="text-[#8E939D] text-[10px] block font-bold">보유 예수금</span>
                <span className="text-white font-black tabular-nums text-[13px]">
                  ₩{Math.floor(account.cash).toLocaleString()}
                </span>
              </div>
              <div className="bg-[#05070A] p-2.5 rounded-lg border border-border">
                <span className="text-[#8E939D] text-[10px] block font-bold">주문 가능 현금</span>
                <span className="text-up font-black tabular-nums text-[13px]">
                  ₩{Math.floor(account.availableCash).toLocaleString()}
                </span>
              </div>
              <div className="bg-[#05070A] p-2.5 rounded-lg border border-border col-span-2">
                <span className="text-[#8E939D] text-[10px] block font-bold">미체결 주문 예약금</span>
                <span className="text-amber-400 font-bold tabular-nums">
                  ₩{Math.floor(account.reservedCash).toLocaleString()}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* 5. 피봇 분석 탭 */}
        {tab === 'PIVOT' && (
          <div className="space-y-2 bg-[#0E1117] p-3 rounded-xl border border-border">
            <span className="text-xs font-extrabold text-[#8E939D] block">KOSPI 200 피봇 분석 수치 (PIVOT)</span>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-up">
                <span>2차 저항선 (R2)</span>
                <span className="font-bold">270.00</span>
              </div>
              <div className="flex justify-between text-up">
                <span>1차 저항선 (R1)</span>
                <span className="font-bold">265.00</span>
              </div>
              <div className="flex justify-between text-amber-400 font-bold border-y border-border py-1 my-1">
                <span>피봇 기준가 (PIVOT)</span>
                <span>260.00</span>
              </div>
              <div className="flex justify-between text-down">
                <span>1차 지지선 (S1)</span>
                <span className="font-bold">255.00</span>
              </div>
              <div className="flex justify-between text-down">
                <span>2차 지지선 (S2)</span>
                <span className="font-bold">250.00</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 하단 요약 */}
      <div className="bg-[#090B0F] border-t border-border px-3 py-2 flex items-center justify-between text-[11px] text-[#8E939D]">
        <span>실계좌 연동 (서버 권위)</span>
        <span className="text-white font-bold tabular-nums">
          가용 ₩{Math.floor(account.availableCash).toLocaleString()}
        </span>
      </div>
    </div>
  );
};
