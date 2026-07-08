import type { MarketEngine } from './MarketEngine';
export declare class EventDirector {
    private engine;
    private isRunning;
    private timer;
    private lastGlobalEventTime;
    constructor(engine: MarketEngine);
    start(): void;
    stop(): void;
    private tickMinute;
    private generateCalendarEvent;
    private generateRandomEvent;
    private scheduleCorrection;
}
//# sourceMappingURL=EventDirector.d.ts.map