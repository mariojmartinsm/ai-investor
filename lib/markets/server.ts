import "server-only";

import { requireUser } from "@/lib/auth/user";
import { getPublicMarketSnapshots } from "@/lib/markets/provider";

export async function getMarkets() {
  await requireUser();
  return getPublicMarketSnapshots();
}

export async function getMarketPageData() {
  const markets = await getMarkets();
  return { markets, renderedAt: Date.now() };
}
