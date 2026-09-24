/**
 * Feature Flags for STOCKSYS Simulation Engine
 *
 * Safety policy:
 * - Market abuse scenarios (spoofing, layering, predatory front-running) are STRICTLY DISABLED by default.
 * - Only enabled when ENABLE_MARKET_ABUSE_SCENARIOS is EXACTLY the string 'true'.
 * - Case variations ('True', 'TRUE'), numbers ('1'), or missing env MUST resolve to false (fail-closed).
 */

export function isMarketAbuseScenarioEnabled(): boolean {
  const envVal = process.env.ENABLE_MARKET_ABUSE_SCENARIOS;
  return envVal === 'true';
}

export interface SimulationFeatureFlags {
  readonly enableMarketAbuseScenarios: boolean;
}

export function getSimulationFeatureFlags(): SimulationFeatureFlags {
  return {
    enableMarketAbuseScenarios: isMarketAbuseScenarioEnabled()
  };
}
