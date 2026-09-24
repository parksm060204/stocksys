/**
 * Central Registry of PRNG Namespaces for STOCKSYS Simulation Engine
 *
 * CRITICAL POLICY:
 * - Every subsystem, market diffusion model, event director, and bot fleet must use
 *   a distinct namespace to prevent cross-stream correlation and order-dependent pollution.
 * - Namespaces must never collide across distinct decision paths.
 */

export const SIMULATION_NAMESPACES = {
  MARKET_ENGINE: {
    MJD_DIFFUSION: 'market_engine:mjd_diffusion',
    MJD_JUMP: 'market_engine:mjd_jump',
    PLAYER_EVENT: 'market_engine:player_event',
    EXCHANGE_RATE: 'market_engine:exchange_rate',
  },
  EVENT_DIRECTOR: {
    NEWS_SCHEDULE: 'event_director:news_schedule',
    NEWS_CONTENT: 'event_director:news_content',
  },
  SERVICES: {
    NEWS_GENERATOR: 'services:news_generator',
  },
  BOTS: {
    COMMERCIAL_BANK: (id: string) => `bot:commercial_bank:${id}`,
    PENSION_FUND: (id: string) => `bot:pension_fund:${id}`,
    HEDGE_FUND: (id: string) => `bot:hedge_fund:${id}`,
    PROP_DESK: (id: string) => `bot:prop_desk:${id}`,
    PROP_DESK_ABUSE: (id: string) => `bot:prop_desk:${id}:market_abuse`,
    RETAIL_SWARM: (id: string) => `bot:retail_swarm:${id}`,
    QUANT: (id: string) => `bot:quant:${id}`,
    STAT_ARB: (id: string) => `bot:stat_arb:${id}`,
  }
} as const;

/**
 * Registry to track active namespaces within a context and prevent collisions.
 */
export class SimulationNamespaceTracker {
  private activeNamespaces: Set<string> = new Set();

  public register(namespace: string): void {
    if (this.activeNamespaces.has(namespace)) {
      throw new Error(`[SimulationNamespaceTracker] Duplicate PRNG namespace detected: "${namespace}". Subsystems must use unique namespaces.`);
    }
    this.activeNamespaces.add(namespace);
  }

  public has(namespace: string): boolean {
    return this.activeNamespaces.has(namespace);
  }

  /**
   * 현재 등록된 namespace 목록 (읽기 전용 복사본).
   * 운영 코드가 tracker 우회 여부를 감사/검증할 때 사용한다.
   */
  public getRegisteredNamespaces(): readonly string[] {
    return [...this.activeNamespaces];
  }

  public reset(): void {
    this.activeNamespaces.clear();
  }
}
