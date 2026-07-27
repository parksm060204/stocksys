import { BaseAgent } from './BaseAgent';
import type { AgentConfig } from '../types';
export declare class ExecutionTrader extends BaseAgent {
    constructor(config: AgentConfig, initialCapital: number);
    evaluateMarketAndPlaceOrders(marketState: any): any[];
}
//# sourceMappingURL=ExecutionTrader.d.ts.map