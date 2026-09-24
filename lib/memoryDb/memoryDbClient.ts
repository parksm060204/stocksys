import {
  memoryDb,
  MemoryDatabase,
  StockRecord,
  CommodityRecord,
  HoldingRecord,
  OrderRecord,
  TradeRecord,
  ProfileRecord,
  StockPriceHistoryRecord,
  GUEST_USER_ID,
} from './memoryStore';


type FilterOp = {
  col: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
  val: any;
};

export class MemoryQueryBuilder {
  private tableName: string;
  private db: MemoryDatabase;
  private filters: FilterOp[] = [];
  private orderSpecs: { col: string; ascending: boolean }[] = [];
  private orderCol?: string;
  private orderAsc: boolean = true;
  private limitCount?: number;
  private isSingle: boolean = false;
  private isMaybeSingle: boolean = false;
  private action: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private payloadData: any = null;
  private upsertOptions: { onConflict?: string } | undefined;

  constructor(tableName: string, db: MemoryDatabase = memoryDb) {
    this.tableName = tableName;
    this.db = db;
  }

  public select(_fields: string = '*'): this {
    this.action = 'select';
    return this;
  }

  public insert(data: any): this {
    this.action = 'insert';
    this.payloadData = data;
    return this;
  }

  public upsert(data: any, options?: { onConflict?: string }): this {
    this.action = 'upsert';
    this.payloadData = data;
    this.upsertOptions = options;
    return this;
  }

  public update(data: any): this {
    this.action = 'update';
    this.payloadData = data;
    return this;
  }

  public delete(): this {
    this.action = 'delete';
    return this;
  }

  public eq(col: string, val: any): this {
    this.filters.push({ col, op: 'eq', val });
    return this;
  }

  public neq(col: string, val: any): this {
    this.filters.push({ col, op: 'neq', val });
    return this;
  }

  public gt(col: string, val: any): this {
    this.filters.push({ col, op: 'gt', val });
    return this;
  }

  public gte(col: string, val: any): this {
    this.filters.push({ col, op: 'gte', val });
    return this;
  }

  public lt(col: string, val: any): this {
    this.filters.push({ col, op: 'lt', val });
    return this;
  }

  public lte(col: string, val: any): this {
    this.filters.push({ col, op: 'lte', val });
    return this;
  }

  public in(col: string, val: any[]): this {
    this.filters.push({ col, op: 'in', val });
    return this;
  }

  public order(col: string, options?: { ascending?: boolean }): this {
    const ascending = options?.ascending ?? true;
    this.orderSpecs.push({ col, ascending });
    this.orderCol = col;
    this.orderAsc = ascending;
    return this;
  }

  public limit(n: number): this {
    this.limitCount = n;
    return this;
  }

  public single(): this {
    this.isSingle = true;
    return this;
  }

  public maybeSingle(): this {
    this.isMaybeSingle = true;
    return this;
  }

  /**
   * 쿼리 실행 및 Promise 호환 처리 (인덱스 스캔 최적화 적용)
   */
  public async execute(): Promise<{ data: any; error: any }> {
    try {
      let targetList: any[] = [];
      const db = this.db;

      // ── 1. 인덱스 기반 고속 스캔 ──
      const eqTicker = this.filters.find((f) => f.col === 'ticker' && f.op === 'eq')?.val;
      const eqUserId = this.filters.find((f) => (f.col === 'user_id' || f.col === 'userId') && f.op === 'eq')?.val;
      const eqStockId = this.filters.find((f) => (f.col === 'stock_id' || f.col === 'stockId') && f.op === 'eq')?.val;
      const eqId = this.filters.find((f) => f.col === 'id' && f.op === 'eq')?.val;

      if (this.tableName === 'stocks' && eqTicker) {
        const stockId = db.tickerIndex.get(String(eqTicker).toUpperCase());
        const stock = stockId ? db.stocks.get(stockId) : undefined;
        targetList = stock ? [stock] : [];
      } else if (this.tableName === 'stocks' && eqId) {
        const stock = db.stocks.get(String(eqId));
        targetList = stock ? [stock] : [];
      } else if (this.tableName === 'commodities' && eqTicker) {
        const commId = db.commodityTickerIndex.get(String(eqTicker).toUpperCase());
        const comm = commId ? db.commodities.get(commId) : undefined;
        targetList = comm ? [comm] : [];
      } else if (this.tableName === 'holdings' && eqUserId) {
        const holdingIds = db.holdingUserIndex.get(String(eqUserId));
        if (holdingIds && holdingIds.size > 0) {
          targetList = Array.from(holdingIds).map((id) => db.holdings.get(id)).filter(Boolean);
        } else {
          targetList = Array.from(db.holdings.values()).filter((h) => h.user_id === String(eqUserId));
        }
      } else if (this.tableName === 'orders' && eqStockId) {
        const orderIds = db.orderStockIndex.get(String(eqStockId));
        targetList = orderIds ? Array.from(orderIds).map((id) => db.orders.get(id)).filter(Boolean) : [];
      } else if (this.tableName === 'trades' && eqStockId) {
        targetList = db.tradeStockIndex.get(String(eqStockId)) || [];
      } else if (this.tableName === 'profiles' && (eqUserId || eqId)) {
        const uid = String(eqUserId || eqId);
        const profId = db.profileUserIdIndex.get(uid) || uid;
        const profile = db.profiles.get(profId) || db.profiles.get(GUEST_USER_ID);
        targetList = profile ? [profile] : [];
      } else {
        // 인덱스가 없는 경우 기본 전체 테이블 스캔
        switch (this.tableName) {
          case 'stocks':
            targetList = Array.from(db.stocks.values());
            break;
          case 'stock_price_history':
            targetList = [...db.stockPriceHistory];
            break;
          case 'commodities':
            targetList = Array.from(db.commodities.values());
            break;
          case 'profiles':
            targetList = Array.from(db.profiles.values());
            break;
          case 'holdings':
            targetList = Array.from(db.holdings.values());
            break;
          case 'orders':
            targetList = Array.from(db.orders.values());
            break;
          case 'trades':
            targetList = [...db.trades];
            break;
          case 'options_contracts':
            targetList = Array.from(db.optionsContracts.values());
            break;
          case 'bonds':
            targetList = Array.from(db.bonds.values());
            break;
          case 'exchange_rates':
            targetList = [...db.exchangeRates];
            break;
          case 'admin_settings':
            targetList = Array.from(db.adminSettings.values());
            break;
          case 'institutional_portfolios':
            targetList = Array.from(db.institutionalPortfolios.values());
            break;
          case 'player_events':
            targetList = [...db.playerEvents];
            break;
          case 'active_player_events':
            targetList = [...db.activePlayerEvents];
            break;
          case 'active_manipulations':
            targetList = [...db.activeManipulations];
            break;
          case 'bots_config':
            targetList = [...db.botsConfig];
            break;
          case 'market_news':
          case 'news':
          case 'news_v2':
            targetList = [...db.marketNews];
            break;
          case 'option_settlements':
            targetList = [...db.optionSettlements];
            break;
          case 'bond_coupon_payments':
            targetList = [...db.bondCouponPayments];
            break;
          default:
            targetList = [];
        }
      }

      // ── 2. DML 연산 처리 ──
      if (this.action === 'insert') {
        const items = Array.isArray(this.payloadData) ? this.payloadData : [this.payloadData];
        const insertedItems: any[] = [];

        for (const item of items) {
          const id = item.id || db.generateId('id');
          const record = { ...item, id, created_at: item.created_at || db.getIsoTimestamp() };

          if (this.tableName === 'stocks') {
            db.stocks.set(id, record as StockRecord);
            db.addStockToIndex(record as StockRecord);
          } else if (this.tableName === 'bonds') {
            db.bonds.set(id, record as any);
          } else if (this.tableName === 'commodities') {
            db.commodities.set(id, record as CommodityRecord);
            db.addCommodityToIndex(record as CommodityRecord);
          } else if (this.tableName === 'orders') {
            db.orders.set(id, record as OrderRecord);
            db.addOrderToIndex(record as OrderRecord);
          } else if (this.tableName === 'trades') {
            db.trades.push(record as TradeRecord);
            db.addTradeToIndex(record as TradeRecord);
          } else if (this.tableName === 'holdings') {
            db.holdings.set(id, record as HoldingRecord);
            db.addHoldingToIndex(record as HoldingRecord);
          } else if (this.tableName === 'stock_price_history') {
            db.stockPriceHistory.push(record as StockPriceHistoryRecord);
          } else if (this.tableName === 'active_player_events') {
            db.activePlayerEvents.push(record);
          } else if (this.tableName === 'active_manipulations') {
            db.activeManipulations.push(record);
          } else if (this.tableName === 'market_news' || this.tableName === 'news' || this.tableName === 'news_v2') {
            db.marketNews.push(record);
          }

          insertedItems.push(record);
          db.publish(`${this.tableName}_changes`, { eventType: 'INSERT', new: record });
        }

        return { data: Array.isArray(this.payloadData) ? insertedItems : (insertedItems[0] ?? null), error: null };
      }

      if (this.action === 'upsert') {
        const items = Array.isArray(this.payloadData) ? this.payloadData : [this.payloadData];
        const _conflictKey = this.upsertOptions?.onConflict || 'id';

        for (const item of items) {
          if (this.tableName === 'stocks') {
            const key = item.id || db.tickerIndex.get(item.ticker?.toUpperCase()) || `stock_${item.ticker}`;
            const existing = db.stocks.get(key) || ({} as StockRecord);
            const merged = { ...existing, ...item, id: key } as StockRecord;
            db.stocks.set(key, merged);
            db.addStockToIndex(merged);
          } else if (this.tableName === 'commodities') {
            const key = item.commodity_id || item.id;
            const existing = db.commodities.get(key) || ({} as CommodityRecord);
            const merged = { ...existing, ...item, id: key } as CommodityRecord;
            db.commodities.set(key, merged);
            db.addCommodityToIndex(merged);
          } else if (this.tableName === 'holdings') {
            const key = item.id || `${item.user_id}_${item.stock_id}`;
            const rec = { ...item, id: key } as HoldingRecord;
            db.holdings.set(key, rec);
            db.addHoldingToIndex(rec);
          } else if (this.tableName === 'institutional_portfolios') {
            const key = item.bot_id || item.id;
            db.institutionalPortfolios.set(key, item);
          }
        }
        return { data: items, error: null };
      }

      if (this.action === 'update') {
        // 필터 조건에 매칭되는 레코드 수정
        const matched = this.applyFilters(targetList);
        for (const item of matched) {
          Object.assign(item, this.payloadData);
          db.publish(`${this.tableName}_changes`, { eventType: 'UPDATE', new: item });
        }
        return { data: matched, error: null };
      }

      if (this.action === 'delete') {
        const matched = this.applyFilters(targetList);
        for (const item of matched) {
          if (this.tableName === 'orders') {
            db.orders.delete(item.id);
            db.removeOrderFromIndex(item as OrderRecord);
          } else if (this.tableName === 'holdings') {
            db.holdings.delete(item.id);
            db.removeHoldingFromIndex(item as HoldingRecord);
          }
          db.publish(`${this.tableName}_changes`, { eventType: 'DELETE', old: item });
        }
        return { data: matched, error: null };
      }

      // ── 3. SELECT 쿼리 필터링 & 정렬 ──
      let result = this.applyFilters(targetList);

      const specs = this.orderSpecs.length > 0 
        ? this.orderSpecs 
        : (this.orderCol ? [{ col: this.orderCol, ascending: this.orderAsc }] : []);

      if (specs.length > 0) {
        result.sort((a, b) => {
          for (const spec of specs) {
            const valA = a[spec.col];
            const valB = b[spec.col];
            if (valA === valB) continue;
            if (valA === undefined || valA === null) return 1;
            if (valB === undefined || valB === null) return -1;
            if (typeof valA === 'number' && typeof valB === 'number') {
              return spec.ascending ? valA - valB : valB - valA;
            }
            const cmp = String(valA).localeCompare(String(valB));
            if (cmp !== 0) {
              return spec.ascending ? cmp : -cmp;
            }
          }
          return 0;
        });
      }

      if (this.limitCount !== undefined && this.limitCount >= 0) {
        result = result.slice(0, this.limitCount);
      }

      // holdings 테이블의 경우 관계형 stocks 데이터 주입 지원
      if (this.tableName === 'holdings') {
        result = result.map((h) => {
          const s = db.stocks.get(h.stock_id);
          return {
            ...h,
            stocks: s ? { id: s.id, ticker: s.ticker, name: s.name, market: s.market, current_price: s.current_price } : null,
          };
        });
      }

      if (this.isSingle) {
        if (result.length === 0) {
          if (this.tableName === 'profiles') {
            const fallbackGuest = db.profiles.get(GUEST_USER_ID);
            if (fallbackGuest) return { data: fallbackGuest, error: null };
          }
          return { data: null, error: { message: 'Row not found (PGRST116)' } };
        }
        return { data: result[0], error: null };
      }

      if (this.isMaybeSingle) {
        if (result.length === 0 && this.tableName === 'profiles') {
          return { data: db.profiles.get(GUEST_USER_ID) || null, error: null };
        }
        return { data: result.length > 0 ? result[0] : null, error: null };
      }

      return { data: result, error: null };
    } catch (err: any) {
      console.error(`[MemoryQueryBuilder] Query error on ${this.tableName}:`, err);
      return { data: null, error: { message: err?.message || String(err) } };
    }
  }

  private applyFilters(list: any[]): any[] {
    return list.filter((item) => {
      for (const f of this.filters) {
        const itemVal = item[f.col];
        switch (f.op) {
          case 'eq':
            if (itemVal != f.val) return false;
            break;
          case 'neq':
            if (itemVal == f.val) return false;
            break;
          case 'gt':
            if (!(itemVal > f.val)) return false;
            break;
          case 'gte':
            if (!(itemVal >= f.val)) return false;
            break;
          case 'lt':
            if (!(itemVal < f.val)) return false;
            break;
          case 'lte':
            if (!(itemVal <= f.val)) return false;
            break;
          case 'in':
            if (!Array.isArray(f.val) || !f.val.includes(itemVal)) return false;
            break;
        }
      }
      return true;
    });
  }

  public then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any): Promise<any> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export class MemoryDbClient {
  private db: MemoryDatabase;

  constructor(db: MemoryDatabase = memoryDb) {
    this.db = db;
  }

  public from(tableName: string): MemoryQueryBuilder {
    return new MemoryQueryBuilder(tableName, this.db);
  }

  public async rpc(fnName: string, params?: any): Promise<{ data: any; error: any }> {
    const db = this.db;

    if (fnName === 'update_cash_balance') {
      const userId = params?.p_user_id || params?.user_id || GUEST_USER_ID;
      const delta = Number(params?.p_delta || params?.amount || 0);

      const updatedProfile = await db.updateAtomic<ProfileRecord>(`profile:${userId}`, (prev) => {
        const user = prev || db.profiles.get(userId) || db.profiles.get(GUEST_USER_ID);
        if (!user) {
          const newUser: ProfileRecord = {
            id: userId,
            user_id: userId,
            username: '새 사용자',
            nickname: '새 사용자',
            cash: 100000000 + delta,
            net_worth: 100000000 + delta,
            rank_tier: 'Silver',
            created_at: new Date().toISOString(),
          };
          return newUser;
        }
        return {
          ...user,
          cash: user.cash + delta,
          net_worth: user.net_worth + delta,
        };
      });

      return { data: updatedProfile?.cash ?? 0, error: null };
    }

    if (fnName === 'bulk_settle_trades') {
      const trades = Array.isArray(params?.p_trades) ? params.p_trades : [];

      // ── Step 1: 기본 유효성 검증 ──
      for (const t of trades) {
        if (Number(t.price) <= 0 || Number(t.size) <= 0) {
          return { data: null, error: { message: `Invalid trade price or size: price=${t.price}, size=${t.size}` } };
        }
        if (!t.buyer_is_bot && t.buyer_id) {
          const buyer = db.profiles.get(t.buyer_id);
          if (!buyer) {
            return { data: null, error: { message: `Buyer profile not found for user ${t.buyer_id}` } };
          }
        }
        // [Seller Profile Validation] 매도자 프로필 존재 여부 검증
        // 프로필 없이 보유 수량만 있는 경우, settlement이 진행되면 holding은 감소하되
        // 매도 수익은 누구에게도 지급되지 않는 자산 소멸이 발생한다. 사전 차단 필수.
        if (!t.seller_is_bot && t.seller_id) {
          const seller = db.profiles.get(t.seller_id);
          if (!seller) {
            return { data: null, error: { message: `Seller profile not found for user ${t.seller_id}` } };
          }
        }
      }

      // ── Step 2: 누적 사전 검증 (Cumulative Pre-Validation) ──
      // 각 거래를 개별적으로 검증하면 동일 buyer/seller의 여러 거래가 각각 같은 시작 잔고를 보므로
      // 중복 통과가 가능하다. 배치 전체를 합산하여 한 번에 검증해야 원자성이 보장된다.

      // Map<buyerId, 누적 필요 현금 (수수료 포함)>
      const buyerRequiredCash = new Map();
      // Map<sellerId_stockId, 누적 필요 보유 수량>
      const sellerRequiredQty = new Map();

      for (const t of trades) {
        const tradeAmount = Number(t.price) * Number(t.size);
        const buyerFee = Number(t.buyer_fee ?? 0);

        if (t.buyer_id && db.profiles.has(t.buyer_id)) {
          const prev = buyerRequiredCash.get(t.buyer_id) ?? 0;
          buyerRequiredCash.set(t.buyer_id, prev + tradeAmount * (1 + buyerFee));
        }
        if (t.seller_id && db.profiles.has(t.seller_id)) {
          const key = `${t.seller_id}_${t.stock_id}`;
          const prev = sellerRequiredQty.get(key) ?? 0;
          sellerRequiredQty.set(key, prev + Number(t.size));
        }
      }

      // 매수자 누적 현금 검증 — 부족 시 전체 배치 거절, 상태 변경 없음
      for (const [buyerId, required] of buyerRequiredCash.entries()) {
        const buyer = db.profiles.get(buyerId);
        const available = buyer?.cash ?? 0;
        if (available < required) {
          return {
            data: null,
            error: {
              message: `Insufficient cumulative cash for buyer ${buyerId}: required=${required}, available=${available}`,
            },
          };
        }
      }

      // 매도자 누적 보유 수량 검증 — 부족 시 전체 배치 거절, 상태 변경 없음
      for (const [key, required] of sellerRequiredQty.entries()) {
        const h = db.holdings.get(key);
        const available = h?.quantity ?? 0;
        if (available < required) {
          const sellerId = key.split('_')[0];
          return {
            data: null,
            error: {
              message: `Insufficient cumulative holdings for seller ${sellerId} (key=${key}): required=${required}, available=${available}`,
            },
          };
        }
      }

      // ── Step 3: 실행 단계 (누적 검증 통과 후에만 상태 갱신) ──
      // Prepare all mutations against clones first. No live collection is
      // touched until every trade and resulting balance/holding is known.
      const profileUpdates = new Map<string, ProfileRecord>();
      const holdingUpdates = new Map<string, HoldingRecord | null>();
      const tradeRecords: TradeRecord[] = [];

      const getProfile = (userId: string): ProfileRecord | undefined => {
        if (!profileUpdates.has(userId)) {
          const profile = db.profiles.get(userId);
          if (profile) profileUpdates.set(userId, { ...profile });
        }
        return profileUpdates.get(userId);
      };

      const getHolding = (holdingId: string): HoldingRecord | null => {
        if (!holdingUpdates.has(holdingId)) {
          const holding = db.holdings.get(holdingId);
          holdingUpdates.set(holdingId, holding ? { ...holding } : null);
        }
        return holdingUpdates.get(holdingId) ?? null;
      };

      for (const t of trades) {
        const buyerId = t.buyer_id;
        const sellerId = t.seller_id;
        const tradeAmount = Number(t.price) * Number(t.size);
        const buyerFee = Number(t.buyer_fee ?? 0);
        const sellerFee = Number(t.seller_fee ?? 0);

        if (buyerId && db.profiles.has(buyerId)) {
          const buyer = getProfile(buyerId);
          if (buyer) {
            buyer.cash -= tradeAmount * (1 + buyerFee);
            buyer.net_worth -= tradeAmount * buyerFee;
          }

          const holdingId = `${buyerId}_${t.stock_id}`;
          const holding = getHolding(holdingId);
          if (holding) {
            const previousQuantity = holding.quantity;
            holding.quantity += Number(t.size);
            holding.avg_price = (previousQuantity * holding.avg_price + tradeAmount) / holding.quantity;
          } else {
            holdingUpdates.set(holdingId, {
              id: holdingId,
              user_id: buyerId,
              stock_id: t.stock_id,
              quantity: Number(t.size),
              avg_price: Number(t.price),
              created_at: new Date().toISOString(),
            });
          }
        }

        if (sellerId && db.profiles.has(sellerId)) {
          const seller = getProfile(sellerId);
          if (seller) {
            seller.cash += tradeAmount * (1 - sellerFee);
            seller.net_worth -= tradeAmount * sellerFee;
          }

          const holdingId = `${sellerId}_${t.stock_id}`;
          const holding = getHolding(holdingId);
          if (holding) {
            holding.quantity -= Number(t.size);
            if (holding.quantity <= 0) holdingUpdates.set(holdingId, null);
          }
        }

        const tradeId = t.id || db.generateId('trade');
        tradeRecords.push({
          id: tradeId,
          stock_id: t.stock_id,
          buyer_id: buyerId,
          seller_id: sellerId,
          buyer_is_bot: !!t.buyer_is_bot,
          seller_is_bot: !!t.seller_is_bot,
          price: Number(t.price),
          size: Number(t.size),
          buyer_fee: buyerFee,
          seller_fee: sellerFee,
          created_at: t.created_at || db.getIsoTimestamp(),
          simulation_time: t.simulation_time,
        });
      }

      const originalProfiles = new Map<string, ProfileRecord | undefined>();
      for (const userId of profileUpdates.keys()) {
        const profile = db.profiles.get(userId);
        originalProfiles.set(userId, profile ? { ...profile } : undefined);
      }
      const originalHoldings = new Map<string, HoldingRecord | undefined>();
      const holdingUsers = new Set<string>();
      for (const [holdingId, updated] of holdingUpdates.entries()) {
        const original = db.holdings.get(holdingId);
        originalHoldings.set(holdingId, original ? { ...original } : undefined);
        if (original) holdingUsers.add(original.user_id);
        if (updated) holdingUsers.add(updated.user_id);
      }
      const originalHoldingIndexes = new Map<string, Set<string> | undefined>();
      for (const userId of holdingUsers) {
        const ids = db.holdingUserIndex.get(userId);
        originalHoldingIndexes.set(userId, ids ? new Set(ids) : undefined);
      }

      try {
        for (const [userId, profile] of profileUpdates.entries()) {
          db.profiles.set(userId, profile);
        }
        for (const [holdingId, holding] of holdingUpdates.entries()) {
          const original = db.holdings.get(holdingId);
          if (holding) {
            db.holdings.set(holdingId, holding);
            db.addHoldingToIndex(holding);
          } else {
            if (original) db.removeHoldingFromIndex(original);
            db.holdings.delete(holdingId);
          }
        }
        for (const tradeRecord of tradeRecords) {
          db.trades.push(tradeRecord);
          db.addTradeToIndex(tradeRecord);
        }
      } catch (commitError) {
        for (const [userId, original] of originalProfiles.entries()) {
          if (original) db.profiles.set(userId, original);
          else db.profiles.delete(userId);
        }
        for (const [holdingId, original] of originalHoldings.entries()) {
          if (original) db.holdings.set(holdingId, original);
          else db.holdings.delete(holdingId);
        }
        for (const [userId, original] of originalHoldingIndexes.entries()) {
          if (original) db.holdingUserIndex.set(userId, new Set(original));
          else db.holdingUserIndex.delete(userId);
        }
        const tradeIds = new Set(tradeRecords.map((trade) => trade.id));
        for (let i = db.trades.length - 1; i >= 0; i -= 1) {
          if (tradeIds.has(db.trades[i].id)) db.trades.splice(i, 1);
        }
        for (const [stockId, stockTrades] of db.tradeStockIndex.entries()) {
          for (let i = stockTrades.length - 1; i >= 0; i -= 1) {
            if (tradeIds.has(stockTrades[i].id)) stockTrades.splice(i, 1);
          }
          if (stockTrades.length === 0) db.tradeStockIndex.delete(stockId);
        }
        throw commitError;
      }

      return {
        data: {
          success: true,
          settled_count: tradeRecords.length,
          trade_ids: tradeRecords.map((trade) => trade.id),
        },
        error: null,
      };
    }

    if (fnName === 'trim_old_market_data') {
      const maxTrades = Math.max(Number(params?.p_max_trades || 5000), 1000);
      const maxHistory = Math.max(Number(params?.p_max_history || 3000), 1000);
      let deletedTrades = 0;
      let deletedHistory = 0;

      if (db.trades.length > maxTrades) {
        deletedTrades = db.trades.length - maxTrades;
        db.trades = db.trades.slice(-maxTrades);
      }
      if (db.stockPriceHistory.length > maxHistory) {
        deletedHistory = db.stockPriceHistory.length - maxHistory;
        db.stockPriceHistory = db.stockPriceHistory.slice(-maxHistory);
      }

      if (deletedTrades > 0 || deletedHistory > 0) {
        db.rebuildIndexes();
      }

      return { data: { deleted_trades: deletedTrades, deleted_history: deletedHistory }, error: null };
    }

    if (fnName === 'submit_and_match_order') {
      // [Serialization Safety] 직접 submitAndMatchOrder() 호출 시 per-stock mutex 우회 문제.
      // LocalMarketService.submitOrder()를 통해야만 뮤텍스가 보장된다.
      // 동적 import를 사용하여 순환 의존성(memoryDbClient → marketService → memoryDbClient)을 방지.
      const { LocalMarketService } = await import('../engine/marketService');
      const userId = params?.p_user_id || params?.user_id;
      const stockId = params?.p_stock_id || params?.stock_id;
      const side = params?.p_side || params?.side;
      const price = Number(params?.p_price ?? params?.price);
      const size = Number(params?.p_size ?? params?.size);

      const res = await LocalMarketService.submitOrder({
        userId,
        stockId,
        side,
        price,
        size,
      });

      return {
        data: {
          success: res.success,
          order_id: res.orderId,
          orderId: res.orderId,
          filled_qty: res.filledQty,
          filledQty: res.filledQty,
          exec_price: res.execPrice,
          execPrice: res.execPrice,
          status: res.status,
          message: res.message,
        },
        error: res.success ? null : { message: res.message },
      };
    }

    if (fnName === 'get_authoritative_orderbook') {
      const stockId = params?.p_stock_id || params?.stock_id;
      const depth = Math.max(1, Math.min(50, Number(params?.p_depth || params?.depth || 10)));
      if (!stockId) {
        return { data: null, error: { message: 'stock_id is required' } };
      }

      const fetchStart = db.getNowMs();
      const orderIds = db.orderStockIndex.get(stockId);
      const bidLevelsMap = new Map<number, { size: number; count: number }>();
      const askLevelsMap = new Map<number, { size: number; count: number }>();

      if (orderIds) {
        for (const orderId of orderIds) {
          const ord = db.orders.get(orderId);
          if (!ord) continue;
          if (ord.status !== 'open' && ord.status !== 'partial') continue;
          const remaining = Math.max(0, ord.size - (ord.filled || 0));
          if (remaining <= 0 || !Number.isFinite(ord.price) || ord.price <= 0) continue;

          const targetMap = ord.side === 'buy' ? bidLevelsMap : askLevelsMap;
          const cur = targetMap.get(ord.price) ?? { size: 0, count: 0 };
          cur.size += remaining;
          cur.count += 1;
          targetMap.set(ord.price, cur);
        }
      }

      // 가격별 정렬 및 상위 depth개 고유 가격 레벨 추출 (반올림 후 0수량 제외)
      const sortedBids = Array.from(bidLevelsMap.entries())
        .map(([price, val]) => ({
          price,
          totalSize: Math.round(val.size),
          actualDbSize: val.size,
          isSynthetic: false,
          orderCount: val.count,
        }))
        .filter((l) => l.totalSize > 0)
        .sort((a, b) => b.price - a.price)
        .slice(0, depth);

      const sortedAsks = Array.from(askLevelsMap.entries())
        .map(([price, val]) => ({
          price,
          totalSize: Math.round(val.size),
          actualDbSize: val.size,
          isSynthetic: false,
          orderCount: val.count,
        }))
        .filter((l) => l.totalSize > 0)
        .sort((a, b) => a.price - b.price)
        .slice(0, depth);

      // 단일 스냅샷 내 동일 시점 체결 내역 (최신 50건)
      const trades = (db.tradeStockIndex.get(stockId) || [])
        .slice(-50)
        .reverse()
        .map((t) => ({
          id: t.id,
          stock_id: t.stock_id,
          price: Number(t.price),
          size: Number(t.size),
          buyer_is_bot: t.buyer_is_bot,
          seller_is_bot: t.seller_is_bot,
          created_at: t.created_at,
        }));

      const now = db.getNowMs();
      return {
        data: {
          stockId,
          timestamp: now,
          fetchDurationMs: now - fetchStart,
          bids: sortedBids,
          asks: sortedAsks,
          trades,
        },
        error: null,
      };
    }

    return { data: null, error: null };
  }

  public get auth(): any {
    return {
      getUser: async () => {
        const user = this.db.profiles.get(GUEST_USER_ID);
        return {
          data: {
            user: user
              ? { id: user.id, email: 'guest@stocksys.local', user_metadata: { nickname: user.nickname, username: user.username } }
              : null,
          },
          error: null,
        };
      },
      getSession: async () => {
        return {
          data: {
            session: {
              access_token: 'mock_token',
              user: { id: GUEST_USER_ID, email: 'guest@stocksys.local' },
            },
          },
          error: null,
        };
      },
      signInWithPassword: async () => ({ data: { user: { id: GUEST_USER_ID } }, error: null }),
      signOut: async () => ({ error: null }),
    };
  }

  public channel(channelName: string): any {
    return {
      on: (_event: string, _filter: any, callback: (payload: any) => void) => {
        this.db.subscribe(channelName, callback);
        return {
          subscribe: () => ({ unsubscribe: () => {} }),
        };
      },
      subscribe: () => ({ unsubscribe: () => {} }),
    };
  }

  public removeChannel(_channel: any): void {}
}

export function createMemoryDbClient(db?: MemoryDatabase): MemoryDbClient {
  return new MemoryDbClient(db || memoryDb);
}

export function createIsolatedMemoryDbClient(db?: MemoryDatabase): MemoryDbClient {
  return new MemoryDbClient(db || new MemoryDatabase());
}
