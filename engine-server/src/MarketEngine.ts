import { createClient } from '@supabase/supabase-js';
import { PensionFundAgent } from './bots/PensionFundAgent';
import { CommercialBankAgent } from './bots/CommercialBankAgent';
import { HedgeFundAgent } from './bots/HedgeFundAgent';
import { PropDeskAgent } from './bots/PropDeskAgent';
import * as dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.SUPABASE_SERVICE_ROLE_KEY || '');

export class MarketEngine {
  private isRunning: boolean = false;
  private tickIntervalMs: number = 1000;
  private tickTimer: NodeJS.Timeout | null = null;

  private pensionFunds: PensionFundAgent[] = [];
  private commercialBanks: CommercialBankAgent[] = [];
  private hedgeFunds: HedgeFundAgent[] = [];
  private propDesks: PropDeskAgent[] = [];

  constructor() {
    this.initializeBots();
  }

  private initializeBots() {
    this.pensionFunds.push(new PensionFundAgent({ 
      id: 'bot_pf_01', name: '국민노후보장기금', type: 'PENSION_FUND', 
      capital: 100000000000000, riskTolerance: 0.1, tradingStyle: 'LIMIT_HEAVY', 
      targetYTM: { '10Y_BOND': 0.035, '30Y_BOND': 0.040, 'AAA_CORP': 0.045 }, rebalanceIntervalMs: 60000 
    }));
    
    this.commercialBanks.push(new CommercialBankAgent({ 
      id: 'bot_cb_01', name: '미래제일은행', type: 'COMMERCIAL_BANK', 
      capital: 50000000000000, reactionSpeed: 1000, tradingStyle: 'SWEEP_AGGRESSIVE', 
      targetSpread: { '1Y_BOND': 0.005, '3Y_BOND': 0.010, '1Y_CORP': 0.020 } 
    }));
    
    this.hedgeFunds.push(new HedgeFundAgent({ 
      id: 'bot_hf_01', name: '블랙록 IB', type: 'HEDGE_FUND', 
      capital: 200000000000000, reactionSpeed: 500, tradingStyle: 'SWEEP_AGGRESSIVE', 
      portfolioTarget: { equity: 0.5, safeBonds: 0.3, highYield: 0.2 }, currentSentiment: 'NEUTRAL' 
    }));
    
    this.propDesks.push(new PropDeskAgent({ 
      id: 'bot_pd_01', name: '키움증권 프랍', type: 'PROP_DESK', 
      capital: 10000000000000, reactionSpeed: 300, tradingStyle: 'MARKET_MAKER', 
      mmConfig: { maxInventory: 50000, targetSpreadHoga: 2, tickProfitTarget: 1 } 
    }));
  }

  public start() {
    if (this.isRunning) return;
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

      const marketState = await this.fetchMarketState();
      let allOrders: any[] = [];

      for (const bot of this.pensionFunds) {
        allOrders.push(...bot.evaluateMarketAndPlaceOrders(marketState));
      }
      for (const bot of this.commercialBanks) {
        allOrders.push(...bot.executeArbitrage(marketState, marketState.adminBaseRate));
      }
      for (const bot of this.hedgeFunds) {
        const mockHoldings = { equity: 50000000000000, safeBonds: 30000000000000, highYield: 20000000000000 };
        allOrders.push(...bot.executeAggressiveSweep(marketState, mockHoldings));
      }
      for (const bot of this.propDesks) {
        allOrders.push(...bot.executeMarketMaking(marketState, marketState.orderBook, {}));
      }

      if (allOrders.length > 0) {
        await this.processBatchOrders(allOrders);
      }
    } catch (error) {
      console.error("Engine Tick Error:", error);
    }
  }

  private async fetchMarketState() {
    const [bonds, stocks, adminSettings] = await Promise.all([
      supabase.from('bonds').select('*'),
      supabase.from('stocks').select('*'),
      supabase.from('admin_settings').select('base_rate, market_sentiment').single()
    ]);

    return {
      bonds: bonds.data || [],
      stocks: stocks.data || [],
      adminBaseRate: adminSettings.data?.base_rate || 0.025,
      sentiment: adminSettings.data?.market_sentiment || 'NEUTRAL',
      orderBook: {} 
    };
  }

  private async processBatchOrders(orders: any[]) {
    const { error } = await supabase.from('orders').insert(orders);
    if (error) {
      console.error("Batch Order Insert Failed:", error);
    } else {
      console.log(`Successfully batch inserted ${orders.length} orders.`);
    }
  }
}
