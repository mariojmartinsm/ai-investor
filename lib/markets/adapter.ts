import "server-only";

import { createCoinbaseRequester, type CoinbaseRequestOptions } from "@/lib/markets/coinbase-http";
import { parseCoinbaseProduct, parseCoinbaseTicker, validateSpread, type CoinbaseTrade } from "@/lib/markets/schema";
import { MARKET_POLL_MS, MARKET_PRODUCTS, quoteIsStale, type MarketError, type MarketProduct, type MarketQuote, type MarketSnapshot } from "@/lib/markets/types";

const BASE_URL = "https://api.coinbase.com/api/v3/brokerage/market/products/";
const FAILURE_COOLDOWN_MS = 30_000;
type CacheEntry = { snapshot: MarketSnapshot; nextFetchAt: number };

function copy(snapshot: MarketSnapshot): MarketSnapshot {
  return { ...snapshot, quote: snapshot.quote === null ? null : { ...snapshot.quote } };
}

export function createCoinbaseMarketAdapter(options: CoinbaseRequestOptions = {}) {
  const now = options.now ?? Date.now;
  const request = createCoinbaseRequester(options);
  const cache = new Map<MarketProduct, CacheEntry>();
  const inFlight = new Map<MarketProduct, Promise<MarketSnapshot>>();

  function failure(product: MarketProduct, error: MarketError): MarketSnapshot {
    const quote = cache.get(product)?.snapshot.quote ?? null;
    return { product, status: quote === null ? "unavailable" : "stale", quote, error };
  }

  async function load(product: MarketProduct): Promise<MarketSnapshot> {
    const [productResponse, tickerResponse] = await Promise.all([
      request(`${BASE_URL}${product}`),
      request(`${BASE_URL}${product}/ticker?limit=1`),
    ]);
    let snapshot: MarketSnapshot;
    try {
      // Invalid present data is never silently replaced by another endpoint.
      if ([productResponse, tickerResponse].some((response) => !response.ok && response.error === "INVALID_DATA")) {
        throw new Error("Malformed Coinbase JSON");
      }
      const details = productResponse.ok ? parseCoinbaseProduct(productResponse.data, product) : null;
      const ticker = tickerResponse.ok ? parseCoinbaseTicker(tickerResponse.data, product) : null;
      const trade = ticker?.trades.reduce<CoinbaseTrade | null>((latest, next) => {
        if (latest === null) return next;
        if (next.time !== null && (latest.time === null || Date.parse(next.time) > Date.parse(latest.time))) return next;
        return latest;
      }, null) ?? null;
      if (trade === null && details === null) {
        const errors = [productResponse, tickerResponse].flatMap((result) => result.ok ? [] : [result.error]);
        const code = (["RATE_LIMITED", "TIMEOUT", "SERVER_ERROR", "HTTP_ERROR", "NETWORK"] as const)
          .find((value) => errors.includes(value)) ?? "INVALID_DATA";
        snapshot = failure(product, code);
      } else {
        const price = trade?.price ?? details?.price;
        const priceResponse = trade === null ? productResponse : tickerResponse;
        if (price === undefined || !priceResponse.ok) throw new Error("Missing Coinbase price response");
        const bid = ticker?.bid ?? details?.bid ?? null;
        const ask = ticker?.ask ?? details?.ask ?? null;
        validateSpread(bid, ask);
        const quote: MarketQuote = {
          product,
          price,
          priceKind: trade === null ? "reference" : "last_trade",
          change24h: details?.change24h ?? null,
          volume24h: details?.volume24h ?? null,
          bid,
          ask,
          source: "Coinbase Advanced Trade public API",
          fetchedAt: priceResponse.fetchedAt,
          exchangeAt: trade?.time ?? null,
        };
        snapshot = { product, status: quoteIsStale(quote, now()) ? "stale" : "fresh", quote, error: null };
      }
    } catch {
      snapshot = failure(product, "INVALID_DATA");
    }
    cache.set(product, {
      snapshot,
      nextFetchAt: now() + (snapshot.status === "fresh" ? MARKET_POLL_MS : FAILURE_COOLDOWN_MS),
    });
    return snapshot;
  }

  return {
    async get(value: string): Promise<MarketSnapshot> {
      if (!(MARKET_PRODUCTS as readonly string[]).includes(value)) throw new Error("Unsupported market product");
      const product = value as MarketProduct;
      const entry = cache.get(product);
      if (entry !== undefined && now() < entry.nextFetchAt) {
        const cached = copy(entry.snapshot);
        if (cached.quote !== null && quoteIsStale(cached.quote, now())) cached.status = "stale";
        return cached;
      }
      const existing = inFlight.get(product);
      if (existing !== undefined) return copy(await existing);
      const loading = load(product);
      inFlight.set(product, loading);
      try {
        return copy(await loading);
      } finally {
        inFlight.delete(product);
      }
    },
  };
}
