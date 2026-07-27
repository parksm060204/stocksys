import { BaseAgent } from "./BaseAgent";

// O(1) 원형 큐(Circular Queue)
class CircularQueue<T> {
  private buffer: T[];
  private head: number = 0;
  private tail: number = 0;
  private size: number = 0;
  private capacity: number;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new Array<T>(capacity);
  }

  push(item: T) {
    this.buffer[this.tail] = item;
    this.tail = (this.tail + 1) % this.capacity;
    if (this.size < this.capacity) {
      this.size++;
    } else {
      this.head = (this.head + 1) % this.capacity; 
    }
  }

  toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.size; i++) {
      result.push(this.buffer[(this.head + i) % this.capacity] as T);
    }
    return result;
  }

  length(): number { return this.size; }
}

export class StatArbAgent extends BaseAgent {
  // 페어 트레이딩 목록 (종목 티커)
  private pairs = [
    { a: 'SPY', b: 'VOO', beta: 1.0 },      // S&P 500 ETF 페어
    { a: 'QQQ', b: 'VOO', beta: 1.0 },      // 나스닥 100 - S&P 500 페어
    { a: '005930', b: '000660', beta: 0.4 }, // 삼성전자 - SK하이닉스
    { a: '005380', b: '000270', beta: 2.1 }, // 현대차 - 기아
    { a: '035420', b: '035720', beta: 4.0 }  // NAVER - 카카오
  ];
  
  private history: Map<string, CircularQueue<number>> = new Map();
  private positions: Record<string, 'NONE' | 'SHORT_A' | 'LONG_A'> = {};

  constructor(botConfig?: any) {
    super(botConfig || 'QUANT_STAT_ARB', botConfig?.capital || 100000000000); // 1000억
  }

  // 이벤트 주도형 호출
  public executePairsTrading(stocks: any[]): any[] {
    const orders: any[] = [];

    
    // 티커로 매핑
    const currentPrices: Record<string, number> = {};
    const stockIdMap: Record<string, string> = {};
    for (const s of stocks) {
      currentPrices[s.ticker] = s.current_price;
      stockIdMap[s.ticker] = s.id;
    }

    for (const pair of this.pairs) {
      const pA = currentPrices[pair.a];
      const pB = currentPrices[pair.b];
      
      if (!pA || !pB) continue;

      const spread = Math.log(pA) - (pair.beta * Math.log(pB));
      const pairKey = `${pair.a}_${pair.b}`;

      if (!this.history.has(pairKey)) {
        this.history.set(pairKey, new CircularQueue(60)); // 60틱 이동평균
        this.positions[pairKey] = 'NONE';
      }

      const spreadHistQueue = this.history.get(pairKey)!;
      spreadHistQueue.push(spread);

      if (spreadHistQueue.length() === 60) {
        const spreadArray = spreadHistQueue.toArray();
        const mean = spreadArray.reduce((acc, val) => acc + val, 0) / 60;
        const variance = spreadArray.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / 60;
        const stdDev = Math.sqrt(variance);
        
        // Z-Score
        const zScore = stdDev === 0 ? 0 : (spread - mean) / stdDev;
        const currentPosition = this.positions[pairKey];

        // 진입 (Z > 2.0)
        if (zScore > 2.0 && currentPosition === 'NONE') {
          console.log(`[StatArb] ⚖️ Z-Score = ${zScore.toFixed(2)}. Shorting ${pair.a}, Buying ${pair.b}.`);
          // A 고평가 (A 공매도, B 매수)
          orders.push({
            stock_id: stockIdMap[pair.a],
            user_id: null,
            side: 'sell',
            price: pA - this.getTickSize(pA) * 3, // 시장가(공격적 매도)
            size: 500,
            status: 'open',
            is_lp: true,
            _botId: this.botId
          });
          orders.push({
            stock_id: stockIdMap[pair.b],
            user_id: null,
            side: 'buy',
            price: pB + this.getTickSize(pB) * 3,
            size: 500,
            status: 'open',
            is_lp: true,
            _botId: this.botId
          });
          this.positions[pairKey] = 'SHORT_A';
        }

        // 청산 (평균 회귀 Z < 0.2)
        if (Math.abs(zScore) < 0.2 && currentPosition !== 'NONE') {
          console.log(`[StatArb] ⚖️ Mean Reversion! Z-Score = ${zScore.toFixed(2)}. Liquidating pair ${pair.a}-${pair.b}.`);
          const sideA = currentPosition === 'SHORT_A' ? 'buy' : 'sell';
          const sideB = currentPosition === 'SHORT_A' ? 'sell' : 'buy';
          
          orders.push({
            stock_id: stockIdMap[pair.a],
            user_id: null,
            side: sideA,
            price: sideA === 'buy' ? pA + this.getTickSize(pA) * 3 : pA - this.getTickSize(pA) * 3,
            size: 500,
            status: 'open',
            is_lp: true,
            _botId: this.botId
          });
          orders.push({
            stock_id: stockIdMap[pair.b],
            user_id: null,
            side: sideB,
            price: sideB === 'buy' ? pB + this.getTickSize(pB) * 3 : pB - this.getTickSize(pB) * 3,
            size: 500,
            status: 'open',
            is_lp: true,
            _botId: this.botId
          });
          this.positions[pairKey] = 'NONE';
        }
      }
    }
    
    return orders;
  }
}
