import { LP_CONFIG, TRILLION } from "./config";
import { generateAccounts } from "./accounts";
import { getInstitution } from "./institution";
import { getGammaEngine } from "./gamma-squeeze";
import { getLiquiditySweepEngine } from "./liquidity-sweep";
import { MatchingEngine } from "./MatchingEngine";
import type { LPAccount, LPState, StockMeta, AlgoPattern, Order, TradeRecord } from "./types";
import type { OrderBook, OrderBookLevel, SectorImpact, Stock } from "@/lib/types";

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 국내주식 및 파생상품 호가 가격 단위 계산기
export function getTickSize(price: number, market: string): number {
  if (market === "overseas" || market === "europe") {
    // 미국/유럽 주식은 기본적으로 0.01 단위 (1센트)
    return 0.01;
  }
  if (market !== "domestic" && market !== "options") {
    // 그 외는 기존 비율 적용
    return Math.max(price * 0.0008, 0.01);
  }

  // 국내주식 & 파생상품(옵션 등) 호가단위
  if (price < 2000) return 1;
  if (price < 5000) return 5;
  if (price < 20000) return 10;
  if (price < 50000) return 50;
  if (price < 200000) return 100;
  if (price < 500000) return 500;
  return 1000;
}

// 주가를 호가단위에 스냅하는 헬퍼
export function snapToTick(price: number, tickSize: number): number {
  return Math.round(price / tickSize) * tickSize;
}

export class LPEngine {
  accounts: LPAccount[];
  states: Map<string, LPState> = new Map();
  meta: Map<string, StockMeta> = new Map();
  pendingNews: SectorImpact[] = [];
  marketDropPct: number = 0; // 전체 시장 하락률 (DEFENDER 발동용)
  baseRate: number = 3.50; // 중앙은행 기준금리 (%) — 어드민이 조작
  emergencyClosed: boolean = false;
  activeEventIsNovel: boolean = false;

  // 글로벌 섹터 순환매 (Rebalancing) 상태
  activeSectorRotation: {
    fromSector: string;
    toSector: string;
    strength: number;
    ticksRemaining: number;
  } | null = null;
  rotationCooldown: number = 15;
  lastRotationUpdate: number = 0;

  private updateSectorRotation(rng: () => number) {
    const now = Date.now();
    // 2초(LP_CONFIG.tickInterval)마다 단 한 번만 글로벌 상태를 갱신
    if (now - this.lastRotationUpdate < 1900) {
      return;
    }
    this.lastRotationUpdate = now;

    // 만약 뉴스가 활성화 중이면 순환매 중지 및 쿨타임 초기화
    if (this.pendingNews.length > 0) {
      this.activeSectorRotation = null;
      this.rotationCooldown = 25;
      return;
    }

    if (this.activeSectorRotation) {
      this.activeSectorRotation.ticksRemaining--;
      if (this.activeSectorRotation.ticksRemaining <= 0) {
        this.activeSectorRotation = null;
        this.rotationCooldown = Math.floor(rng() * 25) + 20; // 20~45틱 쿨다운
      }
    } else {
      if (this.rotationCooldown > 0) {
        this.rotationCooldown--;
      } else {
        // 쿨다운 해제 시 12% 확률로 순환매 작동
        if (rng() < 0.12) {
          const sectors = Array.from(
            new Set(Array.from(this.meta.values()).map((m) => m.sector))
          ).filter(Boolean);

          if (sectors.length >= 2) {
            const fromIdx = Math.floor(rng() * sectors.length);
            let toIdx = Math.floor(rng() * sectors.length);
            while (toIdx === fromIdx) {
              toIdx = Math.floor(rng() * sectors.length);
            }
            const fromSector = sectors[fromIdx];
            const toSector = sectors[toIdx];

            this.activeSectorRotation = {
              fromSector,
              toSector,
              strength: +(0.04 + rng() * 0.08).toFixed(3), // 4% ~ 12% 가격 타겟 변동폭
              ticksRemaining: Math.floor(rng() * 20) + 20, // 20~40틱 지속
            };
          }
        }
      }
    }
  }

  public priceLimits: Record<MarketId, number | null> = {
    domestic: 0.3, // 상하한가 30%
    overseas: null, // 무제한
    europe: null,
    bonds: null,
    options: null,
    commodities: null,
    etf: 0.3,
  };

  constructor() {
    this.accounts = generateAccounts();
  }

  setPriceLimit(market: MarketId, limit: number | null) {
    if (this.priceLimits[market] !== undefined) {
      this.priceLimits[market] = limit;
    }
  }

  registerStock(stock: Stock, meta: StockMeta) {
    this.meta.set(stock.id, meta);
    this.states.set(stock.id, {
      targetPrice: stock.targetPrice,
      currentPrice: stock.currentPrice,
      velocity: 0,
      newsImpact: 0,
      newsDecay: 0,
    });

    // 감마스퀴즈 엔진 초기화
    const gamma = getGammaEngine();
    gamma.initStock(meta, stock.currentPrice, this.accounts);

    // 리퀴디티스윕 엔진 초기화
    const sweep = getLiquiditySweepEngine();
    sweep.initStock(meta, stock.currentPrice);

    // 시뮬레이션 현실감을 위해 초기 상장(Register) 시점에 활성 계좌들에게 일정량의 주식을 랜덤하게 분배 (초기 보유량)
    const activeAccounts = this.getActiveAccounts(stock, meta);
    
    // 해외 주식은 시가총액이 원화(환율적용)로 계산되므로, baseSize 산출 시 환율 보정이 필요합니다. (엔진 로직과 동일하게 맞춤)
    const exRate = stock.market === "overseas" || stock.market === "commodities" ? 1350 : stock.market === "europe" ? 1450 : 1;
    const baseSize = Math.max(1, Math.floor((meta.marketCap * exRate) / stock.currentPrice / 100_000));
    
    const totalShares = Math.floor((meta.marketCap * exRate) / stock.currentPrice);
    
    for (const acc of activeAccounts) {
      if (!acc.isRealUser && acc.botStyle !== "LIQUIDITY_PROVIDER") {
        let qty = 0;
        
        if (acc.investorCategory === "INST_PENSION" && stock.market === "domestic") {
          // 국민연금: 현실 고증하여 국내 상위 기업 지분의 약 5%~7%를 들고 시작
          qty = Math.floor(totalShares * (0.05 + Math.random() * 0.02));
        } else if (Math.random() < 0.4) {
          qty = Math.floor(baseSize * (Math.random() * 50 + 10));
        }

        if (qty > 0) {
          let cost = qty * stock.currentPrice;
          
          // 포트폴리오 목표 비중(stockMax)을 고려하여 총 주식 투자 한도 설정
          const stockMaxPct = acc.allocation?.stockMax || 80;
          // 국민연금의 경우 국내 주식은 15% 한도 적용 (그 외는 자신의 stockMax 활용)
          const targetPct = (acc.investorCategory === "INST_PENSION" && stock.market === "domestic") ? 15 : stockMaxPct;
          const stockLimit = acc.capital * (targetPct / 100);
          
          let currentHoldingsValue = 0;
          for (const sId in acc.holdings) {
            currentHoldingsValue += acc.holdings[sId].quantity * acc.holdings[sId].avgPrice;
          }
          
          if (currentHoldingsValue + cost > stockLimit) {
            cost = Math.max(0, stockLimit - currentHoldingsValue);
            qty = Math.floor(cost / stock.currentPrice);
            cost = qty * stock.currentPrice;
          }

          if (acc.cash < cost) {
            // 보유 현금이 부족하면 살 수 있는 만큼만 매수 (마이너스 방지)
            qty = Math.floor(acc.cash / stock.currentPrice);
            cost = qty * stock.currentPrice;
          }
          
          if (qty > 0) {
            acc.holdings[stock.id] = {
              quantity: qty,
              lockedQuantity: 0,
              avgPrice: stock.currentPrice * (0.8 + Math.random() * 0.4)
            };
            acc.cash -= cost;
          }
        }
      }
    }
  }

  /**
   * 기준금리 충격 (Interest Rate Shock)
   * 금리 인상 → 채권 가격 하락, 금리 인하 → 채권 가격 상승
   * @param direction 'hike' | 'cut'
   * @param bps basis points (100bps = 1%)
   */
  applyInterestRateShock(direction: "hike" | "cut", bps: number = 25) {
    const changePct = (bps / 100) / 100; // bps → 소수력 상승/하락품
    this.baseRate += direction === "hike" ? bps / 100 : -(bps / 100);
    this.baseRate = Math.max(0.25, Math.round(this.baseRate * 100) / 100);
    
    for (const [stockId, state] of this.states) {
      const meta = this.meta.get(stockId);
      if (!meta) continue;
      if (meta.market === "bonds") {
        // 채권 가격 ↔ 금리 역상관관계
        // 금리 인상시 채권 만기 길수록 가격 충격 큼집 (Duration risk)
        // 변동폭 산정: duration 약 8~9년 기준 변동 -~7% per 100bps hike
        const impact = direction === "hike" ? -(changePct * 7) : (changePct * 7);
        state.targetPrice = state.currentPrice * (1 + impact);
        state.newsImpact = direction === "hike" ? -0.5 : 0.5;
        state.newsDecay = 0.95;
      }
    }
  }

  onNews(impacts: SectorImpact[], isNovelEvent: boolean = false) {
    this.pendingNews = impacts;
    this.activeEventIsNovel = isNovelEvent;

    if (this.emergencyClosed) return;

    // 1. Calculate expected market-cap weighted index change across all stocks (without scaling)
    let weightedExpectedChange = 0;
    let totalCap = 0;
    
    // We use a local seed-based RNG to keep calculation deterministic per event call
    const rng = mulberry32(12345);

    for (const [stockId, state] of this.states) {
      const meta = this.meta.get(stockId);
      if (!meta) continue;

      const matched = impacts.find(
        (i) => i.sector === meta.sector || meta.sector.includes(i.sector),
      );
      let expectedChange = 0;
      if (matched) {
        expectedChange = (matched.score / 10) * meta.relevanceWeight * 0.15;
      } else {
        expectedChange = (rng() - 0.5) * 0.02; // small normal noise
      }
      weightedExpectedChange += expectedChange * meta.marketCap;
      totalCap += meta.marketCap;
    }

    const expectedIndexChange = totalCap > 0 ? weightedExpectedChange / totalCap : 0;

    // 2. Check for emergency closure if it is a novel event (index drop <= -30%)
    if (isNovelEvent && expectedIndexChange <= -0.30) {
      this.emergencyClosed = true;
      return;
    }

    // 3. Apply expected changes to target prices of individual stocks WITHOUT scaling!
    // Individual stocks can move freely and dynamically based on their raw scores.
    for (const [stockId, state] of this.states) {
      const meta = this.meta.get(stockId);
      if (!meta) continue;

      const matched = impacts.find(
        (i) => i.sector === meta.sector || meta.sector.includes(i.sector),
      );
      if (matched) {
        const pctChange = (matched.score / 10) * meta.relevanceWeight * 0.15;
        state.targetPrice = state.currentPrice * (1 + pctChange);
        state.newsImpact = matched.score / 10;
        state.newsDecay = 0.92;
      }
    }

    // 4. Update marketDropPct (for DEFENDER algorithm)
    let totalDrop = 0;
    let count = 0;
    for (const [, state] of this.states) {
      if (state.newsImpact < 0) {
        totalDrop += state.newsImpact;
        count++;
      }
    }
    this.marketDropPct = count > 0 ? Math.abs(totalDrop / count) * 10 : 0;
  }

  tick(stock: Stock): { price: number; orderBook: OrderBook; trades: { price: number; size: number; side: "buy" | "sell" }[]; session: "PRE" | "REGULAR" | "AFTER" | "CLOSED" } {
    const state = this.states.get(stock.id);
    const meta = this.meta.get(stock.id);
    if (!state || !meta) {
      return { price: stock.currentPrice, orderBook: { asks: [], bids: [], spread: 0 }, trades: [], session: "CLOSED" };
    }

    const nowTime = new Date();
    const kstHours = (nowTime.getUTCHours() + 9) % 24;
    const currentStr = `${String(kstHours).padStart(2, "0")}:${String(nowTime.getUTCMinutes()).padStart(2, "0")}`;
    
    let session: "PRE" | "REGULAR" | "AFTER" | "CLOSED" = "CLOSED";
    
    if (stock.market === "domestic") {
      if (currentStr >= "08:00" && currentStr < "08:50") session = "PRE";
      else if (currentStr >= "09:00" && currentStr < "15:30") session = "REGULAR";
      else if (currentStr >= "15:30" && currentStr < "20:00") session = "AFTER";
    } else {
      // overseas, etf 등 나머지
      if (currentStr >= "17:00" && currentStr < "23:30") session = "PRE";
      else if (currentStr >= "23:30" || currentStr < "06:00") session = "REGULAR";
      else if (currentStr >= "06:00" && currentStr < "09:00") session = "AFTER";
    }

    if (!state.matchingEngine) {
      state.matchingEngine = new MatchingEngine(state.currentPrice);
      // 초기화 시에도 필터링된 activeAccounts만 참여하여 고아 주문(메모리 릭) 생성 방지
      const initialActive = this.getActiveAccounts(stock, meta);
      this.runBots(stock, state, meta, initialActive, () => Math.random(), session);
    }

    if (this.emergencyClosed || session === "CLOSED") {
      if (!state.lastOrderBook) {
        state.lastOrderBook = state.matchingEngine.getAggregatedBook(state.currentPrice, getTickSize(state.currentPrice, stock.market), LP_CONFIG.orderBookLevels);
      }
      return { price: state.currentPrice, orderBook: state.lastOrderBook, trades: [], session };
    }

    // 0. Update current price based on last trade BEFORE bots run
    if (state.matchingEngine.lastPrice > 0) {
      state.currentPrice = snapToTick(state.matchingEngine.lastPrice, getTickSize(state.matchingEngine.lastPrice, stock.market));
    }

    const rng = mulberry32(hashStr(stock.id) + Math.floor(Date.now() / LP_CONFIG.tickInterval));

    // 1. 세력 tick
    const institution = getInstitution();
    let instPriceModifier = 0;
    let instOrders: { side: "buy" | "sell"; price: number; size: number; isWall: boolean }[] = [];
    let instTrades: { side: "buy" | "sell"; price: number; size: number }[] = [];

    if (institution.targetStockId === stock.id) {
      const instResult = institution.tick(state.currentPrice);
      instPriceModifier = instResult.priceModifier;
      instOrders = instResult.orders;
      instTrades = instResult.trades;
    }

    // 2. 종목에 활동하는 계좌들 필터링 (시장 집중도 + 섹터 편향)
    const activeAccounts = this.getActiveAccounts(stock, meta);

    // 글로벌 섹터 로테이션 업데이트
    this.updateSectorRotation(rng);

    // 섹터 순환매 (Rebalancing) 적용 (뉴스가 없을 때만)
    const isRotating = this.activeSectorRotation && Math.abs(state.newsImpact) < 0.05;
    if (isRotating && this.activeSectorRotation) {
      const rotation = this.activeSectorRotation;
      const isTargetSector = (sec: string) => sec === meta.sector || meta.sector.includes(sec);
      if (isTargetSector(rotation.toSector)) {
        state.targetPrice = state.currentPrice * (1 + rotation.strength);
        state.newsImpact = rotation.strength;
        state.newsDecay = 0.95;
      } else if (isTargetSector(rotation.fromSector)) {
        state.targetPrice = state.currentPrice * (1 - rotation.strength);
        state.newsImpact = -rotation.strength;
        state.newsDecay = 0.95;
      }
    }

    // 2.5 감마스퀴즈 + 리퀴디티스윕 계산
    const gammaEngine = getGammaEngine();
    const gammaResult = gammaEngine.tick(meta, state.currentPrice);

    const sweepEngine = getLiquiditySweepEngine();
    const sweepResult = sweepEngine.tick(stock, meta, state.currentPrice, activeAccounts);

    // 3. 봇 동작 (유동성 공급 및 시장가 체결)
    // 봇들이 자체 targetPrice와 currentPrice의 괴리(gap)를 보고 판단하여 주문을 넣습니다.
    this.runBots(stock, state, meta, activeAccounts, rng, session);
    this.runRetailBots(stock, state, meta, activeAccounts, rng, session);

    // 4. 세력 주문 병합 (인위적 개입, 필요시)
    if (instOrders.length > 0) {
      for (const io of instOrders) {
        state.matchingEngine.addOrder({ accountId: "INST", accountType: "MACRO", side: io.side, type: "limit", price: io.price, size: io.size });
      }
    }

    // 6. 감마스퀴즈 강제 매수 체결 추가
    if (gammaResult.forcedBuyVolume > 0) {
      state.matchingEngine.addOrder({ accountId: "GAMMA", accountType: "MACRO", side: "buy", type: "market", price: 0, size: Math.floor(gammaResult.forcedBuyVolume) });
    }

    // 7. 리퀴디티스윕 체결 추가
    for (const t of sweepResult.trades) {
      state.matchingEngine.addOrder({ accountId: "SWEEP", accountType: "MACRO", side: t.side, type: "market", price: 0, size: Math.floor(t.size) });
    }

    const tick = getTickSize(state.currentPrice, stock.market);
    const orderBook = state.matchingEngine.getAggregatedBook(state.currentPrice, tick, LP_CONFIG.orderBookLevels);
    state.lastOrderBook = orderBook;
    
    // 가져온 후 누적된 trades 비우기 (새로운 체결만 전달)
    let trades = [...state.matchingEngine.trades];
    state.matchingEngine.trades = [];

    // 세력 내부 자전거래(instTrades)는 장외거래 취급
    trades = [...instTrades, ...trades];

    // 8. 정산 (현금 및 보유주식 이동)
    this.processSettlement(trades, stock.id);

    // 9. 잠긴 자산(Locked) 동기화
    this.syncLockedAssets(state.matchingEngine, stock.id);

    return { price: state.currentPrice, orderBook, trades, session };
  }

  private runBots(
    stock: Stock,
    state: LPState,
    meta: StockMeta,
    accounts: LPAccount[],
    rng: () => number,
    session: "PRE" | "REGULAR" | "AFTER" | "CLOSED" = "REGULAR"
  ) {
    const engine: MatchingEngine = state.matchingEngine;
    const tick = getTickSize(state.currentPrice, stock.market);

    let volumeScale = 1.0;
    if (session !== "REGULAR") {
      volumeScale = Math.abs(state.newsImpact) > 0.1 ? 0.4 : 0.05;
    }
    let exchangeRate = 1;
    if (stock.market === "overseas" || stock.market === "commodities" || stock.market === "options") {
      exchangeRate = 1350; // USD 환율 적용
    } else if (stock.market === "europe") {
      exchangeRate = 1450; // EUR 환율 적용
    }
    const impliedShares = meta.marketCap / (state.currentPrice * exchangeRate);
    const baseSize = Math.max(1, Math.floor(impliedShares * 0.005 / 234000 * 50));

    const now = Date.now();
    const isFirstRun = engine.asks.length === 0 && engine.bids.length === 0;
    
    const bestAsk = engine.asks[0]?.price || state.currentPrice + tick;
    const bestBid = engine.bids[0]?.price || state.currentPrice - tick;
    
    // 세션별 MM 조정(Refresh) 민감도
    const maxSpread = session === "REGULAR" ? tick * 2 : tick * 10;
    // 정규장에서는 활발히 호가를 재조정하지만, 심야 장전 시간에는 특별한 이유(유동성 고갈)가 없으면 호가를 그대로 방치(0.0001 확률)
    const mmRefreshProb = session === "REGULAR" ? 0.05 : 0.0001;
    
    const needsLiquidity = engine.asks.length < 5 || engine.bids.length < 5 || (bestAsk - bestBid) > maxSpread;

    let upperLimit = Infinity;
    let lowerLimit = 0;
    if (stock.market === "domestic") {
      // 상하한가 30% 제한
      upperLimit = snapToTick(stock.previousClose * 1.30, tick);
      lowerLimit = snapToTick(stock.previousClose * 0.70, tick);
    }

    // MMs provide stable liquidity
    const mms = accounts.filter(a => a.botStyle === "LIQUIDITY_PROVIDER");
    for (const mm of mms) {
      // MM replenishes if liquidity is low, or periodically to adjust to new prices
      if (isFirstRun || needsLiquidity || rng() < mmRefreshProb) {
        engine.cancelAllOrdersByAccount(mm.id);
        
        // 상한가 진입 시 압도적 매수벽 형성
        if (state.currentPrice >= upperLimit) {
           engine.addOrder({
              accountId: mm.id, accountType: "LP", side: "buy", type: "limit", price: upperLimit,
              size: baseSize * 50000 // 압도적인 상한가 매수잔량
           });
           // 상한가에서는 밑에 깔리는 호가를 쌓지 않음
           continue;
        }
        // 하한가 진입 시 압도적 매도벽 형성
        if (state.currentPrice <= lowerLimit) {
           engine.addOrder({
              accountId: mm.id, accountType: "LP", side: "sell", type: "limit", price: lowerLimit,
              size: baseSize * 50000 // 압도적인 하한가 매도잔량
           });
           // 하한가에서는 위에 깔리는 호가를 쌓지 않음
           continue;
        }

        // MM walls are 20 ticks deep
        for(let i=1; i<=20; i++) {
          let askSizeMult, bidSizeMult;
          const pSell = +(state.currentPrice + tick * i).toFixed(2);
          const pBuy = +(state.currentPrice - tick * i).toFixed(2);

          if (stock.market === "domestic") {
            // 국내 주식: 최우선 호가(1~3호가)에 압도적인 물량(벽)을 쌓아 주가가 쉽게 변동하지 않도록 현실 고증
            let m;
            if (i === 1) m = 8.0;
            else if (i === 2) m = 5.0;
            else if (i === 3) m = 3.0;
            else m = Math.max(0.1, 1.0 - (i - 3) * 0.05);
            askSizeMult = m;
            bidSizeMult = m;
          } else {
            // 해외 주식
            if (session === "REGULAR") {
              // 정규장: HFT 봇들에 의해 특정 호가에 쏠리지 않고 촘촘하고 넓게 분산된 플랫한 유동성 분포
              askSizeMult = bidSizeMult = Math.max(0.3, 1.0 - i * 0.02);
            } else {
              // 프리마켓/애프터마켓: 거래가 희소하며 특정 라운드 피겨(예: 0.1달러, 0.5달러 단위)에 매물벽이 두껍게 쌓임
              askSizeMult = (pSell * 100) % 10 === 0 ? 5.0 : 0.05;
              bidSizeMult = (pBuy * 100) % 10 === 0 ? 5.0 : 0.05;
            }
          }
          
          if (pSell <= upperLimit) {
            engine.addOrder({
              accountId: mm.id, accountType: "LP", side: "sell", type: "limit", price: pSell,
              size: Math.max(1, Math.floor(baseSize * (rng() + 0.5) * 5 * askSizeMult * volumeScale * 2))
            });
          }

          if (pBuy > 0 && pBuy >= lowerLimit) {
            engine.addOrder({
              accountId: mm.id, accountType: "LP", side: "buy", type: "limit", price: pBuy,
              size: Math.max(1, Math.floor(baseSize * (rng() + 0.5) * 5 * bidSizeMult * volumeScale * 2))
            });
          }
        }
      }
    }

    // Active Institutions use TWAP/Momentum to generate market orders based on targetPrice
    const activeInstitutions = accounts.filter(a => a.investorCategory !== "RETAIL" && a.botStyle !== "LIQUIDITY_PROVIDER" && !a.isRealUser);
    
    const gap = (state.targetPrice - state.currentPrice) / state.currentPrice;
    const direction = gap > 0 ? "buy" : "sell";
    
    // NXT(대체거래소) 등 정규장 외 시간대에서는 기관투자자의 거래 참여 확률 자체를 극단적으로 낮춤 (유동성 부족으로 인한 시장충격 회피)
    let instProbabilityScale = session === "REGULAR" ? 1.0 : 0.005;
    
    // 미국 주식의 경우, 실제 미국 현지 시간(동부시간 EDT=UTC-4)을 반영하여 기관 트레이더들의 수면/기상 스케줄을 고증
    if (stock.market === "overseas") {
      const utcHours = new Date().getUTCHours();
      const usEasternHours = (utcHours - 4 + 24) % 24; // 대략적인 뉴욕 시간
      
      if (usEasternHours < 8) {
        // 새벽 0시 ~ 아침 8시 이전: 기관 트레이더들 취침. 기관 거래 완벽히 단절.
        instProbabilityScale = 0;
      } else if (usEasternHours === 8) {
        // 아침 8시 대: 트레이더들 기상 및 출근. 거래가 조금씩 시작됨.
        instProbabilityScale = 0.02;
      }
    }
    
    for (const inst of activeInstitutions) {
      if (Math.abs(gap) > 0.005 && rng() < 0.15 * Math.abs(gap * 10) * instProbabilityScale) {
        // 호가벽이 두꺼워진 만큼 기관들의 일반 시장가(TWAP) 주문량도 현실적으로 상향
        const takerSize = Math.max(1, Math.floor(baseSize * rng() * 1.5 * volumeScale));
        engine.addOrder({
          accountId: inst.id, accountType: "LP", side: direction, type: "market", price: 0, size: takerSize
        });
      }

      if (Math.abs(gap) > 0.02 && inst.algoPattern === "MOMENTUM" && rng() < 0.05 * instProbabilityScale) {
        // 돌파 매매(모멘텀) 시 두꺼운 벽을 뚫기 위해 대량 매수/매도 시전
        const breakoutSize = Math.max(10, Math.floor(baseSize * rng() * 10.0 * volumeScale));
        engine.addOrder({
          accountId: inst.id, accountType: "LP", side: direction, type: "market", price: 0, size: breakoutSize
        });
      }
    }
  }

  private runRetailBots(
    stock: Stock,
    state: LPState,
    meta: StockMeta,
    accounts: LPAccount[],
    rng: () => number,
    session: "PRE" | "REGULAR" | "AFTER" | "CLOSED" = "REGULAR"
  ) {
    const engine: MatchingEngine = state.matchingEngine;
    let exchangeRate = 1;
    if (stock.market === "overseas" || stock.market === "commodities" || stock.market === "options") {
      exchangeRate = 1350;
    } else if (stock.market === "europe") {
      exchangeRate = 1450;
    }
    const impliedShares = meta.marketCap / (state.currentPrice * exchangeRate);
    const baseSize = Math.max(1, Math.floor(impliedShares * 0.005 / 234000 * 50));
    
    const retailAccounts = accounts.filter((a) => a.investorCategory === "RETAIL");
    
    // 프리마켓/애프터마켓에서는 개인 투자자 참여율 극소화 (거래량 급감)
    const retailProbabilityScale = session === "REGULAR" ? 1.0 : 0.002;
    
    // Noise trading: retail bots sporadically place small market orders
    if (rng() < 0.15 * retailProbabilityScale) {
      const takerAccount = retailAccounts[Math.floor(rng() * retailAccounts.length)];
      if (takerAccount) {
        const side = rng() > 0.52 ? "sell" : "buy"; // slight sell bias
        const takerSize = rng() < 0.75 ? 1 : Math.floor(rng() * 10) + 1; // 1 share or 1-10
        engine.addOrder({
          accountId: takerAccount.id,
          accountType: "LP",
          side: side,
          type: "market",
          price: 0,
          size: takerSize
        });
      }
    }
  }

  private processSettlement(trades: { price: number; size: number; side: "buy" | "sell"; makerAccountId?: string; takerAccountId?: string }[], stockId: string) {
    for (const t of trades) {
      const value = t.price * t.size;

      if (t.makerAccountId) {
        const maker = this.accounts.find(a => a.id === t.makerAccountId);
        if (maker) {
          if (!maker.holdings[stockId]) maker.holdings[stockId] = { quantity: 0, lockedQuantity: 0, avgPrice: 0 };
          const mh = maker.holdings[stockId];
          
          if (t.side === "buy") { 
            maker.cash += value;
            mh.quantity -= t.size;
          } else { 
            maker.cash -= value;
            const totalValue = mh.quantity * mh.avgPrice + value;
            mh.quantity += t.size;
            mh.avgPrice = mh.quantity > 0 ? totalValue / mh.quantity : 0;
          }
        }
      }

      if (t.takerAccountId) {
        const taker = this.accounts.find(a => a.id === t.takerAccountId);
        if (taker) {
          if (!taker.holdings[stockId]) taker.holdings[stockId] = { quantity: 0, lockedQuantity: 0, avgPrice: 0 };
          const th = taker.holdings[stockId];
          
          if (t.side === "buy") {
            taker.cash -= value;
            const totalValue = th.quantity * th.avgPrice + value;
            th.quantity += t.size;
            th.avgPrice = th.quantity > 0 ? totalValue / th.quantity : 0;
          } else {
            taker.cash += value;
            th.quantity -= t.size;
          }
        }
      }
    }
  }

  private syncLockedAssets(engine: MatchingEngine, stockId: string) {
    for (const a of this.accounts) {
      a.lockedCash = 0;
      if (a.holdings[stockId]) {
        a.holdings[stockId].lockedQuantity = 0;
      }
    }

    for (const ask of engine.asks) {
      const a = this.accounts.find(acc => acc.id === ask.accountId);
      if (a) {
        if (!a.holdings[stockId]) a.holdings[stockId] = { quantity: 0, lockedQuantity: 0, avgPrice: 0 };
        a.holdings[stockId].lockedQuantity += ask.remainingSize;
      }
    }

    for (const bid of engine.bids) {
      const a = this.accounts.find(acc => acc.id === bid.accountId);
      if (a) {
        a.lockedCash += bid.price * bid.remainingSize;
      }
    }
  }

  // 종목에 활동하는 계좌 필터링
  private getActiveAccounts(stock: Stock, meta: StockMeta): LPAccount[] {
    return this.accounts.filter((a) => {
      // 1. 시장 집중도 (Market Focus) 제한
      if (stock.market === "domestic") {
        // 국내 주식은 외국계(IB), 국내 기관, 국내 개미만 참여 가능
        if (a.marketFocus === "OVERSEAS") return false; // 해외 펀드는 한국장 참여 불가
        if (a.investorCategory === "RETAIL" && a.marketFocus !== "DOMESTIC") return false;
        if (a.investorCategory === "INSTITUTION") {
          // 매 틱 랜덤이 아닌 고정 해시 확률로 30%만 참여
          const marketHash = (hashStr(a.id + "domestic") % 100) / 100;
          if (marketHash > 0.3) return false;
        }
      } else if (stock.market === "europe") {
        if (a.marketFocus !== "EUROPE" && a.marketFocus !== "GLOBAL") return false;
      } else {
        // 해외 주식(US)의 경우 국내 전용 및 유럽 전용 펀드는 참여 불가
        if (a.marketFocus === "DOMESTIC" || a.marketFocus === "EUROPE") return false;
        if (a.investorCategory === "INSTITUTION") {
          const marketHash = (hashStr(a.id + "overseas") % 100) / 100;
          if (marketHash > 0.5) return false;
        }
      }

      // 2. 섹터 편향 (Sector Portfolio) 기반 분산투자 로직
      // 모든 기관이 한 종목에 몰빵하지 못하도록 엄격히 제한
      if (a.sectorBias) {
        const isMatch = a.sectorBias === meta.sector || meta.sector.includes(a.sectorBias);
        if (!isMatch) {
          // 섹터가 맞지 않는 경우 편입 확률을 5% 미만으로 제한 (포트폴리오 다각화 차원 소액 투자)
          const hashRng = (hashStr(a.id + stock.id) % 100) / 100;
          if (hashRng > 0.05) return false;
        }
      }

      return true;
    });
  }



  getAccountSummary() {
    const lpAccounts = this.accounts.filter((a) => a.type === "LP");
    const macroAccounts = this.accounts.filter((a) => a.type === "MACRO");

    const lpCapital = lpAccounts.reduce((s, a) => s + a.capital, 0);
    const macroCapital = macroAccounts.reduce((s, a) => s + a.capital, 0);

    return {
      lpCount: lpAccounts.length,
      lpCapital,
      macroCount: macroAccounts.length,
      macroCapital,
      totalCapital: lpCapital + macroCapital,
      domesticCount: lpAccounts.filter((a) => a.marketFocus === "DOMESTIC").length,
      overseasCount: lpAccounts.filter((a) => a.marketFocus === "OVERSEAS").length,
      ibCount: lpAccounts.filter((a) => a.investorCategory === "FOREIGNER").length,
    };
  }

  getAccountsByType() {
    const lp = this.accounts.filter((a) => a.type === "LP");
    return {
      domestic: lp.filter((a) => a.marketFocus === "DOMESTIC"),
      overseas: lp.filter((a) => a.marketFocus === "OVERSEAS"),
      ib: lp.filter((a) => a.investorCategory === "FOREIGNER"),
      macro: this.accounts.filter((a) => a.type === "MACRO"),
    };
  }
}

function isDropping(state: LPState): boolean {
  return state.velocity < -0.001;
}

let _engine: LPEngine | null = null;

export function getLPEngine(): LPEngine {
  if (!_engine) _engine = new LPEngine();
  return _engine;
}
