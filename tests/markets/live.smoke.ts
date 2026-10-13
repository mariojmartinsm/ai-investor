import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createCoinbaseMarketAdapter } from "@/lib/markets/adapter";
import { MARKET_PRODUCTS } from "@/lib/markets/types";

// Opt-in only: public GET requests, no database, API keys, accounts or orders.
it("reads valid public BTC-EUR and ETH-EUR snapshots from Coinbase", async () => {
  const requests: string[] = [];
  const adapter = createCoinbaseMarketAdapter({
    fetcher: (input, options) => {
      const url = String(input);
      expect(url).toMatch(/^https:\/\/api\.coinbase\.com\/api\/v3\/brokerage\/market\/products\/(?:BTC|ETH)-EUR(?:\/ticker\?limit=1)?$/);
      expect(options?.method).toBe("GET");
      expect(new Headers(options?.headers).has("Authorization")).toBe(false);
      requests.push(url);
      return fetch(input, options);
    },
  });
  const snapshots = await Promise.all(MARKET_PRODUCTS.map((product) => adapter.get(product)));
  for (const snapshot of snapshots) {
    expect(snapshot.error).toBeNull();
    expect(snapshot.status).toBe("fresh");
    expect(snapshot.quote?.source).toBe("Coinbase Advanced Trade public API");
    expect(snapshot.quote?.price).toMatch(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
    expect(Number.isFinite(Date.parse(snapshot.quote!.fetchedAt))).toBe(true);
    if (snapshot.quote?.exchangeAt !== null) expect(Number.isFinite(Date.parse(snapshot.quote!.exchangeAt!))).toBe(true);
  }
  expect(requests.length).toBeGreaterThanOrEqual(4);
}, 40_000);
