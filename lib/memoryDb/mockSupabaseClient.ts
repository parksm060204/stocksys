import {
  memoryDb,
  StockRecord,
  CommodityRecord,
  HoldingRecord,
  OrderRecord,
  TradeRecord,
  ProfileRecord,
} from './memoryStore';

type FilterOp = {
  col: string;
  op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in';
  val: any;
};

class MemoryQueryBuilder {
  private tableName: string;
  private filters: FilterOp[] = [];
  private orderCol?: string;
  private orderAsc: boolean = true;
  private limitCount?: number;
  private isSingle: boolean = false;
  private isMaybeSingle: boolean = false;
  private action: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select';
  private payloadData: any = null;
  private upsertOptions?: { onConflict?: string };

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

      // ── 1. 인덱스 기반 고속 스캔 (Index Scan Optimization) ──
      const eqTicker = this.filters.find((f) => f.col === 'ticker' && f.op === 'eq')?.val;
      const eqUserId = this.filters.find((f) => (f.col === 'user_id' || f.col === 'userId') && f.op === 'eq')?.val;
      const eqStockId = this.filters.find((f) => (f.col === 'stock_id' || f.col === 'stockId') && f.op === 'eq')?.val;

      if (this.tableName === 'stocks' && eqTicker) {
        const stockId = db.tickerIndex.get(String(eqTicker).toUpperCase());
        const stock = stockId ? db.stocks.get(stockId) : undefined;
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
      } else if (this.tableName === 'profiles' && eqUserId) {
        const profId = db.profileUserIdIndex.get(String(eqUserId)) || String(eqUserId);
        const profile = db.profiles.get(profId);
        targetList = profile ? [profile] : [];
      } else {
        // 인덱스가 없는 경우 기본 전체 테이블 스캔
        switch (this.tableName) {
          case 'stocks':
            targetList = Array.from(db.stocks.values());
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

      // ── 2. DML 연산 처리 (인덱스 동기화 포함) ──
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
          } else if (this.tableName === 'option_settlements') {
            db.optionSettlements.push(record);
          } else if (this.tableName === 'bond_coupon_payments') {
            db.bondCouponPayments.push(record);
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
            const key = item.id || `stock_${item.ticker}`;
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
          }
        }
        return { data: this.payloadData, error: null };
      }

      if (this.action === 'update') {
        targetList.forEach((item) => {
          if (this.matchesFilters(item)) {
            Object.assign(item, this.payloadData);
          }
        });
        return { data: this.payloadData, error: null };
      }

      if (this.action === 'delete') {
        if (this.tableName === 'holdings') {
          for (const [key, val] of db.holdings.entries()) {
            if (this.matchesFilters(val)) {
              db.removeHoldingFromIndex(val);
              db.holdings.delete(key);
            }
          }
        } else if (this.tableName === 'orders') {
          for (const [key, val] of db.orders.entries()) {
            if (this.matchesFilters(val)) {
              db.removeOrderFromIndex(val);
              db.orders.delete(key);
            }
          }
        }
        return { data: null, error: null };
      }

      // ── 3. SELECT 필터링 ──
      let filtered = targetList.filter((item) => this.matchesFilters(item));

      // ── 4. 정렬 ──
      if (this.orderCol) {
        const col = this.orderCol;
        const asc = this.orderAsc;
        filtered.sort((a, b) => {
          const va = a[col];
          const vb = b[col];
          if (va < vb) return asc ? -1 : 1;
          if (va > vb) return asc ? 1 : -1;
          return 0;
        });
      }

      // ── 5. Limit 제한 ──
      if (this.limitCount !== undefined) {
        filtered = filtered.slice(0, this.limitCount);
      }

      // ── 6. Single / MaybeSingle 반환 ──
      if (this.isSingle) {
        return { data: filtered[0] ?? null, error: filtered[0] ? null : { message: 'Row not found' } };
      }
      if (this.isMaybeSingle) {
        return { data: filtered[0] ?? null, error: null };
      }

      return { data: filtered, error: null };
    } catch (e: any) {
      return { data: null, error: { message: e?.message || 'In-memory error' } };
    }
  }

  private matchesFilters(item: any): boolean {
    for (const f of this.filters) {
      const v = item[f.col];
      if (f.op === 'eq' && v !== f.val) return false;
      if (f.op === 'neq' && v === f.val) return false;
      if (f.op === 'gt' && !(v > f.val)) return false;
      if (f.op === 'gte' && !(v >= f.val)) return false;
      if (f.op === 'lt' && !(v < f.val)) return false;
      if (f.op === 'lte' && !(v <= f.val)) return false;
      if (f.op === 'in' && Array.isArray(f.val) && !f.val.includes(v)) return false;
    }
    return true;
  }

  public then<TResult1 = any, TResult2 = never>(
    onfulfilled?: ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export class MockSupabaseClient {
  public from(tableName: string): any {
    return new MemoryQueryBuilder(tableName);
  }

  /**
   * RPC 함수 실행 (updateAtomic 원자적 트랜잭션 보장)
   */
  public async rpc(fnName: string, params: any): Promise<{ data: any; error: any }> {
    const db = memoryDb;
    if (fnName === 'increment_user_cash') {
      const userId = params?.p_user_id || params?.user_id || 'guest_user';
      const delta = Number(params?.p_delta || params?.amount || 0);

      // 원자적 잔고 업데이트 실행 (Race Condition 차단)
      const updatedProfile = await db.updateAtomic<ProfileRecord>(`profile:${userId}`, (prev) => {
        const user = prev || db.profiles.get(userId) || db.profiles.get('guest_user');
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
      let settledCount = 0;

      for (const t of trades) {
        const buyerId = t.buyer_id;
        const sellerId = t.seller_id;
        const tradeAmount = Number(t.price) * Number(t.size);

        if (!t.buyer_is_bot && buyerId) {
          const buyer = db.profiles.get(buyerId);
          if (buyer) {
            buyer.cash -= tradeAmount;
            buyer.net_worth -= tradeAmount;
          }
        }

        if (!t.seller_is_bot && sellerId) {
          const seller = db.profiles.get(sellerId);
          if (seller) {
            seller.cash += tradeAmount;
            seller.net_worth += tradeAmount;
          }
        }

        const tradeId = t.id || `trade_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        db.trades.push({
          id: tradeId,
          stock_id: t.stock_id,
          buyer_id: buyerId,
          seller_id: sellerId,
          buyer_is_bot: !!t.buyer_is_bot,
          seller_is_bot: !!t.seller_is_bot,
          price: Number(t.price),
          size: Number(t.size),
          created_at: t.created_at || new Date().toISOString(),
        });
        settledCount++;
      }

      return { data: { success: true, settled_count: settledCount }, error: null };
    }

    return { data: null, error: null };
  }

  public get auth(): any {
    return {
      getUser: async () => {
        const user = memoryDb.profiles.get('guest_user');
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
              user: { id: 'guest_user', email: 'guest@stocksys.local' },
            },
          },
          error: null,
        };
      },
      signInWithPassword: async () => ({ data: { user: { id: 'guest_user' } }, error: null }),
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
