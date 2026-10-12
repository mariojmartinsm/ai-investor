import { defineConfig, devices } from "@playwright/test";

const appPort = process.env.E2E_APP_PORT ?? "3002";
const baseURL = `http://127.0.0.1:${appPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalTeardown: "./tests/fixtures/e2e-teardown.mjs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  outputDir: ".tmp/playwright-results",
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    launchOptions: process.env.E2E_CHROMIUM_EXECUTABLE ? { executablePath: process.env.E2E_CHROMIUM_EXECUTABLE } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node tests/fixtures/run-auth-app.mjs",
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
