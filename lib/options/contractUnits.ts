/** Ambiguous legacy contracts need an explicit correction before trading or payout. */
export function hasAmbiguousK200Units(contract: {
  ticker?: string;
  asset_class?: string;
  underlying_stock_id?: string;
  strike_price: number;
}): boolean {
  return Boolean(contract.ticker?.startsWith('IDX-K200-') && (
    contract.asset_class !== 'IDX' ||
    contract.underlying_stock_id !== 'idx_k200' ||
    contract.strike_price >= 1000
  ));
}
