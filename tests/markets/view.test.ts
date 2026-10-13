import { describe, expect, it } from "vitest";

import { formatMarketChange, formatMarketEur, formatMarketTime, formatMarketVolume } from "@/lib/markets/format";
import { quoteIsStale, type MarketSnapshot } from "@/lib/markets/types";
import { readMarketSnapshots, unavailableMarkets, visibleMarketSnapshot } from "@/lib/markets/view";

const at = "2026-10-13T19:00:00.000Z";
const now = Date.parse(at);
const snapshot = (product: "BTC-EUR" | "ETH-EUR" = "BTC-EUR"): MarketSnapshot => ({
  product, status: "fresh", error: null,
  quote: { product, price: "74244.8123456789", priceKind: "last_trade", change24h: "-0.19754807187522", volume24h: "175.748172300001",
    bid: "74240.41", ask: "74247.84", source: "Coinbase Advanced Trade public API", fetchedAt: at, exchangeAt: at },
});

describe("market formatting keeps decimal strings precise", () => {
  it("rounds EUR half-up without losing integers beyond Number precision", () => {
    expect(formatMarketEur("9007199254740993.125")).toBe("€9,007,199,254,740,993.13");
    expect(formatMarketEur("3200.45678912")).toBe("€3,200.46");
    expect(formatMarketEur("0.00000000000000000001")).toBe("€0.00000000000000000001");
  });
  it("formats signed percent units and preserves base-volume digits", () => {
    expect(formatMarketChange("2.3456")).toBe("+2.35%");
    expect(formatMarketChange("-1.2345")).toBe("−1.23%");
    expect(formatMarketChange("-0.00001")).toBe("0.00%");
    expect(formatMarketVolume("4567.123456789123")).toBe("4,567.123456789123");
    expect(formatMarketVolume("0")).toBe("0");
  });
  it.each(["0", "-1", "NaN", "Infinity", "1e3", "", " 123 "])("rejects invalid price %s", (price) => {
    expect(() => formatMarketEur(price)).toThrow();
  });
  it("labels missing times rather than assigning the fetch clock", () => {
    expect(formatMarketTime(null)).toBe("Not provided");
    expect(formatMarketTime("2026-10-13T19:00:00.123456Z")).toBe("2026-10-13 19:00:00 UTC");
    expect(() => formatMarketTime("invalid")).toThrow();
  });
});

describe("market polling validation and freshness", () => {
  it("orders exactly the two supported products and preserves nullable fields", () => {
    const ethereum = snapshot("ETH-EUR");
    ethereum.quote!.change24h = null;
    ethereum.quote!.exchangeAt = null;
    expect(readMarketSnapshots([ethereum, snapshot()])).toEqual([snapshot(), ethereum]);
    expect(readMarketSnapshots([snapshot(), { product: "ETH-EUR", status: "unavailable", quote: null, error: "TIMEOUT" }])[1].quote).toBeNull();
  });
  it.each([null, {}, [], [snapshot()], [snapshot(), snapshot()], [snapshot(), { ...snapshot("ETH-EUR"), product: "SOL-EUR" }]])("rejects malformed or incomplete polling responses", (value) => {
    expect(() => readMarketSnapshots(value)).toThrow();
  });
  it.each([
    { price: "0" }, { price: "-1" }, { price: 74244 }, { price: "NaN" },
    { bid: "0" }, { bid: "75000", ask: "74000" }, { volume24h: "-1" }, { change24h: "-100.01" },
    { fetchedAt: "2026-02-30T19:00:00Z" }, { fetchedAt: "not a time" }, { exchangeAt: "2026-10-13" },
    { source: "Unknown provider" }, { priceKind: "reference", exchangeAt: at },
  ])("rejects invalid polling quote fields", (fields) => {
    const bitcoin = snapshot();
    expect(() => readMarketSnapshots([{ ...bitcoin, quote: { ...bitcoin.quote, ...fields } }, snapshot("ETH-EUR")])).toThrow();
  });
  it("expires at the exact threshold using either fetch or confirmed trade age", () => {
    const bitcoin = snapshot();
    expect(quoteIsStale(bitcoin.quote!, now + 119_999)).toBe(false);
    expect(visibleMarketSnapshot(bitcoin, now + 120_000).status).toBe("stale");
    expect(bitcoin.status).toBe("fresh");
    bitcoin.quote!.exchangeAt = new Date(now - 120_000).toISOString();
    expect(visibleMarketSnapshot(bitcoin, now).status).toBe("stale");
  });
  it("rejects future clocks and never revives unavailable quotes", () => {
    const bitcoin = snapshot();
    bitcoin.quote!.exchangeAt = new Date(now + 5_001).toISOString();
    expect(quoteIsStale(bitcoin.quote!, now)).toBe(true);
    const failed = unavailableMarkets([snapshot()])[0];
    expect(visibleMarketSnapshot(failed, now).status).toBe("unavailable");
    expect(failed.quote?.fetchedAt).toBe(at);
    expect(failed.error).toBe("NETWORK");
  });
});
