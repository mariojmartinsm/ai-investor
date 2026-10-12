import { afterEach, describe, expect, it, vi } from "vitest";
import { getSupabaseConfig, requireSupabaseConfig } from "@/lib/supabase/config";
import { isPrivatePath, safeReturnPath } from "@/lib/auth/redirect";

afterEach(() => vi.unstubAllEnvs());

function configure(url: string | undefined, key: string | undefined) {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", key);
}

describe("public Supabase configuration", () => {
  it("accepts only public keys and normalises a valid project URL", () => {
    configure(" https://example.supabase.co/ ", " sb_publishable_example123 ");
    expect(getSupabaseConfig()).toEqual({ url: "https://example.supabase.co", publishableKey: "sb_publishable_example123" });
  });

  it.each(["http://localhost:54321", "http://127.0.0.1:54321", "http://[::1]:54321"])("allows local HTTP for %s", (url) => {
    configure(url, "sb_publishable_local");
    expect(getSupabaseConfig()?.url).toBe(url);
  });

  it.each([
    undefined,
    "",
    "sb_secret_never_public",
    "service_role",
    "eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.fake",
    "sb_publishable_credential with spaces",
  ])("fails closed for missing or unsafe public key %s", (key) => {
    configure("https://example.supabase.co", key);
    expect(getSupabaseConfig()).toBeNull();
    expect(() => requireSupabaseConfig()).toThrow("Supabase public configuration is missing or invalid.");
  });

  it.each([
    undefined, "", "http://example.supabase.co", "ftp://example.supabase.co",
    "https://username:password@example.supabase.co", "https://example.supabase.co/path",
    "https://example.supabase.co?credential=forbidden", "https://example.supabase.co#fragment", "invalid-url",
  ])("rejects unsafe URL %s without echoing it in the error", (url) => {
    configure(url, "sb_publishable_example");
    expect(getSupabaseConfig()).toBeNull();
    expect(() => requireSupabaseConfig()).toThrow("Supabase public configuration is missing or invalid.");
  });
});

describe("private route return destinations", () => {
  const paths = ["/dashboard", "/markets", "/agent", "/trades", "/performance", "/settings", "/live"];
  it.each(paths)("permits the exact application path %s", (path) => {
    expect(safeReturnPath(path)).toBe(path);
    expect(isPrivatePath(path)).toBe(true);
    expect(isPrivatePath(`${path}/nested`)).toBe(true);
  });

  it.each([
    undefined, null, 123, ["/markets"], "/login", "/unknown", "https://evil.example/steal",
    "//evil.example/steal", "\\evil.example", "/markets?next=https://evil.example", "/markets#fragment",
    "/dashboard/../login", "/%2F%2Fevil.example", "javascript:alert(1)",
  ])("uses the dashboard for an unsafe return value %j", (value) => {
    expect(safeReturnPath(value)).toBe("/dashboard");
  });

  it.each(["/login", "/dashboard-malicious", "/marketplace", "/", "/favicon.ico"])("does not confuse a public/prefix route %s with a private route", (path) => {
    expect(isPrivatePath(path)).toBe(false);
  });
});
