import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Preserve the repository's approved agent instructions during local development.
  agentRules: false,
};

export default nextConfig;
