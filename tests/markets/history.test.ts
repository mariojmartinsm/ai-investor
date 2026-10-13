import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createCoinbaseHistoryAdapter } from "@/lib/markets/history/adapter";
import { readCoinbaseCandle, readCoinbaseCandlePage } from "@/lib/markets/history/schema";
import { DAILY_SECONDS, HISTORY_DAYS, HistoricalMarketError } from "@/lib/markets/history/types";

const todayStart = Date.UTC(2026, 9, 13) / 1_000;
const now = () => todayStart * 1_000 + 12 * 60 * 60 * 1_000;

function raw(start: number, overrides: Record<string, unknown> = {}) {
  return { start: String(start), open: "100.123456789012345678", high: "110", low: "90", close: "105", volume: "12.5", ...overrides };
}

function fixtureFetcher(transform?: (candles: unknown[], url: URL) => unknown) {
  const urls: URL[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    urls.push(url);
    const start = Number(url.searchParams.get("start"));
    const end = Number(url.searchParams.get("end"));
    const candles: unknown[] = [];
    for (let candleStart = start; candleStart <= end; candleStart += DAILY_SECONDS) candles.push(raw(candleStart));
    return Response.json(transform ? transform(candles, url) : { candles: candles.reverse() });
  };
  return { fetcher, urls };
}

describe("Coinbase daily candle schema", () => {
  it.each(["BTC-EUR", "ETH-EUR"] as const)("parses precise valid %s OHLCV", (productId) => {
    const candle = readCoinbaseCandle(raw(todayStart - DAILY_SECONDS), productId, "2026-10-13T12:00:00.000Z", todayStart - 2 * DAILY_SECONDS, todayStart);
    expect(candle).toMatchObject({ productId, open: "100.123456789012345678", high: "110", low: "90", close: "105", volume: "12.5" });
  });

  it.each([
    { open: "0" }, { high: "-1" }, { low: "NaN" }, { close: "1e2" }, { volume: "-0.1" },
    { low: "101", open: "100" }, { high: "104", close: "105" }, { start: String(todayStart - 1) },
  ])("rejects malformed amount, OHLC or UTC alignment %#", (override) => {
    expect(() => readCoinbaseCandle(raw(todayStart - DAILY_SECONDS, override), "BTC-EUR", "2026-10-13T12:00:00.000Z", todayStart - 2 * DAILY_SECONDS, todayStart)).toThrow();
  });

  it("rejects the incomplete current UTC day and counts invalid members", () => {
    const page = readCoinbaseCandlePage({ candles: [raw(todayStart - DAILY_SECONDS), raw(todayStart), raw(todayStart - 2 * DAILY_SECONDS, { close: "0" })] }, "ETH-EUR", "2026-10-13T12:00:00.000Z", todayStart - 2 * DAILY_SECONDS, todayStart);
    expect(page.candles).toHaveLength(1);
    expect(page.rejected).toBe(2);
  });
});

describe("historical pagination and completeness", () => {
  it.each(["BTC-EUR", "ETH-EUR"] as const)("loads, sorts and validates 730 completed %s days across three bounded requests", async (productId) => {
    const fixture = fixtureFetcher();
    const result = await createCoinbaseHistoryAdapter({ fetcher: fixture.fetcher, now }).get(productId);
    expect(result.candles).toHaveLength(HISTORY_DAYS);
    expect(result.requestCount).toBe(3);
    expect(result.complete).toBe(true);
    expect(result.gaps).toEqual([]);
    expect(result.candles[0].candleStart).toBe(new Date((todayStart - HISTORY_DAYS * DAILY_SECONDS) * 1_000).toISOString());
    expect(result.candles.at(-1)?.candleStart).toBe(new Date((todayStart - DAILY_SECONDS) * 1_000).toISOString());
    expect(fixture.urls.map((url) => url.searchParams.get("limit"))).toEqual(["350", "350", "30"]);
    expect(fixture.urls.every((url) => url.pathname === `/api/v3/brokerage/market/products/${productId}/candles` && url.searchParams.get("granularity") === "ONE_DAY")).toBe(true);
  });

  it("detects duplicate and missing days instead of choosing or interpolating values", async () => {
    let changed = false;
    const fixture = fixtureFetcher((candles) => {
      if (!changed) {
        changed = true;
        return { candles: [...candles.slice(1), candles[1]] };
      }
      return { candles };
    });
    const result = await createCoinbaseHistoryAdapter({ fetcher: fixture.fetcher, now }).get("BTC-EUR");
    expect(result.complete).toBe(false);
    expect(result.rejected).toBe(2);
    expect(result.gaps).toHaveLength(2);
    expect(result.candles).toHaveLength(728);
  });

  it("rejects unsupported products before any network request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createCoinbaseHistoryAdapter({ fetcher, now }).get("SOL-EUR")).rejects.toThrow("Unsupported market product");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports bounded timeout and rate-limit failures without partial success", async () => {
    vi.useFakeTimers();
    try {
      const timeout = createCoinbaseHistoryAdapter({ fetcher: () => new Promise(() => {}), now, timeoutMs: 10, sleep: async () => {} });
      const timeoutPromise = timeout.get("BTC-EUR");
      const timeoutAssertion = expect(timeoutPromise).rejects.toMatchObject<Partial<HistoricalMarketError>>({ code: "TIMEOUT" });
      await vi.advanceTimersByTimeAsync(31);
      await timeoutAssertion;
      const limited = createCoinbaseHistoryAdapter({ fetcher: async () => new Response("", { status: 429, headers: { "Retry-After": "30" } }), now });
      await expect(limited.get("ETH-EUR")).rejects.toMatchObject<Partial<HistoricalMarketError>>({ code: "RATE_LIMITED" });
    } finally {
      vi.useRealTimers();
    }
  });
});
