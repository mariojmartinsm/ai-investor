import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { persistFreshReferenceQuotes } from "@/lib/markets/reference/database";
import { readReferenceQuotes } from "@/lib/markets/reference/model";
import type { MarketSnapshot } from "@/lib/markets/types";

const now = Date.parse("2026-10-13T20:00:30.000Z");
const row = (change: Record<string, unknown> = {}) => ({
  id: "a1111111-1111-4111-8111-111111111111",
  product_id: "BTC-EUR",
  price: "74244.812345678901234567",
  price_kind: "last_trade",
  bid: "74240.41",
  ask: "74247.84",
  execution_reference_kind: "public_bid_ask",
  source: "Coinbase Advanced Trade public API",
  exchange_at: "2026-10-13T20:00:00.000Z",
  fetched_at: "2026-10-13T20:00:01.000Z",
  fresh_until: "2026-10-13T20:02:00.000Z",
  validation_status: "validated",
  freshness_status: "fresh",
  ...change,
});

function snapshot(change: Partial<MarketSnapshot> = {}): MarketSnapshot {
  return {
    product: "BTC-EUR",
    status: "fresh",
    error: null,
    quote: {
      product: "BTC-EUR", price: "74244.812345678901234567", priceKind: "last_trade",
      change24h: null, volume24h: null, bid: "74240.41", ask: "74247.84",
      source: "Coinbase Advanced Trade public API", fetchedAt: "2026-10-13T20:00:01.000Z",
      exchangeAt: "2026-10-13T20:00:00.000Z",
    },
    ...change,
  };
}

describe("persisted reference quote boundary", () => {
  it("preserves price, public bid/ask classification, source and timestamps", () => {
    expect(readReferenceQuotes([row()], now)).toEqual([
      { product: "BTC-EUR", status: "fresh", quote: {
        id: "a1111111-1111-4111-8111-111111111111", product: "BTC-EUR",
        price: "74244.812345678901234567", priceKind: "last_trade", bid: "74240.41", ask: "74247.84",
        executionReferenceKind: "public_bid_ask", source: "Coinbase Advanced Trade public API",
        exchangeAt: "2026-10-13T20:00:00.000Z", fetchedAt: "2026-10-13T20:00:01.000Z",
        freshUntil: "2026-10-13T20:02:00.000Z", validationStatus: "validated",
      } },
      { product: "ETH-EUR", status: "unavailable", quote: null },
    ]);
  });

  it("preserves an indicative proxy without inventing a spread or exchange time", () => {
    const result = readReferenceQuotes([row({
      price_kind: "reference", bid: null, ask: null, execution_reference_kind: "indicative_reference",
      exchange_at: null, fresh_until: "2026-10-13T20:02:01.000Z",
    })], now)[0];
    expect(result.quote).toMatchObject({ priceKind: "reference", bid: null, ask: null, executionReferenceKind: "indicative_reference", exchangeAt: null });
  });

  it("downgrades an expired app-clock quote even if the database response claimed fresh", () => {
    expect(readReferenceQuotes([row()], Date.parse("2026-10-13T20:02:00.000Z"))[0].status).toBe("stale");
  });

  it.each([
    { price: "0" }, { price: "NaN" }, { bid: "75000", ask: "74000" },
    { execution_reference_kind: "public_bid_ask", ask: null },
    { execution_reference_kind: "indicative_reference" },
    { price_kind: "reference" },
    { fetched_at: "2026-02-30T20:00:01.000Z" },
    { fresh_until: "2026-10-13T20:03:00.000Z" },
    { exchange_at: "2026-10-13T20:00:07.000Z", fresh_until: "2026-10-13T20:02:01.000Z" },
    { validation_status: "unvalidated" }, { freshness_status: "unknown" },
    { source: "Unknown" }, { product_id: "SOL-EUR" },
  ])("rejects malformed, inconsistent or future reference data %#", (change) => {
    expect(() => readReferenceQuotes([row(change)], now)).toThrow();
  });

  it("rejects duplicate product rows", () => {
    expect(() => readReferenceQuotes([row(), row({ id: "b1111111-1111-4111-8111-111111111111" })], now)).toThrow("Duplicate");
  });
});

describe("server-only reference persistence", () => {
  const rpc = vi.fn();
  const admin = { rpc } as never;
  beforeEach(() => { vi.clearAllMocks(); rpc.mockResolvedValue({ data: [{ inserted_count: 1, skipped_count: 0 }], error: null }); });

  it("sends only validated fresh quote fields and reports insert counts", async () => {
    await expect(persistFreshReferenceQuotes(admin, [snapshot()], now)).resolves.toEqual({ inserted: 1, skipped: 0 });
    expect(rpc).toHaveBeenCalledWith("store_market_reference_quotes", { p_quotes: [{
      product_id: "BTC-EUR", price: "74244.812345678901234567", price_kind: "last_trade",
      bid: "74240.41", ask: "74247.84", source: "Coinbase Advanced Trade public API",
      exchange_at: "2026-10-13T20:00:00.000Z", fetched_at: "2026-10-13T20:00:01.000Z",
    }] });
  });

  it.each([
    snapshot({ status: "stale" }), snapshot({ status: "unavailable", quote: null }),
    snapshot({ quote: { ...snapshot().quote!, fetchedAt: "2026-10-13T19:58:30.000Z", exchangeAt: "2026-10-13T19:58:30.000Z" } }),
  ])("does not persist stale or unavailable data %#", async (value) => {
    expect(await persistFreshReferenceQuotes(admin, [value], now)).toEqual({ inserted: 0, skipped: 0 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed database reports", async () => {
    rpc.mockResolvedValue({ data: [{ inserted_count: 2, skipped_count: 0 }], error: null });
    await expect(persistFreshReferenceQuotes(admin, [snapshot()], now)).rejects.toThrow("REFERENCE_QUOTE_PERSIST_FAILED");
  });
});
