"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PensionFundAgent = void 0;
const BaseAgent_1 = require("./BaseAgent");
class PensionFundAgent extends BaseAgent_1.BaseAgent {
    config;
    executionState = {};
    constructor(bot) {
        super(bot.id, bot.capital);
        this.config = bot;
    }
    calculatePriceFromYTM(faceValue, ytm, maturityYears) {
        return faceValue / Math.pow(1 + ytm, maturityYears);
    }
    evaluateMarketAndPlaceOrders(currentMarket, isCreditCrunch = false) {
        const orders = [];
        const targetYTMConfig = this.config.targetYTM || { "1Y_BOND": 0.025, "3Y_BOND": 0.030, "5Y_BOND": 0.032, "10Y_BOND": 0.035 };
        // 채권 매매 로직은 기존 유지
        for (const bond of (currentMarket.bonds || [])) {
            const id = (bond.bond_id || '').toUpperCase();
            const bondType = id.includes('10Y') ? '10Y_BOND' : (id.includes('5Y') || id.includes('7Y') ? '5Y_BOND' : (id.includes('3Y') ? '3Y_BOND' : '1Y_BOND'));
            const targetYTM = targetYTMConfig[bondType];
            if (!targetYTM)
                continue;
            const adjustedTargetYTM = isCreditCrunch ? targetYTM + 0.02 : targetYTM;
            const faceValue = bond.face_value !== undefined ? bond.face_value : (bond.faceValue !== undefined ? bond.faceValue : 10000);
            const maturityYears = bond.maturity_years !== undefined ? bond.maturity_years : (bond.maturityYears !== undefined ? bond.maturityYears : 10);
            const currentPrice = bond.current_price !== undefined ? bond.current_price : (bond.currentPrice !== undefined ? bond.currentPrice : 10000);
            const targetBuyPrice = this.calculatePriceFromYTM(faceValue, adjustedTargetYTM, maturityYears);
            const adjustedBuyPrice = Math.floor(targetBuyPrice / 10) * 10;
            if (currentPrice <= adjustedBuyPrice + 50) {
                const orderVolume = Math.floor((this.config.capital * (Math.random() * 0.01 + 0.01)) / currentPrice);
                orders.push({
                    stock_id: bond.id,
                    user_id: null,
                    side: 'buy',
                    price: adjustedBuyPrice,
                    size: orderVolume,
                    status: 'open',
                    is_lp: true,
                    _botId: this.botId,
                    _assetClass: 'bond'
                });
            }
        }
        // 주식 시장 방어선 구축 로직 (Almgren-Chriss 모델)
        const sectorTargets = this.config.sectorTargets || {};
        const availableStocks = currentMarket.stocks || [];
        const targetAlloc = this.config.targetAllocation || { kr_equity: 0.15, us_equity: 0.35, eu_equity: 0.05 };
        const totalStockWeight = (targetAlloc.stock || 0) + (targetAlloc.kr_equity || 0) + (targetAlloc.us_equity || 0) + (targetAlloc.eu_equity || 0) || 0.55;
        const equityCapital = this.config.capital * totalStockWeight;
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
                                    kappa: Math.max(0.01, kappa), // 0 방지
                                    totalQty: totalIntendedQty
                                };
                                this.executionState[stock.id] = state;
                                console.log(`[Almgren-Chriss] ${this.config.name} initiated execution for ${stock.name}. Kappa: ${state.kappa.toFixed(4)}, Qty: ${totalIntendedQty}`);
                            }
                        }
                    }
                    if (state && state.remainingQty > 0) {
                        state.currentTick += 1;
                        const t = state.currentTick;
                        const T = state.targetTicks;
                        // 궤적 생성: AC 최적 실행 궤도 (v_t^*)
                        // v_t^* = X * kappa * cosh[kappa * (T - t)] / sinh(kappa * T)
                        const k = state.kappa;
                        const X = state.totalQty;
                        const timeRemaining = T - t;
                        const sinh_kT = Math.sinh(k * T);
                        const cosh_kt = Math.cosh(k * timeRemaining);
                        let optimal_v_t = (X * k * cosh_kt) / sinh_kT;
                        // 너무 크거나 작을 경우 보정
                        let executionQty = Math.ceil(optimal_v_t);
                        executionQty = Math.min(state.remainingQty, executionQty);
                        state.remainingQty -= executionQty;
                        const tickSize = this.getTickSize(stock.current_price);
                        const targetBuyPrice = stock.current_price - tickSize; // 1틱 아래 (Iceberg/Passive)
                        if (executionQty > 0) {
                            const peakSize = Math.max(1, Math.floor(executionQty * 0.1)); // 빙산의 일각 (10%만 노출)
                            const hiddenSize = executionQty - peakSize;
                            orders.push({
                                stock_id: stock.id,
                                user_id: null,
                                side: 'buy',
                                price: targetBuyPrice,
                                size: peakSize,
                                hidden_size: hiddenSize,
                                peak_size: peakSize,
                                status: 'open',
                                is_lp: true,
                                _botId: this.botId // 추적용
                            });
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