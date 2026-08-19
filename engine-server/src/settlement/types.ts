export interface OptionContract {
  id: string;
  underlying_stock_id: string;
  ticker?: string | undefined;
  type?: 'CALL' | 'PUT' | undefined;
  option_type?: 'CALL' | 'PUT' | undefined;
  strike_price: number;
  current_price: number;
  expiry_date: string;
  open_interest: number;
  volume: number;
}

export interface OptionPosition {
  userId: string;
  optionId: string;
  quantity: number;
  avgPrice: number;
}

export interface OptionSettlementResult {
  optionId: string;
  userId: string;
  optionType: 'CALL' | 'PUT';
  strikePrice: number;
  underlyingClosePrice: number;
  isItm: boolean;
  quantity: number;
  multiplier: number;
  payoutAmount: number;
  idempotencyKey: string;
  settledAt: number;
}

export interface BondItem {
  id: string;
  ticker: string;
  name: string;
  bond_type: string;
  maturity: string;
  maturity_date?: string | undefined;
  coupon_rate: number;
  face_value: number;
  current_price: number;
}

export interface BondPosition {
  userId: string;
  bondId: string;
  quantity: number;
  avgPrice: number;
}

export interface BondPaymentResult {
  bondId: string;
  userId: string;
  paymentType: 'COUPON' | 'MATURITY_REDEMPTION';
  couponRate: number;
  faceValue: number;
  quantity: number;
  paymentAmount: number;
  idempotencyKey: string;
  paymentDate: number;
}
