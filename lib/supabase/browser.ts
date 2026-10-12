"use client";

import { createBrowserClient } from "@supabase/ssr";
import { authCookieOptions, requireSupabaseConfig } from "@/lib/supabase/config";

export function createBrowserSupabaseClient() {
  const { url, publishableKey } = requireSupabaseConfig();
  return createBrowserClient(url, publishableKey, { cookieOptions: authCookieOptions });
}
