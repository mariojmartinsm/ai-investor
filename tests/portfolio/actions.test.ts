import { beforeEach, describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";

const mocks = vi.hoisted(() => ({ initializePortfolio: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("@/lib/portfolio/server", () => ({ initializePortfolio: mocks.initializePortfolio }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

// Import the actual action so malformed source cannot escape the unit suite.
// Use Next's real redirect/rethrow behavior to check auth redirects survive
// the operational error handler instead of appearing as funding failures.
import { initializeDryRunPortfolio } from "@/app/(private)/dashboard/actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.initializePortfolio.mockResolvedValue(undefined);
});

describe("dashboard initialization action", () => {
  it("refreshes the dashboard only after the authorized initializer succeeds", async () => {
    await expect(initializeDryRunPortfolio()).rejects.toMatchObject({
      digest: "NEXT_REDIRECT;replace;/dashboard;307;",
    });
    expect(mocks.initializePortfolio).toHaveBeenCalledOnce();
    expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/dashboard");
    expect(mocks.initializePortfolio.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.revalidatePath.mock.invocationCallOrder[0]);
  });

  it("preserves the unauthenticated redirect without refreshing the dashboard", async () => {
    mocks.initializePortfolio.mockImplementation(async () => redirect("/login"));
    await expect(initializeDryRunPortfolio()).rejects.toMatchObject({
      digest: "NEXT_REDIRECT;replace;/login;307;",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("returns a retryable generic error without disclosing database details", async () => {
    mocks.initializePortfolio.mockRejectedValue(new Error("private provider or SQL details"));
    expect(await initializeDryRunPortfolio()).toEqual({
      error: "Unable to initialize your virtual portfolio. Please try again.",
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
