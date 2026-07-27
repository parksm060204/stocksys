export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET' | 'LIQUIDATION';
export type OptionType = 'CALL' | 'PUT';

export interface Order {
  id: string;
  botId: string;
  contractTicker: string; // 예: "IDX-K200-2607-C350"
  side: OrderSide;
  type: OrderType;
  price: number;          // 시장가는 0
  quantity: number;
  filledQuantity: number;
  timestamp: number;
}

export interface RolloverOrder {
  comboId: string;
  botId: string;
  closeContractTicker: string; // 근월물 (청산 대상)
  openContractTicker: string;  // 원월물 (신규 진입 대상)
  side: OrderSide;             // 근월물 매도 + 원월물 매수 축
  quantity: number;
  targetSpreadPrice: number;   // 원월물가격 - 근월물가격 허용 한도
  timestamp: number;
}

export interface Trade {
  tradeId: string;
  contractTicker: string;
  buyOrderId: string;
  sellOrderId: string;
  buyBotId: string;
  sellBotId: string;
  price: number;
  quantity: number;
  timestamp: number;
  isLiquidation: boolean;
}
