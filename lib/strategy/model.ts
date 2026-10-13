import { MARKET_PRODUCTS, type MarketProduct } from "@/lib/markets/types";
import { marketDecimal } from "@/lib/markets/format";
import {
  ANALYSIS_MODE,
  INDICATOR_VERSION,
  STRATEGY_ID,
  type DataFreshness,
  type DataQuality,
  type StoredStrategyAnalysis,
  type StrategyReasonCode,
  type StrategySignal,
  type TechnicalIndicators,
} from "@/lib/strategy/types";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const products = new Set<string>(MARKET_PRODUCTS);
const signals = new Set<StrategySignal>(["BUY", "SELL", "HOLD"]);
const qualities = new Set<DataQuality>(["VALID", "INSUFFICIENT_HISTORY", "MARKET_DATA_GAP", "INVALID_CANDLES", "STALE_MARKET_DATA"]);
const freshnessValues = new Set<DataFreshness>(["CURRENT", "STALE", "UNAVAILABLE"]);
const reasons = new Set<StrategyReasonCode>([
  "BUY_CONDITIONS_MET", "SELL_CONDITIONS_MET", "NO_BUY_CONDITIONS",
  "NO_SELL_CONDITIONS", "NO_ASSET_HOLDINGS", "INSUFFICIENT_HISTORY",
  "MARKET_DATA_GAP", "MARKET_DATA_STALE", "INVALID_INDICATORS",
]);

function nullableDecimal(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !marketDecimal(value).gt(0)) throw new Error("Invalid strategy proposal");
  return value;
}

function readIndicators(value: unknown): TechnicalIndicators | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid strategy indicators");
  const row = value as Record<string, unknown>;
  if (row.version !== INDICATOR_VERSION || !timestamp(row.cutoff) || !timestamp(row.latestCandleStart)
    || !timestamp(row.inputStart) || !timestamp(row.inputEnd)
    || typeof row.inputCount !== "number" || !Number.isInteger(row.inputCount)
    || row.inputCount < 60 || row.inputCount > 90) throw new Error("Invalid strategy indicator metadata");
  for (const key of ["latestClose", "sma20", "sma50", "rsi14", "momentum7", "momentum30", "volatility30Annualized"] as const) {
    if (typeof row[key] !== "string" || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(row[key])) throw new Error("Invalid strategy indicator value");
  }
  if (!marketDecimal(row.latestClose as string).gt(0) || !marketDecimal(row.sma20 as string).gt(0)
    || !marketDecimal(row.sma50 as string).gt(0)) throw new Error("Invalid strategy price indicator");
  return row as unknown as TechnicalIndicators;
}

export function readStoredStrategyAnalyses(value: unknown, ownerId: string): StoredStrategyAnalysis[] {
  if (!Array.isArray(value) || value.length > MARKET_PRODUCTS.length) throw new Error("Invalid strategy response");
  const parsed = value.map((candidate): StoredStrategyAnalysis => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("Invalid strategy row");
    const row = candidate as Record<string, unknown>;
    if (typeof row.id !== "string" || !uuid.test(row.id)
      || row.owner_id !== ownerId || typeof row.portfolio_id !== "string" || !uuid.test(row.portfolio_id)
      || typeof row.product_id !== "string" || !products.has(row.product_id)
      || row.strategy_id !== STRATEGY_ID || row.calculation_version !== INDICATOR_VERSION
      || row.analysis_mode !== ANALYSIS_MODE || row.outcome !== "ANALYSIS_ONLY"
      || typeof row.analysis_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.analysis_date)
      || !timestamp(row.cutoff) || (row.latest_candle_start !== null && !timestamp(row.latest_candle_start))
      || typeof row.signal !== "string" || !signals.has(row.signal as StrategySignal)
      || typeof row.explanation !== "string" || row.explanation.length < 1
      || !Array.isArray(row.reason_codes) || row.reason_codes.length < 1
      || !row.reason_codes.every((reason) => typeof reason === "string" && reasons.has(reason as StrategyReasonCode))
      || typeof row.data_quality !== "string" || !qualities.has(row.data_quality as DataQuality)
      || typeof row.freshness !== "string" || !freshnessValues.has(row.freshness as DataFreshness)
      || typeof row.input_count !== "number" || !Number.isInteger(row.input_count)
      || (row.input_start !== null && !timestamp(row.input_start)) || (row.input_end !== null && !timestamp(row.input_end))
      || row.source !== "Coinbase Advanced Trade public API"
      || row.ai_status !== "NOT_REQUESTED" || row.risk_status !== "NOT_EVALUATED"
      || typeof row.idempotency_key !== "string" || !timestamp(row.created_at)) throw new Error("Invalid strategy identity");
    const indicators = readIndicators(row.indicators);
    const proposedNotional = nullableDecimal(row.proposed_notional);
    const proposedQuantity = nullableDecimal(row.proposed_quantity);
    const signal = row.signal as StrategySignal;
    if ((signal === "BUY" && (proposedNotional === null || proposedQuantity !== null))
      || (signal === "SELL" && (proposedQuantity === null || proposedNotional !== null))
      || (signal === "HOLD" && (proposedNotional !== null || proposedQuantity !== null))
      || (row.data_quality === "VALID" ? indicators === null : indicators !== null)) throw new Error("Invalid strategy outcome");
    return {
      id: row.id,
      ownerId,
      portfolioId: row.portfolio_id,
      product: row.product_id as MarketProduct,
      strategyId: STRATEGY_ID,
      calculationVersion: INDICATOR_VERSION,
      analysisMode: ANALYSIS_MODE,
      analysisDate: row.analysis_date,
      cutoff: row.cutoff,
      latestCandleStart: row.latest_candle_start as string | null,
      signal,
      indicators,
      proposedNotional,
      proposedQuantity,
      explanation: row.explanation,
      reasonCodes: row.reason_codes as StrategyReasonCode[],
      dataQuality: row.data_quality as DataQuality,
      freshness: row.freshness as DataFreshness,
      inputCount: row.input_count,
      inputStart: row.input_start as string | null,
      inputEnd: row.input_end as string | null,
      source: "Coinbase Advanced Trade public API",
      aiStatus: "NOT_REQUESTED",
      riskStatus: "NOT_EVALUATED",
      outcome: "ANALYSIS_ONLY",
      idempotencyKey: row.idempotency_key,
      createdAt: row.created_at,
    };
  });
  if (new Set(parsed.map((analysis) => analysis.product)).size !== parsed.length) throw new Error("Duplicate strategy product");
  return parsed.sort((left, right) => MARKET_PRODUCTS.indexOf(left.product) - MARKET_PRODUCTS.indexOf(right.product));
}
