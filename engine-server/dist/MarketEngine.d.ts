import type { MarketEvent } from './types';
export declare class MarketEngine {
    private isRunning;
    private tickIntervalMs;
    private tickTimer;
    private manipulationCheckTimer;
    private hawkesIntensity;
    private readonly mu;
    private readonly alpha;
    private readonly beta;
    private lastTickTime;
    private activeEvents;
    private pensionFunds;
    private commercialBanks;
    private hedgeFunds;
    private propDesks;
    private retailSwarms;
    private statArbBots;
    private optionsMMBots;
    private quantBots;
    private marketMaker;
    private realWorldFetcher;
    constructor();
    injectEvent(event: MarketEvent): void;
    initializeBots(): Promise<void>;
    start(): Promise<void>;
    stop(): void;
    private scheduleNextTick;
    private checkManipulations;
    private tick;
    private triggerRandomEvents;
    private fetchMarketState;
    private processBatchOrders;
}
//# sourceMappingURL=MarketEngine.d.ts.map