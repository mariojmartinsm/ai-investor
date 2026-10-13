# AI Investor

AI Investor is a private Dry Run-only investment dashboard for a virtual EUR, BTC and ETH portfolio. It uses Next.js 16 App Router, strict TypeScript, Tailwind CSS, shadcn/ui and Supabase Auth.

**M1 portfolio initialization implements FR-010, initial FR-011 and initial FR-013** on top of authentication and the existing database foundation. The dashboard reads your own ledger-backed virtual EUR, BTC and ETH balances. An explicit setup action creates exactly one **€500.00 virtual EUR** funding entry, with zero BTC/ETH. **M2 adds read-only public BTC-EUR and ETH-EUR current quotes plus persistent validated daily history and closing-price charts** to `/markets`. Live mode remains locked and unavailable; the agent is not configured.

## Local setup

Use **Node.js 24 LTS** and **npm**. Node.js 22.13+ within version 22 is also supported. Current Supabase clients no longer support Node.js 20. Supabase and test package versions are pinned in `package.json` and `package-lock.json`.

From the repository directory, install the locked dependencies:

```bash
npm ci
```

For an initial dependency installation or an intentional dependency update, use `npm install`. Keep the resulting `package-lock.json` with the project.

Create `.env.local` using `.env.example` as a template and set:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR_SB_PUBLISHABLE_KEY
# Required only by server-side historical ingestion. Never expose this value.
SUPABASE_SECRET_KEY=YOUR_SB_SECRET_KEY
```

Use the project's public `sb_publishable_...` key from **Connect** or **Settings → API Keys**. The first two values are intentionally public; RLS protects financial records. `SUPABASE_SECRET_KEY` is server-only and enables the authenticated historical refresh action. A legacy `SUPABASE_SERVICE_ROLE_KEY` is accepted for projects that have not migrated to secret keys. Never put either privileged value in a `NEXT_PUBLIC_` variable, frontend code or source control. Startup/build rejects invalid public configuration before compilation. `.env.local` is ignored by Git; never commit it.

Without configuration the login form is disabled and private routes redirect to login. Builds and isolated tests can run without a hosted project. Restart the dev server after changing `.env.local`.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Logged-out users reach `/login`; successful login opens `/dashboard` or the requested allowlisted workspace page. Dashboard, Markets, AI Agent, Trades, Performance, Settings and the informational locked Live page all require authentication. Root `/` redirects to the dashboard.

## Supabase setup and migrations

The existing **ai-investor** project in **eu-west-2** is configured for this workspace through ignored `.env.local`. Both `20261012065128_ai_002_auth_database_foundation.sql` and `20261013085416_ai_003_initialize_dry_run_portfolio.sql` are already applied there. On 13 October 2026, hosted migration history and the initializer/read RPCs were verified against the local implementation; the applied migration statements match the local SQL after whitespace/comment normalization. Do not replay or duplicate this migration. The owner has already initialized one DRY_RUN portfolio with one EUR `INITIAL_CAPITAL` posting and exactly **€500.00 virtual cash**. Preserve this financial history; tests use isolated fixtures. Authentication works for the existing owner. Keep email/password authentication enabled, public signup and anonymous sign-ins disabled, and configure the site URL for the environment. Other checkouts still need their own `.env.local`.

1. Create or choose the project's Supabase instance. Configure the Auth site URL as `http://localhost:3000` for local development.
2. Under Auth settings, keep email/password authentication enabled and **disable public signups and anonymous sign-ins**. There is no registration interface or signup action in this application. `supabase/config.toml` applies these defaults only to a local stack; hosted settings must be configured separately.
3. In **Authentication → Users**, manually add the owner account with a strong password and a confirmed email. Keep account passwords outside the repository. Additional manually provisioned users can access only their own rows; no user-editable metadata is trusted for authorization.
4. Apply pending version-controlled migrations only after reviewing their target. Never replay an applied migration:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --linked --dry-run --skip-vault
npx supabase db push --linked --skip-vault
```

The CLI prompts for credentials when needed; do not put secrets in command history. A migration already applied to the hosted project must be reflected in migration history before using `db push`. Avoid replaying table-creation SQL against an initialized database.

The migration creates `public.portfolios` and `public.portfolio_ledger`, with UUID keys, ownership FKs, `numeric(28,12)` values, EUR/€500 configuration, DRY_RUN-only constraints, timestamps and posting idempotency. It enables RLS and explicitly grants authenticated users **SELECT only**. Ledger SELECT follows portfolio ownership. Anonymous roles have no access. Browser clients cannot insert, update or delete financial records; the service role can append ledger records but is not configured in this app.

The AI-002 migration creates no financial rows. AI-003 adds narrowly scoped initialization/read functions and ledger invariants without seeding or rewriting financial history. Once history exists, preserve it and use reviewed forward migrations; never delete funding entries to reset a portfolio.

For optional local Supabase development, install Docker and run `npx supabase start`; the CLI applies the same migrations. `supabase/config.toml` disables signup/anonymous login and financial seeding. Never run `db reset` against a database whose data must be retained.

## Portfolio foundation: FR-010, FR-013 and initial FR-011

See [M1 portfolio acceptance](docs/M1_PORTFOLIO_ACCEPTANCE.md) for the AI-015
plan mapping, current verification results and deployment acceptance steps.

Sign in and open `/dashboard`. Before initialization, the dashboard displays a setup state instead of a sample balance. Select **Initialize virtual portfolio** once. The server independently verifies your identity and calls the database using your cookie session and public key. No service-role key or additional environment variable is required.

The database initializer locks the authenticated owner's existing Auth row, reuses the unique owner/DRY_RUN portfolio, and records one `INITIAL_CAPITAL` posting of `500.000000000000` EUR. The portfolio and funding insert commit together. Concurrent requests, refreshes, retries and later logins cannot add starting capital again. An existing empty, unfunded portfolio can be completed; other inconsistent history is rejected rather than topped up.

The privileged writer lives in the unexposed `private` schema with an empty `search_path`, explicit current-owner checks, a real nonanonymous Auth-user check and restricted execution permissions. Public RPC wrappers are security invokers; their read queries retain RLS. Neither RPC accepts a funding amount, currency or mode. Keep `private` out of the project's exposed Data API schemas.

Financial tables remain read-only for browser roles. A unique partial index permits only one initial funding record per portfolio, and its constraint requires exactly EUR/500. An invoker trigger rejects ledger updates, deletes and truncation even for privileged append writers. Corrections require new audited postings in a future authorized accounting feature, never changes to existing entries.

Balances are aggregated from signed ledger entries with PostgreSQL `numeric`, then returned as decimal strings. TypeScript uses a pinned `decimal.js` constructor with 40 significant digits; it never converts money to JavaScript `Number`. EUR display rounds half-up to two decimals; stored amounts remain at twelve decimal places. Asset quantities retain up to twelve places. In this all-cash milestone, NAV equals available EUR and cumulative P&L equals NAV minus initial capital. Nonzero unpriced crypto, malformed balances or unreconciled funding produce an error instead of a fabricated valuation.

| Requirement | Implemented behavior |
| --- | --- |
| FR-010 | One atomic, idempotent DRY_RUN portfolio per owner; exactly €500 EUR and zero BTC/ETH. |
| FR-013 | One immutable initial funding posting, database uniqueness, signed numeric ledger reconciliation and denied direct client writes. |
| FR-011, initial balances | Persisted total value, available EUR, BTC/ETH quantities and initial €0.00 cumulative P&L, with loading, empty and retryable error states. |

### Safe migration deployment

The workspace project already has both migrations. The following steps apply
to new environments or future reviewed schema changes; for the current project,
proceed directly to manual acceptance.

1. Review the new SQL, confirm the linked project and take a recoverable backup before changing any database with financial history. Do not modify or replay the original AI-002 migration.
2. Check for incompatible existing funding records. These queries must return no rows; stop and investigate history if they do:

```sql
select portfolio_id, count(*)
from public.portfolio_ledger
where transaction_type = 'INITIAL_CAPITAL'
group by portfolio_id having count(*) > 1;

select id from public.portfolio_ledger
where transaction_type = 'INITIAL_CAPITAL'
  and (currency <> 'EUR' or amount <> 500);
```

3. Run the CLI login/link and `db push --linked --dry-run --skip-vault` commands above. Check that only the intended pending migration is listed, then run `db push --linked --skip-vault`. Credentials should be entered at prompts or supplied through your secret manager.
4. Run the complete `tests/database/hosted-portfolio.sql` file in one administrator SQL session. It verifies the actual hosted roles, owner isolation, first/repeated initialization and append-only protection, then rolls all synthetic users and financial fixtures back. Re-run security advisors and confirm `private` is not exposed through the Data API.
5. Sign in, initialize through the dashboard, then perform the acceptance steps below. Applying the migration alone creates no owner portfolio or financial data.

If migration validation fails, fix it before deploying. After funding is used, roll back application behavior or make a reviewed forward schema change; preserve existing ledger rows and constraints that protect them. The current M1 phase requires no hosted migration or application deployment. Its authorized Git lifecycle proceeds only after local validation and required GitHub checks pass.

### Manual acceptance

1. Sign in with the existing confirmed owner. Verify the persisted portfolio shows total/available EUR **€500.00**, **0 BTC**, **0 ETH** and cumulative P&L **€0.00**; do not reset it or add funding.
2. In isolated tests or a separate disposable environment, verify a new owner's empty state and initialize concurrently from two tabs. Both must resolve to the same portfolio and exactly one initial funding posting. Repeated setup is verified without changing the hosted owner's records.
3. Reload, log out and sign in again. Values and the portfolio UUID must remain unchanged; no extra initial funding posting may appear.
4. As an administrator, verify exactly one owner portfolio and one EUR `INITIAL_CAPITAL` posting. As a second user, confirm owner A's rows and RPCs are inaccessible. Anonymous RPC calls and direct authenticated ledger writes must be denied.
5. Check loading and retry behavior during database outages, desktop/mobile layout and locked Live mode. No buy, sell or scheduling controls should be available.

## Public market data: FR-020, partial FR-022 and FR-024

Sign in and open `/markets` to view BTC-EUR and ETH-EUR prices, 24-hour percentage changes, base-asset volumes and available bid/ask quotes. The server calls only Coinbase's fixed public Advanced Trade product and ticker endpoints for these two pairs. No Coinbase account, API key or additional environment variable is required. Public methods do not require a JWT. [Coinbase REST endpoint guidance](https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/rest-api).

Values are validated decimal strings; malformed or missing required data never becomes a sample price or zero. Present malformed JSON or schema data fails closed even when the other endpoint is valid. A ticker transport failure or empty trade list may use a validated product reference price, identified as a reference with unknown exchange time. A valid ticker can also supply a price when product transport fails, with unavailable product statistics left empty. A stale or future-dated trade is never silently replaced by a reference. Last-trade timestamps, when provided, are separate from application retrieval time; bid/ask has no claimed exchange timestamp. See [public product](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/public/get-public-product) and [public market trades](https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/public/get-public-market-trades) contracts.

The authenticated page and `/markets/data` route verify the user independently. The browser polls the application server approximately every 60 seconds while visible, without overlapping requests. A five-second freshness/deadline check and minimum 60-second interval between attempts normally give a 60–65-second poll cadence after a visibility-triggered refresh. A warm-process server cache retains validated results for 60 seconds per product and deduplicates concurrent requests. Failures have a 30-second cooldown; longer `Retry-After` headers on 429/5xx responses block both products until their provider cooldown expires. Each endpoint has at most three attempts, each with a three-second timeout including the response body. A quote becomes stale at 120 seconds based on retrieval time or its known last-trade time. Freshness ages in the browser between polls. Failed refreshes immediately hide prior numeric quotes while preserving their original timestamps. Initial loading uses a skeleton; stale/unavailable cards show status badges and automatic-retry text.

This feed is informational. It does not change the existing EUR 500 portfolio, write market history or add trading, valuation, candle ingestion or scheduling. No migration is required. See [M2 market-data acceptance](docs/M2_MARKET_DATA_ACCEPTANCE.md) for scope, validation and manual checks.

## Historical market data: FR-021, remaining FR-022, FR-025 and FR-053 charts

The authenticated `/markets` page also reads persisted Coinbase `ONE_DAY`
candles for BTC-EUR and ETH-EUR and renders responsive 30-, 90- and 365-day
closing-price charts. Use **Refresh daily history** for the controlled initial
backfill and later manual maintenance. The server imports up to 730 fully closed
UTC days per asset through three public Coinbase requests of at most 350
candles, validates every decimal value and OHLC relationship, and records gaps,
rejections and the source fetch time. Missing days remain visibly incomplete;
the application never interpolates them.

Migration `20261013202443_ai_004_historical_market_candles.sql` provides the
decimal-safe candle store, unique product/day key, RLS, authenticated read RPC,
service-role-only idempotent upsert and owner-scoped import audit. Browser roles
cannot manufacture or overwrite market history. The refresh action verifies
the current user before creating the server-only admin client. It does not
modify portfolio or ledger records. The forward migration
`20261013204445_ai_005_optimize_market_history_rls.sql` applies the database
advisor's Auth-helper optimization without changing access. See [M2 historical market-data acceptance](docs/M2_HISTORICAL_MARKET_DATA_ACCEPTANCE.md)
for migration, backfill, validation and manual acceptance instructions.

## Login and session behavior

Use `/login` with the manually provisioned email/password. Invalid credentials show a generic message. Login destinations are restricted to the seven workspace routes; supplied external URLs are ignored. Use **Log out** in the application header to end the current browser session.

`@supabase/ssr` stores sessions in cookies. Separate browser and request-scoped server clients share SameSite=Lax cookies (Secure in production). Next.js 16 `proxy.ts` refreshes tokens, preserves cookies on redirects, forwards refresh cache headers and prevents authentication responses from being cached. The private layout and the logout action also verify identity using `getUser()` independently of proxy redirects. New private loaders, actions and API handlers must call `requireUser()` themselves and use the user's RLS-scoped client.

Supabase access JWTs may remain valid until expiry after sign-out. Logout clears this browser's cookies; sensitive future operations requiring immediate revocation guarantees must also verify the session against `auth.sessions`. Do not authorize using `getSession()`'s embedded user or user-editable metadata.

Implementation references: [official Supabase Next.js SSR guidance](https://supabase.com/docs/guides/auth/server-side/nextjs), [RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security) and [session revocation behavior](https://supabase.com/docs/guides/auth/sessions#how-to-ensure-an-access-token-jwt-cannot-be-used-after-a-user-signs-out).

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server. |
| `npm run build` | Create a production build. |
| `npm run start` | Serve the production build after running `npm run build`. |
| `npm run lint` | Run ESLint. |
| `npm run typecheck` | Check strict TypeScript types without emitting JavaScript. |
| `npm test` | Run auth/session, portfolio, current/historical market-data tests plus real SQL RLS/constraint tests. |
| `npm run test:concurrency` | Test genuinely overlapping transactions in a disposable native PostgreSQL cluster. |
| `npm run test:e2e` | Run browser auth, portfolio and market-data flows against isolated fixtures. |
| `npm run test:markets:live` | Optional public Coinbase contract smoke test; requires network access, outside the default suite and CI. |

Validate changes locally with:

```bash
npm run lint
npm run typecheck
npm test
npm run test:concurrency
npm run test:e2e
npm run build
```

Before the first browser test run, install the test browser with `npx playwright install chromium`. The E2E runner uses its own loopback Auth fixture, disposable PostgreSQL/PGlite data and `.next-e2e` build output. Its RPC endpoints execute the actual migrations under the signed-in owner's database role. It overrides public configuration for its child process and never edits `.env.local`, creates hosted users or bypasses production authentication. These tests exercise the real SSR clients/cookies, with a test Auth HTTP service; they do not replace a hosted-provider login smoke test.

Default market tests use deterministic HTTP fixtures and injected clocks; they do not depend on Coinbase availability. Run `npm run test:markets:live` separately when network access is available to validate the current public product, ticker and daily-candle contracts. The smoke tests make only public reads and need no credentials; an upstream outage or rate limit is reported as a failure rather than replaced by fixture values.

M2 Phase 1 validation passed: lint, strict typecheck, **378 unit/SQL tests across 13 files**, **30 browser tests** and production build. Native PostgreSQL concurrency checks and the separate public Coinbase smoke test also passed. Read-only hosted verification confirmed the unchanged single DRY_RUN portfolio and +500 EUR funding entry, with zero BTC/ETH. No migration or database write was needed. See [M2 market-data acceptance](docs/M2_MARKET_DATA_ACCEPTANCE.md) for corrections, coverage and manual checks; the M1 record below is retained as phase history.

M2 Phase 2 validation passed on 13 October 2026: lint, strict typecheck,
**411 unit/SQL tests across 17 files**, all native PostgreSQL concurrency checks,
**33 browser tests**, production build and two read-only Coinbase smoke checks.
AI-004 and forward policy optimization AI-005 are applied to the linked
project. Hosted backfill stored 730 complete UTC daily candles for each product
(2024-10-13 through 2026-10-12), with no gaps, duplicates or rejected rows; an
immediate repeat skipped all 1,460 rows. The original EUR 500 portfolio and
single funding entry remain unchanged. See [M2 historical market-data acceptance](docs/M2_HISTORICAL_MARKET_DATA_ACCEPTANCE.md)
for deployment evidence and manual checks.

The database suites execute the original foundation and the complete migration chain inside PostgreSQL via PGlite, with test-only Supabase roles/Auth scaffolding. They cover owner isolation, direct write denial, first/repeated funding, partial setup recovery, rollback, exact reconciliation and immutable history without Docker or credentials. PGlite queues requests, so its parallel calls are not evidence of overlapping transaction locks.

For `test:concurrency`, make native PostgreSQL `initdb`, `pg_ctl` and `psql` available on PATH, or set `PG_TEST_BIN` to their binary directory. On Windows, portable binaries are available from the [official PostgreSQL download page](https://www.postgresql.org/download/windows/). This test creates its own local temporary cluster and never connects to the hosted project or an existing database. The separate sessions test lock contention, commit and rollback; the runner shuts the cluster down afterward. Missing binaries fail with setup instructions rather than silently skipping the concurrency check.

For example in PowerShell:

```powershell
$env:PG_TEST_BIN = 'C:\path\to\PostgreSQL\bin'
npm run test:concurrency
```

M1 validation passed: lint, strict typecheck, **226 unit/SQL tests across nine files**, **19 browser tests**, native PostgreSQL concurrency/failure checks and production build. `npm audit --omit=dev` reports zero production dependency vulnerabilities. Read-only hosted checks confirmed one DRY_RUN portfolio, one +500 EUR initial funding entry, EUR 500 and zero BTC/ETH, enabled RLS and denied direct authenticated writes. Details and corrected defects are recorded in [M1 portfolio acceptance](docs/M1_PORTFOLIO_ACCEPTANCE.md). All test fixtures are isolated. Validate the existing owner's dashboard by reading its persisted values, refreshing and logging out/in; preserve the existing portfolio and funding entry.

`tests/database/hosted-rls.sql` verifies the original access rules against the hosted database's actual roles and `auth.uid()`. Run the entire file as one administrator query after migration. It creates credential-free synthetic users and financial test fixtures inside a transaction, asserts access and write denial, then rolls everything back. AI-002 hosted verification passed with all fixtures removed; its hosted login/logout smoke test also passed using a temporary account that was removed afterward. AI-003 tests verify this SQL remains compatible with both migrations. `tests/database/hosted-portfolio.sql` has now also passed on the hosted project: first/repeated setup, owner isolation, anonymous denial, direct ledger write denial and append-only guards passed, with all synthetic data rolled back.

Hosted security review found no financial-table RLS or database-function warnings. The existing [leaked-password-protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) is reviewed as nonblocking Auth hardening for this existing-owner phase, which introduces no signup or password-change paths. Supabase offers that protection on Pro plans and above. Retain the ledger index for portfolio history reads even if a small dataset produces an unused-index advisory.

## Project structure

```text
app/(private)/  Existing workspace pages behind a server auth guard
app/login/      Email/password login page and Server Action
components/     Responsive shell, shared UI, auth/session components
lib/auth/       Verified-user guard, safe redirects and logout action
lib/portfolio/  Owner-scoped RPC services, validated ledger summaries and decimal formatting
lib/markets/    Public Coinbase current/history adapters, validation, storage and cache
lib/supabase/   Browser/server clients, server-only admin client and proxy session refresh
proxy.ts        Next.js 16 auth-refresh entry point
supabase/       CLI config and version-controlled database migrations
tests/          Auth/session tests, SQL RLS tests and browser tests/fixtures
docs/           Product requirements and implementation plan
components.json  shadcn/ui configuration
```

The design uses shared color, spacing and typography tokens in the global stylesheet, along with shadcn/ui Card, Badge and Button components. System fonts keep builds independent of font downloads.

Next.js automatic agent-rule generation is disabled in `next.config.ts` so running the development server preserves the existing `AGENTS.md`.

Read [AGENTS.md](AGENTS.md), [the PRD](docs/PRD.md) and [the implementation plan](docs/CODEX_IMPLEMENTATION_PLAN.md) before making changes.

## Development workflow

Use the PRD's FR-xxx IDs to define each requested phase. Start from updated `main` on a dedicated feature branch, preserve user changes, implement the requirements and fix all validation failures with regression tests. Run the complete local checks above and the required GitHub checks before merging. The authorized workflow includes committing, pushing, creating a PR and merging automatically when every gate passes. Never bypass checks or merge unresolved security issues.

After merging, return to `main`, run `git pull --ff-only origin main`, verify a clean working tree and equality with `origin/main`, and delete the merged local feature branch only when safe. Start the next phase from updated `main`. The detailed workflow and financial safeguards are in [AGENTS.md](AGENTS.md); LIVE trading requires separate explicit approval and a separately approved release.

## Current scope

Authentication, the ledger-backed portfolio, read-only current Coinbase quotes, persistent validated daily history and closing-price charts are implemented. Agent, Trades, Performance and Settings remain placeholders. There is no AI analysis, scheduling, BUY/SELL functionality, browser secret-key client, live execution path or application deployment in the current scope.

M1 covers **FR-010, initial FR-011 and initial FR-013**, corresponding to the original plan's AI-015 initializer. The existing migration retains its AI-003 filename; original planning documents keep their original numbering. M2 Phase 1 covers **FR-020 and partial FR-022/FR-024**, corresponding to AI-020. M2 Phase 2 covers **FR-021, remaining FR-022 candle validation, FR-025 and the market-price chart scope of FR-053**, corresponding to AI-021. The recommended next scope is the next separately approved PRD phase; trading-strategy work is not part of this delivery.

## Troubleshooting

- **Disabled login:** check both public variables and use a modern `sb_publishable_` key, then restart the dev server.
- **Invalid login:** check email/password, email confirmation and that the account was manually provisioned. The application deliberately does not reveal whether an email exists.
- **Redirected after login or refresh:** consistently use `localhost` or `127.0.0.1`; cookies are host-specific. Check Supabase availability and refresh-token settings, and do not cache auth responses.
- **Empty financial tables:** expected before explicit setup. The workspace migration is applied; use **Initialize virtual portfolio** while signed in. Opening the dashboard does not create funds.
- **Portfolio error:** verify the new migration is applied and Supabase is reachable, then retry. Missing funding, inconsistent ledger history or unpriced nonzero crypto must be investigated instead of inserting extra funding or showing a sample balance.
- **Market data unavailable:** check outbound HTTPS access to `api.coinbase.com` and retry after the server cooldown. No Coinbase key is required. Invalid product/ticker responses fail validation; inspect sanitized error codes instead of bypassing guards.
- **Stale market data:** retrieval or known last-trade age reached 120 seconds. Keep the tab visible for polling or refresh after the server cooldown. A reference price with unknown exchange time remains labeled as such; it is not evidence of an executable quote.
- **Historical refresh unavailable:** confirm `SUPABASE_SECRET_KEY` (or the legacy service-role key) is configured only on the server and AI-004 is applied. Retry after provider cooldown. Inspect the owner-scoped import audit and visible gap count; never insert a fabricated candle to hide an upstream gap.
- **Denied table reads/writes:** apply the migration, sign in and use the user's own portfolio. Financial writes are intentionally denied from browser roles. Do not weaken RLS or add service keys to resolve this.
- **CLI access error:** ensure the CLI can access its user configuration directory and the selected project's database; never print credential-bearing connection strings in logs.
- **Browser executable missing:** run `npx playwright install chromium`. The database/unit suite needs no browser or Docker.

## Known tooling limitations

The current Next.js React/accessibility lint plugins require ESLint 9, which npm marks as deprecated. ESLint 10 is not yet compatible with all their peer requirements.

`npm audit` currently reports five high-severity entries from one [unpatched `braces` advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), through the development-only Next.js ESLint dependency chain. `npm audit --omit=dev` reports zero vulnerabilities. Keep lint inputs local and trusted, and recheck this dependency chain when upstream fixes become available. Do not force a framework downgrade to silence the audit.
