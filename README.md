# AI Investor

AI Investor is a private Dry Run-only investment dashboard for a virtual EUR, BTC and ETH portfolio. It uses Next.js 16 App Router, strict TypeScript, Tailwind CSS, shadcn/ui and Supabase Auth.

**AI-002 adds Supabase authentication and the database foundation.** Existing pages retain their **€500.00 sample virtual portfolio**, labelled BTC/ETH placeholders and unconfigured agent. No portfolio or ledger rows are initialized; that remains AI-003. Live mode is locked and unavailable.

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
```

Use the project's public `sb_publishable_...` key from **Connect** or **Settings → API Keys**. These two values are intentionally public; RLS protects financial records. No service-role key, secret key, database password or login password belongs in these variables. Startup/build rejects an invalid public configuration before compilation. `.env.local` is ignored by Git; never commit it.

Without configuration the login form is disabled and private routes redirect to login. Builds and isolated tests can run without a hosted project. Restart the dev server after changing `.env.local`.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Logged-out users reach `/login`; successful login opens `/dashboard` or the requested allowlisted workspace page. Dashboard, Markets, AI Agent, Trades, Performance, Settings and the informational locked Live page all require authentication. Root `/` redirects to the dashboard.

## Supabase setup and migrations

The existing **ai-investor** project in **eu-west-2** is configured for this workspace through ignored `.env.local`. Migration `20261012065128_ai_002_auth_database_foundation.sql` is already applied there, and its local version matches hosted migration history. Hosted email/password authentication is enabled, public signup and anonymous sign-ins are disabled, and the site URL is `http://localhost:3000`. There are no user accounts yet: manually create and confirm the owner before the first login. Other checkouts still need their own `.env.local`.

1. Create or choose the project's Supabase instance. Configure the Auth site URL as `http://localhost:3000` for local development.
2. Under Auth settings, keep email/password authentication enabled and **disable public signups and anonymous sign-ins**. There is no registration interface or signup action in this application. `supabase/config.toml` applies these defaults only to a local stack; hosted settings must be configured separately.
3. In **Authentication → Users**, manually add the owner account with a strong password and a confirmed email. Keep account passwords outside the repository. Additional manually provisioned users can access only their own rows; no user-editable metadata is trusted for authorization.
4. Apply the version-controlled migration after reviewing its target:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push --linked --dry-run --skip-vault
npx supabase db push --linked --skip-vault
```

The CLI prompts for credentials when needed; do not put secrets in command history. A migration already applied to the hosted project must be reflected in migration history before using `db push`. Avoid replaying table-creation SQL against an initialized database.

The migration creates `public.portfolios` and `public.portfolio_ledger`, with UUID keys, ownership FKs, `numeric(28,12)` values, EUR/€500 configuration, DRY_RUN-only constraints, timestamps and posting idempotency. It enables RLS and explicitly grants authenticated users **SELECT only**. Ledger SELECT follows portfolio ownership. Anonymous roles have no access. Browser clients cannot insert, update or delete financial records; the service role can append ledger records but is not configured in this app.

No financial rows, initialization function, seed, exchange connection or scheduled job are created. For rollback on an unused database, drop the ledger before portfolios through a reviewed migration. Once history exists, preserve it and use forward migrations.

For optional local Supabase development, install Docker and run `npx supabase start`; the CLI applies the same migrations. `supabase/config.toml` disables signup/anonymous login and financial seeding. Never run `db reset` against a database whose data must be retained.

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
| `npm test` | Run auth/session unit tests and real SQL RLS/constraint tests. |
| `npm run test:e2e` | Run browser login/session/protected-page tests against an isolated Auth fixture. |

Validate changes locally with:

```bash
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

Before the first browser test run, install the test browser with `npx playwright install chromium`. The E2E runner uses its own loopback Auth fixture and `.next-e2e` build output. It overrides public configuration for its child process and never edits `.env.local`, creates hosted users or bypasses production authentication. These tests exercise the real SSR clients/cookies, with a test Auth HTTP service; they do not replace a hosted-provider login smoke test.

The database suite runs the actual migration inside PostgreSQL via PGlite, with test-only Supabase Auth roles/`auth.uid()` scaffolding. It tests two owners, anonymous access, cross-owner denial, every financial write denial, RLS even if grants accidentally broaden, idempotency, precision and constraints without Docker or credentials.

`tests/database/hosted-rls.sql` also verifies these access rules against the hosted database's actual roles and `auth.uid()`. Run the entire file as one administrator query after the migration. It creates credential-free synthetic users and financial test fixtures inside a transaction, asserts access and write denial, then rolls everything back. This verification passed on the connected project; the Auth user, portfolio and ledger tables remained empty afterward. The hosted Auth endpoint was verified reachable and rejects invalid credentials; successful hosted login still requires the manually provisioned owner.

The hosted security advisor reports no findings. The performance advisor initially reports the [ledger index as unused](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index), which is expected while the ledger is empty; retain it for the planned portfolio history reads.

## Project structure

```text
app/(private)/  Existing workspace pages behind a server auth guard
app/login/      Email/password login page and Server Action
components/     Responsive shell, shared UI, auth/session components
lib/auth/       Verified-user guard, safe redirects and logout action
lib/supabase/   Separate browser/server clients and proxy session refresh
proxy.ts        Next.js 16 auth-refresh entry point
supabase/       CLI config and version-controlled database migrations
tests/          Auth/session tests, SQL RLS tests and browser tests/fixtures
docs/           Product requirements and implementation plan
components.json  shadcn/ui configuration
```

The design uses shared color, spacing and typography tokens in the global stylesheet, along with shadcn/ui Card, Badge and Button components. System fonts keep builds independent of font downloads.

Next.js automatic agent-rule generation is disabled in `next.config.ts` so running the development server preserves the existing `AGENTS.md`.

Read [AGENTS.md](AGENTS.md), [the PRD](docs/PRD.md) and [the implementation plan](docs/CODEX_IMPLEMENTATION_PLAN.md) before making changes.

## Current scope

Authentication and schema are implemented; the dashboard remains sample data. No Coinbase feed, AI analysis, scheduling, trading logic or ledger initialization is implemented. No secret-key client, live execution path or application deployment is included.

The next requested issue is **AI-003**, for idempotent financial initialization and its business logic. Original planning documents retain their original backlog numbering; this README follows the current task's AI-002/AI-003 scope.

## Troubleshooting

- **Disabled login:** check both public variables and use a modern `sb_publishable_` key, then restart the dev server.
- **Invalid login:** check email/password, email confirmation and that the account was manually provisioned. The application deliberately does not reveal whether an email exists.
- **Redirected after login or refresh:** consistently use `localhost` or `127.0.0.1`; cookies are host-specific. Check Supabase availability and refresh-token settings, and do not cache auth responses.
- **Empty financial tables:** expected in AI-002. The €500 screen is sample data; initialization belongs to AI-003.
- **Denied table reads/writes:** apply the migration, sign in and use the user's own portfolio. Financial writes are intentionally denied from browser roles. Do not weaken RLS or add service keys to resolve this.
- **CLI access error:** ensure the CLI can access its user configuration directory and the selected project's database; never print credential-bearing connection strings in logs.
- **Browser executable missing:** run `npx playwright install chromium`. The database/unit suite needs no browser or Docker.

## Known tooling limitations

The current Next.js React/accessibility lint plugins require ESLint 9, which npm marks as deprecated. ESLint 10 is not yet compatible with all their peer requirements.

`npm audit` currently reports five high-severity entries from one [unpatched `braces` advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), through the development-only Next.js ESLint dependency chain. `npm audit --omit=dev` reports zero vulnerabilities. Keep lint inputs local and trusted, and recheck this dependency chain when upstream fixes become available. Do not force a framework downgrade to silence the audit.
