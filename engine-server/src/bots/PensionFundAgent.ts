import type { PensionFundBot } from "../types";
import { BaseAgent } from "./BaseAgent";

export class PensionFundAgent extends BaseAgent {
  public readonly config: PensionFundBot;
  private executionState: Record<string, { remainingQty: number, targetTicks: number, currentTick: number, kappa: number, totalQty: number }> = {};

  constructor(bot: PensionFundBot) {
    super(bot.id, bot.capital);
    this.config = bot;
    if ((bot as any).initialHoldings) {
      this.currentPortfolio.holdings = { ...(bot as any).initialHoldings };
    }
  }

  private calculatePriceFromYTM(faceValue: number, ytm: number, maturityYears: number): number {
    return faceValue / Math.pow(1 + ytm, maturityYears);
  }

  public evaluateMarketAndPlaceOrders(currentMarket: any, isCreditCrunch: boolean = false) {
    const orders: any[] = [];

    const targetYTMConfig = this.config.targetYTM || { "1Y_BOND": 0.025, "3Y_BOND": 0.030, "5Y_BOND": 0.032, "10Y_BOND": 0.035 };

    // 채권 매매 로직은 기존 유지
    for (const bond of (currentMarket.bonds || [])) {
      const id = (bond.bond_id || '').toUpperCase();
      const bondType = id.includes('10Y') ? '10Y_BOND' : (id.includes('5Y') || id.includes('7Y') ? '5Y_BOND' : (id.includes('3Y') ? '3Y_BOND' : '1Y_BOND'));
      const targetYTM = targetYTMConfig[bondType];
      if (!targetYTM) continue;

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
    const targetAlloc = (this.config as any).targetAllocation || { kr_equity: 0.15, us_equity: 0.35, eu_equity: 0.05 };
    const totalStockWeight = (targetAlloc.stock || 0) + (targetAlloc.kr_equity || 0) + (targetAlloc.us_equity || 0) + (targetAlloc.eu_equity || 0) || 0.55;
    const equityCapital = this.config.capital * totalStockWeight;

    for (const stock of availableStocks) {
      const holdingsQty = this.currentPortfolio.holdings?.[stock.id] || 0;
      const stockVal = holdingsQty * stock.current_price;
      const currentWeight = this.config.capital > 0 ? stockVal / this.config.capital : 0;
      const targetWeightPerStock = totalStockWeight / Math.max(1, availableStocks.length);
      const tolerance = 0.005; // 0.5% 오차
      const tickSize = this.getTickSize(stock.current_price);

      // 내생적 트리거 1: 목표 비중 초과 시 기계적 익절/리밸런싱 매도 (TWAP Sliced)
      if (currentWeight > targetWeightPerStock + tolerance && holdingsQty > 10) {
        const excessVal = (currentWeight - targetWeightPerStock) * this.config.capital;
        const totalSellQty = Math.min(holdingsQty, Math.floor(excessVal / stock.current_price));
        const sellQtySlice = Math.max(1, Math.floor(totalSellQty * 0.01)); // 틱당 최대 1% 분할 매도
        if (sellQtySlice > 0) {
          const rawOrder = {
            stock_id: stock.id,
            user_id: null,
            side: 'sell',
            price: stock.current_price + tickSize,
            size: sellQtySlice,
            status: 'open',
            is_lp: true,
            _botId: this.botId
          };
          orders.push(this.applyInstitutionalRiskControls(rawOrder, stock.current_price));
        }
      }
      // 내생적 트리거 2: 목표 비중 미달 시 지정가 받침 매수 (TWAP Sliced)
      else if (currentWeight < targetWeightPerStock - tolerance) {
        const deficitVal = (targetWeightPerStock - currentWeight) * this.config.capital;
        const totalBuyQty = Math.floor(deficitVal / stock.current_price);
        const buyQtySlice = Math.max(1, Math.floor(totalBuyQty * 0.01)); // 틱당 최대 1% 분할 매수
        if (buyQtySlice > 0) {
          const rawOrder = {
            stock_id: stock.id,
            user_id: null,
            side: 'buy',
            price: stock.current_price - tickSize,
            size: buyQtySlice,
            status: 'open',
            is_lp: true,
            _botId: this.botId
          };
          orders.push(this.applyInstitutionalRiskControls(rawOrder, stock.current_price));
        }
      }
    }

    for (const [sector, weight] of Object.entries(sectorTargets)) {
      const sectorStocks = availableStocks.filter((s: any) => s.sector === sector);
      if (sectorStocks.length > 0) {
        const moneyForSector = equityCapital * weight;
        const moneyPerStock = moneyForSector / sectorStocks.length;
        
        for (const stock of sectorStocks) {
          if (!this.executionState) this.executionState = {};
          
          let state = this.executionState[stock.id];
          
          // 폭락 시 저가 매수를 위한 방어적 트리거 (전일 대비 -3% 이하)
          const dayReturn = (stock.current_price - stock.previous_close) / stock.previous_close;
          const isCrash = dayReturn < -0.03;

          if (!state || state.remainingQty <= 0) {
            if (isCrash) {
              const totalIntendedQty = Math.floor(moneyPerStock / stock.current_price);
              if (totalIntendedQty > 0) {
                const lambda = 1e-4;
                const sigma2 = Math.pow(Math.abs(dayReturn) * 100, 2) || 1;
                const eta = 0.01;
                const kappa = Math.sqrt((lambda * sigma2) / eta);
                
                state = {
                  remainingQty: totalIntendedQty,
                  targetTicks: 60,
                  currentTick: 0,
                  kappa: Math.max(0.01, kappa),
                  totalQty: totalIntendedQty
                };
                this.executionState[stock.id] = state;
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
