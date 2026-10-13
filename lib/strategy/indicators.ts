import Decimal from "decimal.js";

import { DAILY_SECONDS, type MarketCandle } from "@/lib/markets/history/types";
import { marketDecimal } from "@/lib/markets/format";
import {
  ANALYSIS_CANDLE_COUNT,
  INDICATOR_VERSION,
  MINIMUM_CANDLE_COUNT,
  type IndicatorCalculation,
} from "@/lib/strategy/types";

Decimal.set({ precision: 60, rounding: Decimal.ROUND_HALF_UP });

export class IndicatorInputError extends Error {
  constructor(readonly code: "INSUFFICIENT_HISTORY" | "MARKET_DATA_GAP" | "INVALID_INDICATORS" | "MARKET_DATA_STALE") {
    super(code);
  }
}

const DAY_MS = DAILY_SECONDS * 1_000;
const price = (value: string) => marketDecimal(value);
const fixedPrice = (value: Decimal) => value.toFixed(12);
const fixedPercent = (value: Decimal) => value.toFixed(8);

function parseCutoff(cutoff: string): number {
  const value = Date.parse(cutoff);
  if (!Number.isFinite(value) || value % DAY_MS !== 0 || new Date(value).toISOString() !== cutoff) {
    throw new IndicatorInputError("INVALID_INDICATORS");
  }
  return value;
}

function validateCandle(candle: MarketCandle): number {
  const start = Date.parse(candle.candleStart);
  if (!Number.isFinite(start) || start % DAY_MS !== 0 || candle.granularity !== "ONE_DAY"
    || candle.source !== "Coinbase Advanced Trade public API") throw new IndicatorInputError("INVALID_INDICATORS");
  const open = price(candle.open);
  const high = price(candle.high);
  const low = price(candle.low);
  const close = price(candle.close);
  const volume = marketDecimal(candle.volume);
  if (![open, high, low, close].every((value) => value.gt(0)) || volume.isNegative()
    || low.gt(open) || low.gt(close) || high.lt(open) || high.lt(close) || low.gt(high)) {
    throw new IndicatorInputError("INVALID_INDICATORS");
  }
  return start;
}

function average(values: Decimal[]): Decimal {
  return values.reduce((sum, value) => sum.plus(value), new Decimal(0)).dividedBy(values.length);
}

export function calculateSma(closes: readonly string[], period: number): string {
  if (!Number.isInteger(period) || period < 1 || closes.length < period) throw new IndicatorInputError("INSUFFICIENT_HISTORY");
  return fixedPrice(average(closes.slice(-period).map(price)));
}

export function calculateRsi14(closes: readonly string[]): string {
  if (closes.length < 15) throw new IndicatorInputError("INSUFFICIENT_HISTORY");
  const changes = closes.slice(1).map((value, index) => price(value).minus(price(closes[index])));
  let averageGain = average(changes.slice(0, 14).map((change) => Decimal.max(change, 0)));
  let averageLoss = average(changes.slice(0, 14).map((change) => Decimal.max(change.negated(), 0)));
  for (const change of changes.slice(14)) {
    averageGain = averageGain.times(13).plus(Decimal.max(change, 0)).dividedBy(14);
    averageLoss = averageLoss.times(13).plus(Decimal.max(change.negated(), 0)).dividedBy(14);
  }
  if (averageGain.isZero() && averageLoss.isZero()) return "50.00000000";
  if (averageLoss.isZero()) return "100.00000000";
  const relativeStrength = averageGain.dividedBy(averageLoss);
  return fixedPercent(new Decimal(100).minus(new Decimal(100).dividedBy(relativeStrength.plus(1))));
}

export function calculateMomentum(closes: readonly string[], days: number): string {
  if (!Number.isInteger(days) || days < 1 || closes.length <= days) throw new IndicatorInputError("INSUFFICIENT_HISTORY");
  const latest = price(closes.at(-1)!);
  const earlier = price(closes.at(-(days + 1))!);
  return fixedPercent(latest.dividedBy(earlier).minus(1).times(100));
}

// Thirty close-to-close daily returns, sample standard deviation (n - 1),
// annualised with sqrt(365), expressed as a percentage.
export function calculateAnnualizedVolatility30(closes: readonly string[]): string {
  if (closes.length < 31) throw new IndicatorInputError("INSUFFICIENT_HISTORY");
  const values = closes.slice(-31).map(price);
  const returns = values.slice(1).map((value, index) => value.dividedBy(values[index]).minus(1));
  const mean = average(returns);
  const variance = returns.reduce((sum, value) => sum.plus(value.minus(mean).pow(2)), new Decimal(0))
    .dividedBy(returns.length - 1);
  return fixedPercent(variance.sqrt().times(new Decimal(365).sqrt()).times(100));
}

export function calculateTechnicalIndicators(candles: readonly MarketCandle[], cutoff: string): IndicatorCalculation {
  const cutoffMs = parseCutoff(cutoff);
  const seen = new Set<number>();
  const eligible = candles.flatMap((candle) => {
    const start = Date.parse(candle.candleStart);
    if (!Number.isFinite(start) || start % DAY_MS !== 0) throw new IndicatorInputError("INVALID_INDICATORS");
    // Post-cutoff records are excluded before any OHLCV field is read.
    if (start + DAY_MS > cutoffMs) return [];
    validateCandle(candle);
    if (seen.has(start)) throw new IndicatorInputError("MARKET_DATA_GAP");
    seen.add(start);
    return [{ candle, start }];
  }).sort((left, right) => left.start - right.start).slice(-ANALYSIS_CANDLE_COUNT);

  if (eligible.length < MINIMUM_CANDLE_COUNT) throw new IndicatorInputError("INSUFFICIENT_HISTORY");
  for (let index = 1; index < eligible.length; index += 1) {
    if (eligible[index].start - eligible[index - 1].start !== DAY_MS) throw new IndicatorInputError("MARKET_DATA_GAP");
  }
  const latest = eligible.at(-1)!;
  if (latest.start + DAY_MS !== cutoffMs) throw new IndicatorInputError("MARKET_DATA_STALE");
  const selected = eligible.map(({ candle }) => candle);
  const closes = selected.map((candle) => candle.close);
  const indicators = {
    version: INDICATOR_VERSION,
    cutoff,
    latestCandleStart: latest.candle.candleStart,
    latestClose: fixedPrice(price(closes.at(-1)!)),
    sma20: calculateSma(closes, 20),
    sma50: calculateSma(closes, 50),
    rsi14: calculateRsi14(closes),
    momentum7: calculateMomentum(closes, 7),
    momentum30: calculateMomentum(closes, 30),
    volatility30Annualized: calculateAnnualizedVolatility30(closes),
    inputCount: selected.length,
    inputStart: selected[0].candleStart,
    inputEnd: selected.at(-1)!.candleStart,
  } as const;
  return { indicators, candles: selected, dataQuality: "VALID", freshness: "CURRENT" };
}
