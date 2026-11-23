import { BaseAgent } from './BaseAgent';
import type { AgentConfig } from '../types';
import type { SimulationContext } from '../../../lib/engine/simulation/runtime';

export class ExecutionTrader extends BaseAgent {
  constructor(config: AgentConfig, initialCapital: number, context?: SimulationContext) {
    super(config, initialCapital, context);
  }

  // 매 틱마다 호출되는 메인 로직
  public evaluateMarketAndPlaceOrders(marketState: any): any[] {
    // CIO Logic & Execution Logic (TWAP)
    const orders = this.executePortfolioRebalancing(marketState);
    return orders;
  }
}
