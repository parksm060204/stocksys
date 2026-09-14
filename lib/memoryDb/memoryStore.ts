import { COMMODITY_DEFINITIONS } from '../commodities/definitions';

// ── 고정 UUID 규격 (Production 스키마 완벽 호환) ──
export const GUEST_USER_ID = '00000000-0000-4000-8000-000000000001';

export const STOCK_UUID_MAP: Record<string, string> = {
  '0010': '00000000-0000-4000-8000-000000000101', // 오성전자
  '0015': '00000000-0000-4000-8000-000000000102', // 미래자동차
  '0020': '00000000-0000-4000-8000-000000000103', // 에코에너지
  '0025': '00000000-0000-4000-8000-000000000104', // NVC
  '0030': '00000000-0000-4000-8000-000000000105', // KKA
  '000660': '00000000-0000-4000-8000-000000000106', // SK하이닉스
  '035420': '00000000-0000-4000-8000-000000000107', // NAVER
  '035720': '00000000-0000-4000-8000-000000000108', // 카카오
  '105560': '00000000-0000-4000-8000-000000000109', // KB금융
  '068270': '00000000-0000-4000-8000-000000000110', // 셀트리온
  '017670': '00000000-0000-4000-8000-000000000111', // SK텔레콤
  '005930': '00000000-0000-4000-8000-000000000112', // 삼성전자
  '005380': '00000000-0000-4000-8000-000000000113', // 현대차
  'AAPL': '00000000-0000-4000-8000-000000000201', // 파인애플
  'MSFT': '00000000-0000-4000-8000-000000000202', // 매크로소프트
  'NVDA': '00000000-0000-4000-8000-000000000203', // 엔비디아스
  'TSLA': '00000000-0000-4000-8000-000000000204', // 와트 모빌리티
  'GOOGL': '00000000-0000-4000-8000-000000000205', // 구골
  'ASML': '00000000-0000-4000-8000-000000000301', // ADML
  'SAP': '00000000-0000-4000-8000-000000000302', // SAP 넥스트
  'KODEX200': '00000000-0000-4000-8000-000000000401',
  'KODEXLEV': '00000000-0000-4000-8000-000000000402',
  'KODEXINV': '00000000-0000-4000-8000-000000000403',
  'SPY': '00000000-0000-4000-8000-000000000404',
  'QQQ': '00000000-0000-4000-8000-000000000405',
  'TQQQ': '00000000-0000-4000-8000-000000000406',
};

export interface StockRecord {
  id: string;
  ticker: string;
  name: string;
  market: string;
  current_price: number;
  previous_close: number;
  open_price: number;
  high: number;
  low: number;
  volume: number;
  change_rate: number;
  market_cap: number;
  pe_ratio: number;
  dividend_yield: number;
  sector: string;
  is_core?: boolean;
  // 하위 호환용 optional alias
  high_price?: number;
  low_price?: number;
}

export interface StockPriceHistoryRecord {
  id: string;
  stock_id: string;
  price: number;
  recorded_at: string;
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
  email?: string;
  cash: number;
  net_worth: number;
  rank_tier: string;
  usd_balance?: number;
  eur_balance?: number;
  jpy_balance?: number;
  cny_balance?: number;
  gbp_balance?: number;
  is_admin?: boolean;
  unlocked_features?: string[];
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
  buyer_fee?: number;
  seller_fee?: number;
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
  public stockPriceHistory: StockPriceHistoryRecord[] = [];
  public commodities: Map<string, CommodityRecord> = new Map();
  public profiles: Map<string, ProfileRecord> = new Map();
  public holdings: Map<string, HoldingRecord> = new Map();
  public orders: Map<string, OrderRecord> = new Map();
  public trades: TradeRecord[] = [];
  public optionsContracts: Map<string, OptionContractRecord> = new Map();
  public bonds: Map<string, BondRecord> = new Map();
  public marketNews: MarketNewsRecord[] = [];
  public adminSettings: Map<string, any> = new Map();
  public exchangeRates: any[] = [];
  public institutionalPortfolios: Map<string, any> = new Map();
  public playerEvents: any[] = [];
  public activePlayerEvents: any[] = [];
  public activeManipulations: any[] = [];
  public botsConfig: any[] = [];
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
   * 기본 시드 데이터 로드 (고정 UUID 규격 적용)
   */
  public seedDefaultData(): void {
    const stockList: { ticker: string; name: string; market: string; current_price: number; previous_close: number; sector: string; is_core?: boolean }[] = [
      // 국내 주요 종목 (사용자 지정 종목 포함)
      { ticker: '0010', name: '오성전자', market: 'domestic', current_price: 72000, previous_close: 71500, sector: '반도체', is_core: true },
      { ticker: '0015', name: '미래자동차', market: 'domestic', current_price: 210000, previous_close: 209000, sector: '자동차', is_core: true },
      { ticker: '0020', name: '에코에너지', market: 'domestic', current_price: 45000, previous_close: 44800, sector: '에너지', is_core: false },
      { ticker: '0025', name: 'NVC', market: 'domestic', current_price: 185000, previous_close: 184500, sector: 'IT', is_core: false },
      { ticker: '0030', name: 'KKA', market: 'domestic', current_price: 52000, previous_close: 51800, sector: '통신', is_core: false },
      { ticker: '000660', name: 'SK하이닉스', market: 'domestic', current_price: 188500, previous_close: 185000, sector: '반도체', is_core: true },
      { ticker: '035420', name: 'NAVER', market: 'domestic', current_price: 192000, previous_close: 194000, sector: '플랫폼', is_core: true },
      { ticker: '035720', name: '카카오', market: 'domestic', current_price: 43500, previous_close: 43000, sector: '플랫폼', is_core: false },
      { ticker: '105560', name: 'KB금융', market: 'domestic', current_price: 78000, previous_close: 77500, sector: '금융', is_core: true },
      { ticker: '068270', name: '셀트리온', market: 'domestic', current_price: 182000, previous_close: 181000, sector: '바이오', is_core: true },
      { ticker: '017670', name: 'SK텔레콤', market: 'domestic', current_price: 53000, previous_close: 52800, sector: '통신', is_core: false },
      { ticker: '005930', name: '삼성전자', market: 'domestic', current_price: 74200, previous_close: 73500, sector: '반도체', is_core: true },
      { ticker: '005380', name: '현대차', market: 'domestic', current_price: 245000, previous_close: 242000, sector: '자동차', is_core: true },
      // 해외 종목 (미국)
      { ticker: 'AAPL', name: '파인애플', market: 'overseas', current_price: 185.5, previous_close: 185.2, sector: 'IT', is_core: true },
      { ticker: 'MSFT', name: '매크로소프트', market: 'overseas', current_price: 425.3, previous_close: 424.0, sector: '소프트웨어', is_core: true },
      { ticker: 'NVDA', name: '엔비디아스', market: 'overseas', current_price: 875.2, previous_close: 870.5, sector: '반도체', is_core: true },
      { ticker: 'TSLA', name: '와트 모빌리티', market: 'overseas', current_price: 248.5, previous_close: 247.8, sector: '자동차', is_core: false },
      { ticker: 'GOOGL', name: '구골', market: 'overseas', current_price: 141.2, previous_close: 140.9, sector: 'IT', is_core: false },
      // 유럽 종목
      { ticker: 'ASML', name: 'ADML', market: 'europe', current_price: 705.4, previous_close: 703.2, sector: '반도체', is_core: true },
      { ticker: 'SAP', name: 'SAP 넥스트', market: 'europe', current_price: 175.3, previous_close: 174.8, sector: '소프트웨어', is_core: false },
      // ETF
      { ticker: 'KODEX200', name: 'KODEX 200', market: 'etf', current_price: 35000, previous_close: 35000, sector: 'Index ETF', is_core: false },
      { ticker: 'KODEXLEV', name: 'KODEX 레버리지', market: 'etf', current_price: 17000, previous_close: 17000, sector: 'Leverage ETF', is_core: false },
      { ticker: 'KODEXINV', name: 'KODEX 인버스', market: 'etf', current_price: 4500, previous_close: 4500, sector: 'Inverse ETF', is_core: false },
      { ticker: 'SPY', name: 'SPDR S&P 500', market: 'etf', current_price: 500.0, previous_close: 500.0, sector: 'Index ETF', is_core: false },
      { ticker: 'QQQ', name: 'Invesco QQQ', market: 'etf', current_price: 430.0, previous_close: 430.0, sector: 'Index ETF', is_core: false },
      { ticker: 'TQQQ', name: 'ProShares UltraPro QQQ', market: 'etf', current_price: 60.0, previous_close: 60.0, sector: 'Leverage ETF', is_core: false },
    ];

    const now = Date.now();

    stockList.forEach((s, idx) => {
      // 고정 UUID 사용 (매핑 없으면 결정론적 UUID 생성)
      const id = STOCK_UUID_MAP[s.ticker] || `00000000-0000-4000-8000-${(1000 + idx).toString().padStart(12, '0')}`;
      const cp = s.current_price;
      const pc = s.previous_close;
      const cr = parseFloat((((cp - pc) / pc) * 100).toFixed(2));
      const record: StockRecord = {
        id,
        ticker: s.ticker,
        name: s.name,
        market: s.market,
        current_price: cp,
        previous_close: pc,
        open_price: pc,
        high: Math.max(cp, pc) * 1.015,
        low: Math.min(cp, pc) * 0.985,
        high_price: Math.max(cp, pc) * 1.015,
        low_price: Math.min(cp, pc) * 0.985,
        volume: 154000 + idx * 12000,
        change_rate: cr,
        market_cap: cp * (s.market === 'overseas' || s.market === 'europe' ? 2500000000 : 400000000),
        pe_ratio: 15.4,
        dividend_yield: 2.1,
        sector: s.sector,
        is_core: s.is_core ?? false,
      };
      this.stocks.set(id, record);
      this.addStockToIndex(record);

      // 초기 가격 이력 20건 생성
      for (let h = 20; h >= 0; h--) {
        const randJitter = (Math.sin(h * 0.5 + idx) * 0.008);
        const p = Math.round(cp * (1 + randJitter));
        this.stockPriceHistory.push({
          id: `hist_${id}_${h}`,
          stock_id: id,
          price: p,
          recorded_at: new Date(now - h * 60000).toISOString(),
        });
      }
    });

    // ── 원자재 시드 ──
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

    // ── 채권 시드 ──
    const bondList: BondRecord[] = [
      { id: 'bond_kr_2y', ticker: 'KR_GVT_2Y', name: '한국 국고채 2년', bond_type: 'govt', maturity: '2Y', coupon_rate: 3.25, face_value: 10000, current_price: 99.80, ytm: 3.35, duration: 1.92, volume: 15000 },
      { id: 'bond_kr_5y', ticker: 'KR_GVT_5Y', name: '한국 국고채 5년', bond_type: 'govt', maturity: '5Y', coupon_rate: 3.50, face_value: 10000, current_price: 98.50, ytm: 3.75, duration: 4.55, volume: 12000 },
      { id: 'bond_kr_10y', ticker: 'KR_GVT_10Y', name: '한국 국고채 10년', bond_type: 'govt', maturity: '10Y', coupon_rate: 3.75, face_value: 10000, current_price: 97.20, ytm: 4.05, duration: 8.40, volume: 8000 },
      { id: 'bond_us_2y', ticker: 'US_GVT_2Y', name: '미국 국고채 2년', bond_type: 'govt', maturity: '2Y', coupon_rate: 4.75, face_value: 10000, current_price: 99.50, ytm: 4.80, duration: 1.94, volume: 24000 },
      { id: 'bond_us_10y', ticker: 'US_GVT_10Y', name: '미국 국고채 10년', bond_type: 'govt', maturity: '10Y', coupon_rate: 4.25, face_value: 10000, current_price: 97.80, ytm: 4.35, duration: 8.25, volume: 28000 },
      { id: 'bond_corp_ig', ticker: 'KR_CORP_IG', name: '한국 우량 회사채', bond_type: 'corp_ig', maturity: '3Y', coupon_rate: 4.10, face_value: 10000, current_price: 98.80, ytm: 4.35, duration: 2.78, volume: 5000 },
      { id: 'bond_corp_hy', ticker: 'KR_CORP_HY', name: '한국 투기 회사채', bond_type: 'corp_hy', maturity: '3Y', coupon_rate: 7.25, face_value: 10000, current_price: 95.20, ytm: 7.85, duration: 2.62, volume: 3000 },
    ];
    bondList.forEach((b) => this.bonds.set(b.id, b));

    // ── 옵션 계약 시드 ──
    const expDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const osId = STOCK_UUID_MAP['0010'] || '00000000-0000-4000-8000-000000000101';
    const optList: OptionContractRecord[] = [
      { id: 'opt_c_720', underlying_stock_id: osId, ticker: 'IDX-K200-2608-C260.0', asset_class: 'STK', type: 'CALL', option_type: 'CALL', strike_price: 72000, current_price: 2.15, expiry_date: expDate, open_interest: 450, volume: 120, delta: 0.65, gamma: 0.04, theta: -0.15, implied_volatility: 0.22, created_at: new Date().toISOString() },
      { id: 'opt_p_720', underlying_stock_id: osId, ticker: 'IDX-K200-2608-P260.0', asset_class: 'STK', type: 'PUT', option_type: 'PUT', strike_price: 72000, current_price: 1.85, expiry_date: expDate, open_interest: 380, volume: 95, delta: -0.35, gamma: 0.04, theta: -0.12, implied_volatility: 0.21, created_at: new Date().toISOString() },
    ];
    optList.forEach((o) => this.optionsContracts.set(o.id, o));

    // ── 환율 시드 ──
    this.exchangeRates = [
      { currency_code: 'KRW', currency_name: '대한민국 원', rate_to_krw: 1.0, updated_at: new Date().toISOString() },
      { currency_code: 'USD', currency_name: '미국 달러', rate_to_krw: 1380.0, updated_at: new Date().toISOString() },
      { currency_code: 'EUR', currency_name: '유로', rate_to_krw: 1500.0, updated_at: new Date().toISOString() },
      { currency_code: 'JPY', currency_name: '일본 엔', rate_to_krw: 9.2, updated_at: new Date().toISOString() },
      { currency_code: 'CNY', currency_name: '위안', rate_to_krw: 190.0, updated_at: new Date().toISOString() },
      { currency_code: 'GBP', currency_name: '영국 파운드', rate_to_krw: 1750.0, updated_at: new Date().toISOString() },
    ];

    // ── 테스트 사용자 (고정 UUID 적용) ──
    const guestUser: ProfileRecord = {
      id: GUEST_USER_ID,
      user_id: GUEST_USER_ID,
      username: '서학개미',
      nickname: '서학개미',
      cash: 100000000, // 1억 원
      net_worth: 100000000,
      rank_tier: 'Diamond',
      usd_balance: 50000,
      eur_balance: 10000,
      jpy_balance: 200000,
      cny_balance: 0,
      gbp_balance: 0,
      is_admin: true,
      unlocked_features: ['custom_dashboard', 'advanced_charts'],
      created_at: new Date().toISOString(),
    };
    this.profiles.set(guestUser.id, guestUser);
    this.addProfileToIndex(guestUser);

    // ── 테스트 사용자의 초기 보유 주식 (Holdings) ──
    const initialHoldings = [
      { stockTicker: '0010', qty: 100, avgPrice: 70000 },
      { stockTicker: '000660', qty: 50, avgPrice: 180000 },
      { stockTicker: '035420', qty: 30, avgPrice: 190000 },
      { stockTicker: 'AAPL', qty: 20, avgPrice: 180 },
    ];

    let totalStockEval = 0;
    initialHoldings.forEach((ih) => {
      const sId = STOCK_UUID_MAP[ih.stockTicker];
      if (sId) {
        const hId = `${GUEST_USER_ID}_${sId}`;
        const hRec: HoldingRecord = {
          id: hId,
          user_id: GUEST_USER_ID,
          stock_id: sId,
          quantity: ih.qty,
          avg_price: ih.avgPrice,
          created_at: new Date().toISOString(),
        };
        this.holdings.set(hId, hRec);
        this.addHoldingToIndex(hRec);
        totalStockEval += ih.qty * ih.avgPrice;
      }
    });
    guestUser.net_worth = guestUser.cash + totalStockEval;

    // ── 관리자 설정 ──
    this.adminSettings.set('1', {
      id: 1,
      base_rate: 0.025,
      market_sentiment: 'NEUTRAL',
    });

    // ── 50개 기관 봇 LP 호가 및 초기 체결 적재 ──
    Array.from(this.stocks.values()).forEach((stk) => {
      const cp = stk.current_price;
      const tick = cp < 2000 ? 1 : cp < 5000 ? 5 : cp < 20000 ? 10 : cp < 50000 ? 50 : cp < 200000 ? 100 : 500;
      const baseVol = cp >= 50000 ? 2500 : cp >= 10000 ? 800 : 200;

      // 매수 호가 10단계 (가격 내림차순)
      for (let level = 1; level <= 10; level++) {
        const bidPrice = cp - level * tick;
        if (bidPrice > 0) {
          const oId = `lp_bid_${stk.id}_${level}_${now}`;
          const ord: OrderRecord = {
            id: oId,
            stock_id: stk.id,
            user_id: null,
            side: 'buy',
            price: bidPrice,
            size: Math.round(baseVol * (1 + (10 - level) * 0.2)),
            filled: 0,
            status: 'open',
            is_lp: true,
            created_at: new Date(now - (11 - level) * 1000).toISOString(),
          };
          this.orders.set(oId, ord);
          this.addOrderToIndex(ord);
        }
      }

      // 매도 호가 10단계 (가격 오름차순)
      for (let level = 1; level <= 10; level++) {
        const askPrice = cp + level * tick;
        const oId = `lp_ask_${stk.id}_${level}_${now}`;
        const ord: OrderRecord = {
          id: oId,
          stock_id: stk.id,
          user_id: null,
          side: 'sell',
          price: askPrice,
          size: Math.round(baseVol * (1 + (10 - level) * 0.2)),
          filled: 0,
          status: 'open',
          is_lp: true,
          created_at: new Date(now - (11 - level) * 1000).toISOString(),
        };
        this.orders.set(oId, ord);
        this.addOrderToIndex(ord);
      }

      // 초기 체결 기록 5건
      for (let t = 5; t >= 1; t--) {
        const trId = `trade_${stk.id}_init_${t}`;
        const trPrice = cp + (t % 2 === 0 ? tick : -tick);
        const trSize = Math.round(baseVol * 0.2);
        const tr: TradeRecord = {
          id: trId,
          stock_id: stk.id,
          buyer_id: null,
          seller_id: null,
          buyer_is_bot: true,
          seller_is_bot: true,
          price: trPrice,
          size: trSize,
          buyer_fee: 0.0025,
          seller_fee: 0.0025,
          created_at: new Date(now - t * 3000).toISOString(),
        };
        this.trades.push(tr);
        this.addTradeToIndex(tr);
      }
    });
  }

  /**
   * 개발자용 시장 리셋 (초기 시드 상태로 완전 복원)
   */
  public resetToSeedData(): void {
    this.stocks.clear();
    this.stockPriceHistory = [];
    this.commodities.clear();
    this.profiles.clear();
    this.holdings.clear();
    this.orders.clear();
    this.trades = [];
    this.optionsContracts.clear();
    this.bonds.clear();
    this.marketNews = [];
    this.adminSettings.clear();
    this.exchangeRates = [];
    this.institutionalPortfolios.clear();

    this.seedDefaultData();
    this.rebuildIndexes();
    console.log('🔄 [MemoryDB] Market state successfully reset to initial seed data.');
    this.publish('market_reset', { timestamp: Date.now() });
  }

  public exportSnapshot(): any {
    return {
      stocks: Array.from(this.stocks.entries()),
      stockPriceHistory: [...this.stockPriceHistory],
      commodities: Array.from(this.commodities.entries()),
      profiles: Array.from(this.profiles.entries()),
      holdings: Array.from(this.holdings.entries()),
      orders: Array.from(this.orders.entries()),
      trades: [...this.trades],
      optionsContracts: Array.from(this.optionsContracts.entries()),
      bonds: Array.from(this.bonds.entries()),
      marketNews: [...this.marketNews],
      adminSettings: Array.from(this.adminSettings.entries()),
      exchangeRates: [...this.exchangeRates],
      institutionalPortfolios: Array.from(this.institutionalPortfolios.entries()),
      timestamp: Date.now(),
    };
  }

  public importSnapshot(data: any): void {
    if (!data) return;
    if (Array.isArray(data.stocks)) this.stocks = new Map(data.stocks);
    if (Array.isArray(data.stockPriceHistory)) this.stockPriceHistory = [...data.stockPriceHistory];
    if (Array.isArray(data.commodities)) this.commodities = new Map(data.commodities);
    if (Array.isArray(data.profiles)) this.profiles = new Map(data.profiles);
    if (Array.isArray(data.holdings)) this.holdings = new Map(data.holdings);
    if (Array.isArray(data.orders)) this.orders = new Map(data.orders);
    if (Array.isArray(data.trades)) this.trades = [...data.trades];
    if (Array.isArray(data.optionsContracts)) this.optionsContracts = new Map(data.optionsContracts);
    if (Array.isArray(data.bonds)) this.bonds = new Map(data.bonds);
    if (Array.isArray(data.marketNews)) this.marketNews = [...data.marketNews];
    if (Array.isArray(data.adminSettings)) this.adminSettings = new Map(data.adminSettings);
    if (Array.isArray(data.exchangeRates)) this.exchangeRates = [...data.exchangeRates];
    if (Array.isArray(data.institutionalPortfolios)) this.institutionalPortfolios = new Map(data.institutionalPortfolios);
    this.rebuildIndexes();
  }

  // ── Pub/Sub 리스너 ──
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

// ── Node.js globalThis 싱글톤 보장 (Next.js HMR 중복 인스턴스화 차단) ──
const globalForMemoryDb = globalThis as unknown as {
  __STOCKSYS_MEMORY_DB__?: MemoryDatabase;
};

export const memoryDb: MemoryDatabase =
  globalForMemoryDb.__STOCKSYS_MEMORY_DB__ ?? new MemoryDatabase();

if (process.env.NODE_ENV !== 'production') {
  globalForMemoryDb.__STOCKSYS_MEMORY_DB__ = memoryDb;
}
