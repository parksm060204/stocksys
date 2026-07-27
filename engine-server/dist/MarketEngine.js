"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketEngine = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const ExecutionTrader_1 = require("./bots/ExecutionTrader");
const AdversarialAgent_1 = require("./bots/AdversarialAgent");
const WallBreakerAgent_1 = require("./bots/WallBreakerAgent");
const OptionsMMAgent_1 = require("./bots/OptionsMMAgent");
const CommodityBots_1 = require("./bots/CommodityBots");
const QuantAgent_1 = require("./bots/QuantAgent");
const ASMarketMakerAgent_1 = require("./bots/ASMarketMakerAgent");
const RetailSwarmAgent_1 = require("./bots/RetailSwarmAgent");
const HedgeFundAgent_1 = require("./bots/HedgeFundAgent");
const StatArbAgent_1 = require("./bots/StatArbAgent");
const PensionFundAgent_1 = require("./bots/PensionFundAgent");
const CommercialBankAgent_1 = require("./bots/CommercialBankAgent");
const PropDeskAgent_1 = require("./bots/PropDeskAgent");
const realWorldFetcher_1 = require("./realWorldFetcher");
const EventBus_1 = require("./EventBus");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const supabase = (0, supabase_js_1.createClient)(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
class MarketEngine {
    isRunning = false;
    tickIntervalMs = 1000;
    tickTimer = null;
    manipulationCheckTimer = null;
    // SDE: Fundamental Value (Merton Jump-Diffusion)
    fundamentals = {};
    mjd_mu = 0.0; // 기본 드리프트
    mjd_sigma = 0.005; // 틱당 변동성
    mjd_lambda = 0.01; // 점프 발생 확률 (틱당 1%)
    mjd_jump_mu = 0; // 점프 평균 크기 (로그 정규)
    mjd_jump_sigma = 0.1; // 점프 크기 변동성
    // Hawkes Process 상태 변수
    hawkesIntensity = 0; // 초과 틱 강도
    mu = 0.5; // 베이스라인 강도 (약 2초 간격)
    alpha = 0.05; // 주문 1건당 증가하는 강도
    beta = 0.1; // 지수적 감쇠 계수
    lastTickTime = Date.now();
    activeEvents = [];
    institutionalBots = [];
    // Specific role bots
    optionsMMBots = [];
    ctaBots = [];
    adversarialAgent = new AdversarialAgent_1.AdversarialAgent();
    wallBreakerAgent = new WallBreakerAgent_1.WallBreakerAgent();
    asMarketMakerAgent = new ASMarketMakerAgent_1.ASMarketMakerAgent();
    // New bots
    retailSwarmAgents = [];
    hedgeFundAgents = [];
    statArbAgents = [];
    pensionFundAgents = [];
    commercialBankAgents = [];
    propDeskAgents = [];
    quantAgents = [];
    commercialHedgerAgents = [];
    realWorldFetcher = new realWorldFetcher_1.RealWorldFetcher();
    constructor() { }
    injectEvent(event) {
        this.activeEvents.push(event);
        EventBus_1.EventBus.publish('NEWS_ALERT', event);
        console.log(`[NEWS EVENT INJECTED] ${event.id}: Sector ${event.targetSector}, Impact ${event.impact}`);
    }
    async initializeBots() {
        console.log("Initializing Institutional Bots from DB...");
        this.institutionalBots = [];
        const { data: configs, error } = await supabase.from('bots_config').select('*');
        if (error || !configs || configs.length === 0) {
            console.error("Failed to load bots from DB or table is empty.");
            return;
        }
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
        for (const config of configs) {
            const botConfig = {
                id: config.id,
                name: config.name,
                type: config.bot_type,
                capital: config.capital,
                ...config.traits
            };
            if (config.bot_type === 'PENSION_FUND') {
                this.pensionFundAgents.push(new PensionFundAgent_1.PensionFundAgent(botConfig));
            }
            else if (config.bot_type === 'HEDGE_FUND') {
                const hedgeConfig = {
                    ...botConfig,
                    portfolioTarget: botConfig.portfolioTarget || { equity: 0.5, safeBonds: 0.3, highYield: 0.2 },
                    currentSentiment: botConfig.currentSentiment || 'NEUTRAL'
                };
                this.hedgeFundAgents.push(new HedgeFundAgent_1.HedgeFundAgent(hedgeConfig));
            }
            else if (config.bot_type === 'RETAIL_SWARM') {
                this.retailSwarmAgents.push(new RetailSwarmAgent_1.RetailSwarmAgent(botConfig));
            }
            else if (config.bot_type === 'STAT_ARB') {
                this.statArbAgents.push(new StatArbAgent_1.StatArbAgent(botConfig));
            }
            else if (config.bot_type === 'COMMERCIAL_BANK') {
                this.commercialBankAgents.push(new CommercialBankAgent_1.CommercialBankAgent(botConfig));
            }
            else if (config.bot_type === 'PROP_DESK') {
                this.propDeskAgents.push(new PropDeskAgent_1.PropDeskAgent(botConfig));
            }
            else if (config.bot_type === 'QUANT_FUND') {
                this.quantAgents.push(new QuantAgent_1.QuantAgent(botConfig));
            }
            else if (config.bot_type === 'COMMERCIAL_HEDGER') {
                this.commercialHedgerAgents.push(new CommodityBots_1.CommercialHedgerAgent(botConfig));
            }
            else {
                this.institutionalBots.push(new ExecutionTrader_1.ExecutionTrader(botConfig, config.capital));
            }
        }
        // 파생상품 특화 봇들은 기존 로직에 따라 하나씩 유지 (없으면 생성)
        if (this.optionsMMBots.length === 0) {
            this.optionsMMBots.push(new OptionsMMAgent_1.OptionsMMAgent({
                id: 'bot_options_mm_001', name: 'Gamma Squeezer MM', type: 'OPTIONS_MM', capital: 10000000000, reactionSpeed: 2, tradingStyle: 'DELTA_NEUTRAL', initialGammaNet: -50
            }));
        }
        if (this.ctaBots.length === 0) {
            this.ctaBots.push(new CommodityBots_1.CTAAgent({
                id: 'bot_cta_001', name: 'Macro CTA Fund', type: 'CTA_MOMENTUM', capital: 20000000000, reactionSpeed: 1, breakoutThreshold: 0.02, tradingStyle: 'SWEEP_AGGRESSIVE'
            }));
        }
        if (this.quantAgents.length === 0) {
            this.quantAgents.push(new QuantAgent_1.QuantAgent({
                id: 'bot_quant_001', name: 'Aladdin Quant Fund', type: 'QUANT_FUND', capital: 30000000000, reactionSpeed: 2, tradingStyle: 'INFORMED_TRADER'
            }));
        }
        if (this.commercialHedgerAgents.length === 0) {
            this.commercialHedgerAgents.push(new CommodityBots_1.CommercialHedgerAgent({
                id: 'bot_hedger_001', name: 'Chevron Commercial Hedger', type: 'COMMERCIAL_HEDGER', capital: 50000000000, targetCommodity: 'WTI_CRUDE', supportLevel: 75, resistanceLevel: 90, tradingStyle: 'LIMIT_HEAVY'
            }));
        }
        console.log(`Successfully loaded ${configs.length} master institutions from DB.`);
    }
    async start() {
        if (this.isRunning)
            return;
        await this.initializeBots();
        this.isRunning = true;
        console.log("🚀 Market Engine Started (Dynamic Tick via Hawkes Process)...");
        this.lastTickTime = Date.now();
        this.scheduleNextTick(2000);
        // 10초마다 active_manipulations 테이블 폴링
        this.manipulationCheckTimer = setInterval(() => this.checkManipulations(), 10000);
    }
    stop() {
        this.isRunning = false;
        if (this.tickTimer)
            clearTimeout(this.tickTimer);
        if (this.manipulationCheckTimer)
            clearInterval(this.manipulationCheckTimer);
        console.log("🛑 Market Engine Stopped.");
    }
    scheduleNextTick(delayMs) {
        if (!this.isRunning)
            return;
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
    async checkManipulations() {
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
        }
        catch (e) {
            // 테이블이 아직 없거나 오류 발생 시 무시 (Migration 필요)
        }
    }
    async tick() {
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
            // 1. 틱 시작 시점의 모든 미체결 주문(User + LP)을 가져와 orderBook 구성
            const { data: initialOrders } = await supabase.from('orders').select('*').eq('status', 'open');
            const orderBook = {};
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
                    }
                    else {
                        book.asks.push(order);
                    }
                }
                // 정렬
                for (const sId of Object.keys(orderBook)) {
                    orderBook[sId].bids.sort((a, b) => b.price - a.price);
                    orderBook[sId].asks.sort((a, b) => a.price - b.price);
                }
            }
            // 틱이 시작될 때마다 기존에 깔아둔 LP 호가(허수주문, 잔여 빙산 등)를 모두 걷어냅니다.
            // 이렇게 해야 호가창이 실시간으로 새롭게 깜빡이며(Spoofing 등) 업데이트됩니다.
            await supabase.from('orders').delete().eq('is_lp', true);
            await this.updateExchangeRates();
            const macroData = await this.realWorldFetcher.getMacroData();
            const marketState = await this.fetchMarketState(macroData);
            marketState.orderBook = orderBook;
            let allOrders = [];
            // 1. Update Fundamentals (Merton Jump-Diffusion)
            for (const stock of marketState.stocks) {
                if (!this.fundamentals[stock.id])
                    this.fundamentals[stock.id] = stock.current_price;
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
            // 2. 봇들에게서 주문 수집 (3-Tier Portfolio Logic)
            for (const bot of this.institutionalBots) {
                allOrders.push(...bot.evaluateMarketAndPlaceOrders(marketState));
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
                const cmd = (marketState.commodities || []).find((c) => c.commodity_id === bot.config.targetCommodity || c.id === bot.config.targetCommodity);
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
            // 적대적 에이전트(작전 세력) 개입
            allOrders.push(...this.adversarialAgent.executeManipulation(marketState));
            // WallBreakerAgent: 감마 스퀴즈 헌팅 (옵션 데이터 기반)
            const currentHour = (new Date().getUTCHours() + 9) % 24;
            const currentPrices = {};
            for (const s of marketState.stocks) {
                currentPrices[s.id] = s.current_price;
            }
            const optionsData = marketState.options_contracts || [];
            allOrders.push(...this.wallBreakerAgent.executeGammaSqueezeHunt({ hour: currentHour }, currentPrices, optionsData));
            // Macro Linkage: WTI Inflation Shock
            const wti = (marketState.commodities || []).find((c) => c.commodity_id === 'WTI_CRUDE');
            if (wti && wti.current_price >= 83.0 && !this.activeEvents.find(e => e.id === 'INFLATION_SHOCK')) {
                console.log(`🛢️ [MACRO SHOCK] WTI crude oil surged to ${wti.current_price}! Triggering INFLATION_SHOCK!`);
                EventBus_1.EventBus.publish('MARKET_SHOCK', { stockId: wti.id, volume: 0, pctChange: 0.1, marketState });
                this.injectEvent({
                    id: 'INFLATION_SHOCK',
                    targetSector: 'ALL',
                    impact: 'STRONG_NEGATIVE',
                    urgencyMultiplier: 3.0,
                    durationTicks: 60,
                    reliability: 1.0
                });
            }
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
        }
        catch (error) {
            console.error("Engine Tick Error:", error);
        }
    }
    async triggerRandomEvents() {
        // 1. Get all events
        const { data: events } = await supabase.from('player_events').select('*');
        if (!events || events.length === 0)
            return;
        // 2. Get random users (for demo, just all users who have cash < 100M to simulate stage 1)
        const { data: users } = await supabase.from('profiles').select('id, cash').lt('cash', 100000000).limit(5);
        if (!users || users.length === 0)
            return;
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
    async fetchMarketState(macroData) {
        const [bonds, stocks, commodities, adminSettings, optionsContracts] = await Promise.all([
            supabase.from('bonds').select('*'),
            supabase.from('stocks').select('*'),
            supabase.from('commodities').select('*'),
            supabase.from('admin_settings').select('base_rate, market_sentiment').single(),
            supabase.from('options_contracts').select('*') // WallBreakerAgent 및 OptionsMMAgent용
        ]);
        const baseRate = macroData ? macroData.us10yYield / 100 : (adminSettings.data?.base_rate || 0.025);
        const state = {
            bonds: bonds.data || [],
            stocks: stocks.data || [],
            commodities: commodities.data || [],
            options_contracts: optionsContracts.data || [],
            adminBaseRate: baseRate,
            sentiment: adminSettings.data?.market_sentiment || 'NEUTRAL',
            orderBook: {},
            realWorldMacro: macroData,
            activeEvents: this.activeEvents,
            fundamentals: this.fundamentals
        };
        if (Math.random() < 0.1)
            console.log(`[Debug] Fetched ${state.stocks.length} stocks, ${state.commodities.length} commodities, ${state.options_contracts.length} options.`);
        return state;
    }
    async processBatchOrders(lpOrders, marketState) {
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
        const orderBookByStock = {};
        const allCombinedOrders = [...(userOrders || []), ...lpOrders];
        for (const order of allCombinedOrders) {
            if (!orderBookByStock[order.stock_id]) {
                orderBookByStock[order.stock_id] = { bids: [], asks: [] };
            }
            if (order.side === 'buy') {
                orderBookByStock[order.stock_id].bids.push(order);
            }
            else {
                orderBookByStock[order.stock_id].asks.push(order);
            }
        }
        const tradesToInsert = [];
        const updatedStocks = {}; // stock_id -> new price
        const lpOrdersToInsert = [];
        const userOrdersToUpdate = [];
        const cashChanges = {}; // user_id -> net cash change
        // 3. 종목별 매칭 엔진 로직 (In-memory Matching)
        for (const stockId of Object.keys(orderBookByStock)) {
            const book = orderBookByStock[stockId];
            // 매수(Buy)는 가격 내림차순, 시간 오름차순 (먼저 온 주문 우선)
            // 매도(Sell)는 가격 오름차순, 시간 오름차순
            book.bids.sort((a, b) => {
                if (b.price !== a.price)
                    return b.price - a.price;
                return (a.created_at || '').localeCompare(b.created_at || '');
            });
            book.asks.sort((a, b) => {
                if (a.price !== b.price)
                    return a.price - b.price;
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
                        buyer_is_bot: highestBid.is_lp || false,
                        seller_is_bot: lowestAsk.is_lp || false,
                        created_at: new Date().toISOString()
                    });
                    // ✅ Fix: 체결 후 기관 봇 포트폴리오 실제 업데이트 (Optimistic Update 대체)
                    // LP 봇 주문이 체결됐을 때 해당 봇을 찾아 confirmExecution() 호출
                    // LP 봇 주문은 user_id가 null이므로 botId 메타데이터를 주문 객체에서 확인
                    // Maker/Taker asset class detection
                    const getAssetClass = (order) => {
                        if (order._assetClass)
                            return order._assetClass;
                        if (marketState.stocks.some((s) => s.id === order.stock_id))
                            return 'stock';
                        if (marketState.bonds.some((b) => b.id === order.stock_id))
                            return 'bond';
                        if (marketState.commodities.some((c) => c.id === order.stock_id))
                            return 'commodity';
                        return 'stock';
                    };
                    const bidAssetClass = getAssetClass(highestBid);
                    const askAssetClass = getAssetClass(lowestAsk);
                    if (highestBid.is_lp && highestBid._botId) {
                        const bot = this.findAgentById(highestBid._botId);
                        if (bot)
                            bot.confirmExecution(bidAssetClass, 'buy', tradeSize, tradePrice, highestBid.stock_id);
                    }
                    if (lowestAsk.is_lp && lowestAsk._botId) {
                        const bot = this.findAgentById(lowestAsk._botId);
                        if (bot)
                            bot.confirmExecution(askAssetClass, 'sell', tradeSize, tradePrice, lowestAsk.stock_id);
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
                        if (highestBid.id)
                            highestBid.status = 'filled';
                    }
                    if (lowestAsk.size === 0) {
                        book.asks.shift();
                        if (lowestAsk.id)
                            lowestAsk.status = 'filled';
                    }
                }
                else {
                    break;
                }
            }
            if (latestTradePrice) {
                updatedStocks[stockId] = latestTradePrice;
            }
            // 4. 매칭 후 남은(미체결) 주문들 분류
            for (const bid of book.bids) {
                if (!bid.id)
                    lpOrdersToInsert.push(bid);
            }
            for (const ask of book.asks) {
                if (!ask.id)
                    lpOrdersToInsert.push(ask);
            }
        }
        // 5. DB 일괄 트랜잭션 반영 (Batch Commit)
        const promises = [];
        // 5.1 체결 내역 Insert
        if (tradesToInsert.length > 0) {
            promises.push(supabase.from('trades').insert(tradesToInsert).then(res => res));
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
                is_lp: true,
                _botId: o._botId,
                _assetClass: o._assetClass
            }));
            promises.push(supabase.from('orders').insert(safeLpOrders).then(res => res));
        }
        // 5.3 유저 주문 잔량 Update
        for (const uOrder of userOrdersToUpdate) {
            promises.push(supabase.from('orders').update({ size: uOrder.size, status: uOrder.status }).eq('id', uOrder.id).then(res => res));
        }
        // 5.4 현재가 Update (자산별 테이블 구분)
        for (const [sId, newPrice] of Object.entries(updatedStocks)) {
            if (marketState.stocks.some((s) => s.id === sId)) {
                promises.push(supabase.from('stocks').update({ current_price: newPrice }).eq('id', sId).then(res => res));
            }
            else if (marketState.bonds.some((b) => b.id === sId)) {
                promises.push(supabase.from('bonds').update({ current_price: newPrice }).eq('id', sId).then(res => res));
            }
            else if (marketState.commodities.some((c) => c.id === sId)) {
                promises.push(supabase.from('commodities').update({ current_price: newPrice }).eq('id', sId).then(res => res));
            }
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
                }
                else {
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
        }
        try {
            await Promise.allSettled(promises);
        }
        catch (e) {
            console.error("[Engine] DB Batch Commit failed:", e);
        }
    }
    async updateExchangeRates() {
        try {
            const { data: rates, error } = await supabase.from('exchange_rates').select('*');
            if (error || !rates) {
                console.error('[Engine] Failed to fetch exchange rates:', error);
                return;
            }
            const currencyLimits = {
                USD: { min: 1100, max: 1600 },
                EUR: { min: 1300, max: 1800 },
                JPY: { min: 7.0, max: 12.0 },
                CNY: { min: 160, max: 220 },
                GBP: { min: 1500, max: 2000 },
            };
            for (const rate of rates) {
                if (rate.currency_code === 'KRW')
                    continue;
                const limits = currencyLimits[rate.currency_code] || { min: 1, max: 10000 };
                // 무작위 보행 (Random Walk): -0.1% ~ +0.1% 변동
                const changePct = 1 + (Math.random() - 0.5) * 0.002;
                let newRate = Number(rate.rate_to_krw) * changePct;
                // 실제 환율 범위를 벗어나지 않도록 클램프
                newRate = Math.max(limits.min, Math.min(limits.max, newRate));
                await supabase
                    .from('exchange_rates')
                    .update({ rate_to_krw: parseFloat(newRate.toFixed(4)), updated_at: new Date().toISOString() })
                    .eq('currency_code', rate.currency_code);
            }
        }
        catch (err) {
            console.error('[Engine] Error updating exchange rates:', err);
        }
    }
    findAgentById(botId) {
        let agent = this.institutionalBots.find(b => b.botId === botId);
        if (agent)
            return agent;
        agent = this.hedgeFundAgents.find(b => b.botId === botId);
        if (agent)
            return agent;
        agent = this.pensionFundAgents.find(b => b.botId === botId);
        if (agent)
            return agent;
        agent = this.statArbAgents.find(b => b.botId === botId);
        if (agent)
            return agent;
        agent = this.retailSwarmAgents.find(b => b.botId === botId);
        if (agent)
            return agent;
        agent = this.commercialBankAgents.find(b => b.botId === botId);
        if (agent)
            return agent;
        agent = this.propDeskAgents.find(b => b.botId === botId);
        if (agent)
            return agent;
        agent = this.optionsMMBots.find(b => b.botId === botId);
        if (agent)
            return agent;
        agent = this.ctaBots.find(b => b.botId === botId);
        if (agent)
            return agent;
        agent = this.quantAgents.find(b => b.botId === botId);
        if (agent)
            return agent;
        agent = this.commercialHedgerAgents.find(b => b.botId === botId);
        if (agent)
            return agent;
        // 단일 에이전트 체크
        if (this.asMarketMakerAgent && this.asMarketMakerAgent.botId === botId)
            return this.asMarketMakerAgent;
        if (this.adversarialAgent && this.adversarialAgent.botId === botId)
            return this.adversarialAgent;
        if (this.wallBreakerAgent && this.wallBreakerAgent.botId === botId)
            return this.wallBreakerAgent;
        return undefined;
    }
}
exports.MarketEngine = MarketEngine;
//# sourceMappingURL=MarketEngine.js.map