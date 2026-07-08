"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PropDeskAgent = void 0;
const BaseAgent_1 = require("./BaseAgent");
class PropDeskAgent extends BaseAgent_1.BaseAgent {
    bot;
    constructor(bot) {
        super(bot.id, bot.capital);
        this.bot = bot;
    }
    executeMarketMaking(currentMarket, orderBook, myHoldings) {
        const orders = [];
        const availableStocks = currentMarket.stocks || [];
        // Avellaneda-Stoikov 마켓 메이킹 모델
        for (const stock of availableStocks) {
            const tickSize = this.getTickSize(stock.current_price);
            const holdingQty = myHoldings[stock.id] || 0;
            const targetQty = Math.floor((this.bot.capital * 0.05) / stock.current_price); // 5% 비중을 기본으로 설정
            if (targetQty <= 0)
                continue;
            // 파라미터 설정
            const s = stock.current_price; // Mid price (현재가로 대용)
            const q = (holdingQty - targetQty) / targetQty; // Inventory Skew (재고 편향: 많으면 양수, 적으면 음수)
            const gamma = 0.1; // Risk aversion (리스크 회피 계수)
            const dayReturn = (stock.current_price - stock.previous_close) / stock.previous_close;
            const sigma2 = Math.max(Math.pow(Math.abs(dayReturn) * 100, 2), 0.5); // Variance (최소값 0.5 보장)
            const T_minus_t = 1; // 1틱 단위로 가정
            // 1. 예약 가격(Reservation Price) 산출
            // 재고가 너무 많으면(q > 0) 기준 가격(r)을 낮춰서 팔기 쉽게 만들고, 재고가 부족하면(q < 0) 높여서 사기 쉽게 만듦
            const r = s - (q * gamma * sigma2 * T_minus_t);
            // 2. 최적 스프레드 산출 (간략화)
            const k = 1.5; // 유동성 밀도 파라미터
            const optimalSpread = (gamma * sigma2 * T_minus_t) + ((2 / gamma) * Math.log(1 + (gamma / k)));
            const halfSpread = (optimalSpread / 2) * tickSize; // 스프레드를 틱 단위로 스케일링
            // 3. 매수/매도 호가 결정
            const targetBuyPrice = Math.floor((r - halfSpread) / tickSize) * tickSize;
            const targetSellPrice = Math.ceil((r + halfSpread) / tickSize) * tickSize;
            const orderQty = Math.floor(targetQty * 0.1); // 매 틱마다 목표 물량의 10%씩 호가 배치
            if (orderQty <= 0)
                continue;
            // 매수 호가 배치 (긴급성 0.1로 스푸핑 및 빙산 유도)
            orders.push(...this.executeSmartOrder(stock, 'buy', targetBuyPrice, orderQty, 0.1, currentMarket.activeEvents));
            // 매도 호가 배치
            orders.push(...this.executeSmartOrder(stock, 'sell', targetSellPrice, orderQty, 0.1, currentMarket.activeEvents));
        }
        return orders;
    }
}
exports.PropDeskAgent = PropDeskAgent;
//# sourceMappingURL=PropDeskAgent.js.map