# AI Investor

AI Investor is a Dry Run-only investment dashboard for a virtual EUR, BTC and ETH portfolio. This repository currently implements **AI-001: the static application bootstrap** using Next.js App Router, strict TypeScript, Tailwind CSS and shadcn/ui.

The dashboard displays a **€500.00 sample virtual portfolio**, labelled placeholder BTC/ETH values and an unconfigured agent. All displayed financial values are sample data. Live mode is locked and unavailable.

## Local setup

Use **Node.js 24 LTS** and **npm**. The bootstrap was tested with Node.js 24.16. The tooling also supports Node.js 20.19+ within version 20, or 22.13+ within version 22.

From the repository directory, install the locked dependencies:

```bash
npm ci
```

For an initial dependency installation or an intentional dependency update, use `npm install`. Keep the resulting `package-lock.json` with the project.

No environment variables are required for this milestone. `.env.example` contains comments only; no credentials or service connections are configured.

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The root route redirects to `/dashboard`. Navigation also includes Markets, AI Agent, Trades, Performance and Settings, with an informational locked Live page.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local development server. |
| `npm run build` | Create a production build. |
| `npm run start` | Serve the production build after running `npm run build`. |
| `npm run lint` | Run ESLint. |
| `npm run typecheck` | Check strict TypeScript types without emitting JavaScript. |

Validate changes locally with:

```bash
npm run lint
npm run typecheck
npm run build
```

## Project structure

```text
app/          App Router layouts, pages and global styles
components/   Responsive shell, shared page components and UI primitives
lib/          Shared utilities and navigation definitions
docs/         Product requirements and implementation plan
components.json  shadcn/ui configuration
```

The design uses shared color, spacing and typography tokens in the global stylesheet, along with shadcn/ui Card, Badge and Button components. System fonts keep builds independent of font downloads.

Next.js automatic agent-rule generation is disabled in `next.config.ts` so running the development server preserves the existing `AGENTS.md`.

Read [AGENTS.md](AGENTS.md), [the PRD](docs/PRD.md) and [the implementation plan](docs/CODEX_IMPLEMENTATION_PLAN.md) before making changes.

## Current scope

This is a local UI prototype. Authentication, Coinbase and Supabase connections, market feeds, AI analysis, scheduling, trading logic and portfolio persistence are not implemented. The €500 display does not initialize an account or write a ledger. No real API secrets, live execution paths or deployment configuration are included.

The next suggested issue is **AI-002**: formatting, Vitest, Playwright and GitHub Actions checks. Database and authentication work follows in Milestone M1.

## Known tooling limitations

The current Next.js React/accessibility lint plugins require ESLint 9, which npm marks as deprecated. ESLint 10 is not yet compatible with all their peer requirements.

`npm audit` currently reports five high-severity entries from one [unpatched `braces` advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), through the development-only Next.js ESLint dependency chain. `npm audit --omit=dev` reports zero vulnerabilities. Keep lint inputs local and trusted, and recheck this dependency chain in AI-002. Do not force a framework downgrade to silence the audit.
