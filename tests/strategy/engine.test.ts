import { describe, expect, it } from "vitest";

import type { MarketCandle } from "@/lib/markets/history/types";
import { analyzeBaselineStrategy, decideBaselineCandidate } from "@/lib/strategy/engine";
import type { TechnicalIndicators } from "@/lib/strategy/types";

const DAY = 86_400_000;
const start = Date.parse("2026-01-01T00:00:00.000Z");
const cutoff = new Date(start + 60 * DAY).toISOString();

function flatCandles(count = 60): MarketCandle[] {
  return Array.from({ length: count }, (_, index) => ({
    productId: "BTC-EUR", granularity: "ONE_DAY", candleStart: new Date(start + index * DAY).toISOString(),
    open: "100", high: "101", low: "99", close: "100", volume: "10",
    source: "Coinbase Advanced Trade public API", fetchedAt: new Date(start + (index + 1) * DAY).toISOString(),
  }));
}

function indicators(change: Partial<TechnicalIndicators> = {}): TechnicalIndicators {
  return {
    version: "TECHNICAL_V1", cutoff, latestCandleStart: new Date(start + 59 * DAY).toISOString(),
    latestClose: "110.000000000000", sma20: "105.000000000000", sma50: "100.000000000000",
    rsi14: "50.00000000", momentum7: "1.00000000", momentum30: "2.00000000",
    volatility30Annualized: "10.00000000", inputCount: 60,
    inputStart: new Date(start).toISOString(), inputEnd: new Date(start + 59 * DAY).toISOString(), ...change,
  };
}

describe("BASELINE_V1 deterministic strategy", () => {
  it.each(["40.00000000", "65.00000000"])("includes the RSI %s BUY boundary", (rsi14) => {
    expect(decideBaselineCandidate(indicators({ rsi14 }), "0")).toMatchObject({
      signal: "BUY", proposedNotional: "25.000000000000", proposedQuantity: null, reasonCodes: ["BUY_CONDITIONS_MET"],
    });
  });

  it.each(["39.99999999", "65.00000001"])("rejects the RSI %s BUY boundary outside the interval", (rsi14) => {
    expect(decideBaselineCandidate(indicators({ rsi14 }), "0")).toMatchObject({ signal: "HOLD", proposedNotional: null });
  });

  it("returns a SELL candidate before BUY evaluation and caps quantity at 25%", () => {
    expect(decideBaselineCandidate(indicators({ latestClose: "90", sma20: "95", sma50: "100" }), "0.123456789123"))
      .toMatchObject({ signal: "SELL", proposedQuantity: "0.030864197280", reasonCodes: ["SELL_CONDITIONS_MET"] });
  });

  it("requires positive holdings for SELL", () => {
    expect(decideBaselineCandidate(indicators({ latestClose: "90", sma20: "95", sma50: "100" }), "0"))
      .toMatchObject({ signal: "HOLD", reasonCodes: ["NO_BUY_CONDITIONS", "NO_ASSET_HOLDINGS"] });
  });

  it("returns an explainable HOLD for valid neutral indicators", () => {
    const result = analyzeBaselineStrategy({ product: "BTC-EUR", candles: flatCandles(), ownedQuantity: "0", cutoff });
    expect(result).toMatchObject({
      strategyId: "BASELINE_V1", calculationVersion: "TECHNICAL_V1", analysisMode: "PREVIEW_ONLY",
      signal: "HOLD", dataQuality: "VALID", freshness: "CURRENT",
      reasonCodes: ["NO_BUY_CONDITIONS", "NO_SELL_CONDITIONS"], proposedNotional: null, proposedQuantity: null,
    });
    expect(result.idempotencyKey).toBe(`PREVIEW_ONLY:BASELINE_V1:BTC-EUR:${cutoff}`);
  });

  it("fails closed to HOLD for insufficient, gapped and malformed history", () => {
    expect(analyzeBaselineStrategy({ product: "BTC-EUR", candles: flatCandles(59), ownedQuantity: "0", cutoff }).reasonCodes)
      .toEqual(["INSUFFICIENT_HISTORY"]);
    const gapped = flatCandles().map((value, index) => index === 30 ? { ...value, candleStart: new Date(start + 31 * DAY).toISOString() } : value);
    expect(analyzeBaselineStrategy({ product: "BTC-EUR", candles: gapped, ownedQuantity: "0", cutoff }).reasonCodes)
      .toEqual(["MARKET_DATA_GAP"]);
    const malformed = flatCandles().map((value, index) => index === 20 ? { ...value, close: "0" } : value);
    expect(analyzeBaselineStrategy({ product: "BTC-EUR", candles: malformed, ownedQuantity: "0", cutoff }).reasonCodes)
      .toEqual(["INVALID_INDICATORS"]);
  });

  it("fails closed to HOLD when the latest closed candle is stale", () => {
    const staleCutoff = new Date(start + 61 * DAY).toISOString();
    expect(analyzeBaselineStrategy({ product: "BTC-EUR", candles: flatCandles(), ownedQuantity: "0", cutoff: staleCutoff }))
      .toMatchObject({
        signal: "HOLD",
        dataQuality: "STALE_MARKET_DATA",
        freshness: "STALE",
        reasonCodes: ["MARKET_DATA_STALE"],
        proposedNotional: null,
        proposedQuantity: null,
      });
  });

  it("is byte-for-byte deterministic for identical inputs", () => {
    const input = { product: "BTC-EUR" as const, candles: flatCandles(), ownedQuantity: "0", cutoff };
    expect(analyzeBaselineStrategy(input)).toEqual(analyzeBaselineStrategy(input));
  });
});
