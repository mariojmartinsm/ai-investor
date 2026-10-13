import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), get: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/markets/provider", () => ({ getPublicMarketSnapshots: () => Promise.all([mocks.get("BTC-EUR"), mocks.get("ETH-EUR")]) }));

import { getMarketPageData, getMarkets } from "@/lib/markets/server";
import { GET } from "@/app/(private)/markets/data/route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue({ id: "verified-owner" });
  mocks.get.mockImplementation(async (product: string) => ({ product, status: "unavailable", quote: null, error: "TIMEOUT" }));
});

describe("authorized server market reads", () => {
  it("verifies identity before fetching only supported public products", async () => {
    const result = await getMarkets();
    expect(mocks.requireUser).toHaveBeenCalledOnce();
    expect(mocks.get.mock.calls).toEqual([["BTC-EUR"], ["ETH-EUR"]]);
    expect(mocks.requireUser.mock.invocationCallOrder[0]).toBeLessThan(mocks.get.mock.invocationCallOrder[0]);
    expect(result.map((row) => row.product)).toEqual(["BTC-EUR", "ETH-EUR"]);
  });
  it("provides a separate render clock without fabricating quote timestamps", async () => {
    const result = await getMarketPageData();
    expect(Number.isFinite(result.renderedAt)).toBe(true);
    expect(result.markets.every((row) => row.quote === null)).toBe(true);
  });
  it("keeps the polling response private and returns explicit missing prices", async () => {
    const response = await GET();
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
    expect(await response.json()).toEqual([
      { product: "BTC-EUR", status: "unavailable", quote: null, error: "TIMEOUT" },
      { product: "ETH-EUR", status: "unavailable", quote: null, error: "TIMEOUT" },
    ]);
  });
  it.each([getMarkets, GET])("preserves unauthenticated redirects before any Coinbase read", async (operation) => {
    mocks.requireUser.mockImplementation(async () => redirect("/login"));
    await expect(operation()).rejects.toMatchObject({ digest: "NEXT_REDIRECT;replace;/login;307;" });
    expect(mocks.get).not.toHaveBeenCalled();
  });
});
