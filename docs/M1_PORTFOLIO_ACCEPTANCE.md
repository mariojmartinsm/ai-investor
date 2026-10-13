# M1 portfolio foundation acceptance

Scope: **FR-010, initial FR-011 and initial FR-013**. The implementation plan
maps initialization to AI-015. The existing migration retains its original
identity: `20261013085416_ai_003_initialize_dry_run_portfolio.sql`.

## Requirement mapping

| Requirement | Implementation |
| --- | --- |
| FR-010 | Reuse the unique owner/DRY_RUN portfolio; lock the owner and portfolio rows; atomically append exactly one EUR 500 initial funding posting. Repeated setup preserves existing balances. |
| FR-013 initial funding | Existing numeric(28,12) ledger, unique funding index, exact funding constraint, append-only trigger, owner RLS and denied client writes. |
| FR-011 initial dashboard | Ledger-derived available EUR and NAV, zero BTC/ETH and initial zero cumulative P&L; explicit empty, loading and retryable error states. |

The authenticated server action uses the owner's cookie client and passes the
verified owner's UUID to the existing `initialize_dry_run_portfolio` RPC.
Reads use `get_dry_run_portfolio` with the same verified owner. The only
privileged writer is in the unexposed private schema, checks the authenticated
owner and nonanonymous Auth user, and accepts no amount, currency or mode.
Execution is revoked from PUBLIC, anon and service_role. Public wrappers are
security invokers. No service credentials are used by this feature.

The feature covers the initial all-cash dashboard. Nonzero crypto requires
timestamped market valuation and currently fails closed. LIVE remains locked;
there is no live order capability, Coinbase integration, BUY/SELL or Cron in
this phase.

## Verification on 13 October 2026

| Command | Result |
| --- | --- |
| `npm run lint` | Passed. |
| `npm run typecheck` | Passed. |
| `npm test` | 226 tests passed across nine files. |
| `npm run test:concurrency` | Passed both SQL acceptance scripts, overlapping commit/rollback lock scenarios with two contenders, retry and injected-failure rollback checks. |
| `npm run test:e2e` | All 19 browser tests passed. |
| `npm run build` | Passed. |
| `npm audit --omit=dev` | Zero production dependency vulnerabilities. |

All local suites use isolated fixtures; the real hosted portfolio balance and
funding entry remained unchanged.

### Defects corrected

- An accidental `npm run dev` prefix before the dashboard server action caused
  lint, TypeScript and build failures. The prefix was removed, and regression
  tests now exercise the actual authenticated action, including verified-owner
  RPC calls and failures.
- Playwright's required browser was unavailable. Installing its browser restored
  the default E2E command without disabling tests or substituting application
  authentication.
- Native PostgreSQL test socket configuration was made portable for Unix CI
  while preserving isolated clusters and real concurrent transaction checks.

Native PostgreSQL tests use a disposable local cluster and never connect to an
application database. Set `PG_TEST_BIN` to a directory containing `initdb`,
`pg_ctl` and `psql` if they are absent from PATH. Windows sandbox restrictions
may prevent `pg_ctl` from starting; report that limitation instead of skipping
the concurrency gate.

Install the Playwright browser with `npx playwright install chromium`, or set
`E2E_CHROMIUM_EXECUTABLE` to an installed Chrome executable. Browser tests use
isolated Auth and database fixtures and exercise the actual SSR clients and
owner-scoped RPCs. They do not replace an existing-owner hosted login smoke
test.

## Database and migration status

Both version-controlled migrations are already applied to the workspace
Supabase project. The existing initializer and read RPCs are reused. No new or
duplicate migration is needed, and no existing financial records are reset,
rewritten or reseeded. Keep `private` unexposed. For new environments, follow
README's safe migration deployment instructions.

Read-only hosted verification on 13 October 2026 confirmed exactly one DRY_RUN
portfolio (`6254842d-33a6-4882-b297-e7bff2a94385`), exactly one ledger entry of
type `INITIAL_CAPITAL` for `+500.000000000000` EUR, and balances of **€500.00
virtual EUR, 0 BTC and 0 ETH**. RLS is enabled on both financial tables;
authenticated browser roles have no INSERT, UPDATE or DELETE privileges.
The applied initializer SQL matches the local migration after comment and
whitespace normalization, as established by the earlier migration verification.
No hosted writes or migration replay occurred in this phase. Idempotency,
simultaneous requests, owner isolation, direct ledger write denial, append-only
protection and failure recovery are exercised using disposable fixtures.

Previous hosted verification ran `tests/database/hosted-portfolio.sql` with all
synthetic users and financial fixtures rolled back. Current security review
found no financial RLS or database-function warnings. The existing
leaked-password-protection warning remains: Supabase offers this feature on
Pro plans and above. It is reviewed as nonblocking Auth hardening for this
existing-owner phase, which introduces no signup or password-change paths.
See [Supabase password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Manual acceptance

1. Sign in as the existing confirmed owner. Check total/available EUR
   **€500.00**, **0 BTC**, **0 ETH** and cumulative P&L **€0.00**. Do not reset
   or top up this portfolio.
2. Refresh, log out and log in again. Verify the same portfolio UUID and values.
   As an administrator, use read-only queries to confirm exactly one DRY_RUN
   owner portfolio and one EUR 500 `INITIAL_CAPITAL` ledger entry.
3. In a disposable environment, verify the empty dashboard for a new fixture
   owner, initialize from two tabs and repeat setup. All requests must resolve
   to one portfolio and one initial funding entry.
4. Use isolated fixture users to confirm cross-owner reads/RPCs, anonymous
   initialization and direct client ledger writes are denied. Inject failures
   only in local fixtures and verify loading/error/retry behavior.
5. Check desktop/mobile layout and the locked Live page. No trading or
   scheduling controls should be available.

## Git delivery

The current phase authorizes commit, push, PR creation and squash merge after
local validation and required GitHub checks pass. The final report records the
commit SHA, PR URL and merge status, plus verification that local `main` equals
`origin/main` and the working tree is clean. A failed gate or missing permission
blocks merging and must be reported with the work preserved.

Recommended next PRD requirement: **FR-020**, public BTC-EUR/ETH-EUR market-data
adapter (AI-020 in the implementation plan), only after separate phase approval.
