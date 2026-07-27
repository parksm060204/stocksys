"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HedgeFundAgent = void 0;
const BaseAgent_1 = require("./BaseAgent");
class HedgeFundAgent extends BaseAgent_1.BaseAgent {
    bot;
    // Balance Sheet (대차대조표) 상태 변수
    balanceSheet = {
        cash: 0,
        debt: 0,
        targetLeverage: 3.0, // 3배 레버리지 타겟
        holdings: {}
    };
    constructor(bot) {
        super(bot.id, bot.capital);
        this.bot = bot;
        // 초기 자본금 세팅: Capital = Equity. 
        // Target Leverage 3.0 이면, Assets = 3 * Equity, Debt = 2 * Equity.
        this.balanceSheet.cash = bot.capital * 3.0;
        this.balanceSheet.debt = bot.capital * 2.0;
        this.currentPortfolio.cash = bot.capital * 3.0; // sync BaseAgent cash to leveraged assets 
        // 포트폴리오의 모든 자산을 0으로 초기화하고 현금만 레버리지 자산으로 채움
        this.currentPortfolio.stock = 0;
        this.currentPortfolio.kr_equity = 0;
        this.currentPortfolio.us_equity = 0;
        this.currentPortfolio.eu_equity = 0;
        this.currentPortfolio.bond = 0;
        this.currentPortfolio.commodity = 0;
        this.currentPortfolio.derivatives = 0;
    }
    updateSentiment(newSentiment) {
        this.bot.currentSentiment = newSentiment;
        this.rebalancePortfolio();
        // VIX 폭등(공포) 시 목표 레버리지를 축소 (디레버리징)
        if (newSentiment === 'RISK_OFF') {
            this.balanceSheet.targetLeverage = 1.5; // 강제 디레버리징
        }
        else if (newSentiment === 'RISK_ON') {
            this.balanceSheet.targetLeverage = 4.0;
        }
        else {
            this.balanceSheet.targetLeverage = 3.0;
        }
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
    executeAggressiveSweep(currentMarket) {
        const orders = [];
        const availableStocks = currentMarket.stocks || [];
        // 1. 대차대조표 MTM (Mark-to-Market) 및 레버리지 산출
        let totalAssets = this.balanceSheet.cash;
        for (const stock of availableStocks) {
            if (this.balanceSheet.holdings[stock.id]) {
                totalAssets += (this.balanceSheet.holdings[stock.id] || 0) * stock.current_price;
            }
        }
        const equity = totalAssets - this.balanceSheet.debt;
        if (equity <= 0) {
            console.log(`[Margin Call] ☠️ ${this.bot.name} is BANKRUPT!`);
            // 마진콜 청산 완료 상태 처리 (시뮬레이션 단순화)
            return orders;
        }
        const currentLeverage = totalAssets / equity;
        // 2. Margin Spiral (Fire Sale) 논리
        // 현재 레버리지가 타겟 레버리지보다 매우 크면 강제 청산(Fire Sale) 수행
        if (currentLeverage > this.balanceSheet.targetLeverage * 1.1) {
            console.log(`🔥 [Margin Spiral] ${this.bot.name} Deleveraging! L=${currentLeverage.toFixed(2)} > Target=${this.balanceSheet.targetLeverage.toFixed(2)}`);
            // 줄여야 할 자산 규모 (Deleveraging Amount)
            const targetAssets = equity * this.balanceSheet.targetLeverage;
            let assetsToSell = totalAssets - targetAssets;
            for (const stock of availableStocks) {
                if (assetsToSell <= 0)
                    break;
                const qtyOwned = this.balanceSheet.holdings[stock.id] || 0;
                if (qtyOwned > 0) {
                    // Long Position Liquidation (Fire Sale)
                    const qtyToSell = Math.min(qtyOwned, Math.ceil((assetsToSell) / stock.current_price));
                    if (qtyToSell > 0) {
                        const tickSize = this.getTickSize(stock.current_price);
                        // Fire Sale: 호가창 하단으로 무자비하게 던짐 (시장 충격 극대화)
                        orders.push({
                            stock_id: stock.id,
                            user_id: null,
                            side: 'sell',
                            price: stock.current_price - (tickSize * 10),
                            size: qtyToSell,
                            status: 'open',
                            is_lp: true,
                            _botId: this.botId
                        });
                        assetsToSell -= qtyToSell * stock.current_price;
                    }
                }
                else if (qtyOwned < 0) {
                    // Short Position Liquidation (Short Squeeze)
                    const qtyShort = Math.abs(qtyOwned);
                    const qtyToCover = Math.min(qtyShort, Math.ceil((assetsToSell) / stock.current_price));
                    if (qtyToCover > 0) {
                        const tickSize = this.getTickSize(stock.current_price);
                        console.log(`[Margin Call - Short Squeeze] ${this.bot.name} is forced to cover ${qtyToCover} shares of ${stock.name}!`);
                        // Short Squeeze: 호가창 상단으로 무자비하게 삼 (시장가 매수)
                        orders.push({
                            stock_id: stock.id,
                            user_id: null,
                            side: 'buy',
                            price: stock.current_price + (tickSize * 10),
                            size: qtyToCover,
                            status: 'open',
                            is_lp: true, // MarketEngine이 매칭
                            _botId: this.botId
                        });
                        assetsToSell -= qtyToCover * stock.current_price;
                    }
                }
            }
        }
        // 3. 기존 Merton Jump-Diffusion 모델 적용
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
        // 4. 액티브 공매도 (Active Short Selling)
        // 주가가 펀더멘털 대비 비상식적으로 높을 때(예: PBR > 1.3배) 공매도(Short Sell) 포지션을 구축합니다.
        const fundamentals = currentMarket.fundamentals || {};
        // 자금 여력이 있을 때만 신규 포지션 진입 (레버리지 비율 체크)
        if (currentLeverage < this.balanceSheet.targetLeverage * 0.8) {
            const moneyToDeploy = this.balanceSheet.cash * 0.05; // 한 번에 현금의 5% 투입
            for (const stock of availableStocks) {
                const fundamentalValue = fundamentals[stock.id];
                if (!fundamentalValue)
                    continue;
                // 주가가 펀더멘털보다 30% 이상 고평가된 경우 공매도 타겟
                if (stock.current_price > fundamentalValue * 1.3) {
                    const qtyToShort = Math.floor(moneyToDeploy / stock.current_price);
                    if (qtyToShort > 0 && Math.random() < 0.2) { // 20% 확률로 트리거 (전 종목에 무차별 공매도 방지)
                        console.log(`[Active Short] ${this.bot.name} is shorting ${stock.name}! (Price: ${stock.current_price}, Funda: ${Math.round(fundamentalValue)})`);
                        const tickSize = this.getTickSize(stock.current_price);
                        const targetPrice = stock.current_price - tickSize * 2; // 약간 아래로 호가 제출
                        orders.push({
                            stock_id: stock.id,
                            user_id: null,
                            side: 'sell',
                            price: targetPrice,
                            size: qtyToShort,
                            status: 'open',
                            is_lp: true,
                            _botId: this.botId
                        });
                        break; // 한 틱당 한 종목만 공매도 타겟팅
                    }
                }
            }
        }
        return orders;
    }
    confirmExecution(assetClass, side, filledQty, filledPrice, stockId) {
        super.confirmExecution(assetClass, side, filledQty, filledPrice, stockId);
        if (assetClass === 'stock' && stockId) {
            const notional = filledQty * filledPrice;
            if (side === 'buy') {
                this.balanceSheet.cash = Math.max(0, this.balanceSheet.cash - notional);
                this.balanceSheet.holdings[stockId] = (this.balanceSheet.holdings[stockId] || 0) + filledQty;
            }
            else {
                this.balanceSheet.cash += notional;
                this.balanceSheet.holdings[stockId] = (this.balanceSheet.holdings[stockId] || 0) - filledQty;
                const debtRepay = Math.min(this.balanceSheet.debt, notional);
                this.balanceSheet.debt -= debtRepay;
                this.balanceSheet.cash -= debtRepay;
                this.currentPortfolio.cash = Math.max(0, this.currentPortfolio.cash - debtRepay);
            }
        }
    }
}
exports.HedgeFundAgent = HedgeFundAgent;
//# sourceMappingURL=HedgeFundAgent.js.map