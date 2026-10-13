import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(), getSnapshots: vi.fn(), persist: vi.fn(), createAdmin: vi.fn(), ownerRpc: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/markets/provider", () => ({ getPublicMarketSnapshots: mocks.getSnapshots }));
vi.mock("@/lib/markets/reference/database", () => ({ persistFreshReferenceQuotes: mocks.persist }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminSupabaseClient: mocks.createAdmin }));

import { refreshAndLoadReferenceQuotes } from "@/lib/markets/reference/server";

const now = Date.parse("2026-10-13T20:00:30.000Z");
const ownerClient = { rpc: mocks.ownerRpc } as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "verified-owner" });
  mocks.getSnapshots.mockResolvedValue([]);
  mocks.createAdmin.mockReturnValue({ admin: true });
  mocks.persist.mockResolvedValue({ inserted: 0, skipped: 0 });
  mocks.ownerRpc.mockResolvedValue({ data: [], error: null });
});

describe("owner-authorized reference quote refresh", () => {
  it("authenticates before fetching, creating an admin client or persisting", async () => {
    await refreshAndLoadReferenceQuotes(ownerClient, () => now);
    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.requireUser.mock.invocationCallOrder[0]).toBeLessThan(mocks.getSnapshots.mock.invocationCallOrder[0]);
    expect(mocks.requireUser.mock.invocationCallOrder[0]).toBeLessThan(mocks.createAdmin.mock.invocationCallOrder[0]);
    expect(mocks.persist).toHaveBeenCalledWith({ admin: true }, [], now);
  });

  it("performs no provider, privileged or database work for an unauthenticated request", async () => {
    mocks.requireUser.mockRejectedValue(new Error("REDIRECT:/login"));
    await expect(refreshAndLoadReferenceQuotes(ownerClient, () => now)).rejects.toThrow("REDIRECT:/login");
    expect(mocks.getSnapshots).not.toHaveBeenCalled();
    expect(mocks.createAdmin).not.toHaveBeenCalled();
    expect(mocks.ownerRpc).not.toHaveBeenCalled();
  });

  it("uses a previously persisted quote if the provider or insert is unavailable", async () => {
    mocks.getSnapshots.mockRejectedValue(new Error("provider unavailable"));
    mocks.ownerRpc.mockResolvedValue({ data: [], error: null });
    await expect(refreshAndLoadReferenceQuotes(ownerClient, () => now)).resolves.toEqual([
      { product: "BTC-EUR", status: "unavailable", quote: null },
      { product: "ETH-EUR", status: "unavailable", quote: null },
    ]);
    expect(mocks.ownerRpc).toHaveBeenCalledWith("get_latest_market_reference_quotes");
  });

  it("fails closed to unavailable states for malformed or failed persisted reads", async () => {
    mocks.ownerRpc.mockResolvedValue({ data: [{ product_id: "BTC-EUR" }], error: null });
    expect((await refreshAndLoadReferenceQuotes(ownerClient, () => now)).every((row) => row.status === "unavailable")).toBe(true);
    mocks.ownerRpc.mockResolvedValue({ data: null, error: { message: "private provider detail" } });
    expect((await refreshAndLoadReferenceQuotes(ownerClient, () => now)).every((row) => row.status === "unavailable")).toBe(true);
  });
});
