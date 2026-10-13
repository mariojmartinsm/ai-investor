# M3 Phase 1 strategy analysis acceptance

Scope: **FR-031, FR-032, FR-033, initial FR-036 and preview-only FR-037**,
corresponding to implementation-plan issues **AI-030 and AI-031**. This phase
calculates and persists deterministic analysis. It contains no execution path.

## Indicator contract

The calculator sorts eligible candle timestamps chronologically and uses the
latest 90 validated, fully completed UTC daily candles at or before the
analysis cutoff. It accepts 60 through 90 contiguous candles and rejects fewer
than 60, duplicates, missing UTC days, malformed OHLCV relationships and a
series that does not end at the requested cutoff. Post-cutoff records are
excluded before their OHLCV values are read.

All source values and outputs remain decimal strings. `decimal.js` runs with 60
digits of precision and half-up calculation rounding. Price indicators are
stored to 12 decimal places; percentages are stored to eight decimal places.

- SMA20 and SMA50 are arithmetic means of the latest 20 and 50 closes.
- RSI14 uses Wilder smoothing. The first 14 changes seed average gain/loss;
  each later change uses `(previous * 13 + current) / 14`. Flat history is RSI
  50 and positive history with zero average loss is RSI 100.
- Seven- and 30-day momentum are `(latest close / prior close - 1) * 100`.
- Volatility uses the latest 30 close-to-close arithmetic daily returns, sample
  standard deviation with denominator `n - 1`, annualised with `sqrt(365)`, and
  expressed as a percentage. No floating-point `number` performs an
  authoritative price, return or quantity calculation.

Every indicator result includes `TECHNICAL_V1`, its UTC cutoff, latest candle,
input range and input count. This fixed contract is reusable for walk-forward
tests without lookahead.

## BASELINE_V1 decision contract

SELL is evaluated before BUY. A SELL candidate requires owned quantity above
zero, latest close below SMA50 and SMA20 below SMA50; its informational maximum
is 25% of owned quantity, rounded down to 12 places. BUY requires latest close
above SMA50, SMA20 above SMA50 and `40 <= RSI14 <= 65`; its informational
maximum is EUR 25. All remaining states are HOLD.

Invalid, missing, gapped, stale or insufficient inputs fail closed to HOLD with
machine-readable reasons. Valid neutral HOLDs record the unmet BUY/SELL rules,
and a bearish asset with zero holdings records `NO_ASSET_HOLDINGS`. BUY and SELL
are rules-based candidates only. Risk approval, AI review, pricing, broker and
execution stages do not exist in this phase.

## Persistence and security

Migration `20261013220809_ai_007_strategy_analysis_runs.sql` creates immutable
owner-scoped preview records. Each record includes the product, strategy and
indicator versions, analysis date/cutoff, indicator JSON, signal, informational
proposal, explanation, reasons, input completeness/freshness, Coinbase source,
`NOT_REQUESTED` AI status, `NOT_EVALUATED` risk status and `ANALYSIS_ONLY`
outcome.

The deterministic idempotency key is
`PREVIEW_ONLY:BASELINE_V1:<product>:<UTC cutoff>`. An identical retry skips the
existing record; different content at the same key is rejected. An owner-level
transaction advisory lock makes concurrent retries serialize.

RLS allows a nonanonymous authenticated owner to read only their rows. Browser
roles receive no INSERT, UPDATE or DELETE privileges and cannot execute the
writer. The service role also has no direct table privileges. A
`SECURITY DEFINER` append function verifies the server role, owner Auth record
and that owner's DRY_RUN portfolio before inserting. No database object in this
migration writes `portfolios`, `portfolio_ledger`, candles, orders or fills.
Migration `20261013223222_ai_008_index_strategy_analysis_portfolio.sql` adds the
covering portfolio foreign-key index requested by the database advisor.

## Safe deployment

1. Confirm the linked project is `ai-investor` and migrations through AI-006
   are present.
2. Run `npx supabase migration list --linked` and
   `npx supabase db push --linked --dry-run --skip-vault`.
3. Confirm only AI-007 and its AI-008 covering-index migration are pending,
   then apply them with
   `npx supabase db push --linked --skip-vault`.
4. Run `tests/database/hosted-strategy-analysis.sql` as one administrator
   query. It validates role boundaries and idempotency and rolls every fixture
   back.
5. Run one owner preview from `/agent`, repeat it, and verify the second request
   creates no rows. Confirm the portfolio still has one EUR 500 funding entry,
   EUR 500 cash and zero BTC/ETH.
6. Re-run Supabase security and performance advisors.

Never reset the hosted database or replay prior migrations.

## Deployment verification — 2026-10-13

Both AI-007 and AI-008 were dry-run and applied to project
`ygxikougxgokvwoqmkfj`. The hosted rollback fixture passed. A real preview over
the 90 latest stored candles per asset inserted two records; its immediate
repeat inserted zero and skipped two. The source cutoff was 2026-10-13 UTC and
the latest candle was 2026-10-12 UTC for both assets.

- BTC-EUR: BUY; close 73268.790000000000, SMA20 74489.358000000000,
  SMA50 70756.192000000000, RSI14 51.24708507.
- ETH-EUR: HOLD (`NO_BUY_CONDITIONS`, `NO_SELL_CONDITIONS`); close
  2192.470000000000, SMA20 2336.409000000000, SMA50 2231.849600000000,
  RSI14 40.46612364.

After persistence, the hosted project still had one DRY_RUN portfolio, one
INITIAL_CAPITAL entry totalling EUR 500 and zero other ledger entries. It had
two strategy audit rows and 730 daily candles for each product. The security
advisor reported only the project-level leaked-password-protection warning;
the new schema produced no security finding. The performance advisor reports
the newly created covering index as unused until normal query statistics accrue.

## Manual acceptance

1. Signed-out `/agent` access redirects to login.
2. Before the first preview, the page shows a clear empty state and the exact
   warning **Analysis only — no orders are executed.**
3. Run analysis and verify BTC/ETH show completed candle date, SMA20, SMA50,
   RSI14, both momentum values, annualised volatility, source cutoff, versions,
   data quality, candidate, reasons and explanation.
4. Repeat the action and verify the UI reports an idempotent skip. Confirm no
   ledger, candle or portfolio row changed.
5. Verify malformed/insufficient fixture history produces persisted HOLD, no
   financial movement and no execution control.
6. Verify desktop/mobile layout and locked Live mode.

## Deferred scope

Scheduled FR-030 execution, AI review FR-034/035, risk controls, simulated
pricing, orders/fills, cost basis, broker integration, activity timelines and
all live trading remain outside this phase.
