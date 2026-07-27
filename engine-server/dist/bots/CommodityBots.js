"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CTAAgent = exports.CommercialHedgerAgent = void 0;
const BaseAgent_1 = require("./BaseAgent");
/**
 * 1. Commercial Hedger Bot (보수적 헤지 목적)
 * 실제 생산자/수요자 입장에서 가격이 임계치에 도달하면 대규모 지정가 호가벽을 세웁니다.
 */
class CommercialHedgerAgent extends BaseAgent_1.BaseAgent {
    config;
    constructor(config) {
        super(config.id, config.capital);
        this.config = config;
    }
    executeHedging(commodityPrice, commodityId, tickSize) {
        const orders = [];
        const { supportLevel, resistanceLevel } = this.config;
        // 현재가가 지지선 근처면 매수벽(Buy Wall), 저항선 근처면 매도벽(Sell Wall)
        const thresholdPct = 0.02; // 임계치 2% 접근 시
        if (commodityPrice <= supportLevel * (1 + thresholdPct)) {
            // 대규모 지정가 매수 (지지선 방어)
            const qty = Math.floor((this.capital * 0.1) / supportLevel);
            orders.push({
                stock_id: commodityId, // MarketEngine에서는 통일성을 위해 stock_id 필드를 사용한다고 가정
                user_id: null,
                side: 'buy',
                price: supportLevel,
                size: qty,
                status: 'open',
                is_lp: true,
                _botId: this.botId
            });
        }
        else if (commodityPrice >= resistanceLevel * (1 - thresholdPct)) {
            // 대규모 지정가 매도 (저항선 방어)
            const qty = Math.floor((this.capital * 0.1) / resistanceLevel);
            orders.push({
                stock_id: commodityId,
                user_id: null,
                side: 'sell',
                price: resistanceLevel,
                size: qty,
                status: 'open',
                is_lp: true,
                _botId: this.botId
            });
        }
        return orders;
    }
}
exports.CommercialHedgerAgent = CommercialHedgerAgent;
/**
 * 2. CTA Bot (Commodity Trading Advisor, 돌파형 추세추종)
 * 가격 모멘텀이 터질 때 시장가로 밀어붙여 추세를 가속화합니다.
 */
class CTAAgent extends BaseAgent_1.BaseAgent {
    config;
    priceHistory = [];
    constructor(config) {
        super(config.id, config.capital);
        this.config = config;
    }
    executeMomentum(commodityPrice, commodityId, tickSize, activeEvents = []) {
        const orders = [];
        this.priceHistory.push(commodityPrice);
        // 최소 히스토리가 쌓여야 판단 가능 (최근 10틱)
        if (this.priceHistory.length > 10) {
            this.priceHistory.shift();
            const pastPrice = this.priceHistory[0];
            const momentum = (commodityPrice - pastPrice) / pastPrice;
            if (Math.abs(momentum) >= this.config.breakoutThreshold) {
                // 돌파 발생!
                const side = momentum > 0 ? 'buy' : 'sell';
                const urgency = 1.0; // 무조건 긁어버리는 시장가 스윕
                // 원자재 시장 가격의 과도한 급변을 막기 위해 주문 비율을 0.05% 수준으로 완화하고 최대 수량을 제한 (최대 1000계약)
                let targetQty = Math.floor((this.capital * 0.0005) / commodityPrice);
                targetQty = Math.min(1000, targetQty);
                // BaseAgent의 executeSmartOrder(urgency=1.0)를 호출하면 Sweep-to-fill 발생
                const sweepOrders = this.executeSmartOrder({ id: commodityId, current_price: commodityPrice }, side, commodityPrice, targetQty, urgency, activeEvents);
                orders.push(...sweepOrders);
            }
        }
        return orders;
    }
    getTickSize(price) {
        if (price < 10)
            return 0.0005; // Copper, Natural Gas
        if (price < 100)
            return 0.01; // WTI Crude
        if (price < 1000)
            return 0.25; // Corn
        return 0.10; // Gold
    }
}
exports.CTAAgent = CTAAgent;
//# sourceMappingURL=CommodityBots.js.map