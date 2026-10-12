import { createServer } from "node:http";
import { startSupabaseAuthFixture, TEST_PUBLISHABLE_KEY } from "./supabase-auth.mjs";

const appPort = Number(process.env.E2E_APP_PORT ?? "3002");
const authPort = Number(process.env.E2E_AUTH_PORT ?? "54339");

// Override only this isolated test process; .env.local is never modified.
process.env.NODE_ENV = "development";
process.env.NEXT_TELEMETRY_DISABLED = "1";
process.env.NEXT_BUILD_DIR = ".next-e2e";
process.env.NEXT_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${authPort}`;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = TEST_PUBLISHABLE_KEY;

// A test-only custom server keeps cleanup in one process on Windows, where
// Playwright's taskkill-based child-tree shutdown can be restricted by a sandbox.
const { default: next } = await import("next");
const app = next({ dev: true, hostname: "127.0.0.1", port: appPort });
await app.prepare();
const handler = app.getRequestHandler();
const appServer = createServer((request, response) => handler(request, response));
let stopping = false;
const authServer = await startSupabaseAuthFixture(authPort, { onShutdown: stop });

async function stop() {
  if (stopping) return;
  stopping = true;
  appServer.closeAllConnections();
  authServer.closeAllConnections();
  await Promise.all([
    app.close(),
    new Promise((resolve) => appServer.close(resolve)),
    new Promise((resolve) => authServer.close(resolve)),
  ]);
  process.exit(0);
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);
await new Promise((resolve, reject) => {
  appServer.once("error", reject);
  appServer.listen(appPort, "127.0.0.1", resolve);
});
