import { BaseAgent } from "./BaseAgent";

export class WallBreakerAgent extends BaseAgent {
  private huntCooldowns: Record<string, number> = {};

  constructor() {
    super({ id: 'WALL_BREAKER', baseWeights: { stock: 0, bond: 0, commodity: 0, cash: 1 } } as any, 100000000000); // 1000억 실탄 대기
  }

  // 이벤트 주도형 호출
  public executeGammaSqueezeHunt(tickInfo: { hour: number }, currentPrices: Record<string, number>, optionsData: any[]): any[] {
    const orders: any[] = [];

    // Cooldown decay
    for (const sId of Object.keys(this.huntCooldowns)) {
      const val = this.huntCooldowns[sId];
      if (val !== undefined && val > 0) {
        this.huntCooldowns[sId] = val - 1;
      }
    }
    
    // 만기일 당일 오후 2시 이후에만 활성화된다는 시나리오 가정
    // 게임 시간 동기화가 아직 없다면 주석처리하거나 임의 시간으로 대체 가능
    // 여기서는 단순히 오후 2시 이후거나, 상시 발동하도록 조정 가능.
    // 시뮬레이션을 위해 주석 처리하고 항상 사냥하도록 변경 (또는 14를 무시)
    // if (tickInfo.hour < 14) return orders;

    // optionsData를 종목별, 행사별로 그룹화
    const optionChainBySymbol: Record<string, any> = {};
    for (const opt of optionsData) {
      const stockId = opt.underlying_stock_id;
      if (!stockId) continue;
      if (!optionChainBySymbol[stockId]) {
        optionChainBySymbol[stockId] = { calls: {} };
      }
      if (opt.type === 'CALL') {
        optionChainBySymbol[stockId].calls[opt.strike_price] = opt.open_interest;
      }
    }

    for (const stockId in currentPrices) {
      const currentPrice = currentPrices[stockId];
      const optionChain = optionChainBySymbol[stockId];
      
      if (!optionChain || !optionChain.calls) continue;

      // 미결제약정(OI)이 가장 높은 Call Strike (콜 월) 찾기
      let callWallStrike = 0;
      let maxOI = 0;
      
      for (const strikeStr in optionChain.calls) {
        const oi = optionChain.calls[strikeStr];
        if (oi > maxOI) {
          maxOI = oi;
          callWallStrike = Number(strikeStr);
        }
      }

      if (maxOI === 0 || callWallStrike === 0) continue;

      if (currentPrice === undefined) continue;
      // 콜 월이 존재하고, 현재가가 그 밑에 있으며, 격차가 1% 이내로 좁혀졌을 때
      const distance = (callWallStrike - currentPrice) / currentPrice;
      const cooldown = this.huntCooldowns[stockId] || 0;
      
      if (distance > 0 && distance < 0.01 && maxOI >= 100000 && cooldown === 0) {
        this.huntCooldowns[stockId] = 60; // 60틱 쿨다운 적용
        console.log(`[Wall Breaker] 🔥 ${stockId} 감마 스퀴즈 트리거 발동! 목표가: ${callWallStrike}, OI: ${maxOI}`);
        
        // 시장가로 콜 월(Strike Price) 위까지 남은 매도 호가를 전부 쓸어버리는 충격파 발생
        const tickSize = this.getTickSize(currentPrice || callWallStrike);
        orders.push({
          stock_id: stockId,
          user_id: null, // LP 봇은 항상 null (UUID 컬럼에 문자열 삽입 금지)
          side: 'buy',
          price: callWallStrike + tickSize * 5, // 호가창을 부수기 위해 엄청 높게 주문
          size: 50000, // 5만 주 초대형 스윕
          status: 'open',
          is_lp: true,
          _botId: this.botId
        });
      }
    }
    
    return orders;
  }
}
