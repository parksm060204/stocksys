import yahooFinance from 'yahoo-finance2';

export interface MacroData {
  us10yYield: number; // ^TNX (US 10 Year Treasury Note)
  vix: number;        // ^VIX (Volatility Index)
  updatedAt: number;
}

export class RealWorldFetcher {
  private lastData: MacroData | null = null;
  private isFetching: boolean = false;
  private CACHE_TTL_MS = 60000 * 5; // 5분 캐싱 (API Rate Limit 방지)

  public async getMacroData(): Promise<MacroData | null> {
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
      
      const [tnxResult, vixResult] = await Promise.all([
        yahooFinance.quote('^TNX').catch(() => null),
        yahooFinance.quote('^VIX').catch(() => null)
      ]);

      const tnx = tnxResult?.regularMarketPrice || 4.2; // Default fallback 4.2%
      const vix = vixResult?.regularMarketPrice || 20.0; // Default fallback 20.0
      
      this.lastData = {
        us10yYield: tnx,
        vix: vix,
        updatedAt: now
      };
      
      console.log(`Real-world data updated - US10Y: ${tnx}%, VIX: ${vix}`);
      return this.lastData;
    } catch (error) {
      console.error("Failed to fetch real-world macro data:", error);
      return this.lastData;
    } finally {
      this.isFetching = false;
    }
  }
}
