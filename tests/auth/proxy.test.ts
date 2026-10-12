import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ createServerClient: vi.fn(), getClaims: vi.fn(), getSupabaseConfig: vi.fn() }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));
vi.mock("@/lib/supabase/config", () => ({
  getSupabaseConfig: mocks.getSupabaseConfig,
  authCookieOptions: { path: "/", sameSite: "lax", secure: false },
}));

import { updateSession } from "@/lib/supabase/proxy";

type CookieWrite = { name: string; value: string; options: { path: string; sameSite: "lax"; maxAge?: number } };
type CookieAdapter = { getAll: () => { name: string; value: string }[]; setAll: (values: CookieWrite[], headers: Record<string, string>) => void };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSupabaseConfig.mockReturnValue({ url: "https://example.supabase.co", publishableKey: "sb_publishable_test" });
  mocks.createServerClient.mockReturnValue({ auth: { getClaims: mocks.getClaims } });
  mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "owner-id", is_anonymous: false } }, error: null });
});

function adapter(): CookieAdapter {
  return mocks.createServerClient.mock.calls.at(-1)?.[2].cookies;
}

describe("Next.js auth-refresh proxy", () => {
  it("refreshes claims and blocks caching of authenticated private responses", async () => {
    const response = await updateSession(new NextRequest("https://app.example/dashboard"));
    expect(mocks.getClaims).toHaveBeenCalledTimes(1);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
  });

  it.each([
    { data: null, error: null },
    { data: { claims: {} }, error: null },
    { data: { claims: { sub: "owner-id" } }, error: { message: "invalid signature" } },
    { data: { claims: { sub: "anonymous-id", is_anonymous: true } }, error: null },
  ])("redirects absent, invalid or anonymous claims without preserving unsafe query input %#", async (result) => {
    mocks.getClaims.mockResolvedValue(result);
    const response = await updateSession(new NextRequest("https://app.example/markets?next=https://evil.example"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://app.example/login?next=%2Fmarkets");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("keeps the public login reachable without configuration but protects the workspace", async () => {
    mocks.getSupabaseConfig.mockReturnValue(null);
    const login = await updateSession(new NextRequest("https://app.example/login"));
    expect(login.headers.get("location")).toBeNull();
    const privatePage = await updateSession(new NextRequest("https://app.example/settings"));
    expect(privatePage.headers.get("location")).toBe("https://app.example/login?next=%2Fsettings");
    expect(mocks.createServerClient).not.toHaveBeenCalled();
  });

  it("propagates refreshed cookies to the downstream request and browser and preserves SDK response headers", async () => {
    const request = new NextRequest("https://app.example/dashboard", { headers: { cookie: "sb-example-auth-token.0=old; other=untouched" } });
    const writes: CookieWrite[] = [
      { name: "sb-example-auth-token.0", value: "fresh", options: { path: "/", sameSite: "lax" } },
      { name: "sb-example-auth-token.1", value: "", options: { path: "/", sameSite: "lax", maxAge: 0 } },
    ];
    mocks.getClaims.mockImplementation(async () => {
      expect(adapter().getAll()).toContainEqual({ name: "other", value: "untouched" });
      adapter().setAll(writes, { "Cache-Control": "private, no-store", "X-Auth-Refresh": "completed" });
      return { data: { claims: { sub: "owner-id" } }, error: null };
    });
    const response = await updateSession(request);
    expect(request.cookies.get("sb-example-auth-token.0")?.value).toBe("fresh");
    expect(response.cookies.get("sb-example-auth-token.0")?.value).toBe("fresh");
    expect(response.cookies.get("sb-example-auth-token.1")?.maxAge).toBe(0);
    expect(response.headers.get("x-middleware-request-cookie")).toContain("sb-example-auth-token.0=fresh");
    expect(response.headers.get("x-auth-refresh")).toBe("completed");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("retains session-deletion cookies and cache protection when a refresh failure redirects", async () => {
    mocks.getClaims.mockImplementation(async () => {
      adapter().setAll([{ name: "sb-example-auth-token", value: "", options: { path: "/", sameSite: "lax", maxAge: 0 } }], { "Cache-Control": "private, no-store", Pragma: "no-cache", Expires: "0" });
      return { data: null, error: { message: "expired refresh token" } };
    });
    const response = await updateSession(new NextRequest("https://app.example/performance"));
    expect(response.headers.get("location")).toBe("https://app.example/login?next=%2Fperformance");
    expect(response.cookies.get("sb-example-auth-token")?.maxAge).toBe(0);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("pragma")).toBe("no-cache");
    expect(response.headers.get("expires")).toBe("0");
  });
});
