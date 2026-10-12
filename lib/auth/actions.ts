"use server";

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/user";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export type LogoutState = { error: string | null };

export async function logout(): Promise<LogoutState> {
  // Independent verification is required even if proxy/layout already checked.
  await requireUser();
  const supabase = await createServerSupabaseClient({ writeCookies: true });
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error) return { error: "Unable to log out. Please try again." };
  redirect("/login");
}
