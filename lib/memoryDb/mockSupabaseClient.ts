import {
  memoryDb,
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
  private filters: FilterOp[] = [];
  private orderCol?: string;
  private orderAsc: boolean = true;
  private limitCount?: number;
  private isSingle: boolean = false;
  private isMaybeSingle: boolean = false;
  private action: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private payloadData: any = null;
  private upsertOptions: { onConflict?: string } | undefined;

  constructor(tableName: string) {
    this.tableName = tableName;
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

  public update(data: any): this {
    this.action = 'update';
    this.payloadData = data;
    return this;
  }

  public delete(): this {
    this.action = 'delete';
    return this;
  }

  public upsert(data: any, options?: { onConflict?: string }): this {
    this.action = 'upsert';
    this.payloadData = data;
    this.upsertOptions = options;
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
    this.orderCol = col;
    this.orderAsc = options?.ascending ?? true;
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
      const db = memoryDb;

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
        targetList = holdingIds ? Array.from(holdingIds).map((id) => db.holdings.get(id)).filter(Boolean) : [];
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
          const id = item.id || `id_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
          const record = { ...item, id, created_at: item.created_at || new Date().toISOString() };

          if (this.tableName === 'orders') {
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
        let matched = this.applyFilters(targetList);
        for (const item of matched) {
          Object.assign(item, this.payloadData);
          db.publish(`${this.tableName}_changes`, { eventType: 'UPDATE', new: item });
        }
        return { data: matched, error: null };
      }

      if (this.action === 'delete') {
        let matched = this.applyFilters(targetList);
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

      if (this.orderCol) {
        const col = this.orderCol;
        const asc = this.orderAsc;
        result.sort((a, b) => {
          const valA = a[col];
          const valB = b[col];
          if (valA === valB) return 0;
          if (valA === undefined || valA === null) return 1;
          if (valB === undefined || valB === null) return -1;
          if (typeof valA === 'number' && typeof valB === 'number') {
            return asc ? valA - valB : valB - valA;
          }
          return asc ? String(valA).localeCompare(String(valB)) : String(valB).localeCompare(String(valA));
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

export class MockSupabaseClient {
  public from(tableName: string): MemoryQueryBuilder {
    return new MemoryQueryBuilder(tableName);
  }

  public async rpc(fnName: string, params?: any): Promise<{ data: any; error: any }> {
    const db = memoryDb;

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
      
      // 1. 사전 검증 단계 (트랜잭션 원자성 보장: 하나라도 잔고/주식 부족 시 전체 롤백)
      for (const t of trades) {
        const tradeAmount = Number(t.price) * Number(t.size);
        const buyerFee = Number(t.buyer_fee ?? 0);

        if (Number(t.price) <= 0 || Number(t.size) <= 0) {
          return { data: null, error: { message: `Invalid trade price or size: price=${t.price}, size=${t.size}` } };
        }

        if (!t.buyer_is_bot && t.buyer_id) {
          const buyer = db.profiles.get(t.buyer_id);
          if (!buyer) {
            return { data: null, error: { message: `Buyer profile not found for user ${t.buyer_id}` } };
          }
          const requiredCash = tradeAmount * (1 + buyerFee);
          if (buyer.cash < requiredCash) {
            return { data: null, error: { message: `Insufficient cash for buyer ${t.buyer_id}: required=${requiredCash}, available=${buyer.cash}` } };
          }
        }

        if (!t.seller_is_bot && t.seller_id) {
          const holdingId = `${t.seller_id}_${t.stock_id}`;
          const h = db.holdings.get(holdingId);
          const availableQty = h?.quantity ?? 0;
          if (availableQty < Number(t.size)) {
            return { data: null, error: { message: `Insufficient holdings for seller ${t.seller_id}: required=${t.size}, available=${availableQty}` } };
          }
        }
      }

      // 2. 실행 단계 (사전 검증 통과 후 상태 갱신)
      let settledCount = 0;
      for (const t of trades) {
        const buyerId = t.buyer_id;
        const sellerId = t.seller_id;
        const tradeAmount = Number(t.price) * Number(t.size);
        const buyerFee = Number(t.buyer_fee ?? 0);
        const sellerFee = Number(t.seller_fee ?? 0);

        if (!t.buyer_is_bot && buyerId) {
          const buyer = db.profiles.get(buyerId);
          if (buyer) {
            buyer.cash -= tradeAmount * (1 + buyerFee);
            buyer.net_worth -= tradeAmount * buyerFee;
          }
          const holdingId = `${buyerId}_${t.stock_id}`;
          let h = db.holdings.get(holdingId);
          if (h) {
            h.quantity += Number(t.size);
            h.avg_price = ((h.quantity - Number(t.size)) * h.avg_price + tradeAmount) / h.quantity;
          } else {
            db.holdings.set(holdingId, { id: holdingId, user_id: buyerId, stock_id: t.stock_id, quantity: Number(t.size), avg_price: Number(t.price), created_at: new Date().toISOString() });
            let userSet = db.holdingUserIndex.get(buyerId);
            if (!userSet) { userSet = new Set(); db.holdingUserIndex.set(buyerId, userSet); }
            userSet.add(holdingId);
          }
        }

        if (!t.seller_is_bot && sellerId) {
          const seller = db.profiles.get(sellerId);
          if (seller) {
            seller.cash += tradeAmount * (1 - sellerFee);
            seller.net_worth -= tradeAmount * sellerFee;
          }
          const holdingId = `${sellerId}_${t.stock_id}`;
          let h = db.holdings.get(holdingId);
          if (h) {
            h.quantity -= Number(t.size);
            if (h.quantity <= 0) {
              db.holdings.delete(holdingId);
              const userSet = db.holdingUserIndex.get(sellerId);
              if (userSet) userSet.delete(holdingId);
            }
          }
        }

        const tradeId = t.id || `trade_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const tradeRecord: TradeRecord = {
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
          created_at: t.created_at || new Date().toISOString(),
        };

        db.trades.push(tradeRecord);
        db.addTradeToIndex(tradeRecord);
        settledCount++;
      }

      return { data: { success: true, settled_count: settledCount }, error: null };
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

    return { data: null, error: null };
  }

  public get auth(): any {
    return {
      getUser: async () => {
        const user = memoryDb.profiles.get(GUEST_USER_ID);
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
        memoryDb.subscribe(channelName, callback);
        return {
          subscribe: () => ({ unsubscribe: () => {} }),
        };
      },
      subscribe: () => ({ unsubscribe: () => {} }),
    };
  }

  public removeChannel(_channel: any): void {}
}

export function createMockSupabaseClient(): MockSupabaseClient {
  return new MockSupabaseClient();
}
