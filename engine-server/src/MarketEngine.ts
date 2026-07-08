import { createClient } from '@supabase/supabase-js';
import { PensionFundAgent } from './bots/PensionFundAgent';
import { CommercialBankAgent } from './bots/CommercialBankAgent';
import { HedgeFundAgent } from './bots/HedgeFundAgent';
import { PropDeskAgent } from './bots/PropDeskAgent';
import { RetailSwarmAgent } from './bots/RetailSwarmAgent';
import { AdversarialAgent } from './bots/AdversarialAgent';
import { ASMarketMakerAgent } from './bots/ASMarketMakerAgent';
import { StatArbAgent } from './bots/StatArbAgent';
import { OptionsMMAgent } from './bots/OptionsMMAgent';
import { QuantAgent } from './bots/QuantAgent';
import { RealWorldFetcher } from './realWorldFetcher';
import { EventBus } from './EventBus';
import type { MacroData } from './realWorldFetcher';
import type { MarketEvent } from './types';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

export class MarketEngine {
  private isRunning: boolean = false;
  private tickIntervalMs: number = 1000;
  private tickTimer: NodeJS.Timeout | null = null;
  private manipulationCheckTimer: NodeJS.Timeout | null = null;

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

  private pensionFunds: PensionFundAgent[] = [];
  private commercialBanks: CommercialBankAgent[] = [];
  private hedgeFunds: HedgeFundAgent[] = [];
  private propDesks: PropDeskAgent[] = [];
  private retailSwarms: RetailSwarmAgent[] = [];
  private statArbBots: StatArbAgent[] = [];
  private optionsMMBots: OptionsMMAgent[] = [];
  private quantBots: QuantAgent[] = [];
  private asMarketMakers: ASMarketMakerAgent[] = [];
  private adversarialAgent: AdversarialAgent = new AdversarialAgent();
  
  private realWorldFetcher: RealWorldFetcher = new RealWorldFetcher();

  constructor() {}

  public injectEvent(event: MarketEvent) {
    this.activeEvents.push(event);
    EventBus.publish('NEWS_ALERT', event);
    console.log(`[NEWS EVENT INJECTED] ${event.id}: Sector ${event.targetSector}, Impact ${event.impact}`);
  }

  public async initializeBots() {
    console.log("Fetching bot configurations from Supabase...");
    const { data: botsData, error } = await supabase.from('bots_config').select('*');
    
    if (error || !botsData) {
      console.error("Failed to load bots config from DB:", error);
      // DB가 없어도 시뮬레이션용 봇이 주입되도록 계속 진행합니다.
    }

    this.pensionFunds = [];
    this.commercialBanks = [];
    this.hedgeFunds = [];
    this.propDesks = [];
    this.retailSwarms = [];

    if (botsData) {
      for (const bot of botsData) {
        const config = { id: bot.id, name: bot.name, type: bot.bot_type, capital: bot.capital, ...bot.traits };
        
        switch(bot.bot_type) {
          case 'PENSION_FUND':
            this.pensionFunds.push(new PensionFundAgent(config));
            break;
          case 'COMMERCIAL_BANK':
            this.commercialBanks.push(new CommercialBankAgent(config));
            break;
          case 'HEDGE_FUND':
            this.hedgeFunds.push(new HedgeFundAgent(config));
            break;
          case 'PROP_DESK':
            this.propDesks.push(new PropDeskAgent(config as any));
            break;
          case 'RETAIL_SWARM':
            this.retailSwarms.push(new RetailSwarmAgent(config as any));
            break;
          case 'STAT_ARB':
            this.statArbBots.push(new StatArbAgent(config as any));
            break;
          case 'OPTIONS_MM':
            this.optionsMMBots.push(new OptionsMMAgent(config as any));
            break;
        }
      }
    }
    
    // DB에 없는 경우 강제로 1개씩 주입 (시뮬레이션 관측용)
    if (this.statArbBots.length === 0) {
      this.statArbBots.push(new StatArbAgent({
        id: 'bot_stat_arb_001', name: 'Quant ETF Arbitrage', type: 'STAT_ARB', capital: 5000000000, reactionSpeed: 5, tradingStyle: 'ARBITRAGE', basketTarget: 'TECH_TOP3', transCostThreshold: 0.005
      }));
    }
    if (this.optionsMMBots.length === 0) {
      this.optionsMMBots.push(new OptionsMMAgent({
        id: 'bot_options_mm_001', name: 'Gamma Squeezer MM', type: 'OPTIONS_MM', capital: 10000000000, reactionSpeed: 2, tradingStyle: 'DELTA_NEUTRAL', initialGammaNet: -50 // 거대한 숏 감마
      }));
    }
    if (this.quantBots.length === 0) {
      this.quantBots.push(new QuantAgent({
        id: 'bot_quant_001', name: 'Informed Quant Fund', type: 'QUANT_FUND', capital: 20000000000, reactionSpeed: 1, tradingStyle: 'INFORMED_TRADER'
      }));
    }
    if (this.asMarketMakers.length === 0) {
      this.asMarketMakers.push(new ASMarketMakerAgent());
    }

    console.log(`Successfully loaded ${botsData?.length || 0} bots (including Retail Swarms) from reality.`);
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
  }

  public stop() {
    this.isRunning = false;
    if (this.tickTimer) clearTimeout(this.tickTimer);
    if (this.manipulationCheckTimer) clearInterval(this.manipulationCheckTimer);
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
    } catch (e) {
      // 테이블이 아직 없거나 오류 발생 시 무시 (Migration 필요)
    }
  }

  private async tick() {
    try {
      const isMarketHoursOnly = process.env.MARKET_HOURS_ONLY === 'true';
      if (isMarketHoursOnly) {
        const currentKSTHour = (new Date().getUTCHours() + 9) % 24;
        if (currentKSTHour < 18 || currentKSTHour >= 22.5) {
          return; 
        }
      }

      // 틱 시작 시 이벤트 수명 차감
      this.activeEvents = this.activeEvents.filter(e => {
        e.durationTicks -= 1;
        return e.durationTicks > 0;
      });

      // 틱이 시작될 때마다 기존에 깔아둔 LP 호가(허수주문, 잔여 빙산 등)를 모두 걷어냅니다.
      // 이렇게 해야 호가창이 실시간으로 새롭게 깜빡이며(Spoofing 등) 업데이트됩니다.
      await supabase.from('orders').delete().eq('is_lp', true);

      const macroData = await this.realWorldFetcher.getMacroData();
      const marketState = await this.fetchMarketState(macroData);
      
      let allOrders: any[] = [];

      // 1. Update Fundamentals (Merton Jump-Diffusion)
      for (const stock of marketState.stocks) {
        if (!this.fundamentals[stock.id]) this.fundamentals[stock.id] = stock.current_price;
        let F = this.fundamentals[stock.id];
        
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

      // 2. 봇들에게서 주문 수집
      for (const bot of this.pensionFunds) {
        allOrders.push(...bot.evaluateMarketAndPlaceOrders(marketState));
      }
      for (const bot of this.commercialBanks) {
        allOrders.push(...bot.executeArbitrage(marketState, marketState.adminBaseRate));
      }
      for (const bot of this.hedgeFunds) {
        // VIX 지수에 따른 Risk-On/Off 전환 로직 (VIX 25 이상이면 공포)
        if (macroData && macroData.vix > 25) {
          bot.updateSentiment('RISK_OFF');
        } else {
          bot.updateSentiment('RISK_ON');
        }
        
        allOrders.push(...bot.executeAggressiveSweep(marketState));
      }
      for (const bot of this.propDesks) {
        allOrders.push(...bot.executeMarketMaking(marketState, marketState.orderBook, {}));
      }
      for (const bot of this.retailSwarms) {
        const mockHoldings = {};
        allOrders.push(...bot.executeSwarmBehavior(marketState, mockHoldings));
      }
      for (const bot of this.statArbBots) {
        allOrders.push(...bot.executeArbitrage(marketState, {}));
      }
      for (const bot of this.optionsMMBots) {
        allOrders.push(...bot.executeDeltaHedging(marketState, marketState.orderBook));
      }
      for (const bot of this.quantBots) {
        allOrders.push(...bot.executeQuantStrategy(marketState, marketState.orderBook));
      }
      
      for (const bot of this.asMarketMakers) {
        allOrders.push(...bot.executeMarketMaking(marketState));
      }
      
      // 적대적 에이전트(작전 세력) 개입
      allOrders.push(...this.adversarialAgent.executeManipulation(marketState));

      if (allOrders.length > 0) {
        await this.processBatchOrders(allOrders, marketState);
        
        // 자체 여기(Self-excitation) 발생: 주문량에 비례하여 강도 증가
        this.hawkesIntensity += this.alpha * allOrders.length;
        
        if (this.hawkesIntensity > 5) { // 강도가 극단적으로 높아지면 경고 로그
          console.log(`[Hawkes] Flash Crash Detected! Orders: ${allOrders.length}, Intensity: ${this.hawkesIntensity.toFixed(2)}`);
        }
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
    const [bonds, stocks, adminSettings] = await Promise.all([
      supabase.from('bonds').select('*'),
      supabase.from('stocks').select('*'),
      supabase.from('admin_settings').select('base_rate, market_sentiment').single()
    ]);

    // 현실의 US10Y 금리를 게임 내 기준 금리로 활용할 수 있도록 병합
    const baseRate = macroData ? macroData.us10yYield / 100 : (adminSettings.data?.base_rate || 0.025);

    const state = {
      bonds: bonds.data || [],
      stocks: stocks.data || [],
      adminBaseRate: baseRate,
      sentiment: adminSettings.data?.market_sentiment || 'NEUTRAL',
      orderBook: {},
      realWorldMacro: macroData,
      activeEvents: this.activeEvents,
      fundamentals: this.fundamentals
    };
    if (Math.random() < 0.1) console.log(`[Debug] Fetched ${state.stocks.length} stocks from DB.`);
    return state;
  }

  private async processBatchOrders(lpOrders: any[], marketState: any) {
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
          const tradePrice = lowestAsk.price;
          latestTradePrice = tradePrice;

          tradesToInsert.push({
            stock_id: stockId,
            price: tradePrice,
            size: tradeSize,
            buyer_id: highestBid.user_id || null,
            seller_id: lowestAsk.user_id || null,
            created_at: new Date().toISOString()
          });

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
            cashChanges[highestBid.user_id] = (cashChanges[highestBid.user_id] || 0) - (tradePrice * tradeSize * (1 + bidFeeRate));
          }
          if (lowestAsk.user_id && lowestAsk.is_lp === false) {
            // 매도자는 체결 대금 획득 - 수수료 차감
            cashChanges[lowestAsk.user_id] = (cashChanges[lowestAsk.user_id] || 0) + (tradePrice * tradeSize * (1 - askFeeRate));
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

    // 5. DB 일괄 트랜잭션 반영 (Batch Commit)
    // 5.1 체결 내역 Insert
    if (tradesToInsert.length > 0) {
      await supabase.from('trades').insert(tradesToInsert);
    }

    // 5.2 LP 잔여 주문 Insert
    if (lpOrdersToInsert.length > 0) {
      // is_lp가 명시되지 않은 객체가 있을 수 있으므로 방어 코드 추가
      const safeLpOrders = lpOrdersToInsert.map(o => ({
        stock_id: o.stock_id,
        user_id: null,
        side: o.side,
        price: o.price,
        size: o.size,
        status: 'open',
        is_lp: true
      }));
      await supabase.from('orders').insert(safeLpOrders);
    }

    // 5.3 유저 주문 잔량 Update
    for (const uOrder of userOrdersToUpdate) {
      await supabase.from('orders').update({ size: uOrder.size, status: uOrder.status }).eq('id', uOrder.id);
    }

    // 5.4 주식 현재가 Update
    for (const [sId, newPrice] of Object.entries(updatedStocks)) {
      await supabase.from('stocks').update({ current_price: newPrice }).eq('id', sId);
    }
  }
}
