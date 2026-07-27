"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { fmtVolume } from "@/lib/format";
import StrictWidget from './StrictWidget';
import { runOptionBotTradingEngine, LiquidationEvent, RolloverTrackerState } from "@/lib/engine/optionBotEngine";
import RolloverTracker from "./RolloverTracker";

interface OptionsPanelProps {
  stockId: string;
  ticker?: string;
}

export default function OptionsPanel({ stockId, ticker = "STOCK" }: OptionsPanelProps) {
  const [hasLicense, setHasLicense] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [options, setOptions] = useState<any[]>([]);
  const [spotPrice, setSpotPrice] = useState<number>(50000);
  const [filterClass, setFilterClass] = useState<"ALL" | "IDX" | "STK" | "FUT">("ALL");
  const [loading, setLoading] = useState(true);
  const [gammaSqueezeNotice, setGammaSqueezeNotice] = useState(false);
  const [liquidations, setLiquidations] = useState<LiquidationEvent[]>([]);
  const [rolloverState, setRolloverState] = useState<RolloverTrackerState | null>(null);

  // D-Day Expiry Countdown Timer
  const [countdownStr, setCountdownStr] = useState("01:24:05");

  const supabase = createClient();

  useEffect(() => {
    async function fetchData() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUserId(session.user.id);
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_admin, has_options_license')
          .eq('id', session.user.id)
          .single();
        if (profile) {
          setHasLicense(profile.is_admin || profile.has_options_license || false);
        }
      }

      // Fetch stock spot price
      const { data: stockData } = await supabase
        .from('stocks')
        .select('current_price, ticker, name')
        .eq('id', stockId)
        .single();

      const currentSpot = Number(stockData?.current_price || 50000);
      setSpotPrice(currentSpot);
      const symbol = stockData?.ticker || ticker;

      // Run 50 Institution Bots Options Trading Simulation
      const result = await runOptionBotTradingEngine(stockId, symbol, currentSpot);
      if (result.gammaSqueezeTriggered) {
        setGammaSqueezeNotice(true);
      }
      if (result.liquidationEvents && result.liquidationEvents.length > 0) {
        setLiquidations(result.liquidationEvents);
      }
      if (result.rolloverTrackerState) {
        setRolloverState(result.rolloverTrackerState);
      }

      // Fetch options contracts
      const { data: optionsData } = await supabase
        .from('options_contracts')
        .select('*')
        .eq('underlying_stock_id', stockId)
        .order('strike_price', { ascending: true });

      setOptions(optionsData || []);
      setLoading(false);
    }

    fetchData();

    // Timer Interval for Expiration Countdown
    const timer = setInterval(() => {
      const now = new Date();
      const h = String(15 - now.getHours()).padStart(2, '0');
      const m = String(59 - now.getMinutes()).padStart(2, '0');
      const s = String(59 - now.getSeconds()).padStart(2, '0');
      setCountdownStr(`${Math.max(0, parseInt(h))}:${m}:${s}`);
    }, 1000);

    return () => clearInterval(timer);
  }, [stockId, ticker, supabase]);

  const handleTradeOption = async (option: any) => {
    if (!userId || !hasLicense) {
      alert("파생상품 옵션 거래 자격증이 필요합니다. 상점에서 해금해 주세요.");
      return;
    }

    const qtyStr = prompt(`[${option.ticker}] 옵션 주문 수량을 입력해 주세요:`, "10");
    if (!qtyStr) return;
    const qty = parseInt(qtyStr, 10);
    if (isNaN(qty) || qty <= 0) return;

    const totalPrice = option.current_price * qty;
    if (!confirm(`[${option.ticker}] ${option.option_type} 옵션 ${qty}계약 매수\n총 결제금액: ₩${totalPrice.toLocaleString()}`)) return;

    try {
      const { data, error } = await supabase.rpc('execute_option_order', {
        p_user_id: userId,
        p_option_id: option.id,
        p_side: 'BUY',
        p_quantity: qty,
        p_price: option.current_price
      });

      if (error) throw error;
      alert(`🎉 [${option.ticker}] ${qty}계약 매수 주문 체결 완료!`);
      
      const { data: refreshed } = await supabase
        .from('options_contracts')
        .select('*')
        .eq('underlying_stock_id', stockId)
        .order('strike_price', { ascending: true });
      setOptions(refreshed || []);
    } catch (e: any) {
      console.error(e);
      alert("옵션 주문 체결 실패: " + (e.message || e));
    }
  };

  const handleExecuteUserRollover = async () => {
    if (!userId || !hasLicense || options.length < 2) return;
    const currOpt = options[0];
    const nextOpt = options[1];
    const qty = 5;

    if (!confirm(`[롤오버 결합 주문 실행]\n근월물 [${currOpt.ticker}] ${qty}계약 청산 🔄 차월물 [${nextOpt.ticker}] ${qty}계약 원자적 이월 진입`)) return;

    try {
      const { data, error } = await supabase.rpc('execute_rollover_combo', {
        p_user_id: userId,
        p_curr_option_id: currOpt.id,
        p_next_option_id: nextOpt.id,
        p_quantity: qty,
        p_curr_price: currOpt.current_price,
        p_next_price: nextOpt.current_price
      });

      if (error) throw error;
      alert(`🎉 롤오버 결합 주문 체결 완료! 스프레드 차액: ₩${Number(data).toLocaleString()}`);
    } catch (e: any) {
      console.error(e);
      alert("롤오버 결합 주문 실패: " + (e.message || e));
    }
  };

  const filteredOptions = options.filter(opt => {
    if (filterClass === "ALL") return true;
    return opt.asset_class === filterClass;
  });

  if (loading) {
    return <div className="text-center p-4 text-[12px] text-gray-500 font-mono">⚡ 파생상품 옵션 & 감마 월 로딩 중...</div>;
  }

  return (
    <StrictWidget title="⚡ Options Market & Gamma Walls (파생상품 시장)">
      <div className="p-4 bg-transparent space-y-4 font-sans">
        {!hasLicense ? (
          <div className="text-center py-8">
            <div className="text-3xl mb-3">🔒</div>
            <h4 className="text-[15px] font-bold text-white mb-2">파생상품 시장 접근 권한 없음</h4>
            <p className="text-[13px] text-gray-400 mb-4 max-w-sm mx-auto leading-relaxed">
              기관들의 옵션 헷징 수급, Gamma Wall 및 감마 스퀴즈에 접근하려면 파생상품 옵션 거래 자격증이 필요합니다.
            </p>
            <Link 
              href="/shop" 
              className="inline-flex items-center justify-center rounded bg-[#3182F6] px-5 py-2.5 text-[13px] font-bold text-white hover:bg-[#2b72d6] transition-colors"
            >
              상점에서 자격증 해금하기
            </Link>
          </div>
        ) : (
          <div>
            {/* 1. HTS D-DAY EXPIRATION COUNTDOWN BANNER */}
            <div className="mb-4 p-3.5 rounded-lg border-2 border-red-500/80 bg-red-950/40 text-white flex flex-col sm:flex-row items-center justify-between gap-3 shadow-[0_0_20px_rgba(239,68,68,0.3)] animate-pulse">
              <div className="flex items-center gap-2.5">
                <span className="text-xl">⚠️</span>
                <div>
                  <div className="text-[13px] font-black text-red-400 uppercase tracking-wider">
                    D-DAY 옵션 만기일 비상 결제령
                  </div>
                  <div className="text-[11px] text-gray-300">
                    만기 잔여 시간에 따라 Greeks 감마 폭발 및 강제 반대매매(Liquidation)가 일어납니다.
                  </div>
                </div>
              </div>

              <div className="shrink-0 flex items-center gap-2 bg-black/60 px-3.5 py-1.5 rounded border border-red-500/50 font-mono">
                <span className="text-[11px] text-red-400 font-bold">만기 마감 남은 시간:</span>
                <span className="text-lg font-black text-amber-300 tracking-wider tabular-nums">
                  {countdownStr}
                </span>
              </div>
            </div>

            {/* 2. ROLLOVER TRACKER HTS WIDGET */}
            <div className="mb-4">
              <RolloverTracker 
                data={rolloverState} 
                onExecuteUserRollover={handleExecuteUserRollover} 
              />
            </div>

            {/* 3. GAMMA SQUEEZE ALERT BANNER */}
            {gammaSqueezeNotice && (
              <div className="mb-4 p-3 rounded-lg border border-[#FF453A]/40 bg-[#FF453A]/10 text-[#FF453A] font-bold text-[12px] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span>🔥 GAMMA SQUEEZE ALERT:</span>
                  <span>기관 딜러 델타 매수로 인해 현물 주가 폭등 유발 중!</span>
                </div>
                <span className="text-[10px] bg-[#FF453A]/20 px-2 py-0.5 rounded font-mono">WAG THE DOG</span>
              </div>
            )}

            {/* 4. LIQUIDATION TRADE FEED NOTIFICATION */}
            {liquidations.length > 0 && (
              <div className="mb-4 p-3 rounded-lg border border-purple-500/40 bg-purple-950/30 space-y-1.5">
                <div className="text-[11px] font-black text-purple-300 flex items-center gap-1.5 uppercase">
                  <span>🚨</span>
                  <span>기관 포지션 반대매매 / 마진콜 체결 리포트</span>
                </div>
                <div className="flex flex-wrap gap-2 text-[11px] font-mono">
                  {liquidations.slice(0, 3).map((liq) => (
                    <div key={liq.id} className="bg-purple-900/50 border border-purple-500/50 px-2.5 py-1 rounded text-purple-200 flex items-center gap-1.5">
                      <span className="font-bold text-amber-300">[{liq.type}]</span>
                      <span>{liq.ticker}</span>
                      <span className="font-black text-white">{liq.quantity}계약</span>
                      <span className="text-purple-400">@ ₩{liq.price.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 5. CATEGORY FILTER BAR */}
            <div className="flex items-center gap-2 mb-3 pb-2 border-b border-[#222736] text-[11px] font-bold font-mono">
              <button
                onClick={() => setFilterClass("ALL")}
                className={`px-3 py-1 rounded transition-all cursor-pointer ${
                  filterClass === "ALL" ? "bg-[#3182F6] text-white" : "bg-[#141721] text-gray-400 hover:text-white"
                }`}
              >
                전체 (ALL)
              </button>

              <button
                onClick={() => setFilterClass("IDX")}
                className={`px-3 py-1 rounded transition-all cursor-pointer ${
                  filterClass === "IDX" ? "bg-[#3182F6] text-white" : "bg-[#141721] text-gray-400 hover:text-white"
                }`}
              >
                📈 지수 (IDX)
              </button>

              <button
                onClick={() => setFilterClass("STK")}
                className={`px-3 py-1 rounded transition-all cursor-pointer ${
                  filterClass === "STK" ? "bg-[#3182F6] text-white" : "bg-[#141721] text-gray-400 hover:text-white"
                }`}
              >
                🏢 개별주 (STK)
              </button>

              <button
                onClick={() => setFilterClass("FUT")}
                className={`px-3 py-1 rounded transition-all cursor-pointer ${
                  filterClass === "FUT" ? "bg-[#3182F6] text-white" : "bg-[#141721] text-gray-400 hover:text-white"
                }`}
              >
                🛢️ 선물 (FUT)
              </button>
            </div>
            
            {/* 6. OPTIONS CONTRACTS TABLE WITH ITM / OTM VISUAL SHIFT */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[12px]">
                <thead>
                  <tr className="border-b border-[#222736] text-gray-500 font-mono text-[11px]">
                    <th className="py-2.5 font-semibold">표준 티커 (Ticker)</th>
                    <th className="py-2.5 font-semibold">구분</th>
                    <th className="py-2.5 font-semibold text-right">행사가 (Strike)</th>
                    <th className="py-2.5 font-semibold text-right">프리미엄</th>
                    <th className="py-2.5 font-semibold text-right">미결제약정 (OI)</th>
                    <th className="py-2.5 font-semibold text-center">행사 상태</th>
                    <th className="py-2.5 font-semibold text-center">주문</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#222736]">
                  {filteredOptions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-gray-500 text-[12px]">
                        해당 카테고리의 옵션 계약이 없습니다.
                      </td>
                    </tr>
                  ) : (
                    filteredOptions.map((opt: any) => {
                      const isCall = opt.option_type === 'CALL';
                      const strike = Number(opt.strike_price);

                      const isITM = isCall ? spotPrice > strike : spotPrice < strike;
                      const isATM = Math.abs(spotPrice - strike) / strike < 0.02;
                      const isOTM = !isITM && !isATM;

                      const isGammaWall = opt.open_interest >= 8000;

                      return (
                        <tr 
                          key={opt.id} 
                          className={`transition-colors ${
                            isITM 
                              ? "bg-emerald-950/20 border-l-2 border-emerald-500" 
                              : isOTM 
                              ? "opacity-60 hover:opacity-100" 
                              : "bg-amber-950/20 border-l-2 border-amber-500"
                          }`}
                        >
                          <td className="py-2.5 font-mono text-[11px] font-bold text-white">
                            {opt.ticker || `STK-${ticker}-${opt.option_type[0]}${opt.strike_price}`}
                          </td>

                          <td className="py-2.5">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-black ${
                              isCall ? 'bg-red-500/20 text-[#FF453A]' : 'bg-blue-500/20 text-[#0A84FF]'
                            }`}>
                              {opt.option_type}
                            </span>
                          </td>

                          <td className="py-2.5 font-mono text-right font-medium text-white tabular-nums">
                            ₩{strike.toLocaleString()}
                          </td>

                          <td className="py-2.5 font-mono text-right font-bold text-amber-300 tabular-nums">
                            ₩{Number(opt.current_price || 1000).toLocaleString()}
                          </td>

                          <td className="py-2.5 font-mono text-right text-white tabular-nums">
                            {fmtVolume(opt.open_interest)}
                            {isGammaWall && (
                              <span className="ml-1.5 px-1 py-0.2 text-[9px] bg-yellow-500/20 text-yellow-400 font-black rounded border border-yellow-500/40">
                                🔥 WALL
                              </span>
                            )}
                          </td>

                          <td className="py-2.5 text-center font-bold text-[11px]">
                            {isITM && (
                              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                                🟢 ITM (내가격)
                              </span>
                            )}
                            {isATM && (
                              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse">
                                🎯 ATM (핀 위치)
                              </span>
                            )}
                            {isOTM && (
                              <span className="px-2 py-0.5 rounded bg-gray-800/60 text-gray-500 border border-gray-700">
                                🗑️ OTM (휴지통)
                              </span>
                            )}
                          </td>

                          <td className="py-2.5 text-center">
                            <button
                              onClick={() => handleTradeOption(opt)}
                              className="px-2.5 py-1 text-[11px] font-bold bg-[#3182F6] hover:bg-[#2b72d6] text-white rounded transition-all cursor-pointer"
                            >
                              매수
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </StrictWidget>
  );
}
