import { createClient } from '@/lib/supabase/client';
import { OptionsEngine } from './OptionsEngine';
import { globalRealtimeGateway } from './RealtimeGateway';
import { Order } from './types';

// 인메모리 FIFO 매칭엔진 싱글톤 (세션 내 누적)
const _optionsEngineSingleton = typeof window !== 'undefined' ? new OptionsEngine() : null;
function getOptionsEngine(): OptionsEngine {
  if (!_optionsEngineSingleton) return new OptionsEngine();
  return _optionsEngineSingleton;
}

export interface OptionContract {
  id: string;
  underlying_stock_id: string;
  ticker: string;
  asset_class: 'IDX' | 'STK' | 'FUT';
  underlying_symbol: string;
  option_type: 'CALL' | 'PUT';
  strike_price: number;
  current_price: number;
  open_interest: number;
  volume: number;
  delta: number;
  gamma: number;
  theta: number;
  implied_volatility: number;
  expiry_date: string;
}

export interface LiquidationEvent {
  id: string;
  ticker: string;
  side: 'BUY' | 'SELL';
  price: number;
  quantity: number;
  type: 'LIQUIDATION' | 'PINNING' | 'ROLLOVER';
  timestamp: string;
}

export interface RolloverFeedItem {
  id: string;
  institution: string;
  currTicker: string;
  nextTicker: string;
  quantity: number;
  spread: number;
  timestamp: string;
}

export interface RolloverTrackerState {
  spread: number;
  spreadState: 'CONTANGO' | 'BACKWARDATION';
  npsProgress: number; // 국민연금
  blackrockProgress: number; // 블랙록
  citadelProgress: number; // 시타델
  npsContracts: string;
  blackrockContracts: string;
  citadelContracts: string;
  rolloverFeeds: RolloverFeedItem[];
}

/**
 * Standard Bloomberg-style Option Ticker Formatter
 */
export function formatOptionTicker(
  assetClass: 'IDX' | 'STK' | 'FUT',
  underlyingSymbol: string,
  expiryDate: Date,
  optionType: 'CALL' | 'PUT',
  strikePrice: number
): string {
  const yy = String(expiryDate.getFullYear()).slice(-2);
  const mm = String(expiryDate.getMonth() + 1).padStart(2, '0');
  const typeChar = optionType === 'CALL' ? 'C' : 'P';
  const cleanSymbol = underlyingSymbol.toUpperCase().replace(/\s+/g, '');
  return `${assetClass}-${cleanSymbol}-${yy}${mm}-${typeChar}${strikePrice}`;
}

/**
 * Option Greeks Calculator with Expiry Sensitivity Explosion (T -> 0)
 */
export function calculateGreeksWithExpiry(
  spotPrice: number,
  strikePrice: number,
  optionType: 'CALL' | 'PUT',
  daysToExpiry: number,
  volatility = 0.25
) {
  const isCall = optionType === 'CALL';
  const diffPct = (spotPrice - strikePrice) / strikePrice;
  const T = Math.max(0.001, daysToExpiry / 365);

  let delta = isCall ? 0.50 + (diffPct / Math.sqrt(T)) : 0.50 - (diffPct / Math.sqrt(T));
  delta = Math.max(0.01, Math.min(0.99, delta));

  const isATM = Math.abs(diffPct) < 0.03;
  const gammaMultiplier = isATM ? (1 / Math.sqrt(T)) * 0.1 : 0.05;
  const gamma = Math.min(0.99, Math.max(0.01, gammaMultiplier));

  const thetaDecay = isATM ? -0.80 / Math.sqrt(T) : -0.20 / T;
  const theta = Math.min(-0.01, Math.max(-10.0, thetaDecay));
  const iv = Math.max(0.15, volatility + (1 / (T + 0.1)) * 0.05);

  return {
    delta: Number(delta.toFixed(4)),
    gamma: Number(gamma.toFixed(4)),
    theta: Number(theta.toFixed(4)),
    implied_volatility: Number(iv.toFixed(4)),
    isATM,
    isITM: isCall ? spotPrice > strikePrice : spotPrice < strikePrice,
    isOTM: isCall ? spotPrice < strikePrice : spotPrice > strikePrice
  };
}

/**
 * 50 Institution Bots Options Simulation Engine
 * Handles Rollover Spread, Contango/Backwardation, Institution Progress Bars & Live Rollover Feeds
 */
export async function runOptionBotTradingEngine(stockId: string, underlyingSymbol: string, currentSpotPrice: number) {
  const supabase = createClient();

  const { data: existingOptions } = await supabase
    .from('options_contracts')
    .select('*')
    .eq('underlying_stock_id', stockId);

  let contracts: OptionContract[] = existingOptions || [];

  const now = new Date();
  const expiryDate = new Date();
  expiryDate.setHours(15, 30, 0, 0);

  const diffMs = expiryDate.getTime() - now.getTime();
  const hoursToExpiry = Math.max(0.1, diffMs / (1000 * 60 * 60));
  const daysToExpiry = hoursToExpiry / 24;

  const isDDay = hoursToExpiry <= 8;
  const isPinningPhase = hoursToExpiry <= 1.0;
  const isLiquidationPhase = hoursToExpiry <= 0.5;

  // Seed default contracts if empty
  if (contracts.length === 0) {
    const baseStrike = Math.round(currentSpotPrice / 1000) * 1000 || 50000;
    const strikes = [
      Math.round(baseStrike * 0.85),
      Math.round(baseStrike * 0.95),
      baseStrike,
      Math.round(baseStrike * 1.05),
      Math.round(baseStrike * 1.15)
    ];

    const newContractsToInsert = [];

    for (const strike of strikes) {
      for (const type of ['CALL', 'PUT'] as const) {
        const assetClass: 'IDX' | 'STK' | 'FUT' = underlyingSymbol.includes('KOSPI') || underlyingSymbol.includes('INDEX') 
          ? 'IDX' 
          : (underlyingSymbol.includes('WTI') || underlyingSymbol.includes('GOLD') ? 'FUT' : 'STK');

        const ticker = formatOptionTicker(assetClass, underlyingSymbol, expiryDate, type, strike);
        const greeks = calculateGreeksWithExpiry(currentSpotPrice, strike, type, daysToExpiry);
        const estPrice = Math.max(200, Math.round(Math.abs(currentSpotPrice - strike) * 0.1 + 1000));

        newContractsToInsert.push({
          underlying_stock_id: stockId,
          ticker,
          asset_class: assetClass,
          underlying_symbol: underlyingSymbol,
          option_type: type,
          strike_price: strike,
          current_price: estPrice,
          open_interest: Math.floor(Math.random() * 3000) + 1000,
          volume: Math.floor(Math.random() * 500) + 50,
          delta: greeks.delta,
          gamma: greeks.gamma,
          theta: greeks.theta,
          implied_volatility: greeks.implied_volatility,
          expiry_date: expiryDate.toISOString()
        });
      }
    }

    const { data: insertedData } = await supabase
      .from('options_contracts')
      .insert(newContractsToInsert)
      .select('*');

    if (insertedData) {
      contracts = insertedData as OptionContract[];
    }
  }

  let gammaSqueezeTriggered = false;
  let pinningStrike: number | null = null;
  let targetPriceDelta = 0;

  const liquidationEvents: LiquidationEvent[] = [];
  const engine = getOptionsEngine();
  const gateway = globalRealtimeGateway;

  for (const contract of contracts) {
    const isCall = contract.option_type === 'CALL';
    const greeks = calculateGreeksWithExpiry(currentSpotPrice, contract.strike_price, contract.option_type, daysToExpiry);

    let newPrice = contract.current_price;
    if (greeks.isOTM && isDDay) {
      newPrice = Math.max(50, Math.round(contract.current_price * 0.7));
    } else if (greeks.isITM) {
      newPrice = Math.max(500, Math.round(Math.abs(currentSpotPrice - contract.strike_price) + 200));
    }

    const randomVol = Math.floor(Math.random() * 400) + 100;
    const newOI = contract.open_interest + randomVol;
    if (isCall && newOI > 8000 && contract.strike_price >= currentSpotPrice) {
      gammaSqueezeTriggered = true;
      targetPriceDelta += currentSpotPrice * 0.04;
    }

    // ─── [FIX] FIFO 매칭엔진에 봇 주문 주입 ───────────────────────────
    const botSide: 'BUY' | 'SELL' = isCall ? 'BUY' : 'SELL';
    const isLiqTrigger = isLiquidationPhase && Math.random() < 0.4;
    const botOrder: Order = {
      id: `BOT-${contract.id}-${Date.now()}`,
      botId: `INST-BOT-${Math.floor(Math.random() * 50) + 1}`,
      contractTicker: contract.ticker,
      side: botSide,
      type: isLiqTrigger ? 'LIQUIDATION' : (Math.random() > 0.3 ? 'LIMIT' : 'MARKET'),
      price: isLiqTrigger ? 0 : newPrice,
      quantity: Math.floor(Math.random() * 200) + 50,
      filledQuantity: 0,
      timestamp: Date.now()
    };

    const book = engine.getOrCreateBook(contract.ticker);
    const trades = book.processOrder(botOrder);

    // 체결된 Trade를 RealtimeGateway로 브로드캐스팅
    if (gateway) {
      trades.forEach(trade => {
        gateway.broadcastTrade({
          tradeId: trade.tradeId,
          ticker: trade.contractTicker,
          price: trade.price,
          quantity: trade.quantity,
          side: botSide,
          isLiquidation: trade.isLiquidation,
          timestamp: trade.timestamp
        });
      });

      // 호가창 10호가 스냅샷을 버퍼에 기록 (100ms 배치 전송)
      const simulatedBids: [number, number][] = Array.from({ length: 5 }, (_, i) => [
        Math.round(newPrice * (1 - 0.002 * (i + 1))),
        Math.floor(Math.random() * 500) + 100
      ]);
      const simulatedAsks: [number, number][] = Array.from({ length: 5 }, (_, i) => [
        Math.round(newPrice * (1 + 0.002 * (i + 1))),
        Math.floor(Math.random() * 500) + 100
      ]);
      gateway.updateOrderBookBuffer(contract.ticker, simulatedBids, simulatedAsks);
    }
    // ──────────────────────────────────────────────────────────────────

    if (isPinningPhase && greeks.isATM) {
      pinningStrike = contract.strike_price;
      liquidationEvents.push({
        id: `pin-${contract.id}`,
        ticker: contract.ticker,
        side: isCall ? 'BUY' : 'SELL',
        price: newPrice,
        quantity: Math.floor(Math.random() * 300) + 100,
        type: 'PINNING',
        timestamp: new Date().toLocaleTimeString()
      });
    }

    if (isLiqTrigger) {
      liquidationEvents.push({
        id: `liq-${contract.id}`,
        ticker: contract.ticker,
        side: botSide,
        price: newPrice,
        quantity: botOrder.quantity,
        type: 'LIQUIDATION',
        timestamp: new Date().toLocaleTimeString()
      });
    }

    await supabase
      .from('options_contracts')
      .update({
        open_interest: newOI,
        volume: contract.volume + randomVol,
        current_price: newPrice,
        delta: greeks.delta,
        gamma: greeks.gamma,
        theta: greeks.theta,
        implied_volatility: greeks.implied_volatility
      })
      .eq('id', contract.id);
  }

  // Calculate Rollover Spread & Contango / Backwardation
  const sampleCurrPrice = contracts[0]?.current_price || 3500;
  const sampleNextPrice = sampleCurrPrice + (Math.random() > 0.4 ? 450 : -350); // Simulated next month price
  const rolloverSpread = sampleNextPrice - sampleCurrPrice;
  const spreadState: 'CONTANGO' | 'BACKWARDATION' = rolloverSpread >= 0 ? 'CONTANGO' : 'BACKWARDATION';

  // Rollover Tracker Institutions Progress
  const npsProgress = 70;
  const blackrockProgress = 100;
  const citadelProgress = 15;

  const symbolTag = underlyingSymbol.toUpperCase();
  const currTick = `IDX-${symbolTag}-2607-C350`;
  const nextTick = `IDX-${symbolTag}-2608-C350`;

  const rolloverFeeds: RolloverFeedItem[] = [
    {
      id: "rf-1",
      institution: "국민연금 (NPS)",
      currTicker: currTick,
      nextTicker: nextTick,
      quantity: 2000,
      spread: rolloverSpread,
      timestamp: new Date().toLocaleTimeString()
    },
    {
      id: "rf-2",
      institution: "블랙록 (BlackRock)",
      currTicker: `STK-${symbolTag}-2607-C300`,
      nextTicker: `STK-${symbolTag}-2608-C300`,
      quantity: 5000,
      spread: rolloverSpread + 100,
      timestamp: new Date(Date.now() - 45000).toLocaleTimeString()
    }
  ];

  const rolloverTrackerState: RolloverTrackerState = {
    spread: rolloverSpread,
    spreadState,
    npsProgress,
    blackrockProgress,
    citadelProgress,
    npsContracts: "14,000 / 20,000 계약",
    blackrockContracts: "35,000 / 35,000 계약 (완료)",
    citadelContracts: "1,500 / 10,000 계약 (청산 유력)",
    rolloverFeeds
  };

  // ─── [FIX] 롤오버 피드를 RealtimeGateway로 브로드캐스팅 ────────────
  if (gateway) {
    rolloverFeeds.forEach(feed => {
      gateway.broadcastRollover({
        comboId: feed.id,
        botId: feed.institution,
        closeTicker: feed.currTicker,
        openTicker: feed.nextTicker,
        quantity: feed.quantity,
        executedSpread: feed.spread,
        timestamp: Date.now()
      });
    });
  }
  // ─────────────────────────────────────────────────────────────────

  if (pinningStrike !== null && isPinningPhase) {
    const pinDelta = (pinningStrike - currentSpotPrice) * 0.3;
    targetPriceDelta += pinDelta;
  }

  if (targetPriceDelta !== 0) {
    const { data: stock } = await supabase.from('stocks').select('current_price, target_price').eq('id', stockId).single();
    if (stock) {
      const newSpot = Math.max(100, Math.round(stock.current_price + targetPriceDelta));
      await supabase
        .from('stocks')
        .update({
          current_price: newSpot,
          high: Math.max(newSpot, stock.current_price)
        })
        .eq('id', stockId);
    }
  }

  return {
    success: true,
    isDDay,
    hoursToExpiry,
    gammaSqueezeTriggered,
    pinningStrike,
    liquidationEvents,
    rolloverTrackerState,
    contractsCount: contracts.length
  };
}

/**
 * Option Expiration Cash Settlement & Zero-out Processor
 */
export async function processOptionExpiration(stockId: string, finalSpotPrice: number) {
  const supabase = createClient();
  const { data, error } = await supabase.rpc('settle_options_expiration', {
    p_stock_id: stockId,
    p_final_spot_price: finalSpotPrice
  });

  if (error) {
    console.error("Error processing option expiration:", error);
    return 0;
  }
  return data;
}
