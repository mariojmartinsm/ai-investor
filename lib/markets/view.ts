import { marketDecimal } from "@/lib/markets/format";
import { MARKET_PRODUCTS, quoteIsStale, type MarketError, type MarketSnapshot } from "@/lib/markets/types";

const errors: MarketError[] = ["TIMEOUT", "NETWORK", "RATE_LIMITED", "SERVER_ERROR", "INVALID_DATA", "HTTP_ERROR"];
const timestamp = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString().slice(0, 19) === value.slice(0, 19);

// Validate the browser's polling boundary too: an HTML redirect, partial list
// or malformed JSON must not replace confirmed quotes with invented numbers.
export function readMarketSnapshots(value: unknown): MarketSnapshot[] {
  if (!Array.isArray(value) || value.length !== MARKET_PRODUCTS.length) throw new Error("Invalid market response");
  return MARKET_PRODUCTS.map((product) => {
    const matches = value.filter((row) => row && typeof row === "object" && row.product === product);
    if (matches.length !== 1) throw new Error("Invalid market product");
    const row = matches[0];
    if (!["fresh", "stale", "unavailable"].includes(row.status)
      || (row.error !== null && !errors.includes(row.error))) throw new Error("Invalid market state");
    if (row.quote === null) {
      if (row.status !== "unavailable") throw new Error("Missing market quote");
      return { product, status: row.status, error: row.error, quote: null };
    }
    const quote = row.quote;
    if (!quote || typeof quote !== "object" || quote.product !== product
      || quote.source !== "Coinbase Advanced Trade public API"
      || !["last_trade", "reference"].includes(quote.priceKind)
      || !timestamp(quote.fetchedAt) || (quote.exchangeAt !== null && !timestamp(quote.exchangeAt))) {
      throw new Error("Invalid market quote");
    }
    for (const key of ["price", "change24h", "volume24h", "bid", "ask"] as const) {
      const decimal = quote[key];
      if (decimal === null && key !== "price") continue;
      if (typeof decimal !== "string") throw new Error("Invalid market amount");
      const parsed = marketDecimal(decimal);
      if ((key === "price" || key === "bid" || key === "ask") && !parsed.gt("0")) throw new Error("Invalid market price");
      if (key === "volume24h" && parsed.isNegative()) throw new Error("Invalid market volume");
      if (key === "change24h" && parsed.lt("-100")) throw new Error("Invalid market change");
    }
    if (quote.bid !== null && quote.ask !== null && marketDecimal(quote.bid).gt(quote.ask)) throw new Error("Inverted market quote");
    if (quote.priceKind === "reference" && quote.exchangeAt !== null) throw new Error("Invalid reference timestamp");
    return { product, status: row.status, error: row.error, quote: { ...quote } } as MarketSnapshot;
  });
}

export function visibleMarketSnapshot(snapshot: MarketSnapshot, now: number): MarketSnapshot {
  return snapshot.status === "fresh" && snapshot.quote && quoteIsStale(snapshot.quote, now)
    ? { ...snapshot, status: "stale" } : snapshot;
}

export function unavailableMarkets(previous: MarketSnapshot[]): MarketSnapshot[] {
  return previous.map((snapshot) => ({ ...snapshot, status: "unavailable", error: "NETWORK" }));
}
