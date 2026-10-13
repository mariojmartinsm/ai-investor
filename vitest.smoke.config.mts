import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Explicit opt-in only. The default automated suite never calls Coinbase.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { include: ["tests/markets/live.smoke.ts"], environment: "node", testTimeout: 30_000 },
});
