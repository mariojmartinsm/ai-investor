import type { NextConfig } from "next";
import { getSupabaseConfig } from "./lib/supabase/config";

// Stop before compilation if an invalid/private key was put in a public variable.
if ((process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) && !getSupabaseConfig()) {
  throw new Error("Set a valid NEXT_PUBLIC_SUPABASE_URL and sb_publishable_ key. Secret/service-role keys are forbidden.");
}

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Preserve the repository's approved agent instructions during local development.
  agentRules: false,
  distDir: process.env.NEXT_BUILD_DIR ?? ".next",
};

export default nextConfig;
