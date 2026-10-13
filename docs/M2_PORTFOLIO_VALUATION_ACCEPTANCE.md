# M2 Phase 3 portfolio valuation acceptance

Scope: **FR-012, FR-023, remaining valuation scope of FR-011 and initial
FR-050** (implementation-plan issues AI-022 through AI-024). This phase stores
validated current Coinbase observations and marks ledger-derived BTC/ETH
balances without changing those balances.

## Requirement mapping

| Requirement | Implemented behavior |
| --- | --- |
| FR-011, valuation scope | Decimal-safe EUR cash, BTC/ETH quantities and EUR market values produce NAV, allocation percentages, cumulative return and P&L against EUR 500. Fees are EUR 0 only when the initial-funding entry is the complete ledger; otherwise they are unavailable. Realised/unrealised P&L remain unavailable until fills and cost basis exist. |
| FR-012 | Each crypto mark identifies its selected price, price kind, Coinbase source, exchange time when provided, retrieval time and dynamic freshness. A stale or unavailable price for a nonzero holding withholds NAV, return and allocations. |
| FR-023 | Validated public last-trade/product prices and available bid/ask are persisted idempotently. Complete public bid/ask is classified separately from an indicative reference. No spread is fabricated and public observations are never described as guaranteed fills. |
| FR-050, initial | The dashboard shows NAV, EUR/BTC/ETH balances and values, allocations, inception return, available fee/P&L information, valuation time, quote source and freshness. Existing agent status remains an explicit unconfigured state. |

## Deterministic valuation policy

The existing Coinbase adapter selects the latest validated public trade price
when available and otherwise the validated public product reference price. The
valuation engine uses that persisted selected price directly. It never uses a
bid/ask midpoint, chooses a favorable side, invents a spread or claims that a
public quote is executable.

For each nonzero crypto holding, the newest persisted quote must still be
validated and fresh. Freshness expires 120 seconds after application retrieval
or the known exchange trade time, whichever is earlier. Timestamps more than
five seconds in the future are invalid. The portfolio valuation timestamp is
the oldest price timestamp used by a nonzero holding. A cash-only portfolio is
current at calculation time because no market price is needed to value cash.

All amounts cross application boundaries as decimal strings. Calculations use
60-significant-digit `decimal.js` arithmetic. Ledger quantities remain at 12
decimal places, persisted quote values at up to 18 decimals, and calculated
EUR values are retained to 12 decimals before display rounding. Market prices
never create, update or delete ledger entries.

If a required BTC or ETH mark is stale or unavailable, that asset's EUR value,
portfolio NAV, allocations, cumulative P&L and return are unavailable. A zero
ledger quantity has an actual EUR value and allocation of zero even when its
informational quote is missing. This is the only case where a missing quote
does not block NAV.

Realised and unrealised P&L are explicitly unavailable because the current
ledger has no persisted fill/cost-basis model. They are not inferred from
balances. The current one-entry portfolio has cumulative fees of EUR 0 because
its entire ledger is the initial-capital entry; fixtures with other entries
show fees as unavailable until fee records can be reconciled.

## Reference quote persistence and security

Migration `20261013211635_ai_006_market_reference_quotes.sql` creates the
append-only `public.market_reference_quotes` table. It stores product, selected
price, price kind, available bid/ask, execution-reference classification,
source, provider time, fetch time, freshness deadline and validation status.
The unique product/source/fetch-time key makes identical retries idempotent;
the writer rejects a different payload at the same identity.

`public.store_market_reference_quotes(jsonb)` accepts at most one quote per
supported product, runs under the caller's privileges, requires the service
role, serializes classification, rejects stale/future input, and inserts only
validated rows. Authenticated and anonymous browser roles cannot execute it or
write the table. The service role receives insert access but no update/delete
access. `public.get_latest_market_reference_quotes()` requires a real,
nonanonymous authenticated user and retains RLS.

The dashboard authorizes the owner before public network access and before the
server-only admin client is constructed. `SUPABASE_SECRET_KEY` or the legacy
service-role key stays in server code and `.env.local`; it is never exposed to
the browser or committed. A provider or persistence failure can fall back only
to a previously persisted record that is still fresh. An unpersisted response
does not become an authoritative portfolio mark.

## Safe migration deployment

1. Confirm the linked project is the intended `ai-investor` instance and that
   migrations through AI-005 are already present. Never reset the database.
2. Review AI-006 and preview deployment:

   ```bash
   npx supabase migration list --linked
   npx supabase db push --linked --dry-run --skip-vault
   ```

3. Confirm only `20261013211635_ai_006_market_reference_quotes.sql` is pending,
   then apply it with `npx supabase db push --linked --skip-vault`.
4. Run `tests/database/hosted-reference-quotes.sql` as one administrator query.
   It verifies first/repeated persistence, authenticated reads, denied browser
   writes, service-role immutability and unchanged financial records, then
   rolls every synthetic row back.
5. Sign in and open `/dashboard` to execute the controlled initial quote
   refresh. Verify the latest-record query returns one current row for each
   supported product. The append-only table may contain older observations.
6. Re-run security/performance advisors and confirm the real portfolio still
   has one initial funding entry, EUR 500, BTC 0 and ETH 0.

No migration replays, portfolio resets, hosted simulated holdings or funding
entries are part of this deployment.

## Automated and manual acceptance

Required validation:

```bash
npm run lint
npm run typecheck
npm test
npm run test:concurrency
npm run test:e2e
npm run build
npm run test:markets:live
```

Automated coverage includes all-cash and nonzero portfolios, exact decimal
valuation and allocation, source/time provenance, stale/missing/malformed and
future prices, public-spread versus indicative classification, idempotent
persistence, balance immutability, authentication, RLS, direct-write denial,
historical data regressions and the original EUR 500 funding invariants.

Deployment validation on 2026-10-13:

- AI-006 was the only migration shown by the dry run and is recorded in the
  hosted migration ledger after deployment.
- The rollback-only hosted SQL verification passed its authenticated-read,
  denied-write, immutable-row, idempotency and financial-invariant checks.
- The controlled application persistence check stored two Coinbase
  observations per product across two distinct fetches. Retrying either exact
  payload skipped both rows, leaving four append-only reference records across
  two supported products.
- The hosted financial state remained one Dry Run portfolio, one
  `INITIAL_CAPITAL` EUR 500 ledger entry, EUR 500 cash, BTC 0 and ETH 0.
- Supabase performance advisors returned no findings. The security advisor
  reported only the existing project-level leaked-password-protection warning;
  AI-006 introduced no database security finding.
- Lint and typecheck passed; 453 Vitest tests, six native PostgreSQL checks, 34
  Playwright tests and two live read-only Coinbase smoke tests passed. The
  production build succeeded and `npm audit --omit=dev` found no vulnerability.

Manual acceptance:

1. Sign out and confirm `/dashboard` redirects to login before portfolio,
   Coinbase or privileged database access.
2. Sign in with the existing owner. Confirm NAV EUR 500, EUR cash EUR 500,
   BTC/ETH quantities and market values zero, EUR allocation 100%, cumulative
   P&L EUR 0, return 0% and fees EUR 0.
3. Confirm both asset cards identify current price availability, Coinbase
   source, timestamp and whether a complete public bid/ask was observed. The UI
   must say that execution is not guaranteed.
4. Repeat an identical quote payload and verify it is skipped. A later provider
   fetch has a new retrieval timestamp and is retained as a new observation.
   Confirm neither operation changes the single EUR 500 funding entry.
5. In isolated fixtures only, add nonzero BTC/ETH ledger balances. Confirm fresh
   persisted prices produce exact market values and allocations without ledger
   mutations. Exercise stale, missing and malformed references and confirm NAV
   is withheld rather than presented as current.
6. Check desktop/mobile layout, logout/login persistence, locked LIVE mode and
   absence of BUY/SELL, scheduling or authenticated Coinbase controls.

## Deferred scope

Realised/unrealised P&L, trade cost basis, portfolio snapshots, NAV charts,
agent latest-run data, simulated fills, side-aware execution, fees/slippage,
scheduling, strategy and live trading remain outside this phase.
