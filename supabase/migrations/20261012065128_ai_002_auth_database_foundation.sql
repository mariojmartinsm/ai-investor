-- AI-002: authentication and read-only financial data foundation.
-- No portfolio or ledger rows are initialized here; that belongs to AI-003.
-- Rollback: on an unused database, drop portfolio_ledger before portfolios.
-- On a database containing financial history, use a reviewed forward migration
-- rather than deleting tables or historical records. No backfill is required.

create table public.portfolios (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete restrict,
  mode text not null default 'DRY_RUN',
  starting_currency text not null default 'EUR',
  starting_capital numeric(28,12) not null default 500,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint portfolios_dry_run_only check (mode = 'DRY_RUN'),
  constraint portfolios_starting_currency_eur check (starting_currency = 'EUR'),
  constraint portfolios_starting_capital_500 check (starting_capital = 500),
  constraint portfolios_timestamp_order check (updated_at >= created_at),
  constraint portfolios_owner_mode_unique unique (owner_id, mode)
);

comment on column public.portfolios.starting_capital is
  'Configuration for future initialization, denominated in starting_currency. Not an initialized balance.';

create table public.portfolio_ledger (
  id uuid primary key default gen_random_uuid(),
  portfolio_id uuid not null references public.portfolios (id) on delete restrict,
  transaction_type text not null,
  currency text not null,
  amount numeric(28,12) not null,
  reference_type text not null,
  reference_id text not null,
  idempotency_key text not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint portfolio_ledger_transaction_type check (
    transaction_type in ('INITIAL_CAPITAL', 'TRADE', 'FEE', 'ADJUSTMENT')
  ),
  constraint portfolio_ledger_currency check (currency in ('EUR', 'BTC', 'ETH')),
  constraint portfolio_ledger_finite_nonzero_amount check (
    amount <> 0 and amount <> 'NaN'::numeric
  ),
  constraint portfolio_ledger_reference_type check (
    length(btrim(reference_type)) between 1 and 64
  ),
  constraint portfolio_ledger_reference_id check (
    length(btrim(reference_id)) between 1 and 200
  ),
  constraint portfolio_ledger_idempotency_key check (
    length(btrim(idempotency_key)) between 1 and 200
  ),
  constraint portfolio_ledger_posting_unique unique (portfolio_id, idempotency_key)
);

comment on column public.portfolio_ledger.amount is
  'Signed currency delta. Use decimal strings at application boundaries; never authoritative JavaScript number arithmetic.';
comment on column public.portfolio_ledger.idempotency_key is
  'Unique per posting within a portfolio; use reference_type/reference_id to group related postings.';

-- The owner/mode unique index also indexes the owner foreign key and RLS lookup.
-- This index covers portfolio ownership joins and chronological ledger reads.
create index portfolio_ledger_portfolio_occurred_idx
  on public.portfolio_ledger (portfolio_id, occurred_at desc, id);

alter table public.portfolios enable row level security;
alter table public.portfolio_ledger enable row level security;

create policy portfolios_owner_read
  on public.portfolios
  for select
  to authenticated
  using ((select auth.uid()) = owner_id);

create policy portfolio_ledger_owner_read
  on public.portfolio_ledger
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.portfolios as portfolio
      where portfolio.id = portfolio_ledger.portfolio_id
        and portfolio.owner_id = (select auth.uid())
    )
  );

-- Remove inherited Supabase defaults explicitly. There are no anonymous or
-- authenticated write policies, and browser roles have no write privileges.
revoke all on table public.portfolios, public.portfolio_ledger
  from public, anon, authenticated, service_role;
grant usage on schema public to authenticated, service_role;
grant select on table public.portfolios, public.portfolio_ledger to authenticated;

-- Foundation for future authorized server operations only. No service client is
-- configured in the web app. Ledger postings are append-only for this role.
grant select, insert, update on table public.portfolios to service_role;
grant select, insert on table public.portfolio_ledger to service_role;
