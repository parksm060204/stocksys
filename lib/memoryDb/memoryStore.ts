import { COMMODITY_DEFINITIONS } from '../commodities/definitions';

export interface StockRecord {
  id: string;
  ticker: string;
  name: string;
  market: string;
  current_price: number;
  previous_close: number;
  open_price: number;
  high_price: number;
  low_price: number;
  volume: number;
  change_rate: number;
  market_cap: number;
  pe_ratio: number;
  dividend_yield: number;
  sector: string;
}

export interface CommodityRecord {
  id: string;
  commodity_id: string;
  ticker: string;
  name: string;
  category: string;
  current_price: number;
  previous_close: number;
  unit: string;
  tick_size: number;
  volume: number;
  open_price: number;
  high_price: number;
  low_price: number;
}

export interface ProfileRecord {
  id: string;
  user_id: string;
  username: string;
  nickname: string;
  cash: number;
  net_worth: number;
  rank_tier: string;
  created_at: string;
}

export interface HoldingRecord {
  id: string;
  user_id: string;
  stock_id: string;
  quantity: number;
  avg_price: number;
  created_at: string;
}

export interface OrderRecord {
  id: string;
  stock_id: string;
  user_id?: string | null;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  filled: number;
  status: 'open' | 'partial' | 'filled' | 'cancelled' | 'expired';
  is_lp: boolean;
  created_at: string;
}

export interface TradeRecord {
  id: string;
  stock_id: string;
  buyer_id?: string | null;
  seller_id?: string | null;
  buyer_is_bot: boolean;
  seller_is_bot: boolean;
  price: number;
  size: number;
  created_at: string;
}

export interface OptionContractRecord {
  id: string;
  underlying_stock_id: string;
  ticker: string;
  asset_class: string;
  type: 'CALL' | 'PUT';
  option_type: 'CALL' | 'PUT';
  strike_price: number;
  current_price: number;
  expiry_date: string;
  open_interest: number;
  volume: number;
  delta: number;
  gamma: number;
  theta: number;
  implied_volatility: number;
  created_at: string;
}

export interface BondRecord {
  id: string;
  ticker: string;
  name: string;
  bond_type: string;
  maturity: string;
  maturity_date?: string;
  coupon_rate: number;
  face_value: number;
  current_price: number;
  ytm: number;
  duration: number;
  volume: number;
}

export interface MarketNewsRecord {
  id: string;
  type: string;
  category: 'OFFICIAL' | 'RUMOR' | 'CORRECTION';
  publisher: string;
  title: string;
  content: string;
  target_sector?: string | null;
  target_ticker?: string | null;
  impact_score?: number;
  is_fake?: boolean;
  created_at: string;
}

export class MemoryDatabase {
  // ── 1. 기본 엔티티 스토어 (Primary Maps) ──
  public stocks: Map<string, StockRecord> = new Map();
  public commodities: Map<string, CommodityRecord> = new Map();
  public profiles: Map<string, ProfileRecord> = new Map();
  public holdings: Map<string, HoldingRecord> = new Map();
  public orders: Map<string, OrderRecord> = new Map();
  public trades: TradeRecord[] = [];
  public optionsContracts: Map<string, OptionContractRecord> = new Map();
  public bonds: Map<string, BondRecord> = new Map();
  public marketNews: MarketNewsRecord[] = [];
  public adminSettings: Map<string, any> = new Map();
  public optionSettlements: any[] = [];
  public bondCouponPayments: any[] = [];

  // ── 2. 보조 인덱스 계층 (Secondary Indexes for O(1) Lookups) ──
  public tickerIndex: Map<string, string> = new Map(); // ticker -> stockId
  public marketIndex: Map<string, Set<string>> = new Map(); // market -> Set<stockId>
  public commodityTickerIndex: Map<string, string> = new Map(); // ticker -> commodityId
  public commodityCategoryIndex: Map<string, Set<string>> = new Map(); // category -> Set<commodityId>
  public orderStockIndex: Map<string, Set<string>> = new Map(); // stock_id -> Set<orderId>
  public orderUserIndex: Map<string, Set<string>> = new Map(); // user_id -> Set<orderId>
  public tradeStockIndex: Map<string, TradeRecord[]> = new Map(); // stock_id -> TradeRecord[]
  public holdingUserIndex: Map<string, Set<string>> = new Map(); // user_id -> Set<holdingId>
  public profileUserIdIndex: Map<string, string> = new Map(); // user_id -> profileId

  // ── 3. 동시성 원자적 업데이트 락 큐 ──
  private lockQueues: Map<string, Promise<any>> = new Map();

  // ── 4. Pub/Sub 리스너 ──
  private listeners: Map<string, Set<(payload: any) => void>> = new Map();
  private symbolListeners: Map<string, Set<(payload: any) => void>> = new Map();

  constructor() {
    this.seedDefaultData();
    this.rebuildIndexes();
  }

  /**
   * 보조 인덱스 재구축 (초기화 및 스냅샷 복원 시 사용)
   */
  public rebuildIndexes(): void {
    this.tickerIndex.clear();
    this.marketIndex.clear();
    this.commodityTickerIndex.clear();
    this.commodityCategoryIndex.clear();
    this.orderStockIndex.clear();
    this.orderUserIndex.clear();
    this.tradeStockIndex.clear();
    this.holdingUserIndex.clear();
    this.profileUserIdIndex.clear();

    for (const s of this.stocks.values()) this.addStockToIndex(s);
    for (const c of this.commodities.values()) this.addCommodityToIndex(c);
    for (const o of this.orders.values()) this.addOrderToIndex(o);
    for (const t of this.trades) this.addTradeToIndex(t);
    for (const h of this.holdings.values()) this.addHoldingToIndex(h);
    for (const p of this.profiles.values()) this.addProfileToIndex(p);
  }

  // ── 인덱스 동기화 헬퍼 메서드 ──
  public addStockToIndex(s: StockRecord): void {
    this.tickerIndex.set(s.ticker.toUpperCase(), s.id);
    if (!this.marketIndex.has(s.market)) this.marketIndex.set(s.market, new Set());
    this.marketIndex.get(s.market)!.add(s.id);
  }

  public removeStockFromIndex(s: StockRecord): void {
    this.tickerIndex.delete(s.ticker.toUpperCase());
    this.marketIndex.get(s.market)?.delete(s.id);
  }

  public addCommodityToIndex(c: CommodityRecord): void {
    this.commodityTickerIndex.set(c.ticker.toUpperCase(), c.id);
    if (!this.commodityCategoryIndex.has(c.category)) this.commodityCategoryIndex.set(c.category, new Set());
    this.commodityCategoryIndex.get(c.category)!.add(c.id);
  }

  public addOrderToIndex(o: OrderRecord): void {
    if (!this.orderStockIndex.has(o.stock_id)) this.orderStockIndex.set(o.stock_id, new Set());
    this.orderStockIndex.get(o.stock_id)!.add(o.id);

    if (o.user_id) {
      if (!this.orderUserIndex.has(o.user_id)) this.orderUserIndex.set(o.user_id, new Set());
      this.orderUserIndex.get(o.user_id)!.add(o.id);
    }
  }

  public removeOrderFromIndex(o: OrderRecord): void {
    this.orderStockIndex.get(o.stock_id)?.delete(o.id);
    if (o.user_id) this.orderUserIndex.get(o.user_id)?.delete(o.id);
  }

  public addTradeToIndex(t: TradeRecord): void {
    if (!this.tradeStockIndex.has(t.stock_id)) this.tradeStockIndex.set(t.stock_id, []);
    this.tradeStockIndex.get(t.stock_id)!.push(t);
  }

  public addHoldingToIndex(h: HoldingRecord): void {
    if (!this.holdingUserIndex.has(h.user_id)) this.holdingUserIndex.set(h.user_id, new Set());
    this.holdingUserIndex.get(h.user_id)!.add(h.id);
  }

  public removeHoldingFromIndex(h: HoldingRecord): void {
    this.holdingUserIndex.get(h.user_id)?.delete(h.id);
  }

  public addProfileToIndex(p: ProfileRecord): void {
    this.profileUserIdIndex.set(p.user_id, p.id);
  }

  /**
   * [원자적 업데이트] 비동기 경계 간 race condition을 방지하는 키 단위 락 큐
   */
  public async updateAtomic<T>(key: string, updater: (prev: T) => T | Promise<T>): Promise<T> {
    const prevPromise = this.lockQueues.get(key) || Promise.resolve();

    const currentPromise = prevPromise
      .then(async () => {
        let currentVal: any = null;
        if (key.startsWith('profile:')) {
          const id = key.replace('profile:', '');
          currentVal = this.profiles.get(id);
        } else if (key.startsWith('holding:')) {
          const id = key.replace('holding:', '');
          currentVal = this.holdings.get(id);
        }

        const nextVal = await updater(currentVal);

        if (key.startsWith('profile:')) {
          const id = key.replace('profile:', '');
          if (nextVal) {
            this.profiles.set(id, nextVal as unknown as ProfileRecord);
            this.addProfileToIndex(nextVal as unknown as ProfileRecord);
          }
        } else if (key.startsWith('holding:')) {
          const id = key.replace('holding:', '');
          if (nextVal) {
            this.holdings.set(id, nextVal as unknown as HoldingRecord);
            this.addHoldingToIndex(nextVal as unknown as HoldingRecord);
          }
        }

        return nextVal;
      })
      .finally(() => {
        if (this.lockQueues.get(key) === currentPromise) {
          this.lockQueues.delete(key);
        }
      });

    this.lockQueues.set(key, currentPromise);
    return currentPromise;
  }

  /**
   * 기본 시드 데이터 로드
   */
  public seedDefaultData(): void {
    const stockList: Partial<StockRecord>[] = [
      { ticker: '005930', name: '삼성전자', market: 'KR', current_price: 74200, previous_close: 73500, sector: '반도체' },
      { ticker: '000660', name: 'SK하이닉스', market: 'KR', current_price: 188500, previous_close: 185000, sector: '반도체' },
      { ticker: '035420', name: 'NAVER', market: 'KR', current_price: 192000, previous_close: 194000, sector: '플랫폼' },
      { ticker: '035720', name: '카카오', market: 'KR', current_price: 43500, previous_close: 43000, sector: '플랫폼' },
      { ticker: '005380', name: '현대차', market: 'KR', current_price: 245000, previous_close: 242000, sector: '자동차' },
      { ticker: '000270', name: '기아', market: 'KR', current_price: 118000, previous_close: 117500, sector: '자동차' },
      { ticker: '051910', name: 'LG화학', market: 'KR', current_price: 360000, previous_close: 365000, sector: '화학/배터리' },
      { ticker: '006400', name: '삼성SDI', market: 'KR', current_price: 380000, previous_close: 378000, sector: '2차전지' },
      { ticker: '373220', name: 'LG에너지솔루션', market: 'KR', current_price: 395000, previous_close: 392000, sector: '2차전지' },
      { ticker: '005490', name: 'POSCO홀딩스', market: 'KR', current_price: 375000, previous_close: 380000, sector: '철강/소재' },
      { ticker: 'AAPL', name: 'Apple Inc.', market: 'US', current_price: 224.5, previous_close: 220.0, sector: '빅테크' },
      { ticker: 'MSFT', name: 'Microsoft Corp.', market: 'US', current_price: 448.2, previous_close: 445.0, sector: '빅테크' },
      { ticker: 'NVDA', name: 'NVIDIA Corp.', market: 'US', current_price: 128.5, previous_close: 125.0, sector: 'AI 반도체' },
      { ticker: 'TSLA', name: 'Tesla Inc.', market: 'US', current_price: 215.8, previous_close: 210.0, sector: '전기차' },
      { ticker: 'GOOGL', name: 'Alphabet Inc.', market: 'US', current_price: 182.4, previous_close: 180.0, sector: '빅테크' },
      { ticker: 'AMZN', name: 'Amazon.com Inc.', market: 'US', current_price: 186.9, previous_close: 184.5, sector: '이커머스/클라우드' },
    ];

    stockList.forEach((s, idx) => {
      const id = `stock_${s.ticker}`;
      const cp = s.current_price || 10000;
      const pc = s.previous_close || cp;
      const cr = parseFloat((((cp - pc) / pc) * 100).toFixed(2));
      const record: StockRecord = {
        id,
        ticker: s.ticker || `TICK${idx}`,
        name: s.name || `종목${idx}`,
        market: s.market || 'KR',
        current_price: cp,
        previous_close: pc,
        open_price: pc,
        high_price: Math.max(cp, pc) * 1.02,
        low_price: Math.min(cp, pc) * 0.98,
        volume: 154000 + idx * 12000,
        change_rate: cr,
        market_cap: cp * 10000000,
        pe_ratio: 15.4,
        dividend_yield: 2.1,
        sector: s.sector || '기타',
      };
      this.stocks.set(id, record);
      this.addStockToIndex(record);
    });

    COMMODITY_DEFINITIONS.forEach((c) => {
      const record: CommodityRecord = {
        id: c.id,
        commodity_id: c.id,
        ticker: c.ticker,
        name: c.name,
        category: c.category,
        current_price: c.basePrice,
        previous_close: c.basePrice,
        unit: c.unit,
        tick_size: c.tickSize,
        volume: 5200,
        open_price: c.basePrice,
        high_price: c.basePrice * 1.01,
        low_price: c.basePrice * 0.99,
      };
      this.commodities.set(c.id, record);
      this.addCommodityToIndex(record);
    });

    const bondList: BondRecord[] = [
      { id: 'bond_kr_3y', ticker: 'KR3Y', name: '국고채 3년물', bond_type: 'govt', maturity: '3Y', coupon_rate: 3.25, face_value: 10000, current_price: 10020, ytm: 3.2, duration: 2.8, volume: 15000 },
      { id: 'bond_kr_10y', ticker: 'KR10Y', name: '국고채 10년물', bond_type: 'govt', maturity: '10Y', coupon_rate: 3.50, face_value: 10000, current_price: 9980, ytm: 3.52, duration: 8.5, volume: 8000 },
      { id: 'bond_us_10y', ticker: 'US10Y', name: '미국채 10년물', bond_type: 'govt', maturity: '10Y', coupon_rate: 4.25, face_value: 10000, current_price: 10000, ytm: 4.25, duration: 8.2, volume: 24000 },
      { id: 'bond_corp_aa', ticker: 'CORP_AA', name: '회사채 AA- 3년', bond_type: 'corp', maturity: '3Y', coupon_rate: 4.80, face_value: 10000, current_price: 10050, ytm: 4.75, duration: 2.7, volume: 5000 },
    ];
    bondList.forEach((b) => this.bonds.set(b.id, b));

    const expDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const optList: OptionContractRecord[] = [
      { id: 'opt_c_360', underlying_stock_id: 'stock_005930', ticker: 'C360', asset_class: 'STK', type: 'CALL', option_type: 'CALL', strike_price: 360, current_price: 12.5, expiry_date: expDate, open_interest: 450, volume: 120, delta: 0.65, gamma: 0.04, theta: -0.15, implied_volatility: 0.22, created_at: new Date().toISOString() },
      { id: 'opt_p_360', underlying_stock_id: 'stock_005930', ticker: 'P360', asset_class: 'STK', type: 'PUT', option_type: 'PUT', strike_price: 360, current_price: 8.2, expiry_date: expDate, open_interest: 380, volume: 95, delta: -0.35, gamma: 0.04, theta: -0.12, implied_volatility: 0.21, created_at: new Date().toISOString() },
    ];
    optList.forEach((o) => this.optionsContracts.set(o.id, o));

    const guestUser: ProfileRecord = {
      id: 'guest_user',
      user_id: 'guest_user',
      username: '서학개미',
      nickname: '서학개미',
      cash: 100000000,
      net_worth: 100000000,
      rank_tier: 'Diamond',
      created_at: new Date().toISOString(),
    };
    this.profiles.set(guestUser.id, guestUser);
    this.addProfileToIndex(guestUser);

    this.marketNews = [
      {
        id: 'news_1',
        type: 'MACRO',
        category: 'OFFICIAL',
        publisher: '한국은행',
        title: '기준금리 3.50% 동결 결정',
        content: '금융통화위원회가 만장일치로 기준금리를 현행 3.50%로 유지하기로 결정했습니다.',
        target_sector: 'ALL',
        impact_score: 0.2,
        is_fake: false,
        created_at: new Date().toISOString(),
      },
    ];

    this.adminSettings.set('macro_regime', {
      regime: 'Normal',
      interestRate: 3.5,
      inflationRate: 2.4,
      vix: 14.2,
      updated_at: new Date().toISOString(),
    });
  }

  // ── 5. 스냅샷 내보내기 & 불러오기 ──
  public exportSnapshot(): Record<string, any> {
    return {
      stocks: Array.from(this.stocks.values()),
      commodities: Array.from(this.commodities.values()),
      profiles: Array.from(this.profiles.values()),
      holdings: Array.from(this.holdings.values()),
      orders: Array.from(this.orders.values()),
      trades: [...this.trades],
      optionsContracts: Array.from(this.optionsContracts.values()),
      bonds: Array.from(this.bonds.values()),
      marketNews: [...this.marketNews],
      adminSettings: Array.from(this.adminSettings.entries()),
      optionSettlements: [...this.optionSettlements],
      bondCouponPayments: [...this.bondCouponPayments],
      timestamp: Date.now(),
    };
  }

  public importSnapshot(data: Record<string, any>): void {
    if (!data) return;

    if (Array.isArray(data.stocks)) {
      this.stocks.clear();
      data.stocks.forEach((s: StockRecord) => this.stocks.set(s.id, s));
    }
    if (Array.isArray(data.commodities)) {
      this.commodities.clear();
      data.commodities.forEach((c: CommodityRecord) => this.commodities.set(c.id, c));
    }
    if (Array.isArray(data.profiles)) {
      this.profiles.clear();
      data.profiles.forEach((p: ProfileRecord) => this.profiles.set(p.id, p));
    }
    if (Array.isArray(data.holdings)) {
      this.holdings.clear();
      data.holdings.forEach((h: HoldingRecord) => this.holdings.set(h.id, h));
    }
    if (Array.isArray(data.orders)) {
      this.orders.clear();
      data.orders.forEach((o: OrderRecord) => this.orders.set(o.id, o));
    }
    if (Array.isArray(data.trades)) {
      this.trades = [...data.trades];
    }
    if (Array.isArray(data.bonds)) {
      this.bonds.clear();
      data.bonds.forEach((b: BondRecord) => this.bonds.set(b.id, b));
    }
    if (Array.isArray(data.optionsContracts)) {
      this.optionsContracts.clear();
      data.optionsContracts.forEach((o: OptionContractRecord) => this.optionsContracts.set(o.id, o));
    }
    if (Array.isArray(data.marketNews)) {
      this.marketNews = [...data.marketNews];
    }

    this.rebuildIndexes();
  }

  // ── 6. Pub/Sub 리스너 ──
  public subscribe(channel: string, callback: (payload: any) => void): () => void {
    if (!this.listeners.has(channel)) {
      this.listeners.set(channel, new Set());
    }
    this.listeners.get(channel)!.add(callback);
    return () => {
      this.listeners.get(channel)?.delete(callback);
    };
  }

  public subscribeSymbol(symbolId: string, callback: (payload: any) => void): () => void {
    if (!this.symbolListeners.has(symbolId)) {
      this.symbolListeners.set(symbolId, new Set());
    }
    this.symbolListeners.get(symbolId)!.add(callback);
    return () => {
      this.symbolListeners.get(symbolId)?.delete(callback);
    };
  }

  public publish(channel: string, payload: any): void {
    this.listeners.get(channel)?.forEach((cb) => {
      try {
        cb(payload);
      } catch (e) {
        console.error(`[MemoryDB] Listener error on channel ${channel}:`, e);
      }
    });

    if (payload?.stock_id || payload?.symbolId) {
      const sym = payload.stock_id || payload.symbolId;
      this.symbolListeners.get(sym)?.forEach((cb) => {
        try {
          cb(payload);
        } catch {}
      });
    }
  }
}

export const memoryDb = new MemoryDatabase();
