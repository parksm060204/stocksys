"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CommercialBankAgent = void 0;
class CommercialBankAgent {
    bot;
    constructor(bot) {
        this.bot = bot;
    }
    calculatePriceFromYTM(faceValue, ytm, maturityYears) {
        return faceValue / Math.pow(1 + ytm, maturityYears);
    }
    executeArbitrage(currentMarket, adminBaseRate) {
        const orders = [];
        const now = Date.now();
        if (this.bot.lastSweepTime && this.bot.cooldownMs) {
            if (now - this.bot.lastSweepTime < this.bot.cooldownMs) {
                return orders;
            }
        }
        let sweepOccurred = false;
        for (const bond of currentMarket.bonds) {
            const spread = this.bot.targetSpread[bond.type];
            if (!spread)
                continue;
            const targetYTM = adminBaseRate + spread;
            const fairPrice = this.calculatePriceFromYTM(bond.faceValue, targetYTM, bond.maturityYears);
            const priceDifference = bond.currentPrice - fairPrice;
            const differenceRatio = Math.abs(priceDifference / fairPrice);
            if (differenceRatio > 0.005) {
                const executionVolume = Math.floor((this.bot.capital * differenceRatio) / bond.currentPrice);
                orders.push({
                    botId: this.bot.id,
                    assetId: bond.id,
                    orderType: 'MARKET',
                    side: priceDifference > 0 ? 'SELL' : 'BUY',
                    volume: executionVolume,
                    timestamp: now
                });
                sweepOccurred = true;
            }
        }
        if (sweepOccurred) {
            this.bot.lastSweepTime = now;
            if (!this.bot.cooldownMs)
                this.bot.cooldownMs = 3000 + Math.random() * 2000;
        }
        return orders;
    }
}
exports.CommercialBankAgent = CommercialBankAgent;
//# sourceMappingURL=CommercialBankAgent.js.map