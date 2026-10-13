import { describe, expect, it } from "vitest";

import { parseCoinbaseProduct, parseCoinbaseTicker } from "@/lib/markets/schema";
import type { MarketProduct } from "@/lib/markets/types";

function product(pair: MarketProduct = "BTC-EUR") {
  return {
    product_id: pair,
    price: pair === "BTC-EUR" ? "74244.80" : "2347.31",
    base_currency_id: pair.slice(0, 3),
    quote_currency_id: "EUR",
    product_type: "SPOT",
    price_percentage_change_24h: "0.19754807187522",
    volume_24h: "175.7481723",
    best_bid_price: "",
    best_ask_price: "",
  };
}

function ticker(pair: MarketProduct = "BTC-EUR") {
  return {
    trades: [{ product_id: pair, price: "74244.80", size: "0.00012015", time: "2026-10-13T19:39:49.346147Z" }],
    best_bid: "74240.41",
    best_ask: "74247.84",
  };
}

describe("Coinbase runtime schemas", () => {
  it.each(["BTC-EUR", "ETH-EUR"] as const)("parses %s product without converting decimal strings", (pair) => {
    expect(parseCoinbaseProduct(product(pair), pair)).toEqual({
      price: product(pair).price,
      change24h: "0.19754807187522",
      volume24h: "175.7481723",
      bid: null,
      ask: null,
    });
  });

  it("accepts the documented trailing percent and preserves signed change", () => {
    expect(parseCoinbaseProduct({ ...product(), price_percentage_change_24h: "-9.43%" }, "BTC-EUR").change24h).toBe("-9.43");
    expect(parseCoinbaseProduct({ ...product(), price_percentage_change_24h: "-100" }, "BTC-EUR").change24h).toBe("-100");
  });

  it.each([undefined, null, ""])("represents absent optional statistics as null (%s)", (missing) => {
    const result = parseCoinbaseProduct({ ...product(), price_percentage_change_24h: missing, volume_24h: missing }, "BTC-EUR");
    expect(result.change24h).toBeNull();
    expect(result.volume24h).toBeNull();
  });

  it("allows zero volume and exact decimals up to 40 digits", () => {
    expect(parseCoinbaseProduct({ ...product(), volume_24h: "0", price: "12345678901234567890.12345678901234567890" }, "BTC-EUR").price)
      .toBe("12345678901234567890.12345678901234567890");
  });

  it.each([undefined, null, "", "0", "0.000", "-1", "NaN", "Infinity", "1e5", " 2", "2 ", "01", "1,000", "1.", 74244.8, "123456789012345678901", "0.123456789012345678901"])("rejects invalid product price %s", (price) => {
    expect(() => parseCoinbaseProduct({ ...product(), price }, "BTC-EUR")).toThrow();
  });

  it.each([null, [], "", {}, { product_id: "ETH-EUR", price: "123" }])("rejects malformed or mismatched product %j", (value) => {
    expect(() => parseCoinbaseProduct(value, "BTC-EUR")).toThrow();
  });

  it.each([
    { quote_currency_id: "USD" },
    { base_currency_id: "ETH" },
    { product_type: "FUTURE" },
    { product_type: null },
    { volume_24h: "-1" },
    { volume_24h: 1 },
    { price_percentage_change_24h: "-100.00000001" },
    { price_percentage_change_24h: "9%%" },
    { price_percentage_change_24h: {} },
    { best_bid_price: "0" },
    { best_ask_price: "-1" },
    { best_bid_price: "2", best_ask_price: "1" },
  ])("rejects invalid supplied product fields %j", (fields) => {
    expect(() => parseCoinbaseProduct({ ...product(), ...fields }, "BTC-EUR")).toThrow();
  });

  it.each(["BTC-EUR", "ETH-EUR"] as const)("parses %s trade price and exact exchange timestamp", (pair) => {
    expect(parseCoinbaseTicker(ticker(pair), pair)).toEqual({
      trades: [{ price: "74244.80", time: "2026-10-13T19:39:49.346147Z" }],
      bid: "74240.41",
      ask: "74247.84",
    });
  });

  it("represents explicitly empty trades and absent spread without fabricating data", () => {
    expect(parseCoinbaseTicker({ trades: [], best_bid: "", best_ask: null }, "BTC-EUR"))
      .toEqual({ trades: [], bid: null, ask: null });
  });

  it.each([undefined, null, ""])("never invents a missing trade timestamp (%s)", (time) => {
    expect(parseCoinbaseTicker({ ...ticker(), trades: [{ ...ticker().trades[0], time }] }, "BTC-EUR").trades[0].time).toBeNull();
  });

  it.each(["yesterday", "2026-02-30T19:39:49Z", "2026-10-13T25:00:00Z", "2026-10-13", "2026-10-13T19:39:49", "2026-10-13T19:39:49.1234567890Z", 123])("rejects malformed trade timestamp %s", (time) => {
    expect(() => parseCoinbaseTicker({ ...ticker(), trades: [{ ...ticker().trades[0], time }] }, "BTC-EUR")).toThrow();
  });

  it.each([
    {},
    { trades: null },
    { trades: "" },
    { trades: [null] },
    { trades: [{ product_id: "ETH-EUR", price: "1" }] },
    { trades: [{ product_id: "BTC-EUR", price: "0" }] },
    { trades: [{ product_id: "BTC-EUR", price: "1", size: "-1" }] },
    { ...ticker(), best_bid: "0" },
    { ...ticker(), best_ask: "NaN" },
    { ...ticker(), best_bid: "74248" },
  ])("rejects malformed trade/book response %j", (value) => {
    expect(() => parseCoinbaseTicker(value, "BTC-EUR")).toThrow();
  });

  it("rejects unexpectedly unbounded trades arrays", () => {
    expect(() => parseCoinbaseTicker({ ...ticker(), trades: Array.from({ length: 101 }, () => ticker().trades[0]) }, "BTC-EUR")).toThrow();
  });
});
