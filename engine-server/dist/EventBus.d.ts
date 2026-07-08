import type { MarketEvent } from "./types";
export type EventCallback = (event: MarketEvent) => void;
declare class EventBusImpl {
    private subscribers;
    subscribe(channel: string, callback: EventCallback): void;
    publish(channel: string, event: MarketEvent): void;
}
export declare const EventBus: EventBusImpl;
export {};
//# sourceMappingURL=EventBus.d.ts.map