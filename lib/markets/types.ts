export const MARKET_PRODUCTS = ["BTC-EUR", "ETH-EUR"] as const;
export type MarketProduct = (typeof MARKET_PRODUCTS)[number];

export const MARKET_POLL_MS = 60_000;
export const MARKET_STALE_MS = 120_000;

export type MarketQuote = {
  product: MarketProduct;
  price: string;
  priceKind: "last_trade" | "reference";
  change24h: string | null;
  volume24h: string | null;
  bid: string | null;
  ask: string | null;
  source: "Coinbase Advanced Trade public API";
  fetchedAt: string;
  // The timestamp of the trade used for price, never the application's clock
  // or a claim about when the untimestamped best bid/ask changed.
  exchangeAt: string | null;
};

export type MarketError = "TIMEOUT" | "NETWORK" | "RATE_LIMITED" | "SERVER_ERROR" | "INVALID_DATA" | "HTTP_ERROR";
export type MarketSnapshot = {
  product: MarketProduct;
  status: "fresh" | "stale" | "unavailable";
  quote: MarketQuote | null;
  error: MarketError | null;
};

export function quoteIsStale(quote: MarketQuote, now: number): boolean {
  const fetched = Date.parse(quote.fetchedAt);
  const exchange = quote.exchangeAt === null ? null : Date.parse(quote.exchangeAt);
  return !Number.isFinite(fetched) || now - fetched >= MARKET_STALE_MS || fetched > now + 5_000
    || (exchange !== null && (!Number.isFinite(exchange) || now - exchange >= MARKET_STALE_MS || exchange > now + 5_000));
}
