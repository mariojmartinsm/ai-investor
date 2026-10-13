import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(), createServer: vi.fn(), createAdmin: vi.fn(), rpc: vi.fn(), persist: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServer }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: mocks.createAdmin }));
vi.mock("@/lib/strategy/database", () => ({ persistStrategyPreviews: mocks.persist }));

import { getStrategyPageData, runStrategyAnalysisPreview, utcAnalysisCutoff } from "@/lib/strategy/server";

const owner = "a1111111-1111-4111-8111-111111111111";
const portfolioRow = {
  id: "b1111111-1111-4111-8111-111111111111", owner_id: owner, mode: "DRY_RUN", starting_capital: "500",
  created_at: "2026-10-13T08:00:00Z", eur_balance: "500", btc_balance: "0", eth_balance: "0",
  initial_funding_count: 1, ledger_entry_count: 1,
};
const candleRows = Array.from({ length: 60 }, (_, index) => ({
  product_id: "BTC-EUR", granularity: "ONE_DAY", candle_start: new Date(Date.UTC(2026, 7, 14 + index)).toISOString(),
  open_price: "100", high_price: "101", low_price: "99", close_price: "100", volume: "10",
  source: "Coinbase Advanced Trade public API", fetched_at: "2026-10-13T00:00:00.000Z",
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: owner });
  mocks.createServer.mockResolvedValue({ rpc: mocks.rpc });
  mocks.createAdmin.mockReturnValue({ admin: true });
  mocks.persist.mockResolvedValue({ inserted: 2, skipped: 0 });
  mocks.rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
    if (name === "get_dry_run_portfolio") return Promise.resolve({ data: [portfolioRow], error: null });
    if (name === "get_market_candles") return Promise.resolve({ data: candleRows.map((row) => ({ ...row, product_id: args.p_product_id })), error: null });
    if (name === "get_latest_strategy_analysis_previews") return Promise.resolve({ data: [], error: null });
    throw new Error(`Unexpected RPC ${name}`);
  });
});

describe("owner-authorized strategy preview service", () => {
  it("derives the current UTC cutoff exactly", () => {
    expect(utcAnalysisCutoff(Date.parse("2026-10-13T23:59:59.999Z"))).toBe("2026-10-13T00:00:00.000Z");
  });

  it("reads only the verified owner's latest previews", async () => {
    expect(await getStrategyPageData()).toEqual({ status: "empty", analyses: [] });
    expect(mocks.rpc).toHaveBeenCalledWith("get_latest_strategy_analysis_previews", { p_owner_id: owner });
  });

  it("loads portfolio and two candle series before constructing the privileged client", async () => {
    await expect(runStrategyAnalysisPreview(() => Date.parse("2026-10-13T12:00:00.000Z"))).resolves.toEqual({ inserted: 2, skipped: 0 });
    expect(mocks.rpc).toHaveBeenCalledWith("get_dry_run_portfolio", { p_owner_id: owner });
    expect(mocks.rpc).toHaveBeenCalledWith("get_market_candles", { p_product_id: "BTC-EUR", p_limit: 90 });
    expect(mocks.rpc).toHaveBeenCalledWith("get_market_candles", { p_product_id: "ETH-EUR", p_limit: 90 });
    expect(mocks.persist).toHaveBeenCalledWith({ admin: true }, owner, [
      expect.objectContaining({ product: "BTC-EUR", signal: "HOLD", analysisMode: "PREVIEW_ONLY" }),
      expect.objectContaining({ product: "ETH-EUR", signal: "HOLD", analysisMode: "PREVIEW_ONLY" }),
    ]);
    expect(mocks.createAdmin.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.requireUser.mock.invocationCallOrder[0]);
    expect(mocks.createAdmin.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.rpc.mock.invocationCallOrder.at(-1)!);
  });

  it("never constructs a privileged client for unauthenticated requests", async () => {
    mocks.requireUser.mockRejectedValue(new Error("REDIRECT:/login"));
    await expect(runStrategyAnalysisPreview()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.createServer).not.toHaveBeenCalled();
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it("fails closed without a funded portfolio or complete owner query", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(runStrategyAnalysisPreview()).rejects.toThrow("Unable to run strategy analysis");
    expect(mocks.persist).not.toHaveBeenCalled();
    expect(mocks.createAdmin).not.toHaveBeenCalled();
  });

  it("returns the database idempotency report for a repeated preview", async () => {
    mocks.persist.mockResolvedValue({ inserted: 0, skipped: 2 });
    await expect(runStrategyAnalysisPreview(() => Date.parse("2026-10-13T12:00:00.000Z"))).resolves.toEqual({ inserted: 0, skipped: 2 });
  });
});
