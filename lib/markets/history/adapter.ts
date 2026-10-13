import "server-only";

import { createCoinbaseRequester, type CoinbaseRequestOptions } from "@/lib/markets/coinbase-http";
import { readCoinbaseCandlePage } from "@/lib/markets/history/schema";
import { DAILY_GRANULARITY, DAILY_SECONDS, HISTORY_DAYS, HISTORY_PAGE_LIMIT, HistoricalMarketError, type HistoricalFetch, type MarketCandle } from "@/lib/markets/history/types";
import { MARKET_PRODUCTS, type MarketProduct } from "@/lib/markets/types";

const BASE_URL = "https://api.coinbase.com/api/v3/brokerage/market/products/";

export function createCoinbaseHistoryAdapter(options: CoinbaseRequestOptions = {}) {
  const now = options.now ?? Date.now;
  const request = createCoinbaseRequester(options);

  return {
    async get(value: string, days = HISTORY_DAYS): Promise<HistoricalFetch> {
      if (!(MARKET_PRODUCTS as readonly string[]).includes(value)) throw new Error("Unsupported market product");
      if (!Number.isInteger(days) || days < 1 || days > HISTORY_DAYS) throw new Error("Invalid historical day count");
      const productId = value as MarketProduct;
      const todayStart = Math.floor(now() / (DAILY_SECONDS * 1_000)) * DAILY_SECONDS;
      const rangeStart = todayStart - days * DAILY_SECONDS;
      const accepted = new Map<number, MarketCandle>();
      const duplicated = new Set<number>();
      let rejected = 0;
      let requestCount = 0;

      for (let pageStart = rangeStart; pageStart < todayStart; pageStart += HISTORY_PAGE_LIMIT * DAILY_SECONDS) {
        const pageCount = Math.min(HISTORY_PAGE_LIMIT, (todayStart - pageStart) / DAILY_SECONDS);
        const pageEnd = pageStart + pageCount * DAILY_SECONDS;
        const query = new URLSearchParams({
          start: String(pageStart),
          end: String(pageEnd - 1),
          granularity: DAILY_GRANULARITY,
          limit: String(pageCount),
        });
        const result = await request(`${BASE_URL}${productId}/candles?${query}`);
        requestCount += 1;
        if (!result.ok) throw new HistoricalMarketError(result.error);
        let page;
        try {
          page = readCoinbaseCandlePage(result.data, productId, result.fetchedAt, rangeStart, todayStart);
        } catch {
          throw new HistoricalMarketError("INVALID_DATA");
        }
        rejected += page.rejected;
        for (const candle of page.candles) {
          const start = Date.parse(candle.candleStart) / 1_000;
          if (duplicated.has(start)) {
            rejected += 1;
            continue;
          }
          if (accepted.has(start)) {
            accepted.delete(start);
            duplicated.add(start);
            rejected += 2;
            continue;
          }
          accepted.set(start, candle);
        }
      }

      const candles = [...accepted.entries()].sort(([left], [right]) => left - right).map(([, candle]) => candle);
      const gaps: string[] = [];
      for (let start = rangeStart; start < todayStart; start += DAILY_SECONDS) {
        if (!accepted.has(start)) gaps.push(new Date(start * 1_000).toISOString());
      }
      return {
        productId,
        candles,
        rejected,
        gaps,
        complete: candles.length === days && gaps.length === 0 && rejected === 0,
        expectedStart: new Date(rangeStart * 1_000).toISOString(),
        expectedEnd: new Date((todayStart - DAILY_SECONDS) * 1_000).toISOString(),
        requestCount,
      };
    },
  };
}
