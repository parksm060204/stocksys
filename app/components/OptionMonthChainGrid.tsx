"use client";

import React, { useMemo, useState } from 'react';

export interface OptionContractItem {
  id: string;
  ticker: string;
  asset_class?: string;
  type: 'CALL' | 'PUT';
  option_type?: 'CALL' | 'PUT';
  strike_price: number;
  current_price: number;
  expiry_date: string;
  open_interest?: number;
  volume?: number;
  multiplier?: number;
}

export interface OptionChainRow {
  strike: number;
  isATM: boolean;
  callContract?: OptionContractItem;
  callTicker: string;
  callPrice: number;
  callChange: number;
  callVolume: number;
  callOI: number;
  putContract?: OptionContractItem;
  putTicker: string;
  putPrice: number;
  putChange: number;
  putVolume: number;
  putOI: number;
}

interface OptionMonthChainGridProps {
  contracts: OptionContractItem[];
  selectedContractId?: string;
  selectedTicker: string;
  onSelectContract: (contract: OptionContractItem) => void;
}

function extractExpiryMonthKey(expiryDate: string): string {
  const ms = Date.parse(expiryDate);
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}${mm}`;
}

export const OptionMonthChainGrid: React.FC<OptionMonthChainGridProps> = ({
  contracts,
  selectedContractId,
  selectedTicker,
  onSelectContract,
}) => {
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const futuresPrice = 260.45;
  const futuresChange = 0.20;
  const futuresChangePct = 0.08;
  const futuresVolume = 126293;

  const availableMonths = useMemo(() => {
    const monthSet = new Set<string>();
    for (const c of contracts) {
      const m = extractExpiryMonthKey(c.expiry_date);
      if (m) monthSet.add(m);
    }
    return Array.from(monthSet).sort();
  }, [contracts]);

  const activeMonth = availableMonths.includes(selectedMonth)
    ? selectedMonth
    : (availableMonths[0] ?? '');

  const rows: OptionChainRow[] = useMemo(() => {
    if (!activeMonth) return [];
    const byStrike = new Map<number, { call?: OptionContractItem; put?: OptionContractItem }>();
    for (const c of contracts) {
      if (extractExpiryMonthKey(c.expiry_date) !== activeMonth) continue;
      const strike = Number(c.strike_price);
      if (!Number.isFinite(strike)) continue;
      const pair = byStrike.get(strike) ?? {};
      const optType = (c.option_type || c.type) === 'PUT' ? 'PUT' : 'CALL';
      if (optType === 'CALL') pair.call = c;
      else pair.put = c;
      byStrike.set(strike, pair);
    }

    const strikes = Array.from(byStrike.keys()).sort((a, b) => b - a);
    let atmStrike = strikes[0] ?? 260;
    let bestDiff = Infinity;
    for (const s of strikes) {
      const diff = Math.abs(s - futuresPrice);
      if (diff < bestDiff) {
        bestDiff = diff;
        atmStrike = s;
      }
    }

    return strikes.map((strike) => {
      const pair = byStrike.get(strike)!;
      const call = pair.call;
      const put = pair.put;
      return {
        strike,
        isATM: strike === atmStrike,
        callContract: call,
        callTicker: call?.ticker ?? '-',
        callPrice: Number(call?.current_price ?? 0),
        callChange: 0,
        callVolume: Number(call?.volume ?? 0),
        callOI: Number(call?.open_interest ?? 0),
        putContract: put,
        putTicker: put?.ticker ?? '-',
        putPrice: Number(put?.current_price ?? 0),
        putChange: 0,
        putVolume: Number(put?.volume ?? 0),
        putOI: Number(put?.open_interest ?? 0),
      };
    });
  }, [contracts, activeMonth, futuresPrice]);

  return (
    <div className="flex flex-col h-full bg-[#0E1117] border border-border rounded-2xl overflow-hidden font-mono select-none shadow-2xl">
      {/* 1. 상단 HTS [0513] 헤더 툴바 */}
      <div className="bg-[#090B0F] px-4 py-2.5 border-b border-border flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-3">
          <span className="font-extrabold text-white text-[13px] tracking-wide flex items-center gap-1.5">
            <span className="text-up font-black">[0513]</span>
            <span>선물옵션 월물별 행사가 매트릭스</span>
          </span>

          {/* 월물 선택 드롭다운 (실제 DB 계약 월물 기반) */}
          <div className="flex items-center gap-1 bg-[#161B22] border border-border px-2.5 py-1 rounded-lg">
            <select
              value={activeMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              disabled={availableMonths.length === 0}
              className="bg-transparent text-white font-extrabold font-mono outline-none cursor-pointer text-xs"
            >
              {availableMonths.length === 0 ? (
                <option value="">유효 월물 없음</option>
              ) : (
                availableMonths.map((m) => (
                  <option key={m} value={m} className="bg-[#0E1117] text-white">
                    {m}월물
                  </option>
                ))
              )}
            </select>
          </div>
        </div>

        {/* 기초 선물 시세 현황 */}
        <div className="flex items-center gap-3 text-[12px] bg-[#161B22] px-3.5 py-1 rounded-xl border border-border font-mono tabular-nums">
          <span className="text-[#8E939D] font-bold">기초 선물:</span>
          <span className="text-up font-black text-[13px]">{futuresPrice.toFixed(2)}</span>
          <span className="text-up font-bold">▲ {futuresChange.toFixed(2)}</span>
          <span className="text-up font-bold">+{futuresChangePct}%</span>
          <span className="text-[#8E939D] text-xs">거래량 {futuresVolume.toLocaleString()}</span>
        </div>
      </div>

      {/* 2. HTS 상단 카테고리 헤더 (콜옵션 / 선물 / 풋옵션) */}
      <div className="grid grid-cols-7 bg-[#090B0F] border-b border-border text-center font-bold text-xs">
        <div className="col-span-3 py-1.5 bg-up/10 text-up border-r border-border">
          콜옵션 (CALL OPTION)
        </div>
        <div className="col-span-1 py-1.5 bg-[#161B22] text-amber-400 border-r border-border">
          선물 / 행사가
        </div>
        <div className="col-span-3 py-1.5 bg-down/10 text-down">
          풋옵션 (PUT OPTION)
        </div>
      </div>

      {/* 3. 세부 7개 서브 컬럼 헤더 */}
      <div className="grid grid-cols-7 bg-[#161B22] border-b border-border text-xs font-extrabold text-[#8E939D] text-center py-1.5">
        <div className="px-2 text-right">거래량</div>
        <div className="px-2 text-right">미결제</div>
        <div className="px-2 text-right border-r border-border">현재가</div>
        <div className="px-2 text-center text-white border-r border-border">행사가</div>
        <div className="px-2 text-left border-r border-border">현재가</div>
        <div className="px-2 text-left">미결제</div>
        <div className="px-2 text-left">거래량</div>
      </div>

      {/* 4. 선물옵션월물별 메인 3단 대칭 행가 그리드 */}
      <div className="flex-1 overflow-y-auto no-scrollbar divide-y divide-[#212631]/40 bg-[#05070A] text-[12px]">
        {rows.length === 0 ? (
          <div className="py-12 text-center text-[#8E939D] text-xs">
            현재 거래 가능한 옵션 계약이 없습니다.
          </div>
        ) : (
          rows.map((row) => {
            const isATM = row.isATM;
            const isCallSelected =
              Boolean(row.callContract) &&
              (selectedContractId === row.callContract?.id || selectedTicker === row.callTicker);
            const isPutSelected =
              Boolean(row.putContract) &&
              (selectedContractId === row.putContract?.id || selectedTicker === row.putTicker);

            const isCallITM = row.strike < futuresPrice && !isATM;
            const isPutITM = row.strike > futuresPrice && !isATM;

            return (
              <div
                key={`row-${activeMonth}-${row.strike}`}
                className={`grid grid-cols-7 items-center h-[30px] font-mono tabular-nums transition-colors ${
                  isATM
                    ? 'bg-[#3A3215] border-y-2 border-amber-500/60 font-bold'
                    : 'hover:bg-[#161B22]'
                }`}
              >
                {/* === [콜옵션 영역] 거래량 | 미결제 | 현재가 === */}
                <div
                  onClick={() => row.callContract && onSelectContract(row.callContract)}
                  className={`col-span-3 grid grid-cols-3 h-full items-center border-r border-border px-1 transition-all ${
                    row.callContract ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'
                  } ${
                    isCallSelected ? 'bg-up/25 ring-1 ring-[#F04452]' : isCallITM ? 'bg-up/5' : ''
                  }`}
                >
                  <div className="text-right text-[#8E939D] text-xs pr-2 truncate">
                    {row.callVolume.toLocaleString()}
                  </div>
                  <div className="text-right text-[11px] text-[#8E939D] pr-2 truncate">
                    {row.callOI.toLocaleString()}
                  </div>
                  <div className="text-right text-[12.5px] font-black pr-2 text-white">
                    {row.callContract ? row.callPrice.toFixed(2) : '-'}
                  </div>
                </div>

                {/* === [중앙 앵커] 행사가 (Strike Price) === */}
                <div
                  className={`col-span-1 h-full flex items-center justify-center text-center font-black text-[12.5px] border-r border-border ${
                    isATM ? 'text-amber-400 bg-amber-500/20' : 'text-white bg-[#0E1117]'
                  }`}
                >
                  {row.strike.toFixed(2)}
                </div>

                {/* === [풋옵션 영역] 현재가 | 미결제 | 거래량 === */}
                <div
                  onClick={() => row.putContract && onSelectContract(row.putContract)}
                  className={`col-span-3 grid grid-cols-3 h-full items-center px-1 transition-all ${
                    row.putContract ? 'cursor-pointer' : 'opacity-40 cursor-not-allowed'
                  } ${
                    isPutSelected ? 'bg-down/25 ring-1 ring-[#3182F6]' : isPutITM ? 'bg-down/5' : ''
                  }`}
                >
                  <div className="text-left text-[12.5px] font-black pl-2 text-white">
                    {row.putContract ? row.putPrice.toFixed(2) : '-'}
                  </div>
                  <div className="text-left text-[11px] text-[#8E939D] pl-2 truncate">
                    {row.putOI.toLocaleString()}
                  </div>
                  <div className="text-left text-[#8E939D] text-xs pl-2 truncate">
                    {row.putVolume.toLocaleString()}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 푸터 범례 */}
      <div className="bg-[#090B0F] border-t border-border px-4 py-2 flex items-center justify-between text-xs text-[#8E939D]">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-[#3A3215] border border-amber-500 inline-block" />
            <span className="text-amber-400 font-bold">ATM (등가격)</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-up/20 border border-[#F04452]/40 inline-block" />
            <span>콜 내가격(ITM)</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-3 rounded bg-down/20 border border-[#3182F6]/40 inline-block" />
            <span>풋 내가격(ITM)</span>
          </span>
        </div>
        <span>원클릭 셀 선택 시 실제 계약 ID 및 가격이 연동됩니다.</span>
      </div>
    </div>
  );
};
