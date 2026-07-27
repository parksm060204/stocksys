"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExecutionTrader = void 0;
const BaseAgent_1 = require("./BaseAgent");
class ExecutionTrader extends BaseAgent_1.BaseAgent {
    constructor(config, initialCapital) {
        super(config, initialCapital);
    }
    // 매 틱마다 호출되는 메인 로직
    evaluateMarketAndPlaceOrders(marketState) {
        // CIO Logic & Execution Logic (TWAP)
        const orders = this.executePortfolioRebalancing(marketState);
        return orders;
    }
}
exports.ExecutionTrader = ExecutionTrader;
//# sourceMappingURL=ExecutionTrader.js.map