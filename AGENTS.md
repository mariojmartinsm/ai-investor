# AI Investor — Codex Agent Instructions

Read `docs/PRD.md` and `docs/CODEX_IMPLEMENTATION_PLAN.md` before any code changes.

- Implement only the requested `AI-###` issue; plan, implement, test, then provide concise results.
- Mode is **DRY_RUN only**. Do not implement or enable Coinbase live orders or authenticated trading features. A future live broker interface must throw `LIVE_DISABLED`.
- Starting balance is exactly **€500 virtual EUR**, created once idempotently.
- Trade only BTC-EUR and ETH-EUR, at most one execution cycle per UTC day; HOLD is valid.
- AI is advisory: can veto or reduce a deterministic candidate, never create/expand an order or bypass risk.
- All money/asset arithmetic must be decimal-safe, traceable and persisted in atomic, idempotent ledger transactions.
- Broker must reject stale, malformed, incomplete or missing market data and unavailable/invalid AI.
- Maintain strict owner authentication, Supabase RLS, server-only secrets, and separate protected cron authentication.
- Backtests may access only historical information available at each simulation time, with next-price executions and costs.
- Add tests for threshold boundaries, concurrent runs, failures, and security on every relevant PR.
- Do not bypass safeguards or quiet errors to make tests pass. Keep README, migrations and docs updated.

For each completed task, report issue ID, changes, files, test commands/results, deployment/migration steps, security considerations, and next suggested issue.
