import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

const protectedPaths = ["/dashboard", "/markets", "/agent", "/trades", "/performance", "/settings", "/live"];
const email = "owner@example.test";
const password = "fixture-password-only";
const authURL = `http://127.0.0.1:${process.env.E2E_AUTH_PORT ?? "54339"}`;
const cookieName = "sb-127-auth-token";

type Session = { access_token: string; refresh_token: string; expires_at: number; user: { is_anonymous: boolean } };

async function makeSession(request: APIRequestContext, options: { expired?: boolean; forged?: boolean; disabled?: boolean; anonymous?: boolean; invalidRefresh?: boolean } = {}): Promise<Session> {
  const result = await request.post(`${authURL}/__test/session`, { data: options });
  expect(result.ok()).toBeTruthy();
  return result.json();
}

function encodeSession(session: Session) {
  return `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`;
}

async function setSession(context: BrowserContext, session: Session) {
  await context.addCookies([{ name: cookieName, value: encodeSession(session), domain: "127.0.0.1", path: "/", sameSite: "Lax" }]);
}

async function login(page: Page, next = "/dashboard") {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${next}$`));
}

test.beforeEach(async ({ request }) => {
  const result = await request.post(`${authURL}/__test/portfolio/reset`);
  expect(result.ok()).toBeTruthy();
});

test("all application pages redirect logged-out visitors without exposing portfolio content", async ({ request, page }) => {
  for (const path of protectedPaths) {
    const result = await request.get(path, { maxRedirects: 0 });
    expect(result.status()).toBe(307);
    const redirect = new URL(result.headers().location, result.url());
    expect(redirect.pathname).toBe("/login");
    expect(redirect.searchParams.get("next")).toBe(path);
    expect(result.headers()["cache-control"]).toContain("no-store");
  }
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
  await expect(page.getByText("Virtual portfolio value", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /sign up|register/i })).toHaveCount(0);
});

test("invalid credentials show a generic failure and never create a session", async ({ page, context }) => {
  await page.goto("/login");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("wrong-fixture-password");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Unable to sign in." })).toContainText("Unable to sign in. Check your email and password and try again.");
  await expect(page).toHaveURL(/\/login/);
  expect((await context.cookies()).some((cookie) => cookie.name.startsWith(cookieName))).toBe(false);
});

test("login, all private pages, reload and a second tab preserve an authenticated session", async ({ page, context }) => {
  await login(page, "/markets");
  for (const path of protectedPaths) {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page.getByRole("button", { name: "Log out", exact: true })).toBeVisible();
  }
  await page.goto("/dashboard");
  await expect(page.getByRole("button", { name: "Initialize virtual portfolio", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Initialize virtual portfolio", exact: true }).click();
  await expect(page.getByText("Virtual portfolio value", { exact: true })).toBeVisible();
  await expect(page.getByTestId("portfolio-total")).toHaveText("€500.00");
  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  const secondTab = await context.newPage();
  await secondTab.goto("/settings");
  await expect(secondTab.getByRole("button", { name: "Log out", exact: true })).toBeVisible();
  await secondTab.close();
  await page.goto("/login");
  await expect(page).toHaveURL(/\/dashboard$/);
});

test("logout clears browser session cookies and protects subsequent navigation", async ({ page, context, request }) => {
  await login(page);
  const before = await request.get(`${authURL}/__test/stats`).then((result) => result.json());
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  const after = await request.get(`${authURL}/__test/stats`).then((result) => result.json());
  expect(after.logout).toBeGreaterThan(before.logout);
  expect((await context.cookies()).filter((cookie) => cookie.name.startsWith(cookieName) && cookie.value)).toHaveLength(0);
  await page.goto("/trades");
  await expect(page).toHaveURL(/\/login\?next=%2Ftrades$/);
});

test("a forged session cookie is rejected by the Auth server", async ({ page, context, request }) => {
  // Invalid refresh credentials prevent automatic renewal from repairing a forgery.
  await setSession(context, await makeSession(request, { forged: true, invalidRefresh: true }));
  const before = await request.get(`${authURL}/__test/stats`).then((result) => result.json());
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText("Virtual portfolio value", { exact: true })).toHaveCount(0);
  const after = await request.get(`${authURL}/__test/stats`).then((result) => result.json());
  expect(after.rejected).toBeGreaterThan(before.rejected);
});

test("users rejected by Auth and anonymous Supabase users cannot enter the private workspace", async ({ page, context, request }) => {
  for (const options of [{ disabled: true }, { anonymous: true }]) {
    await context.clearCookies();
    await setSession(context, await makeSession(request, options));
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("button", { name: "Log out", exact: true })).toHaveCount(0);
  }
});

test("an expired signed access token refreshes through the proxy and sends fresh cookies with no-store headers", async ({ context, request }) => {
  const expired = await makeSession(request, { expired: true });
  await setSession(context, expired);
  const before = await request.get(`${authURL}/__test/stats`).then((result) => result.json());
  const response = await context.request.get("/dashboard", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(response.headers()["set-cookie"]).toContain(cookieName);
  const after = await request.get(`${authURL}/__test/stats`).then((result) => result.json());
  expect(after.refresh).toBeGreaterThan(before.refresh);
  const refreshedCookie = (await context.cookies()).find((cookie) => cookie.name === cookieName);
  expect(refreshedCookie?.value).not.toBe(encodeSession(expired));
  const second = await context.request.get("/markets", { maxRedirects: 0 });
  expect(second.status()).toBe(200);
});

test("failed token refresh redirects to login without private content", async ({ context, request }) => {
  await setSession(context, await makeSession(request, { expired: true, invalidRefresh: true }));
  const response = await context.request.get("/performance", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(new URL(response.headers().location, response.url()).pathname).toBe("/login");
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect(await response.text()).not.toContain("Portfolio performance");
});

test("external and unrecognised login return targets cannot produce an open redirect", async ({ page, context }) => {
  for (const next of ["https://example.com/steal", "//example.com/steal", "/unknown", "/markets?next=https://example.com"]) {
    await context.clearCookies();
    await page.goto(`/login?next=${encodeURIComponent(next)}`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  }
});

test("mobile login and authenticated navigation fit the viewport with Live still unavailable", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/login");
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: ".tmp/e2e-mobile-login.png", fullPage: true });
  await login(page);
  await expect(page.getByRole("heading", { name: "AI Investor", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByText("Navigation", { exact: true }).click();
  await page.locator('a[href="/markets"]:visible').first().click();
  await expect(page).toHaveURL(/\/markets$/);
  await page.goto("/live");
  await expect(page.getByRole("heading", { name: "Live trading is not available", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Live mode unavailable", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: /trade|buy|sell|enable live/i })).toHaveCount(0);
  await page.screenshot({ path: ".tmp/e2e-mobile-live.png", fullPage: true });
});
