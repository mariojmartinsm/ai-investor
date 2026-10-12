import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { authCookieOptions, requireSupabaseConfig } from "@/lib/supabase/config";

// Create a fresh client per request. Server Actions explicitly opt into cookie writes.
export async function createServerSupabaseClient({ writeCookies = false }: { writeCookies?: boolean } = {}) {
  const { url, publishableKey } = requireSupabaseConfig();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookieOptions: authCookieOptions,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // Server Components are read-only; proxy.ts already refreshes their session.
        if (!writeCookies) return;
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}
