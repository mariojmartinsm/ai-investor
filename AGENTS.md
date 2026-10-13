# AI Investor — Codex Agent Instructions

Read `docs/PRD.md`, `docs/CODEX_IMPLEMENTATION_PLAN.md` and `README.md` before any code changes.

- Implement only the requested development phase or functional requirements. Use the PRD's **FR-xxx** IDs for scope and traceability; retain `AI-###` issue references where relevant to the implementation plan.
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

## Permanent development workflow

1. Start each new phase from updated `main` using `git pull --ff-only origin main`, then create a dedicated feature branch. Inspect the branch, status and differences first; preserve existing user changes and never reset them to obtain a clean tree. Carry unfinished authorized work forward on its feature branch before starting another phase.
2. Define the requested FR-xxx scope, inspect existing implementation and applied migrations, and reuse working functionality. Do not replay applied migrations or reset financial history.
3. Implement and validate all requested requirements. Fix root causes of test and build failures, and add regression tests for defects. Keep authentication, RLS, decimal precision, append-only accounting and idempotency safeguards intact.
4. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e` and `npm run build`; also run relevant database/concurrency checks. Use isolated fixtures, never real portfolio balances or funding entries. Do not skip, remove or disable tests to achieve a passing result.
5. When local validation passes, review the final diff and stage only intended source changes, tests, documentation and necessary migrations. Exclude secrets, ignored files and generated artifacts. Commit with the applicable FR-xxx IDs, push the feature branch and create a PR targeting `main` with requirement mapping, test results and migration status.
6. Complete the authorized Git lifecycle autonomously when all gates pass: confirm no merge conflicts and all required GitHub checks pass, then squash merge if supported. Never bypass branch protection or required checks, force-push, or merge with failing validation or unresolved security concerns. If permissions or checks block completion, leave the work intact and report the blocker.
7. After merging, switch to `main`, run `git pull --ff-only origin main`, verify `main` matches `origin/main` and the working tree is clean, and delete the merged local feature branch only if safe. Begin the next phase only from this updated `main`.
8. Never enable LIVE trading without separate explicit approval and a separately approved product release. DRY_RUN safeguards remain mandatory throughout this workflow.

For each completed task, report FR IDs and relevant issue IDs, changes/files, errors fixed, test commands/results, database validation and migration steps, security considerations, commit SHA, PR URL/merge status, local synchronization status, outstanding issues and the next suggested PRD requirement.
