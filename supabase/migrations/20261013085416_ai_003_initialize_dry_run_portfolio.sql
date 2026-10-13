-- AI-003 / FR-010, FR-013: exactly-once virtual EUR funding and ledger reads.
-- Existing portfolios and ledger history are preserved; there is no seed.
-- Preflight: any existing INITIAL_CAPITAL entries must be exactly 500 EUR,
-- with at most one per portfolio. Inconsistent historical data fails migration
-- rather than being rewritten. No automatic backfill is required.
-- Rollback: remove the RPCs/guards only in a reviewed forward migration. Never
-- delete initial capital or ledger history to undo an initialized portfolio.

create schema if not exists private;
revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;

alter table public.portfolio_ledger
  add constraint portfolio_ledger_initial_capital_eur_500 check (
    transaction_type <> 'INITIAL_CAPITAL' or (currency = 'EUR' and amount = 500)
  );

create unique index portfolio_ledger_initial_capital_once_idx
  on public.portfolio_ledger (portfolio_id)
  where transaction_type = 'INITIAL_CAPITAL';

-- Invoker trigger: no privileged code or client-controlled ownership lookup.
-- Even trusted append writers cannot rewrite or truncate historical postings.
create function private.reject_ledger_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'LEDGER_APPEND_ONLY';
end;
$$;

revoke all on function private.reject_ledger_mutation()
  from public, anon, authenticated, service_role;

create trigger portfolio_ledger_append_only
  before update or delete or truncate on public.portfolio_ledger
  for each statement execute function private.reject_ledger_mutation();

-- Authenticated callers can invoke only these narrowly scoped operations.
-- The privileged function is in a non-exposed schema, has an empty search_path,
-- validates the trusted auth.uid(), and never accepts capital, currency or mode.
create function private.initialize_dry_run_portfolio(p_owner_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_portfolio_id uuid;
  v_funding_count integer;
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;
  if p_owner_id is null or p_owner_id is distinct from v_user_id then
    raise exception using errcode = '42501', message = 'OWNER_ACCESS_DENIED';
  end if;

  -- One existing owner row serializes simultaneous first-time initialization.
  -- This also verifies the Auth user still exists and is not an anonymous user.
  perform auth_user.id from auth.users as auth_user
    where auth_user.id = v_user_id
      and not coalesce(auth_user.is_anonymous, false)
    for update;
  if not found then
    raise exception using errcode = '42501', message = 'OWNER_ACCESS_DENIED';
  end if;

  insert into public.portfolios
    (owner_id, mode, starting_currency, starting_capital)
    values (v_user_id, 'DRY_RUN', 'EUR', 500)
    on conflict (owner_id, mode) do nothing;

  select portfolio.id into strict v_portfolio_id
    from public.portfolios as portfolio
    where portfolio.owner_id = v_user_id and portfolio.mode = 'DRY_RUN'
    for update;

  select count(*)::integer into v_funding_count
    from public.portfolio_ledger as entry
    where entry.portfolio_id = v_portfolio_id
      and entry.transaction_type = 'INITIAL_CAPITAL';

  if v_funding_count = 0 then
    -- An unfunded empty portfolio can be safely completed. Other financial
    -- history without funding is inconsistent and must never be topped up.
    if exists (select 1 from public.portfolio_ledger as entry
               where entry.portfolio_id = v_portfolio_id) then
      raise exception using errcode = '23514',
        message = 'PORTFOLIO_INITIALIZATION_INTEGRITY';
    end if;

    insert into public.portfolio_ledger
      (portfolio_id, transaction_type, currency, amount,
       reference_type, reference_id, idempotency_key)
      values
        (v_portfolio_id, 'INITIAL_CAPITAL', 'EUR', 500,
         'PORTFOLIO_INITIALIZATION', v_portfolio_id::text, 'INITIAL_CAPITAL:EUR')
      on conflict do nothing;
  end if;

  -- Do not quietly accept an idempotency collision or incomplete initialization.
  if (select count(*) from public.portfolio_ledger as entry
      where entry.portfolio_id = v_portfolio_id
        and entry.transaction_type = 'INITIAL_CAPITAL'
        and entry.currency = 'EUR' and entry.amount = 500) <> 1 then
    raise exception using errcode = '23514',
      message = 'PORTFOLIO_INITIALIZATION_INTEGRITY';
  end if;

  return v_portfolio_id;
end;
$$;

revoke all on function private.initialize_dry_run_portfolio(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.initialize_dry_run_portfolio(uuid) to authenticated;

create function public.get_dry_run_portfolio(p_owner_id uuid)
returns table (
  id uuid,
  owner_id uuid,
  mode text,
  starting_capital text,
  created_at timestamptz,
  eur_balance text,
  btc_balance text,
  eth_balance text,
  initial_funding_count integer,
  ledger_entry_count integer
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = '42501', message = 'OWNER_ACCESS_DENIED';
  end if;
  if p_owner_id is null or p_owner_id is distinct from v_user_id then
    raise exception using errcode = '42501', message = 'OWNER_ACCESS_DENIED';
  end if;

  -- One statement/snapshot, RLS enforced as the calling owner, all sums numeric.
  -- Monetary/quantity values cross the JSON boundary as decimal strings.
  return query
    select portfolio.id, portfolio.owner_id, portfolio.mode,
      portfolio.starting_capital::text, portfolio.created_at,
      coalesce(sum(entry.amount) filter (where entry.currency = 'EUR'),
        0::numeric(28,12))::text,
      coalesce(sum(entry.amount) filter (where entry.currency = 'BTC'),
        0::numeric(28,12))::text,
      coalesce(sum(entry.amount) filter (where entry.currency = 'ETH'),
        0::numeric(28,12))::text,
      count(entry.id) filter (where entry.transaction_type = 'INITIAL_CAPITAL')::integer,
      count(entry.id)::integer
    from public.portfolios as portfolio
    left join public.portfolio_ledger as entry on entry.portfolio_id = portfolio.id
    where portfolio.owner_id = v_user_id and portfolio.mode = 'DRY_RUN'
    group by portfolio.id;
end;
$$;

revoke all on function public.get_dry_run_portfolio(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_dry_run_portfolio(uuid) to authenticated;

create function public.initialize_dry_run_portfolio(p_owner_id uuid)
returns table (
  id uuid,
  owner_id uuid,
  mode text,
  starting_capital text,
  created_at timestamptz,
  eur_balance text,
  btc_balance text,
  eth_balance text,
  initial_funding_count integer,
  ledger_entry_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  -- The exposed wrapper authorizes independently of the privileged function.
  if v_user_id is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = '42501', message = 'OWNER_ACCESS_DENIED';
  end if;
  if p_owner_id is null or p_owner_id is distinct from v_user_id then
    raise exception using errcode = '42501', message = 'OWNER_ACCESS_DENIED';
  end if;

  perform private.initialize_dry_run_portfolio(p_owner_id);
  return query select * from public.get_dry_run_portfolio(p_owner_id);
end;
$$;

revoke all on function public.initialize_dry_run_portfolio(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.initialize_dry_run_portfolio(uuid) to authenticated;
