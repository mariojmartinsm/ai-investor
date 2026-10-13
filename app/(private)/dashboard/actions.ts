"use server";

import { revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

import { initializePortfolio } from "@/lib/portfolio/server";

export type InitializePortfolioState = { error: string | null };

export async function initializeDryRunPortfolio(): Promise<InitializePortfolioState> {
  try {
    // This service verifies the owner independently of the page and proxy.
    await initializePortfolio();
  } catch (error) {
    unstable_rethrow(error);
    return { error: "Unable to initialize your virtual portfolio. Please try again." };
  }

  revalidatePath("/dashboard");
  redirect("/dashboard");
}
