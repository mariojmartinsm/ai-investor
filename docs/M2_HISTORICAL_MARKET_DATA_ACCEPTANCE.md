# M2 Phase 2 historical market-data acceptance

Scope: **FR-021, the remaining candle-validation scope of FR-022, FR-025,
and the market-price chart scope of FR-053**. This phase adds validated,
persistent Coinbase daily candles and closing-price charts for BTC-EUR and
ETH-EUR. It does not value or modify the portfolio and adds no trading path.

## Requirement mapping

| Requirement | Implemented behavior |
| --- | --- |
| FR-021 | The server retrieves the latest 730 fully closed UTC daily candles for BTC-EUR and ETH-EUR from Coinbase's public Advanced Trade API. Three bounded requests (350, 350 and 30 days) are sorted and validated before storage. |
| FR-022, candle validation | Prices must be positive decimal strings, volume must be nonnegative, OHLC relationships must be valid, and starts must be unique UTC midnights in the requested range. Current-day, malformed, duplicate and unexpected candles are rejected. Missing days are reported and never interpolated. |
| FR-025 | A controlled owner-authenticated action performs an idempotent backfill. Validated rows are upserted by product, granularity and candle start; every attempt records imported, updated, skipped and rejected counts. |
| FR-053, market-price charts | Responsive 30-, 90- and 365-day BTC/EUR and ETH/EUR closing-price charts show UTC dates, EUR values, hover details, source, last fetch time and completeness. |

## Coinbase contract

The adapter uses only:

```text
GET https://api.coinbase.com/api/v3/brokerage/market/products/{product_id}/candles
```

Coinbase documents the market endpoint as public, with no JWT required, a
maximum of 350 buckets per request and `ONE_DAY` granularity. The adapter fixes
the origin and product allowlist, preserves financial values as strings and
reuses the existing three-attempt, three-second timeout, `Retry-After`, rate
limit and provider-cooldown behavior. It requests Unix-second ranges ending
before the current UTC day. Provider timestamps are preserved; application
retrieval time is stored separately as `fetched_at`.

The backfill expects every UTC day in its 730-day window. A missing or rejected
day makes that product incomplete, but valid candles are still persisted so an
operator can see and repair the gap on a later refresh. No price is fabricated.

## Database and security

Migration `20261013202443_ai_004_historical_market_candles.sql` creates:

- `public.market_candles`, keyed by product, granularity and UTC candle start,
  with `numeric(38,18)` OHLC/volume fields and database checks for supported
  products, time alignment and valid values;
- `public.market_data_import_runs`, an owner-scoped audit record for each
  controlled refresh;
- `public.get_market_candles`, an authenticated, RLS-preserving read RPC; and
- `public.upsert_market_candles`, a service-role-only, advisory-locked batch RPC
  that reports inserted, changed and unchanged rows.

Authenticated application users can read validated candles and their own
import audit rows. Anonymous access is denied. Browser roles receive no table
write grants and cannot execute the upsert RPC. The refresh Server Action first
verifies the current Supabase user, then uses `SUPABASE_SECRET_KEY` (or the
legacy `SUPABASE_SERVICE_ROLE_KEY`) only in server code. Neither value may use a
`NEXT_PUBLIC_` name or be committed.

The new schema does not reference or mutate `portfolios` or
`portfolio_ledger`. Existing funding remains protected by its original RLS,
append-only triggers and idempotency constraints.

## Safe migration and initial backfill

For the linked `ai-investor` project:

1. Confirm the target project reference and review the SQL. Preserve the
   existing owner portfolio and ledger; never use `db reset`.
2. Preview the deployment and verify that only the expected AI-004/AI-005
   historical migrations are pending (AI-005 alone when AI-004 was already
   applied):

   ```bash
   npx supabase migration list --linked
   npx supabase db push --linked --dry-run --skip-vault
   ```

3. Apply that migration once:

   ```bash
   npx supabase db push --linked --skip-vault
   ```

4. Run `tests/database/hosted-market-history.sql` as one administrator query.
   It uses synthetic rows inside a transaction and rolls them back after
   checking idempotency, grants, RLS and unchanged portfolio counts.
5. Sign in as the existing owner and select **Refresh daily history** on
   `/markets`. The server imports both products and writes an audit result.
   Repeating the action is safe: unchanged candles are counted as skipped.
6. Verify each product has 730 unique daily rows, the expected UTC date range
   and no gaps. Recheck Supabase security/performance advisors and confirm the
   portfolio still has one +EUR 500 initial funding entry.

The same owner action is the manual maintenance operation for newly closed
daily candles. Scheduling and Supabase Cron remain outside this phase.

### Hosted deployment record

On 13 October 2026, the linked `ai-investor` project dry runs listed only the
expected new migration each time, then AI-004 and the follow-up AI-005 were
applied. The rollback-only hosted fixture verified upsert idempotency, RLS,
grants, owner isolation and unchanged portfolio counts.

The authorized initial backfill imported 1,460 candles with no updates, skips
or rejections. Its immediate repeat imported and updated zero rows and skipped
all 1,460. BTC-EUR and ETH-EUR each contain 730 unique `ONE_DAY` candles from
2024-10-13T00:00:00Z through 2026-10-12T00:00:00Z, with zero duplicates and
zero missing UTC days. Hosted verification still shows one DRY_RUN portfolio,
one ledger entry, EUR `500.000000000000`, BTC `0` and ETH `0`.

RLS is enabled on both new tables. Anonymous and authenticated roles cannot
write candle rows or execute the upsert; only `service_role` can execute it.
After AI-005, the performance advisor reports no findings. The pre-existing
[leaked-password protection warning](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
remains an optional hosted Auth hardening item for a plan that supports it.

## Automated and manual acceptance

The required local gates are:

```bash
npm run lint
npm run typecheck
npm test
npm run test:concurrency
npm run test:e2e
npm run build
npm run test:markets:live
```

Default tests use mocked Coinbase responses and isolated databases. They cover
both products, all numeric and OHLC guards, UTC alignment, current-day
exclusion, 350-row pagination, sorting, duplicates, gaps, outages, rate limits,
timeouts, idempotent upserts, denied browser writes, owner isolation, chart
periods and preservation of the EUR 500 portfolio. The live smoke command is a
separate read-only provider check and uses no Coinbase credentials.

Final results on 13 October 2026:

| Command | Result |
| --- | --- |
| `npm run lint` | Passed with zero warnings. |
| `npm run typecheck` | Passed strict TypeScript checks. |
| `npm test` | 411 tests passed across 17 files. |
| `npm run test:concurrency` | Passed all native PostgreSQL lock, rollback and authorization checks. |
| `npm run test:e2e` | 33 Chromium tests passed. |
| `npm run build` | Next.js production build passed. |
| `npm run test:markets:live` | Two read-only Coinbase smoke checks passed, covering current and historical public contracts for both products. |

For manual acceptance:

1. Confirm a signed-out request to `/markets` redirects to login.
2. Sign in and verify current quote cards still refresh independently.
3. Before the first backfill, verify both chart cards show a clear empty state.
4. Select **Refresh daily history** once. Confirm two charts appear, each with
   source, last data update, completeness and a 730-day stored range.
5. Select 30, 90 and 365 days. Verify the point count, UTC date axis, EUR axis
   and hover value update without a page navigation.
6. Repeat the refresh. Confirm it reports unchanged rows as skipped and creates
   no duplicate candle starts.
7. Reload, log out and sign in again. Historical charts must persist. The
   dashboard must still show EUR 500, BTC 0, ETH 0 and initial P&L EUR 0.
8. Verify LIVE remains locked and there are no buy, sell, scheduled refresh or
   Coinbase credential controls.

Migration `20261013204445_ai_005_optimize_market_history_rls.sql` is a
forward-only policy optimization added after the hosted database advisor found
that AI-004's `auth.jwt()` calls would otherwise be evaluated once per row. It
preserves the same authorization result while evaluating Auth helpers through
scalar subqueries.

## Deferred scope

Candlestick rendering, historical portfolio valuations, automated ingestion,
signals, backtesting and trading remain deferred. The next work should begin
from updated `main` and follow the next approved PRD requirement.
