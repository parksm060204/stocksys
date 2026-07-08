"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RetailSwarmAgent = void 0;
class RetailSwarmAgent {
    bot;
    constructor(bot) {
        this.bot = bot;
    }
    getTickSize(price) {
        if (price < 2000)
            return 1;
        if (price < 5000)
            return 5;
        if (price < 20000)
            return 10;
        if (price < 50000)
            return 50;
        if (price < 200000)
            return 100;
        if (price < 500000)
            return 500;
        return 1000;
    }
    swarmState = {};
    executeSwarmBehavior(currentMarket, myHoldings) {
        const orders = [];
        const availableStocks = currentMarket.stocks || [];
        const activeEvents = currentMarket.activeEvents || [];
        for (const stock of availableStocks) {
            if (!stock.previous_close || stock.previous_close === 0)
                continue;
            let fomoOverride = false;
            let panicOverride = false;
            // 뉴스 이벤트 확인하여 개미들의 광기/공포 스위치 켜기
            for (const event of activeEvents) {
                if (event.targetSector === 'ALL' || event.targetSector === stock.sector) {
                    if (event.impact === 'STRONG_POSITIVE' || event.impact === 'POSITIVE') {
                        fomoOverride = true;
                    }
                    else if (event.impact === 'STRONG_NEGATIVE' || event.impact === 'NEGATIVE') {
                        panicOverride = true;
                    }
                }
            }
            const dayReturn = (stock.current_price - stock.previous_close) / stock.previous_close;
            const tickSize = this.getTickSize(stock.current_price);
            // Kirman's Ant Model Initialization
            if (!this.swarmState[stock.id]) {
                this.swarmState[stock.id] = { buyers: 50, sellers: 50, total: 100 };
            }
            const state = this.swarmState[stock.id];
            // Herding parameter (b) and spontaneous parameter (a)
            let a = 0.05;
            let b = 0.2; // 기본 허딩은 낮음 (정규 분포에 가까움)
            // 펌핑이나 급등락 시 군집 파라미터(b) 폭증 유발 (Bimodal 상전이 발생)
            if (Math.abs(dayReturn) > 0.05 || fomoOverride || panicOverride) {
                b = 0.8; // 허딩 파라미터 폭증 -> 쏠림 현상 가속
            }
            // 상태 전이 확률 계산
            const p_buyer_to_seller = a + b * (state.sellers / state.total);
            const p_seller_to_buyer = a + b * (state.buyers / state.total);
            let newBuyers = state.buyers;
            let newSellers = state.sellers;
            // 매수자 -> 매도자 전환
            for (let i = 0; i < state.buyers; i++) {
                if (Math.random() < p_buyer_to_seller) {
                    newBuyers--;
                    newSellers++;
                }
            }
            // 매도자 -> 매수자 전환
            for (let i = 0; i < state.sellers; i++) {
                if (Math.random() < p_seller_to_buyer) {
                    newSellers--;
                    newBuyers++;
                }
            }
            // 강제 쏠림 보정 (외부 충격: 펌핑/패닉)
            if (fomoOverride || dayReturn > 0.1) {
                // 억지로 매수자로 변환
                const converted = Math.floor(newSellers * 0.5);
                newSellers -= converted;
                newBuyers += converted;
            }
            else if (panicOverride || dayReturn < -0.1) {
                // 억지로 매도자로 변환
                const converted = Math.floor(newBuyers * 0.5);
                newBuyers -= converted;
                newSellers += converted;
            }
            state.buyers = Math.max(0, Math.min(state.total, newBuyers));
            state.sellers = state.total - state.buyers;
            // 실제 주문 생성 로직
            // 개미들은 지정가 대신 현재가 근방을 무작위로 때리거나 허수성 주문을 남발함
            let activeAnts = Math.floor(Math.random() * 10) + 5; // 이번 틱에 행동할 개미 수
            // 극단적 쏠림 발생 시 참여 개미 수 폭발 (프랙탈적 연쇄 반응)
            if (fomoOverride || dayReturn > 0.1) {
                activeAnts = Math.floor(Math.random() * 30) + 15;
            }
            else if (panicOverride || dayReturn < -0.1) {
                activeAnts = Math.floor(Math.random() * 50) + 20; // 패닉셀일 때 개미가 더 많이 던짐
            }
            for (let i = 0; i < activeAnts; i++) {
                const isBuyer = Math.random() < (state.buyers / state.total);
                const tinyQty = Math.floor(Math.random() * 5) + 1; // 1~5주 짤짤이 매매
                if (isBuyer) {
                    // FOMO 상태면 위로 긁고, 평소면 밑에서 받침
                    const fomoOffset = (b > 0.5 && state.buyers > 70) ? Math.floor(Math.random() * 3) : -Math.floor(Math.random() * 3);
                    const executionPrice = stock.current_price + (fomoOffset * tickSize);
                    orders.push({
                        stock_id: stock.id,
                        user_id: null,
                        side: 'buy',
                        price: executionPrice,
                        size: tinyQty,
                        status: 'open',
                        is_lp: true
                    });
                }
                else {
                    // 패닉 상태면 아래로 패대기, 평소면 위에다 걸어둠
                    const panicOffset = (b > 0.5 && state.sellers > 70) ? -Math.floor(Math.random() * 3) : Math.floor(Math.random() * 3);
                    const executionPrice = stock.current_price + (panicOffset * tickSize);
                    orders.push({
                        stock_id: stock.id,
                        user_id: null,
                        side: 'sell',
                        price: executionPrice,
                        size: tinyQty,
                        status: 'open',
                        is_lp: true
                    });
                }
            }
        }
        return orders;
    }
}
exports.RetailSwarmAgent = RetailSwarmAgent;
//# sourceMappingURL=RetailSwarmAgent.js.map