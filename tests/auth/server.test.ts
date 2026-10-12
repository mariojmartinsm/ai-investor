import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAll: vi.fn(),
  set: vi.fn(),
  createServerClient: vi.fn(),
  cookies: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.createServerClient }));

import { createServerSupabaseClient } from "@/lib/supabase/server";

type CookieWrite = { name: string; value: string; options: { path: string; sameSite: "lax"; secure?: boolean } };
type CookieAdapter = { getAll: () => unknown; setAll: (values: CookieWrite[]) => void };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  mocks.cookies.mockResolvedValue({ getAll: mocks.getAll, set: mocks.set });
  mocks.createServerClient.mockImplementation(() => ({ auth: {} }));
});
afterEach(() => vi.unstubAllEnvs());

function adapter(): CookieAdapter {
  return mocks.createServerClient.mock.calls.at(-1)?.[2].cookies;
}

describe("per-request server Supabase client", () => {
  it("reads the entire cookie set including chunked sessions", async () => {
    const stored = [{ name: "sb-example-auth-token.0", value: "first" }, { name: "sb-example-auth-token.1", value: "second" }];
    mocks.getAll.mockReturnValue(stored);
    await createServerSupabaseClient();
    expect(adapter().getAll()).toEqual(stored);
    expect(mocks.createServerClient).toHaveBeenCalledWith("https://example.supabase.co", "sb_publishable_test", expect.objectContaining({ cookies: expect.any(Object) }));
  });

  it("does not attempt cookie writes in read-only Server Components", async () => {
    await createServerSupabaseClient();
    adapter().setAll([{ name: "sb-example-auth-token", value: "fresh", options: { path: "/", sameSite: "lax" } }]);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("propagates all refresh, chunk and deletion cookie options in Server Actions", async () => {
    await createServerSupabaseClient({ writeCookies: true });
    const writes = [
      { name: "sb-example-auth-token.0", value: "fresh-first", options: { path: "/", sameSite: "lax" as const, secure: true } },
      { name: "sb-example-auth-token.1", value: "", options: { path: "/", sameSite: "lax" as const } },
    ];
    adapter().setAll(writes);
    for (const { name, value, options } of writes) expect(mocks.set).toHaveBeenCalledWith(name, value, options);
    expect(mocks.set).toHaveBeenCalledTimes(writes.length);
  });

  it("does not share a client between separate requests", async () => {
    const first = await createServerSupabaseClient();
    const second = await createServerSupabaseClient();
    expect(first).not.toBe(second);
    expect(mocks.cookies).toHaveBeenCalledTimes(2);
  });

  it("propagates cookie-write errors so a failed session write cannot look successful", async () => {
    mocks.set.mockImplementation(() => { throw new Error("cookie store is immutable"); });
    await createServerSupabaseClient({ writeCookies: true });
    expect(() => adapter().setAll([{ name: "session", value: "value", options: { path: "/", sameSite: "lax" } }])).toThrow("cookie store is immutable");
  });
});
