'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { ETF_CATALOG, seedETFStocksToDatabase } from '@/lib/engine/etfDefinitions';
import { ETFPortfolio } from '@/lib/engine/etfTypes';
import { iNAVEngine } from '@/lib/engine/iNAVEngine';
import { APArbitrageEngine } from '@/lib/engine/APArbitrageEngine';
import { LeverageETFEngine } from '@/lib/engine/LeverageETFEngine';
import { ETFItemCard } from '@/app/components/ETFItemCard';
import { ETFMonitorWidget } from '@/app/components/ETFMonitorWidget';
import { ETFStructureCard } from '@/app/components/ETFStructureCard';
import { ETFUserUnderlyingHoldings } from '@/app/components/ETFUserUnderlyingHoldings';
import { useAuth } from '@/lib/auth/useAuth';

const supabase = createClient();

export default function ETFPage() {
  const [selectedTicker, setSelectedTicker] = useState<string>('KODEX200');
  const [activeCategory, setActiveCategory] = useState<'ALL' | 'KOREA' | 'US' | 'GLOBAL' | 'LEVERAGE' | 'SECTOR'>('ALL');
  const [userBalance, setUserBalance] = useState<number | null>(null);
  const [userEtfShares, setUserEtfShares] = useState<number>(0);
  const [eventBanner, setEventBanner] = useState<{ title: string; shockPercent: number } | null>(null);

  const selectedEtf = ETF_CATALOG.find(e => e.etfTicker === selectedTicker) || ETF_CATALOG[0];

  // Market Prices State (Init with base prices)
  const [marketPrices, setMarketPrices] = useState<Map<string, number>>(() => {
    const map = new Map<string, number>();
    ETF_CATALOG.forEach(etf => map.set(etf.etfTicker, etf.basePrice));
    return map;
  });

  // Underlying Stock Prices State
  const [underlyingPrices, setUnderlyingPrices] = useState<Map<string, number>>(() => {
    const map = new Map<string, number>();
    map.set('SAMSUNG_ELEC', 72000);
    map.set('SK_HYNIX', 145000);
    map.set('HYUNDAI_MOTOR', 240000);
    map.set('KOSPI200_FUTURES', 3500);
    map.set('NDX_FUTURES', 18000);
    map.set('LG_ENERGY', 380000);
    map.set('POSCO_HOLDINGS', 390000);
    map.set('AAPL', 220);
    map.set('MSFT', 440);
    map.set('NVDA', 125);
    map.set('TSLA', 240);
    map.set('TOYOTA', 200);
    map.set('SONY', 85);
    map.set('TENCENT', 48);
    map.set('ALIBABA', 78);
    return map;
  });

  // Portfolio state for selected ETF
  const [portfolio, setPortfolio] = useState<ETFPortfolio>({
    etfTicker: selectedEtf.etfTicker,
    leverageFactor: selectedEtf.leverageFactor,
    nav: 10_000_000_000,
    currentExposure: 10_000_000_000 * selectedEtf.leverageFactor,
    totalUnits: 1_000_000
  });

  // User Order Quantity state
  const [orderQty, setOrderQty] = useState<number>(100);

  const currentMarketPrice = marketPrices.get(selectedEtf.etfTicker) ?? selectedEtf.basePrice;

  const inavEngine = new iNAVEngine(selectedEtf);
  const apEngine = new APArbitrageEngine();
  const leverageEngine = new LeverageETFEngine();

  const navData = inavEngine.calculateiNAV(underlyingPrices, currentMarketPrice);
  const apDecision = apEngine.evaluateArbitrageOpportunity(navData);
  const isUsOrGlobal = selectedEtf.category === 'US' || selectedEtf.category === 'GLOBAL';
  const lpQuote = apEngine.generateLPQuote(navData.iNAV, isUsOrGlobal);

  const futuresPrice = isUsOrGlobal 
    ? (underlyingPrices.get('NDX_FUTURES') ?? 18000) 
    : (underlyingPrices.get('KOSPI200_FUTURES') ?? 3500) * 250;

  const rebalanceResult = leverageEngine.calculateRebalanceOrders(portfolio, futuresPrice);

  const { userId, isLoggedIn } = useAuth();

  // Fetch logged-in user portfolio balance and ETF holdings
  useEffect(() => {
    async function fetchUser() {
      if (isLoggedIn && userId) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('cash')
          .eq('id', userId)
          .single();

        setUserBalance(Number(profileData?.cash ?? 0));

        const { data: stockData } = await supabase
          .from('stocks')
          .select('id')
          .eq('ticker', selectedEtf.etfTicker)
          .single();

        if (stockData) {
          const { data: holdingData } = await supabase
            .from('holdings')
            .select('quantity')
            .eq('user_id', userId)
            .eq('stock_id', stockData.id)
            .single();

          setUserEtfShares(holdingData?.quantity ?? 0);
        }
      } else {
        setUserBalance(null);
        setUserEtfShares(0);
      }
    }
    fetchUser();
  }, [isLoggedIn, userId, selectedEtf.etfTicker]);

  // Switch ETF definition
  const handleSelectETF = (ticker: string) => {
    setSelectedTicker(ticker);
    const target = ETF_CATALOG.find(e => e.etfTicker === ticker) || ETF_CATALOG[0];
    setPortfolio({
      etfTicker: target.etfTicker,
      leverageFactor: target.leverageFactor,
      nav: 10_000_000_000,
      currentExposure: 10_000_000_000 * target.leverageFactor,
      totalUnits: 1_000_000
    });
  };

  // Manual 4%+ event shock trigger helper
  const triggerMarketEvent = (isUp: boolean) => {
    const shock = (isUp ? 1 : -1) * (0.045 + Math.random() * 0.025); // 4.5% ~ 7.0% shock
    const shockPct = Number((shock * 100).toFixed(1));
    const title = isUp
      ? `🔥 [대형 호재 이벤트 발동] 글로벌 기술주 실적 어닝 서프라이즈! (iNAV ${shockPct > 0 ? '+' : ''}${shockPct}% 급등)`
      : `⚠️ [대형 악재 이벤트 발동] 연준 기준금리 기습 인상 발표! (iNAV ${shockPct}% 급락)`;

    setEventBanner({ title, shockPercent: shockPct });
    setUnderlyingPrices(prev => {
      const next = new Map(prev);
      prev.forEach((price, ticker) => {
        const newPrice = Math.max(10, Math.round(price * (1 + shock)));
        next.set(ticker, newPrice);
      });
      return next;
    });

    setTimeout(() => setEventBanner(null), 4500);
  };

  // User Trade Execution Handler (DB Sync)
  const handleUserTrade = async (side: 'BUY' | 'SELL') => {
    if (!isLoggedIn || !userId) {
      alert("로그인이 필요한 기능입니다.");
      return;
    }

    const totalCost = currentMarketPrice * orderQty;

    if (side === 'BUY') {
      if ((userBalance ?? 0) < totalCost) {
        alert("예수금이 부족합니다!");
        return;
      }
      const newBal = (userBalance ?? 0) - totalCost;
      setUserBalance(newBal);
      setUserEtfShares(prev => prev + orderQty);

      await supabase.from('profiles').update({ cash: newBal }).eq('id', userId);

      const { data: stockData } = await supabase
        .from('stocks')
        .select('id')
        .eq('ticker', selectedEtf.etfTicker)
        .single();

      if (stockData) {
        const { data: existingHolding } = await supabase
          .from('holdings')
          .select('id, quantity, avg_price')
          .eq('user_id', userId)
          .eq('stock_id', stockData.id)
          .single();

        if (existingHolding) {
          const oldQty = Number(existingHolding.quantity || 0);
          const oldAvg = Number(existingHolding.avg_price || 0);
          const newQty = oldQty + orderQty;
          const newAvg = (oldQty * oldAvg + totalCost) / newQty;
          await supabase
            .from('holdings')
            .update({ quantity: newQty, avg_price: Math.round(newAvg) })
            .eq('id', existingHolding.id);
        } else {
          await supabase
            .from('holdings')
            .insert({ user_id: userId, stock_id: stockData.id, quantity: orderQty, avg_price: currentMarketPrice });
        }
      }

      alert(`[체결 완료] ${selectedEtf.name} (${selectedEtf.etfTicker}) ${orderQty}주 매수 완료!`);
    } else {
      if (userEtfShares < orderQty) {
        alert("보유 ETF 수량이 부족합니다!");
        return;
      }

      const newBal = (userBalance ?? 0) + totalCost;
      setUserBalance(newBal);
      setUserEtfShares(prev => prev - orderQty);

      await supabase.from('profiles').update({ cash: newBal }).eq('id', userId);

      const { data: stockData } = await supabase
        .from('stocks')
        .select('id')
        .eq('ticker', selectedEtf.etfTicker)
        .single();

      if (stockData) {
        const { data: existingHolding } = await supabase
          .from('holdings')
          .select('id, quantity')
          .eq('user_id', userId)
          .eq('stock_id', stockData.id)
          .single();

        if (existingHolding) {
          const rem = existingHolding.quantity - orderQty;
          if (rem <= 0) {
            await supabase.from('holdings').delete().eq('id', existingHolding.id);
          } else {
            await supabase.from('holdings').update({ quantity: rem }).eq('id', existingHolding.id);
          }
        }
      }

      alert(`[체결 완료] ${selectedEtf.name} (${selectedEtf.etfTicker}) ${orderQty}주 매도 완료!`);
    }
  };

  // Auto-seed ETF stocks to Supabase DB on mount
  useEffect(() => {
    seedETFStocksToDatabase();
  }, []);

  // Live simulation tick
  useEffect(() => {
    const interval = setInterval(() => {
      // Fluctuate market prices (LP iNAV Anchor Mean-Reversion & KRX ETF 5-won tick rounding)
      setMarketPrices(prev => {
        const next = new Map(prev);
        prev.forEach((price, ticker) => {
          const etfDef = ETF_CATALOG.find(e => e.etfTicker === ticker);
          if (!etfDef) return;
          const isUsGlobal = etfDef.category === 'US' || etfDef.category === 'GLOBAL';
          const etfInavEngine = new iNAVEngine(etfDef);
          const navRes = etfInavEngine.calculateiNAV(underlyingPrices, price);

          // LP 유동성공급자 iNAV 앵커링 평균회귀 수식 적용
          const nextPrice = apEngine.calculateLPAntichamberPrice(price, navRes.iNAV, isUsGlobal);
          next.set(ticker, nextPrice);
        });
        return next;
      });

      // Fluctuate underlying prices (Normal ±0.5% max daily band vs Event 4%+ shock)
      setUnderlyingPrices(prev => {
        const next = new Map(prev);
        // 평상시: 틱당 ±0.05% 내외 소폭 변동하여 일일 ±0.5% 범주 내 안정적 주행
        const indexReturn = (Math.random() - 0.49) * 0.001;

        prev.forEach((price, ticker) => {
          const newPrice = Math.max(10, Math.round(price * (1 + indexReturn)));
          next.set(ticker, newPrice);
        });

        // Update Leverage NAV
        setPortfolio(prevPort => {
          const newPort = { ...prevPort };
          leverageEngine.updateNAV(newPort, indexReturn);
          return newPort;
        });

        return next;
      });
    }, 1000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTicker]);

  const filteredEtfs = ETF_CATALOG.filter(e => {
    if (activeCategory === 'ALL') return true;
    return e.category === activeCategory;
  });

  return (
    <div className="mx-auto max-w-7xl px-6 py-6 space-y-6 select-none">
      {/* Breadcrumb Navigation */}
      <nav className="flex items-center gap-2 text-[12px] text-[#8E939D]">
        <Link href="/" className="hover:text-white font-medium">
          메인홈
        </Link>
        <span>/</span>
        <span className="text-white font-bold">상장지수펀드 (ETF)</span>
      </nav>

      {/* 4%+ 대형 이벤트 발생 라이브 배너 */}
      {eventBanner && (
        <div className={`p-4 rounded-2xl border font-mono text-xs shadow-2xl flex items-center justify-between animate-bounce ${
          eventBanner.shockPercent > 0
            ? 'bg-[#F04452]/20 border-[#F04452] text-[#F04452]'
            : 'bg-[#3182F6]/20 border-[#3182F6] text-[#3182F6]'
        }`}>
          <div className="flex items-center gap-2">
            <span className="text-base">⚡</span>
            <span className="font-extrabold text-[13px]">{eventBanner.title}</span>
          </div>
          <span className="text-[11px] font-bold bg-black/40 px-3 py-1 rounded-full border border-white/20">
            변동폭: {eventBanner.shockPercent > 0 ? '+' : ''}{eventBanner.shockPercent}%
          </span>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-[#0E1117] border border-[#212631] p-6 rounded-3xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-2xl">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#F04452]/40 bg-[#F04452]/10 px-3.5 py-1 text-[11px] font-bold text-[#F04452] mb-2 font-mono">
            <span className="inline-block h-2 w-2 rounded-full bg-[#F04452] animate-pulse" />
            LIVE ETF TERMINAL · 상장지수펀드
          </div>
          <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">
            ETF 실시간 트레이딩 & PDF 상품구조 터미널
          </h1>
          <p className="text-[12.5px] text-[#8E939D] mt-1 font-medium">
            평상시 ±0.5% 안정 수렴 vs 대형 이벤트 발동 시 4%+ iNAV 급변 연동 알고리즘 가동
          </p>
        </div>

        {/* 이벤트 발동 버튼 & 유저 예수금 정보 */}
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3">
          {/* 4%+ 이벤트 테스트 발동 버튼 */}
          <div className="flex gap-2">
            <button
              onClick={() => triggerMarketEvent(true)}
              className="bg-[#F04452]/15 hover:bg-[#F04452]/30 text-[#F04452] border border-[#F04452]/40 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 active:scale-95"
            >
              <span>🔥 4%+ 호재 충격</span>
            </button>
            <button
              onClick={() => triggerMarketEvent(false)}
              className="bg-[#3182F6]/15 hover:bg-[#3182F6]/30 text-[#3182F6] border border-[#3182F6]/40 px-3 py-1.5 rounded-xl text-[11px] font-bold transition-all cursor-pointer flex items-center gap-1 active:scale-95"
            >
              <span>⚠️ 4%+ 악재 충격</span>
            </button>
          </div>

          {/* User Balance Display */}
          {userId && userBalance !== null ? (
            <div className="bg-[#161B22] px-4 py-2.5 rounded-2xl border border-[#212631] text-xs shrink-0 font-mono flex items-center gap-3">
              <div>
                <span className="text-[#8E939D] block text-[9.5px] uppercase font-bold tracking-wider">보유 예수금</span>
                <span className="text-[#F04452] font-black text-[14px] tabular-nums">₩{userBalance.toLocaleString()}</span>
              </div>
              <div className="border-l border-[#212631] pl-3">
                <span className="text-[#8E939D] block text-[9.5px] uppercase font-bold tracking-wider">보유 ETF</span>
                <span className="text-white font-black text-[14px] tabular-nums">{userEtfShares.toLocaleString()}주</span>
              </div>
            </div>
          ) : (
            <div className="bg-[#161B22] px-4 py-2 rounded-xl border border-[#212631] text-xs font-mono text-[#8E939D]">
              💡 로그인 시 실시간 ETF 거래 및 실주식 잔고가 연동됩니다.
            </div>
          )}
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex gap-2 border-b border-[#212631] pb-3 overflow-x-auto font-mono">
        {[
          { key: 'ALL', label: '전체 ETF' },
          { key: 'KOREA', label: '🇰🇷 한국 대표' },
          { key: 'US', label: '🇺🇸 미국 대표' },
          { key: 'LEVERAGE', label: '⚡ 레버리지/인버스' },
          { key: 'SECTOR', label: '🏭 섹터/테마' },
          { key: 'GLOBAL', label: '🌍 글로벌 국가' }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveCategory(tab.key as any)}
            className={`rounded-xl px-4 py-2 text-[12.5px] font-extrabold transition-all cursor-pointer ${
              activeCategory === tab.key
                ? 'bg-[#161B22] text-white border border-white/10 shadow-md'
                : 'text-[#8E939D] hover:text-white hover:bg-[#12161F]/60'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Grid: ETF Catalog (Left 6 cols) & Selected ETF HTS Dashboard (Right 6 cols) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* ETF Catalog Grid (6 Columns) */}
        <div className="md:col-span-6 space-y-3">
          <div className="text-xs text-[#8E939D] font-bold flex justify-between items-center px-1">
            <span className="text-white font-extrabold">ETF 종목 리스트 ({filteredEtfs.length}개 종목)</span>
            <span className="text-[10.5px]">종목 클릭 시 우측 터미널이 스위칭됩니다.</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[calc(100vh-240px)] overflow-y-auto pr-1">
            {filteredEtfs.map(etf => {
              const price = marketPrices.get(etf.etfTicker) ?? etf.basePrice;
              const etfInavEngine = new iNAVEngine(etf);
              const calculatedNav = etfInavEngine.calculateiNAV(underlyingPrices, price);

              return (
                <ETFItemCard
                  key={etf.etfTicker}
                  etf={etf}
                  currentMarketPrice={price}
                  iNAV={calculatedNav.iNAV}
                  discrepancyRate={calculatedNav.discrepancyRate}
                  isSelected={selectedTicker === etf.etfTicker}
                  onSelect={() => handleSelectETF(etf.etfTicker)}
                />
              );
            })}
          </div>
        </div>

        {/* Selected ETF Detailed Terminal (Right 6 Columns) */}
        <div className="md:col-span-6 space-y-4">
          {/* ETF iNAV Monitor & LP Quote Widget */}
          <ETFMonitorWidget navData={navData} lpQuote={lpQuote} />

          {/* User Portfolio Underlying Physical Holdings */}
          <ETFUserUnderlyingHoldings
            etf={selectedEtf}
            userEtfShares={userEtfShares}
            underlyingPrices={underlyingPrices}
          />

          {/* PDF Asset Breakdown Card */}
          <ETFStructureCard etf={selectedEtf} underlyingPrices={underlyingPrices} />

          {/* Leverage ETF Rebalance Engine Section */}
          {selectedEtf.leverageFactor !== 1 && (
            <div className="bg-[#0E1117] border border-[#212631] p-4 rounded-2xl space-y-3 font-mono">
              <div className="flex justify-between items-center border-b border-[#212631] pb-2">
                <span className="text-xs font-black text-amber-400">⚡ 파생 레버리지 리밸런싱 엔진</span>
                <span className="text-[11px] text-[#8E939D]">타겟 노출: {portfolio.leverageFactor}X</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-[#05070A] p-2.5 rounded-xl border border-[#212631]">
                  <span className="text-[#8E939D] block text-[10px] font-bold">현재 파생 평가 노출</span>
                  <span className="text-white font-black text-[13px]">
                    ₩{Math.round(portfolio.currentExposure / 100000000).toLocaleString()}억원
                  </span>
                </div>
                <div className="bg-[#05070A] p-2.5 rounded-xl border border-[#212631]">
                  <span className="text-[#8E939D] block text-[10px] font-bold">장마감 필요 리밸런싱 주문</span>
                  <span className={`text-[13px] font-black ${
                    rebalanceResult.orderQuantity > 0 ? 'text-[#F04452]' : rebalanceResult.orderQuantity < 0 ? 'text-[#3182F6]' : 'text-white'
                  }`}>
                    {rebalanceResult.side} {Math.abs(rebalanceResult.orderQuantity).toLocaleString()} 계약
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* AP Arbitrage Decision Banner */}
          <div className="bg-[#0E1117] border border-[#212631] p-4 rounded-2xl space-y-2 font-mono">
            <span className="text-xs font-bold text-[#8E939D]">AP 지정참가회사 차익거래 판단 Engine</span>
            <div className={`p-3 rounded-xl border text-xs font-mono font-bold ${
              apDecision.action === 'CREATE_AND_SELL_ETF'
                ? 'bg-[#F04452]/10 border-[#F04452]/40 text-[#F04452]'
                : apDecision.action === 'BUY_AND_REDEEM_ETF'
                  ? 'bg-[#3182F6]/10 border-[#3182F6]/40 text-[#3182F6]'
                  : 'bg-[#161B22] border-[#212631] text-[#8E939D]'
            }`}>
              <div className="font-black">액션: {apDecision.action}</div>
              {apDecision.reason && <div className="mt-1 text-[11px] font-sans font-medium">{apDecision.reason}</div>}
            </div>
          </div>

          {/* Order Entry Trading Box */}
          <div className="bg-[#05070A] border border-[#212631] p-4 rounded-2xl space-y-3 font-mono">
            <h3 className="text-xs font-bold text-[#8E939D] flex items-center justify-between">
              <span>실시간 ETF 매수 / 매도 주문</span>
              <span className="text-[11px] text-white font-mono font-bold">
                현재가: {isUsOrGlobal ? `$${currentMarketPrice.toFixed(2)}` : `₩${Math.round(currentMarketPrice).toLocaleString('ko-KR')}`}
              </span>
            </h3>

            <div className="flex items-center gap-3">
              <span className="text-xs text-[#8E939D] font-bold">주문수량:</span>
              <input
                type="number"
                min={1}
                max={10000}
                value={orderQty}
                onChange={(e) => setOrderQty(Math.max(1, parseInt(e.target.value) || 1))}
                className="flex-1 bg-[#0E1117] border border-[#212631] rounded-xl px-3 py-2 text-xs text-white font-mono font-bold focus:outline-none focus:border-[#F04452]"
              />
              <span className="text-xs text-[#8E939D] font-bold">주</span>
            </div>

            <div className="text-[12px] text-[#8E939D] flex justify-between px-1 bg-[#161B22] p-2.5 rounded-xl border border-[#212631]">
              <span className="font-medium">총 주문 금액:</span>
              <span className="font-black text-white tabular-nums">
                {isUsOrGlobal ? `$${(currentMarketPrice * orderQty).toFixed(2)}` : `₩${Math.round(currentMarketPrice * orderQty).toLocaleString('ko-KR')}`}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                onClick={() => handleUserTrade('BUY')}
                className="py-3 bg-[#F04452] hover:bg-[#ff5252] text-white font-black rounded-full text-xs transition-all shadow-[0_0_15px_rgba(240,68,82,0.35)] cursor-pointer active:scale-[0.98]"
              >
                매수 제출 (BUY)
              </button>
              <button
                onClick={() => handleUserTrade('SELL')}
                className="py-3 bg-[#3182F6] hover:bg-[#4092ff] text-white font-black rounded-full text-xs transition-all shadow-[0_0_15px_rgba(49,130,246,0.35)] cursor-pointer active:scale-[0.98]"
              >
                매도 제출 (SELL)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
