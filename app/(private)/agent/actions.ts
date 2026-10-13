"use server";

import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import { runStrategyAnalysisPreview } from "@/lib/strategy/server";

export type AnalysisActionState = { error: string | null; summary: string | null };

export async function runAnalysis(_previous: AnalysisActionState): Promise<AnalysisActionState> {
  void _previous;
  try {
    const result = await runStrategyAnalysisPreview();
    revalidatePath("/agent");
    return {
      error: null,
      summary: result.inserted > 0
        ? `Stored ${result.inserted} analysis preview${result.inserted === 1 ? "" : "s"}.`
        : "Latest analysis already exists; no duplicate records were created.",
    };
  } catch (error) {
    unstable_rethrow(error);
    return { error: "Unable to run strategy analysis. Please try again.", summary: null };
  }
}
