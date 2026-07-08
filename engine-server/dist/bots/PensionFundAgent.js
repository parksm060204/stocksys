"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PensionFundAgent = void 0;
const BaseAgent_1 = require("./BaseAgent");
class PensionFundAgent extends BaseAgent_1.BaseAgent {
    bot;
    executionState = {};
    constructor(bot) {
        super(bot.id, bot.capital);
        this.bot = bot;
    }
    calculatePriceFromYTM(faceValue, ytm, maturityYears) {
        return faceValue / Math.pow(1 + ytm, maturityYears);
    }
    evaluateMarketAndPlaceOrders(currentMarket, isCreditCrunch = false) {
        const orders = [];
        // 채권 매매 로직은 기존 유지
        for (const bond of (currentMarket.bonds || [])) {
            const targetYTM = this.bot.targetYTM[bond.type];
            if (!targetYTM)
                continue;
            const adjustedTargetYTM = isCreditCrunch ? targetYTM + 0.02 : targetYTM;
            const targetBuyPrice = this.calculatePriceFromYTM(bond.faceValue || 10000, adjustedTargetYTM, bond.maturityYears || 10);
            const adjustedBuyPrice = Math.floor(targetBuyPrice / 10) * 10;
            if (bond.current_price <= adjustedBuyPrice + 50) {
                const orderVolume = Math.floor((this.bot.capital * (Math.random() * 0.01 + 0.01)) / bond.current_price);
                orders.push({
                    stock_id: bond.id,
                    user_id: null,
                    side: 'buy',
                    price: adjustedBuyPrice,
                    size: orderVolume,
                    status: 'open',
                    is_lp: true
                });
            }
        }
        // 주식 시장 방어선 구축 로직 (Almgren-Chriss 모델)
        const sectorTargets = this.bot.sectorTargets || {};
        const availableStocks = currentMarket.stocks || [];
        const equityCapital = this.bot.capital * 0.05;
        for (const [sector, weight] of Object.entries(sectorTargets)) {
            const sectorStocks = availableStocks.filter((s) => s.sector === sector);
            if (sectorStocks.length > 0) {
                const moneyForSector = equityCapital * weight;
                const moneyPerStock = moneyForSector / sectorStocks.length;
                for (const stock of sectorStocks) {
                    if (!this.executionState)
                        this.executionState = {};
                    let state = this.executionState[stock.id];
                    // 폭락 시 저가 매수를 위한 방어적 트리거 (전일 대비 -3% 이하)
                    const dayReturn = (stock.current_price - stock.previous_close) / stock.previous_close;
                    const isCrash = dayReturn < -0.03;
                    if (!state || state.remainingQty <= 0) {
                        if (isCrash) {
                            const totalIntendedQty = Math.floor(moneyPerStock / stock.current_price);
                            if (totalIntendedQty > 0) {
                                // Almgren-Chriss Parameters
                                const lambda = 1e-4; // Risk aversion
                                const sigma2 = Math.pow(Math.abs(dayReturn) * 100, 2) || 1; // Variance approximation
                                const eta = 0.01; // Liquidity impact parameter
                                const kappa = Math.sqrt((lambda * sigma2) / eta); // 곡률 산출
                                state = {
                                    remainingQty: totalIntendedQty,
                                    targetTicks: 60, // 60틱 동안 분할 매수
                                    currentTick: 0,
                                    kappa: kappa
                                };
                                this.executionState[stock.id] = state;
                                console.log(`[Almgren-Chriss] ${this.bot.name} initiated execution for ${stock.name}. Kappa: ${kappa.toFixed(4)}, Qty: ${totalIntendedQty}`);
                            }
                        }
                    }
                    if (state && state.remainingQty > 0) {
                        state.currentTick += 1;
                        const t = state.currentTick;
                        const T = state.targetTicks;
                        // 궤적 생성: 잔여 물량 * (sinh(k * (T-t)) / sinh(k * T)) 변형 (간략화된 선형+곡률 모델)
                        // 간단한 구현: 곡률 k가 높을수록 초반에 많이 매수, 낮을수록 TWAP(균등 분할)
                        const baseQty = Math.ceil(state.remainingQty / (T - t + 1));
                        const executionQty = Math.min(state.remainingQty, Math.floor(baseQty * (1 + state.kappa * 0.1)));
                        state.remainingQty -= executionQty;
                        const tickSize = this.getTickSize(stock.current_price);
                        const targetBuyPrice = stock.current_price - tickSize; // 1틱 아래 (Iceberg/Passive)
                        if (executionQty > 0) {
                            orders.push(...this.executeSmartOrder(stock, 'buy', targetBuyPrice, executionQty, 0.2, // 낮은 긴급성 (스푸핑/빙산 유도)
                            currentMarket.activeEvents));
                        }
                    }
                }
            }
        }
        return orders;
    }
}
exports.PensionFundAgent = PensionFundAgent;
//# sourceMappingURL=PensionFundAgent.js.map