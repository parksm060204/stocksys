import { GUEST_USER_ID } from "../memoryDb/memoryStore";

let browserClient: any = null;

export class HttpQueryBuilder {
  private tableName: string;
  private filters: { col: string; op: string; val: any }[] = [];
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

  public or(_expr: string): this {
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

  public async execute(): Promise<{ data: any; error: any }> {
    try {
      const res = await fetch('/api/local-db', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'execute',
          tableName: this.tableName,
          query: {
            filters: this.filters,
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
        return { data: null, error: { message: `Local DB API error: ${text}` } };
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

export class HttpMemoryClient {
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
        return { data: null, error: { message: `Local RPC Error: ${res.statusText}` } };
      }
      return await res.json();
    } catch (err: any) {
      return { data: null, error: { message: err?.message || String(err) } };
    }
  }

  public get auth(): any {
    return {
      getUser: async () => ({
        data: {
          user: {
            id: GUEST_USER_ID,
            email: 'guest@stocksys.local',
            user_metadata: { nickname: '서학개미', username: '서학개미' },
          },
        },
        error: null,
      }),
      getSession: async () => ({
        data: {
          session: {
            access_token: 'mock_token',
            user: { id: GUEST_USER_ID, email: 'guest@stocksys.local' },
          },
        },
        error: null,
      }),
      signInWithPassword: async () => ({ data: { user: { id: GUEST_USER_ID } }, error: null }),
      signOut: async () => ({ error: null }),
    };
  }

  public channel(_name: string): any {
    return {
      on: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }),
      subscribe: () => ({ unsubscribe: () => {} }),
    };
  }

  public removeChannel(_channel?: any): void {}
}

export function createClient(..._args: any[]): HttpMemoryClient {
  if (browserClient) return browserClient;
  browserClient = new HttpMemoryClient();
  return browserClient;
}
