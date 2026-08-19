import { createClient } from '@supabase/supabase-js';
import { ExecutionTrader } from './bots/ExecutionTrader';
import { AdversarialAgent } from './bots/AdversarialAgent';
import { WallBreakerAgent } from './bots/WallBreakerAgent';
import { OptionsMMAgent } from './bots/OptionsMMAgent';
import { CTAAgent, CommercialHedgerAgent } from './bots/CommodityBots';
import { QuantAgent } from './bots/QuantAgent';
import { ASMarketMakerAgent } from './bots/ASMarketMakerAgent';
import { RetailSwarmAgent } from './bots/RetailSwarmAgent';
import { HedgeFundAgent } from './bots/HedgeFundAgent';
import { StatArbAgent } from './bots/StatArbAgent';
import { PensionFundAgent } from './bots/PensionFundAgent';
import { CommercialBankAgent } from './bots/CommercialBankAgent';
import { PropDeskAgent } from './bots/PropDeskAgent';
import { RealWorldFetcher } from './realWorldFetcher';
import { EventBus } from './EventBus';
import type { MacroData } from './realWorldFetcher';
import type { MarketEvent } from './types';
import { CommodityMarketEngine } from '../../lib/commodities/CommodityMarketEngine';
import { SettlementBatchService } from './settlement/SettlementBatchService';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as os from 'os';

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("❌ [MarketEngine] Critical Error: Missing Supabase credentials in environment variables.");
  throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

const supabase = createClient(supabaseUrl, supabaseKey);

/**
 * 서버 CPU/RAM 사용량을 모니터링하여 고부하 시 봇 가동률 조절을 지원하는 클래스
 */
class SystemResourceMonitor {
  private prevCpuSnapshot: { idle: number; total: number } | null = null;

  public getMetrics(): { cpuPct: number; memPct: number; maxPct: number; isCritical: boolean; isNormalized: boolean } {
    const cpus = os.cpus();
    let currentIdle = 0;
    let currentTotal = 0;

    if (cpus && cpus.length > 0) {
      for (const cpu of cpus) {
        for (const type in cpu.times) {
          currentTotal += (cpu.times as Record<string, number>)[type] || 0;
        }
        currentIdle += cpu.times.idle;
      }
    }

    let cpuPct = 0;
    if (this.prevCpuSnapshot) {
      const idleDelta = currentIdle - this.prevCpuSnapshot.idle;
      const totalDelta = currentTotal - this.prevCpuSnapshot.total;
      if (totalDelta > 0) {
        cpuPct = Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
      }
    }
    this.prevCpuSnapshot = { idle: currentIdle, total: currentTotal };

    // Node.js 프로세스 힙 메모리 사용률 (Linux OS 버퍼/캐시 메모리 착시 현상 제외)
    const processMem = process.memoryUsage();
    const heapMemPct = processMem.heapTotal > 0 ? (processMem.heapUsed / processMem.heapTotal) * 100 : 0;

    const maxPct = Math.max(cpuPct, heapMemPct);

    return {
      cpuPct: Math.round(cpuPct * 10) / 10,
      memPct: Math.round(heapMemPct * 10) / 10,
      maxPct: Math.round(maxPct * 10) / 10,
      isCritical: cpuPct >= 90.0 || heapMemPct >= 90.0,
      isNormalized: cpuPct < 80.0 && heapMemPct < 80.0,
    };
  }
}

export class MarketEngine {
  private isRunning: boolean = false;
  private tickIntervalMs: number = 1000;
  private tickTimer: NodeJS.Timeout | null = null;
  private manipulationCheckTimer: NodeJS.Timeout | null = null;
  private resourceMonitorTimer: NodeJS.Timeout | null = null;
  private resourceMonitor: SystemResourceMonitor = new SystemResourceMonitor();
  private isThrottled: boolean = false;
  private lastResourceMetrics: { cpuPct: number; memPct: number; maxPct: number } = { cpuPct: 0, memPct: 0, maxPct: 0 };

  // 봇 주문 추적용 메모리 맵 (stockId_side_price -> botId)
  private botOrderMap: Map<string, string> = new Map();


  // 쿼리 부하 절감용 tick 카운터 / 캐시
  private tickCount: number = 0;
  private cachedMarketState: any = null;
  private lastMarketStateFetchMs: number = 0;
  private readonly MARKET_STATE_TTL_MS: number = 5000;
  private lastExchangeRateUpdateMs: number = 0;
  private readonly EXCHANGE_RATE_TTL_MS: number = 60000;
  private lastPortfolioUpsertMs: number = 0;
  private readonly PORTFOLIO_UPSERT_TTL_MS: number = 30000;
  private readonly LP_REFRESH_TICKS: number = 5;

  // SDE: Fundamental Value (Merton Jump-Diffusion)
  public fundamentals: Record<string, number> = {};
  private readonly mjd_mu: number = 0.0; // 기본 드리프트
  private readonly mjd_sigma: number = 0.005; // 틱당 변동성
  private readonly mjd_lambda: number = 0.01; // 점프 발생 확률 (틱당 1%)
  private readonly mjd_jump_mu: number = 0; // 점프 평균 크기 (로그 정규)
  private readonly mjd_jump_sigma: number = 0.1; // 점프 크기 변동성

  // Hawkes Process 상태 변수
  private hawkesIntensity: number = 0; // 초과 틱 강도
  private readonly mu: number = 0.5; // 베이스라인 강도 (약 2초 간격)
  private readonly alpha: number = 0.05; // 주문 1건당 증가하는 강도
  private readonly beta: number = 0.1; // 지수적 감쇠 계수
  private lastTickTime: number = Date.now();

  private activeEvents: MarketEvent[] = [];

  private institutionalBots: ExecutionTrader[] = [];
  
  // Specific role bots
  private optionsMMBots: OptionsMMAgent[] = [];
  private ctaBots: CTAAgent[] = [];
  private adversarialAgent: AdversarialAgent = new AdversarialAgent();
  private wallBreakerAgent: WallBreakerAgent = new WallBreakerAgent();
  private asMarketMakerAgent: ASMarketMakerAgent = new ASMarketMakerAgent();
  
  // New bots
  private retailSwarmAgents: RetailSwarmAgent[] = [];
  private hedgeFundAgents: HedgeFundAgent[] = [];
  private statArbAgents: StatArbAgent[] = [];
  private pensionFundAgents: PensionFundAgent[] = [];
  private commercialBankAgents: CommercialBankAgent[] = [];
  private propDeskAgents: PropDeskAgent[] = [];
  private quantAgents: QuantAgent[] = [];
  private commercialHedgerAgents: CommercialHedgerAgent[] = [];

  private realWorldFetcher: RealWorldFetcher = new RealWorldFetcher();
  public commodityEngine: CommodityMarketEngine = new CommodityMarketEngine({ totalBots: 30, eventProbability: 0.02 });
  public settlementService: SettlementBatchService = new SettlementBatchService(supabase);

  constructor() {}

  public injectEvent(event: MarketEvent) {
    this.activeEvents.push(event);
    EventBus.publish('NEWS_ALERT', event);
    console.log(`[NEWS EVENT INJECTED] ${event.id}: Sector ${event.targetSector}, Impact ${event.impact}`);
  }

  /**
   * 캐싱된 marketState를 외부(EventDirector/NewsGenerator)에 노출
   * 캐시가 없으면 null 반환 — 호출부에서 safe fallback 사용
   */
  public getMarketState(): any {
    return this.cachedMarketState || null;
  }

  public async initializeBots() {
    console.log("Initializing Institutional Bots from DB...");
    this.institutionalBots = [];
    this.retailSwarmAgents = [];
    this.hedgeFundAgents = [];
    this.statArbAgents = [];
    this.pensionFundAgents = [];
    this.optionsMMBots = [];
    this.ctaBots = [];
    this.commercialBankAgents = [];
    this.propDeskAgents = [];
    this.quantAgents = [];
    this.commercialHedgerAgents = [];

    let configs: any[] = [];
    try {
      const { data, error } = await supabase.from('bots_config').select('*');
      if (!error && data && data.length > 0) {
        configs = data;
      } else {
        console.warn("Notice: DB bots_config returned empty or error, initializing full in-memory bot fleet:", error ? error.message : "0 rows");
      }
    } catch (e: any) {
      console.warn("Notice: Exception loading bots_config, fallback to in-memory fleet:", e?.message);
    }

    for (const config of configs) {
       const botConfig = {
           id: config.id,
           name: config.name,
           type: config.bot_type,
           capital: config.capital,
           ...config.traits
       };

       if (config.bot_type === 'PENSION_FUND') {
          this.pensionFundAgents.push(new PensionFundAgent(botConfig as any));
       } else if (config.bot_type === 'HEDGE_FUND') {
           const hedgeConfig = {
             ...botConfig,
             portfolioTarget: (botConfig as any).portfolioTarget || { equity: 0.5, safeBonds: 0.3, highYield: 0.2 },
             currentSentiment: (botConfig as any).currentSentiment || 'NEUTRAL'
           };
           this.hedgeFundAgents.push(new HedgeFundAgent(hedgeConfig as any));
       } else if (config.bot_type === 'RETAIL_SWARM') {
          this.retailSwarmAgents.push(new RetailSwarmAgent(botConfig as any));
       } else if (config.bot_type === 'STAT_ARB' || config.bot_type === 'STATISTICAL_ARBITRAGE') {
          this.statArbAgents.push(new StatArbAgent(botConfig as any));
       } else if (config.bot_type === 'COMMERCIAL_BANK') {
          this.commercialBankAgents.push(new CommercialBankAgent(botConfig as any));
       } else if (config.bot_type === 'PROP_DESK') {
          this.propDeskAgents.push(new PropDeskAgent(botConfig as any));
       } else if (config.bot_type === 'QUANT_FUND') {
          this.quantAgents.push(new QuantAgent(botConfig as any));
       } else if (config.bot_type === 'COMMERCIAL_HEDGER') {
          this.commercialHedgerAgents.push(new CommercialHedgerAgent(botConfig as any));
       } else {
          this.institutionalBots.push(new ExecutionTrader(botConfig as any, config.capital));
       }
    }

    // 💡 100% 가동 보장: 봇 배열이 비어있으면 기본 마스터 봇 플릿을 메모리에 즉시 채움
    if (this.retailSwarmAgents.length === 0) {
      this.retailSwarmAgents.push(new RetailSwarmAgent({ id: 'bot_retail_001', name: 'Retail Swarm Alpha', capital: 5000000000 } as any));
      this.retailSwarmAgents.push(new RetailSwarmAgent({ id: 'bot_retail_002', name: 'Retail Swarm Beta', capital: 5000000000 } as any));
    }
    if (this.hedgeFundAgents.length === 0) {
      this.hedgeFundAgents.push(new HedgeFundAgent({
        id: 'bot_hf_001', name: 'Bridgewater Associates', type: 'HEDGE_FUND', capital: 100000000000, portfolioTarget: { equity: 0.6, safeBonds: 0.2, highYield: 0.2 }, currentSentiment: 'NEUTRAL'
      } as any));
      this.hedgeFundAgents.push(new HedgeFundAgent({
        id: 'bot_hf_002', name: 'Citadel Quant Fund', type: 'HEDGE_FUND', capital: 100000000000, portfolioTarget: { equity: 0.7, safeBonds: 0.15, highYield: 0.15 }, currentSentiment: 'BULLISH'
      } as any));
    }
    if (this.propDeskAgents.length === 0) {
      this.propDeskAgents.push(new PropDeskAgent({
        id: 'bot_prop_001', name: 'Jane Street Desk', type: 'PROP_DESK', capital: 100000000000
      } as any));
      this.propDeskAgents.push(new PropDeskAgent({
        id: 'bot_prop_002', name: 'Optiver Market Making', type: 'PROP_DESK', capital: 100000000000
      } as any));
    }
    if (this.quantAgents.length === 0) {
      this.quantAgents.push(new QuantAgent({
        id: 'bot_quant_001', name: 'Aladdin Quant Fund', type: 'QUANT_FUND', capital: 50000000000
      } as any));
    }
    if (this.optionsMMBots.length === 0) {
      this.optionsMMBots.push(new OptionsMMAgent({
        id: 'bot_options_mm_001', name: 'Gamma Squeezer MM', type: 'OPTIONS_MM', capital: 10000000000, reactionSpeed: 2, tradingStyle: 'DELTA_NEUTRAL', initialGammaNet: -50
      } as any));
    }
    if (this.ctaBots.length === 0) {
      this.ctaBots.push(new CTAAgent({
        id: 'bot_cta_001', name: 'Macro CTA Fund', type: 'CTA_MOMENTUM', capital: 20000000000, reactionSpeed: 1, breakoutThreshold: 0.02, tradingStyle: 'SWEEP_AGGRESSIVE'
      } as any));
    }
    if (this.commercialHedgerAgents.length === 0) {
      this.commercialHedgerAgents.push(new CommercialHedgerAgent({
        id: 'bot_hedger_001', name: 'Chevron Commercial Hedger', type: 'COMMERCIAL_HEDGER', capital: 50000000000, targetCommodity: 'WTI_CRUDE', supportLevel: 75, resistanceLevel: 90, tradingStyle: 'LIMIT_HEAVY'
      } as any));
    }

    console.log(`✅ Successfully initialized master bot fleet (${configs.length} DB records, Active Bot Fleet Ready).`);
  }

  private checkResourceUsage() {
    const metrics = this.resourceMonitor.getMetrics();
    this.lastResourceMetrics = { cpuPct: metrics.cpuPct, memPct: metrics.memPct, maxPct: metrics.maxPct };

    if (metrics.isCritical && !this.isThrottled) {
      this.isThrottled = true;
      console.warn(`⚠️ [ResourceMonitor] 컴퓨팅 자원 사용량 90% 이상 감지 (CPU: ${metrics.cpuPct}%, RAM: ${metrics.memPct}%). 봇 가동 스케줄링 대기 시간을 3.5배 확장하여 가동률을 75% 감축합니다.`);
    } else if (metrics.isNormalized && this.isThrottled) {
      this.isThrottled = false;
      console.log(`✅ [ResourceMonitor] 컴퓨팅 자원 사용량 정상화 (CPU: ${metrics.cpuPct}%, RAM: ${metrics.memPct}%). 봇 정상 가동 속도를 복구합니다.`);
    }
  }

  public async start() {
    if (this.isRunning) return;
    await this.initializeBots();
    this.isRunning = true;
    console.log("🚀 Market Engine Started (Dynamic Tick via Hawkes Process)...");
    this.lastTickTime = Date.now();
    this.scheduleNextTick(2000);
    
    // 10초마다 active_manipulations 테이블 폴링
    this.manipulationCheckTimer = setInterval(() => this.checkManipulations(), 10000);
    // 3초마다 컴퓨팅 자원(CPU/RAM 90% 임계치) 모니터링
    this.resourceMonitorTimer = setInterval(() => this.checkResourceUsage(), 3000);
  }

  public stop() {
    this.isRunning = false;
    if (this.tickTimer) clearTimeout(this.tickTimer);
    if (this.manipulationCheckTimer) clearInterval(this.manipulationCheckTimer);
    if (this.resourceMonitorTimer) clearInterval(this.resourceMonitorTimer);
    console.log("🛑 Market Engine Stopped.");
  }

  private scheduleNextTick(delayMs: number) {
    if (!this.isRunning) return;
    this.tickTimer = setTimeout(async () => {
      const startTime = Date.now();
      await this.tick();
      const executionTime = Date.now() - startTime;
      
      const now = Date.now();
      const dt = (now - this.lastTickTime) / 1000; // 초 단위 경과 시간
      this.lastTickTime = now;

      // Hawkes 감쇠(Decay) 적용
      this.hawkesIntensity = this.hawkesIntensity * Math.exp(-this.beta * dt);

      // 전체 강도 산출 및 다음 틱 지연 시간 계산
      const totalIntensity = this.mu + this.hawkesIntensity;
      let nextDelayMs = 1000 / totalIntensity;

      // 실행 시간(Execution Time)을 보정하여 대기 시간 계산
      nextDelayMs = nextDelayMs - executionTime;

      // Clamp: 렌더 무료 서버 환경을 고려해 최소 250ms, 최대 3000ms 설정
      nextDelayMs = Math.max(250, Math.min(3000, nextDelayMs));

      // 💡 서버 컴퓨팅 자원 사용량 90% 이상 고부하 감지 시 봇 가동 대기 시간을 3.5배 연장 (부하 75% 감소)
      if (this.isThrottled) {
        nextDelayMs = Math.max(3500, Math.round(nextDelayMs * 3.5));
      }

      this.scheduleNextTick(nextDelayMs);
    }, delayMs);
  }

  private async checkManipulations() {
    try {
      // DB에 active_manipulations 테이블이 있다고 가정 (관리자가 행을 삽입)
      // 상태가 'PENDING'인 작전을 하나 가져옵니다.
      const { data, error } = await supabase
        .from('active_manipulations')
        .select('*')
        .eq('status', 'PENDING')
        .limit(1);

      if (!error && data && data.length > 0) {
        const manip = data[0];
        
        // 주식 정보를 가져와서 매집량 계산을 위해 marketCap을 넘겨줌
        const { data: stockData } = await supabase.from('stocks').select('market_cap, current_price').eq('id', manip.stock_id).single();
        
        if (stockData) {
          this.adversarialAgent.triggerManipulation(manip.stock_id, stockData.market_cap || 10000000000, stockData.current_price);
          
          // 상태를 'ACTIVE'로 변경
          await supabase.from('active_manipulations').update({ status: 'ACTIVE' }).eq('id', manip.id);
        }
      }
    } catch (_e) {
      // 테이블이 아직 없거나 오류 발생 시 무시 (Migration 필요)
    }
  }

  private async tick() {
    try {
      // 24시간 연속 봇 매매 지원 (MARKET_HOURS_ONLY가 명시적으로 'true'가 아니면 24시간 상시 거래)
      const isMarketHoursOnly = process.env.MARKET_HOURS_ONLY === 'true';
      if (isMarketHoursOnly) {
        const now = new Date();
        const kstHours = (now.getUTCHours() + 9) % 24;
        const kstMinutes = now.getUTCMinutes();
        const kstDecimal = kstHours + kstMinutes / 60;
        if (kstDecimal < 18 || kstDecimal >= 22.5) {
          return;
        }
      }

      // 틱 시작 시 이벤트 수명 차감
      this.activeEvents = this.activeEvents.filter(e => {
        e.durationTicks -= 1;
        return e.durationTicks > 0;
      });

      // 1. 틱 시작 시점의 모든 미체결 주문(User + LP)을 가져와 orderBook 구성
      const { data: initialOrders } = await supabase.from('orders').select('*').eq('status', 'open');
      const orderBook: Record<string, { bids: any[], asks: any[] }> = {};
      if (initialOrders) {
        for (const order of initialOrders) {
          const sId = order.stock_id;
          let book = orderBook[sId];
          if (!book) {
            book = { bids: [], asks: [] };
            orderBook[sId] = book;
          }
          if (order.side === 'buy') {
            book.bids.push(order);
          } else {
            book.asks.push(order);
          }
        }
        // 정렬
        for (const sId of Object.keys(orderBook)) {
          orderBook[sId]!.bids.sort((a, b) => b.price - a.price);
          orderBook[sId]!.asks.sort((a, b) => a.price - b.price);
        }
      }

      // 틱이 시작될 때마다 기존에 깔아둔 LP 호가를 걷어냅니다.
      // 쿼리 부하 절감: 5틱마다 한 번만 LP 주문 갱신
      const shouldRefreshLp = (this.tickCount % this.LP_REFRESH_TICKS) === 0;
      if (shouldRefreshLp) {
        await this.safeDeleteLpOrders();
      }
      if ((Date.now() - this.lastExchangeRateUpdateMs) >= this.EXCHANGE_RATE_TTL_MS) {
        await this.updateExchangeRates();
        this.lastExchangeRateUpdateMs = Date.now();
      }

      const macroData = await this.realWorldFetcher.getMacroData();
      const marketState = await this.fetchMarketState(macroData);
      marketState.orderBook = orderBook;
      
      let allOrders: any[] = [];

      // 1. Update Fundamentals (Merton Jump-Diffusion)
      for (const stock of marketState.stocks) {
        if (!this.fundamentals[stock.id]) this.fundamentals[stock.id] = stock.current_price;
        const F = this.fundamentals[stock.id]!;
        
        // 브라운 운동 (Brownian Motion)
        const dW = (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.732; // 근사 정규분포
        const diffusion = this.mjd_sigma * dW;
        
        // 푸아송 점프 (Poisson Jump)
        let jump = 0;
        if (Math.random() < this.mjd_lambda) {
          const jumpZ = (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 1.732;
          const J = Math.exp(this.mjd_jump_mu + this.mjd_jump_sigma * jumpZ);
          jump = J - 1;
          
          // 점프 보상자 (Compensator) k = E[J - 1]
          const k = Math.exp(this.mjd_jump_mu + (this.mjd_jump_sigma * this.mjd_jump_sigma) / 2) - 1;
          const compensator = this.mjd_lambda * k;
          
          jump -= compensator; // 마틴게일 성질 유지

          console.log(`💥 [MJD JUMP] ${stock.name} fundamental value jumped! F: ${(F || stock.current_price).toFixed(0)} -> ${((F || stock.current_price) * (1 + diffusion + jump)).toFixed(0)}`);
        }
        
        const dF = (F || stock.current_price) * (this.mjd_mu + diffusion + jump);
        this.fundamentals[stock.id] = (F || stock.current_price) + dF;
      }

      // 2. 봇들에게서 주문 수집 (3-Tier Portfolio Logic & 딥 매매 봇)
      for (const bot of this.institutionalBots) {
        allOrders.push(...bot.evaluateMarketAndPlaceOrders(marketState));
      }
      for (const bot of this.hedgeFundAgents) {
        if (typeof bot.executeAggressiveSweep === 'function') {
          allOrders.push(...bot.executeAggressiveSweep(marketState));
        }
      }
      for (const bot of this.retailSwarmAgents) {
        if (typeof bot.executeSwarmBehavior === 'function') {
          allOrders.push(...bot.executeSwarmBehavior(marketState, {}));
        }
      }
      for (const bot of this.quantAgents) {
        if (typeof bot.executeQuantStrategy === 'function') {
          allOrders.push(...bot.executeQuantStrategy(marketState, marketState.orderBook));
        }
      }
      for (const bot of this.propDeskAgents) {
        if (typeof bot.executeMarketMaking === 'function') {
          allOrders.push(...bot.executeMarketMaking(marketState, marketState.orderBook, {}));
        }
      }
      for (const bot of this.statArbAgents) {
        if (typeof bot.executePairsTrading === 'function') {
          allOrders.push(...bot.executePairsTrading(marketState.stocks));
        }
      }
      for (const bot of this.commercialBankAgents) {
        allOrders.push(...bot.executeArbitrage(marketState, marketState.adminBaseRate));
      }
      for (const bot of this.propDeskAgents) {
        allOrders.push(...bot.executeMarketMaking(marketState, marketState.orderBook, {}));
      }
      
      for (const bot of this.retailSwarmAgents) {
        allOrders.push(...bot.executeSwarmBehavior(marketState, {}));
      }
      for (const bot of this.hedgeFundAgents) {
        allOrders.push(...bot.executeAggressiveSweep(marketState));
      }
      for (const bot of this.statArbAgents) {
        allOrders.push(...bot.executePairsTrading(marketState.stocks));
      }
      for (const bot of this.pensionFundAgents) {
        allOrders.push(...bot.evaluateMarketAndPlaceOrders(marketState, false));
      }
      for (const bot of this.quantAgents) {
        allOrders.push(...bot.executeQuantStrategy(marketState, marketState.orderBook));
      }
      for (const bot of this.commercialHedgerAgents) {
        const cmd = (marketState.commodities || []).find((c: any) => c.commodity_id === bot.config.targetCommodity || c.id === bot.config.targetCommodity);
        if (cmd) {
          allOrders.push(...bot.executeHedging(cmd.current_price, cmd.id, cmd.tick_size));
        }
      }
      
      // 3. 파생상품 전용 봇 실행
      for (const bot of this.optionsMMBots) {
        allOrders.push(...bot.executeDeltaHedging(marketState, marketState.orderBook));
      }
      for (const bot of this.ctaBots) {
        for (const cmd of (marketState.commodities || [])) {
          allOrders.push(...bot.executeMomentum(cmd.current_price, cmd.id, cmd.tick_size, marketState.activeEvents));
        }
      }
      
      // 4. 고도화된 마켓메이커 및 적대적 봇
      allOrders.push(...this.asMarketMakerAgent.executeMarketMaking(marketState));
      
      // Collect endogenous news reaction orders from all agents
      const allAgents = [
        ...this.institutionalBots,
        ...this.pensionFundAgents,
        ...this.hedgeFundAgents,
        ...this.statArbAgents,
        ...this.commercialBankAgents,
        ...this.propDeskAgents,
        ...this.quantAgents,
        ...this.commercialHedgerAgents,
        ...this.retailSwarmAgents
      ];
      for (const bot of allAgents) {
        if (typeof (bot as any).getPendingNewsOrders === 'function') {
          allOrders.push(...(bot as any).getPendingNewsOrders(marketState));
        }
      }
      
      // 적대적 에이전트(작전 세력) 개입
      allOrders.push(...this.adversarialAgent.executeManipulation(marketState));

      // WallBreakerAgent: 감마 스퀴즈 헌팅 (옵션 데이터 기반)
      const currentHour = (new Date().getUTCHours() + 9) % 24;
      const currentPrices: Record<string, number> = {};
      for (const s of marketState.stocks) { currentPrices[s.id] = s.current_price; }
      const optionsData = marketState.options_contracts || [];
      allOrders.push(...this.wallBreakerAgent.executeGammaSqueezeHunt({ hour: currentHour }, currentPrices, optionsData));
      
      // Macro Linkage: WTI Inflation Shock
      const wti = (marketState.commodities || []).find((c: any) => c.commodity_id === 'WTI_CRUDE');
      if (wti && wti.current_price >= 83.0 && !this.activeEvents.find(e => e.id === 'INFLATION_SHOCK')) {
        console.log(`🛢️ [MACRO SHOCK] WTI crude oil surged to ${wti.current_price}! Triggering INFLATION_SHOCK!`);
        EventBus.publish('MARKET_SHOCK', { stockId: wti.id, volume: 0, pctChange: 0.1, marketState });
        this.injectEvent({
          id: 'INFLATION_SHOCK',
          targetSector: 'ALL',
          impact: 'STRONG_NEGATIVE',
          urgencyMultiplier: 3.0,
          durationTicks: 60,
          reliability: 1.0
        } as any);
      }

      console.log(`[Tick Debug] Collected ${allOrders.length} raw orders across all active bot fleets (stocks: ${marketState.stocks?.length || 0}).`);

      if (allOrders.length > 0) {
        const MAX_NOTIONAL = 5000000; // 500만 원 캡
        const MAX_QTY = 5000;         // 5,000주 캡
        allOrders = allOrders.map(order => {
          const p = Number(order.price || 1);
          const alignedPrice = this.alignToTickSize(p);
          let safeSize = Math.abs(Number(order.size || 1));
          if (alignedPrice > 0) {
            safeSize = Math.min(safeSize, Math.floor(MAX_NOTIONAL / alignedPrice));
          }
          safeSize = Math.min(safeSize, MAX_QTY);
          return {
            ...order,
            price: alignedPrice,
            size: Math.max(1, safeSize)
          };
        });

        await this.processBatchOrders(allOrders, marketState, shouldRefreshLp);
        this.tickCount++;
        
        // 자체 여기(Self-excitation) 발생: 주문량에 비례하여 강도 증가
        this.hawkesIntensity += this.alpha * allOrders.length;
        
        if (this.hawkesIntensity > 5) { // 강도가 극단적으로 높아지면 경고 로그
          console.log(`[Hawkes] Flash Crash Detected! Orders: ${allOrders.length}, Intensity: ${this.hawkesIntensity.toFixed(2)}`);
        }
      } else {
        console.log(`[Tick Debug] 0 orders generated in this tick.`);
      }

      // Random Event Trigger (about 1% chance per tick)
      if (Math.random() < 0.01) {
        await this.triggerRandomEvents();
      }
    } catch (error) {
      console.error("Engine Tick Error:", error);
    }
  }

  private async triggerRandomEvents() {
    // 1. Get all events
    const { data: events } = await supabase.from('player_events').select('*');
    if (!events || events.length === 0) return;

    // 2. Get random users (for demo, just all users who have cash < 100M to simulate stage 1)
    const { data: users } = await supabase.from('profiles').select('id, cash').lt('cash', 100000000).limit(5);
    if (!users || users.length === 0) return;

    // 3. For each user, maybe 10% chance to actually get an event
    for (const user of users) {
      if (Math.random() < 0.1) {
        const randomEvent = events[Math.floor(Math.random() * events.length)];
        
        // Insert active event
        await supabase.from('active_player_events').insert({
          user_id: user.id,
          event_id: randomEvent.id,
          status: 'pending'
        });
        console.log(`[ROGUE-LITE EVENT] Triggered event ${randomEvent.id} for user ${user.id}`);
      }
    }
  }

  private async fetchMarketState(macroData: MacroData | null) {
    // 캐시 활용: TTL 내이면 캐시된 marketState 반환 (단, activeEvents/fundamentals는 갱신)
    const now = Date.now();
    if (this.cachedMarketState && (now - this.lastMarketStateFetchMs) < this.MARKET_STATE_TTL_MS) {
      // 실시간성이 필요한 필드만 갱신해서 반환 (캐시 오염 방지를 위해 shallow copy)
      return {
        ...this.cachedMarketState,
        activeEvents: this.activeEvents,
        fundamentals: this.fundamentals
      };
    }

    const [bonds, stocks, commodities, adminSettings, optionsContracts] = await Promise.all([
      supabase.from('bonds').select('*'),
      supabase.from('stocks').select('*'),
      supabase.from('commodities').select('*'),
      supabase.from('admin_settings').select('base_rate, market_sentiment').limit(1),
      supabase.from('options_contracts').select('*') // WallBreakerAgent 및 OptionsMMAgent용
    ]);

    const adminRow = adminSettings.data && adminSettings.data.length > 0 ? adminSettings.data[0] : null;
    const baseRate = macroData ? macroData.us10yYield / 100 : (adminRow ? adminRow.base_rate : 0.025);
    const sentiment = adminRow ? adminRow.market_sentiment : 'NEUTRAL';

    if (stocks.error) {
      console.error("❌ [fetchMarketState] Failed to fetch stocks from DB:", stocks.error);
    }

    const state = {
      bonds: bonds.data || [],
      stocks: stocks.data || [],
      commodities: commodities.data || [],
      options_contracts: optionsContracts.data || [],
      adminBaseRate: baseRate,
      sentiment,
      orderBook: {},
      realWorldMacro: macroData,
      activeEvents: this.activeEvents,
      fundamentals: this.fundamentals
    };
    this.cachedMarketState = state;
    this.lastMarketStateFetchMs = now;
    return state;
  }

  private async processBatchOrders(lpOrders: any[], marketState: any, refreshLpOrders: boolean = true) {
    // 1. 유저의 미체결(Open) 주문들을 가져옵니다.
    const { data: userOrders, error: userOrdersError } = await supabase
      .from('orders')
      .select('*')
      .eq('status', 'open')
      .eq('is_lp', false);

    if (userOrdersError) {
      console.error("Failed to fetch user orders:", userOrdersError);
      return;
    }

    const orderBookByStock: Record<string, { bids: any[], asks: any[] }> = {};
    const allCombinedOrders = [...(userOrders || []), ...lpOrders];

    for (const order of allCombinedOrders) {
      if (!orderBookByStock[order.stock_id]) {
        orderBookByStock[order.stock_id] = { bids: [], asks: [] };
      }
      if (order.side === 'buy') {
        orderBookByStock[order.stock_id]!.bids.push(order);
      } else {
        orderBookByStock[order.stock_id]!.asks.push(order);
      }
    }

    const tradesToInsert: any[] = [];
    const updatedStocks: Record<string, number> = {}; // stock_id -> new price
    const lpOrdersToInsert: any[] = [];
    const userOrdersToUpdate: any[] = [];
    const cashChanges: Record<string, number> = {}; // user_id -> net cash change
    const holdingsChanges: Record<string, Record<string, number>> = {}; // user_id -> { stock_id -> qty delta (+buy / -sell) }

    // 3. 종목별 매칭 엔진 로직 (In-memory Matching)
    for (const stockId of Object.keys(orderBookByStock)) {
      const book = orderBookByStock[stockId]!;

      // 매수(Buy)는 가격 내림차순, 시간 오름차순 (먼저 온 주문 우선)
      // 매도(Sell)는 가격 오름차순, 시간 오름차순
      book.bids.sort((a, b) => {
        if (b.price !== a.price) return b.price - a.price;
        return (a.created_at || '').localeCompare(b.created_at || '');
      });
      book.asks.sort((a, b) => {
        if (a.price !== b.price) return a.price - b.price;
        return (a.created_at || '').localeCompare(b.created_at || '');
      });

      let latestTradePrice = null;

      while (book.bids.length > 0 && book.asks.length > 0) {
        const highestBid = book.bids[0];
        const lowestAsk = book.asks[0];

        // 조건: 최우선 매수호가가 최우선 매도호가보다 크거나 같으면 체결(Cross)
        if (highestBid.price >= lowestAsk.price) {
          const tradeSize = Math.min(highestBid.size, lowestAsk.size);
          const tradePrice = this.alignToTickSize(lowestAsk.price);
          latestTradePrice = tradePrice;

          tradesToInsert.push({
            stock_id: stockId,
            price: tradePrice,
            size: tradeSize,
            buyer_id: highestBid.user_id || null,
            seller_id: lowestAsk.user_id || null,
            buyer_is_bot: highestBid.is_lp || false,
            seller_is_bot: lowestAsk.is_lp || false,
            created_at: new Date().toISOString()
          });

          // ✅ Fix: 체결 후 기관 봇 포트폴리오 실제 업데이트 (Optimistic Update 대체)
          // LP 봇 주문이 체결됐을 때 해당 봇을 찾아 confirmExecution() 호출
          // LP 봇 주문은 user_id가 null이므로 botId 메타데이터를 주문 객체에서 확인
          // Maker/Taker asset class detection
          const getAssetClass = (order: any) => {
            if (order._assetClass) return order._assetClass;
            if (marketState.stocks.some((s: any) => s.id === order.stock_id)) return 'stock';
            if (marketState.bonds.some((b: any) => b.id === order.stock_id)) return 'bond';
            if (marketState.commodities.some((c: any) => c.id === order.stock_id)) return 'commodity';
            return 'stock';
          };
          const bidAssetClass = getAssetClass(highestBid);
          const askAssetClass = getAssetClass(lowestAsk);

          if (highestBid.is_lp && highestBid._botId) {
            const bot = this.findAgentById(highestBid._botId);
            if (bot && typeof bot.confirmExecution === 'function') {
              bot.confirmExecution(bidAssetClass, 'buy', tradeSize, tradePrice, highestBid.stock_id);
            }
          }
          if (lowestAsk.is_lp && lowestAsk._botId) {
            const bot = this.findAgentById(lowestAsk._botId);
            if (bot && typeof bot.confirmExecution === 'function') {
              bot.confirmExecution(askAssetClass, 'sell', tradeSize, tradePrice, lowestAsk.stock_id);
            }
          }

          // Maker-Taker 판별 (더 일찍 생성된 주문이 Maker)
          const bidTime = new Date(highestBid.created_at || 0).getTime();
          const askTime = new Date(lowestAsk.created_at || 0).getTime();
          const isBidMaker = bidTime <= askTime;
          
          // Maker Rebate (-0.1%), Taker Fee (+0.25%)
          const makerRebateRate = -0.001; 
          const takerFeeRate = 0.0025;
          
          const bidFeeRate = isBidMaker ? makerRebateRate : takerFeeRate;
          const askFeeRate = isBidMaker ? takerFeeRate : makerRebateRate;

          if (highestBid.user_id && highestBid.is_lp === false) {
            // 매수자는 체결 대금 + 수수료 지불
            const bidUid = highestBid.user_id;
            cashChanges[bidUid] = (cashChanges[bidUid] || 0) - (tradePrice * tradeSize * (1 + bidFeeRate));
            // 매수자 보유 주식 증가
            if (!holdingsChanges[bidUid]) holdingsChanges[bidUid] = {};
            holdingsChanges[bidUid]![stockId] = (holdingsChanges[bidUid]![stockId] || 0) + tradeSize;
          }
          if (lowestAsk.user_id && lowestAsk.is_lp === false) {
            // 매도자는 체결 대금 획득 - 수수료 차감
            const askUid = lowestAsk.user_id;
            cashChanges[askUid] = (cashChanges[askUid] || 0) + (tradePrice * tradeSize * (1 - askFeeRate));
            // 매도자 보유 주식 감소
            if (!holdingsChanges[askUid]) holdingsChanges[askUid] = {};
            holdingsChanges[askUid]![stockId] = (holdingsChanges[askUid]![stockId] || 0) - tradeSize;
          }


          highestBid.size -= tradeSize;
          lowestAsk.size -= tradeSize;

          // Iceberg Order (빙산 주문) 리필 및 시간 우선순위 초기화 (Loss-in-priority)
          if (highestBid.size === 0 && highestBid.hidden_size && highestBid.hidden_size > 0) {
            const replenish = Math.min(highestBid.hidden_size, highestBid.peak_size || 100);
            highestBid.size = replenish;
            highestBid.hidden_size -= replenish;
            highestBid.created_at = new Date().toISOString(); // 우선순위 밀림
            console.log(`🧊 [Iceberg] Bid replenished by ${replenish}. Remaining hidden: ${highestBid.hidden_size}`);
          }
          if (lowestAsk.size === 0 && lowestAsk.hidden_size && lowestAsk.hidden_size > 0) {
            const replenish = Math.min(lowestAsk.hidden_size, lowestAsk.peak_size || 100);
            lowestAsk.size = replenish;
            lowestAsk.hidden_size -= replenish;
            lowestAsk.created_at = new Date().toISOString(); // 우선순위 밀림
            console.log(`🧊 [Iceberg] Ask replenished by ${replenish}. Remaining hidden: ${lowestAsk.hidden_size}`);
          }

          if (highestBid.id && !highestBid._updated) {
            userOrdersToUpdate.push(highestBid);
            highestBid._updated = true;
          }
          if (lowestAsk.id && !lowestAsk._updated) {
            userOrdersToUpdate.push(lowestAsk);
            lowestAsk._updated = true;
          }

          if (highestBid.size === 0) {
            book.bids.shift();
            if (highestBid.id) highestBid.status = 'filled';
          }
          if (lowestAsk.size === 0) {
            book.asks.shift();
            if (lowestAsk.id) lowestAsk.status = 'filled';
          }
        } else {
          break;
        }
      }

      if (latestTradePrice) {
        updatedStocks[stockId] = latestTradePrice;
      }

      // 4. 매칭 후 남은(미체결) 주문들 분류
      for (const bid of book.bids) {
        if (!bid.id) lpOrdersToInsert.push(bid);
      }
      for (const ask of book.asks) {
        if (!ask.id) lpOrdersToInsert.push(ask);
      }
    }

    if (tradesToInsert.length > 0 || lpOrdersToInsert.length > 0) {
      console.log(`⚡ [BatchOrders] Matched ${tradesToInsert.length} real trades, ${lpOrdersToInsert.length} active LP orders.`);
    }

    // 5. DB 일괄 트랜잭션 반영 (Batch Commit)
    const promises: any[] = [];

    // 5.1 체결 내역 Insert (trades는 영구 보관 — 절대 삭제 안 함)
    if (tradesToInsert.length > 0) {
      for (let i = 0; i < tradesToInsert.length; i += 200) {
        const chunk = tradesToInsert.slice(i, i + 200);
        promises.push(supabase.from('trades').insert(chunk).then(res => {
          if (res.error) console.error('[Engine] Failed to insert trades chunk:', res.error);
          return res;
        }));
      }
    }

    // 5.2 LP 호가 슬라이딩 윈도우 (Sliding Window)
    //   이전 틱 LP 주문 DELETE → 새 LP 주문 INSERT
    //   종목당 최대 5 bid + 5 ask = 10개로 엄격 제한 (DB 과부하 방지)
    if (lpOrdersToInsert.length > 0) {
      const validStockIds = new Set(marketState.stocks.map((s: any) => s.id));

      // 종목별로 그룹화 후 bid 5 + ask 5만 추출
      const byStock: Record<string, { bids: any[], asks: any[] }> = {};
      for (const o of lpOrdersToInsert) {
        if (!validStockIds.has(o.stock_id)) continue;
        if (!byStock[o.stock_id]) byStock[o.stock_id] = { bids: [], asks: [] };
        const entry = byStock[o.stock_id]!;
        if (o.side === 'buy') entry.bids.push(o);
        else entry.asks.push(o);
      }

      const safeLpOrders: any[] = [];
      const MAX_NOTIONAL = 5000000; // 500만 원 캡
      const MAX_QTY = 5000;         // 5,000주 캡

      for (const [_stockId, { bids, asks }] of Object.entries(byStock)) {
        // 매도는 오름차순 상위 5개, 매수는 매도 1호가보다 낮은 가격 오름차순 상위 5개
        const topAsks = asks.sort((a, b) => a.price - b.price).slice(0, 5);
        const minAskPrice = topAsks.length > 0 ? topAsks[0].price : Infinity;
        const topBids = bids.filter(b => b.price < minAskPrice).sort((a, b) => b.price - a.price).slice(0, 5);
        for (const o of [...topBids, ...topAsks]) {

          const p = Math.max(1, this.alignToTickSize(o.price || 1));
          let safeSize = Math.abs(Math.round(o.size || 1));
          if (p > 0) {
            safeSize = Math.min(safeSize, Math.floor(MAX_NOTIONAL / p));
          }
          safeSize = Math.min(safeSize, MAX_QTY);

          safeLpOrders.push({
            stock_id: o.stock_id,
            user_id: null,
            side: o.side,
            price: p,
            size: Math.max(1, safeSize),
            status: 'open',
            is_lp: true
          });
        }
      }

      if (safeLpOrders.length > 0) {
        const affectedStockIds = [...new Set(safeLpOrders.map(o => o.stock_id))];

        // DELETE 먼저 (청크 단위 안전 삭제) → 그 다음 500개씩 청크 INSERT
        if (refreshLpOrders) {
          await this.safeDeleteLpOrders(affectedStockIds);
        }

        for (let i = 0; i < safeLpOrders.length; i += 500) {
          const chunk = safeLpOrders.slice(i, i + 500);
          promises.push(
            supabase.from('orders').insert(chunk).then(res => {
              if (res.error) console.error('[Engine] Failed to insert LP orders chunk:', res.error);
              return res;
            })
          );
        }
      }
    }



    // 5.3 유저 주문 잔량 Update
    for (const uOrder of userOrdersToUpdate) {
      promises.push(supabase.from('orders').update({ size: uOrder.size, status: uOrder.status }).eq('id', uOrder.id).then(res => res));
    }

    // 5.3.1 유저 예수금(cash) 원자적 회계 반영 — RPC 호출 (Race Condition 방지)
    for (const [userId, delta] of Object.entries(cashChanges)) {
      const roundedDelta = Math.round(delta);
      if (roundedDelta !== 0) {
        promises.push(
          supabase.rpc('increment_user_cash', { p_user_id: userId, p_delta: roundedDelta }).then(res => {
            if (res.error) console.error('[Engine] Failed RPC increment_user_cash:', res.error);
            return res;
          })
        );
      }
    }

    // 5.3.2 유저 보유 주식(holdings) 원자적 회계 반영 — RPC 호출 (Race Condition 방지)
    for (const [userId, stockMap] of Object.entries(holdingsChanges)) {
      for (const [stockId, delta] of Object.entries(stockMap)) {
        if (delta !== 0) {
          const refTrade = tradesToInsert.find(t => t.stock_id === stockId);
          const fillPrice = refTrade ? refTrade.price : 0;
          promises.push(
            supabase.rpc('update_user_holding', {
              p_user_id: userId,
              p_stock_id: stockId,
              p_qty_delta: delta,
              p_fill_price: fillPrice
            }).then(res => {
              if (res.error) console.error('[Engine] Failed RPC update_user_holding:', res.error);
              return res;
            })
          );
        }
      }
    }


    // 5.4 현재가 Update (자산별 테이블 구분 + KRX 틱/상하한가 정렬)
    for (const [sId, rawPrice] of Object.entries(updatedStocks)) {
      const stockItem = marketState.stocks.find((s: any) => s.id === sId);
      const bondItem = marketState.bonds.find((b: any) => b.id === sId);
      const commodityItem = marketState.commodities.find((c: any) => c.id === sId);

      if (stockItem) {
        const prevClose = Number(stockItem.previous_close || stockItem.previousClose || stockItem.current_price || 1000);
        let finalPrice = rawPrice;

        if (stockItem.market === 'domestic') {
          // KRX 상/하한가 (±30% 캡)
          const upper = this.alignToTickSize(prevClose * 1.30, 'stocks');
          const lower = this.alignToTickSize(prevClose * 0.70, 'stocks');
          finalPrice = Math.max(lower, Math.min(upper, this.alignToTickSize(rawPrice, 'stocks')));
        } else if (stockItem.market === 'overseas' || stockItem.market === 'europe') {
          // 해외 주식: 일간 변동 폭 안전 캡 (prevClose의 50% ~ 200%)
          const lower = Math.max(0.01, prevClose * 0.50);
          const upper = prevClose * 2.00;
          finalPrice = Math.max(lower, Math.min(upper, rawPrice));
        } else if (stockItem.market === 'bonds') {
          finalPrice = Math.max(80.00, Math.min(120.00, this.alignToTickSize(rawPrice, 'bonds')));
        } else {
          finalPrice = Math.max(1, this.alignToTickSize(rawPrice, 'stocks'));
        }

        promises.push(supabase.from('stocks').update({ current_price: finalPrice }).eq('id', sId).then(res => res));
        // 과거 주가 이력 기록 저장 (stock_price_history)
        promises.push(supabase.from('stock_price_history').insert({ stock_id: sId, price: finalPrice, volume: stockItem.volume || 0 }).then(res => res));
      } else if (bondItem) {
        const finalPrice = Math.max(80.00, Math.min(120.00, this.alignToTickSize(rawPrice, 'bonds')));
        promises.push(supabase.from('bonds').update({ current_price: finalPrice }).eq('id', sId).then(res => res));
      } else if (commodityItem) {
        const prevClose = Number(commodityItem.previous_close || commodityItem.current_price || 100);
        const finalPrice = Math.max(prevClose * 0.50, Math.min(prevClose * 2.00, rawPrice));
        promises.push(supabase.from('commodities').update({ current_price: finalPrice }).eq('id', sId).then(res => res));
      }
    }

    // 5.4.1 신규 원자재 시장 엔진 틱 가동 및 DB 정기 반영
    this.commodityEngine.nextTick();
    if (this.tickCount % 5 === 0) {
      const commodityUpdates = this.commodityEngine.getAllCommodities().map((c) => ({
        commodity_id: c.id,
        name: c.nameKo,
        category: c.category,
        unit: c.unit,
        tick_size: c.tickSize,
        current_price: c.currentPrice,
        previous_close: c.previousPrice,
        volume: c.volume,
      }));
      promises.push(
        supabase.from('commodities').upsert(commodityUpdates, { onConflict: 'commodity_id' }).then((res) => {
          if (res.error) console.error('[Engine] Commodity Upsert Error:', res.error);
          return res;
        })
      );
    }

    // 5.4.2 옵션 만기 정산 및 채권 쿠폰 지급 배치 실행 (50틱 주기)
    if (this.tickCount % 50 === 0) {
      this.settlementService.runDailySettlementBatch().catch((err) => {
        console.error('[Engine] Settlement Batch Error:', err);
      });
    }

     // 5.5 기관 포트폴리오 상태 동기화 (대시보드 용)
     const allAgentsToSync = [
       ...this.institutionalBots,
       ...this.pensionFundAgents,
       ...this.hedgeFundAgents,
       ...this.statArbAgents,
       ...this.commercialBankAgents,
       ...this.propDeskAgents,
       ...this.quantAgents,
       ...this.commercialHedgerAgents,
       ...this.optionsMMBots,
       ...this.ctaBots
     ];

    if (allAgentsToSync.length > 0) {
      const now = Date.now();
      const shouldUpsert = (now - this.lastPortfolioUpsertMs) >= this.PORTFOLIO_UPSERT_TTL_MS;
      if (shouldUpsert) {
        const portfoliosToUpsert = allAgentsToSync.map(bot => {
          const targetW = bot.calculateTargetWeights(marketState.sentiment, this.activeEvents);
          const krRatio = targetW.kr_equity || 0;
          const usRatio = targetW.us_equity || 0;
          const euRatio = targetW.eu_equity || 0;
          const totalEquityRatio = krRatio + usRatio + euRatio;
          
          let krVal = 0, usVal = 0, euVal = 0;
          if (totalEquityRatio > 0) {
            krVal = bot.currentPortfolio.stock * (krRatio / totalEquityRatio);
            usVal = bot.currentPortfolio.stock * (usRatio / totalEquityRatio);
            euVal = bot.currentPortfolio.stock * (euRatio / totalEquityRatio);
          } else {
            krVal = bot.currentPortfolio.stock;
          }

          return {
            bot_id: bot.botId,
            name: bot.agentConfig.name || bot.botId,
            total_capital: bot.capital,
            current_cash: bot.currentPortfolio.cash,
            current_stock: bot.currentPortfolio.stock,
            current_kr_equity: krVal,
            current_us_equity: usVal,
            current_eu_equity: euVal,
            current_bond: bot.currentPortfolio.bond,
            current_commodity: bot.currentPortfolio.commodity,
            current_derivatives: bot.currentPortfolio.derivatives || 0,
            target_weights: targetW,
            updated_at: new Date().toISOString()
          };
        });
        promises.push(supabase.from('institutional_portfolios').upsert(portfoliosToUpsert).then(res => res));
        this.lastPortfolioUpsertMs = now;
      }
    }

    try {
      await Promise.allSettled(promises);
    } catch (e) {
      console.error("[Engine] DB Batch Commit failed:", e);
    }
  }

  /**
   * 대용량 LP 주문 삭제 시 타임아웃(57014) 방지를 위한 안전 삭제 헬퍼
   */
  private async safeDeleteLpOrders(stockIds?: string[]) {
    try {
      if (stockIds && stockIds.length > 0) {
        const chunkSize = 40;
        for (let i = 0; i < stockIds.length; i += chunkSize) {
          const chunk = stockIds.slice(i, i + chunkSize);
          const { error } = await supabase
            .from('orders')
            .delete()
            .eq('is_lp', true)
            .in('stock_id', chunk);
          if (error) {
            console.warn('[Engine] Chunk delete warning:', error.message);
          }
        }
      } else {
        // 전 종목 LP 주문 청소: 배치로 삭제
        const { data: lpOrders } = await supabase
          .from('orders')
          .select('id')
          .eq('is_lp', true)
          .limit(1000);

        if (lpOrders && lpOrders.length > 0) {
          const ids = lpOrders.map(o => o.id);
          await supabase.from('orders').delete().in('id', ids);
        }
      }
    } catch (err) {
      console.warn('[Engine] safeDeleteLpOrders error:', err);
    }
  }

  /**
   * 봇 ID 기반 개별 에이전트 인스턴스 검색 헬퍼
   */
  private findAgentById(botId: string): any {
    const allAgents = [
      ...this.institutionalBots,
      ...this.pensionFundAgents,
      ...this.hedgeFundAgents,
      ...this.statArbAgents,
      ...this.commercialBankAgents,
      ...this.propDeskAgents,
      ...this.quantAgents,
      ...this.commercialHedgerAgents,
      ...this.retailSwarmAgents,
      ...this.optionsMMBots,
      ...this.ctaBots
    ];
    const found = allAgents.find(a => a.botId === botId || ((a as any).agentConfig && (a as any).agentConfig.id === botId));
    if (found) return found;

    // 단일 에이전트 체크
    if (this.asMarketMakerAgent && this.asMarketMakerAgent.botId === botId) return this.asMarketMakerAgent;
    if (this.adversarialAgent && this.adversarialAgent.botId === botId) return this.adversarialAgent;
    if (this.wallBreakerAgent && this.wallBreakerAgent.botId === botId) return this.wallBreakerAgent;

    return undefined;
  }

  private async updateExchangeRates() {
    try {
      const { data: rates, error } = await supabase.from('exchange_rates').select('*');
      if (error || !rates || rates.length === 0) {
        // 테이블이 존재하지 않거나 데이터가 없을 때 안전하게 반환 (에러 미노출)
        return;
      }

      const currencyLimits: Record<string, { min: number, max: number }> = {
        USD: { min: 1100, max: 1600 },
        EUR: { min: 1300, max: 1800 },
        JPY: { min: 7.0, max: 12.0 },
        CNY: { min: 160, max: 220 },
        GBP: { min: 1500, max: 2000 },
      };

      const updates = rates
        .filter(rate => rate.currency_code !== 'KRW')
        .map(rate => {
          const limits = currencyLimits[rate.currency_code] || { min: 1, max: 10000 };
          const changePct = 1 + (Math.random() - 0.5) * 0.002;
          let newRate = Number(rate.rate_to_krw) * changePct;
          newRate = Math.max(limits.min, Math.min(limits.max, newRate));
          return {
            currency_code: rate.currency_code,
            currency_name: rate.currency_name,
            rate_to_krw: parseFloat(newRate.toFixed(4)),
            updated_at: new Date().toISOString()
          };
        });

      if (updates.length > 0) {
        await supabase.from('exchange_rates').upsert(updates);
      }
    } catch (_err) {
      console.warn('[Engine] exchange_rates table not ready yet or update error skipped');
    }
  }

  private alignToTickSize(price: number, market?: string): number {
    if (price <= 0 || isNaN(price)) return 1;
    if (market === 'bonds' || (price >= 50 && price <= 150 && !Number.isInteger(price))) {
      const bPrice = Math.max(80.00, Math.min(120.00, Math.round(price * 100) / 100));
      return Number(bPrice.toFixed(2));
    }
    let tick = 1;
    if (price < 2000) tick = 1;
    else if (price < 5000) tick = 5;
    else if (price < 20000) tick = 10;
    else if (price < 50000) tick = 50;
    else if (price < 200000) tick = 100;
    else if (price < 500000) tick = 500;
    else tick = 1000;

    return Math.round(price / tick) * tick;
  }
}
