const privatePaths = new Set([
  "/dashboard", "/markets", "/agent", "/trades", "/performance", "/settings", "/live",
]);

// Only application destinations are accepted; never redirect to a supplied origin.
export function safeReturnPath(value: unknown): string {
  return typeof value === "string" && privatePaths.has(value) ? value : "/dashboard";
}

export function isPrivatePath(pathname: string): boolean {
  return [...privatePaths].some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
