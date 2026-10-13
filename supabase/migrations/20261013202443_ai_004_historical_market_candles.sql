-- AI-021 / FR-021, FR-022, FR-025, FR-053: validated public daily candles.
-- Market history is global read-only source data. Authenticated application
-- users may read it; only the server-held secret role may insert or update it.
-- Existing portfolio, ledger and Auth objects are intentionally untouched.

create table public.market_candles (
  product_id text not null,
  granularity text not null,
  candle_start timestamptz not null,
  open_price numeric(38,18) not null,
  high_price numeric(38,18) not null,
  low_price numeric(38,18) not null,
  close_price numeric(38,18) not null,
  volume numeric(38,18) not null,
  source text not null,
  fetched_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint market_candles_identity_unique
    primary key (product_id, granularity, candle_start),
  constraint market_candles_supported_product
    check (product_id in ('BTC-EUR', 'ETH-EUR')),
  constraint market_candles_daily_only
    check (granularity = 'ONE_DAY'),
  constraint market_candles_utc_day_aligned
    check (candle_start = date_trunc('day', candle_start at time zone 'UTC') at time zone 'UTC'),
  constraint market_candles_positive_prices
    check (open_price > 0 and high_price > 0 and low_price > 0 and close_price > 0),
  constraint market_candles_valid_ohlc
    check (low_price <= open_price and low_price <= close_price
      and high_price >= open_price and high_price >= close_price
      and low_price <= high_price),
  constraint market_candles_nonnegative_volume
    check (volume >= 0),
  constraint market_candles_coinbase_source
    check (source = 'Coinbase Advanced Trade public API'),
  constraint market_candles_closed_before_fetch
    check (fetched_at >= candle_start + interval '1 day'),
  constraint market_candles_timestamp_order
    check (updated_at >= created_at)
);

comment on table public.market_candles is
  'Validated, fully closed UTC daily Coinbase candles. Values remain numeric and are returned to the application as decimal strings.';

create index market_candles_product_recent_idx
  on public.market_candles (product_id, candle_start desc)
  where granularity = 'ONE_DAY';

create table public.market_data_import_runs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete restrict,
  status text not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  imported_count integer not null default 0,
  updated_count integer not null default 0,
  skipped_count integer not null default 0,
  rejected_count integer not null default 0,
  results jsonb not null default '{}'::jsonb,
  error_code text,

  constraint market_data_import_runs_status
    check (status in ('RUNNING', 'COMPLETED', 'FAILED')),
  constraint market_data_import_runs_counts
    check (imported_count >= 0 and updated_count >= 0
      and skipped_count >= 0 and rejected_count >= 0),
  constraint market_data_import_runs_completion
    check ((status = 'RUNNING' and completed_at is null)
      or (status in ('COMPLETED', 'FAILED') and completed_at is not null)),
  constraint market_data_import_runs_error
    check ((status = 'FAILED' and error_code is not null)
      or (status <> 'FAILED' and error_code is null))
);

create index market_data_import_runs_owner_started_idx
  on public.market_data_import_runs (owner_id, started_at desc);

alter table public.market_candles enable row level security;
alter table public.market_data_import_runs enable row level security;

create policy market_candles_authenticated_read
  on public.market_candles
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  );

create policy market_data_import_runs_owner_read
  on public.market_data_import_runs
  for select
  to authenticated
  using (
    (select auth.uid()) = owner_id
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  );

-- Explicit grants are required because this project does not auto-expose new
-- public tables. Browser roles receive SELECT only; no client write policy or
-- write grant exists. The server secret remains outside NEXT_PUBLIC variables.
revoke all on table public.market_candles, public.market_data_import_runs
  from public, anon, authenticated, service_role;
grant select on table public.market_candles, public.market_data_import_runs
  to authenticated;
grant select, insert, update on table public.market_candles,
  public.market_data_import_runs to service_role;

create function public.get_market_candles(
  p_product_id text,
  p_limit integer default 730
)
returns table (
  product_id text,
  granularity text,
  candle_start timestamptz,
  open_price text,
  high_price text,
  low_price text,
  close_price text,
  volume text,
  source text,
  fetched_at timestamptz
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'AUTHENTICATION_REQUIRED';
  end if;
  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = '42501', message = 'OWNER_ACCESS_DENIED';
  end if;
  if p_product_id not in ('BTC-EUR', 'ETH-EUR')
     or p_limit is null or p_limit < 1 or p_limit > 730 then
    raise exception using errcode = '22023', message = 'INVALID_MARKET_HISTORY_REQUEST';
  end if;

  return query
    select candle.product_id, candle.granularity, candle.candle_start,
      candle.open_price::text, candle.high_price::text,
      candle.low_price::text, candle.close_price::text,
      candle.volume::text, candle.source, candle.fetched_at
    from public.market_candles as candle
    where candle.product_id = p_product_id
      and candle.granularity = 'ONE_DAY'
    order by candle.candle_start desc
    limit p_limit;
end;
$$;

revoke all on function public.get_market_candles(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_market_candles(text, integer)
  to authenticated;

-- The server authenticates the owner before using its secret client. This
-- invoker function is executable only by service_role and relies on that role's
-- narrow INSERT/UPDATE grants; authenticated browser clients cannot call it.
create function public.upsert_market_candles(p_candles jsonb)
returns table (imported_count integer, updated_count integer, skipped_count integer)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_candles is null or jsonb_typeof(p_candles) <> 'array'
     or jsonb_array_length(p_candles) < 1
     or jsonb_array_length(p_candles) > 730 then
    raise exception using errcode = '22023', message = 'INVALID_CANDLE_BATCH';
  end if;

  -- Serialize classifications so concurrent backfills report imported/updated/
  -- skipped counts against the row state they actually write.
  perform pg_catalog.pg_advisory_xact_lock(21021);

  return query
  with supplied as (
    select * from jsonb_to_recordset(p_candles) as row_data(
      product_id text,
      granularity text,
      candle_start timestamptz,
      open_price numeric(38,18),
      high_price numeric(38,18),
      low_price numeric(38,18),
      close_price numeric(38,18),
      volume numeric(38,18),
      source text,
      fetched_at timestamptz
    )
  ), classified as (
    select supplied.*,
      existing.product_id is null as is_new,
      existing.product_id is not null and
        (existing.open_price, existing.high_price, existing.low_price,
         existing.close_price, existing.volume, existing.source)
        is not distinct from
        (supplied.open_price, supplied.high_price, supplied.low_price,
         supplied.close_price, supplied.volume, supplied.source) as is_same
    from supplied
    left join public.market_candles as existing
      on existing.product_id = supplied.product_id
      and existing.granularity = supplied.granularity
      and existing.candle_start = supplied.candle_start
  ), written as (
    insert into public.market_candles as target
      (product_id, granularity, candle_start, open_price, high_price,
       low_price, close_price, volume, source, fetched_at)
    select product_id, granularity, candle_start, open_price, high_price,
      low_price, close_price, volume, source, fetched_at
    from classified
    where not is_same
    on conflict (product_id, granularity, candle_start) do update set
      open_price = excluded.open_price,
      high_price = excluded.high_price,
      low_price = excluded.low_price,
      close_price = excluded.close_price,
      volume = excluded.volume,
      source = excluded.source,
      fetched_at = excluded.fetched_at,
      updated_at = now()
    where (target.open_price, target.high_price, target.low_price,
           target.close_price, target.volume, target.source)
      is distinct from
      (excluded.open_price, excluded.high_price, excluded.low_price,
       excluded.close_price, excluded.volume, excluded.source)
    returning 1
  )
  select count(*) filter (where is_new)::integer,
    count(*) filter (where not is_new and not is_same)::integer,
    count(*) filter (where is_same)::integer
  from classified
  cross join lateral (select count(*) from written) as ensure_write;
end;
$$;

revoke all on function public.upsert_market_candles(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.upsert_market_candles(jsonb)
  to service_role;
