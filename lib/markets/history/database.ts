import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { HistoricalFetch, ProductImportResult } from "@/lib/markets/history/types";

type UpsertCountRow = { imported_count: number; updated_count: number; skipped_count: number };

export async function persistHistoricalFetch(admin: SupabaseClient, history: HistoricalFetch): Promise<ProductImportResult> {
  const payload = history.candles.map((candle) => ({
    product_id: candle.productId,
    granularity: candle.granularity,
    candle_start: candle.candleStart,
    open_price: candle.open,
    high_price: candle.high,
    low_price: candle.low,
    close_price: candle.close,
    volume: candle.volume,
    source: candle.source,
    fetched_at: candle.fetchedAt,
  }));
  let counts: UpsertCountRow = { imported_count: 0, updated_count: 0, skipped_count: 0 };
  if (payload.length > 0) {
    const { data, error } = await admin.rpc("upsert_market_candles", { p_candles: payload });
    if (error || !Array.isArray(data) || data.length !== 1) throw new Error("MARKET_CANDLE_UPSERT_FAILED");
    counts = data[0] as UpsertCountRow;
    if (![counts.imported_count, counts.updated_count, counts.skipped_count].every(Number.isInteger)) {
      throw new Error("MARKET_CANDLE_UPSERT_FAILED");
    }
  }
  return {
    productId: history.productId,
    imported: counts.imported_count,
    updated: counts.updated_count,
    skipped: counts.skipped_count,
    rejected: history.rejected,
    stored: history.candles.length,
    earliest: history.candles.at(0)?.candleStart ?? null,
    latest: history.candles.at(-1)?.candleStart ?? null,
    gaps: history.gaps,
    complete: history.complete,
  };
}
