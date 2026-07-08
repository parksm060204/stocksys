import type { MarketEvent } from './types';
export declare class MarketEngine {
    private isRunning;
    private tickIntervalMs;
    private tickTimer;
    private manipulationCheckTimer;
    private activeEvents;
    private pensionFunds;
    private commercialBanks;
    private hedgeFunds;
    private propDesks;
    private retailSwarms;
    private marketMaker;
    private realWorldFetcher;
    constructor();
    injectEvent(event: MarketEvent): void;
    initializeBots(): Promise<void>;
    start(): Promise<void>;
    stop(): void;
    private checkManipulations;
    private tick;
    private triggerRandomEvents;
    private fetchMarketState;
    private processBatchOrders;
}
//# sourceMappingURL=MarketEngine.d.ts.map