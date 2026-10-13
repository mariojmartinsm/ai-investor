import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { persistStrategyPreviews } from "@/lib/strategy/database";
import { readStoredStrategyAnalyses } from "@/lib/strategy/model";
import type { StrategyAnalysis } from "@/lib/strategy/types";

const owner = "a1111111-1111-4111-8111-111111111111";
const portfolio = "b1111111-1111-4111-8111-111111111111";
const indicators = {
  version: "TECHNICAL_V1", cutoff: "2026-10-13T00:00:00.000Z", latestCandleStart: "2026-10-12T00:00:00.000Z",
  latestClose: "65000.000000000000", sma20: "64000.000000000000", sma50: "63000.000000000000",
  rsi14: "55.00000000", momentum7: "2.00000000", momentum30: "5.00000000", volatility30Annualized: "30.00000000",
  inputCount: 90, inputStart: "2026-07-15T00:00:00.000Z", inputEnd: "2026-10-12T00:00:00.000Z",
} as const;
const analysis: StrategyAnalysis = {
  product: "BTC-EUR", strategyId: "BASELINE_V1", calculationVersion: "TECHNICAL_V1", analysisMode: "PREVIEW_ONLY",
  analysisDate: "2026-10-13", cutoff: "2026-10-13T00:00:00.000Z", latestCandleStart: "2026-10-12T00:00:00.000Z",
  signal: "BUY", indicators, proposedNotional: "25.000000000000", proposedQuantity: null,
  explanation: "BUY candidate", reasonCodes: ["BUY_CONDITIONS_MET"], dataQuality: "VALID", freshness: "CURRENT",
  inputCount: 90, inputStart: "2026-07-15T00:00:00.000Z", inputEnd: "2026-10-12T00:00:00.000Z",
  source: "Coinbase Advanced Trade public API", aiStatus: "NOT_REQUESTED", riskStatus: "NOT_EVALUATED", outcome: "ANALYSIS_ONLY",
  idempotencyKey: "PREVIEW_ONLY:BASELINE_V1:BTC-EUR:2026-10-13T00:00:00.000Z",
};
const row = (change: Record<string, unknown> = {}) => ({
  id: "c1111111-1111-4111-8111-111111111111", owner_id: owner, portfolio_id: portfolio,
  product_id: analysis.product, strategy_id: analysis.strategyId, calculation_version: analysis.calculationVersion,
  analysis_mode: analysis.analysisMode, analysis_date: analysis.analysisDate, cutoff: analysis.cutoff,
  latest_candle_start: analysis.latestCandleStart, signal: analysis.signal, indicators: analysis.indicators,
  proposed_notional: analysis.proposedNotional, proposed_quantity: analysis.proposedQuantity,
  explanation: analysis.explanation, reason_codes: analysis.reasonCodes, data_quality: analysis.dataQuality,
  freshness: analysis.freshness, input_count: analysis.inputCount, input_start: analysis.inputStart,
  input_end: analysis.inputEnd, source: analysis.source, outcome: "ANALYSIS_ONLY",
  ai_status: "NOT_REQUESTED", risk_status: "NOT_EVALUATED",
  idempotency_key: analysis.idempotencyKey, created_at: "2026-10-13T00:01:00.000Z", ...change,
});

describe("strategy analysis database boundary", () => {
  it("parses decimal strings, audit metadata and owner identity", () => {
    expect(readStoredStrategyAnalyses([row()], owner)[0]).toEqual({
      id: "c1111111-1111-4111-8111-111111111111", ownerId: owner, portfolioId: portfolio,
      ...analysis, createdAt: "2026-10-13T00:01:00.000Z",
    });
  });

  it.each([
    { owner_id: "another" }, { strategy_id: "BASELINE_V2" }, { outcome: "EXECUTED" },
    { proposed_notional: null }, { proposed_quantity: "1" }, { indicators: { ...indicators, rsi14: "NaN" } },
    { reason_codes: [] }, { data_quality: "VALID", indicators: null },
  ])("rejects malformed stored rows %#", (change) => {
    expect(() => readStoredStrategyAnalyses([row(change)], owner)).toThrow();
  });

  it("rejects duplicate products", () => {
    expect(() => readStoredStrategyAnalyses([row(), row({ id: "d1111111-1111-4111-8111-111111111111" })], owner)).toThrow("Duplicate");
  });

  const rpc = vi.fn();
  const admin = { rpc } as never;
  beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: [{ inserted_count: 1, skipped_count: 0 }], error: null }); });

  it("persists only preview audit fields through the server RPC", async () => {
    await expect(persistStrategyPreviews(admin, owner, [analysis])).resolves.toEqual({ inserted: 1, skipped: 0 });
    expect(rpc).toHaveBeenCalledWith("store_strategy_analysis_previews", { p_owner_id: owner, p_records: [expect.objectContaining({
      product_id: "BTC-EUR", strategy_id: "BASELINE_V1", analysis_mode: "PREVIEW_ONLY", signal: "BUY",
      proposed_notional: "25.000000000000", ai_status: "NOT_REQUESTED", risk_status: "NOT_EVALUATED",
      outcome: "ANALYSIS_ONLY", idempotency_key: analysis.idempotencyKey,
    })] });
  });

  it("rejects malformed persistence counts", async () => {
    rpc.mockResolvedValue({ data: [{ inserted_count: 2, skipped_count: 0 }], error: null });
    await expect(persistStrategyPreviews(admin, owner, [analysis])).rejects.toThrow("STRATEGY_PREVIEW_PERSIST_FAILED");
  });
});
