import type { RetailSwarmBot } from "../types";

export class RetailSwarmAgent {
  private bot: RetailSwarmBot;

  private holdings: Record<string, number> = {};

  constructor(bot: RetailSwarmBot) {
    this.bot = bot;
    if ((bot as any).initialHoldings) {
      this.holdings = { ...(bot as any).initialHoldings };
    }
  }

  public get botId(): string {
    return this.bot.id;
  }

  private getTickSize(price: number): number {
    if (price < 2000) return 1;
    if (price < 5000) return 5;
    if (price < 20000) return 10;
    if (price < 50000) return 50;
    if (price < 200000) return 100;
    if (price < 500000) return 500;
    return 1000;
  }

  // 3-State Kirman Model: Fundamentalists, Chartists, Noise Traders
  private swarmState: Record<string, {
    fundamentalists: number,
    chartists: number,
    noise: number,
    total: number
  }> = {};

  public executeSwarmBehavior(currentMarket: any, myHoldings: any) {
    const orders: any[] = [];
    const availableStocks = currentMarket.stocks || [];
    const activeEvents = currentMarket.activeEvents || [];

    for (const stock of availableStocks) {
      if (!stock.previous_close || stock.previous_close === 0) continue;
      
      let fomoOverride = false;
      let panicOverride = false;

      // 뉴스 이벤트 확인하여 개미들의 광기/공포 스위치 켜기
      for (const event of activeEvents) {
        if (event.targetSector === 'ALL' || event.targetSector === stock.sector) {
          if (event.impact === 'STRONG_POSITIVE' || event.impact === 'POSITIVE') {
            fomoOverride = true;
          } else if (event.impact === 'STRONG_NEGATIVE' || event.impact === 'NEGATIVE') {
            panicOverride = true;
          }
        }
      }
      
      const dayReturn = (stock.current_price - stock.previous_close) / stock.previous_close;
      const tickSize = this.getTickSize(stock.current_price);

      // Kirman's 3-State Ant Model Initialization
      if (!this.swarmState[stock.id]) {
        this.swarmState[stock.id] = { fundamentalists: 20, chartists: 50, noise: 30, total: 100 };
      }
      const state = this.swarmState[stock.id]!;

      // 1. Core 에이전트의 동향 파악 (Periphery가 Core를 관측)
      // 시뮬레이션에서는 최근 틱의 거시적 상승/하락 흐름(trend)을 Core의 포지션으로 간주합니다.
      const coreTrend = dayReturn; // 단순화: Core가 만들고 있는 추세

      // 2. 상태 전이 확률 연산 (Transition Rates)
      const a = 0.05; // 자체 갱신 성향
      let lambda = 0.2; // 군집 상호작용 강도

      if (Math.abs(coreTrend) > 0.05 || fomoOverride || panicOverride) {
        lambda = 0.8; // 코어의 움직임이나 외부 충격이 강하면 차티스트화(군집화) 급증
      }

      // 상태 간의 이동 (간이 3상태 마르코프 체인)
      let newF = state.fundamentalists;
      let newC = state.chartists;
      let newN = state.noise;

      // Noise -> Chartist (코어 트렌드를 쫓아감)
      const p_N_to_C = a + lambda * (state.chartists / state.total);
      for (let i = 0; i < state.noise; i++) {
        if (Math.random() < p_N_to_C) { newN--; newC++; }
      }

      // Chartist -> Fundamentalist (괴리율이 클 때 가치 투자로 전환)
      const fundamentalValue = currentMarket.fundamentals ? currentMarket.fundamentals[stock.id] : stock.previous_close;
      const deviation = Math.abs((stock.current_price - fundamentalValue) / fundamentalValue);
      const p_C_to_F = a + (deviation * 5); // 괴리율이 클수록 가치투자자로 전향할 확률 급등
      for (let i = 0; i < state.chartists; i++) {
        if (Math.random() < p_C_to_F) { newC--; newF++; }
      }

      // Fundamentalist -> Chartist (코어의 압도적인 모멘텀에 굴복)
      const p_F_to_C = a + lambda * (Math.abs(coreTrend) * 10);
      for (let i = 0; i < state.fundamentalists; i++) {
        if (Math.random() < p_F_to_C) { newF--; newC++; }
      }

      // 강제 쏠림 보정 (외부 충격 또는 미세 틱 모멘텀 발생 시)
      if (fomoOverride || dayReturn > 0.005 || panicOverride || dayReturn < -0.005) {
        const converted = Math.floor(newN * 0.6);
        newN -= converted;
        newC += converted;
      }

      state.fundamentalists = Math.max(0, newF);
      state.chartists = Math.max(0, newC);
      state.noise = Math.max(0, newN);
      
      // 정규화 (전체 합 100 유지)
      const sum = state.fundamentalists + state.chartists + state.noise;
      if (sum > 0) {
        state.fundamentalists = Math.floor((state.fundamentalists / sum) * 100);
        state.chartists = Math.floor((state.chartists / sum) * 100);
        state.noise = 100 - state.fundamentalists - state.chartists; // 나머지
      }

      // 3. 실제 주문 생성 로직
      let activeAnts = Math.floor(Math.random() * 10) + 5; 
      let isSqueeze = false;
      
      if (lambda > 0.5 || Math.abs(dayReturn) > 0.01) { // 쏠림 발생 시
        activeAnts = Math.floor(Math.random() * 20) + 10;
      }

      // 숏 스퀴즈 / 감마 스퀴즈 징후 포착 시 (가격 15% 이상 급등)
      if (dayReturn > 0.15) {
        isSqueeze = true;
        activeAnts = Math.floor(Math.random() * 50) + 50; // 개미 떼 출몰 (50~100명)
        console.log(`🚀 [Retail FOMO] GME-style squeeze detected on ${stock.name}! Swarm size: ${activeAnts}`);
      }

      // 너무 많은 주문 방지용 하드 상한선
      activeAnts = Math.min(activeAnts, 30);

      for (let i = 0; i < activeAnts; i++) {
        const rand = Math.random() * 100;
        let antType = 'NOISE';
        if (rand < state.fundamentalists) antType = 'FUNDAMENTALIST';
        else if (rand < state.fundamentalists + state.chartists) antType = 'CHARTIST';

        let tinyQty = Math.floor(Math.random() * 5) + 1;
        let side = Math.random() < 0.5 ? 'buy' : 'sell';
        let executionPrice = stock.current_price;

        if (isSqueeze) {
          // 스퀴즈 상황: 무지성 시장가 추격 매수 (Squeeze FOMO Sweep)
          antType = 'CHARTIST';
          side = 'buy';
          tinyQty = Math.floor(Math.random() * 50) + 10; // 매수 규모 10배 폭발
          executionPrice = stock.current_price + tickSize * Math.floor(Math.random() * 10); // 저 멀리 위까지 싹쓸이
        } else if (antType === 'FUNDAMENTALIST') {
          // 가치 투자자: 본질 가치보다 싸면 사고, 비싸면 판다.
          side = stock.current_price < fundamentalValue ? 'buy' : 'sell';
          executionPrice = side === 'buy' ? stock.current_price - tickSize : stock.current_price + tickSize;
        } else if (antType === 'CHARTIST') {
          // 추세 추종자: 오르면 더 사고, 내리면 패닉 셀
          if (coreTrend > 0 || fomoOverride) {
            side = 'buy';
            executionPrice = stock.current_price + tickSize * Math.floor(Math.random() * 3);
          } else if (coreTrend < 0 || panicOverride) {
            side = 'sell';
            executionPrice = stock.current_price - tickSize * Math.floor(Math.random() * 3);
          }
        } else {
          // 노이즈 트레이더: 무작위 방향, 스프레드 무작위
          executionPrice = stock.current_price + (side === 'buy' ? -tickSize : tickSize) * Math.floor(Math.random() * 5);
        }

        orders.push({
          stock_id: stock.id,
          user_id: null,
          side: side,
          price: executionPrice,
          size: tinyQty,
          status: 'open',
          is_lp: true,
          _botId: this.botId
        });
      }
    }
    
    return orders;
  }
}
