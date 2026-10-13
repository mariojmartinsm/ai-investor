import "server-only";

import { requireUser } from "@/lib/auth/user";
import { createCoinbaseHistoryAdapter } from "@/lib/markets/history/adapter";
import { executeHistoricalImport } from "@/lib/markets/history/ingest";
import { readStoredCandles } from "@/lib/markets/history/model";
import type { HistoricalImportReport, HistoricalSeries } from "@/lib/markets/history/types";
import { MARKET_PRODUCTS } from "@/lib/markets/types";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const historyAdapter = createCoinbaseHistoryAdapter();

export async function getHistoricalMarkets(): Promise<{ status: "ready" | "empty" | "error"; series: HistoricalSeries[] }> {
  await requireUser();
  try {
    const supabase = await createServerSupabaseClient();
    const now = Date.now();
    const series = await Promise.all(MARKET_PRODUCTS.map(async (productId) => {
      const { data, error } = await supabase.rpc("get_market_candles", { p_product_id: productId, p_limit: 730 });
      if (error) throw error;
      return readStoredCandles(data, productId, now);
    }));
    return { status: series.every((item) => item.candles.length === 0) ? "empty" : "ready", series };
  } catch {
    return { status: "error", series: [] };
  }
}

export async function backfillHistoricalMarkets(): Promise<HistoricalImportReport> {
  const user = await requireUser();
  try {
    return await executeHistoricalImport(user.id, createAdminSupabaseClient(), historyAdapter);
  } catch {
    throw new Error("Unable to refresh historical market data. Please try again.");
  }
}
