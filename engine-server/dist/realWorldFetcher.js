"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RealWorldFetcher = void 0;
const yahoo_finance2_1 = __importDefault(require("yahoo-finance2"));
class RealWorldFetcher {
    lastData = null;
    isFetching = false;
    CACHE_TTL_MS = 60000 * 5; // 5분 캐싱 (API Rate Limit 방지)
    async getMacroData() {
        const now = Date.now();
        if (this.lastData && now - this.lastData.updatedAt < this.CACHE_TTL_MS) {
            return this.lastData;
        }
        if (this.isFetching) {
            return this.lastData;
        }
        this.isFetching = true;
        try {
            console.log("Fetching real-world macro data from Yahoo Finance...");
            let tnxResult = null;
            let vixResult = null;
            try {
                tnxResult = await yahoo_finance2_1.default.quote('^TNX');
            }
            catch (e) { }
            try {
                vixResult = await yahoo_finance2_1.default.quote('^VIX');
            }
            catch (e) { }
            const tnx = tnxResult?.regularMarketPrice || 4.2; // Default fallback 4.2%
            const vix = vixResult?.regularMarketPrice || 20.0; // Default fallback 20.0
            this.lastData = {
                us10yYield: tnx,
                vix: vix,
                updatedAt: now
            };
            console.log(`Real-world data updated - US10Y: ${tnx}%, VIX: ${vix}`);
            return this.lastData;
        }
        catch (error) {
            console.error("Failed to fetch real-world macro data:", error);
            return this.lastData;
        }
        finally {
            this.isFetching = false;
        }
    }
}
exports.RealWorldFetcher = RealWorldFetcher;
//# sourceMappingURL=realWorldFetcher.js.map