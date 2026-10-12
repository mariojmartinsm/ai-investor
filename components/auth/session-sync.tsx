"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser";

export function SessionSync() {
  const router = useRouter();

  useEffect(() => {
    const supabase = createBrowserSupabaseClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" || event === "TOKEN_REFRESHED") {
        // Avoid running another auth operation inside the auth callback's lock.
        queueMicrotask(() => router.refresh());
      }
    });
    return () => subscription.unsubscribe();
  }, [router]);

  return null;
}
