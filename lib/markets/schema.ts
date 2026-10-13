import Decimal from "decimal.js";

import type { MarketProduct } from "@/lib/markets/types";

const MarketDecimal = Decimal.clone({ precision: 40 });
const unsignedDecimal = /^(?:0|[1-9]\d{0,19})(?:\.\d{1,20})?$/;

export type CoinbaseProduct = {
  price: string;
  change24h: string | null;
  volume24h: string | null;
  bid: string | null;
  ask: string | null;
};

export type CoinbaseTrade = { price: string; time: string | null };
export type CoinbaseTicker = { trades: CoinbaseTrade[]; bid: string | null; ask: string | null };

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid Coinbase response object");
  }
  return value as Record<string, unknown>;
}

function decimal(value: unknown, positive: boolean): string {
  if (typeof value !== "string" || !unsignedDecimal.test(value)) {
    throw new Error("Invalid Coinbase decimal");
  }
  const parsed = new MarketDecimal(value);
  if (!parsed.isFinite() || (positive && parsed.lessThanOrEqualTo(0))) {
    throw new Error("Invalid Coinbase amount");
  }
  return value;
}

function optionalDecimal(value: unknown, positive: boolean): string | null {
  if (value === undefined || value === null || value === "") return null;
  return decimal(value, positive);
}

function percentage(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("Invalid Coinbase percentage");
  // The documented sample has a trailing %, while the public API also returns
  // plain percentage strings. The adapter always exposes percentage units.
  const clean = value.endsWith("%") ? value.slice(0, -1) : value;
  decimal(clean.startsWith("-") ? clean.slice(1) : clean, false);
  if (new MarketDecimal(clean).lessThan(-100)) throw new Error("Invalid Coinbase change");
  return clean;
}

function timestamp(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) {
    throw new Error("Invalid Coinbase trade time");
  }
  const parsed = Date.parse(value);
  // Date.parse normalizes impossible calendar dates; reject those instead.
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 19) !== value.slice(0, 19)) {
    throw new Error("Invalid Coinbase trade time");
  }
  return value;
}

export function validateSpread(bid: string | null, ask: string | null): void {
  if (bid !== null && ask !== null && new MarketDecimal(bid).greaterThan(ask)) {
    throw new Error("Inverted Coinbase spread");
  }
}

export function parseCoinbaseProduct(value: unknown, product: MarketProduct): CoinbaseProduct {
  const data = record(value);
  if (data.product_id !== product) throw new Error("Coinbase product mismatch");
  if (data.base_currency_id !== undefined && data.base_currency_id !== product.slice(0, 3)) {
    throw new Error("Coinbase base currency mismatch");
  }
  if (data.quote_currency_id !== undefined && data.quote_currency_id !== "EUR") {
    throw new Error("Coinbase quote currency mismatch");
  }
  if (data.product_type !== undefined && data.product_type !== "SPOT") {
    throw new Error("Coinbase product is not spot");
  }
  const bid = optionalDecimal(data.best_bid_price, true);
  const ask = optionalDecimal(data.best_ask_price, true);
  validateSpread(bid, ask);
  return {
    price: decimal(data.price, true),
    change24h: percentage(data.price_percentage_change_24h),
    volume24h: optionalDecimal(data.volume_24h, false),
    bid,
    ask,
  };
}

export function parseCoinbaseTicker(value: unknown, product: MarketProduct): CoinbaseTicker {
  const data = record(value);
  if (!Array.isArray(data.trades) || data.trades.length > 100) throw new Error("Invalid Coinbase trades");
  const bid = optionalDecimal(data.best_bid, true);
  const ask = optionalDecimal(data.best_ask, true);
  validateSpread(bid, ask);
  const trades = data.trades.map((value): CoinbaseTrade => {
    const trade = record(value);
    if (trade.product_id !== product) throw new Error("Coinbase trade product mismatch");
    if (trade.size !== undefined) decimal(trade.size, false);
    return { price: decimal(trade.price, true), time: timestamp(trade.time) };
  });
  return { trades, bid, ask };
}
