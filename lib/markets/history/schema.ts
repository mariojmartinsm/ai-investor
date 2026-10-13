import Decimal from "decimal.js";

import { DAILY_SECONDS, type MarketCandle } from "@/lib/markets/history/types";
import type { MarketProduct } from "@/lib/markets/types";

const CandleDecimal = Decimal.clone({ precision: 48 });
const unsignedDecimal = /^(?:0|[1-9]\d{0,19})(?:\.\d{1,18})?$/;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid Coinbase candle");
  return value as Record<string, unknown>;
}

function decimal(value: unknown, positive: boolean): string {
  if (typeof value !== "string" || !unsignedDecimal.test(value)) throw new Error("Invalid candle decimal");
  const parsed = new CandleDecimal(value);
  if (!parsed.isFinite() || (positive ? parsed.lte(0) : parsed.lt(0))) throw new Error("Invalid candle amount");
  return value;
}

function unixDay(value: unknown): number {
  if (typeof value !== "string" || !/^\d{1,10}$/.test(value)) throw new Error("Invalid candle timestamp");
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds % DAILY_SECONDS !== 0) throw new Error("Unaligned candle timestamp");
  return seconds;
}

export function readCoinbaseCandle(
  value: unknown,
  productId: MarketProduct,
  fetchedAt: string,
  rangeStart: number,
  rangeEnd: number,
): MarketCandle {
  const data = record(value);
  const start = unixDay(data.start);
  if (start < rangeStart || start >= rangeEnd) throw new Error("Unexpected candle timestamp");
  const open = decimal(data.open, true);
  const high = decimal(data.high, true);
  const low = decimal(data.low, true);
  const close = decimal(data.close, true);
  const volume = decimal(data.volume, false);
  const openValue = new CandleDecimal(open);
  const highValue = new CandleDecimal(high);
  const lowValue = new CandleDecimal(low);
  const closeValue = new CandleDecimal(close);
  if (lowValue.gt(openValue) || lowValue.gt(closeValue) || highValue.lt(openValue)
    || highValue.lt(closeValue) || lowValue.gt(highValue)) throw new Error("Invalid candle OHLC relationship");
  return {
    productId,
    granularity: "ONE_DAY",
    candleStart: new Date(start * 1_000).toISOString(),
    open,
    high,
    low,
    close,
    volume,
    source: "Coinbase Advanced Trade public API",
    fetchedAt,
  };
}

export function readCoinbaseCandlePage(
  value: unknown,
  productId: MarketProduct,
  fetchedAt: string,
  rangeStart: number,
  rangeEnd: number,
): { candles: MarketCandle[]; rejected: number } {
  const data = record(value);
  if (!Array.isArray(data.candles) || data.candles.length > 350) throw new Error("Invalid Coinbase candle page");
  const candles: MarketCandle[] = [];
  let rejected = 0;
  for (const candidate of data.candles) {
    try {
      candles.push(readCoinbaseCandle(candidate, productId, fetchedAt, rangeStart, rangeEnd));
    } catch {
      rejected += 1;
    }
  }
  return { candles, rejected };
}
