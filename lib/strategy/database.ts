import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { StrategyAnalysis, StrategyPersistResult } from "@/lib/strategy/types";

export async function persistStrategyPreviews(
  admin: SupabaseClient,
  ownerId: string,
  analyses: StrategyAnalysis[],
): Promise<StrategyPersistResult> {
  const payload = analyses.map((analysis) => ({
    product_id: analysis.product,
    strategy_id: analysis.strategyId,
    calculation_version: analysis.calculationVersion,
    analysis_mode: analysis.analysisMode,
    analysis_date: analysis.analysisDate,
    cutoff: analysis.cutoff,
    latest_candle_start: analysis.latestCandleStart,
    signal: analysis.signal,
    indicators: analysis.indicators,
    proposed_notional: analysis.proposedNotional,
    proposed_quantity: analysis.proposedQuantity,
    explanation: analysis.explanation,
    reason_codes: analysis.reasonCodes,
    data_quality: analysis.dataQuality,
    freshness: analysis.freshness,
    input_count: analysis.inputCount,
    input_start: analysis.inputStart,
    input_end: analysis.inputEnd,
    source: analysis.source,
    ai_status: analysis.aiStatus,
    risk_status: analysis.riskStatus,
    outcome: analysis.outcome,
    idempotency_key: analysis.idempotencyKey,
  }));
  const { data, error } = await admin.rpc("store_strategy_analysis_previews", {
    p_owner_id: ownerId,
    p_records: payload,
  });
  if (error || !Array.isArray(data) || data.length !== 1) throw new Error("STRATEGY_PREVIEW_PERSIST_FAILED");
  const inserted = data[0]?.inserted_count;
  const skipped = data[0]?.skipped_count;
  if (!Number.isInteger(inserted) || !Number.isInteger(skipped) || inserted < 0 || skipped < 0
    || inserted + skipped !== analyses.length) throw new Error("STRATEGY_PREVIEW_PERSIST_FAILED");
  return { inserted, skipped };
}
