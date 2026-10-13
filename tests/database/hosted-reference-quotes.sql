-- AI-006 hosted verification. Run as one administrator query after migration.
-- Synthetic users and quotes are transaction-scoped and fully rolled back.
begin;
do $reference_quote_verification$
declare
  owner_id uuid := gen_random_uuid();
  portfolio_count_before bigint := (select count(*) from public.portfolios);
  ledger_count_before bigint := (select count(*) from public.portfolio_ledger);
  quote_count_before bigint := (select count(*) from public.market_reference_quotes);
  result record;
  payload jsonb;
begin
  insert into auth.users (id, aud, role, is_anonymous)
    values (owner_id, 'authenticated', 'authenticated', false);
  payload := jsonb_build_array(jsonb_build_object(
    'product_id', 'BTC-EUR', 'price', '74244.812345678901234567',
    'price_kind', 'last_trade', 'bid', '74240.41', 'ask', '74247.84',
    'source', 'Coinbase Advanced Trade public API',
    'exchange_at', statement_timestamp() - interval '6 seconds',
    'fetched_at', statement_timestamp() - interval '5 seconds'
  ));

  perform set_config('request.jwt.claims', json_build_object(
    'role', 'service_role', 'is_anonymous', false)::text, true);
  execute 'set local role service_role';
  select * into strict result from public.store_market_reference_quotes(payload);
  if result.inserted_count <> 1 or result.skipped_count <> 0 then
    raise exception 'FAIL: first reference quote insert report incorrect';
  end if;
  select * into strict result from public.store_market_reference_quotes(payload);
  if result.inserted_count <> 0 or result.skipped_count <> 1 then
    raise exception 'FAIL: repeated reference quote was not idempotent';
  end if;
  begin
    update public.market_reference_quotes set price = price;
    raise exception 'FAIL: service role updated immutable reference quote';
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', owner_id::text, true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', owner_id, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  if (select count(*) from public.get_latest_market_reference_quotes()
      where product_id = 'BTC-EUR' and freshness_status = 'fresh'
        and execution_reference_kind = 'public_bid_ask') <> 1 then
    raise exception 'FAIL: authenticated reference quote read failed';
  end if;
  begin
    perform public.store_market_reference_quotes(payload);
    raise exception 'FAIL: authenticated browser called reference quote writer';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.market_reference_quotes
      (product_id, price, price_kind, execution_reference_kind, source,
       fetched_at, fresh_until, validation_status)
      values ('ETH-EUR', 1, 'reference', 'indicative_reference',
        'Coinbase Advanced Trade public API', statement_timestamp(),
        statement_timestamp() + interval '120 seconds', 'validated');
    raise exception 'FAIL: authenticated browser inserted reference quote';
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role anon';
  begin
    perform public.get_latest_market_reference_quotes();
    raise exception 'FAIL: anonymous reference quote read allowed';
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
  if (select count(*) from public.portfolios) <> portfolio_count_before
     or (select count(*) from public.portfolio_ledger) <> ledger_count_before then
    raise exception 'FAIL: reference quote verification changed financial records';
  end if;
  if (select count(*) from public.market_reference_quotes) <> quote_count_before + 1 then
    raise exception 'FAIL: reference quote verification count incorrect';
  end if;
end;
$reference_quote_verification$;
rollback;
select 'AI-006 hosted reference quote verification passed; all fixtures rolled back' as result;
