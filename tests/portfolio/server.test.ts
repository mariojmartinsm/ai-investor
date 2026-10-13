import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), rpc: vi.fn(), createServerSupabaseClient: vi.fn(), refreshQuotes: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));
vi.mock("@/lib/markets/reference/server", () => ({ refreshAndLoadReferenceQuotes: mocks.refreshQuotes }));

import { getDashboardPortfolio, initializePortfolio } from "@/lib/portfolio/server";

const ownerId = "a1111111-1111-4111-8111-111111111111";
const row = {
  id: "b1111111-1111-4111-8111-111111111111", owner_id: ownerId, mode: "DRY_RUN",
  starting_capital: "500", created_at: "2026-10-13T08:00:00Z",
  eur_balance: "500", btc_balance: "0", eth_balance: "0", initial_funding_count: 1, ledger_entry_count: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: ownerId });
  mocks.createServerSupabaseClient.mockResolvedValue({ rpc: mocks.rpc });
  mocks.rpc.mockResolvedValue({ data: [row], error: null });
  mocks.refreshQuotes.mockResolvedValue([
    { product: "BTC-EUR", status: "unavailable", quote: null },
    { product: "ETH-EUR", status: "unavailable", quote: null },
  ]);
});

describe("independently authorized portfolio reads", () => {
  it("requests only the verified owner's snapshot without initializing during a read", async () => {
    expect(await getDashboardPortfolio()).toMatchObject({ status: "ready", portfolio: { eurBalance: "500.000000000000" } });
    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.createServerSupabaseClient).toHaveBeenCalledWith();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("get_dry_run_portfolio", { p_owner_id: ownerId });
    expect(mocks.refreshQuotes).toHaveBeenCalledOnce();
    expect(mocks.requireUser.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0]);
  });

  it("shows the empty state only for a successful empty database result", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(await getDashboardPortfolio()).toEqual({ status: "empty" });
    expect(mocks.refreshQuotes).not.toHaveBeenCalled();
  });

  it("allows setup when an existing foundation portfolio has no ledger history", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ ...row, eur_balance: "0", initial_funding_count: 0, ledger_entry_count: 0 }], error: null });
    expect(await getDashboardPortfolio()).toEqual({ status: "empty" });
    expect(mocks.refreshQuotes).not.toHaveBeenCalled();
  });

  it.each([
    { data: null, error: { message: "sensitive SQL/provider detail" } },
    { data: null, error: null },
    { data: [{ ...row, owner_id: "another-owner" }], error: null },
    { data: [{ ...row, initial_funding_count: 0 }], error: null },
  ])("reports failure rather than a false balance or empty state %#", async (result) => {
    mocks.rpc.mockResolvedValue(result);
    expect(await getDashboardPortfolio()).toEqual({ status: "error" });
  });

  it("handles a database outage without exposing its details", async () => {
    mocks.rpc.mockRejectedValue(new Error("provider-secret"));
    expect(await getDashboardPortfolio()).toEqual({ status: "error" });
  });

  it("preserves the unauthenticated redirect before any private query", async () => {
    mocks.requireUser.mockRejectedValue(new Error("REDIRECT:/login"));
    await expect(getDashboardPortfolio()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("restricted initialization operation", () => {
  it("uses the cookie client with the verified owner and no client-selected amount or mode", async () => {
    await expect(initializePortfolio()).resolves.toBeUndefined();
    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.createServerSupabaseClient).toHaveBeenCalledWith({ writeCookies: true });
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("initialize_dry_run_portfolio", { p_owner_id: ownerId });
    expect(mocks.requireUser.mock.invocationCallOrder[0]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0]);
  });

  it("denies unauthenticated direct calls independently of route redirects", async () => {
    mocks.requireUser.mockRejectedValue(new Error("REDIRECT:/login"));
    await expect(initializePortfolio()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    { data: null, error: { message: "sensitive SQL/provider detail" } },
    { data: [], error: null },
    { data: [{ ...row, owner_id: "another-owner" }], error: null },
    { data: [{ ...row, eur_balance: "1000" }], error: null },
  ])("never reports success for missing or unreconciled funding %#", async (result) => {
    mocks.rpc.mockResolvedValue(result);
    await expect(initializePortfolio()).rejects.toThrow("Unable to initialize your portfolio. Please try again.");
  });

  it("does not leak thrown provider details from initialization", async () => {
    mocks.rpc.mockRejectedValue(new Error("provider-secret"));
    await expect(initializePortfolio()).rejects.toThrow("Unable to initialize your portfolio. Please try again.");
  });
});
