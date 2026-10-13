-- AI-030 / AI-031 / FR-031, FR-032, FR-033, FR-036, FR-037:
-- owner-scoped, append-only deterministic strategy previews. These records are
-- analysis only and cannot create orders, fills or financial ledger entries.

create table public.strategy_analysis_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete restrict,
  portfolio_id uuid not null references public.portfolios (id) on delete restrict,
  product_id text not null,
  strategy_id text not null,
  calculation_version text not null,
  analysis_mode text not null,
  analysis_date date not null,
  cutoff timestamptz not null,
  latest_candle_start timestamptz,
  signal text not null,
  indicators jsonb,
  proposed_notional numeric(38,18),
  proposed_quantity numeric(38,18),
  explanation text not null,
  reason_codes text[] not null,
  data_quality text not null,
  freshness text not null,
  input_count integer not null,
  input_start timestamptz,
  input_end timestamptz,
  source text not null,
  ai_status text not null,
  risk_status text not null,
  outcome text not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),

  constraint strategy_analysis_runs_owner_idempotency_unique
    unique (owner_id, idempotency_key),
  constraint strategy_analysis_runs_supported_product
    check (product_id in ('BTC-EUR', 'ETH-EUR')),
  constraint strategy_analysis_runs_versions
    check (strategy_id = 'BASELINE_V1' and calculation_version = 'TECHNICAL_V1'),
  constraint strategy_analysis_runs_preview_only
    check (analysis_mode = 'PREVIEW_ONLY' and outcome = 'ANALYSIS_ONLY'
      and ai_status = 'NOT_REQUESTED' and risk_status = 'NOT_EVALUATED'),
  constraint strategy_analysis_runs_signal
    check (signal in ('BUY', 'SELL', 'HOLD')),
  constraint strategy_analysis_runs_quality
    check (data_quality in ('VALID', 'INSUFFICIENT_HISTORY', 'MARKET_DATA_GAP', 'INVALID_CANDLES', 'STALE_MARKET_DATA')),
  constraint strategy_analysis_runs_freshness
    check (freshness in ('CURRENT', 'STALE', 'UNAVAILABLE')),
  constraint strategy_analysis_runs_source
    check (source = 'Coinbase Advanced Trade public API'),
  constraint strategy_analysis_runs_cutoff
    check (cutoff = date_trunc('day', cutoff at time zone 'UTC') at time zone 'UTC'
      and analysis_date = (cutoff at time zone 'UTC')::date),
  constraint strategy_analysis_runs_candle_alignment
    check (latest_candle_start is null or (
      latest_candle_start = date_trunc('day', latest_candle_start at time zone 'UTC') at time zone 'UTC'
      and latest_candle_start + interval '1 day' <= cutoff
    )),
  constraint strategy_analysis_runs_input_bounds
    check (input_count between 0 and 90),
  constraint strategy_analysis_runs_input_range
    check ((input_count = 0 and input_start is null and input_end is null)
      or (input_count > 0 and input_start is not null and input_end is not null
        and input_start <= input_end and input_end = latest_candle_start)),
  constraint strategy_analysis_runs_indicators
    check ((data_quality = 'VALID' and freshness = 'CURRENT'
        and indicators is not null and jsonb_typeof(indicators) = 'object'
        and input_count between 60 and 90 and latest_candle_start is not null)
      or (data_quality <> 'VALID' and signal = 'HOLD' and indicators is null)),
  constraint strategy_analysis_runs_proposal
    check ((signal = 'BUY' and proposed_notional > 0 and proposed_notional <= 25 and proposed_quantity is null)
      or (signal = 'SELL' and proposed_quantity > 0 and proposed_notional is null)
      or (signal = 'HOLD' and proposed_notional is null and proposed_quantity is null)),
  constraint strategy_analysis_runs_audit_text
    check (cardinality(reason_codes) > 0 and length(explanation) between 1 and 1000
      and length(idempotency_key) between 1 and 200)
);

comment on table public.strategy_analysis_runs is
  'Immutable owner strategy previews. BUY/SELL are unapproved candidates; every outcome is ANALYSIS_ONLY and creates no financial movement.';
comment on column public.strategy_analysis_runs.indicators is
  'Decimal strings plus cutoff/version metadata produced by the pure TECHNICAL_V1 calculator.';

create index strategy_analysis_runs_owner_latest_idx
  on public.strategy_analysis_runs (owner_id, cutoff desc, created_at desc);

alter table public.strategy_analysis_runs enable row level security;

create policy strategy_analysis_runs_owner_read
  on public.strategy_analysis_runs
  for select
  to authenticated
  using (
    (select auth.uid()) = owner_id
    and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false)
  );

revoke all on table public.strategy_analysis_runs
  from public, anon, authenticated, service_role;
grant select on table public.strategy_analysis_runs to authenticated;

create function public.store_strategy_analysis_previews(
  p_owner_id uuid,
  p_records jsonb
)
returns table (inserted_count integer, skipped_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_portfolio_id uuid;
  v_supplied integer;
  v_inserted integer;
begin
  if coalesce((auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVER_ROLE_REQUIRED';
  end if;
  if p_owner_id is null or not exists (
    select 1 from auth.users as owner
    where owner.id = p_owner_id and not coalesce(owner.is_anonymous, false)
  ) then
    raise exception using errcode = '42501', message = 'OWNER_ACCESS_DENIED';
  end if;
  select portfolio.id into strict v_portfolio_id
  from public.portfolios as portfolio
  where portfolio.owner_id = p_owner_id and portfolio.mode = 'DRY_RUN';
  if p_records is null or jsonb_typeof(p_records) <> 'array'
     or jsonb_array_length(p_records) < 1 or jsonb_array_length(p_records) > 2 then
    raise exception using errcode = '22023', message = 'INVALID_STRATEGY_PREVIEW_BATCH';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(hashtextextended(p_owner_id::text, 21031));

  create temporary table if not exists pg_temp.strategy_preview_input (
    product_id text,
    strategy_id text,
    calculation_version text,
    analysis_mode text,
    analysis_date date,
    cutoff timestamptz,
    latest_candle_start timestamptz,
    signal text,
    indicators jsonb,
    proposed_notional numeric(38,18),
    proposed_quantity numeric(38,18),
    explanation text,
    reason_codes text[],
    data_quality text,
    freshness text,
    input_count integer,
    input_start timestamptz,
    input_end timestamptz,
    source text,
    ai_status text,
    risk_status text,
    outcome text,
    idempotency_key text
  ) on commit drop;
  truncate pg_temp.strategy_preview_input;

  insert into pg_temp.strategy_preview_input
  select * from jsonb_to_recordset(p_records) as supplied(
    product_id text,
    strategy_id text,
    calculation_version text,
    analysis_mode text,
    analysis_date date,
    cutoff timestamptz,
    latest_candle_start timestamptz,
    signal text,
    indicators jsonb,
    proposed_notional numeric(38,18),
    proposed_quantity numeric(38,18),
    explanation text,
    reason_codes text[],
    data_quality text,
    freshness text,
    input_count integer,
    input_start timestamptz,
    input_end timestamptz,
    source text,
    ai_status text,
    risk_status text,
    outcome text,
    idempotency_key text
  );

  select count(*) into v_supplied from pg_temp.strategy_preview_input;
  if v_supplied <> jsonb_array_length(p_records)
     or (select count(distinct product_id) from pg_temp.strategy_preview_input) <> v_supplied then
    raise exception using errcode = '22023', message = 'INVALID_STRATEGY_PREVIEW_BATCH';
  end if;
  if exists (
    select 1
    from pg_temp.strategy_preview_input as supplied
    join public.strategy_analysis_runs as existing
      on existing.owner_id = p_owner_id
      and existing.idempotency_key = supplied.idempotency_key
    where (existing.product_id, existing.strategy_id, existing.calculation_version,
      existing.analysis_mode, existing.analysis_date, existing.cutoff,
      existing.latest_candle_start, existing.signal, existing.indicators,
      existing.proposed_notional, existing.proposed_quantity,
      existing.explanation, existing.reason_codes, existing.data_quality,
      existing.freshness, existing.input_count, existing.input_start,
      existing.input_end, existing.source, existing.ai_status,
      existing.risk_status, existing.outcome)
    is distinct from
      (supplied.product_id, supplied.strategy_id, supplied.calculation_version,
      supplied.analysis_mode, supplied.analysis_date, supplied.cutoff,
      supplied.latest_candle_start, supplied.signal, supplied.indicators,
      supplied.proposed_notional, supplied.proposed_quantity,
      supplied.explanation, supplied.reason_codes, supplied.data_quality,
      supplied.freshness, supplied.input_count, supplied.input_start,
      supplied.input_end, supplied.source, supplied.ai_status,
      supplied.risk_status, supplied.outcome)
  ) then
    raise exception using errcode = '23505', message = 'STRATEGY_PREVIEW_IDEMPOTENCY_CONFLICT';
  end if;

  insert into public.strategy_analysis_runs
    (owner_id, portfolio_id, product_id, strategy_id, calculation_version,
     analysis_mode, analysis_date, cutoff, latest_candle_start, signal,
     indicators, proposed_notional, proposed_quantity, explanation,
     reason_codes, data_quality, freshness, input_count, input_start,
     input_end, source, ai_status, risk_status, outcome, idempotency_key)
  select p_owner_id, v_portfolio_id, product_id, strategy_id,
    calculation_version, analysis_mode, analysis_date, cutoff,
    latest_candle_start, signal, indicators, proposed_notional,
    proposed_quantity, explanation, reason_codes, data_quality, freshness,
    input_count, input_start, input_end, source, ai_status, risk_status,
    outcome, idempotency_key
  from pg_temp.strategy_preview_input
  on conflict (owner_id, idempotency_key) do nothing;

  get diagnostics v_inserted = row_count;
  return query select v_inserted, v_supplied - v_inserted;
end;
$$;

revoke all on function public.store_strategy_analysis_previews(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.store_strategy_analysis_previews(uuid, jsonb)
  to service_role;

create function public.get_latest_strategy_analysis_previews(p_owner_id uuid)
returns table (
  id uuid,
  owner_id uuid,
  portfolio_id uuid,
  product_id text,
  strategy_id text,
  calculation_version text,
  analysis_mode text,
  analysis_date text,
  cutoff timestamptz,
  latest_candle_start timestamptz,
  signal text,
  indicators jsonb,
  proposed_notional text,
  proposed_quantity text,
  explanation text,
  reason_codes text[],
  data_quality text,
  freshness text,
  input_count integer,
  input_start timestamptz,
  input_end timestamptz,
  source text,
  ai_status text,
  risk_status text,
  outcome text,
  idempotency_key text,
  created_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null or auth.uid() <> p_owner_id then
    raise exception using errcode = '42501', message = 'OWNER_ACCESS_DENIED';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = '42501', message = 'OWNER_ACCESS_DENIED';
  end if;

  return query
    select distinct on (analysis.product_id)
      analysis.id, analysis.owner_id, analysis.portfolio_id,
      analysis.product_id, analysis.strategy_id,
      analysis.calculation_version, analysis.analysis_mode,
      analysis.analysis_date::text, analysis.cutoff, analysis.latest_candle_start,
      analysis.signal, analysis.indicators,
      analysis.proposed_notional::text, analysis.proposed_quantity::text,
      analysis.explanation, analysis.reason_codes, analysis.data_quality,
      analysis.freshness, analysis.input_count, analysis.input_start,
      analysis.input_end, analysis.source, analysis.ai_status,
      analysis.risk_status, analysis.outcome,
      analysis.idempotency_key, analysis.created_at
    from public.strategy_analysis_runs as analysis
    where analysis.owner_id = p_owner_id
    order by analysis.product_id, analysis.cutoff desc, analysis.created_at desc;
end;
$$;

revoke all on function public.get_latest_strategy_analysis_previews(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_latest_strategy_analysis_previews(uuid)
  to authenticated;
