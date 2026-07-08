"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HedgeFundAgent = void 0;
const BaseAgent_1 = require("./BaseAgent");
class HedgeFundAgent extends BaseAgent_1.BaseAgent {
    bot;
    constructor(bot) {
        super(bot.id, bot.capital);
        this.bot = bot;
    }
    updateSentiment(newSentiment) {
        this.bot.currentSentiment = newSentiment;
        this.rebalancePortfolio();
    }
    rebalancePortfolio() {
        if (this.bot.currentSentiment === 'RISK_OFF') {
            this.bot.portfolioTarget = { equity: 0.1, safeBonds: 0.9, highYield: 0.0 };
        }
        else if (this.bot.currentSentiment === 'RISK_ON') {
            this.bot.portfolioTarget = { equity: 0.7, safeBonds: 0.0, highYield: 0.3 };
        }
        else {
            this.bot.portfolioTarget = { equity: 0.5, safeBonds: 0.3, highYield: 0.2 };
        }
    }
    priceHistory = {};
    executeAggressiveSweep(currentMarket, myHoldings) {
        const orders = [];
        const availableStocks = currentMarket.stocks || [];
        // Merton Jump-Diffusion 모델 적용
        for (const stock of availableStocks) {
            if (!this.priceHistory[stock.id]) {
                this.priceHistory[stock.id] = [];
            }
            const history = this.priceHistory[stock.id];
            history.push(stock.current_price);
            if (history.length > 20)
                history.shift(); // 최근 20틱 유지
            if (history.length < 20)
                continue;
            // 과거 20틱 평균 및 변동성 계산
            const avgPrice = history.reduce((a, b) => a + b, 0) / history.length;
            const variance = history.reduce((a, b) => a + Math.pow(b - avgPrice, 2), 0) / history.length;
            const stdDev = Math.sqrt(variance);
            // 점프 감지: 현재가가 평균 대비 3표준편차 이상 벗어났는가?
            const zScore = stdDev === 0 ? 0 : (stock.current_price - avgPrice) / stdDev;
            const jumpThreshold = 3.0; // 3 sigma
            let dN_t = 0; // Poisson jump indicator
            if (Math.abs(zScore) > jumpThreshold) {
                dN_t = zScore > 0 ? 1 : -1; // 1: 급등 점프, -1: 급락 점프
            }
            if (dN_t !== 0) {
                console.log(`[Jump-Diffusion] ${this.bot.name} detected dN_t = ${dN_t} for ${stock.name} (Z: ${zScore.toFixed(2)}). Sweeping!`);
                const tickSize = this.getTickSize(stock.current_price);
                const sweepPowerMoney = this.bot.capital * 0.1; // 점프 발생 시 자본의 10%를 한방에 쏟아부음
                const baseQty = Math.floor(sweepPowerMoney / stock.current_price);
                if (baseQty > 0) {
                    if (dN_t === 1) {
                        // 위로 점프 -> 추격 매수 스윕 (Sweep Up)
                        const targetBuyPrice = stock.current_price + (tickSize * 5); // 5틱 위까지 싹쓸이
                        orders.push(...this.executeSmartOrder(stock, 'buy', targetBuyPrice, baseQty, 0.95, // 극도의 긴급성
                        currentMarket.activeEvents));
                    }
                    else {
                        // 아래로 점프 -> 패닉 공매도 스윕 (Sweep Down)
                        const targetSellPrice = stock.current_price - (tickSize * 5); // 5틱 아래까지 싹쓸이
                        orders.push(...this.executeSmartOrder(stock, 'sell', targetSellPrice, baseQty, 0.95, // 극도의 긴급성
                        currentMarket.activeEvents));
                    }
                }
            }
        }
        // 기존 포트폴리오 리밸런싱 로직 (Risk On / Off에 따른 매매)은 Jump가 없을 때 백그라운드에서 동작
        const currentSafeBondsRatio = (myHoldings.safeBonds || 0) / this.bot.capital;
        const sectorTargets = this.bot.sectorTargets || { 'TECH': 0.33, 'FINANCE': 0.33, 'BIO': 0.34 };
        if (this.bot.currentSentiment === 'RISK_OFF' && currentSafeBondsRatio < this.bot.portfolioTarget.safeBonds) {
            const defenseMoney = this.bot.capital * 0.05;
            for (const stock of availableStocks) {
                if (stock.sector === 'FINANCE' || stock.sector === 'CONSUMER') {
                    const tickSize = this.getTickSize(stock.current_price);
                    const baseQty = Math.floor((defenseMoney / 10) / stock.current_price);
                    if (baseQty > 0) {
                        const targetSellPrice = stock.current_price - (tickSize * 2);
                        orders.push(...this.executeSmartOrder(stock, 'sell', targetSellPrice, baseQty, 0.7, currentMarket.activeEvents));
                    }
                }
            }
        }
        else if (this.bot.currentSentiment === 'RISK_ON') {
            const currentEquityRatio = (myHoldings.equity || 0) / this.bot.capital;
            if (currentEquityRatio < this.bot.portfolioTarget.equity) {
                const equityToBuy = this.bot.capital * 0.1;
                for (const [sector, weight] of Object.entries(sectorTargets)) {
                    const sectorStocks = availableStocks.filter((s) => s.sector === sector);
                    if (sectorStocks.length > 0) {
                        const moneyPerStock = (equityToBuy * weight) / sectorStocks.length;
                        for (const stock of sectorStocks) {
                            const totalQty = Math.floor(moneyPerStock / stock.current_price);
                            if (totalQty > 0) {
                                const tickSize = this.getTickSize(stock.current_price);
                                const targetBuyPrice = stock.current_price + (tickSize * 2);
                                orders.push(...this.executeSmartOrder(stock, 'buy', targetBuyPrice, totalQty, 0.7, currentMarket.activeEvents));
                            }
                        }
                    }
                }
            }
        }
        return orders;
    }
}
exports.HedgeFundAgent = HedgeFundAgent;
//# sourceMappingURL=HedgeFundAgent.js.map