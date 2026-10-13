import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createCoinbaseMarketAdapter } from "@/lib/markets/adapter";
import { MARKET_POLL_MS, MARKET_STALE_MS, type MarketProduct } from "@/lib/markets/types";

const clock = Date.parse("2026-10-13T19:40:00.000Z");

function product(pair: MarketProduct = "BTC-EUR") {
  return {
    product_id: pair,
    price: pair === "BTC-EUR" ? "74244.8" : "2347.31",
    price_percentage_change_24h: "0.19754807187522",
    volume_24h: "175.7481723",
    best_bid_price: "",
    best_ask_price: "",
  };
}

function ticker(pair: MarketProduct = "BTC-EUR", time = new Date(clock - 2_000).toISOString()) {
  const price = product(pair).price;
  return { trades: [{ product_id: pair, price, time }], best_bid: pair === "BTC-EUR" ? "74240.41" : "2347.3", best_ask: pair === "BTC-EUR" ? "74247.84" : "2347.32" };
}

function json(value: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function validFetcher() {
  return vi.fn<typeof fetch>(async (input) => {
    const url = String(input);
    const pair = url.includes("ETH-EUR") ? "ETH-EUR" : "BTC-EUR";
    return json(url.includes("/ticker?") ? ticker(pair) : product(pair));
  });
}

afterEach(() => vi.useRealTimers());

describe("public Coinbase adapter", () => {
  it.each(["BTC-EUR", "ETH-EUR"] as const)("loads %s last trade, statistics, spread and provenance", async (pair) => {
    const fetcher = validFetcher();
    const snapshot = await createCoinbaseMarketAdapter({ fetcher, now: () => clock }).get(pair);
    expect(snapshot).toEqual({
      product: pair,
      status: "fresh",
      error: null,
      quote: {
        product: pair, price: product(pair).price, priceKind: "last_trade", change24h: "0.19754807187522", volume24h: "175.7481723",
        bid: ticker(pair).best_bid, ask: ticker(pair).best_ask, source: "Coinbase Advanced Trade public API",
        fetchedAt: new Date(clock).toISOString(), exchangeAt: new Date(clock - 2_000).toISOString(),
      },
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      `https://api.coinbase.com/api/v3/brokerage/market/products/${pair}`,
      `https://api.coinbase.com/api/v3/brokerage/market/products/${pair}/ticker?limit=1`,
    ]);
    for (const [, options] of fetcher.mock.calls) {
      expect(options).toMatchObject({ method: "GET", credentials: "omit", redirect: "error", cache: "no-store" });
      expect(new Headers(options?.headers).has("Authorization")).toBe(false);
    }
  });

  it.each(["BTC-USD", "ETH-USD", "DOGE-EUR", "btc-eur", "", "BTC-EUR/../../accounts"])("rejects unsupported product %s before any fetch", async (pair) => {
    const fetcher = validFetcher();
    await expect(createCoinbaseMarketAdapter({ fetcher }).get(pair)).rejects.toThrow("Unsupported");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("selects the latest confirmed trade even if response order changes", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => json(String(url).includes("/ticker?") ? {
      ...ticker(), trades: [
        { ...ticker().trades[0], time: new Date(clock - 3_000).toISOString(), price: "74100" },
        { ...ticker().trades[0], time: new Date(clock - 1_000).toISOString(), price: "74200" },
      ],
    } : product()));
    expect((await createCoinbaseMarketAdapter({ fetcher, now: () => clock }).get("BTC-EUR")).quote)
      .toMatchObject({ price: "74200", exchangeAt: new Date(clock - 1_000).toISOString() });
  });

  it("uses a validated reference when the ticker is unavailable, without inventing exchange time", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => String(url).includes("/ticker?") ? json({}, 503) : json(product()));
    const sleep = vi.fn(async () => {});
    const result = await createCoinbaseMarketAdapter({ fetcher, sleep, now: () => clock }).get("BTC-EUR");
    expect(result.status).toBe("fresh");
    expect(result.quote).toMatchObject({ price: "74244.8", priceKind: "reference", exchangeAt: null, bid: null, ask: null });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("uses reference price for empty trades and available product book", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => json(String(url).includes("/ticker?")
      ? { trades: [] } : { ...product(), best_bid_price: "74240", best_ask_price: "74250" }));
    expect((await createCoinbaseMarketAdapter({ fetcher, now: () => clock }).get("BTC-EUR")).quote)
      .toMatchObject({ priceKind: "reference", exchangeAt: null, bid: "74240", ask: "74250" });
  });

  it("uses a valid ticker if product details are transport-unavailable with optional stats null", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => String(url).includes("/ticker?") ? json(ticker()) : json({}, 502));
    const result = await createCoinbaseMarketAdapter({ fetcher, sleep: async () => {}, now: () => clock }).get("BTC-EUR");
    expect(result.status).toBe("fresh");
    expect(result.quote).toMatchObject({ priceKind: "last_trade", change24h: null, volume24h: null });
  });

  it.each([
    [{ ...product(), price: "0" }, ticker()],
    [{ ...product(), product_id: "ETH-EUR" }, ticker()],
    [product(), {}],
    [product(), { trades: [{ product_id: "BTC-EUR", price: "NaN" }] }],
    [product(), { ...ticker(), best_bid: "74248" }],
    [{ ...product(), price_percentage_change_24h: "wrong" }, ticker()],
    [null, ticker()],
    [{}, {}],
  ])("fails closed on malformed present response even with another valid source (%j)", async (details, ticks) => {
    const fetcher = vi.fn<typeof fetch>(async (url) => json(String(url).includes("/ticker?") ? ticks : details));
    expect(await createCoinbaseMarketAdapter({ fetcher, now: () => clock }).get("BTC-EUR"))
      .toEqual({ product: "BTC-EUR", status: "unavailable", quote: null, error: "INVALID_DATA" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails closed on malformed JSON even if product price is valid", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => String(url).includes("/ticker?") ? new Response("{") : json(product()));
    expect((await createCoinbaseMarketAdapter({ fetcher, now: () => clock }).get("BTC-EUR")).error).toBe("INVALID_DATA");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not substitute fresh reference price when confirmed last trade is stale", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => json(String(url).includes("/ticker?") ? ticker("BTC-EUR", new Date(clock - MARKET_STALE_MS).toISOString()) : product()));
    const result = await createCoinbaseMarketAdapter({ fetcher, now: () => clock }).get("BTC-EUR");
    expect(result.status).toBe("stale");
    expect(result.quote).toMatchObject({ priceKind: "last_trade", exchangeAt: new Date(clock - MARKET_STALE_MS).toISOString() });
  });

  it.each([MARKET_STALE_MS - 1, MARKET_STALE_MS, -5_001])("enforces exchange freshness boundary at age %s", async (age) => {
    const fetcher = vi.fn<typeof fetch>(async (url) => json(String(url).includes("/ticker?") ? ticker("BTC-EUR", new Date(clock - age).toISOString()) : product()));
    expect((await createCoinbaseMarketAdapter({ fetcher, now: () => clock }).get("BTC-EUR")).status)
      .toBe(age === MARKET_STALE_MS - 1 ? "fresh" : "stale");
  });

  it("retains null for missing exchange timestamp, never assigns fetchedAt to it", async () => {
    const fetcher = vi.fn<typeof fetch>(async (url) => json(String(url).includes("/ticker?") ? { trades: [{ product_id: "BTC-EUR", price: "74244.8" }] } : product()));
    const result = await createCoinbaseMarketAdapter({ fetcher, now: () => clock }).get("BTC-EUR");
    expect(result.quote).toMatchObject({ fetchedAt: new Date(clock).toISOString(), exchangeAt: null });
  });

  it("deduplicates simultaneous requests and returns independent cached objects", async () => {
    const fetcher = validFetcher();
    const adapter = createCoinbaseMarketAdapter({ fetcher, now: () => clock });
    const results = await Promise.all(Array.from({ length: 8 }, () => adapter.get("BTC-EUR")));
    expect(fetcher).toHaveBeenCalledTimes(2);
    results[0].quote!.price = "1";
    results[0].status = "unavailable";
    expect(results[1].quote?.price).toBe("74244.8");
    expect((await adapter.get("BTC-EUR")).quote?.price).toBe("74244.8");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("refreshes cache exactly at the 60-second threshold", async () => {
    let time = clock;
    const fetcher = validFetcher();
    const adapter = createCoinbaseMarketAdapter({ fetcher, now: () => time });
    await adapter.get("BTC-EUR");
    time += MARKET_POLL_MS - 1;
    await adapter.get("BTC-EUR");
    expect(fetcher).toHaveBeenCalledTimes(2);
    time += 1;
    await adapter.get("BTC-EUR");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("ages a cached confirmed trade before cache expiration", async () => {
    let time = clock;
    const fetcher = vi.fn<typeof fetch>(async (url) => json(String(url).includes("/ticker?") ? ticker("BTC-EUR", new Date(clock - MARKET_STALE_MS + 10).toISOString()) : product()));
    const adapter = createCoinbaseMarketAdapter({ fetcher, now: () => time });
    expect((await adapter.get("BTC-EUR")).status).toBe("fresh");
    time += 10;
    expect((await adapter.get("BTC-EUR")).status).toBe("stale");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retains last confirmed timestamps as stale during an outage and throttles failed refreshes", async () => {
    let time = clock;
    let outage = false;
    const good = validFetcher();
    const fetcher = vi.fn<typeof fetch>((...args) => outage ? Promise.reject(new TypeError("network")) : good(...args));
    const adapter = createCoinbaseMarketAdapter({ fetcher, sleep: async () => {}, now: () => time });
    const first = await adapter.get("BTC-EUR");
    time += MARKET_POLL_MS;
    outage = true;
    const failed = await adapter.get("BTC-EUR");
    expect(failed).toEqual({ ...first, status: "stale", error: "NETWORK" });
    expect(fetcher).toHaveBeenCalledTimes(8);
    await adapter.get("BTC-EUR");
    expect(fetcher).toHaveBeenCalledTimes(8);
    time += 30_000;
    outage = false;
    expect((await adapter.get("BTC-EUR")).status).toBe("fresh");
  });

  it.each([429, 500, 502, 503])("retries transient HTTP %s with bounded jitter and succeeds", async (status) => {
    const attempts = new Map<string, number>();
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      const key = String(url);
      attempts.set(key, (attempts.get(key) ?? 0) + 1);
      return attempts.get(key) === 1 ? json({}, status) : json(key.includes("/ticker?") ? ticker() : product());
    });
    const sleep = vi.fn(async () => {});
    expect((await createCoinbaseMarketAdapter({ fetcher, sleep, random: () => 0.5, now: () => clock }).get("BTC-EUR")).status).toBe("fresh");
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls).toEqual([[300], [300]]);
  });

  it.each([[500, "SERVER_ERROR"], [429, "RATE_LIMITED"], [401, "HTTP_ERROR"], [404, "HTTP_ERROR"]] as const)("returns unavailable after bounded HTTP %s attempts", async (status, error) => {
    const fetcher = vi.fn<typeof fetch>(async () => json({}, status));
    const sleep = vi.fn(async () => {});
    const result = await createCoinbaseMarketAdapter({ fetcher, sleep, now: () => clock }).get("BTC-EUR");
    expect(result).toEqual({ product: "BTC-EUR", status: "unavailable", quote: null, error });
    expect(fetcher).toHaveBeenCalledTimes(status === 401 || status === 404 ? 2 : 6);
    expect(sleep).toHaveBeenCalledTimes(status === 401 || status === 404 ? 0 : 4);
  });

  it("cancels unread HTTP failure bodies and aborts their requests before retrying", async () => {
    const cancel = vi.fn();
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_, options) => {
      signals.push(options!.signal!);
      return new Response(new ReadableStream({ cancel }), { status: 503 });
    });
    const result = await createCoinbaseMarketAdapter({ fetcher, sleep: async () => {}, now: () => clock }).get("BTC-EUR");
    expect(result.error).toBe("SERVER_ERROR");
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(cancel).toHaveBeenCalledTimes(6);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("honors a short Retry-After instead of using a shorter jitter delay", async () => {
    let count = 0;
    const fetcher = vi.fn<typeof fetch>(async (url) => ++count <= 2 ? json({}, 429, { "Retry-After": "1" }) : json(String(url).includes("/ticker?") ? ticker() : product()));
    const sleep = vi.fn(async () => {});
    expect((await createCoinbaseMarketAdapter({ fetcher, sleep, now: () => clock }).get("BTC-EUR")).status).toBe("fresh");
    expect(sleep.mock.calls).toEqual([[1_000], [1_000]]);
  });

  it.each(["120", new Date(clock + 120_000).toUTCString()])("honors long Retry-After %s as a shared cooldown without a long wait", async (header) => {
    let time = clock;
    let limited = true;
    const good = validFetcher();
    const fetcher = vi.fn<typeof fetch>((...args) => limited ? Promise.resolve(json({}, 429, { "Retry-After": header })) : good(...args));
    const sleep = vi.fn(async () => {});
    const adapter = createCoinbaseMarketAdapter({ fetcher, sleep, now: () => time });
    expect((await adapter.get("BTC-EUR")).error).toBe("RATE_LIMITED");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).not.toHaveBeenCalled();
    time += 30_000;
    expect((await adapter.get("ETH-EUR")).error).toBe("RATE_LIMITED");
    expect(fetcher).toHaveBeenCalledTimes(2);
    time = clock + 120_000;
    limited = false;
    expect((await adapter.get("ETH-EUR")).status).toBe("stale");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("also honors a long server Retry-After across products without retrying early", async () => {
    let time = clock;
    const fetcher = vi.fn<typeof fetch>(async () => json({}, 503, { "Retry-After": "120" }));
    const sleep = vi.fn(async () => {});
    const adapter = createCoinbaseMarketAdapter({ fetcher, sleep, now: () => time });
    expect((await adapter.get("BTC-EUR")).error).toBe("SERVER_ERROR");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleep).not.toHaveBeenCalled();
    time += 30_000;
    expect((await adapter.get("ETH-EUR")).error).toBe("SERVER_ERROR");
    expect(fetcher).toHaveBeenCalledTimes(2);
    time = clock + 120_000;
    await adapter.get("ETH-EUR");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("bounds network retries and never emits a fake price", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => { throw new TypeError("network disconnected"); });
    const sleep = vi.fn(async () => {});
    expect(await createCoinbaseMarketAdapter({ fetcher, sleep, now: () => clock }).get("BTC-EUR"))
      .toEqual({ product: "BTC-EUR", status: "unavailable", quote: null, error: "NETWORK" });
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(sleep).toHaveBeenCalledTimes(4);
  });

  it("times out even if a fetch implementation ignores abort", async () => {
    vi.useFakeTimers();
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_, options) => {
      signals.push(options!.signal!);
      return new Promise<Response>(() => {});
    });
    const adapter = createCoinbaseMarketAdapter({ fetcher, timeoutMs: 10, sleep: async () => {}, now: () => clock });
    const pending = adapter.get("BTC-EUR");
    await vi.runAllTimersAsync();
    expect(await pending).toEqual({ product: "BTC-EUR", status: "unavailable", quote: null, error: "TIMEOUT" });
    expect(fetcher).toHaveBeenCalledTimes(6);
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("includes stalled response bodies in the request deadline", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn<typeof fetch>(async () => new Response(new ReadableStream({ start() {} })));
    const pending = createCoinbaseMarketAdapter({ fetcher, timeoutMs: 10, sleep: async () => {}, now: () => clock }).get("BTC-EUR");
    await vi.runAllTimersAsync();
    expect((await pending).error).toBe("TIMEOUT");
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it.each([0, -1, Infinity, 10_001])("rejects an unbounded or invalid timeout %s", (timeoutMs) => {
    expect(() => createCoinbaseMarketAdapter({ timeoutMs })).toThrow("Invalid market request timeout");
  });
});
