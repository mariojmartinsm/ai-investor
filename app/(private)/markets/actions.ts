"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { backfillHistoricalMarkets } from "@/lib/markets/history/server";

export type HistoricalRefreshState = {
  error: string | null;
  summary: string | null;
};

export async function refreshHistoricalMarkets(_previous: HistoricalRefreshState): Promise<HistoricalRefreshState> {
  void _previous;
  try {
    const report = await backfillHistoricalMarkets();
    revalidatePath("/markets");
    return {
      error: null,
      summary: `Imported ${report.imported}, updated ${report.updated}, skipped ${report.skipped}, rejected ${report.rejected}.`,
    };
  } catch (error) {
    unstable_rethrow(error);
    return { error: "Unable to refresh historical market data. Please try again.", summary: null };
  }
}
