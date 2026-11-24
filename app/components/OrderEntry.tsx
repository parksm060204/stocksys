"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import type { Stock } from "@/lib/types";
import { fmtPrice } from "@/lib/format";
import { createClient } from "@/lib/db/client";
import { useAuth } from "@/lib/auth/useAuth";
import { useToast } from "@/app/components/ToastProvider";
import { DEFAULT_USD_TO_KRW_RATE, isUsdQuotedAsset } from "@/lib/engine/currency";
import {
  calculateReservedCash,
  getEffectiveStockTakerFeeRate,
  STOCK_TAKER_FEE_RATE,
} from "@/lib/engine/orderRisk";

export default function OrderEntry({ stock }: { stock: Stock }) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [price, setPrice] = useState(String(stock.currentPrice));
  const [qty, setQty] = useState("10");
  const [stockId, setStockId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [userCash, setUserCash] = useState<number | null>(null);
  const [reservedBuyCash, setReservedBuyCash] = useState<number>(0);
  const [userMarginDebt, setUserMarginDebt] = useState<number>(0);
  const [effectiveFeeRate, setEffectiveFeeRate] = useState<number>(STOCK_TAKER_FEE_RATE);
  const [userHoldingQty, setUserHoldingQty] = useState<number | null>(null);
  const [usdToKrwRate, setUsdToKrwRate] = useState<number>(DEFAULT_USD_TO_KRW_RATE);

  const db = createClient();
  const { userId, isLoggedIn } = useAuth();
  const { showToast } = useToast();
  const balanceReqSeqRef = useRef<number>(0);
  const activeContextRef = useRef<{ ticker: string; accountKey: string | null }>({
    ticker: stock.ticker,
    accountKey: isLoggedIn && userId ? userId : null,
  });

  const isBondAsset = stock.market === "bonds";
  const isUsdAsset = isUsdQuotedAsset({ market: stock.market, ticker: stock.ticker });
  const fxRate = isUsdAsset ? usdToKrwRate : 1;

  const resetUserOrderState = useCallback(() => {
    setUserCash(null);
    setReservedBuyCash(0);
    setUserMarginDebt(0);
    setEffectiveFeeRate(STOCK_TAKER_FEE_RATE);
    setUserHoldingQty(null);
  }, []);

  const refreshUserBalances = useCallback(async (sId: string) => {
    const reqSeq = ++balanceReqSeqRef.current;
    const reqTicker = stock.ticker;
    const reqAccountKey = isLoggedIn && userId ? userId : null;

    const [{ data: fxData }, { data: allStocks }, { data: contracts }] = await Promise.all([
      db.from('exchange_rates').select('rate_to_krw').eq('currency_code', 'USD').maybeSingle(),
      db.from('stocks').select('id, market, ticker'),
      db.from('options_contracts').select('id, multiplier'),
    ]);
    if (
      reqSeq !== balanceReqSeqRef.current ||
      activeContextRef.current.ticker !== reqTicker ||
      activeContextRef.current.accountKey !== reqAccountKey
    ) {
      return;
    }

    const latestFx = fxData && Number(fxData.rate_to_krw) > 0 ? Number(fxData.rate_to_krw) : DEFAULT_USD_TO_KRW_RATE;
    setUsdToKrwRate(latestFx);

    if (!reqAccountKey) {
      resetUserOrderState();
      return;
    }

    const [{ data: profile }, { data: holding }, { data: openOrders }] = await Promise.all([
      db.from('profiles').select('cash, margin_debt_krw, unlocked_features, feature_expiries, acquired_passives').eq('user_id', reqAccountKey).maybeSingle(),
      db.from('holdings').select('quantity').eq('user_id', reqAccountKey).eq('stock_id', sId).maybeSingle(),
      db.from('orders').select('stock_id, side, price, size, filled, status').eq('user_id', reqAccountKey),
    ]);
    if (
      reqSeq !== balanceReqSeqRef.current ||
      activeContextRef.current.ticker !== reqTicker ||
      activeContextRef.current.accountKey !== reqAccountKey
    ) {
      return;
    }

    const nextFeeRate = getEffectiveStockTakerFeeRate(profile);
    setEffectiveFeeRate(nextFeeRate);

    if (profile) {
      setUserCash(Number(profile.cash || 0));
      setUserMarginDebt(Math.max(0, Number(profile.margin_debt_krw || 0)));
    } else {
      setUserCash(null);
      setUserMarginDebt(0);
    }
    setUserHoldingQty(holding ? Number(holding.quantity || 0) : 0);

    const stockMap = new Map<string, { market?: string; ticker?: string }>();
    if (Array.isArray(allStocks)) {
      for (const st of allStocks) {
        if (st?.id) stockMap.set(st.id, st);
      }
    }
    const optionMap = new Map<string, { multiplier?: number }>();
    for (const contract of contracts || []) optionMap.set(contract.id, contract);
    setReservedBuyCash(calculateReservedCash(
      openOrders || [],
      undefined,
      optionMap,
      { stocks: stockMap, usdToKrwRate: latestFx },
      nextFeeRate,
    ));
  }, [isLoggedIn, userId, stock.ticker, db, resetUserOrderState]);

  useEffect(() => {
    const nextAccountKey = isLoggedIn && userId ? userId : null;
    activeContextRef.current = { ticker: stock.ticker, accountKey: nextAccountKey };
    const reqSeq = ++balanceReqSeqRef.current;

    if (!nextAccountKey) {
      resetUserOrderState();
    } else {
      // 계정/종목 전환 시 이전 계정의 잔고·보유수량이 잠시라도 노출되지 않도록 즉시 초기화
      resetUserOrderState();
    }

    const initData = async () => {
      const { data: fxData } = await db
        .from('exchange_rates')
        .select('rate_to_krw')
        .eq('currency_code', 'USD')
        .maybeSingle();
      if (reqSeq !== balanceReqSeqRef.current || activeContextRef.current.ticker !== stock.ticker) return;
      if (fxData && Number(fxData.rate_to_krw) > 0) {
        setUsdToKrwRate(Number(fxData.rate_to_krw));
      }

      const { data: stockData } = await db.from('stocks').select('id').eq('ticker', stock.ticker).maybeSingle();
      if (reqSeq !== balanceReqSeqRef.current || activeContextRef.current.ticker !== stock.ticker) return;
      if (stockData) {
        setStockId(stockData.id);
        if (nextAccountKey && activeContextRef.current.accountKey === nextAccountKey) {
          void refreshUserBalances(stockData.id);
        }
      }
    };
    void initData();

    return () => {
      balanceReqSeqRef.current += 1;
    };
  }, [stock.ticker, db, isLoggedIn, userId, refreshUserBalances, resetUserOrderState]);

  const availableBuyCashKrw = userCash !== null ? Math.max(0, userCash - reservedBuyCash) : null;
  const total = (Number(price) || 0) * (Number(qty) || 0);
  const notionalKrw = fxRate === 1 ? Math.round(total) : Math.round(total * fxRate);
  const estimatedFeeKrw = Math.round(notionalKrw * effectiveFeeRate);
  const requiredBuyCashKrw = notionalKrw + estimatedFeeKrw;

  const handleQuickBuy = (pct: number) => {
    setSide("buy");
    const targetPrice = Number(price) || stock.currentPrice;
    if (userMarginDebt > 0) {
      setQty("0");
      return;
    }
    if (availableBuyCashKrw !== null && targetPrice > 0) {
      const unitCashCost = Math.max(1, targetPrice * fxRate * (1 + effectiveFeeRate));
      const maxAffordableQty = Math.floor((availableBuyCashKrw * (pct / 100)) / unitCashCost);
      setQty(String(Math.max(0, maxAffordableQty)));
    } else {
      setQty("10");
    }
  };

  const handleQuickSell = (pct: number) => {
    setSide("sell");
    if (userHoldingQty && userHoldingQty > 0) {
      const calculatedQty = Math.floor(userHoldingQty * (pct / 100));
      setQty(String(Math.max(1, calculatedQty)));
    } else {
      setQty("10");
    }
  };

  const handleOrder = async () => {
    if (isBondAsset) {
      showToast({
        type: 'warn',
        title: '채권 매매 미지원',
        description: '채권은 현재 시세 및 YTM 분석 전용이며 직접 주문을 지원하지 않습니다.',
      });
      return;
    }
    if (!stockId || loading) return;
    setLoading(true);
    try {
      if (!isLoggedIn || !userId) {
        showToast({
          type: 'warn',
          title: '로그인 필요',
          description: '가상 주식 거래는 로그인 후 이용 가능합니다.',
        });
        return;
      }

      const orderAccountKey = userId;
      const orderTicker = stock.ticker;
      const isStaleOrderContext = () =>
        activeContextRef.current.accountKey !== orderAccountKey ||
        activeContextRef.current.ticker !== orderTicker;

      if (side === 'buy') {
        if (userMarginDebt > 0) {
          showToast({
            type: 'error',
            title: '미수 부채 상환 필요',
            description: `미수금(₩${Math.round(userMarginDebt).toLocaleString()}) 상환 전에는 신규 매수 주문을 제출할 수 없습니다.`,
          });
          return;
        }
        const { data: profile } = await db
          .from('profiles')
          .select('cash, margin_debt_krw')
          .eq('user_id', userId)
          .maybeSingle();
        if (isStaleOrderContext()) return;
        const latestCash = Number(profile?.cash || 0);
        const latestDebt = Math.max(0, Number(profile?.margin_debt_krw || 0));
        if (latestDebt > 0) {
          showToast({
            type: 'error',
            title: '미수 부채 상환 필요',
            description: `미수금(₩${Math.round(latestDebt).toLocaleString()}) 상환 전에는 신규 매수 주문을 제출할 수 없습니다.`,
          });
          return;
        }
        if (!profile || Math.max(0, latestCash - reservedBuyCash) < requiredBuyCashKrw) {
          showToast({
            type: 'error',
            title: '가용 예수금 부족',
            description: `예상 필요 예수금(₩${requiredBuyCashKrw.toLocaleString()}, 수수료 포함)이 가용 예수금(₩${Math.max(0, latestCash - reservedBuyCash).toLocaleString()})보다 큽니다.`,
          });
          return;
        }
      } else {
        const { data: holding } = await db.from('holdings').select('quantity').eq('user_id', userId).eq('stock_id', stockId).maybeSingle();
        if (isStaleOrderContext()) return;
        if (!holding || Number(holding.quantity || 0) < Number(qty)) {
          showToast({
            type: 'error',
            title: '보유 수량 부족',
            description: `매도 주문 수량(${Number(qty).toLocaleString()}주)이 보유 주식보다 많습니다.`,
          });
          return;
        }
      }

      if (isStaleOrderContext()) return;

      const apiRes = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stock_id: stockId,
          user_id: userId,
          side,
          price: Number(price),
          size: Number(qty),
        }),
      });

      const res = await apiRes.json();
      if (isStaleOrderContext()) return;

      if (res.success) {
        showToast({
          type: res.filledQty > 0 ? (side === 'buy' ? 'buy' : 'sell') : 'info',
          title: res.filledQty > 0 ? `${stock.name} 주문 체결 완료` : `${stock.name} 주문 접수 완료`,
          description: res.message,
        });
        void refreshUserBalances(stockId);
      } else {
        showToast({
          type: 'error',
          title: '주문 실패',
          description: res.message,
        });
      }
    } catch (err: any) {
      showToast({
        type: 'error',
        title: '주문 오류',
        description: err.message || '주문 처리 중 통신 오류가 발생했습니다.',
      });
    } finally {
      setLoading(false);
    }
  };


  return (
    <div className="w-full flex flex-col h-full bg-panel border border-border rounded-2xl overflow-hidden shadow-2xl font-sans">
      {/* Tab Switcher */}
      <div className="grid grid-cols-2 border-b border-border bg-panel2">
        <button
          onClick={() => setSide("buy")}
          className={`py-3 text-[13px] font-bold transition-all cursor-pointer font-sans ${
            side === "buy" 
              ? "bg-up/15 text-up border-b-2 border-[#F04452]" 
              : "text-muted hover:text-tx"
          }`}
        >
          매수 (BUY)
        </button>
        <button
          onClick={() => setSide("sell")}
          className={`py-3 text-[13px] font-bold transition-all border-l border-border cursor-pointer font-sans ${
            side === "sell" 
              ? "bg-down/15 text-down border-b-2 border-[#3182F6]" 
              : "text-muted hover:text-tx"
          }`}
        >
          매도 (SELL)
        </button>
      </div>

      <div className="space-y-4 p-4 flex-1 flex flex-col justify-between">
        <div className="space-y-3.5">
          <div className="flex items-center justify-between rounded-xl border border-border bg-panel2 px-3 py-2 text-xs font-sans">
            <span className="text-muted font-semibold">주문 유형</span>
            <span className="inline-flex items-center gap-1.5 font-bold text-tx">
              <span className="rounded-md border border-border bg-panel px-2 py-0.5 text-[11px] font-bold">
                지정가
              </span>
              <span className="text-[11px] text-muted font-medium">입력 가격으로 주문 접수</span>
            </span>
          </div>

          <Field label="지정가 주문 가격">
            <div className="relative">
              <input
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className={`w-full rounded-xl border border-border bg-panel2 px-3.5 py-2.5 text-right font-mono text-[13.5px] text-tx font-black outline-none transition-colors ${
                  side === "buy" ? "focus:border-[#F04452]" : "focus:border-[#3182F6]"
                }`}
              />
              <button 
                onClick={() => setPrice(String(stock.currentPrice))}
                className="absolute left-2.5 top-2 text-[10.5px] text-muted hover:text-tx bg-panel border border-border px-2 py-0.5 rounded-md font-bold cursor-pointer font-sans"
              >
                현재가
              </button>
            </div>
          </Field>

          <Field label="주문 수량 (주)">
            <input
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              className={`w-full rounded-xl border border-border bg-panel2 px-3.5 py-2.5 text-right font-mono text-[13.5px] text-tx font-black outline-none transition-colors ${
                side === "buy" ? "focus:border-[#F04452]" : "focus:border-[#3182F6]"
              }`}
            />
          </Field>

          {/* 수량 프리셋 버튼 */}
          <div className="flex gap-1.5 font-sans">
            {["10", "50", "100", "500"].map((q) => (
              <button
                key={q}
                onClick={() => setQty(q)}
                className="flex-1 rounded-lg border border-border bg-panel py-1 text-xs font-bold text-muted hover:bg-hover hover:text-tx transition-all cursor-pointer font-mono"
              >
                {q}주
              </button>
            ))}
          </div>

          {/* 지정가 수량 입력 보조 패널 */}
          <div className="pt-3 border-t border-border font-sans">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-[10.5px] font-bold tracking-wider text-muted">
                비율 수량 입력 보조 (지정가 폼)
              </span>
              <span className="text-[10px] text-dim">
                방향·수량만 입력
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 font-sans">
              <button
                type="button"
                onClick={() => handleQuickBuy(10)}
                className="border border-[#F04452]/40 bg-up/10 text-up hover:bg-up/20 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer"
              >
                10% 매수 수량 입력
              </button>
              <button
                type="button"
                onClick={() => handleQuickBuy(50)}
                className="border border-[#F04452]/40 bg-up/10 text-up hover:bg-up/20 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer"
              >
                50% 매수 수량 입력
              </button>
              <button
                type="button"
                onClick={() => handleQuickSell(10)}
                className="border border-[#3182F6]/40 bg-down/10 text-down hover:bg-down/20 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer"
              >
                10% 매도 수량 입력
              </button>
              <button
                type="button"
                onClick={() => handleQuickSell(100)}
                className="border border-[#3182F6]/40 bg-down/10 text-down hover:bg-down/20 py-2 text-xs font-bold rounded-xl transition-all cursor-pointer"
              >
                전량(100%) 매도 수량
              </button>
            </div>
          </div>
        </div>

        <div className="font-sans">
          {/* 예상 금액 요약 */}
          <div className="bg-panel2 px-3.5 py-2.5 mb-3 border border-border rounded-xl space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11.5px] text-muted font-medium font-sans">총 주문 예상금액</span>
              <span className="font-mono text-[14.5px] font-black tabular-nums text-tx">
                {fmtPrice(total, stock.market, stock.ticker)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono text-muted">
              <span>주문 방식</span>
              <span className="font-bold text-tx">지정가 ({fmtPrice(Number(price) || 0, stock.market, stock.ticker)})</span>
            </div>
            <div className="flex items-center justify-between text-[11px] font-mono text-muted">
              <span>
                {isUsdAsset
                  ? `원화 환산 (1 USD = ₩${usdToKrwRate.toLocaleString()}) + 수수료(${(effectiveFeeRate * 100).toFixed(3).replace(/\.?0+$/, '')}%)`
                  : `테이커 수수료(${(effectiveFeeRate * 100).toFixed(3).replace(/\.?0+$/, '')}%${effectiveFeeRate < STOCK_TAKER_FEE_RATE ? ' · 50% 할인' : ''}) 포함`}
              </span>
              <span className="font-bold text-tx">₩{(side === 'buy' ? requiredBuyCashKrw : notionalKrw).toLocaleString()}</span>
            </div>
            {availableBuyCashKrw !== null && (
              <div className="flex items-center justify-between text-[11px] font-mono text-muted pt-0.5 border-t border-border/50">
                <span>
                  가용 예수금
                  {reservedBuyCash > 0 ? ` (예약 ₩${reservedBuyCash.toLocaleString()})` : ''}
                </span>
                <span className="font-bold text-tx">
                  ₩{Math.floor(userMarginDebt > 0 ? 0 : availableBuyCashKrw).toLocaleString()}
                </span>
              </div>
            )}
          </div>

          {userMarginDebt > 0 && (
            <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-[11.5px] text-rose-300 font-medium">
              미수 부채(₩{Math.round(userMarginDebt).toLocaleString()}) 상환 전까지 신규 매수가 제한됩니다.
            </div>
          )}

          {isBondAsset && (
            <div className="mb-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11.5px] text-amber-300 font-medium">
              채권은 현재 시세·YTM 분석 전용이며 직접 주문을 지원하지 않습니다.
            </div>
          )}

          <button
            onClick={handleOrder}
            disabled={loading || isBondAsset}
            className={`w-full py-3 text-[13.5px] font-bold transition-all rounded-xl shadow-lg font-sans ${
              isBondAsset
                ? "bg-panel2 text-muted border border-border cursor-not-allowed opacity-60"
                : side === "buy"
                ? "bg-up text-white hover:bg-[#ff5252] shadow-[0_0_20px_rgba(240,68,82,0.35)] cursor-pointer active:scale-[0.98]"
                : "bg-down text-white hover:bg-[#4092ff] shadow-[0_0_20px_rgba(49,130,246,0.35)] cursor-pointer active:scale-[0.98]"
            }`}
          >
            {isBondAsset ? "채권 직접 주문 미지원" : loading ? "주문 처리 중..." : side === "buy" ? "지정가 매수 주문 제출" : "지정가 매도 주문 제출"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted font-bold">{label}</span>
      {children}
    </label>
  );
}

