import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import type { MarketSnapshot } from "../../lib/markets/types";

const authURL = `http://127.0.0.1:${process.env.E2E_AUTH_PORT ?? "54339"}`;
const marketURL = `http://127.0.0.1:${process.env.E2E_MARKET_PORT ?? "54340"}`;

async function login(page: Page, target = "/markets") {
  await page.goto(`/login?next=${encodeURIComponent(target)}`);
  await page.getByLabel("Email", { exact: true }).fill("owner@example.test");
  await page.getByLabel("Password", { exact: true }).fill("fixture-password-only");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${target}$`));
}

async function fixtureStats(request: APIRequestContext, origin: string, path: string) {
  const response = await request.get(`${origin}${path}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function pauseClock(page: Page) {
  // Let navigation/hydration run normally first, then stop wall-clock drift
  // while assertions and intercepted network responses are being processed.
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1_000));
}

function snapshots(at: string, price = "65001.98765432"): MarketSnapshot[] {
  return ["BTC-EUR", "ETH-EUR"].map((product) => ({
    product: product as MarketSnapshot["product"],
    status: "fresh",
    error: null,
    quote: {
      product: product as MarketSnapshot["product"],
      price: product === "BTC-EUR" ? price : "3201.23456789",
      priceKind: "last_trade",
      change24h: null,
      volume24h: null,
      bid: null,
      ask: null,
      source: "Coinbase Advanced Trade public API",
      fetchedAt: at,
      exchangeAt: new Date(Date.parse(at) - 2_000).toISOString(),
    },
  }));
}

test.beforeEach(async ({ request }) => {
  // This is the existing disposable ledger fixture, never hosted Supabase.
  const response = await request.post(`${authURL}/__test/portfolio/reset`);
  expect(response.ok()).toBeTruthy();
});

test("anonymous market page and polling requests redirect before any Coinbase request", async ({ request, page }) => {
  const before = await fixtureStats(request, marketURL, "/__test/stats");
  for (const path of ["/markets", "/markets/data"]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(307);
    expect(new URL(response.headers().location, response.url()).pathname).toBe("/login");
    expect(response.headers()["cache-control"]).toContain("no-store");
    expect(await response.text()).not.toContain("65000.12345678");
  }
  await page.goto("/markets");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByTestId("market-card-BTC-EUR")).toHaveCount(0);
  const after = await fixtureStats(request, marketURL, "/__test/stats");
  expect(after.requests).toBe(before.requests);
});

test("public BTC and ETH data display precise EUR formatting, provenance and distinct UTC times", async ({ page, request }) => {
  await login(page);
  const bitcoin = page.getByTestId("market-card-BTC-EUR");
  const ethereum = page.getByTestId("market-card-ETH-EUR");
  await expect(bitcoin).toContainText("Bitcoin");
  await expect(bitcoin).toContainText("BTC-EUR");
  await expect(ethereum).toContainText("Ethereum");
  await expect(ethereum).toContainText("ETH-EUR");
  await expect(page.getByTestId("market-price-BTC-EUR")).toHaveText("€65,000.12");
  await expect(page.getByTestId("market-price-ETH-EUR")).toHaveText("€3,200.46");
  await expect(bitcoin).toContainText("+2.35%");
  await expect(ethereum).toContainText("−1.23%");
  await expect(bitcoin).toContainText("123.456789123456 BTC");
  await expect(ethereum).toContainText("4,567.123456789123 ETH");
  await expect(bitcoin).toContainText("€65,000.13");
  await expect(ethereum).toContainText("€3,200.45");
  for (const card of [bitcoin, ethereum]) {
    for (const label of ["24-hour change", "24-hour volume", "Best bid", "Best ask", "Fetched by app", "Last trade on Coinbase"]) {
      await expect(card.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(card.getByText("Coinbase Advanced Trade public API", { exact: true })).toBeVisible();
    await expect(card.getByText("Last trade price", { exact: true })).toBeVisible();
    await expect(card.locator('[data-testid^="market-status-"]')).toHaveText("Recent fetch");
    const times = await card.locator("time").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("datetime")));
    expect(times).toHaveLength(2);
    expect(times.every((value) => value !== null && value.endsWith("Z"))).toBe(true);
    expect(times[0]).not.toBe(times[1]);
  }
  await expect(page.getByText("Times shown in UTC. Last trade time does not date the bid/ask snapshot.", { exact: true })).toBeVisible();
  const stats = await fixtureStats(request, marketURL, "/__test/stats");
  expect(stats.products).toBeGreaterThanOrEqual(2);
  expect(stats.tickers).toBeGreaterThanOrEqual(2);
  expect(stats.paths.every((path: string) => /^\/api\/v3\/brokerage\/market\/products\/(BTC-EUR|ETH-EUR)(\/ticker)?$/.test(path))).toBe(true);
  expect(await fixtureStats(request, authURL, "/__test/portfolio/stats")).toMatchObject({ portfolios: 0, ledger_entries: 0 });
  await page.screenshot({ path: ".tmp/e2e-desktop-markets.png", fullPage: true, style: "nextjs-portal { display: none !important; }" });
});

test("visible markets poll once per minute and replace prices without inventing optional metrics", async ({ page }) => {
  await page.clock.install({ time: new Date() });
  await login(page);
  await pauseClock(page);
  let calls = 0;
  await page.route("**/markets/data", async (route) => {
    calls += 1;
    const now = await page.evaluate(() => new Date().toISOString());
    await route.fulfill({ json: snapshots(now) });
  });
  await page.clock.runFor(30_000);
  expect(calls).toBe(0);
  await page.clock.runFor(30_100);
  await expect.poll(() => calls).toBe(1);
  await expect(page.getByTestId("market-price-BTC-EUR")).toHaveText("€65,001.99");
  await expect(page.getByTestId("market-price-ETH-EUR")).toHaveText("€3,201.23");
  await expect(page.getByTestId("market-card-BTC-EUR")).not.toContainText("+2.35%");
  await expect(page.getByTestId("market-card-BTC-EUR")).not.toContainText("123.456789123456 BTC");
  await expect(page.getByTestId("market-card-BTC-EUR")).not.toContainText("€65,000.13");
  await page.clock.runFor(60_000);
  await expect.poll(() => calls).toBe(2);
});

test("a suspended hidden page stops provider polling and hides expired numeric values", async ({ page }) => {
  await page.clock.install({ time: new Date() });
  await login(page);
  await pauseClock(page);
  let calls = 0;
  await page.route("**/markets/data", async (route) => {
    calls += 1;
    const now = await page.evaluate(() => new Date().toISOString());
    await route.fulfill({ json: snapshots(now) });
  });
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(125_000);
  expect(calls).toBe(0);
  for (const product of ["BTC-EUR", "ETH-EUR"]) {
    const card = page.getByTestId(`market-card-${product}`);
    await expect(page.getByTestId(`market-status-${product}`)).toHaveText("Stale");
    await expect(page.getByTestId(`market-price-${product}`)).toHaveText("Price unavailable");
    await expect(card).not.toContainText("65,000.12");
    await expect(card).not.toContainText("3,200.46");
    await expect(card).not.toContainText("2.35%");
    await expect(card).not.toContainText("1.23%");
    await expect(card).not.toContainText("123.456789123456 BTC");
    await expect(card).not.toContainText("4,567.123456789123 ETH");
    await expect(card.getByText("Fetched by app", { exact: true })).toBeVisible();
    await expect(card.getByText("Last trade on Coinbase", { exact: true })).toBeVisible();
  }
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  // Complete the asynchronous HTTP refresh before advancing through its
  // deadline. A suspended tab cannot make an outstanding request immortal.
  await expect.poll(() => calls).toBe(1);
  await expect(page.getByTestId("market-price-BTC-EUR")).toHaveText("€65,001.99");
  await page.clock.runFor(59_000);
  expect(calls).toBe(1);
  // The five-second scheduler must honor the sixty-second minimum and issue
  // the next attempt within one tick, including after a visibility refresh.
  await page.clock.runFor(6_000);
  await expect.poll(() => calls).toBe(2);
  await expect(page.getByTestId("market-price-BTC-EUR")).toHaveText("€65,001.99");
});

test("an unavailable polling response removes old prices and recovers on the next valid update", async ({ page }) => {
  await page.clock.install({ time: new Date() });
  await login(page);
  await pauseClock(page);
  let unavailable = true;
  await page.route("**/markets/data", async (route) => {
    if (unavailable) {
      await route.fulfill({ json: ["BTC-EUR", "ETH-EUR"].map((product) => ({ product, status: "unavailable", quote: null, error: "NETWORK" })) });
    } else {
      const now = await page.evaluate(() => new Date().toISOString());
      await route.fulfill({ json: snapshots(now) });
    }
  });
  await page.clock.runFor(60_100);
  for (const product of ["BTC-EUR", "ETH-EUR"]) {
    const card = page.getByTestId(`market-card-${product}`);
    await expect(page.getByTestId(`market-status-${product}`)).toHaveText("Unavailable");
    await expect(page.getByTestId(`market-price-${product}`)).toHaveText("Price unavailable");
    await expect(card).not.toContainText("€65,000.12");
    await expect(card).not.toContainText("€3,200.46");
    await expect(card.getByText("Coinbase Advanced Trade public API", { exact: true })).toBeVisible();
  }
  unavailable = false;
  await page.clock.runFor(60_000);
  await expect(page.getByTestId("market-price-BTC-EUR")).toHaveText("€65,001.99");
  await expect(page.getByTestId("market-status-BTC-EUR")).toHaveText("Recent fetch");
});

for (const badPrice of ["NaN", "0"]) {
  test(`malformed polling price ${badPrice} fails closed instead of retaining previous numeric quotes`, async ({ page }) => {
    await page.clock.install({ time: new Date() });
    await login(page);
    await pauseClock(page);
    await page.route("**/markets/data", async (route) => {
      const now = await page.evaluate(() => new Date().toISOString());
      await route.fulfill({ json: snapshots(now, badPrice) });
    });
    await page.clock.runFor(60_100);
    for (const product of ["BTC-EUR", "ETH-EUR"]) {
      await expect(page.getByTestId(`market-status-${product}`)).toHaveText("Unavailable");
      await expect(page.getByTestId(`market-price-${product}`)).toHaveText("Price unavailable");
      await expect(page.getByTestId(`market-card-${product}`)).not.toContainText("€65,000.12");
      await expect(page.getByTestId(`market-card-${product}`)).not.toContainText("€3,200.46");
      await expect(page.getByTestId(`market-card-${product}`)).not.toContainText("€0.00");
      await expect(page.getByTestId(`market-card-${product}`)).not.toContainText("NaN");
    }
  });
}

test("a pending refresh cannot overlap eligible visibility requests and polling recovers", async ({ page }) => {
  await page.clock.install({ time: new Date() });
  await login(page);
  await pauseClock(page);
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  let calls = 0;
  await page.route("**/markets/data", async (route) => {
    calls += 1;
    if (calls === 1) await held;
    const now = await page.evaluate(() => new Date().toISOString());
    await route.fulfill({ json: snapshots(now) });
  });
  try {
    await page.clock.runFor(60_100);
    await expect.poll(() => calls).toBe(1);
    // Move only Date.now, leaving the twenty-second timeout untouched. The
    // visibility requests now qualify for the minute throttle but must still
    // be refused while the original request remains in flight.
    await page.clock.setSystemTime(await page.evaluate(() => Date.now() + 60_000));
    await page.evaluate(() => {
      for (let i = 0; i < 3; i += 1) document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(calls).toBe(1);
    release();
    await expect(page.getByTestId("market-price-BTC-EUR")).toHaveText("€65,001.99");
    // The Date adjustment already made another attempt eligible. Advance only
    // to the next scheduler tick, then let its HTTP response complete before
    // approaching that request's twenty-second deadline.
    await page.clock.runFor(5_000);
    await expect.poll(() => calls).toBe(2);
    await expect(page.getByTestId("market-status-BTC-EUR")).toHaveText("Recent fetch");
  } finally {
    release();
  }
});

test("a polling timeout hides old prices and the next scheduled request recovers", async ({ page }) => {
  await page.clock.install({ time: new Date() });
  await login(page);
  await pauseClock(page);
  let calls = 0;
  await page.route("**/markets/data", async (route) => {
    calls += 1;
    // Deliberately leave the first intercepted request unanswered. The real
    // client deadline must cancel it; later requests return a valid quote.
    if (calls === 1) return;
    const now = await page.evaluate(() => new Date().toISOString());
    await route.fulfill({ json: snapshots(now) });
  });
  await page.clock.runFor(60_100);
  await expect.poll(() => calls).toBe(1);
  await page.clock.runFor(20_100);
  for (const product of ["BTC-EUR", "ETH-EUR"]) {
    await expect(page.getByTestId(`market-status-${product}`)).toHaveText("Unavailable");
    await expect(page.getByTestId(`market-price-${product}`)).toHaveText("Price unavailable");
  }
  await page.clock.runFor(40_000);
  await expect.poll(() => calls).toBe(2);
  await expect(page.getByTestId("market-price-BTC-EUR")).toHaveText("€65,001.99");
  await expect(page.getByTestId("market-status-BTC-EUR")).toHaveText("Recent fetch");
});

test("expired client authentication redirects to login during automatic market refresh", async ({ page, context, request }) => {
  await page.clock.install({ time: new Date() });
  await login(page);
  await pauseClock(page);
  const before = await fixtureStats(request, marketURL, "/__test/stats");
  await context.clearCookies();
  await page.clock.runFor(60_100);
  await expect(page).toHaveURL(/\/login\?next=(%2F|\/)markets$/);
  await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
  await expect(page.getByTestId("market-card-BTC-EUR")).toHaveCount(0);
  const after = await fixtureStats(request, marketURL, "/__test/stats");
  expect(after.requests).toBe(before.requests);
});

test("mobile market browsing leaves the persisted EUR portfolio and locked Live mode unchanged", async ({ page, request }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, "/dashboard");
  await page.getByRole("button", { name: "Initialize virtual portfolio", exact: true }).click();
  await expect(page.getByTestId("portfolio-total")).toHaveText("€500.00");
  const before = await fixtureStats(request, authURL, "/__test/portfolio/stats");
  await page.goto("/markets");
  await expect(page.getByTestId("market-price-BTC-EUR")).toHaveText("€65,000.12");
  await expect(page.getByTestId("market-price-ETH-EUR")).toHaveText("€3,200.46");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: ".tmp/e2e-mobile-markets.png", fullPage: true, style: "nextjs-portal { display: none !important; }" });
  await page.goto("/dashboard");
  await expect(page.getByTestId("portfolio-total")).toHaveText("€500.00");
  await expect(page.getByTestId("portfolio-eur")).toHaveText("€500.00");
  await expect(page.getByTestId("portfolio-btc")).toHaveText("0 BTC");
  await expect(page.getByTestId("portfolio-eth")).toHaveText("0 ETH");
  await expect(page.getByTestId("portfolio-pnl")).toHaveText("€0.00");
  expect(await fixtureStats(request, authURL, "/__test/portfolio/stats")).toEqual(before);
  await page.goto("/live");
  await expect(page.getByRole("button", { name: "Live mode unavailable", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /buy|sell|trade|enable live/i })).toHaveCount(0);
});
