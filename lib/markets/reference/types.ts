import type { MarketProduct } from "@/lib/markets/types";

export type ExecutionReferenceKind = "public_bid_ask" | "indicative_reference";
export type ReferenceFreshness = "fresh" | "stale" | "unavailable";

export type ReferenceQuote = {
  id: string;
  product: MarketProduct;
  price: string;
  priceKind: "last_trade" | "reference";
  bid: string | null;
  ask: string | null;
  executionReferenceKind: ExecutionReferenceKind;
  source: "Coinbase Advanced Trade public API";
  exchangeAt: string | null;
  fetchedAt: string;
  freshUntil: string;
  validationStatus: "validated";
};

export type ReferenceQuoteSnapshot = {
  product: MarketProduct;
  status: ReferenceFreshness;
  quote: ReferenceQuote | null;
};

export type ReferencePersistResult = { inserted: number; skipped: number };
