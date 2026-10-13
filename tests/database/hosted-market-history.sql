-- AI-004 hosted verification after reviewed migration application.
-- Execute this entire file in one administrator query. All synthetic Auth,
-- candle and audit rows are rolled back; existing financial history is read only.
begin;
do $history_verification$
declare
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  portfolio_count_before bigint := (select count(*) from public.portfolios);
  ledger_count_before bigint := (select count(*) from public.portfolio_ledger);
  result record;
  candle jsonb := jsonb_build_array(jsonb_build_object(
    'product_id', 'BTC-EUR',
    'granularity', 'ONE_DAY',
    'candle_start', '2000-01-01T00:00:00Z',
    'open_price', '100.000000000000000001',
    'high_price', '110',
    'low_price', '90',
    'close_price', '105.123456789012345678',
    'volume', '12.5',
    'source', 'Coinbase Advanced Trade public API',
    'fetched_at', '2000-01-03T00:00:00Z'
  ));
begin
  insert into auth.users (id, aud, role, is_anonymous)
    values (owner_a, 'authenticated', 'authenticated', false),
           (owner_b, 'authenticated', 'authenticated', false);

  execute 'set local role service_role';
  select * into strict result from public.upsert_market_candles(candle);
  if result.imported_count <> 1 or result.updated_count <> 0 or result.skipped_count <> 0 then
    raise exception 'FAIL: first candle import report incorrect';
  end if;
  select * into strict result from public.upsert_market_candles(candle);
  if result.imported_count <> 0 or result.updated_count <> 0 or result.skipped_count <> 1 then
    raise exception 'FAIL: repeated candle import was not idempotent';
  end if;
  insert into public.market_data_import_runs
    (owner_id, status, completed_at, imported_count, results)
    values (owner_a, 'COMPLETED', now(), 1, '{}'::jsonb),
           (owner_b, 'COMPLETED', now(), 1, '{}'::jsonb);

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', owner_a::text, true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', owner_a, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  if (select count(*) from public.get_market_candles('BTC-EUR', 730)
      where candle_start = '2000-01-01T00:00:00Z') <> 1 then
    raise exception 'FAIL: authenticated validated history read failed';
  end if;
  if (select count(*) from public.market_data_import_runs) <> 1
     or exists (select 1 from public.market_data_import_runs where owner_id <> owner_a) then
    raise exception 'FAIL: import audit owner isolation failed';
  end if;
  begin
    insert into public.market_candles
      (product_id, granularity, candle_start, open_price, high_price, low_price,
       close_price, volume, source, fetched_at)
      values ('ETH-EUR', 'ONE_DAY', '2000-01-01', 100, 110, 90, 105, 1,
        'Coinbase Advanced Trade public API', '2000-01-03');
    raise exception 'FAIL: authenticated browser inserted a candle';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.upsert_market_candles(candle);
    raise exception 'FAIL: authenticated browser called privileged upsert';
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role anon';
  begin
    perform public.get_market_candles('BTC-EUR', 10);
    raise exception 'FAIL: anonymous history read allowed';
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
  if (select count(*) from public.portfolios) <> portfolio_count_before
     or (select count(*) from public.portfolio_ledger) <> ledger_count_before then
    raise exception 'FAIL: market verification changed financial records';
  end if;
end;
$history_verification$;
rollback;
select 'AI-004 hosted market history verification passed; all fixtures rolled back' as result;
