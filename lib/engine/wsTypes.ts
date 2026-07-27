export type WsChannelType = 'orderbook' | 'trades' | 'rollover' | 'user';

export interface OrderBookTick {
  ticker: string;
  bids: [price: number, quantity: number][]; // [가격, 수량]
  asks: [price: number, quantity: number][];
  timestamp: number;
}

export interface TradeFeedEvent {
  tradeId: string;
  ticker: string;
  price: number;
  quantity: number;
  side: 'BUY' | 'SELL';
  isLiquidation: boolean; // 강제 청산 여부 (보라색 하이라이트용)
  timestamp: number;
}

export interface RolloverAlertEvent {
  comboId: string;
  botId: string;
  closeTicker: string;
  openTicker: string;
  quantity: number;
  executedSpread: number;
  timestamp: number;
}
