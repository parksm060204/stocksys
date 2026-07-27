'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { ETF_CATALOG, ExtendedETFDefinition, seedETFStocksToDatabase } from '@/lib/engine/etfDefinitions';
import { ETFPortfolio } from '@/lib/engine/etfTypes';
import { iNAVEngine } from '@/lib/engine/iNAVEngine';
import { APArbitrageEngine } from '@/lib/engine/APArbitrageEngine';
import { LeverageETFEngine } from '@/lib/engine/LeverageETFEngine';
import { ETFMonitorWidget } from '@/app/components/ETFMonitorWidget';
import { LeverageRebalanceWidget } from '@/app/components/LeverageRebalanceWidget';
import { ETFItemCard } from '@/app/components/ETFItemCard';

export default function ETFPage() {
  const [activeCategory, setActiveCategory] = useState<'ALL' | 'KOREA' | 'US' | 'GLOBAL' | 'LEVERAGE' | 'SECTOR'>('ALL');
  const [selectedTicker, setSelectedTicker] = useState<string>('KODEXLEV');

  // Supabase Auth & User Balance State
  const [userId, setUserId] = useState<string | null>(null);
  const [userBalance, setUserBalance] = useState<number | null>(null);

  const supabase = createClient();

  const filteredEtfs = ETF_CATALOG.filter(etf => {
    if (activeCategory === 'ALL') return true;
    if (activeCategory === 'LEVERAGE') return etf.leverageFactor !== 1;
    return etf.category === activeCategory;
  });

  const selectedEtf: ExtendedETFDefinition = ETF_CATALOG.find(e => e.etfTicker === selectedTicker) || ETF_CATALOG[0];

  // Dynamic Prices Map
  const [marketPrices, setMarketPrices] = useState<Map<string, number>>(() => {
    const map = new Map<string, number>();
    ETF_CATALOG.forEach(e => map.set(e.etfTicker, e.basePrice));
    return map;
  });

  const [underlyingPrices, setUnderlyingPrices] = useState<Map<string, number>>(() => {
    const map = new Map<string, number>();
    map.set('KOSPI200_FUTURES', 3500);
    map.set('NDX_FUTURES', 18000);
    map.set('SAMSUNG_ELEC', 72000);
    map.set('SK_HYNIX', 145000);
    map.set('HYUNDAI_MOTOR', 240000);
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
  const [orderQty, setOrderQty] = useState<number>(10);

  const currentMarketPrice = marketPrices.get(selectedEtf.etfTicker) ?? selectedEtf.basePrice;

  const inavEngine = new iNAVEngine(selectedEtf);
  const apEngine = new APArbitrageEngine();
  const leverageEngine = new LeverageETFEngine();

  const navData = inavEngine.calculateiNAV(underlyingPrices, currentMarketPrice);
  const apDecision = apEngine.evaluateArbitrageOpportunity(navData);
  const lpQuote = apEngine.generateLPQuote(navData.iNAV);

  const futuresPrice = selectedEtf.category === 'US' 
    ? (underlyingPrices.get('NDX_FUTURES') ?? 18000) 
    : (underlyingPrices.get('KOSPI200_FUTURES') ?? 3500) * 250;

  const rebalanceResult = leverageEngine.calculateRebalanceOrders(portfolio, futuresPrice);

  // Fetch logged-in user and portfolio balance
  useEffect(() => {
    async function fetchUser() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUserId(session.user.id);
        const { data: portfolioData } = await supabase
          .from('portfolios')
          .select('cash_balance')
          .eq('user_id', session.user.id)
          .single();

        if (portfolioData) {
          setUserBalance(portfolioData.cash_balance ?? 0);
        } else {
          setUserBalance(0);
        }
      } else {
        setUserId(null);
        setUserBalance(null);
      }
    }
    fetchUser();
  }, [supabase]);

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

  // User Order Execution
  const handleUserTrade = async (side: 'BUY' | 'SELL') => {
    if (!userId || userBalance === null) {
      alert("로그인이 필요합니다. 로그인 후 거래해 주세요.");
      return;
    }
    const totalCost = currentMarketPrice * orderQty;
    if (side === 'BUY') {
      if (userBalance < totalCost) {
        alert("예수금이 부족합니다!");
        return;
      }
      const newBal = userBalance - totalCost;
      setUserBalance(newBal);
      await supabase.from('portfolios').update({ cash_balance: newBal }).eq('user_id', userId);
      alert(`[체결 완료] ${selectedEtf.name} (${selectedEtf.etfTicker}) ${orderQty}주 매수 완료! (총 결제액: ₩${totalCost.toLocaleString()})`);
    } else {
      const newBal = userBalance + totalCost;
      setUserBalance(newBal);
      await supabase.from('portfolios').update({ cash_balance: newBal }).eq('user_id', userId);
      alert(`[체결 완료] ${selectedEtf.name} (${selectedEtf.etfTicker}) ${orderQty}주 매도 완료! (총 수령액: ₩${totalCost.toLocaleString()})`);
    }
  };

  // Auto-seed ETF stocks to Supabase DB on mount
  useEffect(() => {
    seedETFStocksToDatabase();
  }, []);

  // Live simulation tick
  useEffect(() => {
    const interval = setInterval(() => {
      // Fluctuate market prices
      setMarketPrices(prev => {
        const next = new Map(prev);
        prev.forEach((price, ticker) => {
          const delta = (Math.random() - 0.49) * (price * 0.003);
          next.set(ticker, Number((price + delta).toFixed(2)));
        });
        return next;
      });

      // Fluctuate underlying prices
      setUnderlyingPrices(prev => {
        const next = new Map(prev);
        const fut = next.get('KOSPI200_FUTURES') ?? 3500;
        const indexReturn = (Math.random() - 0.49) * 0.005;
        const newFut = Math.round(fut * (1 + indexReturn));
        next.set('KOSPI200_FUTURES', newFut);

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
  }, [selectedTicker]);

  return (
    <div className="min-h-screen bg-[#090a0f] text-gray-200 p-4 font-mono select-none space-y-4">
      {/* Header */}
      <div className="bg-[#12141c] border border-[#222736] p-4 rounded flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
        <div>
          <h1 className="text-lg font-bold text-yellow-400 flex items-center gap-2">
            <span>📈</span>
            <span>ETF (상장지수펀드) 전종목 HTS 실시간 트레이딩 터미널</span>
          </h1>
          <p className="text-xs text-gray-400 mt-1">
            국내/미국/글로벌 ETF 카탈로그, 실시간 iNAV 괴리율 모니터, AP/LP 차익거래 & 일단위 리밸런싱
          </p>
        </div>

        {/* User Balance Display */}
        {userId && userBalance !== null ? (
          <div className="bg-[#1a1e2b] px-3.5 py-1.5 rounded border border-[#2a2e3d] text-xs">
            <span className="text-gray-400 block text-[10px]">보유 예수금</span>
            <span className="text-amber-300 font-bold text-sm tabular-nums">₩{userBalance.toLocaleString()}</span>
          </div>
        ) : (
          <div className="bg-[#1a1e2b] px-3.5 py-1.5 rounded border border-[#2a2e3d] text-xs flex items-center gap-1.5">
            <span className="text-gray-400 text-xs">🔒 로그인이 필요합니다</span>
          </div>
        )}
      </div>

      {/* Category Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-[#222736] pb-2">
        {[
          { key: 'ALL', label: '🌐 전체 ETF' },
          { key: 'KOREA', label: '🇰🇷 한국 대표' },
          { key: 'US', label: '🇺🇸 미국 대표' },
          { key: 'LEVERAGE', label: '⚡ 레버리지/인버스' },
          { key: 'SECTOR', label: '🏭 섹터/테마' },
          { key: 'GLOBAL', label: '🌍 글로벌 국가' }
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveCategory(tab.key as any)}
            className={`px-3.5 py-1.5 rounded text-xs font-bold transition-all border ${
              activeCategory === tab.key
                ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500'
                : 'bg-[#141721] text-gray-400 border-[#222736] hover:text-white hover:border-gray-500'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Grid: ETF Catalog (Left 7 cols) & Selected ETF Engine Dashboard (Right 5 cols) */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
        {/* ETF Catalog Grid (7 Columns) */}
        <div className="md:col-span-7 space-y-3">
          <div className="text-xs text-gray-400 font-bold flex justify-between items-center px-1">
            <span>ETF 종목 리스트 ({filteredEtfs.length}개 종목)</span>
            <span className="text-[10px]">종목 클릭 시 우측 HTS 터미널이 변경됩니다.</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[calc(100vh-220px)] overflow-y-auto pr-1">
            {filteredEtfs.map(etf => {
              const price = marketPrices.get(etf.etfTicker) ?? etf.basePrice;
              const etfInavEngine = new iNAVEngine(etf);
              const etfNavData = etfInavEngine.calculateiNAV(underlyingPrices, price);
              return (
                <ETFItemCard
                  key={etf.etfTicker}
                  etf={etf}
                  currentMarketPrice={price}
                  iNAV={etfNavData.iNAV}
                  discrepancyRate={etfNavData.discrepancyRate}
                  isSelected={selectedTicker === etf.etfTicker}
                  onSelect={() => handleSelectETF(etf.etfTicker)}
                />
              );
            })}
          </div>
        </div>

        {/* Selected ETF HTS Dashboard (5 Columns) */}
        <div className="md:col-span-5 space-y-3">
          <div className="bg-[#12141c] border border-[#222736] p-3 rounded space-y-3">
            {/* Title & Selected Header */}
            <div className="flex justify-between items-center border-b border-[#1e222d] pb-2">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-white">{selectedEtf.name}</h2>
                  <span className="text-xs font-bold text-yellow-400">({selectedEtf.etfTicker})</span>
                </div>
                <p className="text-[11px] text-gray-400">
                  배율: {selectedEtf.leverageFactor > 0 ? `+${selectedEtf.leverageFactor}배` : `${selectedEtf.leverageFactor}배`} | CU: {selectedEtf.cuSize.toLocaleString()}주
                </p>
              </div>
            </div>

            {/* iNAV Monitor Widget */}
            <ETFMonitorWidget navData={navData} lpQuote={lpQuote} />

            {/* Leverage Rebalance Widget */}
            {selectedEtf.leverageFactor !== 1 && (
              <LeverageRebalanceWidget
                etfTicker={portfolio.etfTicker}
                leverage={portfolio.leverageFactor}
                nav={portfolio.nav}
                currentExposure={portfolio.currentExposure}
                expectedRebalanceQty={rebalanceResult.orderQuantity}
                rebalanceSide={rebalanceResult.side}
              />
            )}

            {/* AP Bot Decision Card */}
            <div className="bg-[#0d0e12] border border-[#2a2e39] p-3 rounded space-y-1.5">
              <h3 className="text-xs font-bold text-gray-300 flex items-center gap-1.5">
                <span>🤖</span>
                <span>AP 지정참가회사 무위험 차익실현 엔진</span>
              </h3>
              
              <div className={`p-2.5 rounded border text-xs ${
                apDecision.action === 'CREATE_AND_SELL_ETF'
                  ? 'bg-red-950/40 border-red-800 text-red-300'
                  : apDecision.action === 'BUY_AND_REDEEM_ETF'
                  ? 'bg-blue-950/40 border-blue-800 text-blue-300'
                  : 'bg-[#141722] border-[#252a38] text-gray-400'
              }`}>
                <div className="font-bold">액션: {apDecision.action}</div>
                {apDecision.reason && <div className="mt-0.5 text-[10.5px] font-sans">{apDecision.reason}</div>}
              </div>
            </div>

            {/* Order Entry Trading Box */}
            <div className="bg-[#0d0e12] border border-[#2a2e39] p-3 rounded space-y-2">
              <h3 className="text-xs font-bold text-gray-300 flex items-center justify-between">
                <span>💳 실시간 ETF 매수 / 매도 주문</span>
                <span className="text-[10px] text-gray-400">현재가: ₩{currentMarketPrice.toLocaleString()}</span>
              </h3>

              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-400">주문수량:</span>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  value={orderQty}
                  onChange={(e) => setOrderQty(Math.max(1, parseInt(e.target.value) || 1))}
                  className="flex-1 bg-[#161822] border border-[#2a2e39] rounded px-2 py-1 text-xs text-white font-mono focus:outline-none focus:border-yellow-500"
                />
                <span className="text-xs text-gray-400">주</span>
              </div>

              <div className="text-[11px] text-gray-400 flex justify-between px-1">
                <span>총 주문 금액:</span>
                <span className="font-bold text-amber-300">₩{(currentMarketPrice * orderQty).toLocaleString()}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-1">
                <button
                  onClick={() => handleUserTrade('BUY')}
                  className="py-2 bg-red-600 hover:bg-red-500 text-white font-bold rounded text-xs transition-all shadow-[0_0_10px_rgba(239,83,80,0.3)]"
                >
                  🔴 매수 (BUY)
                </button>
                <button
                  onClick={() => handleUserTrade('SELL')}
                  className="py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded text-xs transition-all shadow-[0_0_10px_rgba(66,165,245,0.3)]"
                >
                  🔵 매도 (SELL)
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
