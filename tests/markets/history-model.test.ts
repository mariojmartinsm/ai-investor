import { describe, expect, it } from "vitest";

import { readStoredCandles } from "@/lib/markets/history/model";
import { DAILY_SECONDS } from "@/lib/markets/history/types";

const now = Date.UTC(2026, 9, 13, 12);
const todayStart = Date.UTC(2026, 9, 13);

function row(start: number, product = "BTC-EUR") {
  return { product_id: product, granularity: "ONE_DAY", candle_start: new Date(start).toISOString(), open_price: "100.000000000000000000", high_price: "110.000000000000000000", low_price: "90.000000000000000000", close_price: "105.123456789012345678", volume: "0.000000000000000000", source: "Coinbase Advanced Trade public API", fetched_at: "2026-10-13T12:00:00.000Z" };
}

describe("stored historical series", () => {
  it("sorts rows and exposes missing days without interpolation", () => {
    const day = DAILY_SECONDS * 1_000;
    const series = readStoredCandles([row(todayStart - day), row(todayStart - 3 * day)], "BTC-EUR", now);
    expect(series.candles.map((candle) => candle.candleStart)).toEqual([new Date(todayStart - 3 * day).toISOString(), new Date(todayStart - day).toISOString()]);
    expect(series.complete).toBe(false);
    expect(series.gaps).toContain(new Date(todayStart - 2 * day).toISOString());
    expect(series.candles).toHaveLength(2);
  });

  it("rejects duplicates, product mismatches and non-string database decimals", () => {
    const start = todayStart - DAILY_SECONDS * 1_000;
    expect(() => readStoredCandles([row(start), row(start)], "BTC-EUR", now)).toThrow("Duplicate");
    expect(() => readStoredCandles([row(start, "ETH-EUR")], "BTC-EUR", now)).toThrow("identity");
    expect(() => readStoredCandles([{ ...row(start), close_price: 105 }], "BTC-EUR", now)).toThrow("amount");
  });
});
