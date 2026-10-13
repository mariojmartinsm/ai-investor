import "server-only";

import type { MarketError } from "@/lib/markets/types";

const FAILURE_COOLDOWN_MS = 30_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_DELAY_MS = 2_000;

export type CoinbaseRequestOptions = {
  fetcher?: typeof fetch;
  now?: () => number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
  timeoutMs?: number;
};

export type CoinbaseRequestResult =
  | { ok: true; data: unknown; fetchedAt: string }
  | { ok: false; error: MarketError };

class RequestFailure extends Error {
  constructor(readonly code: MarketError, readonly retryAfterMs = 0) {
    super(code);
  }
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

export function createCoinbaseRequester(options: CoinbaseRequestOptions = {}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const random = options.random ?? Math.random;
  const timeoutMs = options.timeoutMs ?? 3_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 10_000) throw new Error("Invalid market request timeout");

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
            void response.body?.cancel().catch(() => {});
            controller.abort();
            if (response.status === 429) throw new RequestFailure("RATE_LIMITED", delay);
            if (response.status >= 500) throw new RequestFailure("SERVER_ERROR", delay);
            throw new RequestFailure("HTTP_ERROR");
          }
          try {
            return { data: await response.json(), fetchedAt: new Date(now()).toISOString() };
          } catch {
            if (controller.signal.aborted) throw new RequestFailure("TIMEOUT");
            throw new RequestFailure("INVALID_DATA");
          }
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

  return async function request(url: string): Promise<CoinbaseRequestResult> {
    for (let index = 0; index < MAX_ATTEMPTS; index += 1) {
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
          if (failure.code === "RATE_LIMITED") holdRequests(failure.code, Math.max(FAILURE_COOLDOWN_MS, failure.retryAfterMs));
          else if (failure.retryAfterMs > 0) holdRequests(failure.code, failure.retryAfterMs);
          return { ok: false, error: failure.code };
        }
        const backoff = 250 * 2 ** index + Math.floor(Math.max(0, Math.min(1, random())) * 100);
        await sleep(Math.max(backoff, failure.retryAfterMs));
      }
    }
    return { ok: false, error: "NETWORK" };
  };
}
