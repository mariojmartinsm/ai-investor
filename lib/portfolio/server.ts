import "server-only";

import { requireUser } from "@/lib/auth/user";
import { refreshAndLoadReferenceQuotes } from "@/lib/markets/reference/server";
import { readPortfolioAccount, valuePortfolio, type PortfolioLoadResult } from "@/lib/portfolio/model";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function getDashboardPortfolio(): Promise<PortfolioLoadResult> {
  // Authorize this operation independently of the private layout and proxy.
  // Keep redirects outside the operational catch so they remain redirects.
  const user = await requireUser();
  try {
    const supabase = await createServerSupabaseClient();
    const { data, error } = await supabase.rpc("get_dry_run_portfolio", { p_owner_id: user.id });
    if (error) return { status: "error" };
    const account = readPortfolioAccount(data, user.id);
    if (!account) return { status: "empty" };
    const references = await refreshAndLoadReferenceQuotes(supabase);
    const calculatedAt = new Date().toISOString();
    return { status: "ready", portfolio: valuePortfolio(account, references, calculatedAt) };
  } catch {
    return { status: "error" };
  }
}

export async function initializePortfolio(): Promise<void> {
  const user = await requireUser();
  try {
    // This is the authenticated user's cookie client, never a service-role
    // client. The RPC authorizes ownership again and accepts no funding amount.
    const supabase = await createServerSupabaseClient({ writeCookies: true });
    const { data, error } = await supabase.rpc("initialize_dry_run_portfolio", { p_owner_id: user.id });
    if (error || !readPortfolioAccount(data, user.id)) throw new Error("Portfolio initialization failed");
  } catch {
    // Do not disclose provider messages, SQL details or private data to clients.
    throw new Error("Unable to initialize your portfolio. Please try again.");
  }
}
