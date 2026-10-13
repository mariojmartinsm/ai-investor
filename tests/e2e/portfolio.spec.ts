import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const authURL = `http://127.0.0.1:${process.env.E2E_AUTH_PORT ?? "54339"}`;
const ownerId = "a1111111-1111-4111-8111-111111111111";
const otherOwnerId = "b2222222-2222-4222-8222-222222222222";
const publishableKey = "sb_publishable_auth_e2e_fixture";

type Session = { access_token: string };
type PortfolioRow = { id: string; eur_balance: string; btc_balance: string; eth_balance: string; initial_funding_count: number; ledger_entry_count: number };

async function control(request: APIRequestContext, options: Record<string, number>) {
  const response = await request.post(`${authURL}/__test/portfolio/control`, { data: options });
  expect(response.ok()).toBeTruthy();
}

async function statistics(request: APIRequestContext) {
  const response = await request.get(`${authURL}/__test/portfolio/stats`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function session(request: APIRequestContext, otherOwner = false): Promise<Session> {
  const response = await request.post(`${authURL}/__test/session`, { data: { otherOwner } });
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function rpc(request: APIRequestContext, token: string, functionName: string, targetOwner = ownerId) {
  return request.post(`${authURL}/rest/v1/rpc/${functionName}`, {
    headers: { apikey: publishableKey, Authorization: `Bearer ${token}` },
    data: { p_owner_id: targetOwner },
  });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password-only");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function expectBalances(page: Page) {
  await expect(page.getByTestId("portfolio-total")).toHaveText("€500.00");
  await expect(page.getByTestId("portfolio-eur")).toHaveText("€500.00");
  await expect(page.getByTestId("portfolio-btc")).toHaveText("0 BTC");
  await expect(page.getByTestId("portfolio-eth")).toHaveText("0 ETH");
  await expect(page.getByTestId("portfolio-pnl")).toHaveText("€0.00");
  await expect(page.getByTestId("portfolio-return")).toHaveText("0.00%");
  await expect(page.getByText("Fresh valuation · Dry Run", { exact: true })).toBeVisible();
}

test.beforeEach(async ({ request }) => {
  const response = await request.post(`${authURL}/__test/portfolio/reset`);
  expect(response.ok()).toBeTruthy();
});

test("dashboard GET stays empty until explicit initialization creates exactly one virtual funding entry", async ({ page, request }) => {
  await login(page);
  await expect(page.getByRole("heading", { name: "Your virtual portfolio is not initialized", exact: true })).toBeVisible();
  await expect(page.getByTestId("portfolio-summary")).toHaveCount(0);
  await page.reload();
  expect(await statistics(request)).toMatchObject({ portfolios: 0, ledger_entries: 0, initial_funding_entries: 0, eur_balance: "0" });

  await page.getByRole("button", { name: "Initialize virtual portfolio", exact: true }).click();
  await expectBalances(page);
  await expect(page.getByText(/Portfolio created/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Initialize virtual portfolio", exact: true })).toHaveCount(0);
  expect(await statistics(request)).toMatchObject({ portfolios: 1, ledger_entries: 1, initial_funding_entries: 1, eur_balance: "500.000000000000" });
  await page.reload();
  await expectBalances(page);
  expect(await statistics(request)).toMatchObject({ portfolios: 1, ledger_entries: 1, initial_funding_entries: 1, eur_balance: "500.000000000000", reference_quotes: 2 });
  await page.screenshot({ path: ".tmp/e2e-desktop-portfolio-ready.png", fullPage: true, style: "nextjs-portal { display: none !important; }" });
});

test("an existing empty unfunded portfolio is completed without creating a second portfolio", async ({ page, request }) => {
  const prepared = await request.post(`${authURL}/__test/portfolio/unfunded`);
  expect(prepared.ok()).toBeTruthy();
  await login(page);
  await expect(page.getByRole("button", { name: "Initialize virtual portfolio", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Initialize virtual portfolio", exact: true }).click();
  await expectBalances(page);
  expect(await statistics(request)).toMatchObject({ portfolios: 1, ledger_entries: 1, initial_funding_entries: 1 });
});

test("repeated and concurrent owner RPC requests preserve one portfolio and one funding posting", async ({ page, request }) => {
  const owner = await session(request);
  const responses = await Promise.all(Array.from({ length: 6 }, () => rpc(request, owner.access_token, "initialize_dry_run_portfolio")));
  const rows: PortfolioRow[] = [];
  for (const response of responses) {
    expect(response.ok()).toBeTruthy();
    const result: PortfolioRow[] = await response.json();
    expect(result).toHaveLength(1);
    rows.push(result[0]);
  }
  expect(new Set(rows.map((row) => row.id)).size).toBe(1);
  for (const row of rows) {
    expect(row).toMatchObject({ eur_balance: "500.000000000000", btc_balance: "0.000000000000", eth_balance: "0.000000000000", initial_funding_count: 1, ledger_entry_count: 1 });
  }
  const again = await rpc(request, owner.access_token, "initialize_dry_run_portfolio");
  expect(again.ok()).toBeTruthy();
  expect(await statistics(request)).toMatchObject({ portfolios: 1, ledger_entries: 1, initial_funding_entries: 1, eur_balance: "500.000000000000" });
  await login(page);
  await expectBalances(page);
});

test("logout and subsequent login retain persisted balances without re-funding", async ({ page, request }) => {
  await login(page);
  await page.getByRole("button", { name: "Initialize virtual portfolio", exact: true }).click();
  await expectBalances(page);
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId("portfolio-summary")).toHaveCount(0);
  await login(page);
  await expectBalances(page);
  expect(await statistics(request)).toMatchObject({ portfolios: 1, ledger_entries: 1, initial_funding_entries: 1 });
});

test("nonzero BTC and ETH fixtures use persisted timestamped prices without changing ledger balances", async ({ page, request }) => {
  const seeded = await request.post(`${authURL}/__test/portfolio/nonzero`);
  expect(seeded.ok()).toBeTruthy();
  const before = await statistics(request);
  await login(page);
  await expect(page.getByTestId("portfolio-total")).toHaveText("€505.01");
  await expect(page.getByTestId("portfolio-eur")).toHaveText("€100.00");
  await expect(page.getByTestId("portfolio-btc")).toHaveText("0.005 BTC");
  await expect(page.getByTestId("portfolio-btc-value")).toHaveText("€325.00");
  await expect(page.getByTestId("portfolio-eth")).toHaveText("0.025 ETH");
  await expect(page.getByTestId("portfolio-eth-value")).toHaveText("€80.01");
  await expect(page.getByTestId("portfolio-pnl")).toHaveText("€5.01");
  await expect(page.getByTestId("portfolio-return")).toHaveText("+1.00%");
  await expect(page.getByText("Public bid/ask observed; execution is not guaranteed.")).toHaveCount(2);
  await expect(page.getByText("Realised P&L", { exact: true })).toBeVisible();
  await expect(page.getByText("Unrealised P&L", { exact: true })).toBeVisible();
  const after = await statistics(request);
  expect(after).toMatchObject({ portfolios: 1, ledger_entries: 4, initial_funding_entries: 1, eur_balance: "100.000000000000", reference_quotes: 2 });
  expect(before).toMatchObject({ portfolios: 1, ledger_entries: 4, initial_funding_entries: 1, eur_balance: "100.000000000000" });
});

test("read errors show a generic retry state and do not create financial data", async ({ page, request }) => {
  await login(page);
  await page.goto("/settings");
  await control(request, { readFailures: 1 });
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Portfolio temporarily unavailable", exact: true })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "We could not load your virtual portfolio." })).toBeVisible();
  await expect(page.getByText(/Synthetic database outage|FIXTURE_DATABASE_UNAVAILABLE/)).toHaveCount(0);
  await expect(page.getByTestId("portfolio-summary")).toHaveCount(0);
  expect(await statistics(request)).toMatchObject({ portfolios: 0, ledger_entries: 0 });
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("button", { name: "Initialize virtual portfolio", exact: true })).toBeVisible();
});

test("failed initialization is retryable, stays empty and disables submission while pending", async ({ page, request }) => {
  await login(page);
  await control(request, { initializeFailures: 1, initializeDelay: 1200 });
  await page.getByRole("button", { name: "Initialize virtual portfolio", exact: true }).click();
  await expect(page.getByRole("button", { name: "Initializing portfolio…", exact: true })).toBeDisabled();
  await expect(page.getByRole("alert").filter({ hasText: "Unable to initialize your virtual portfolio." })).toBeVisible();
  await expect(page.getByText(/Synthetic database outage|FIXTURE_DATABASE_UNAVAILABLE/)).toHaveCount(0);
  expect(await statistics(request)).toMatchObject({ portfolios: 0, ledger_entries: 0 });
  await page.getByRole("button", { name: "Initialize virtual portfolio", exact: true }).click();
  await expectBalances(page);
  expect(await statistics(request)).toMatchObject({ portfolios: 1, ledger_entries: 1, initial_funding_entries: 1 });
});

test("slow reads show a loading state before the persisted portfolio is rendered", async ({ page, request }) => {
  const owner = await session(request);
  expect((await rpc(request, owner.access_token, "initialize_dry_run_portfolio")).ok()).toBeTruthy();
  await login(page);
  await page.goto("/settings");
  await control(request, { readDelay: 2500 });
  const navigation = page.goto("/dashboard", { waitUntil: "commit" });
  await navigation;
  await expect(page.getByRole("status").filter({ hasText: "Loading your virtual portfolio…" })).toBeVisible();
  await expectBalances(page);
});

test("RPC authorization and actual PostgreSQL ownership checks deny anonymous and cross-user access", async ({ request }) => {
  const owner = await session(request);
  const otherOwner = await session(request, true);
  const anonymousResponse = await request.post(`${authURL}/__test/session`, { data: { anonymous: true } });
  expect(anonymousResponse.ok()).toBeTruthy();
  const anonymous: Session = await anonymousResponse.json();
  expect((await rpc(request, owner.access_token, "initialize_dry_run_portfolio")).ok()).toBeTruthy();
  const ownRead = await rpc(request, owner.access_token, "get_dry_run_portfolio");
  expect(ownRead.ok()).toBeTruthy();
  expect(await ownRead.json()).toHaveLength(1);
  for (const functionName of ["get_dry_run_portfolio", "initialize_dry_run_portfolio"]) {
    const denied = await rpc(request, otherOwner.access_token, functionName);
    expect(denied.status()).toBe(403);
    expect(await denied.json()).toMatchObject({ code: "42501", message: "OWNER_ACCESS_DENIED" });
    const unauthenticated = await rpc(request, "invalid-access-token", functionName);
    expect(unauthenticated.status()).toBe(401);
    const anonymousDenied = await rpc(request, anonymous.access_token, functionName);
    expect(anonymousDenied.status()).toBe(403);
    expect(await anonymousDenied.json()).toMatchObject({ code: "42501", message: "OWNER_ACCESS_DENIED" });
  }
  const emptyOwnRead = await rpc(request, otherOwner.access_token, "get_dry_run_portfolio", otherOwnerId);
  expect(emptyOwnRead.ok()).toBeTruthy();
  expect(await emptyOwnRead.json()).toEqual([]);
  expect(await statistics(request)).toMatchObject({ portfolios: 1, ledger_entries: 1, initial_funding_entries: 1 });
});

test("mobile persisted portfolio fits the viewport and retains locked Live mode", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await expect(page.getByRole("button", { name: "Initialize virtual portfolio", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: ".tmp/e2e-mobile-portfolio-empty.png", fullPage: true, style: "nextjs-portal { display: none !important; }" });
  await page.getByRole("button", { name: "Initialize virtual portfolio", exact: true }).click();
  await expectBalances(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByText("Strategy Analysis", { exact: true })).toBeVisible();
  await expect(page.getByText("Analysis only", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /buy|sell|trade|enable live/i })).toHaveCount(0);
  await page.screenshot({ path: ".tmp/e2e-mobile-portfolio-ready.png", fullPage: true, style: "nextjs-portal { display: none !important; }" });
  await page.getByRole("link", { name: "About locked Live mode", exact: true }).click();
  await expect(page.getByRole("button", { name: "Live mode unavailable", exact: true })).toBeDisabled();
});
