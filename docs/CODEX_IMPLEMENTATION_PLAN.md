# AI Investor — Codex Implementation Plan

**Version:** 1.0  
**Date:** 11 October 2026  
**Depends on:** `docs/PRD.md`  
**Delivery target:** Deployed personal Dry Run webapp; Live always locked  
**Execution approach:** Small reviewable pull requests, automated checks, manual acceptance per milestone

## 1. How to use this plan

- Create one GitHub repository (`ai-investor`) and clone to local VS Code. Use Codex to implement individual issues, **not** the entire system in one prompt.
- Each issue gets a short-lived feature branch, tests, a migration where needed, and a pull request. Merge only after review.
- Treat the PRD as the product contract and this document as the build sequence. If the code changes scope, update docs with the code.
- Secrets and privileged access remain under user control. Codex must never execute real trades, configure live Coinbase trading keys, bypass RLS, or disable safety checks to make tests pass.
- A milestone is complete only when its stated demo and automated acceptance checks pass.

## 2. Resolved technical design

| Area | Selection / constraints |
|---|---|
| Repo | Single Next.js + shared TS packages + Supabase functions repo |
| Web | Next.js App Router, React, TypeScript strict, Tailwind, shadcn/ui, Recharts |
| Data | Supabase PostgreSQL, SQL migrations, typed DB client, RLS |
| Auth | Supabase Auth with one owner initially |
| Scheduler | Supabase Cron invoking a protected Edge Function; fixed UTC schedule |
| Engine | Pure TypeScript business functions; Deno-compatible runner imports |
| Market | Coinbase Advanced Trade **public market** BTC-EUR/ETH-EUR endpoints for Phase 1 |
| Simulation | Atomic SQL transaction + idempotent PaperBroker; decimal arithmetic |
| AI | Interface with configurable provider and schema-validated JSON advisory; no trade creation |
| Testing | Vitest (unit/integration), Playwright (E2E), SQL/RLS checks, deterministic fixtures |
| CI/CD | GitHub Actions lint/typecheck/tests/build; Vercel deploy for web; Supabase migrations and function deploy via approved pipeline |
| Live | Placeholder type/interface only; hard-deny runtime, no credentials/orders |

### Compatibility caution

Supabase Edge Functions run TypeScript on a **Deno-compatible** runtime, while Next.js server code runs on Node-compatible infrastructure. Keep shared trading modules runtime-agnostic: no filesystem, browser APIs, Next.js headers, Node-only SDKs, or incompatible dependencies. Verify compatibility for `decimal.js`, schema validators and AI SDK before connecting the Edge runner. If an AI SDK is incompatible, call its HTTP API with a narrow adapter.

### Execution sequence (single scheduled day)

```text
cron trigger / manual preview
 -> authenticate job / owner
 -> acquire portfolio+UTC-day execution key (preview never fills)
 -> load config, balances, snapshots, and last completed candle
 -> fetch/validate products, daily candles and execution quotes
 -> calculate indicator snapshot
 -> generate rule-based signal for BTC and ETH
 -> request optional bounded structured AI advisory
 -> downgrade to HOLD on AI/data failure
 -> apply risk gate using current portfolio and proposed post-trade state
 -> choose eligible paper orders (SELL before BUY; stable asset order)
 -> execute through PaperBroker atomic SQL function
 -> post ledger/fills and validate balance invariants
 -> calculate and persist portfolio snapshot and run status
 -> expose decision, reason, fees, timestamps and warnings in UI
```

Order-reject reason codes: `NO_SIGNAL`, `INSUFFICIENT_CASH`, `MAX_TRADE`, `DAILY_BUDGET`, `MAX_ASSET_EXPOSURE`, `MAX_TOTAL_EXPOSURE`, `DAILY_LOSS_BREAKER`, `DRAWDOWN_BREAKER`, `MARKET_STALE`, `CANDLE_INCOMPLETE`, `MIN_NOTIONAL`, `AI_UNAVAILABLE`, `LIVE_DISABLED`, `DUPLICATE_EXECUTION`, `ENGINE_ERROR`.

## 3. Repository layout

```text
ai-investor/
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (private)/dashboard/page.tsx
│   ├── (private)/markets/page.tsx
│   ├── (private)/agent/page.tsx
│   ├── (private)/trades/page.tsx
│   ├── (private)/performance/page.tsx
│   ├── (private)/settings/page.tsx
│   └── (private)/live/page.tsx
├── components/{layout,charts,portfolio,agent,trades,ui}/
├── lib/{auth,db,market,formatting}/
├── packages/core/src/
│   ├── domain/{assets,money,events,types}.ts
│   ├── indicators/{sma,rsi,volatility,momentum}.ts
│   ├── strategy/{baseline,contracts}.ts
│   ├── risk/{rules,exposure,circuit-breakers}.ts
│   ├── broker/{broker-interface,paper-broker,live-disabled}.ts
│   ├── portfolio/{ledger,accounting,valuation}.ts
│   ├── backtest/{engine,benchmarks,metrics}.ts
│   └── agent/{orchestrator,ai-advisor,schemas}.ts
├── supabase/
│   ├── migrations/
│   ├── seed.sql
│   ├── functions/daily-agent/index.ts
│   └── functions/_shared/{auth,db,coinbase}.ts
├── tests/{fixtures,integration,e2e,security}/
├── docs/{PRD.md,CODEX_IMPLEMENTATION_PLAN.md,ADR-0001.md}/
├── .github/workflows/ci.yml
├── .env.example
├── AGENTS.md
├── README.md
└── package.json
```

Prefer importing `packages/core` source through supported workspace aliases and test the actual Edge bundling early. The `live-disabled` implementation must unconditionally throw a typed `LIVE_DISABLED` error.

## 4. GitHub issue backlog (build in this order)

Sizing: **S** approx one focused PR; **M** multiple related changes; **L** split before starting. These are relative sizes, not promised timelines.

### Milestone M0 — Repository and quality foundation

| ID | Size | Issue / deliverable | Acceptance |
|---|---|---|---|
| AI-001 | S | Bootstrap strict TS Next.js + Tailwind + shadcn/ui | App renders locally; strict TypeScript checks |
| AI-002 | S | Install lint, formatting, Vitest, Playwright and GitHub Actions | PR checks fail on lint/type/test/build errors |
| AI-003 | S | Add AGENTS.md, README, .env.example and architecture decision record | Safety principles explicit; no credentials committed |
| AI-004 | S | Add responsive app shell with route placeholders | Works desktop/mobile; Live route visibly locked |

**M0 demo:** CI-green app running locally and deployed to Vercel, without trading data or exchange API keys.

### Milestone M1 — Supabase identity and accurate data model

| ID | Size | Issue / deliverable | Acceptance |
|---|---|---|---|
| AI-010 | M | Supabase project wiring and server/client typed access | Environment split and safe session handling |
| AI-011 | M | Login/logout, protected routes and owner-only access | Private pages cannot load logged out |
| AI-012 | M | Migrations: portfolios, ledger, candles, quotes, strategy configs | Schema has FKs, constraints, numeric precision |
| AI-013 | M | Migrations: runs, decisions, orders, fills, snapshots, risk/events, backtests | Unique idempotency indexes and state transitions |
| AI-014 | M | RLS policy + security tests and restricted owner-scoped reads | Cannot read/write another owner's data; service key never client |
| AI-015 | S | Idempotent initialize portfolio SQL function | Exactly one €500 starting journal entry, no duplicates |

**M1 demo:** Owner signs in, sees €500 cash; refreshing or calling setup twice cannot double funds.

### Milestone M2 — Market data and valuations

| ID | Size | Issue / deliverable | Acceptance |
|---|---|---|---|
| AI-020 | M | Typed Coinbase public market-data adapter | BTC-EUR/ETH-EUR only; valid retries/timeouts; mocked tests |
| AI-021 | M | Daily candle ingestion/backfill with 350-candle pagination | Sort, dedupe, UTC buckets, reject incomplete/invalid series |
| AI-022 | S | Spot quote ingestion with source timestamps and freshness rules | Wrong/stale price blocks trade, clear UI warning |
| AI-023 | M | Decimal money + quantity utilities; portfolio valuation | €500 starts correctly, decimals stable and NAV reconciles |
| AI-024 | M | Dashboard cards and market charts | Responsive charts, source and age clearly shown |

**M2 demo:** Working EUR/BTC/ETH price dashboard. No trading yet.

### Milestone M3 — Trading engine and risk controls

| ID | Size | Issue / deliverable | Acceptance |
|---|---|---|---|
| AI-030 | M | Pure SMA20/SMA50, RSI14, volatility/momentum library | Verified against trusted fixture vectors, no lookahead |
| AI-031 | M | Versioned deterministic BUY/SELL/HOLD strategy | All three signals covered; HOLD allowed |
| AI-032 | M | Risk gate with bounds, exposures, cash checks and two circuit breakers | Rejection codes tested at thresholds and off-by-one boundaries |
| AI-033 | M | Side-aware paper pricing with spread/slippage and fee math | Buy cost and sell proceeds correct, no negative funds |
| AI-034 | M | SQL atomic fill with order/fill/ledger/balance updates | Exactly-once per idempotency key, including concurrent requests |
| AI-035 | M | Portfolio cost basis, realised/unrealised P&L, NAV snapshots | Accounting identities and invariants tested |
| AI-036 | S | Broker interface + locked live adapter | Live constructor/order submission cannot succeed |

**M3 demo:** Simulate controlled trades against fixture prices; all accounting and risk tests pass.

### Milestone M4 — AI review and daily automation

| ID | Size | Issue / deliverable | Acceptance |
|---|---|---|---|
| AI-040 | M | Structured AI advisory adapter with schema validation and cost/time budgets | Can veto/downsize only, never originate/expand order |
| AI-041 | M | Agent orchestration with recorded RUN/DECISION/error states | Two decisions/day, reasons persisted, HOLD first-class |
| AI-042 | M | Supabase Edge Function with verified cron authentication and isolated secrets | Cannot invoke without scheduler authority |
| AI-043 | M | pg_cron job, unique UTC-day lock, retry/idempotency, paused-state handling | Retry or overlap creates no duplicate fill |
| AI-044 | S | Manual **preview-only** analysis and pause/unpause UI | Preview never fills; pause blocks purchases immediately |
| AI-045 | M | Agent activity timeline and failure diagnostics | Each action has inputs, version, reason and outcome |

**M4 demo:** Job runs with browser closed; appears on dashboard with daily BUY/SELL/HOLD explanations. Unconfigured AI produces HOLD, not unsafe orders.

### Milestone M5 — Backtesting, comparison and validation

| ID | Size | Issue / deliverable | Acceptance |
|---|---|---|---|
| AI-050 | M | Replay engine with clock injection and historical data cutoffs | Same strategy/risk/fee code as forward engine, no future candles |
| AI-051 | M | Four passive benchmarks plus net return/drawdown/fee metrics | Same starting €500 and time window; cost rules stated |
| AI-052 | M | Backtesting UI, metrics, benchmark overlays, config revision IDs | Clearly labelled simulated, reproducible results |
| AI-053 | M | End-to-end flows: login, setup, pause, simulated trading, blocked risk, outage | Playwright CI green; protects restricted routes |
| AI-054 | S | Security review, RLS recheck, failure-mode drills, dependency scanning | No secret leakage; broker fails closed |
| AI-055 | M | Forward monitoring and 30–60 day observation protocol | Daily run coverage/alerts, accounting reconciliation, return-vs-baseline |

**M5 demo:** Reproducible backtest and forward paper-trading operations dashboard, with transparent limitations.

### Future milestone M6 (separate product approval only)

Define requirements for account-linking, Coinbase portfolio segregation, read-only connectivity, live preview, order permissions, independent kill switch, reconciliation, funding and withdrawal safeguards, incident response and live approval. **Do not implement live order submission in v1.**

## 5. Development dependencies / critical path

```text
M0 Foundation
  -> M1 Auth + Database
      -> M2 Market Feed + Valuation
          -> M3 Indicator/Strategy + Risk + PaperBroker
              -> M4 Daily Agent + AI + Cron + UI
                  -> M5 Backtests + Reliability + Forward Test
```

The bulk of functionality should be developed/tested on fixtures before any scheduled job is enabled. Market adapter, indicators and UI can progress in parallel once shared contracts exist. Do not permit cron to execute fills before atomic accounting and idempotency tests pass.

## 6. Database migration and safety details

1. Use migration files for all schema/function changes; include rollback notes and backfill steps in PR descriptions.
2. Use `numeric(28,12)` or a documented precision appropriate for EUR and BTC/ETH; calculate in TypeScript with decimal math and convert values at DB boundaries as decimal strings.
3. The ledger uses one signed delta per currency and is append-only. A fill creates separate EUR and base-asset postings plus explicit fee accounting fields.
4. Each fill has a unique reference to an order; each daily execute run has unique `(portfolio_id, run_day_utc, run_type='EXECUTE')` semantics (partial unique index if needed).
5. `portfolio_snapshots` derive values from ledger and price data in one reconciliation process; do not trust UI-input balances.
6. Apply fills in one database transaction that locks portfolio state, validates the idempotency key, re-evaluates risk from current balances, writes order/fill/ledger rows, and commits.
7. RLS owner reads are separate from restricted service inserts; policies must prevent owners from directly manufacturing ledger entries or changing historical fills.
8. Make database-only execution privileges narrowly scoped and keep Supabase service credentials in Edge Function secrets only.

### Key financial invariants

- `EUR_cash >= 0`; `BTC_qty >= 0`; `ETH_qty >= 0`.
- Pretrade exposure checks use **post-trade** market value and account for all fees; they cannot rely only on candidate size.
- For a BUY: `new_cash = old_cash - (fill_qty * execution_ask + fee)`, `new_qty = old_qty + fill_qty`.
- For a SELL: `new_cash = old_cash + (fill_qty * execution_bid - fee)`, `new_qty = old_qty - fill_qty`.
- `NAV = EUR_cash + BTC_qty * BTC_mark + ETH_qty * ETH_mark` at snapshot instant.
- Ledger movement conservation and lot/cost-basis identities pass with documented decimal rounding rules.
- Never use JS Number for authoritative monetary arithmetic.

## 7. Coinbase market-data implementation details

- First use the public Advanced Trade endpoint `GET /api/v3/brokerage/market/products/{product_id}/candles` with `ONE_DAY`, `start`, `end`, and `limit <= 350`; query only `BTC-EUR` and `ETH-EUR`.
- Store candle start in UTC. Order by timestamp regardless of response order. Enforce complete daily bucket start/end and avoid the in-progress UTC day candle.
- Fetch latest reference prices/bid-ask via documented compatible public market endpoints; provide a strict adapter interface, because endpoint capabilities/limits can change.
- Use HTTP timeouts, bounded retries with jitter for 429/5xx, service-side caching, typed schema validation, and tests with recorded-but-sanitised responses.
- Failed ingestion must mark run `FAILED_DATA`; **do not fabricate missing candles or silently trade on stale data**.
- For over 350 days of daily candles, backfill in nonoverlapping date windows and deduplicate by unique key.
- No Coinbase API keys, read-only account connections, or trading permissions are needed for Phase 1.

## 8. AI integration contract

Design a small `AiAdvisor` interface receiving only:

- ISO UTC observation time and closed-candle cutoff;
- asset/product ID;
- latest validated indicators and trend summary;
- portfolio allocation and bounded budget;
- deterministic candidate BUY/SELL/HOLD and risk context;
- strategy version and maximum prompt/token/cost budget.

Return schema:

```ts
type AiReview = {
  assessment: 'SUPPORT' | 'CAUTION' | 'VETO';
  explanation: string;                 // length-limited and sanitized
  cautionFlags: string[];
  sizingMultiplier: '0' | '0.25' | '0.5' | '1'; // never > 1
  modelVersion: string;
  promptVersion: string;
};
```

Policy: `VETO` -> HOLD; `CAUTION` -> MAY REDUCE ONLY; any invalid/late/unavailable AI response -> HOLD and diagnostic. If baseline says HOLD, AI cannot upgrade it to a trade. All accepted proposals still pass fresh risk validation.

During backtesting, default to **deterministic strategy without AI** to ensure reproducibility, or use cached, timestamped AI outputs with explicit model/prompt versions. Do not ask a modern model to 'predict' past events from knowledge it could already possess. Report AI-assisted and baseline performance separately.

## 9. Testing strategy

| Layer | Tool | Must-cover cases |
|---|---|---|
| Pure rules/math | Vitest | SMA/RSI warmup, crossovers, rounding, NaN rejection, default HOLD |
| Risk engine | Vitest | €25, €50, 60%, 40%, cash, breakers, stale quote, restricted asset |
| Broker/accounting | Vitest + DB integration | BUY, SELL, fee inclusion, insufficient cash, precision, cost basis, snapshots |
| Concurrency | Integration test with Postgres | Same key twice, overlapping cron, failed-then-retried fill |
| RLS/auth | SQL + integration | User A cannot access user B, no client service-role, denied direct ledger writes |
| Exchange adapter | HTTP mocks + smoke test | Valid/invalid OHLCV, 429 retry, missing product, 350-candle batches |
| AI adapter | Stubs/fixtures | JSON schema, hallucinated assets, timeout, budget overflow, veto |
| Backtester | Fixtures/time travel | No future information, same shared engine, benchmark reproducibility |
| Frontend E2E | Playwright | Login, navigation, mobile layout, update settings, preview, pause, history |
| Safety integration | Tests + manual check | All live order paths fail with `LIVE_DISABLED` |

**Property-based invariant tests recommended:** Random sequences of legal BUY/SELL/HOLD operations never make balances negative, duplicate ledger postings, or break NAV reconciliation (within documented rounding tolerance).

## 10. Deployment and operations checklist

- [ ] Separate `.env.local`, Supabase Edge Secrets, and Vercel environment variables; no secrets in Git.
- [ ] Apply schema migrations only after review; verify RLS with two synthetic users.
- [ ] Enable GitHub secret scanning and CI quality gates.
- [ ] Deploy Vercel web app; verify protected routes, session handling and mobile view.
- [ ] Deploy Supabase Edge Function and verify scheduler signature/secret checks.
- [ ] Configure Supabase Cron only after idempotency/risk/accounting acceptance tests pass.
- [ ] Initialise exactly one DRY_RUN portfolio, verify €500 ledger entry and no duplicates.
- [ ] Configure/verify daily UTC cutoff and scheduled interval; display last and next run.
- [ ] Confirm safe failure on Coinbase outage and AI unavailability.
- [ ] Record job failures and alert via in-app system status; add external notifications later.
- [ ] Check that frontend bundle exposes no privileged environment variables.
- [ ] Confirm all `LIVE` routes and broker calls deny execution.
- [ ] Run a replay/backtest, record strategy/config version, and establish benchmark baseline.
- [ ] Begin forward paper trading and inspect run history and balance reconciliation daily.

## 11. Codex working instructions (`AGENTS.md` contract)

Codex must follow these rules on every task:

1. Read `docs/PRD.md` and `docs/CODEX_IMPLEMENTATION_PLAN.md` before implementing.
2. Deliver **one issue at a time**; state assumptions, affected files and acceptance tests.
3. Never add Coinbase authenticated order creation, withdrawals, margin or live credential handling in v1.
4. Treat market data and AI content as untrusted; validate all external data.
5. Pure TypeScript rules, time-injected code, decimal-safe financial computations and small composable modules.
6. Financial postings happen only through atomic, idempotent, privileged backend paths.
7. No backtest future-data leakage. No trade if inputs/AI are missing or stale.
8. Enforce RLS, owner authorization and server-side secret handling.
9. Tests for positive, negative, failure and concurrent paths; run lint, typecheck, tests and build before PR.
10. Never weaken risk tests, disable safety guards or silence TypeScript errors to make CI pass.

## 12. Copy/paste Codex prompts

### Prompt A — Bootstrap repository (AI-001 through AI-004)

> Read `docs/PRD.md` and `docs/CODEX_IMPLEMENTATION_PLAN.md`. Implement only Milestone M0: Next.js App Router + TypeScript strict + Tailwind + shadcn/ui; set up formatting, ESLint, Vitest, Playwright, GitHub Actions, .env.example and a clear README. Create a mobile-responsive app shell with Dashboard, Markets, Agent, Trades, Performance, Settings, and Live Locked placeholder pages. Do not implement exchange trading, wallet access, cron, AI calls or simulated orders yet. Add tests and show local verification commands, changed files, assumptions and outstanding items. Make changes in small reviewable commits.

### Prompt B — Database/auth foundation (AI-010 through AI-015)

> Read both docs and implement the next uncompleted Milestone M1 issue only. Build Supabase Auth for a single owner, schema migrations with accurate numeric types and relational constraints, RLS policies, append-only ledger permissions and one idempotent €500 DRY_RUN portfolio initializer. Include migrations, test fixtures, auth/RLS tests, and a simple dashboard that displays the initialized cash. Do not allow client-side direct ledger mutation. Stop after tests and provide a PR summary.

### Prompt C — Coinbase feed / portfolio (AI-020 through AI-024)

> Implement the approved M2 issue using Coinbase Advanced Trade *public* market-data APIs for BTC-EUR and ETH-EUR. Use `ONE_DAY` completed UTC candles, validate and deduplicate data, support 350-candle pagination, and expose freshness timestamps. Add decimal-safe NAV calculations and dashboard read views. Do not request Coinbase API keys or simulate/submit orders in this milestone. Include HTTP mocks for errors, invalid data and rate limits.

### Prompt D — Core paper trading (AI-030 through AI-036)

> Implement one M3 issue at a time: pure indicator functions, versioned deterministic strategy, hard risk engine, side-aware cost and fee model, idempotent PaperBroker, and atomic SQL ledger posting. Follow the monetary and exposure invariants in the PRD. Add concurrency/retry and all threshold boundary tests. LiveBroker must be a type-safe hard-deny stub raising LIVE_DISABLED. No new UI requirement should override accounting correctness.

### Prompt E — Scheduled agent (AI-040 through AI-045)

> Implement the current M4 issue only. Add strict-schema AI review that can only veto or reduce baseline proposals, conservative HOLD fallback, browser-independent Supabase Edge Function, protected Cron invocation, per-UTC-day execution uniqueness, structured audit and a manual analysis-only preview. Make it impossible for manual previews or retries to create duplicate fills. Expose the reason for every BUY/SELL/HOLD and each blocked action in the UI. Write fault-injection and authorization tests.

### Prompt F — Backtesting and release verification (AI-050 through AI-055)

> Implement the current M5 issue. Reuse the identical strategy, risk, paper broker, and friction code in a historical replay that reveals one completed candle at a time. Execute on a later observable price, include realistic fee/slippage settings and four benchmarks, and show net return/drawdown/trades/costs. Add reproducible fixtures, E2E tests, RLS security tests and a forward-trading monitoring checklist. No claims of profitability, and no live trading implementation.

### Standard end-of-task Codex response

For each issue, ask Codex to provide:

```text
Issue: AI-###
Summary of changes:
Files changed:
Database changes and migration instructions:
Tests run and results:
Manual acceptance steps:
Risk/security considerations:
Known limitations:
Proposed next issue:
```

## 13. Suggested first development session

1. Create `ai-investor` as a **private** GitHub repository.
2. Check in `docs/PRD.md`, `docs/CODEX_IMPLEMENTATION_PLAN.md`, and `AGENTS.md`.
3. Open repository in VS Code with Codex.
4. Start with **Prompt A / AI-001**, not with an all-in-one build request.
5. Review M0 locally and merge to `main` only after CI succeeds.
6. Create Supabase and Vercel projects in M1/M0 respectively; keep secrets local or in provider secret stores.
7. Do **not** enable scheduled execution until M3 risk and ledger verification is complete.

## 14. Official technical references (reviewed 11 October 2026)

- Coinbase API: https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/overview
- Public product candles: https://docs.cdp.coinbase.com/api-reference/advanced-trade-api/rest-api/public/get-public-product-candles
- Scheduled functions + Vault: https://supabase.com/docs/guides/functions/schedule-functions
- Supabase Cron: https://supabase.com/docs/guides/cron
- Supabase Edge Functions: https://supabase.com/docs/guides/functions
- Supabase database and RLS: https://supabase.com/docs/guides/database/overview

**Exit condition for v1:** A protected, reproducible, fee-aware, independently scheduled **Dry Run** portfolio system with strong audit and safety properties. No real trading.
