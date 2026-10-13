import type { MarketError, MarketProduct } from "@/lib/markets/types";

export const DAILY_GRANULARITY = "ONE_DAY" as const;
export const DAILY_SECONDS = 86_400;
export const HISTORY_DAYS = 730;
export const HISTORY_PAGE_LIMIT = 350;

export type MarketCandle = {
  productId: MarketProduct;
  granularity: typeof DAILY_GRANULARITY;
  candleStart: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  source: "Coinbase Advanced Trade public API";
  fetchedAt: string;
};

export type HistoricalFetch = {
  productId: MarketProduct;
  candles: MarketCandle[];
  rejected: number;
  gaps: string[];
  complete: boolean;
  expectedStart: string;
  expectedEnd: string;
  requestCount: number;
};

export class HistoricalMarketError extends Error {
  constructor(readonly code: MarketError) {
    super(code);
  }
}

export type ProductImportResult = {
  productId: MarketProduct;
  imported: number;
  updated: number;
  skipped: number;
  rejected: number;
  stored: number;
  earliest: string | null;
  latest: string | null;
  gaps: string[];
  complete: boolean;
};

export type HistoricalImportReport = {
  runId: string;
  status: "COMPLETED";
  imported: number;
  updated: number;
  skipped: number;
  rejected: number;
  products: ProductImportResult[];
  completedAt: string;
};

export type HistoricalSeries = {
  productId: MarketProduct;
  candles: MarketCandle[];
  gaps: string[];
  complete: boolean;
  latestFetchedAt: string | null;
};
