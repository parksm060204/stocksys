'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/db/client';
import { ETF_CATALOG, isUsdEtf } from '@/lib/engine/etfDefinitions';
import { DEFAULT_USD_TO_KRW_RATE } from '@/lib/engine/currency';
import { ETFPortfolio } from '@/lib/engine/etfTypes';
import { iNAVEngine } from '@/lib/engine/iNAVEngine';
import { APArbitrageEngine } from '@/lib/engine/APArbitrageEngine';
import { LeverageETFEngine } from '@/lib/engine/LeverageETFEngine';
import { ETFItemCard } from '@/app/components/ETFItemCard';
import { ETFMonitorWidget } from '@/app/components/ETFMonitorWidget';
import { ETFStructureCard } from '@/app/components/ETFStructureCard';
import { ETFUserUnderlyingHoldings } from '@/app/components/ETFUserUnderlyingHoldings';
import { useAuth } from '@/lib/auth/useAuth';

interface SyncedEtfState {
  ticker: string;
  stockId: string;
  price: number;
}

export default function ETFPage() {
  const db = createClient();
  const [selectedTicker, setSelectedTicker] = useState<string>('KODEX200');
  const [activeCategory, setActiveCategory] = useState<'ALL' | 'KOREA' | 'US' | 'GLOBAL' | 'LEVERAGE' | 'SECTOR'>('ALL');
  const [userBalance, setUserBalance] = useState<number | null>(null);
  const [userEtfShares, setUserEtfShares] = useState<number>(0);
  const [syncedEtf, setSyncedEtf] = useState<SyncedEtfState | null>(null);
  const [etfLoading, setEtfLoading] = useState<boolean>(true);
  const [usdToKrwRate, setUsdToKrwRate] = useState<number>(DEFAULT_USD_TO_KRW_RATE);
  const [tradeSubmitting, setTradeSubmitting] = useState<boolean>(false);
  const [tradeFeedback, setTradeFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const { userId, isLoggedIn } = useAuth();
  const activeAccountKey = isLoggedIn && userId ? userId : null;

  const selectedEtf = ETF_CATALOG.find(e => e.etfTicker === selectedTicker) || ETF_CATALOG[0];
  const etfSyncSeqRef = useRef<number>(0);
  const tradeContextSeqRef = useRef<number>(0);
  const tradeAttemptSeqRef = useRef<number>(0);
  const selectedTickerRef = useRef<string>(selectedEtf.etfTicker);
  const activeAccountKeyRef = useRef<string | null>(activeAccountKey);

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
  const isUsOrGlobal = isUsdEtf(selectedEtf);
  const lpQuote = apEngine.generateLPQuote(navData.iNAV, isUsOrGlobal);

  const futuresPrice = isUsOrGlobal 
    ? (underlyingPrices.get('NDX_FUTURES') ?? 18000) 
    : (underlyingPrices.get('KOSPI200_FUTURES') ?? 3500) * 250;

  const rebalanceResult = leverageEngine.calculateRebalanceOrders(portfolio, futuresPrice);

  const syncServerMarketData = useCallback(async () => {
    const [{ data: allStocks }, { data: fxRow }] = await Promise.all([
      db.from('stocks').select('id, ticker, current_price, is_listed').neq('is_listed', false),
      db.from('exchange_rates').select('rate_to_krw').eq('currency_code', 'USD').maybeSingle(),
    ]);

    if (fxRow && Number(fxRow.rate_to_krw) > 0) {
      setUsdToKrwRate(Number(fxRow.rate_to_krw));
    }

    if (Array.isArray(allStocks) && allStocks.length > 0) {
      const listedStocks = allStocks.filter((s: { is_listed?: boolean }) => s?.is_listed !== false);
      setMarketPrices((prev) => {
        const next = new Map(prev);
        for (const s of listedStocks) {
          if (s?.ticker && Number(s.current_price) > 0) {
            next.set(s.ticker, Number(s.current_price));
          }
        }
        return next;
      });

      const underlyingAlias: Record<string, string> = {
        '005930': 'SAMSUNG_ELEC',
        '000660': 'SK_HYNIX',
        '005380': 'HYUNDAI_MOTOR',
        'AAPL': 'AAPL',
        'MSFT': 'MSFT',
        'NVDA': 'NVDA',
        'TSLA': 'TSLA',
      };
      setUnderlyingPrices((prev) => {
        const next = new Map(prev);
        for (const s of listedStocks) {
          const alias = underlyingAlias[String(s?.ticker || '')];
          if (alias && Number(s.current_price) > 0) {
            next.set(alias, Number(s.current_price));
          }
        }
        return next;
      });
    }
  }, [db]);

  const targetEtfTicker = selectedEtf.etfTicker;
  const targetBasePrice = selectedEtf.basePrice;

  const fetchUserAndEtf = useCallback(async () => {
    const reqSeq = ++etfSyncSeqRef.current;
    const reqTicker = targetEtfTicker;
    const reqUserId = activeAccountKey;
    setEtfLoading(true);

    try {
      const { data: stockData, error: stockErr } = await db
        .from('stocks')
        .select('id, ticker, current_price, is_listed')
        .eq('ticker', reqTicker)
        .neq('is_listed', false)
        .maybeSingle();

      if (
        reqSeq !== etfSyncSeqRef.current ||
        selectedTickerRef.current !== reqTicker ||
        activeAccountKeyRef.current !== reqUserId
      ) {
        return;
      }

      const returnedTicker =
        stockData && typeof stockData.ticker === 'string'
          ? stockData.ticker.toUpperCase()
          : reqTicker.toUpperCase();
      const resolvedPrice = stockData ? Number(stockData.current_price ?? targetBasePrice) : NaN;
      const isValidStock =
        !stockErr &&
        stockData &&
        stockData.is_listed !== false &&
        typeof stockData.id === 'string' &&
        stockData.id.length > 0 &&
        returnedTicker === reqTicker.toUpperCase() &&
        Number.isFinite(resolvedPrice) &&
        resolvedPrice > 0;

      if (isValidStock) {
        setSyncedEtf({
          ticker: reqTicker,
          stockId: stockData.id,
          price: resolvedPrice,
        });
      } else {
        setSyncedEtf(null);
      }

      if (reqUserId) {
        const [{ data: profileData }, holdingRes] = await Promise.all([
          db.from('profiles').select('cash').eq('user_id', reqUserId).maybeSingle(),
          isValidStock
            ? db
                .from('holdings')
                .select('quantity')
                .eq('user_id', reqUserId)
                .eq('stock_id', stockData.id)
                .maybeSingle()
            : Promise.resolve({ data: null }),
        ]);

        if (
          reqSeq !== etfSyncSeqRef.current ||
          selectedTickerRef.current !== reqTicker ||
          activeAccountKeyRef.current !== reqUserId
        ) {
          return;
        }

        const parsedCash = profileData ? Number(profileData.cash) : NaN;
        setUserBalance(Number.isFinite(parsedCash) ? parsedCash : null);
        setUserEtfShares(Number(holdingRes?.data?.quantity ?? 0));
      } else {
        setUserBalance(null);
        setUserEtfShares(0);
      }
    } catch {
      if (
        reqSeq === etfSyncSeqRef.current &&
        selectedTickerRef.current === reqTicker &&
        activeAccountKeyRef.current === reqUserId
      ) {
        setSyncedEtf(null);
      }
    } finally {
      if (
        reqSeq === etfSyncSeqRef.current &&
        selectedTickerRef.current === reqTicker &&
        activeAccountKeyRef.current === reqUserId
      ) {
        setEtfLoading(false);
      }
    }
  }, [db, activeAccountKey, targetEtfTicker, targetBasePrice]);

  // Fetch logged-in user portfolio balance and ETF holdings
  useEffect(() => {
    const tickerChanged = selectedTickerRef.current !== targetEtfTicker;
    const accountChanged = activeAccountKeyRef.current !== activeAccountKey;
    if (tickerChanged || accountChanged) {
      selectedTickerRef.current = targetEtfTicker;
      activeAccountKeyRef.current = activeAccountKey;
      tradeContextSeqRef.current += 1;
      tradeAttemptSeqRef.current += 1;
      etfSyncSeqRef.current += 1;
      setTradeSubmitting(false);
      if (accountChanged) {
        setUserBalance(null);
        setUserEtfShares(0);
        setTradeFeedback(null);
      }
    }
    void fetchUserAndEtf();
    return () => {
      etfSyncSeqRef.current += 1;
    };
  }, [fetchUserAndEtf, targetEtfTicker, activeAccountKey]);

  // Switch ETF definition
  const handleSelectETF = (ticker: string) => {
    const target = ETF_CATALOG.find(e => e.etfTicker === ticker) || ETF_CATALOG[0];
    if (target.etfTicker === selectedTickerRef.current) return;
    selectedTickerRef.current = target.etfTicker;
    tradeContextSeqRef.current += 1;
    tradeAttemptSeqRef.current += 1;
    etfSyncSeqRef.current += 1;
    setTradeSubmitting(false);
    setSelectedTicker(target.etfTicker);
    setSyncedEtf(null);
    setEtfLoading(true);
    setUserEtfShares(0);
    setTradeFeedback(null);
    setPortfolio({
      etfTicker: target.etfTicker,
      leverageFactor: target.leverageFactor,
      nav: 10_000_000_000,
      currentExposure: 10_000_000_000 * target.leverageFactor,
      totalUnits: 1_000_000
    });
  };

  const isSelectedEtfReady = Boolean(
    syncedEtf &&
      syncedEtf.ticker === selectedEtf.etfTicker &&
      syncedEtf.stockId &&
      Number.isFinite(syncedEtf.price) &&
      syncedEtf.price > 0
  );

  // Authoritative Server Order Execution Handler
  const handleUserTrade = async (side: 'BUY' | 'SELL') => {
    if (tradeSubmitting) return;
    if (!isLoggedIn || !userId) {
      setTradeFeedback({ type: 'error', message: '로그인이 필요한 기능입니다.' });
      return;
    }
    if (!Number.isInteger(orderQty) || orderQty <= 0) {
      setTradeFeedback({ type: 'error', message: '주문 수량은 1주 이상의 정수여야 합니다.' });
      return;
    }
    if (!isSelectedEtfReady || !syncedEtf || syncedEtf.ticker !== selectedEtf.etfTicker) {
      setTradeFeedback({
        type: 'error',
        message: '선택한 ETF 종목의 서버 정보를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.',
      });
      return;
    }

    const expectedTicker = syncedEtf.ticker;
    const expectedEtfName = selectedEtf.name;
    const expectedAccountKey = activeAccountKey;
    const stockId = syncedEtf.stockId;
    const fallbackPrice = syncedEtf.price;
    const qty = orderQty;
    const contextSeqAtOrderStart = tradeContextSeqRef.current;
    const tradeAttemptSeq = ++tradeAttemptSeqRef.current;
    const isStaleTradeContext = () =>
      contextSeqAtOrderStart !== tradeContextSeqRef.current ||
      selectedTickerRef.current !== expectedTicker ||
      activeAccountKeyRef.current !== expectedAccountKey;

    setTradeSubmitting(true);
    setTradeFeedback(null);
    try {
      // 권위 오더북 최우선 호가 조회 (즉시 체결 가능한 지정가 산정)
      let execPrice = fallbackPrice;
      try {
        const { data: ob } = await db.rpc('get_authoritative_orderbook', {
          p_stock_id: stockId,
          p_depth: 5,
        });
        if (side === 'BUY' && Array.isArray(ob?.asks) && ob.asks.length > 0) {
          const askPx = Number(ob.asks[0].price);
          if (Number.isFinite(askPx) && askPx > 0) execPrice = askPx;
        } else if (side === 'SELL' && Array.isArray(ob?.bids) && ob.bids.length > 0) {
          const bidPx = Number(ob.bids[0].price);
          if (Number.isFinite(bidPx) && bidPx > 0) execPrice = bidPx;
        }
      } catch {
        // fallback to server stock current_price
      }

      if (isStaleTradeContext()) {
        return;
      }

      const apiRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stock_id: stockId,
          side: side === 'BUY' ? 'buy' : 'sell',
          price: execPrice,
          size: qty,
        }),
      });
      const res = await apiRes.json();

      if (isStaleTradeContext()) {
        return;
      }

      if (!apiRes.ok || !res.success) {
        setTradeFeedback({
          type: 'error',
          message: res.message || 'ETF 주문 처리에 실패했습니다.',
        });
        return;
      }

      await fetchUserAndEtf();
      if (isStaleTradeContext()) {
        return;
      }
      setTradeFeedback({
        type: 'success',
        message: res.message || `${expectedEtfName} ${qty}주 주문 처리 완료`,
      });
    } catch (err: any) {
      if (!isStaleTradeContext()) {
        setTradeFeedback({
          type: 'error',
          message: err?.message || 'ETF 주문 통신 중 오류가 발생했습니다.',
        });
      }
    } finally {
      if (tradeAttemptSeqRef.current === tradeAttemptSeq) {
        setTradeSubmitting(false);
      }
    }
  };

  // Authoritative Server Live Sync (stocks & exchange_rates)
  useEffect(() => {
    void syncServerMarketData();
    const interval = setInterval(() => {
      void syncServerMarketData();
      void fetchUserAndEtf();
    }, 2500);

    return () => clearInterval(interval);
  }, [syncServerMarketData, fetchUserAndEtf]);

  const activeServerPrice = isSelectedEtfReady && syncedEtf ? syncedEtf.price : currentMarketPrice;
  const orderNotionalQuote = activeServerPrice * orderQty;
  const orderNotionalKrw = isUsOrGlobal
    ? Math.round(orderNotionalQuote * usdToKrwRate)
    : Math.round(orderNotionalQuote);
  const orderFeeKrw = Math.round(orderNotionalKrw * 0.0025);

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

      {/* Header Banner */}
      <div className="bg-[#0E1117] border border-border p-6 rounded-3xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-2xl">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[#F04452]/40 bg-up/10 px-3.5 py-1 text-xs font-bold text-up mb-2 font-mono">
            <span className="inline-block h-2 w-2 rounded-full bg-up animate-pulse" />
            LIVE ETF TERMINAL · 서버 실시간 시세 연동
          </div>
          <h1 className="text-xl md:text-2xl font-black text-white tracking-tight">
            ETF 실시간 트레이딩 & PDF 상품구조 터미널
          </h1>
          <p className="text-[12.5px] text-[#8E939D] mt-1 font-medium">
            서버 권위 시세와 USD/KRW 환율(1 USD = ₩{usdToKrwRate.toLocaleString()})을 기준으로 iNAV 및 원화 정산이 처리됩니다.
          </p>
        </div>

        {/* 시세 새로고침 & 유저 예수금 정보 */}
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3">
          <button
            onClick={() => {
              void syncServerMarketData();
              void fetchUserAndEtf();
            }}
            className="bg-[#161B22] hover:bg-[#212631] text-white border border-border px-3.5 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
          >
            <span>🔄 서버 시세 동기화</span>
          </button>

          {/* User Balance Display */}
          {userId && userBalance !== null ? (
            <div className="bg-[#161B22] px-4 py-2.5 rounded-2xl border border-border text-xs shrink-0 font-mono flex items-center gap-3">
              <div>
                <span className="text-[#8E939D] block text-[9.5px] uppercase font-bold tracking-wider">보유 예수금</span>
                <span className="text-up font-black text-[14px] tabular-nums">₩{userBalance.toLocaleString()}</span>
              </div>
              <div className="border-l border-border pl-3">
                <span className="text-[#8E939D] block text-[9.5px] uppercase font-bold tracking-wider">보유 ETF</span>
                <span className="text-white font-black text-[14px] tabular-nums">{userEtfShares.toLocaleString()}주</span>
              </div>
            </div>
          ) : (
            <div className="bg-[#161B22] px-4 py-2 rounded-xl border border-border text-xs font-mono text-[#8E939D]">
              💡 로그인 시 실시간 ETF 거래 및 실주식 잔고가 연동됩니다.
            </div>
          )}
        </div>
      </div>

      {/* Category Tabs */}
      <div className="flex gap-2 border-b border-border pb-3 overflow-x-auto font-mono">
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
          <ETFMonitorWidget navData={navData} lpQuote={lpQuote} isUsd={isUsOrGlobal} />

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
            <div className="bg-[#0E1117] border border-border p-4 rounded-2xl space-y-3 font-mono">
              <div className="flex justify-between items-center border-b border-border pb-2">
                <span className="text-xs font-black text-amber-400">⚡ 파생 레버리지 리밸런싱 엔진</span>
                <span className="text-xs text-[#8E939D]">타겟 노출: {portfolio.leverageFactor}X</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-[#05070A] p-2.5 rounded-xl border border-border">
                  <span className="text-[#8E939D] block text-[10px] font-bold">현재 파생 평가 노출</span>
                  <span className="text-white font-black text-[13px]">
                    ₩{Math.round(portfolio.currentExposure / 100000000).toLocaleString()}억원
                  </span>
                </div>
                <div className="bg-[#05070A] p-2.5 rounded-xl border border-border">
                  <span className="text-[#8E939D] block text-[10px] font-bold">장마감 필요 리밸런싱 주문</span>
                  <span className={`text-[13px] font-black ${
                    rebalanceResult.orderQuantity > 0 ? 'text-up' : rebalanceResult.orderQuantity < 0 ? 'text-down' : 'text-white'
                  }`}>
                    {rebalanceResult.side} {Math.abs(rebalanceResult.orderQuantity).toLocaleString()} 계약
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* AP Arbitrage Decision Banner */}
          <div className="bg-[#0E1117] border border-border p-4 rounded-2xl space-y-2 font-mono">
            <span className="text-xs font-bold text-[#8E939D]">AP 지정참가회사 차익거래 판단 Engine</span>
            <div className={`p-3 rounded-xl border text-xs font-mono font-bold ${
              apDecision.action === 'CREATE_AND_SELL_ETF'
                ? 'bg-up/10 border-[#F04452]/40 text-up'
                : apDecision.action === 'BUY_AND_REDEEM_ETF'
                  ? 'bg-down/10 border-[#3182F6]/40 text-down'
                  : 'bg-[#161B22] border-border text-[#8E939D]'
            }`}>
              <div className="font-black">액션: {apDecision.action}</div>
              {apDecision.reason && <div className="mt-1 text-xs font-sans font-medium">{apDecision.reason}</div>}
            </div>
          </div>

          {/* Order Entry Trading Box */}
          <div className="bg-[#05070A] border border-border p-4 rounded-2xl space-y-3 font-mono">
            <h3 className="text-xs font-bold text-[#8E939D] flex items-center justify-between">
              <span>실시간 ETF 매수 / 매도 주문</span>
              <span className="text-xs text-white font-mono font-bold">
                서버 현재가: {isUsOrGlobal ? `$${activeServerPrice.toFixed(2)}` : `₩${Math.round(activeServerPrice).toLocaleString('ko-KR')}`}
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
                className="flex-1 bg-[#0E1117] border border-border rounded-xl px-3 py-2 text-xs text-white font-mono font-bold focus:outline-none focus:border-[#F04452]"
              />
              <span className="text-xs text-[#8E939D] font-bold">주</span>
            </div>

            <div className="text-[12px] text-[#8E939D] space-y-1 bg-[#161B22] p-2.5 rounded-xl border border-border">
              <div className="flex justify-between">
                <span className="font-medium">총 주문 금액:</span>
                <span className="font-black text-white tabular-nums">
                  {isUsOrGlobal ? `$${orderNotionalQuote.toFixed(2)}` : `₩${orderNotionalKrw.toLocaleString('ko-KR')}`}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span>{isUsOrGlobal ? `원화 환산 + 테이커 수수료(0.25%)` : '매수 최대 필요 예수금 (수수료 포함)'}:</span>
                <span className="font-bold text-amber-300 tabular-nums">
                  ₩{(orderNotionalKrw + orderFeeKrw).toLocaleString('ko-KR')}
                </span>
              </div>
            </div>

            {tradeFeedback && (
              <div
                className={`p-3 rounded-xl border text-xs font-bold ${
                  tradeFeedback.type === 'success'
                    ? 'bg-up/10 border-[#F04452]/40 text-up'
                    : 'bg-red-950/60 border-red-500/50 text-red-300'
                }`}
              >
                {tradeFeedback.message}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2.5 pt-1">
              <button
                disabled={tradeSubmitting || !isSelectedEtfReady}
                onClick={() => handleUserTrade('BUY')}
                className="py-3 bg-up hover:bg-[#ff5252] disabled:opacity-50 text-white font-black rounded-full text-xs transition-all shadow-[0_0_15px_rgba(240,68,82,0.35)] cursor-pointer active:scale-[0.98]"
              >
                {tradeSubmitting ? '처리 중...' : '매수 제출 (BUY)'}
              </button>
              <button
                disabled={tradeSubmitting || !isSelectedEtfReady}
                onClick={() => handleUserTrade('SELL')}
                className="py-3 bg-down hover:bg-[#4092ff] disabled:opacity-50 text-white font-black rounded-full text-xs transition-all shadow-[0_0_15px_rgba(49,130,246,0.35)] cursor-pointer active:scale-[0.98]"
              >
                {tradeSubmitting ? '처리 중...' : '매도 제출 (SELL)'}
              </button>
            </div>
            {etfLoading && !isSelectedEtfReady && (
              <p className="text-[11px] text-[#8E939D] font-sans" role="status">
                {selectedEtf.etfTicker} 서버 시세 및 계좌 정보를 동기화하는 중입니다...
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
