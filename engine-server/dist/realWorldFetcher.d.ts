export interface MacroData {
    us10yYield: number;
    vix: number;
    updatedAt: number;
}
export declare class RealWorldFetcher {
    private lastData;
    private isFetching;
    private CACHE_TTL_MS;
    getMacroData(): Promise<MacroData | null>;
}
//# sourceMappingURL=realWorldFetcher.d.ts.map