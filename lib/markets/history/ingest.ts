import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { persistHistoricalFetch } from "@/lib/markets/history/database";
import type { HistoricalFetch, HistoricalImportReport, ProductImportResult } from "@/lib/markets/history/types";
import { MARKET_PRODUCTS } from "@/lib/markets/types";

type HistoryReader = { get(productId: string): Promise<HistoricalFetch> };

export async function executeHistoricalImport(ownerId: string, admin: SupabaseClient, adapter: HistoryReader): Promise<HistoricalImportReport> {
  const { data: run, error: runError } = await admin.from("market_data_import_runs")
    .insert({ owner_id: ownerId, status: "RUNNING" }).select("id").single();
  if (runError || !run?.id) throw new Error("Unable to start historical market refresh");

  const products: ProductImportResult[] = [];
  try {
    for (const productId of MARKET_PRODUCTS) products.push(await persistHistoricalFetch(admin, await adapter.get(productId)));
    const totals = products.reduce((total, product) => ({
      imported: total.imported + product.imported,
      updated: total.updated + product.updated,
      skipped: total.skipped + product.skipped,
      rejected: total.rejected + product.rejected,
    }), { imported: 0, updated: 0, skipped: 0, rejected: 0 });
    const completedAt = new Date().toISOString();
    const { error } = await admin.from("market_data_import_runs").update({
      status: "COMPLETED",
      completed_at: completedAt,
      imported_count: totals.imported,
      updated_count: totals.updated,
      skipped_count: totals.skipped,
      rejected_count: totals.rejected,
      results: { products },
    }).eq("id", run.id).eq("owner_id", ownerId);
    if (error) throw new Error("Unable to finalize historical market refresh");
    return { runId: run.id, status: "COMPLETED", ...totals, products, completedAt };
  } catch (error) {
    const partial = products.reduce((total, product) => ({
      imported: total.imported + product.imported,
      updated: total.updated + product.updated,
      skipped: total.skipped + product.skipped,
      rejected: total.rejected + product.rejected,
    }), { imported: 0, updated: 0, skipped: 0, rejected: 0 });
    await admin.from("market_data_import_runs").update({
      status: "FAILED",
      completed_at: new Date().toISOString(),
      imported_count: partial.imported,
      updated_count: partial.updated,
      skipped_count: partial.skipped,
      rejected_count: partial.rejected,
      results: { products },
      error_code: error instanceof Error && /^([A-Z_]+)$/.test(error.message) ? error.message : "HISTORICAL_REFRESH_FAILED",
    }).eq("id", run.id).eq("owner_id", ownerId);
    throw error;
  }
}
