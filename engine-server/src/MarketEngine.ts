import { createClient } from '@supabase/supabase-js';
import { PensionFundAgent } from './bots/PensionFundAgent';
import { CommercialBankAgent } from './bots/CommercialBankAgent';
import { HedgeFundAgent } from './bots/HedgeFundAgent';
import { PropDeskAgent } from './bots/PropDeskAgent';
import { RetailSwarmAgent } from './bots/RetailSwarmAgent';
import { RealWorldFetcher, MacroData } from './realWorldFetcher';
import type { MarketEvent } from './types';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

export class MarketEngine {
  private isRunning: boolean = false;
  private tickIntervalMs: number = 1000;
  private tickTimer: NodeJS.Timeout | null = null;

  private activeEvents: MarketEvent[] = [];

  private pensionFunds: PensionFundAgent[] = [];
  private commercialBanks: CommercialBankAgent[] = [];
  private hedgeFunds: HedgeFundAgent[] = [];
  private propDesks: PropDeskAgent[] = [];
  private retailSwarms: RetailSwarmAgent[] = [];
  
  private realWorldFetcher: RealWorldFetcher = new RealWorldFetcher();

  constructor() {}

  public injectEvent(event: MarketEvent) {
    this.activeEvents.push(event);
    console.log(`[NEWS EVENT INJECTED] ${event.id}: Sector ${event.targetSector}, Impact ${event.impact}`);
  }

  public async initializeBots() {
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
      }
    }
    console.log(`Successfully loaded ${botsData.length} bots (including Retail Swarms) from reality.`);
  }

  public async start() {
    if (this.isRunning) return;
    await this.initializeBots();
    this.isRunning = true;
    console.log("🚀 Market Engine Started (1-second tick)...");
    this.tickTimer = setInterval(() => this.tick(), this.tickIntervalMs);
  }

  public stop() {
    this.isRunning = false;
    if (this.tickTimer) clearInterval(this.tickTimer);
    console.log("🛑 Market Engine Stopped.");
  }

  private async tick() {
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
      
      let allOrders: any[] = [];

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

      if (allOrders.length > 0) {
        await this.processBatchOrders(allOrders, marketState);
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
        orderBookByStock[order.stock_id].bids.push(order);
      } else {
        orderBookByStock[order.stock_id].asks.push(order);
      }
    }

    const tradesToInsert: any[] = [];
    const updatedStocks: Record<string, number> = {}; // stock_id -> new price
    const lpOrdersToInsert: any[] = [];
    const userOrdersToUpdate: any[] = [];
    const cashChanges: Record<string, number> = {}; // user_id -> net cash change

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
