import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getHistory: vi.fn(),
  executeImport: vi.fn(),
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/markets/history/adapter", () => ({ createCoinbaseHistoryAdapter: () => ({ get: mocks.getHistory }) }));
vi.mock("@/lib/markets/history/ingest", () => ({ executeHistoricalImport: mocks.executeImport }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: () => ({ from: mocks.from }) }));

import { backfillHistoricalMarkets, getHistoricalMarkets } from "@/lib/markets/history/server";

function updateChain() {
  const final = Promise.resolve({ error: null });
  return { eq: vi.fn(() => ({ eq: vi.fn(() => final) })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "owner-id" });
  mocks.rpc.mockResolvedValue({ data: [], error: null });
  mocks.from.mockImplementation((table: string) => {
    expect(table).toBe("market_data_import_runs");
    return {
      insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(async () => ({ data: { id: "run-id" }, error: null })) })) })),
      update: vi.fn(() => updateChain()),
    };
  });
  mocks.executeImport.mockResolvedValue({ runId: "run-id", status: "COMPLETED", imported: 0, updated: 0, skipped: 1460, rejected: 0, products: [], completedAt: "2026-10-13T12:00:00.000Z" });
});

describe("owner-authorized historical market services", () => {
  it("authorizes before reading both supported histories", async () => {
    const result = await getHistoricalMarkets();
    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.rpc.mock.calls.map((call) => call[1].p_product_id)).toEqual(["BTC-EUR", "ETH-EUR"]);
    expect(mocks.requireUser.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0]);
    expect(result.status).toBe("empty");
  });

  it("authorizes before any provider or privileged database access and records repeatable counts", async () => {
    const report = await backfillHistoricalMarkets();
    expect(mocks.requireUser.mock.invocationCallOrder[0]).toBeLessThan(mocks.executeImport.mock.invocationCallOrder[0]);
    expect(mocks.executeImport).toHaveBeenCalledWith("owner-id", expect.objectContaining({ from: expect.any(Function) }), expect.objectContaining({ get: expect.any(Function) }));
    expect(report).toMatchObject({ runId: "run-id", imported: 0, updated: 0, skipped: 1460, rejected: 0 });
  });

  it("does not contact Coinbase or the secret client when authentication rejects", async () => {
    mocks.requireUser.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(backfillHistoricalMarkets()).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.executeImport).not.toHaveBeenCalled();
  });

  it("returns a non-disclosing load error when stored history is unavailable", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "private provider detail" } });
    await expect(getHistoricalMarkets()).resolves.toEqual({ status: "error", series: [] });
  });
});
