'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { OptionMonthChainGrid, OptionContractItem } from './OptionMonthChainGrid';
import { OptionOrderEntry, OrderType } from './OptionOrderEntry';
import { OptionAccountPanel } from './OptionAccountPanel';
import { TradeFeed } from './TradeFeed';
import { useOptionMarketData } from '@/lib/hooks/useOptionMarketData';
import { useAuth } from '@/lib/auth/useAuth';
import { createClient } from '@/lib/db/client';

export default function OptionHTSDashboard() {
  const [contracts, setContracts] = useState<OptionContractItem[]>([]);
  const [selectedTicker, setSelectedTicker] = useState<string>('');
  const [selectedContractId, setSelectedContractId] = useState<string | undefined>(undefined);
  const [selectedPrice, setSelectedPrice] = useState<number>(2.15);
  const [selectedType, setSelectedType] = useState<'CALL' | 'PUT'>('CALL');
  const [selectedMultiplier, setSelectedMultiplier] = useState<number>(250000);
  const [userBalance, setUserBalance] = useState<number | null>(null);
  const [accountRefreshKey, setAccountRefreshKey] = useState<number>(0);
  const [futuresStats, setFuturesStats] = useState<{ price: number; change: number; changePct: number; volume: number }>({
    price: 260.0,
    change: 0,
    changePct: 0,
    volume: 0,
  });

  const { userId, isLoggedIn } = useAuth();
  const db = useMemo(() => createClient(), []);
  const { trades, rolloverEvents } = useOptionMarketData(selectedTicker);

  const fetchAccountAndContracts = useCallback(async () => {
    const [{ data: contractList }, { data: stockList }, accountRes] = await Promise.all([
      db.from('options_contracts').select('*'),
      db.from('stocks').select('market, current_price, previous_close, shares_outstanding, volume').eq('market', 'domestic'),
      isLoggedIn && userId ? fetch('/api/options/account', { cache: 'no-store' }).then((r) => r.json()).catch(() => null) : Promise.resolve(null),
    ]);

    if (Array.isArray(stockList) && stockList.length > 0) {
      let prevCap = 0;
      let currCap = 0;
      let totalVol = 0;
      for (const s of stockList as any[]) {
        const shares = Number(s.shares_outstanding || 1_000_000);
        const cur = Number(s.current_price || 0);
        const prev = Number(s.previous_close || cur);
        totalVol += Number(s.volume || 0);
        if (cur > 0 && prev > 0 && shares > 0) {
          prevCap += prev * shares;
          currCap += cur * shares;
        }
      }
      if (prevCap > 0) {
        const ratio = Math.max(0.5, Math.min(1.5, currCap / prevCap));
        const liveIdx = Math.round(260.0 * ratio * 100) / 100;
        const diff = Math.round((liveIdx - 260.0) * 100) / 100;
        const pct = Math.round(((liveIdx - 260.0) / 260.0) * 10000) / 100;
        setFuturesStats({ price: liveIdx, change: diff, changePct: pct, volume: totalVol });
      }
    }

    if (Array.isArray(contractList)) {
      const nowMs = Date.now();
      const validUnexpired = (contractList as OptionContractItem[]).filter((c) => {
        const expMs = Date.parse(c.expiry_date);
        return Number.isFinite(expMs) && expMs > nowMs;
      });
      const idxContracts = validUnexpired.filter((c) => c.asset_class === 'IDX');
      const gridContracts = idxContracts.length > 0 ? idxContracts : validUnexpired;
      setContracts(gridContracts);

      if (gridContracts.length > 0) {
        setSelectedContractId((prevId) => {
          const existing = prevId ? gridContracts.find((c) => c.id === prevId) : undefined;
          if (existing) {
            setSelectedTicker(existing.ticker);
            setSelectedPrice(Number(existing.current_price || 0));
            setSelectedType((existing.option_type || existing.type) === 'PUT' ? 'PUT' : 'CALL');
            setSelectedMultiplier(Number(existing.multiplier || 250000));
            return existing.id;
          }
          const sortedByExpiry = [...gridContracts].sort(
            (a, b) => Date.parse(a.expiry_date) - Date.parse(b.expiry_date)
          );
          const frontExpiry = sortedByExpiry[0].expiry_date;
          const frontCall =
            sortedByExpiry.find(
              (c) =>
                c.expiry_date === frontExpiry &&
                (c.option_type || c.type) === 'CALL' &&
                Math.abs(Number(c.strike_price) - 260) < 0.01
            ) || sortedByExpiry[0];
          setSelectedTicker(frontCall.ticker);
          setSelectedPrice(Number(frontCall.current_price || 0));
          setSelectedType((frontCall.option_type || frontCall.type) === 'PUT' ? 'PUT' : 'CALL');
          setSelectedMultiplier(Number(frontCall.multiplier || 250000));
          return frontCall.id;
        });
      }
    }

    if (accountRes?.success && accountRes.account) {
      setUserBalance(Number(accountRes.account.availableCash ?? accountRes.account.cash ?? 0));
    } else if (!isLoggedIn || !userId) {
      setUserBalance(null);
    }
  }, [db, isLoggedIn, userId]);

  useEffect(() => {
    void fetchAccountAndContracts();
  }, [fetchAccountAndContracts]);

  const handleSelectContract = useCallback((contract: OptionContractItem) => {
    const optType = (contract.option_type || contract.type) === 'PUT' ? 'PUT' : 'CALL';
    setSelectedContractId(contract.id);
    setSelectedTicker(contract.ticker);
    setSelectedPrice(Number(contract.current_price || 0));
    setSelectedType(optType);
    setSelectedMultiplier(Number(contract.multiplier || 250000));
  }, []);

  const handleOrderSubmit = async (order: {
    contractId?: string;
    ticker: string;
    side: 'BUY' | 'SELL';
    type: OrderType;
    price: number;
    qty: number;
  }) => {
    const res = await fetch('/api/options/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contractId: order.contractId,
        ticker: order.ticker,
        side: order.side,
        orderType: order.type,
        price: order.price,
        qty: order.qty,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.message || '옵션 주문 제출에 실패했습니다.');
    }
    setAccountRefreshKey((k) => k + 1);
    await fetchAccountAndContracts();
    return data;
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-6 space-y-6 select-none">
      {/* Breadcrumb Navigation */}
      <nav className="flex items-center gap-2 text-[12px] text-[#8E939D]">
        <Link href="/" className="hover:text-white font-medium">
          메인홈
        </Link>
        <span>/</span>
        <span className="text-white font-bold">옵션 & 파생상품 터미널 ([0513] 선물옵션월물별)</span>
      </nav>

      {/* Header Banner */}
      <div className="bg-[#0E1117] border border-border p-6 rounded-3xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-2xl">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#F04452]/40 bg-up/10 px-3.5 py-1 text-xs font-bold text-up mb-2 font-mono">
            <span className="inline-block h-2 w-2 rounded-full bg-up animate-pulse" />
            LIVE OPTIONS TERMINAL · [0513] 선물옵션월물별
          </div>
          <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">
            HTS 선물옵션 월물별 행사가 매트릭스
          </h1>
          <p className="text-[12.5px] text-[#8E939D] mt-1 font-medium">
            3단 대칭 행사가 그리드 (콜옵션 - 행사가 - 풋옵션), ATM 등가격 골드 하이라이팅 & 원클릭 HTS 주문 연동
          </p>
        </div>

        <div className="flex gap-6 text-right bg-[#161B22] px-5 py-3 rounded-2xl border border-border shrink-0 font-mono">
          <div>
            <div className="text-[10px] uppercase font-bold tracking-wider text-[#8E939D]">선택 계약</div>
            <div className={`text-[14px] font-black ${selectedType === 'CALL' ? 'text-up' : 'text-down'}`}>
              {selectedTicker}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase font-bold tracking-wider text-[#8E939D]">선택가</div>
            <div className="text-[14px] font-black text-white tabular-nums">₩{selectedPrice.toFixed(2)}</div>
          </div>
        </div>
      </div>

      {/* HTS 메인 2열 레이아웃: 좌측 [0513] 월물별 행사가 매트릭스 (8컬럼) + 우측 HTS 주문/계좌 (4컬럼) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 min-h-[640px]">
        {/* 좌측: [0513] 선물옵션월물별 행사가 매트릭스 (8컬럼 차지) */}
        <div className="col-span-12 md:col-span-8 flex flex-col min-h-[640px]">
          <OptionMonthChainGrid
            contracts={contracts}
            selectedContractId={selectedContractId}
            selectedTicker={selectedTicker}
            futuresPrice={futuresStats.price}
            futuresChange={futuresStats.change}
            futuresChangePct={futuresStats.changePct}
            futuresVolume={futuresStats.volume}
            onSelectContract={handleSelectContract}
          />
        </div>

        {/* 우측: HTS 주문 실행 패널 & 계좌 잔고/미체결 (4컬럼 차지) */}
        <div className="col-span-12 md:col-span-4 flex flex-col gap-6">
          <OptionOrderEntry
            contractId={selectedContractId}
            ticker={selectedTicker}
            currentPrice={selectedPrice}
            multiplier={selectedMultiplier}
            userBalance={userBalance}
            onOrderSubmit={handleOrderSubmit}
          />

          <div className="flex-1">
            <OptionAccountPanel
              isLoggedIn={isLoggedIn}
              refreshTrigger={accountRefreshKey}
              onAccountChanged={fetchAccountAndContracts}
            />
          </div>
        </div>
      </div>

      {/* 하단 실시간 체결 & 기관 롤오버 피드 */}
      <div className="bg-[#0E1117] border border-border rounded-2xl p-4 shadow-2xl">
        <h3 className="text-xs font-black text-white mb-3 flex items-center justify-between font-mono">
          <span>실시간 옵션 체결 & 기관 롤오버 라이브 피드</span>
          <span className="text-[10px] text-up font-bold">LIVE FEED</span>
        </h3>
        <TradeFeed trades={trades} rolloverEvents={rolloverEvents} />
      </div>
    </div>
  );
}
