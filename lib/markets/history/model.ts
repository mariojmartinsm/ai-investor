import { DAILY_SECONDS, HISTORY_DAYS, type HistoricalSeries, type MarketCandle } from "@/lib/markets/history/types";
import { MARKET_PRODUCTS, type MarketProduct } from "@/lib/markets/types";

type Row = Record<string, unknown>;

function isProduct(value: unknown): value is MarketProduct {
  return typeof value === "string" && (MARKET_PRODUCTS as readonly string[]).includes(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function decimal(value: unknown): value is string {
  return typeof value === "string" && /^(?:0|[1-9]\d{0,19})(?:\.\d{1,18})?$/.test(value);
}

export function readStoredCandles(value: unknown, expectedProduct: MarketProduct, now: number): HistoricalSeries {
  if (!Array.isArray(value)) throw new Error("Invalid stored market history");
  const candles = value.map((candidate): MarketCandle => {
    if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) throw new Error("Invalid stored candle");
    const row = candidate as Row;
    if (!isProduct(row.product_id) || row.product_id !== expectedProduct || row.granularity !== "ONE_DAY"
      || !timestamp(row.candle_start) || !timestamp(row.fetched_at)
      || row.source !== "Coinbase Advanced Trade public API") throw new Error("Invalid stored candle identity");
    for (const key of ["open_price", "high_price", "low_price", "close_price", "volume"] as const) {
      if (!decimal(row[key])) throw new Error("Invalid stored candle amount");
    }
    return {
      productId: row.product_id,
      granularity: "ONE_DAY",
      candleStart: row.candle_start,
      open: row.open_price as string,
      high: row.high_price as string,
      low: row.low_price as string,
      close: row.close_price as string,
      volume: row.volume as string,
      source: row.source,
      fetchedAt: row.fetched_at,
    };
  }).sort((left, right) => Date.parse(left.candleStart) - Date.parse(right.candleStart));

  const starts = new Set(candles.map((candle) => Date.parse(candle.candleStart)));
  if (starts.size !== candles.length) throw new Error("Duplicate stored candle");
  const todayStart = Math.floor(now / (DAILY_SECONDS * 1_000)) * DAILY_SECONDS * 1_000;
  const expectedStart = todayStart - HISTORY_DAYS * DAILY_SECONDS * 1_000;
  const gaps: string[] = [];
  for (let start = expectedStart; start < todayStart; start += DAILY_SECONDS * 1_000) {
    if (!starts.has(start)) gaps.push(new Date(start).toISOString());
  }
  return {
    productId: expectedProduct,
    candles,
    gaps,
    complete: candles.length === HISTORY_DAYS && gaps.length === 0,
    latestFetchedAt: candles.reduce<string | null>((latest, candle) => latest === null || candle.fetchedAt > latest ? candle.fetchedAt : latest, null),
  };
}
