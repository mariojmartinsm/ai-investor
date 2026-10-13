import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { requireUser } from "@/lib/auth/user";
import { readStoredCandles } from "@/lib/markets/history/model";
import { MARKET_PRODUCTS } from "@/lib/markets/types";
import { readPortfolioAccount } from "@/lib/portfolio/model";
import { createAdminSupabaseClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { persistStrategyPreviews } from "@/lib/strategy/database";
import { analyzeBaselineStrategy } from "@/lib/strategy/engine";
import { readStoredStrategyAnalyses } from "@/lib/strategy/model";
import type { StrategyPageData, StrategyPersistResult } from "@/lib/strategy/types";

const DAY_MS = 86_400_000;
export const utcAnalysisCutoff = (now: number) => new Date(Math.floor(now / DAY_MS) * DAY_MS).toISOString();

async function readLatest(ownerClient: SupabaseClient, ownerId: string): Promise<StrategyPageData> {
  const { data, error } = await ownerClient.rpc("get_latest_strategy_analysis_previews", { p_owner_id: ownerId });
  if (error) return { status: "error", analyses: [] };
  const analyses = readStoredStrategyAnalyses(data, ownerId);
  return { status: analyses.length === 0 ? "empty" : "ready", analyses };
}

export async function getStrategyPageData(): Promise<StrategyPageData> {
  const user = await requireUser();
  try {
    return await readLatest(await createServerSupabaseClient(), user.id);
  } catch {
    return { status: "error", analyses: [] };
  }
}

export async function runStrategyAnalysisPreview(now = Date.now): Promise<StrategyPersistResult> {
  const user = await requireUser();
  try {
    const ownerClient = await createServerSupabaseClient();
    const { data: portfolioData, error: portfolioError } = await ownerClient.rpc("get_dry_run_portfolio", { p_owner_id: user.id });
    if (portfolioError) throw portfolioError;
    const portfolio = readPortfolioAccount(portfolioData, user.id);
    if (!portfolio) throw new Error("PORTFOLIO_REQUIRED");
    const cutoff = utcAnalysisCutoff(now());
    const series = await Promise.all(MARKET_PRODUCTS.map(async (product) => {
      const { data, error } = await ownerClient.rpc("get_market_candles", { p_product_id: product, p_limit: 90 });
      if (error) throw error;
      return readStoredCandles(data, product, now()).candles;
    }));
    const analyses = MARKET_PRODUCTS.map((product, index) => analyzeBaselineStrategy({
      product,
      candles: series[index],
      ownedQuantity: product === "BTC-EUR" ? portfolio.btcBalance : portfolio.ethBalance,
      cutoff,
    }));
    return await persistStrategyPreviews(createAdminSupabaseClient(), user.id, analyses);
  } catch {
    throw new Error("Unable to run strategy analysis. Please try again.");
  }
}
