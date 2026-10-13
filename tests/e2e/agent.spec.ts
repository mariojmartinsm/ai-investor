import { expect, test, type Page } from "@playwright/test";

const email = "owner@example.test";
const password = "fixture-password-only";
const authURL = `http://127.0.0.1:${process.env.E2E_AUTH_PORT ?? "54339"}`;

async function login(page: Page, next = "/agent") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${next}$`));
}

test.beforeEach(async ({ request }) => {
  expect((await request.post(`${authURL}/__test/portfolio/reset`)).ok()).toBeTruthy();
});

test("manual preview stores explainable HOLD records idempotently without moving funds", async ({ page, request }) => {
  await login(page);
  await expect(page.getByText("Analysis only — no orders are executed.", { exact: true })).toBeVisible();
  await expect(page.getByText("No analysis preview yet", { exact: true })).toBeVisible();

  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Initialize virtual portfolio", exact: true }).click();
  await expect(page.getByTestId("portfolio-total")).toHaveText("€500.00");
  expect((await request.post(`${authURL}/__test/markets/history/seed`)).ok()).toBeTruthy();

  await page.goto("/agent");
  await page.getByRole("button", { name: "Run Analysis", exact: true }).click();
  await expect(page.getByText("Stored 2 analysis previews.", { exact: true })).toBeVisible();
  await expect(page.getByText("HOLD candidate", { exact: true })).toHaveCount(2);
  await expect(page.getByText("RSI14", { exact: true })).toHaveCount(2);
  await expect(page.getByText("BASELINE_V1 · TECHNICAL_V1", { exact: true })).toHaveCount(2);
  await expect(page.getByText(/NO_BUY_CONDITIONS/)).toHaveCount(2);

  const first = await request.get(`${authURL}/__test/strategy/stats`).then((response) => response.json());
  expect(first).toEqual({
    analyses: 2, candles: 800, portfolios: 1, ledger_entries: 1, initial_funding_entries: 1,
    eur_balance: "500.000000000000", btc_balance: "0", eth_balance: "0",
  });
  await page.getByRole("button", { name: "Run Analysis", exact: true }).click();
  await expect(page.getByText("Latest analysis already exists; no duplicate records were created.", { exact: true })).toBeVisible();
  expect(await request.get(`${authURL}/__test/strategy/stats`).then((response) => response.json())).toEqual(first);
  await expect(page.getByRole("button", { name: "Live mode locked and unavailable" })).toBeDisabled();
});

test("strategy workspace remains usable on mobile and never presents execution controls", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Initialize virtual portfolio", exact: true }).click();
  expect((await request.post(`${authURL}/__test/markets/history/seed`)).ok()).toBeTruthy();
  await page.goto("/agent");
  await page.getByRole("button", { name: "Run Analysis", exact: true }).click();
  await expect(page.getByTestId("analysis-BTC-EUR")).toBeVisible();
  await expect(page.getByTestId("analysis-ETH-EUR")).toBeVisible();
  await expect(page.getByRole("button", { name: /buy|sell|execute|order/i })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
