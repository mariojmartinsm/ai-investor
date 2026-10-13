-- AI-022 / FR-023: immutable validated public quote references for future
-- simulated execution and AI-023/AI-024 portfolio marking. Public Coinbase
-- observations are never represented as guaranteed executable prices.

create table public.market_reference_quotes (
  id uuid primary key default gen_random_uuid(),
  product_id text not null,
  price numeric(38,18) not null,
  price_kind text not null,
  bid numeric(38,18),
  ask numeric(38,18),
  execution_reference_kind text not null,
  source text not null,
  exchange_at timestamptz,
  fetched_at timestamptz not null,
  fresh_until timestamptz not null,
  validation_status text not null,
  created_at timestamptz not null default now(),

  constraint market_reference_quotes_identity_unique
    unique (product_id, source, fetched_at),
  constraint market_reference_quotes_supported_product
    check (product_id in ('BTC-EUR', 'ETH-EUR')),
  constraint market_reference_quotes_positive_values
    check (price > 0 and (bid is null or bid > 0) and (ask is null or ask > 0)),
  constraint market_reference_quotes_spread
    check (bid is null or ask is null or bid <= ask),
  constraint market_reference_quotes_price_kind
    check (price_kind in ('last_trade', 'reference')),
  constraint market_reference_quotes_reference_timestamp
    check (price_kind <> 'reference' or exchange_at is null),
  constraint market_reference_quotes_execution_kind
    check ((execution_reference_kind = 'public_bid_ask' and bid is not null and ask is not null)
      or (execution_reference_kind = 'indicative_reference' and (bid is null or ask is null))),
  constraint market_reference_quotes_source
    check (source = 'Coinbase Advanced Trade public API'),
  constraint market_reference_quotes_validation
    check (validation_status = 'validated'),
  constraint market_reference_quotes_exchange_clock
    check (exchange_at is null or exchange_at <= fetched_at + interval '5 seconds'),
  constraint market_reference_quotes_freshness_window
    check (fresh_until = least(
      fetched_at + interval '120 seconds',
      coalesce(exchange_at + interval '120 seconds', 'infinity'::timestamptz)
    ))
);

comment on table public.market_reference_quotes is
  'Immutable validated Coinbase public observations. Bid/ask are informational observations, never guaranteed fills.';
comment on column public.market_reference_quotes.execution_reference_kind is
  'public_bid_ask means both public sides were observed; indicative_reference means a complete spread was unavailable and no side was fabricated.';

create index market_reference_quotes_product_latest_idx
  on public.market_reference_quotes (product_id, fetched_at desc, id desc);

alter table public.market_reference_quotes enable row level security;

create policy market_reference_quotes_authenticated_read
  on public.market_reference_quotes
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false)
  );

revoke all on table public.market_reference_quotes
  from public, anon, authenticated, service_role;
grant select on table public.market_reference_quotes to authenticated;
grant select, insert on table public.market_reference_quotes to service_role;

create function public.store_market_reference_quotes(p_quotes jsonb)
returns table (inserted_count integer, skipped_count integer)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_supplied integer;
  v_inserted integer;
begin
  if coalesce((auth.jwt() ->> 'role'), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'SERVER_ROLE_REQUIRED';
  end if;
  if p_quotes is null or jsonb_typeof(p_quotes) <> 'array'
     or jsonb_array_length(p_quotes) < 1
     or jsonb_array_length(p_quotes) > 2 then
    raise exception using errcode = '22023', message = 'INVALID_REFERENCE_QUOTE_BATCH';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(21023);

  create temporary table if not exists pg_temp.reference_quote_input (
    product_id text,
    price numeric(38,18),
    price_kind text,
    bid numeric(38,18),
    ask numeric(38,18),
    source text,
    exchange_at timestamptz,
    fetched_at timestamptz
  ) on commit drop;
  truncate pg_temp.reference_quote_input;

  insert into pg_temp.reference_quote_input
  select * from jsonb_to_recordset(p_quotes) as supplied(
    product_id text,
    price numeric(38,18),
    price_kind text,
    bid numeric(38,18),
    ask numeric(38,18),
    source text,
    exchange_at timestamptz,
    fetched_at timestamptz
  );

  select count(*) into v_supplied from pg_temp.reference_quote_input;
  if v_supplied <> jsonb_array_length(p_quotes)
     or (select count(distinct product_id) from pg_temp.reference_quote_input) <> v_supplied then
    raise exception using errcode = '22023', message = 'INVALID_REFERENCE_QUOTE_BATCH';
  end if;
  if exists (
    select 1 from pg_temp.reference_quote_input
    where fetched_at <= statement_timestamp() - interval '120 seconds'
       or fetched_at > statement_timestamp() + interval '5 seconds'
       or (exchange_at is not null and (
         exchange_at <= statement_timestamp() - interval '120 seconds'
         or exchange_at > statement_timestamp() + interval '5 seconds'
       ))
  ) then
    raise exception using errcode = '22023', message = 'STALE_OR_FUTURE_REFERENCE_QUOTE';
  end if;
  if exists (
    select 1
    from pg_temp.reference_quote_input as supplied
    join public.market_reference_quotes as existing
      on existing.product_id = supplied.product_id
      and existing.source = supplied.source
      and existing.fetched_at = supplied.fetched_at
    where (existing.price, existing.price_kind, existing.bid, existing.ask, existing.exchange_at)
      is distinct from
      (supplied.price, supplied.price_kind, supplied.bid, supplied.ask, supplied.exchange_at)
  ) then
    raise exception using errcode = '23505', message = 'REFERENCE_QUOTE_IDEMPOTENCY_CONFLICT';
  end if;

  insert into public.market_reference_quotes
    (product_id, price, price_kind, bid, ask, execution_reference_kind,
     source, exchange_at, fetched_at, fresh_until, validation_status)
  select product_id, price, price_kind, bid, ask,
    case when bid is not null and ask is not null
      then 'public_bid_ask' else 'indicative_reference' end,
    source, exchange_at, fetched_at,
    least(fetched_at + interval '120 seconds',
      coalesce(exchange_at + interval '120 seconds', 'infinity'::timestamptz)),
    'validated'
  from pg_temp.reference_quote_input
  on conflict (product_id, source, fetched_at) do nothing;

  get diagnostics v_inserted = row_count;
  return query select v_inserted, v_supplied - v_inserted;
end;
$$;

revoke all on function public.store_market_reference_quotes(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.store_market_reference_quotes(jsonb)
  to service_role;

create function public.get_latest_market_reference_quotes()
returns table (
  id uuid,
  product_id text,
  price text,
  price_kind text,
  bid text,
  ask text,
  execution_reference_kind text,
  source text,
  exchange_at timestamptz,
  fetched_at timestamptz,
  fresh_until timestamptz,
  validation_status text,
  freshness_status text
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

  return query
    select distinct on (quote.product_id)
      quote.id, quote.product_id, quote.price::text, quote.price_kind,
      quote.bid::text, quote.ask::text, quote.execution_reference_kind,
      quote.source, quote.exchange_at, quote.fetched_at, quote.fresh_until,
      quote.validation_status,
      case when quote.validation_status = 'validated'
             and quote.fresh_until > statement_timestamp()
           then 'fresh' else 'stale' end
    from public.market_reference_quotes as quote
    order by quote.product_id, quote.fetched_at desc, quote.id desc;
end;
$$;

revoke all on function public.get_latest_market_reference_quotes()
  from public, anon, authenticated, service_role;
grant execute on function public.get_latest_market_reference_quotes()
  to authenticated;
