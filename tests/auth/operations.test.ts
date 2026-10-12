import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
  createServerSupabaseClient: vi.fn(),
  getSupabaseConfig: vi.fn(),
  redirect: vi.fn((path: string): never => { throw new Error(`REDIRECT:${path}`); }),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/config", () => ({ getSupabaseConfig: mocks.getSupabaseConfig }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: mocks.createServerSupabaseClient }));

import { getAuthenticatedUser, requireUser } from "@/lib/auth/user";
import { logout } from "@/lib/auth/actions";
import { login } from "@/app/login/actions";

const user = { id: "a1111111-1111-4111-8111-111111111111", email: "owner@example.test", is_anonymous: false };
const genericFailure = "Unable to sign in. Check your email and password and try again.";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSupabaseConfig.mockReturnValue({ url: "https://example.supabase.co", publishableKey: "sb_publishable_test" });
  mocks.getUser.mockResolvedValue({ data: { user }, error: null });
  mocks.signOut.mockResolvedValue({ error: null });
  mocks.signInWithPassword.mockResolvedValue({ data: { user }, error: null });
  mocks.createServerSupabaseClient.mockResolvedValue({ auth: { getUser: mocks.getUser, signOut: mocks.signOut, signInWithPassword: mocks.signInWithPassword } });
});

function loginForm(email: unknown = "owner@example.test", password: unknown = "test-password", next: unknown = "/markets") {
  const form = new FormData();
  if (typeof email === "string") form.set("email", email);
  if (typeof password === "string") form.set("password", password);
  if (typeof next === "string") form.set("next", next);
  return form;
}

describe("independent server authentication", () => {
  it("uses verified Auth getUser results to authorise the current owner", async () => {
    expect(await requireUser()).toEqual(user);
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
  });

  it.each([
    { data: { user: null }, error: null },
    { data: { user }, error: { message: "forged token" } },
    { data: { user: { ...user, is_anonymous: true } }, error: null },
  ])("denies an absent, invalid or anonymous user %#", async (result) => {
    mocks.getUser.mockResolvedValue(result);
    expect(await getAuthenticatedUser()).toBeNull();
    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
  });

  it("fails closed without configured Supabase access", async () => {
    mocks.getSupabaseConfig.mockReturnValue(null);
    expect(await getAuthenticatedUser()).toBeNull();
    await expect(requireUser()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.createServerSupabaseClient).not.toHaveBeenCalled();
  });

  it("does not authorise an owner when Auth verification throws", async () => {
    mocks.getUser.mockRejectedValue(new Error("Auth provider unavailable"));
    await expect(requireUser()).rejects.toThrow();
    expect(mocks.redirect).not.toHaveBeenCalledWith("/dashboard");
  });
});

describe("logout server operation", () => {
  it("verifies the user independently before requesting local-session revocation", async () => {
    await expect(logout()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.getUser).toHaveBeenCalledTimes(1);
    expect(mocks.getUser.mock.invocationCallOrder[0]).toBeLessThan(mocks.signOut.mock.invocationCallOrder[0]);
    expect(mocks.createServerSupabaseClient).toHaveBeenLastCalledWith({ writeCookies: true });
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("denies a direct unauthenticated call before revoking a session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(logout()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.signOut).not.toHaveBeenCalled();
  });

  it("does not report successful logout if session revocation fails", async () => {
    mocks.signOut.mockResolvedValue({ error: { message: "provider-secret-not-for-user" } });
    expect(await logout()).toEqual({ error: "Unable to log out. Please try again." });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});

describe("login server operation", () => {
  it.each([
    [null, "password"], ["owner@example.test", null], ["not-email", "password"],
    ["owner@example.test", ""], ["a".repeat(245) + "@example.test", "password"],
    ["owner@example.test", "a".repeat(1025)],
  ])("rejects invalid or oversized credentials without contacting Auth %#", async (email, password) => {
    expect(await login({ error: null }, loginForm(email, password))).toEqual({ error: genericFailure });
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("accepts the exact email and password length boundaries", async () => {
    const email = "a".repeat(241) + "@example.test";
    expect(email.length).toBe(254);
    await expect(login({ error: null }, loginForm(email, "p".repeat(1024)))).rejects.toThrow("REDIRECT:/markets");
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email, password: "p".repeat(1024) });
  });

  it.each([
    { data: { user: null }, error: { message: "User not found" } },
    { data: { user }, error: { message: "Password incorrect" } },
    { data: { user: { ...user, is_anonymous: true } }, error: null },
  ])("returns a generic failure without disclosing provider/account details %#", async (result) => {
    mocks.signInWithPassword.mockResolvedValue(result);
    expect(await login({ error: null }, loginForm())).toEqual({ error: genericFailure });
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("writes the session through the server client and trims the email, not the password", async () => {
    await expect(login({ error: null }, loginForm(" owner@example.test ", " password with spaces ", "/settings"))).rejects.toThrow("REDIRECT:/settings");
    expect(mocks.createServerSupabaseClient).toHaveBeenCalledWith({ writeCookies: true });
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({ email: "owner@example.test", password: " password with spaces " });
  });

  it("rejects a malicious hidden return value even on a direct server operation", async () => {
    await expect(login({ error: null }, loginForm("owner@example.test", "password", "https://evil.example"))).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("does not attempt to authenticate when configuration is unavailable", async () => {
    mocks.getSupabaseConfig.mockReturnValue(null);
    expect(await login({ error: null }, loginForm())).toEqual({ error: "Sign-in is currently unavailable. Please contact the workspace owner." });
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });
});
