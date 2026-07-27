import { BaseAgent } from './BaseAgent';
import type { AgentConfig } from '../types';

export class ExecutionTrader extends BaseAgent {
  constructor(config: AgentConfig, initialCapital: number) {
    super(config, initialCapital);
  }

  // 매 틱마다 호출되는 메인 로직
  public evaluateMarketAndPlaceOrders(marketState: any): any[] {
    // CIO Logic & Execution Logic (TWAP)
    const orders = this.executePortfolioRebalancing(marketState);
    return orders;
  }
}
