import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireUser } from "@/lib/auth/user";
import { getPublicMarketSnapshots } from "@/lib/markets/provider";
import { persistFreshReferenceQuotes } from "@/lib/markets/reference/database";
import { readReferenceQuotes, unavailableReferenceQuotes } from "@/lib/markets/reference/model";
import type { ReferenceQuoteSnapshot } from "@/lib/markets/reference/types";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";

// Authenticate independently before constructing the privileged client. Only
// quotes that survive the adapter's validation and freshness rules persist.
export async function refreshAndLoadReferenceQuotes(
  ownerClient: SupabaseClient,
  now: () => number = Date.now,
): Promise<ReferenceQuoteSnapshot[]> {
  await requireUser();
  let checkedAt = now();
  try {
    const snapshots = await getPublicMarketSnapshots();
    checkedAt = now();
    await persistFreshReferenceQuotes(createAdminSupabaseClient(), snapshots, checkedAt);
  } catch {
    // A previous persisted observation may still be usable. Never use an
    // unpersisted in-memory response as the portfolio's authoritative mark.
  }
  try {
    const { data, error } = await ownerClient.rpc("get_latest_market_reference_quotes");
    if (error) return unavailableReferenceQuotes();
    return readReferenceQuotes(data, checkedAt);
  } catch {
    return unavailableReferenceQuotes();
  }
}
