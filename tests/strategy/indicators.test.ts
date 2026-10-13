import { describe, expect, it } from "vitest";

import type { MarketCandle } from "@/lib/markets/history/types";
import {
  calculateAnnualizedVolatility30,
  calculateMomentum,
  calculateRsi14,
  calculateSma,
  calculateTechnicalIndicators,
  IndicatorInputError,
} from "@/lib/strategy/indicators";

const DAY = 86_400_000;
const start = Date.parse("2026-01-01T00:00:00.000Z");

function candles(closes: string[], change: Partial<MarketCandle> = {}): MarketCandle[] {
  return closes.map((close, index) => ({
    productId: "BTC-EUR",
    granularity: "ONE_DAY",
    candleStart: new Date(start + index * DAY).toISOString(),
    open: close,
    high: String(Number(close) + 1),
    low: String(Math.max(Number(close) - 1, 0.0001)),
    close,
    volume: "10",
    source: "Coinbase Advanced Trade public API",
    fetchedAt: new Date(start + (index + 1) * DAY).toISOString(),
    ...change,
  }));
}

const cutoff = (count: number) => new Date(start + count * DAY).toISOString();

describe("decimal technical indicators", () => {
  it("calculates known SMA and momentum reference values", () => {
    const closes = Array.from({ length: 60 }, (_, index) => String(index + 1));
    expect(calculateSma(closes, 20)).toBe("50.500000000000");
    expect(calculateSma(closes, 50)).toBe("35.500000000000");
    expect(calculateMomentum(closes, 7)).toBe("13.20754717");
    expect(calculateMomentum(closes, 30)).toBe("100.00000000");
  });

  it("matches Wilder's published-style RSI reference sequence", () => {
    const closes = ["44.34", "44.09", "44.15", "43.61", "44.33", "44.83", "45.10", "45.42", "45.84", "46.08", "45.89", "46.03", "45.61", "46.28", "46.28"];
    expect(calculateRsi14(closes)).toBe("70.46413502");
  });

  it("defines flat RSI as neutral and zero-loss RSI as 100", () => {
    expect(calculateRsi14(Array(15).fill("100"))).toBe("50.00000000");
    expect(calculateRsi14(Array.from({ length: 15 }, (_, index) => String(100 + index)))).toBe("100.00000000");
  });

  it("uses 30 daily returns, sample deviation and sqrt(365) annualisation", () => {
    expect(calculateAnnualizedVolatility30(Array(31).fill("100"))).toBe("0.00000000");
    const alternating = Array.from({ length: 31 }, (_, index) => index % 2 === 0 ? "100" : "110");
    expect(calculateAnnualizedVolatility30(alternating)).toBe("185.48324045");
  });

  it("accepts exactly 60 contiguous fully closed candles", () => {
    const result = calculateTechnicalIndicators(candles(Array(60).fill("100")), cutoff(60));
    expect(result.indicators).toMatchObject({
      version: "TECHNICAL_V1", inputCount: 60, sma20: "100.000000000000", sma50: "100.000000000000",
      rsi14: "50.00000000", momentum7: "0.00000000", momentum30: "0.00000000", volatility30Annualized: "0.00000000",
    });
  });

  it("uses only the latest 90 candles and produces stable deterministic output", () => {
    const values = Array.from({ length: 120 }, (_, index) => String(100 + index));
    const first = calculateTechnicalIndicators(candles(values), cutoff(120));
    const second = calculateTechnicalIndicators([...candles(values)].reverse(), cutoff(120));
    expect(first.indicators.inputCount).toBe(90);
    expect(second.indicators).toEqual(first.indicators);
    expect(first.indicators.inputStart).toBe(new Date(start + 30 * DAY).toISOString());
  });

  it("excludes post-cutoff values before reading malformed OHLCV fields", () => {
    const valid = candles(Array(60).fill("100"));
    const future = { ...valid.at(-1)!, candleStart: cutoff(60), open: "NaN", high: "NaN", low: "NaN", close: "NaN" };
    expect(calculateTechnicalIndicators([...valid, future], cutoff(60)).indicators)
      .toEqual(calculateTechnicalIndicators(valid, cutoff(60)).indicators);
  });

  it.each([
    { name: "59 candles", input: candles(Array(59).fill("100")), code: "INSUFFICIENT_HISTORY" },
    { name: "gap", input: candles(Array(60).fill("100")).filter((_, index) => index !== 30), code: "INSUFFICIENT_HISTORY" },
    { name: "duplicate", input: [...candles(Array(60).fill("100")), candles(["100"])[0]], code: "MARKET_DATA_GAP" },
    { name: "zero close", input: candles(Array(60).fill("100")).map((item, index) => index === 20 ? { ...item, close: "0" } : item), code: "INVALID_INDICATORS" },
  ] as const)("rejects $name", ({ input, code }) => {
    expect(() => calculateTechnicalIndicators(input, cutoff(60))).toThrow(expect.objectContaining<Partial<IndicatorInputError>>({ code }));
  });

  it("rejects a 60-candle series with an internal missing UTC day", () => {
    const input = candles(Array(61).fill("100")).filter((_, index) => index !== 30);
    expect(() => calculateTechnicalIndicators(input, cutoff(61))).toThrow(expect.objectContaining({ code: "MARKET_DATA_GAP" }));
  });
});
