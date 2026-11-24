import type { Stock } from "@/lib/types";

export const PUBLIC_STOCK_SELECT_COLUMNS =
  "id, name, ticker, market, sector, current_price, previous_close, description, market_cap, open_price, high, low, volume, relevance_weight, is_core, is_listed, listed_at, financials, created_at, updated_at";

export type PublicStockDto = Omit<Stock, "targetPrice">;

/**
 * Converts an authoritative stocks/bonds row into a public client-serializable DTO.
 * Internal valuation fields such as `target_price` / `targetPrice` are explicitly omitted.
 */
export function toPublicStockDto(
  row: Record<string, any>,
  options: {
    listedAt: string;
    bondMeta?: Stock["bondMeta"];
  }
): PublicStockDto {
  const currentPrice = Number(row.current_price);
  const previousClose = Number(row.previous_close);
  return {
    id: String(row.id),
    name: String(row.name),
    ticker: String(row.ticker),
    market: row.market,
    sector: String(row.sector ?? ""),
    currentPrice,
    previousClose,
    description: row.description || "",
    marketCap: row.market_cap ? Number(row.market_cap) : currentPrice * 1_000_000,
    openPrice: row.open_price ? Number(row.open_price) : previousClose,
    high: row.high ? Number(row.high) : currentPrice,
    low: row.low ? Number(row.low) : currentPrice,
    volume: row.volume ? Number(row.volume) : 0,
    relevanceWeight: row.relevance_weight ? Number(row.relevance_weight) : 1,
    isCore: Boolean(row.is_core),
    ...(row.is_listed !== undefined ? { isListed: Boolean(row.is_listed) } : {}),
    listedAt: options.listedAt,
    financials: row.financials || null,
    bondMeta: options.bondMeta || row.bondMeta,
  };
}
