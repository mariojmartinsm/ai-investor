import "server-only";

import { redirect } from "next/navigation";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createServerSupabaseClient } from "@/lib/supabase/server";

export async function getAuthenticatedUser() {
  if (!getSupabaseConfig()) return null;
  const supabase = await createServerSupabaseClient();
  // getUser verifies with Auth; never authorize from the cookie's embedded user.
  const { data, error } = await supabase.auth.getUser();
  return error || !data.user || data.user.is_anonymous ? null : data.user;
}

// Call inside every private data loader, action, and API handler as they are added.
// A route redirect or layout check alone does not authorize server operations.
export async function requireUser() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login");
  return user;
}
