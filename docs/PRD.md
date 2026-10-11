# AI Investor — Product Requirements Document (PRD)

**Version:** 1.0  
**Date:** 11 October 2026  
**Status:** Approved scope / proposed implementation details  
**Product:** AI Investor  
**Target user:** One authenticated personal investor  
**Default environment:** DRY_RUN (no real assets or orders)

## 1. Executive summary

AI Investor is a private web application that monitors BTC/EUR and ETH/EUR, runs a rules-based strategy with AI-assisted evaluation once per day, and simulates investing an initial **€500 virtual balance**. The application explains every BUY, SELL, or HOLD decision; enforces hard risk limits; records fees and executions; and provides a transparent portfolio dashboard. It will support historical backtesting and forward paper-trading analysis.

The application is not a promise of profit or a substitute for investment advice. **No live execution is possible in v1.0.** Live mode will be visible only as a locked, nonfunctional future capability. A later product release must independently approve, design, test, and deploy live order functionality.

## 2. Agreed product decisions

| Topic | Decision |
|---|---|
| Architecture | Next.js/React, TypeScript-first, Tailwind CSS, shadcn/ui, Recharts |
| Exchange and assets | Coinbase Advanced Trade market data; BTC-EUR and ETH-EUR only |
| Decisions | Once daily; BUY, SELL, or HOLD; zero trades is valid |
| Agent | Rule-based indicators plus AI-assisted evaluation |
| Starting capital | Exactly €500.00 virtual EUR |
| Risk | Conservative defaults; editable within enforced safe bounds |
| Modes | Dry Run available; Live locked and unavailable |
| Scheduling | Supabase Cron invokes a server-side engine independently of the browser |
| Evaluation | Historical backtesting plus forward paper trading |
| Infrastructure | GitHub, local VS Code/Codex, Vercel frontend, Supabase Postgres/Auth/Edge Functions |

## 3. Problem, goals, and non-goals

### Problem

An individual investor with modest capital needs one trusted place to observe market conditions, understand automated decisions, measure performance after costs, and reliably prevent unintended trading. Generic price trackers do not show a reproducible decision trail; many trading bots obscure their risk controls or rely on unrealistic simulations.

### Objectives (v1)

1. Provide an accurate, up-to-date valuation of a virtual EUR/BTC/ETH portfolio, with timestamps.
2. Run one scheduled evaluation per UTC day even when the website is closed.
3. Generate reproducible trading proposals from a deterministic baseline strategy and add optional structured AI analysis.
4. Enforce trade-size, exposure, cash, data-quality, and portfolio-loss constraints in code.
5. Record all proposals and execution outcomes, including HOLD, rejected orders, fees, prices, and versioned inputs.
6. Quantify strategy performance against passive baselines using realistic friction assumptions.
7. Provide a secure, mobile-friendly dashboard and explicit controls to pause automation.

### Explicit non-goals

- Live purchases, sales, deposits, withdrawals, or access to Coinbase balances.
- Margin, derivatives, leverage, short selling, lending, staking, and assets other than BTC/ETH.
- Guaranteed daily trading or daily profit.
- A public multi-user trading SaaS, portfolio syncing, or fiat transfers.
- High-frequency trading, intraday signals, and unlimited autonomous AI order creation.
- Tax reporting, formal financial advice, or support for other exchanges.

## 4. Personas and key user journeys

**Owner/investor:** Logs in to check portfolio value and performance, inspect yesterday's decisions, review reasons for BUY/SELL/HOLD, change bounded risk settings, and pause the agent.

**Scheduled agent:** Loads validated market data, completes a deterministic analysis, requests optional AI review, applies risk rules, simulates eligible trades, and persists all results without duplicates.

**Researcher (same owner):** Tests a fixed strategy version against a historical date range and compares results with buy-and-hold benchmarks, knowing that backtest results are hypothetical.

## 5. Functional requirements

Priority **P0** = release blocker; **P1** = desirable initial release; **P2** = future.

### 5.1 Authentication and authorization

- **FR-001 [P0]** Private login through Supabase Auth; one owner account initially. Unauthenticated visitors cannot view portfolio or agent details.
- **FR-002 [P0]** Supabase Row Level Security (RLS) on all owner-visible tables. Service-role access stays server-side.
- **FR-003 [P0]** All write actions require owner authorization; internal scheduled jobs require separate server-to-server authentication.

### 5.2 Portfolio initialization and valuation

- **FR-010 [P0]** Create one `DRY_RUN` portfolio with exactly €500.00 EUR and zero BTC/ETH. Initialization is idempotent.
- **FR-011 [P0]** Display cash, BTC, ETH, asset market values, total net asset value (NAV), cumulative net return, realised and unrealised P&L, invested capital, and cumulative fees.
- **FR-012 [P0]** Mark holdings to explicit timestamped prices; identify when price data is stale instead of showing stale valuations as live.
- **FR-013 [P0]** Maintain an auditable, append-only cash/asset movement ledger; derive or reconcile balances from entries, not arbitrary client-provided amounts.
- **FR-014 [P1]** Portfolio performance series with daily snapshots; daily, weekly, monthly, and all-time views.

### 5.3 Coinbase data collection

- **FR-020 [P0]** Fetch BTC-EUR and ETH-EUR spot market information using Coinbase Advanced Trade public market-data endpoints when available; do not require a trading API key for v1.
- **FR-021 [P0]** Import UTC daily OHLCV candles, store source timestamps and exchange product identifiers, and deduplicate candles by product/granularity/start time.
- **FR-022 [P0]** Reject missing, malformed, nonpositive, inverted, or not-yet-closed candles; guard against large unexpected gaps and data staleness.
- **FR-023 [P0]** Store bid/ask or best available reference quote for simulated entry/exit; identify proxy quotes when a genuine executable spread is unavailable.
- **FR-024 [P1]** Fetch and display fresh prices while the app is open with a visible 'as of' timestamp; periodic polling is sufficient for v1.
- **FR-025 [P1]** Backfill sufficient candles for 20/50 SMA, 14-day RSI, historical volatility, and walk-forward research; paginate Coinbase API history when necessary.

**API note:** Coinbase public daily candles are exposed at `/api/v3/brokerage/market/products/{product_id}/candles` with `ONE_DAY` granularity and a documented maximum 350 candles per response. Verify product availability, response contracts, and rate limits during implementation; use pagination for longer history. Do not confuse this endpoint with authenticated `/api/v3/brokerage/products/...` endpoints.

### 5.4 Strategy and AI decision service

- **FR-030 [P0]** Run the strategy once daily on the latest *fully completed* UTC daily candle. Default scheduled execution: 00:15 UTC (a proposal, changeable before deployment).
- **FR-031 [P0]** Compute SMA(20), SMA(50), RSI(14), return/momentum, and recent volatility from historical daily candles using pure, testable functions.
- **FR-032 [P0]** Baseline rules issue one BUY/SELL/HOLD signal per asset, with deterministic parameters and a version identifier.
- **FR-033 [P0]** Agent may HOLD both assets; HOLD must be persisted with its reason and cannot create a trade fill.
- **FR-034 [P0]** AI review produces a validated structured object with market assessment, caution flags, plain-English explanation, and optional veto/size-reduction recommendation. AI **cannot initiate a trade absent a rules-based proposal, enlarge the amount, change asset symbols, or override risk checks**.
- **FR-035 [P0]** If AI times out, returns malformed output, or is unconfigured, default to conservative HOLD for the affected decision; record `AI_UNAVAILABLE` or `AI_INVALID_OUTPUT`.
- **FR-036 [P0]** Persist strategy version, indicator inputs, market-data cut-off, AI model/provider version if used, prompt version, signal, proposed amount, explanation, and outcome.
- **FR-037 [P1]** Provide a manual **Run Analysis** action with a default *analysis-only* preview, clearly separated from a once-per-day execution. Repeated manual calls must not duplicate fills.

**Proposed baseline strategy (configurable and subject to validation; not an investment claim):**

- Minimum warm-up: at least 60 valid daily closed candles, preferably 90 or more for stable analysis.
- **BUY candidate:** `close > SMA50`, `SMA20 > SMA50`, and `40 <= RSI14 <= 65`.
- **SELL candidate:** currently owns the asset AND `close < SMA50` AND `SMA20 < SMA50`.
- **HOLD:** all other cases, or missing/unsafe data.
- Default BUY amount: up to €25 per candidate, further reduced by cash and risk limits. Default SELL amount: up to 25% of current asset quantity, subject to minimum tradable notional; no forced full liquidation.
- If both assets produce BUY, deterministic execution order (BTC then ETH) and aggregate daily budget rules apply. SELL candidates are processed before BUY candidates to free virtual cash.
- Compute all signals exclusively from information available **before** simulated trade execution, using candle-close cutoff and independent execution reference prices.

### 5.5 Risk and simulated execution

- **FR-040 [P0]** Apply deterministic risk controls immediately before each simulated fill, using post-trade exposure projections and fresh prices.
- **FR-041 [P0]** Proposed initial guardrails (editable within bounds, with validation and audit): €25 max per BUY, €50 max aggregate new purchases/day, 60% combined crypto exposure, 40% per asset, no negative EUR or asset balances, no leverage.
- **FR-042 [P0]** At a 2% loss relative to prior UTC close NAV, block further new BUYs for the day. At a 10% drawdown from peak NAV, latch a circuit breaker blocking new BUYs until explicit owner review. These are circuit breakers, **not loss guarantees**; risk-reducing SELLs may remain permitted.
- **FR-043 [P0]** Simulate side-aware execution price (BUY at ask, SELL at bid when available), plus configurable slippage and trading fees. Show assumption provenance, timestamps, and fees for each trade.
- **FR-044 [P0]** Reject an order if price/fees/quantity cannot satisfy notional and precision requirements; product increments/minimums are to be retrieved where possible and validated again during a later live phase.
- **FR-045 [P0]** Commit simulated fill, ledger entries, order status, and updated balances within one atomic database transaction; use high-precision decimal amounts and explicit rounding policies.
- **FR-046 [P0]** Prevent duplicate fills on concurrent runs, retried cron events, network timeouts, and repeated button clicks through unique keys, server-side locking, and transaction-level idempotency.
- **FR-047 [P0]** A paused or disabled agent cannot place simulated trades. All live-order code paths must reject execution unconditionally.
- **FR-048 [P1]** Settings page supports fee/slippage assumptions, stop/limit thresholds, daily schedule, and strategy choices; changes create an immutable settings revision.

**Cost model:** No Coinbase fee rate should be claimed as universal. Record a configured estimate (fee in basis points, spread, slippage) and its source. Before live evaluation, compare estimates to the actual account's Coinbase fee tier. Net trade costs must not exceed available funds.

### 5.6 History, dashboard and audit

- **FR-050 [P0]** Dashboard: total NAV, change since inception, EUR cash, BTC and ETH holdings, allocations, agent status, latest run and timestamped quote age.
- **FR-051 [P0]** Activity timeline contains BUY, SELL, HOLD, rejected trades, circuit-breaker events and execution errors; show human-readable explanations.
- **FR-052 [P0]** Trade history supports dates, asset, side, quantity, reference/filled price, gross notional, fee, slippage estimate, and linked decision ID.
- **FR-053 [P1]** Charts show portfolio NAV, market prices, and BTC/ETH exposure; tables include exportable data (CSV optional).
- **FR-054 [P0]** Error state distinguishes failed market-data collection, AI failures, scheduler failures, stale pricing, and paper-broker errors.
- **FR-055 [P1]** Locked LIVE mode appears with 'Not available' messaging; UI state is not a substitute for backend enforcement.

### 5.7 Historical validation

- **FR-060 [P0]** Backtest a specified strategy configuration against historical BTC/ETH candle series, with explicitly selected starting €500 and start/end timestamps.
- **FR-061 [P0]** No look-ahead: at each simulated date, use only candles available at that time; simulate fills at a subsequent observable price, not at a signal price assumed to be executable retroactively.
- **FR-062 [P0]** Apply the *same strategy, risk controls, portfolio accounting and friction model* in historical and forward simulation, via shared pure modules.
- **FR-063 [P0]** Compare performance with cash-only, BTC buy-and-hold, ETH buy-and-hold and 50/50 BTC/ETH buy-and-hold, with comparable cost assumptions and explicit benchmark inception rules.
- **FR-064 [P1]** Show net return, worst drawdown, cumulative fees, turnover, exposure, number of trades and uninvested cash. Report that backtests cannot establish future profitability.
- **FR-065 [P0]** Support at least 30–60 calendar days of forward dry-run evaluation with monitoring before any live development is considered. Track reliability as well as returns.

## 6. Key screens and navigation

1. **Dashboard (`/dashboard`)** — current NAV, asset cards, allocation, NAV chart, latest status, recent actions and timestamped refresh.
2. **Markets (`/markets`)** — BTC/EUR and ETH/EUR prices, daily OHLC chart, indicator panel, last close and latest fresh quote.
3. **Agent (`/agent`)** — run history, next planned run, enable/disable, analysis-only preview, decisions, reasons, warnings and strategy version.
4. **Trades (`/trades`)** — simulated fills and rejected order history, sortable/filterable.
5. **Performance (`/performance`)** — historical returns, drawdowns, fees, benchmarks, backtesting results.
6. **Settings (`/settings`)** — read/edit bounded config, fee/slippage assumptions, schedule, account/profile, circuit-breaker acknowledgement.
7. **Live (`/live`)** — locked informational view only.

Use accessible responsive design, including mobile Safari, clear green/red neutral sign conventions, and consistent currency/decimal formatting. Never display a number without indication of currency or timestamp where applicable.

## 7. Proposed architecture

```text
                         Vercel (Next.js)
             Authentication + Portfolio UI + Owner API
                                  |
                            Supabase Auth
                                  |
                      Supabase PostgreSQL + RLS
                         ^                 ^
                         |                 |
          public market data               | reads runs/ledger/snapshots
                         |                 |
                  Coinbase API             |
                         |                 |
                         v                 |
Supabase Cron -> authenticated Edge Function runner
                   | market adapter
                   | indicator calculations
                   | deterministic baseline strategy
                   | optional LLM advisory/veto
                   | risk gate
                   | DRY_RUN-only paper broker
                   +---- atomic DB write + audit

LIVE adapter: type/interface + locked placeholder ONLY.
No live trading credentials or create-order integration in v1.
```

Keep trading logic platform-neutral in shared TypeScript modules, callable from both a browser-independent Supabase Edge Function (Deno TypeScript runtime) and offline backtesting. No import of Next.js request/session internals into strategy, risk, or accounting modules.

## 8. Data model (logical)

Every owner-scoped table includes an owner/portfolio identifier and relevant timestamps. Financial numbers use Postgres `numeric`, not IEEE floating point.

| Entity | Primary fields / purpose |
|---|---|
| `portfolios` | `id`, `owner_id`, `mode=DRY_RUN`, `initial_eur=500`, `state`, `created_at` |
| `portfolio_ledger` | `id`, `portfolio_id`, `trade_fill_id?`, `currency`, `delta`, `reason`, `created_at`; append-only |
| `market_candles` | `product_id`, `granularity`, `start_at`, OHLCV, `source`, `fetched_at`; unique key |
| `market_quotes` | `product_id`, `bid`, `ask`, `last`, `source_at`, `fetched_at` |
| `strategy_configs` | `id`, `portfolio_id`, `version`, rules, thresholds, fee/slippage assumptions, status, `created_at` |
| `agent_runs` | `id`, `portfolio_id`, `run_day_utc`, `run_type`, `status`, `started_at`, `ended_at`, `error_code`; unique daily execute key |
| `agent_decisions` | `id`, `run_id`, `product_id`, `strategy_version`, indicators, signal, `ai_review`, `decision`, reason, `data_cutoff` |
| `orders` | `id`, `decision_id`, side, `proposed_notional`, state, rejection reason, idempotency key |
| `trade_fills` | `id`, `order_id`, `product_id`, side, quantity, execution price, fee EUR, gross notional EUR, timestamp |
| `portfolio_snapshots` | `portfolio_id`, `as_of`, cash, quantities, prices, NAV, unrealised/realised P&L, high-water NAV; unique instant key |
| `risk_events` | `id`, `portfolio_id`, `run_id`, `type`, threshold, observed value, outcome, acknowledged time |
| `backtest_runs` | `id`, `strategy_version`, start/end, parameters, benchmark results, metrics, artifact pointers, status |
| `system_events` | errors, stale data, scheduled misses, API usage, structured job diagnostics (no secrets) |

Required constraints: valid enumerated modes, nonnegative balance invariants, unique idempotency keys, foreign keys, not-null timestamps, OHLC sanity checks, and immutable fills/ledger records. Use one service-owned SQL function or guarded transaction to apply fills atomically.

## 9. Accounting definitions

- **NAV** = EUR cash + (BTC quantity × BTC EUR marking price) + (ETH quantity × ETH EUR marking price).
- **Net return since start** = `(NAV / 500) - 1` (assuming no external deposits/withdrawals).
- **BUY**: deduct all-in quote cash spent including fee; increase purchased crypto by filled base quantity.
- **SELL**: decrease crypto by filled quantity; credit net EUR proceeds after fee.
- **Realised P&L**: use an explicit weighted-average cost method for product analytics (not a tax report); record acquisition cost including buy fees and realised disposal gain net of sell fees.
- **Unrealised P&L**: current marked holding value minus remaining attributed cost basis.
- **Portfolio daily P&L**: day-end NAV difference using explicit UTC daily boundaries.
- **Drawdown**: `(current NAV / historical peak NAV) - 1`.
- The ledger must reconcile to every balance and snapshot within a documented numeric tolerance.

## 10. Scheduling, failure handling and security

- Proposed schedule **00:15 UTC daily**, after a complete UTC day candle. Exact run time is configurable and must use a UTC cutoff consistently.
- Supabase Cron (`pg_cron`) invokes an authenticated Supabase Edge Function. Protect requests with server-held secret, verify authorization, record invocation ID, and bound runtime. Use Supabase Vault for cron secrets where applicable.
- A single executing job per portfolio/UTC day acquires an exclusive database lease or lock; `run_type=EXECUTE` unique by portfolio/day/strategy scope. Manual preview creates `run_type=PREVIEW` and never fills. Failed execution may retry safely with the same idempotency keys.
- Retry rate-limited/transient market-data errors with backoff, but do not execute trades using stale, incomplete or unverified candles. No forecasted price substitutions.
- The strategy must degrade to HOLD if AI or market data are unavailable. Severe accounting or security errors must halt execution and surface an alert.
- No exchange API key is required in v1; store LLM secrets only in backend environment variables. Never persist tokens in prompts, responses or logs.
- Apply least-privilege Supabase policies; rate limit admin actions; validate all inputs; enable dependency and secret scanning in CI. Pause and risk settings edits are auditable.
- `LIVE` is blocked in UI, APIs, database constraints/permissions, and broker factory; no production code capable of submitting real orders ships in v1.

## 11. Nonfunctional requirements (proposed targets)

- **Correctness:** All financial calculations deterministic and verifiable; no negative balances, double fills or future-data leakage.
- **Reliability:** At least 99% of scheduled jobs result in a recorded success or explicit failure during the forward test. A failure cannot be mistaken for HOLD.
- **Data freshness:** Display age explicitly; no simulated fills when required inputs are stale or unavailable.
- **Performance:** Dashboard initial meaningful render target <3 seconds on typical broadband, excluding third-party outages; cached historical series.
- **Security:** No unauthenticated investment data; no privileged keys in browser bundles; zero enabled live-order paths.
- **Observability:** Structured logs, stable error codes, run duration, schedule lag, fees spent, data latency and daily reconciliation status.
- **Testability:** Pure deterministic business modules; fixtures and time travel via injected clock/provider interfaces.

## 12. Release acceptance criteria

- [ ] One owner can log in and see exactly €500.00 in EUR and zero BTC/ETH before any trades.
- [ ] Public Coinbase BTC-EUR and ETH-EUR daily candles import; invalid/incomplete candles are rejected.
- [ ] Closing prices and recent quotes include trusted source time and freshness indicators.
- [ ] SMA, RSI, momentum and risk rule unit tests pass deterministic fixtures.
- [ ] One daily scheduled job produces two persisted decision records; both may HOLD.
- [ ] A retry/concurrent run cannot create a duplicate order/fill/ledger entry.
- [ ] Total cash and crypto conservation reconcile across fees, trades and snapshots.
- [ ] A BUY above €25, €50 daily, 40% asset or 60% portfolio exposure is prevented.
- [ ] Breakers block risk-increasing BUYs, allow explicitly safe risk reductions, and require an auditable reset.
- [ ] AI malformed output/outage produces safe HOLD and an explicit error state.
- [ ] Manual preview never executes a simulated fill.
- [ ] Backtests use no future information and include net fee/spread assumptions and four benchmarks.
- [ ] Private routes and data pass authentication/RLS authorization tests.
- [ ] Live mode remains non-operational through UI, API, DB, and broker layers; test attempts fail closed.
- [ ] All release checks pass in CI and Vercel deployment works.

## 13. Open implementation parameters (not blockers to writing the code)

The owner confirmed the overall approach; these values are **proposed defaults**, not additional owner-approved facts:

1. First daily execution at **00:15 UTC** (after previous day's fully closed candle).
2. Trading heuristics in §5.4 and exact fee/slippage assumptions.
3. Risk bounds in §5.5, subject to measured backtest and market minimums.
4. AI model/provider, per-run token/cost ceiling, and whether AI is on by default. Conservative fallback is HOLD.
5. Duration and starting date of historical data import and backtesting.
6. Notification channel: in-app visibility is required; external notifications can follow.

All proposals should be configurable and versioned without weakening fixed system safety constraints.

## 14. Source references (reviewed 11 October 2026)

- Coinbase Advanced Trade overview: https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/overview
- Coinbase public product candles (`ONE_DAY`, max 350): https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/public/get-public-product-candles
- Supabase scheduled Edge Functions and Vault: https://supabase.com/docs/guides/functions/schedule-functions
- Supabase Cron: https://supabase.com/docs/guides/cron
- Supabase Edge Functions TypeScript / Deno runtime: https://supabase.com/docs/guides/functions
- Supabase Auth and RLS: https://supabase.com/docs/guides/database/overview

---

**PRD scope sign-off:** Product requirements defined for a **Dry Run-only v1.0**. Launch decisions, deployment secrets, and live trading authorization are outside this document.
