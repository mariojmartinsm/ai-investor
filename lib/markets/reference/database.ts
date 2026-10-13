import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { ReferencePersistResult } from "@/lib/markets/reference/types";
import { quoteIsStale, type MarketSnapshot } from "@/lib/markets/types";

export async function persistFreshReferenceQuotes(
  admin: SupabaseClient,
  snapshots: MarketSnapshot[],
  now: number,
): Promise<ReferencePersistResult> {
  const payload = snapshots.flatMap((snapshot) => {
    if (snapshot.status !== "fresh" || snapshot.quote === null || quoteIsStale(snapshot.quote, now)) return [];
    const quote = snapshot.quote;
    return [{
      product_id: quote.product,
      price: quote.price,
      price_kind: quote.priceKind,
      bid: quote.bid,
      ask: quote.ask,
      source: quote.source,
      exchange_at: quote.exchangeAt,
      fetched_at: quote.fetchedAt,
    }];
  });
  if (payload.length === 0) return { inserted: 0, skipped: 0 };
  const { data, error } = await admin.rpc("store_market_reference_quotes", { p_quotes: payload });
  if (error || !Array.isArray(data) || data.length !== 1) throw new Error("REFERENCE_QUOTE_PERSIST_FAILED");
  const inserted = data[0]?.inserted_count;
  const skipped = data[0]?.skipped_count;
  if (!Number.isInteger(inserted) || !Number.isInteger(skipped) || inserted < 0 || skipped < 0
    || inserted + skipped !== payload.length) throw new Error("REFERENCE_QUOTE_PERSIST_FAILED");
  return { inserted, skipped };
}
