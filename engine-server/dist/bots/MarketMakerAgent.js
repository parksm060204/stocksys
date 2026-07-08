"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MarketMakerAgent = void 0;
const BaseAgent_1 = require("./BaseAgent");
class MarketMakerAgent extends BaseAgent_1.BaseAgent {
    activePhase = 0; // 0: None, 1: Accumulation, 2: Markup, 3: Distribution
    targetStockId = null;
    inventory = 0;
    targetInventory = 0;
    phaseTicks = 0;
    constructor() {
        // 세력 봇은 고유 ID와 막대한 자본을 가짐
        super('bot_market_maker_001', 50000000000); // 500억
    }
    // 관리자(DB 등)로부터 특정 주식 작전 지시 수신
    triggerManipulation(stockId, marketCap, currentPrice) {
        if (this.activePhase !== 0)
            return; // 이미 진행 중이면 무시
        this.targetStockId = stockId;
        this.activePhase = 1;
        this.inventory = 0;
        // 유통 주식(float)의 약 3%를 매집 목표로 설정
        const assumedTotalShares = Math.floor(marketCap / currentPrice);
        this.targetInventory = Math.floor(assumedTotalShares * 0.03);
        this.phaseTicks = 0;
        console.log(`[Market Maker] 🚨 MANIPULATION INITIATED on ${stockId}. Target 3% Float: ${this.targetInventory} shares.`);
    }
    executeManipulation(currentMarket) {
        const orders = [];
        if (this.activePhase === 0 || !this.targetStockId)
            return orders;
        const availableStocks = currentMarket.stocks || [];
        const stock = availableStocks.find((s) => s.id === this.targetStockId);
        if (!stock)
            return orders;
        const tickSize = this.getTickSize(stock.current_price);
        this.phaseTicks++;
        switch (this.activePhase) {
            case 1: // Phase 1: 매집 (Accumulation)
                // 상단에 허수 매도벽 (Spoofing) - 3틱 위
                orders.push({
                    stock_id: stock.id,
                    user_id: null,
                    side: 'sell',
                    price: stock.current_price + (tickSize * 3),
                    size: Math.floor(this.targetInventory * 0.5), // 거대한 허수 벽
                    status: 'open',
                    is_lp: true
                });
                // 하단에 아이스버그 매수 (은밀한 매집) - 1틱 아래
                const qtyToBuy = Math.min(Math.floor(this.targetInventory * 0.05), this.targetInventory - this.inventory);
                if (qtyToBuy > 0) {
                    orders.push({
                        stock_id: stock.id,
                        user_id: null,
                        side: 'buy',
                        price: stock.current_price - tickSize,
                        size: qtyToBuy,
                        status: 'open',
                        is_lp: true
                    });
                    this.inventory += qtyToBuy; // 시뮬레이션 상 100% 체결된다고 가정하고 증가
                }
                if (this.inventory >= this.targetInventory || this.phaseTicks > 60) {
                    console.log(`[Market Maker] 🚀 Phase 1 Complete. Moving to Phase 2 (Markup). Inventory: ${this.inventory}`);
                    this.activePhase = 2;
                    this.phaseTicks = 0;
                }
                break;
            case 2: // Phase 2: 시세 조종 (Markup)
                // 매도벽 철회 (Spoofing 안함)
                // 상단 매물 시장가 흡수 (Ramping) 및 자전 거래 효과
                // 5틱 위까지 싹쓸이하여 헤지펀드 Jump와 개미 FOMO 유발
                const rampingQty = Math.floor(this.inventory * 0.1);
                orders.push({
                    stock_id: stock.id,
                    user_id: null,
                    side: 'buy',
                    price: stock.current_price + (tickSize * 5),
                    size: rampingQty,
                    status: 'open',
                    is_lp: true
                });
                // 평단가 대비 25% 이상 올랐거나 시간이 지나면 Phase 3로
                if (this.phaseTicks > 30) { // 임의의 30틱 동안 펌핑
                    console.log(`[Market Maker] 🛑 Phase 2 Complete. Moving to Phase 3 (Distribution).`);
                    this.activePhase = 3;
                    this.phaseTicks = 0;
                }
                break;
            case 3: // Phase 3: 분배 및 덤프 (Distribution & Dump)
                // 하단에 막대한 가짜 매수 지지선 (Support Wall) 스푸핑 - 2틱 아래
                orders.push({
                    stock_id: stock.id,
                    user_id: null,
                    side: 'buy',
                    price: stock.current_price - (tickSize * 2),
                    size: Math.floor(this.targetInventory * 0.8),
                    status: 'open',
                    is_lp: true
                });
                // 몰려드는 개미의 매수세에 지정가 매도 떠넘기기 - 현재가에
                const offloadQty = Math.floor(this.inventory / 10);
                if (offloadQty > 0) {
                    orders.push({
                        stock_id: stock.id,
                        user_id: null,
                        side: 'sell',
                        price: stock.current_price,
                        size: offloadQty,
                        status: 'open',
                        is_lp: true
                    });
                    this.inventory -= offloadQty;
                }
                // 재고 소진 후 철수 (덤프 유도)
                if (this.inventory <= 0 || this.phaseTicks > 60) {
                    console.log(`[Market Maker] 💥 Manipulation Complete. Wall pulled, Dump imminent.`);
                    this.activePhase = 0;
                    this.targetStockId = null;
                }
                break;
        }
        return orders;
    }
}
exports.MarketMakerAgent = MarketMakerAgent;
//# sourceMappingURL=MarketMakerAgent.js.map