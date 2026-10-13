import { marketDecimal } from "@/lib/markets/format";
import type { ReferenceQuote, ReferenceQuoteSnapshot } from "@/lib/markets/reference/types";
import { MARKET_PRODUCTS, type MarketProduct } from "@/lib/markets/types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString().slice(0, 10) === value.slice(0, 10);

function nullablePositive(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !marketDecimal(value).gt(0)) throw new Error("Invalid reference quote amount");
  return value;
}

function readRow(value: unknown, now: number): ReferenceQuoteSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid reference quote row");
  const row = value as Record<string, unknown>;
  if (typeof row.id !== "string" || !uuid.test(row.id)
    || !(MARKET_PRODUCTS as readonly unknown[]).includes(row.product_id)
    || row.source !== "Coinbase Advanced Trade public API"
    || !["last_trade", "reference"].includes(row.price_kind as string)
    || !["public_bid_ask", "indicative_reference"].includes(row.execution_reference_kind as string)
    || row.validation_status !== "validated"
    || !timestamp(row.fetched_at) || !timestamp(row.fresh_until)
    || (row.exchange_at !== null && !timestamp(row.exchange_at))) {
    throw new Error("Invalid reference quote identity");
  }
  if (typeof row.price !== "string" || !marketDecimal(row.price).gt(0)) throw new Error("Invalid reference quote price");
  const bid = nullablePositive(row.bid);
  const ask = nullablePositive(row.ask);
  if (bid !== null && ask !== null && marketDecimal(bid).gt(ask)) throw new Error("Invalid reference quote spread");
  if (row.execution_reference_kind === "public_bid_ask" ? bid === null || ask === null : bid !== null && ask !== null) {
    throw new Error("Invalid execution reference classification");
  }
  if (row.price_kind === "reference" && row.exchange_at !== null) throw new Error("Invalid reference price timestamp");
  const product = row.product_id as MarketProduct;
  const quote: ReferenceQuote = {
    id: row.id,
    product,
    price: row.price,
    priceKind: row.price_kind as ReferenceQuote["priceKind"],
    bid,
    ask,
    executionReferenceKind: row.execution_reference_kind as ReferenceQuote["executionReferenceKind"],
    source: row.source,
    exchangeAt: row.exchange_at as string | null,
    fetchedAt: row.fetched_at,
    freshUntil: row.fresh_until,
    validationStatus: "validated",
  };
  const databaseFreshness = row.freshness_status;
  if (databaseFreshness !== "fresh" && databaseFreshness !== "stale") throw new Error("Invalid reference freshness");
  const fetched = Date.parse(quote.fetchedAt);
  const exchange = quote.exchangeAt === null ? null : Date.parse(quote.exchangeAt);
  const expectedFreshUntil = Math.min(fetched + 120_000, exchange === null ? Number.POSITIVE_INFINITY : exchange + 120_000);
  if (Date.parse(quote.freshUntil) !== expectedFreshUntil || (exchange !== null && exchange > fetched + 5_000)) {
    throw new Error("Invalid reference freshness window");
  }
  const future = fetched > now + 5_000 || (exchange !== null && exchange > now + 5_000);
  const status = databaseFreshness === "fresh" && Date.parse(quote.freshUntil) > now && !future ? "fresh" : "stale";
  return { product, status, quote };
}

export function unavailableReferenceQuotes(): ReferenceQuoteSnapshot[] {
  return MARKET_PRODUCTS.map((product) => ({ product, status: "unavailable", quote: null }));
}

export function readReferenceQuotes(value: unknown, now: number): ReferenceQuoteSnapshot[] {
  if (!Array.isArray(value) || value.length > MARKET_PRODUCTS.length) throw new Error("Invalid reference quote response");
  const rows = value.map((row) => readRow(row, now));
  return MARKET_PRODUCTS.map((product) => {
    const matches = rows.filter((row) => row.product === product);
    if (matches.length > 1) throw new Error("Duplicate reference quote product");
    return matches[0] ?? { product, status: "unavailable", quote: null };
  });
}
