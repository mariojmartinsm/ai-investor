import "server-only";

import { parseCoinbaseProduct, parseCoinbaseTicker, validateSpread, type CoinbaseTrade } from "@/lib/markets/schema";
import { MARKET_POLL_MS, MARKET_PRODUCTS, quoteIsStale, type MarketError, type MarketProduct, type MarketQuote, type MarketSnapshot } from "@/lib/markets/types";

const BASE_URL = "https://api.coinbase.com/api/v3/brokerage/market/products/";
const FAILURE_COOLDOWN_MS = 30_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 2_000;

type Options = {
  fetcher?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
};
type RequestResult =
  | { ok: true; data: unknown; fetchedAt: string }
  | { ok: false; error: MarketError };
type CacheEntry = { snapshot: MarketSnapshot; nextFetchAt: number };

class RequestFailure extends Error {
  constructor(readonly code: MarketError, readonly retryAfterMs = 0) {
    super(code);
  }
}

function copy(snapshot: MarketSnapshot): MarketSnapshot {
  return { ...snapshot, quote: snapshot.quote === null ? null : { ...snapshot.quote } };
}

function retryAfter(header: string | null, now: number): number {
  if (header === null) return 0;
  if (/^\d+$/.test(header)) {
    const seconds = Number(header);
    return Number.isSafeInteger(seconds) && seconds <= Number.MAX_SAFE_INTEGER / 1_000 ? seconds * 1_000 : 0;
  }
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : 0;
}

export function createCoinbaseMarketAdapter(options: Options = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const random = options.random ?? Math.random;
  const timeoutMs = options.timeoutMs ?? 3_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10_000) {
    throw new Error("Invalid market request timeout");
  }
  const cache = new Map<MarketProduct, CacheEntry>();
  const inFlight = new Map<MarketProduct, Promise<MarketSnapshot>>();
  // Coinbase's Retry-After is shared by both public products in this instance.
  // A long provider cooldown returns immediately rather than tying up requests.
  let providerCooldown: { until: number; error: MarketError } = { until: 0, error: "RATE_LIMITED" };

  function holdRequests(error: MarketError, milliseconds: number) {
    const until = now() + milliseconds;
    if (until > providerCooldown.until) providerCooldown = { until, error };
  }

  async function attempt(url: string): Promise<{ data: unknown; fetchedAt: string }> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetcher(url, {
            method: "GET",
            headers: { Accept: "application/json", "Cache-Control": "no-cache" },
            cache: "no-store",
            credentials: "omit",
            redirect: "error",
            signal: controller.signal,
          });
          if (!response.ok) {
            const delay = retryAfter(response.headers.get("Retry-After"), now());
            // Release unread HTTP error bodies and their pooled connection before
            // retrying. Cancellation failure does not replace the HTTP diagnosis.
            void response.body?.cancel().catch(() => {});
            controller.abort();
            if (response.status === 429) throw new RequestFailure("RATE_LIMITED", delay);
            if (response.status >= 500) throw new RequestFailure("SERVER_ERROR", delay);
            throw new RequestFailure("HTTP_ERROR");
          }
          let data: unknown;
          try {
            data = await response.json();
          } catch {
            if (controller.signal.aborted) throw new RequestFailure("TIMEOUT");
            throw new RequestFailure("INVALID_DATA");
          }
          return { data, fetchedAt: new Date(now()).toISOString() };
        })(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new RequestFailure("TIMEOUT"));
          }, timeoutMs);
        }),
      ]);
    } catch (error) {
      if (error instanceof RequestFailure) throw error;
      throw new RequestFailure(controller.signal.aborted ? "TIMEOUT" : "NETWORK");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async function request(url: string): Promise<RequestResult> {
    for (let index = 0; index < MAX_ATTEMPTS; index++) {
      if (now() < providerCooldown.until) return { ok: false, error: providerCooldown.error };
      try {
        return { ok: true, ...await attempt(url) };
      } catch (error) {
        const failure = error instanceof RequestFailure ? error : new RequestFailure("NETWORK");
        const transient = ["TIMEOUT", "NETWORK", "RATE_LIMITED", "SERVER_ERROR"].includes(failure.code);
        if (failure.retryAfterMs > MAX_RETRY_DELAY_MS) {
          holdRequests(failure.code, failure.retryAfterMs);
          return { ok: false, error: failure.code };
        }
        if (!transient || index === MAX_ATTEMPTS - 1) {
          if (failure.code === "RATE_LIMITED") {
            holdRequests(failure.code, Math.max(FAILURE_COOLDOWN_MS, failure.retryAfterMs));
          } else if (failure.retryAfterMs > 0) {
            holdRequests(failure.code, failure.retryAfterMs);
          }
          return { ok: false, error: failure.code };
        }
        const backoff = 250 * 2 ** index + Math.floor(Math.max(0, Math.min(1, random())) * 100);
        await sleep(Math.max(backoff, failure.retryAfterMs));
      }
    }
    return { ok: false, error: "NETWORK" };
  }

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
      if (now() < providerCooldown.until) return copy(failure(product, providerCooldown.error));
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
