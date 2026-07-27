export type EventCallback = (payload: any) => void;
declare class EventBusImpl {
    private subscribers;
    subscribe(channel: string, callback: EventCallback): void;
    publish(channel: string, payload: any): void;
}
export declare const EventBus: EventBusImpl;
export {};
//# sourceMappingURL=EventBus.d.ts.map