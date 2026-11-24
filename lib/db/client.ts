import { GUEST_USER_ID } from "../memoryDb/memoryStore";
import { isDevGuestAuthEnabled } from "../engine/localDevMode";

let browserClient: any = null;

export class HttpQueryBuilder {
  private tableName: string;
  private filters: { col: string; op: string; val: any }[] = [];
  private orFilterGroups: string[] = [];
  private orderSpecs: { col: string; ascending: boolean }[] = [];
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

  public or(expr: string): this {
    this.orFilterGroups.push(expr);
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

  public async execute(): Promise<{
    data: any;
    error: any;
    meta?: { tradeGeneration?: string; serverMaxCursor?: number };
  }> {
    try {
      const res = await fetch('/api/local-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          tableName: this.tableName,
          query: {
            filters: this.filters,
            ...(this.orFilterGroups.length > 0 && { orFilterGroups: this.orFilterGroups }),
            orderSpecs: this.orderSpecs,
            orderCol: this.orderCol,
            orderAsc: this.orderAsc,
            limitCount: this.limitCount,
            isSingle: this.isSingle,
            isMaybeSingle: this.isMaybeSingle,
            action: this.action,
            payloadData: this.payloadData,
            upsertOptions: this.upsertOptions,
          },
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        try {
          const parsed = JSON.parse(text);
          const msg = parsed?.error?.message || parsed?.message || parsed?.error || `Local DB API error: ${text}`;
          return { data: null, error: { message: String(msg), status: res.status } };
        } catch {
          return { data: null, error: { message: `Local DB API error: ${text}`, status: res.status } };
        }
      }

      return await res.json();
    } catch (err: any) {
      return { data: null, error: { message: err?.message || String(err) } };
    }
  }

  public then(onfulfilled?: (value: any) => any, onrejected?: (reason: any) => any): Promise<any> {
    return this.execute().then(onfulfilled, onrejected);
  }
}

export interface TradeStreamResyncState {
  afterCursor?: number;
  afterGeneration?: string;
  seedKeys?: Iterable<string>;
}

interface PostgresChangesConfig {
  event?: string;
  schema?: string;
  table?: string;
  filter?: string;
  afterCursor?: number;
  afterGeneration?: string;
  seedKeys?: Iterable<string>;
  onReset?: (context: {
    generation?: string;
    reason: 'generation_changed' | 'cursor_regressed';
  }) => TradeStreamResyncState | void | Promise<TradeStreamResyncState | void>;
}

interface ChannelSubscriptionListener {
  id: number;
  event: string;
  table: string;
  filterCol?: string;
  filterVal?: string;
  callback: (payload: { new: any; eventType: string; table: string }) => void;
  onReset?: (context: {
    generation?: string;
    reason: 'generation_changed' | 'cursor_regressed';
  }) => TradeStreamResyncState | void | Promise<TradeStreamResyncState | void>;
  seenKeys: Set<string>;
  seenKeyTimes: Map<string, number>;
  initialized: boolean;
  cursorMode: boolean;
  lastCursor: number | null;
  tradeGeneration?: string;
  lastCreatedAtMs: number;
  unsubscribed: boolean;
}

const DEFAULT_CHANNEL_POLL_INTERVAL_MS = 1000;
const MAX_SEEN_KEYS = 6000;
const TRIM_SEEN_KEYS_TO = 5000;
const OVERLAP_LOOKBACK_MS = 60_000;
const POLL_BATCH_LIMIT = 200;
const MAX_POLL_PAGES_PER_CYCLE = 25;

export function getTradeDedupKey(row: Record<string, unknown>): string {
  if (row.id !== undefined && row.id !== null && String(row.id) !== '') {
    return `id:${String(row.id)}`;
  }
  return `row:${String(row.stock_id ?? '')}:${String(row.cursor ?? '')}:${String(row.created_at ?? '')}:${String(row.sequence ?? '')}:${String(row.price ?? '')}:${String(row.size ?? '')}`;
}

function parseEqFilter(filter?: string): { filterCol?: string; filterVal?: string } {
  if (!filter || typeof filter !== 'string') return {};
  const match = filter.match(/^\s*([a-zA-Z0-9_]+)\s*=\s*eq\.(.+)\s*$/);
  if (!match) return {};
  return { filterCol: match[1], filterVal: match[2] };
}

function trimListenerSeenKeys(listener: ChannelSubscriptionListener): void {
  if (listener.seenKeys.size <= MAX_SEEN_KEYS) return;
  const cutoffMs =
    listener.lastCreatedAtMs > 0 ? listener.lastCreatedAtMs - OVERLAP_LOOKBACK_MS : -Infinity;
  const excess = listener.seenKeys.size - TRIM_SEEN_KEYS_TO;
  let removed = 0;

  // In fallback timestamp mode, keep keys still inside the overlap lookback window
  // so subsequent lookback polls never re-emit them as duplicate INSERTs.
  for (const k of Array.from(listener.seenKeys)) {
    if (removed >= excess) break;
    const keyTime = listener.seenKeyTimes.get(k);
    if (!listener.cursorMode && keyTime !== undefined && keyTime >= cutoffMs) {
      continue;
    }
    listener.seenKeys.delete(k);
    listener.seenKeyTimes.delete(k);
    removed++;
  }
}

interface SharedPollGroup {
  key: string;
  table: string;
  filterCol?: string;
  filterVal?: string;
  listeners: Set<ChannelSubscriptionListener>;
  timer: ReturnType<typeof setTimeout> | null;
  isPolling: boolean;
  needsImmediateFollowup: boolean;
}

export class HttpRealtimeChannel {
  private listeners: ChannelSubscriptionListener[] = [];
  private isSubscribed = false;
  private isUnsubscribed = false;
  private nextListenerId = 1;

  constructor(
    public readonly name: string,
    private readonly client: HttpMemoryClient,
    private readonly onCleanup: (channel: HttpRealtimeChannel) => void
  ) {}

  public on(
    eventType: string,
    config: PostgresChangesConfig,
    callback: (payload: { new: any; eventType: string; table: string }) => void
  ): this {
    if (eventType !== 'postgres_changes' || !config?.table || typeof callback !== 'function') {
      return this;
    }
    const event = String(config.event || '*').toUpperCase();
    const { filterCol, filterVal } = parseEqFilter(config.filter);
    const hasInitialCursor =
      typeof config.afterCursor === 'number' && Number.isFinite(config.afterCursor);
    const seenKeys = new Set<string>();
    if (config.seedKeys) {
      for (const k of config.seedKeys) {
        if (k) seenKeys.add(String(k));
      }
    }
    const listener: ChannelSubscriptionListener = {
      id: this.nextListenerId++,
      event,
      table: config.table,
      filterCol,
      filterVal,
      callback,
      onReset: typeof config.onReset === 'function' ? config.onReset : undefined,
      seenKeys,
      seenKeyTimes: new Map<string, number>(),
      initialized: hasInitialCursor,
      cursorMode: hasInitialCursor,
      lastCursor: hasInitialCursor ? Number(config.afterCursor) : null,
      tradeGeneration: typeof config.afterGeneration === 'string' ? config.afterGeneration : undefined,
      lastCreatedAtMs: 0,
      unsubscribed: false,
    };
    this.listeners.push(listener);
    if (this.isSubscribed && !this.isUnsubscribed) {
      this.client.registerChannelListeners([listener]);
    }
    return this;
  }

  public subscribe(statusCallback?: (status: string) => void): this {
    if (this.isUnsubscribed || this.isSubscribed) {
      return this;
    }
    this.isSubscribed = true;
    statusCallback?.('SUBSCRIBED');
    this.client.registerChannelListeners(this.listeners);
    return this;
  }

  public unsubscribe(): void {
    if (this.isUnsubscribed) return;
    this.isUnsubscribed = true;
    this.isSubscribed = false;
    for (const listener of this.listeners) {
      listener.unsubscribed = true;
    }
    this.client.unregisterChannelListeners(this.listeners);
    this.onCleanup(this);
  }
}

export interface StockTradesStreamOptions {
  stockId: string;
  selectColumns?: string;
  initialLimit?: number;
  channelName?: string;
  onInitial: (rows: Record<string, unknown>[], error: any) => void;
  onInsert: (row: Record<string, unknown>) => void;
}

export function subscribeStockTradesWithInitialLoad(
  client: HttpMemoryClient,
  options: StockTradesStreamOptions
): () => void {
  const {
    stockId,
    selectColumns = 'id, stock_id, price, size, buyer_is_bot, seller_is_bot, created_at, sequence, cursor',
    initialLimit = 2000,
    channelName = `trades_${stockId}`,
    onInitial,
    onInsert,
  } = options;

  let cancelled = false;
  let activeChannel: HttpRealtimeChannel | null = null;

  const loadInitialTradesSnapshot = async () => {
    const res = await client
      .from('trades')
      .select(selectColumns)
      .eq('stock_id', stockId)
      .order('cursor', { ascending: false })
      .order('created_at', { ascending: false })
      .order('sequence', { ascending: false })
      .limit(initialLimit);

    const { data, error, meta } = res as {
      data: any;
      error: any;
      meta?: { tradeGeneration?: string; serverMaxCursor?: number };
    };
    const rawRows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
    const orderedRows = [...rawRows].reverse();
    const seedKeys = new Set<string>();
    let maxCursor: number | undefined = rawRows.length === 0 && !error ? 0 : undefined;

    for (const row of orderedRows) {
      if (!row || typeof row !== 'object') continue;
      seedKeys.add(getTradeDedupKey(row));
      if (typeof row.cursor === 'number' && Number.isFinite(row.cursor)) {
        maxCursor = maxCursor === undefined ? row.cursor : Math.max(maxCursor, row.cursor);
      }
    }

    const generation = typeof meta?.tradeGeneration === 'string' ? meta.tradeGeneration : undefined;
    return { orderedRows, error, seedKeys, maxCursor, generation };
  };

  void (async () => {
    const { orderedRows, error, seedKeys, maxCursor, generation } = await loadInitialTradesSnapshot();

    if (cancelled) return;

    onInitial(orderedRows, error);
    if (cancelled) return;

    activeChannel = client
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'trades',
          filter: `stock_id=eq.${stockId}`,
          afterCursor: maxCursor,
          afterGeneration: generation,
          seedKeys,
          onReset: async () => {
            if (cancelled) return undefined;
            const resynced = await loadInitialTradesSnapshot();
            if (cancelled || resynced.error) return undefined;
            onInitial(resynced.orderedRows, null);
            if (cancelled) return undefined;
            return {
              afterCursor: resynced.maxCursor ?? 0,
              afterGeneration: resynced.generation,
              seedKeys: resynced.seedKeys,
            };
          },
        },
        (payload) => {
          if (cancelled || !payload?.new) return;
          onInsert(payload.new as Record<string, unknown>);
        }
      )
      .subscribe();
  })();

  return () => {
    cancelled = true;
    if (activeChannel) {
      client.removeChannel(activeChannel);
      activeChannel = null;
    }
  };
}

export class HttpMemoryClient {
  private readonly activeChannels = new Set<HttpRealtimeChannel>();
  private readonly pollGroups = new Map<string, SharedPollGroup>();
  private readonly channelPollIntervalMs: number;

  constructor(options?: { channelPollIntervalMs?: number }) {
    const raw = options?.channelPollIntervalMs;
    this.channelPollIntervalMs =
      typeof raw === 'number' && Number.isFinite(raw) && raw > 0
        ? raw
        : DEFAULT_CHANNEL_POLL_INTERVAL_MS;
  }

  private getGroupKey(listener: ChannelSubscriptionListener): string {
    return `${listener.table}::${listener.filterCol ?? ''}::${listener.filterVal ?? ''}`;
  }

  public registerChannelListeners(listeners: ChannelSubscriptionListener[]): void {
    const touchedGroups = new Set<SharedPollGroup>();
    for (const listener of listeners) {
      if (listener.unsubscribed) continue;
      if (listener.event !== 'INSERT' && listener.event !== '*') continue;
      const key = this.getGroupKey(listener);
      let group = this.pollGroups.get(key);
      if (!group) {
        group = {
          key,
          table: listener.table,
          filterCol: listener.filterCol,
          filterVal: listener.filterVal,
          listeners: new Set<ChannelSubscriptionListener>(),
          timer: null,
          isPolling: false,
          needsImmediateFollowup: false,
        };
        this.pollGroups.set(key, group);
      }
      group.listeners.add(listener);
      touchedGroups.add(group);
    }

    for (const group of touchedGroups) {
      if (group.timer !== null) {
        clearTimeout(group.timer);
        group.timer = null;
      }
      if (group.isPolling) {
        group.needsImmediateFollowup = true;
      } else {
        void this.runGroupPollCycle(group);
      }
    }
  }

  public unregisterChannelListeners(listeners: ChannelSubscriptionListener[]): void {
    for (const listener of listeners) {
      const key = this.getGroupKey(listener);
      const group = this.pollGroups.get(key);
      if (!group) continue;
      group.listeners.delete(listener);
      if (group.listeners.size === 0) {
        if (group.timer !== null) {
          clearTimeout(group.timer);
          group.timer = null;
        }
        this.pollGroups.delete(key);
      }
    }
  }

  private scheduleGroupPoll(group: SharedPollGroup): void {
    if (group.listeners.size === 0 || this.pollGroups.get(group.key) !== group) return;
    if (group.timer !== null) return;
    group.timer = setTimeout(() => {
      group.timer = null;
      void this.runGroupPollCycle(group);
    }, this.channelPollIntervalMs);
  }

  private async runGroupPollCycle(group: SharedPollGroup): Promise<void> {
    if (group.listeners.size === 0 || this.pollGroups.get(group.key) !== group || group.isPolling) {
      return;
    }
    group.isPolling = true;
    try {
      await this.pollSharedGroup(group);
    } finally {
      group.isPolling = false;
      if (group.listeners.size > 0 && this.pollGroups.get(group.key) === group) {
        if (group.needsImmediateFollowup) {
          group.needsImmediateFollowup = false;
          void this.runGroupPollCycle(group);
        } else {
          this.scheduleGroupPoll(group);
        }
      }
    }
  }

  private async pollSharedGroup(group: SharedPollGroup): Promise<void> {
    const activeListeners = Array.from(group.listeners).filter((l) => !l.unsubscribed);
    if (activeListeners.length === 0) return;

    const uninitialized = activeListeners.filter((l) => !l.initialized);
    if (uninitialized.length > 0) {
      // Single bounded baseline query to establish tip cursor/timestamp for all newly joined listeners.
      let baseQuery = this.from(group.table).select('*');
      if (group.filterCol && group.filterVal !== undefined) {
        baseQuery = baseQuery.eq(group.filterCol, group.filterVal);
      }
      if (group.table === 'trades') {
        baseQuery = baseQuery
          .order('cursor', { ascending: false })
          .order('created_at', { ascending: false })
          .order('sequence', { ascending: false })
          .limit(1);
      } else {
        baseQuery = baseQuery.order('created_at', { ascending: false }).limit(POLL_BATCH_LIMIT);
      }

      const { data, error, meta } = await baseQuery;
      if (group.listeners.size === 0) return;
      if (!error && Array.isArray(data)) {
        const rows = data as Record<string, unknown>[];
        let tipCursor: number | null = rows.length === 0 && group.table === 'trades' ? 0 : null;
        let tipCreatedAtMs = 0;

        for (const row of rows) {
          if (!row || typeof row !== 'object') continue;
          if (typeof row.cursor === 'number' && Number.isFinite(row.cursor)) {
            tipCursor = tipCursor === null ? row.cursor : Math.max(tipCursor, row.cursor);
          }
          const createdAtMs = typeof row.created_at === 'string' ? Date.parse(row.created_at) : NaN;
          if (Number.isFinite(createdAtMs) && createdAtMs > tipCreatedAtMs) {
            tipCreatedAtMs = createdAtMs;
          }
          const key = getTradeDedupKey(row);
          for (const listener of uninitialized) {
            if (listener.unsubscribed) continue;
            listener.seenKeys.add(key);
            if (Number.isFinite(createdAtMs)) {
              listener.seenKeyTimes.set(key, createdAtMs);
            }
          }
        }

        const baseGeneration = typeof meta?.tradeGeneration === 'string' ? meta.tradeGeneration : undefined;
        for (const listener of uninitialized) {
          if (listener.unsubscribed) continue;
          if (tipCursor !== null) {
            listener.cursorMode = true;
            listener.lastCursor = tipCursor;
          } else {
            listener.cursorMode = false;
            listener.lastCreatedAtMs = tipCreatedAtMs;
          }
          if (baseGeneration !== undefined) {
            listener.tradeGeneration = baseGeneration;
          }
          listener.initialized = true;
        }
      }
    }

    const initializedListeners = Array.from(group.listeners).filter(
      (l) => !l.unsubscribed && l.initialized
    );
    if (initializedListeners.length === 0) return;

    const cursorListeners = initializedListeners.filter(
      (l) => l.cursorMode && l.lastCursor !== null
    );
    const legacyListeners = initializedListeners.filter(
      (l) => !l.cursorMode || l.lastCursor === null
    );

    if (cursorListeners.length > 0) {
      let minCursor = Math.min(...cursorListeners.map((l) => l.lastCursor!));
      for (let page = 0; page < MAX_POLL_PAGES_PER_CYCLE; page += 1) {
        if (group.listeners.size === 0) return;
        let query = this.from(group.table).select('*');
        if (group.filterCol && group.filterVal !== undefined) {
          query = query.eq(group.filterCol, group.filterVal);
        }
        query = query
          .gte('cursor', minCursor + 1)
          .order('cursor', { ascending: true })
          .order('created_at', { ascending: true })
          .order('sequence', { ascending: true })
          .limit(POLL_BATCH_LIMIT);

        const { data, error, meta } = await query;
        if (group.listeners.size === 0 || error || !Array.isArray(data)) break;

        const rows = data as Record<string, unknown>[];
        const serverGeneration = typeof meta?.tradeGeneration === 'string' ? meta.tradeGeneration : undefined;
        let serverMaxCursor =
          typeof meta?.serverMaxCursor === 'number' && Number.isFinite(meta.serverMaxCursor)
            ? meta.serverMaxCursor
            : undefined;

        // Fallback when custom/mock transport omits `meta`:
        // check latest cursor on empty incremental result or derive tip from partial page.
        if (
          serverGeneration === undefined &&
          serverMaxCursor === undefined &&
          group.table === 'trades'
        ) {
          if (rows.length === 0 && minCursor > 0) {
            let tipQuery = this.from(group.table).select('*');
            if (group.filterCol && group.filterVal !== undefined) {
              tipQuery = tipQuery.eq(group.filterCol, group.filterVal);
            }
            tipQuery = tipQuery
              .order('cursor', { ascending: false })
              .order('created_at', { ascending: false })
              .order('sequence', { ascending: false })
              .limit(1);
            const tipRes = await tipQuery;
            if (group.listeners.size === 0) return;
            if (!tipRes.error && Array.isArray(tipRes.data)) {
              const tipRows = tipRes.data as Record<string, unknown>[];
              if (tipRows.length === 0) {
                serverMaxCursor = 0;
              } else if (typeof tipRows[0]?.cursor === 'number' && Number.isFinite(tipRows[0].cursor)) {
                serverMaxCursor = tipRows[0].cursor;
              }
            }
          } else if (rows.length > 0 && rows.length < POLL_BATCH_LIMIT) {
            for (const row of rows) {
              if (row && typeof row === 'object' && typeof row.cursor === 'number' && Number.isFinite(row.cursor)) {
                serverMaxCursor = serverMaxCursor === undefined ? row.cursor : Math.max(serverMaxCursor, row.cursor);
              }
            }
          }
        }

        const resetTargets: Array<{
          listener: ChannelSubscriptionListener;
          reason: 'generation_changed' | 'cursor_regressed';
        }> = [];
        for (const listener of cursorListeners) {
          if (listener.unsubscribed) continue;
          if (serverGeneration !== undefined) {
            if (listener.tradeGeneration === undefined) {
              if (
                serverMaxCursor !== undefined &&
                listener.lastCursor !== null &&
                serverMaxCursor < listener.lastCursor
              ) {
                resetTargets.push({ listener, reason: 'cursor_regressed' });
              } else {
                listener.tradeGeneration = serverGeneration;
              }
              continue;
            }
            if (listener.tradeGeneration !== serverGeneration) {
              resetTargets.push({ listener, reason: 'generation_changed' });
              continue;
            }
          } else if (
            serverMaxCursor !== undefined &&
            listener.lastCursor !== null &&
            serverMaxCursor < listener.lastCursor
          ) {
            resetTargets.push({ listener, reason: 'cursor_regressed' });
          }
        }

        if (resetTargets.length > 0) {
          let didAnyListenerReset = false;
          for (const { listener, reason } of resetTargets) {
            if (listener.unsubscribed) continue;
            if (listener.onReset) {
              try {
                const resyncState = await listener.onReset({ generation: serverGeneration, reason });
                if (listener.unsubscribed) continue;
                if (resyncState) {
                  listener.seenKeys.clear();
                  listener.seenKeyTimes.clear();
                  if (resyncState.seedKeys) {
                    for (const k of resyncState.seedKeys) {
                      if (k) listener.seenKeys.add(String(k));
                    }
                  }
                  const hasResyncCursor =
                    typeof resyncState.afterCursor === 'number' && Number.isFinite(resyncState.afterCursor);
                  listener.cursorMode = hasResyncCursor;
                  listener.lastCursor = hasResyncCursor ? Number(resyncState.afterCursor) : null;
                  listener.tradeGeneration = resyncState.afterGeneration ?? serverGeneration;
                  listener.lastCreatedAtMs = 0;
                  listener.initialized = true;
                  didAnyListenerReset = true;
                }
              } catch {
                // Keep prior generation/cursor so next scheduled poll retries resync cleanly.
              }
            } else {
              listener.seenKeys.clear();
              listener.seenKeyTimes.clear();
              listener.lastCursor = 0;
              listener.lastCreatedAtMs = 0;
              listener.tradeGeneration = serverGeneration;
              didAnyListenerReset = true;
            }
          }
          if (didAnyListenerReset && group.listeners.size > 0) {
            group.needsImmediateFollowup = true;
          }
          break;
        }

        if (rows.length === 0) break;

        // If mock response omitted numeric cursor, switch these listeners to legacy dedup cleanly.
        const firstValidCursor = rows.find(
          (r) => r && typeof r === 'object' && typeof r.cursor === 'number' && Number.isFinite(r.cursor)
        );
        if (!firstValidCursor) {
          for (const listener of cursorListeners) {
            listener.cursorMode = false;
          }
          this.deliverRowsToListeners(rows, group, cursorListeners, false);
          break;
        }

        const maxSeenInBatch = this.deliverRowsToListeners(rows, group, cursorListeners, true);
        if (maxSeenInBatch <= minCursor || rows.length < POLL_BATCH_LIMIT) {
          break;
        }
        minCursor = maxSeenInBatch;
      }
    }

    if (legacyListeners.length > 0) {
      let minCreatedAtMs = Infinity;
      for (const l of legacyListeners) {
        if (l.lastCreatedAtMs > 0 && l.lastCreatedAtMs < minCreatedAtMs) {
          minCreatedAtMs = l.lastCreatedAtMs;
        }
      }
      let query = this.from(group.table).select('*');
      if (group.filterCol && group.filterVal !== undefined) {
        query = query.eq(group.filterCol, group.filterVal);
      }
      if (Number.isFinite(minCreatedAtMs) && minCreatedAtMs > 0) {
        const lookbackIso = new Date(Math.max(0, minCreatedAtMs - OVERLAP_LOOKBACK_MS)).toISOString();
        query = query.gte('created_at', lookbackIso);
      }
      query = query.order('created_at', { ascending: true });
      if (group.table === 'trades') {
        query = query.order('sequence', { ascending: true });
      }
      query = query.limit(POLL_BATCH_LIMIT);

      const { data, error } = await query;
      if (!error && Array.isArray(data) && group.listeners.size > 0) {
        this.deliverRowsToListeners(data as Record<string, unknown>[], group, legacyListeners, false);
      }
    }
  }

  private deliverRowsToListeners(
    rows: Record<string, unknown>[],
    group: SharedPollGroup,
    listeners: ChannelSubscriptionListener[],
    useCursorMode: boolean
  ): number {
    let maxBatchCursor = -1;

    for (const row of rows) {
      if (group.listeners.size === 0) break;
      if (!row || typeof row !== 'object') continue;
      if (
        group.filterCol &&
        group.filterVal !== undefined &&
        String(row[group.filterCol] ?? '') !== String(group.filterVal)
      ) {
        continue;
      }

      const rowCursor =
        typeof row.cursor === 'number' && Number.isFinite(row.cursor) ? row.cursor : null;
      if (rowCursor !== null && rowCursor > maxBatchCursor) {
        maxBatchCursor = rowCursor;
      }

      const key = getTradeDedupKey(row);
      const createdAtMs = typeof row.created_at === 'string' ? Date.parse(row.created_at) : NaN;

      for (const listener of listeners) {
        if (listener.unsubscribed) continue;

        if (useCursorMode && rowCursor !== null && listener.lastCursor !== null) {
          if (rowCursor <= listener.lastCursor) {
            continue;
          }
          listener.lastCursor = rowCursor;
        }

        if (Number.isFinite(createdAtMs) && createdAtMs > listener.lastCreatedAtMs) {
          listener.lastCreatedAtMs = createdAtMs;
        }

        if (listener.seenKeys.has(key)) {
          continue;
        }
        listener.seenKeys.add(key);
        if (Number.isFinite(createdAtMs)) {
          listener.seenKeyTimes.set(key, createdAtMs);
        }

        try {
          listener.callback({
            new: row,
            eventType: 'INSERT',
            table: listener.table,
          });
        } catch {
          // isolate subscriber callback errors
        }
      }
    }

    for (const listener of listeners) {
      trimListenerSeenKeys(listener);
    }

    return maxBatchCursor;
  }

  public from(tableName: string): HttpQueryBuilder {
    return new HttpQueryBuilder(tableName);
  }

  public async rpc(fnName: string, params?: any): Promise<{ data: any; error: any }> {
    try {
      const res = await fetch('/api/local-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'rpc', fnName, params }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        try {
          const parsed = JSON.parse(text);
          const msg = parsed?.error?.message || parsed?.message || parsed?.error || `Local RPC Error: ${res.statusText}`;
          return { data: null, error: { message: String(msg), status: res.status } };
        } catch {
          return { data: null, error: { message: text || `Local RPC Error: ${res.statusText}`, status: res.status } };
        }
      }
      return await res.json();
    } catch (err: any) {
      return { data: null, error: { message: err?.message || String(err) } };
    }
  }

  public get auth(): any {
    return {
      getUser: async () => {
        if (!isDevGuestAuthEnabled()) {
          return { data: { user: null }, error: null };
        }
        return {
          data: {
            user: {
              id: GUEST_USER_ID,
              email: 'guest@stocksys.local',
              user_metadata: { nickname: '서학개미', username: '서학개미' },
            },
          },
          error: null,
        };
      },
      getSession: async () => {
        if (!isDevGuestAuthEnabled()) {
          return { data: { session: null }, error: null };
        }
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
      signInWithPassword: async () =>
        isDevGuestAuthEnabled()
          ? { data: { user: { id: GUEST_USER_ID } }, error: null }
          : { data: { user: null }, error: { message: 'Guest auth disabled in production' } },
      signOut: async () => ({ error: null }),
    };
  }

  public channel(name: string): HttpRealtimeChannel {
    const ch = new HttpRealtimeChannel(name, this, (closed) => {
      this.activeChannels.delete(closed);
    });
    this.activeChannels.add(ch);
    return ch;
  }

  public removeChannel(channel?: HttpRealtimeChannel | null): void {
    if (channel && typeof channel.unsubscribe === 'function') {
      channel.unsubscribe();
      this.activeChannels.delete(channel);
    }
  }

  public removeAllChannels(): void {
    for (const ch of Array.from(this.activeChannels)) {
      ch.unsubscribe();
    }
    this.activeChannels.clear();
  }
}

export function setBrowserClient(client: any): void {
  browserClient = client;
}

export function createClient(..._args: any[]): HttpMemoryClient {
  if (browserClient) return browserClient;
  browserClient = new HttpMemoryClient();
  return browserClient;
}
