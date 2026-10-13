import "server-only";

import { requireUser } from "@/lib/auth/user";
import { createCoinbaseMarketAdapter } from "@/lib/markets/adapter";
import { MARKET_PRODUCTS } from "@/lib/markets/types";

// Only public quotes are shared within a warm server process. No identity,
// holdings, sessions or ledger data enter this cache or adapter.
const adapter = createCoinbaseMarketAdapter();

export async function getMarkets() {
  await requireUser();
  return Promise.all(MARKET_PRODUCTS.map((product) => adapter.get(product)));
}

export async function getMarketPageData() {
  const markets = await getMarkets();
  return { markets, renderedAt: Date.now() };
}
