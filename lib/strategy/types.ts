import type { MarketCandle } from "@/lib/markets/history/types";
import type { MarketProduct } from "@/lib/markets/types";

export const STRATEGY_ID = "BASELINE_V1" as const;
export const INDICATOR_VERSION = "TECHNICAL_V1" as const;
export const ANALYSIS_MODE = "PREVIEW_ONLY" as const;
export const ANALYSIS_CANDLE_COUNT = 90;
export const MINIMUM_CANDLE_COUNT = 60;

export type StrategySignal = "BUY" | "SELL" | "HOLD";
export type DataQuality = "VALID" | "INSUFFICIENT_HISTORY" | "MARKET_DATA_GAP" | "INVALID_CANDLES" | "STALE_MARKET_DATA";
export type DataFreshness = "CURRENT" | "STALE" | "UNAVAILABLE";
export type StrategyReasonCode =
  | "BUY_CONDITIONS_MET"
  | "SELL_CONDITIONS_MET"
  | "NO_BUY_CONDITIONS"
  | "NO_SELL_CONDITIONS"
  | "NO_ASSET_HOLDINGS"
  | "INSUFFICIENT_HISTORY"
  | "MARKET_DATA_GAP"
  | "MARKET_DATA_STALE"
  | "INVALID_INDICATORS";

export type TechnicalIndicators = {
  version: typeof INDICATOR_VERSION;
  cutoff: string;
  latestCandleStart: string;
  latestClose: string;
  sma20: string;
  sma50: string;
  rsi14: string;
  momentum7: string;
  momentum30: string;
  volatility30Annualized: string;
  inputCount: number;
  inputStart: string;
  inputEnd: string;
};

export type IndicatorCalculation = {
  indicators: TechnicalIndicators;
  candles: MarketCandle[];
  dataQuality: "VALID";
  freshness: "CURRENT";
};

export type StrategyAnalysis = {
  product: MarketProduct;
  strategyId: typeof STRATEGY_ID;
  calculationVersion: typeof INDICATOR_VERSION;
  analysisMode: typeof ANALYSIS_MODE;
  analysisDate: string;
  cutoff: string;
  latestCandleStart: string | null;
  signal: StrategySignal;
  indicators: TechnicalIndicators | null;
  proposedNotional: string | null;
  proposedQuantity: string | null;
  explanation: string;
  reasonCodes: StrategyReasonCode[];
  dataQuality: DataQuality;
  freshness: DataFreshness;
  inputCount: number;
  inputStart: string | null;
  inputEnd: string | null;
  source: "Coinbase Advanced Trade public API";
  aiStatus: "NOT_REQUESTED";
  riskStatus: "NOT_EVALUATED";
  outcome: "ANALYSIS_ONLY";
  idempotencyKey: string;
};

export type StoredStrategyAnalysis = StrategyAnalysis & {
  id: string;
  ownerId: string;
  portfolioId: string;
  createdAt: string;
};

export type StrategyPageData = {
  status: "empty" | "ready" | "error";
  analyses: StoredStrategyAnalysis[];
};

export type StrategyPersistResult = { inserted: number; skipped: number };
