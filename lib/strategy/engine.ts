import Decimal from "decimal.js";

import type { MarketCandle } from "@/lib/markets/history/types";
import type { MarketProduct } from "@/lib/markets/types";
import { parsePortfolioDecimal } from "@/lib/portfolio/decimal";
import { calculateTechnicalIndicators, IndicatorInputError } from "@/lib/strategy/indicators";
import {
  ANALYSIS_MODE,
  INDICATOR_VERSION,
  STRATEGY_ID,
  type DataFreshness,
  type DataQuality,
  type StrategyAnalysis,
  type StrategyReasonCode,
  type TechnicalIndicators,
} from "@/lib/strategy/types";

function failureMetadata(error: unknown): { quality: DataQuality; freshness: DataFreshness; reason: StrategyReasonCode; explanation: string } {
  if (error instanceof IndicatorInputError) {
    if (error.code === "INSUFFICIENT_HISTORY") return { quality: "INSUFFICIENT_HISTORY", freshness: "UNAVAILABLE", reason: "INSUFFICIENT_HISTORY", explanation: "At least 60 contiguous completed daily candles are required." };
    if (error.code === "MARKET_DATA_GAP") return { quality: "MARKET_DATA_GAP", freshness: "UNAVAILABLE", reason: "MARKET_DATA_GAP", explanation: "The completed daily candle series contains a gap or duplicate." };
    if (error.code === "MARKET_DATA_STALE") return { quality: "STALE_MARKET_DATA", freshness: "STALE", reason: "MARKET_DATA_STALE", explanation: "The latest completed daily candle does not reach the requested UTC cutoff." };
  }
  return { quality: "INVALID_CANDLES", freshness: "UNAVAILABLE", reason: "INVALID_INDICATORS", explanation: "Validated technical indicators could not be calculated from the supplied candles." };
}

function summarizeEligibleInput(candles: readonly MarketCandle[], cutoff: string) {
  const cutoffMs = Date.parse(cutoff);
  const starts = candles.map((candle) => Date.parse(candle.candleStart))
    .filter((start) => Number.isFinite(start) && start + 86_400_000 <= cutoffMs)
    .sort((left, right) => left - right)
    .slice(-90);
  return {
    latestCandleStart: starts.length === 0 ? null : new Date(starts.at(-1)!).toISOString(),
    inputCount: starts.length,
    inputStart: starts.length === 0 ? null : new Date(starts[0]).toISOString(),
    inputEnd: starts.length === 0 ? null : new Date(starts.at(-1)!).toISOString(),
  };
}

export function analyzeBaselineStrategy(input: {
  product: MarketProduct;
  candles: readonly MarketCandle[];
  ownedQuantity: string;
  cutoff: string;
}): StrategyAnalysis {
  const base = {
    product: input.product,
    strategyId: STRATEGY_ID,
    calculationVersion: INDICATOR_VERSION,
    analysisMode: ANALYSIS_MODE,
    analysisDate: input.cutoff.slice(0, 10),
    cutoff: input.cutoff,
    source: "Coinbase Advanced Trade public API" as const,
    aiStatus: "NOT_REQUESTED" as const,
    riskStatus: "NOT_EVALUATED" as const,
    outcome: "ANALYSIS_ONLY" as const,
    idempotencyKey: `${ANALYSIS_MODE}:${STRATEGY_ID}:${input.product}:${input.cutoff}`,
  };
  let calculated;
  try {
    calculated = calculateTechnicalIndicators(input.candles, input.cutoff);
  } catch (error) {
    const failure = failureMetadata(error);
    const inputSummary = summarizeEligibleInput(input.candles, input.cutoff);
    return {
      ...base,
      latestCandleStart: inputSummary.latestCandleStart,
      signal: "HOLD",
      indicators: null,
      proposedNotional: null,
      proposedQuantity: null,
      explanation: failure.explanation,
      reasonCodes: [failure.reason],
      dataQuality: failure.quality,
      freshness: failure.freshness,
      inputCount: inputSummary.inputCount,
      inputStart: inputSummary.inputStart,
      inputEnd: inputSummary.inputEnd,
    };
  }

  const values = calculated.indicators;
  const decision = decideBaselineCandidate(values, input.ownedQuantity);
  return {
    ...base,
    latestCandleStart: values.latestCandleStart,
    indicators: values,
    dataQuality: "VALID",
    freshness: "CURRENT",
    inputCount: values.inputCount,
    inputStart: values.inputStart,
    inputEnd: values.inputEnd,
    ...decision,
  };
}

export function decideBaselineCandidate(values: TechnicalIndicators, ownedQuantity: string): Pick<
  StrategyAnalysis,
  "signal" | "proposedNotional" | "proposedQuantity" | "explanation" | "reasonCodes"
> {
  const owned = parsePortfolioDecimal(ownedQuantity);
  const close = new Decimal(values.latestClose);
  const sma20 = new Decimal(values.sma20);
  const sma50 = new Decimal(values.sma50);
  const rsi = new Decimal(values.rsi14);
  const sellConditions = close.lt(sma50) && sma20.lt(sma50);
  const buyConditions = close.gt(sma50) && sma20.gt(sma50) && rsi.gte(40) && rsi.lte(65);

  let signal: StrategyAnalysis["signal"] = "HOLD";
  let proposedNotional: string | null = null;
  let proposedQuantity: string | null = null;
  let explanation: string;
  let reasonCodes: StrategyReasonCode[];
  if (sellConditions && owned.gt(0)) {
    signal = "SELL";
    proposedQuantity = owned.times("0.25").toDecimalPlaces(12, Decimal.ROUND_DOWN).toFixed(12);
    explanation = "SELL candidate: the latest close and SMA20 are below SMA50, and the portfolio owns this asset.";
    reasonCodes = ["SELL_CONDITIONS_MET"];
  } else if (buyConditions) {
    signal = "BUY";
    proposedNotional = "25.000000000000";
    explanation = "BUY candidate: the latest close and SMA20 are above SMA50, with RSI14 between 40 and 65 inclusive.";
    reasonCodes = ["BUY_CONDITIONS_MET"];
  } else {
    explanation = "HOLD: the deterministic BUY and executable SELL candidate conditions are not satisfied.";
    reasonCodes = [];
    if (!buyConditions) reasonCodes.push("NO_BUY_CONDITIONS");
    if (!sellConditions) reasonCodes.push("NO_SELL_CONDITIONS");
    if (sellConditions && owned.isZero()) reasonCodes.push("NO_ASSET_HOLDINGS");
  }

  return {
    signal,
    proposedNotional,
    proposedQuantity,
    explanation,
    reasonCodes,
  };
}
