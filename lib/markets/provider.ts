import "server-only";

import { createCoinbaseMarketAdapter } from "@/lib/markets/adapter";
import { MARKET_PRODUCTS } from "@/lib/markets/types";

// Public market data contains no owner state, so a warm process may share this
// bounded cache. Callers remain responsible for authenticating the request.
const adapter = createCoinbaseMarketAdapter();

export function getPublicMarketSnapshots() {
  return Promise.all(MARKET_PRODUCTS.map((product) => adapter.get(product)));
}
