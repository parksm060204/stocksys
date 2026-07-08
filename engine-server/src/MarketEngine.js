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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketEngine = void 0;
const supabase_js_1 = require("@supabase/supabase-js");
const PensionFundAgent_1 = require("./bots/PensionFundAgent");
const CommercialBankAgent_1 = require("./bots/CommercialBankAgent");
const HedgeFundAgent_1 = require("./bots/HedgeFundAgent");
const PropDeskAgent_1 = require("./bots/PropDeskAgent");
const RetailSwarmAgent_1 = require("./bots/RetailSwarmAgent");
const MarketMakerAgent_1 = require("./bots/MarketMakerAgent");
const realWorldFetcher_1 = require("./realWorldFetcher");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
const supabase = (0, supabase_js_1.createClient)(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');
class MarketEngine {
    isRunning = false;
    tickIntervalMs = 1000;
    tickTimer = null;
    manipulationCheckTimer = null;
    activeEvents = [];
    pensionFunds = [];
    commercialBanks = [];
    hedgeFunds = [];
    propDesks = [];
    retailSwarms = [];
    marketMaker = new MarketMakerAgent_1.MarketMakerAgent();
    realWorldFetcher = new realWorldFetcher_1.RealWorldFetcher();
    constructor() { }
    injectEvent(event) {
        this.activeEvents.push(event);
        console.log(`[NEWS EVENT INJECTED] ${event.id}: Sector ${event.targetSector}, Impact ${event.impact}`);
    }
    async initializeBots() {
        console.log("Fetching bot configurations from Supabase...");
        const { data: botsData, error } = await supabase.from('bots_config').select('*');
        if (error || !botsData) {
            console.error("Failed to load bots config from DB:", error);
            return;
        }
        this.pensionFunds = [];
        this.commercialBanks = [];
        this.hedgeFunds = [];
        this.propDesks = [];
        this.retailSwarms = [];
        for (const bot of botsData) {
            const config = { id: bot.id, name: bot.name, type: bot.bot_type, capital: bot.capital, ...bot.traits };
            switch (bot.bot_type) {
                case 'PENSION_FUND':
                    this.pensionFunds.push(new PensionFundAgent_1.PensionFundAgent(config));
                    break;
                case 'COMMERCIAL_BANK':
                    this.commercialBanks.push(new CommercialBankAgent_1.CommercialBankAgent(config));
                    break;
                case 'HEDGE_FUND':
                    this.hedgeFunds.push(new HedgeFundAgent_1.HedgeFundAgent(config));
                    break;
                case 'PROP_DESK':
                    this.propDesks.push(new PropDeskAgent_1.PropDeskAgent(config));
                    break;
                case 'RETAIL_SWARM':
                    this.retailSwarms.push(new RetailSwarmAgent_1.RetailSwarmAgent(config));
                    break;
            }
        }
        console.log(`Successfully loaded ${botsData.length} bots (including Retail Swarms) from reality.`);
    }
    async start() {
        if (this.isRunning)
            return;
        await this.initializeBots();
        this.isRunning = true;
        console.log("🚀 Market Engine Started (1-second tick)...");
        this.tickTimer = setInterval(() => this.tick(), this.tickIntervalMs);
        // 10초마다 active_manipulations 테이블 폴링
        this.manipulationCheckTimer = setInterval(() => this.checkManipulations(), 10000);
    }
    stop() {
        this.isRunning = false;
        if (this.tickTimer)
            clearInterval(this.tickTimer);
        if (this.manipulationCheckTimer)
            clearInterval(this.manipulationCheckTimer);
        console.log("🛑 Market Engine Stopped.");
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
                    this.marketMaker.triggerManipulation(manip.stock_id, stockData.market_cap || 10000000000, stockData.current_price);
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
            const currentKSTHour = (new Date().getUTCHours() + 9) % 24;
            if (currentKSTHour < 18 || currentKSTHour >= 22.5) {
                return;
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
            let allOrders = [];
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
                }
                else {
                    bot.updateSentiment('RISK_ON');
                }
                const mockHoldings = { equity: 50000000000000, safeBonds: 30000000000000, highYield: 20000000000000 };
                allOrders.push(...bot.executeAggressiveSweep(marketState, mockHoldings));
            }
            for (const bot of this.propDesks) {
                allOrders.push(...bot.executeMarketMaking(marketState, marketState.orderBook, {}));
            }
            for (const bot of this.retailSwarms) {
                const mockHoldings = {};
                allOrders.push(...bot.executeSwarmBehavior(marketState, mockHoldings));
            }
            // Market Maker (세력) 주문 개입
            allOrders.push(...this.marketMaker.executeManipulation(marketState));
            if (allOrders.length > 0) {
                await this.processBatchOrders(allOrders, marketState);
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
        const [bonds, stocks, adminSettings] = await Promise.all([
            supabase.from('bonds').select('*'),
            supabase.from('stocks').select('*'),
            supabase.from('admin_settings').select('base_rate, market_sentiment').single()
        ]);
        // 현실의 US10Y 금리를 게임 내 기준 금리로 활용할 수 있도록 병합
        const baseRate = macroData ? macroData.us10yYield / 100 : (adminSettings.data?.base_rate || 0.025);
        return {
            bonds: bonds.data || [],
            stocks: stocks.data || [],
            adminBaseRate: baseRate,
            sentiment: adminSettings.data?.market_sentiment || 'NEUTRAL',
            orderBook: {},
            realWorldMacro: macroData,
            activeEvents: this.activeEvents
        };
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
            // 매수(Buy)는 가격 내림차순, 매도(Sell)는 가격 오름차순
            book.bids.sort((a, b) => b.price - a.price);
            book.asks.sort((a, b) => a.price - b.price);
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
                    if (highestBid.user_id && highestBid.is_lp === false) {
                        cashChanges[highestBid.user_id] = (cashChanges[highestBid.user_id] || 0) - (tradePrice * tradeSize);
                    }
                    if (lowestAsk.user_id && lowestAsk.is_lp === false) {
                        cashChanges[lowestAsk.user_id] = (cashChanges[lowestAsk.user_id] || 0) + (tradePrice * tradeSize);
                    }
                    highestBid.size -= tradeSize;
                    lowestAsk.size -= tradeSize;
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
exports.MarketEngine = MarketEngine;
//# sourceMappingURL=MarketEngine.js.map