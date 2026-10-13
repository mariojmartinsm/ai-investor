-- AI-007 hosted verification. All synthetic owner, portfolio and preview rows
-- are transaction-scoped and rolled back. Existing financial data is counted
-- before and after the checks.
begin;
do $strategy_analysis_verification$
declare
  fixture_owner_id uuid := gen_random_uuid();
  fixture_portfolio_id uuid;
  portfolio_count_before bigint := (select count(*) from public.portfolios);
  ledger_count_before bigint := (select count(*) from public.portfolio_ledger);
  analysis_count_before bigint := (select count(*) from public.strategy_analysis_runs);
  result record;
  payload jsonb;
begin
  insert into auth.users (id, aud, role, is_anonymous)
    values (fixture_owner_id, 'authenticated', 'authenticated', false);
  insert into public.portfolios (owner_id) values (fixture_owner_id) returning id into fixture_portfolio_id;
  payload := jsonb_build_array(jsonb_build_object(
    'product_id', 'BTC-EUR', 'strategy_id', 'BASELINE_V1',
    'calculation_version', 'TECHNICAL_V1', 'analysis_mode', 'PREVIEW_ONLY',
    'analysis_date', '2026-10-13', 'cutoff', '2026-10-13T00:00:00Z',
    'latest_candle_start', '2026-10-12T00:00:00Z', 'signal', 'HOLD',
    'indicators', jsonb_build_object(
      'version', 'TECHNICAL_V1', 'cutoff', '2026-10-13T00:00:00.000Z',
      'latestCandleStart', '2026-10-12T00:00:00.000Z', 'latestClose', '65000.000000000000',
      'sma20', '64000.000000000000', 'sma50', '63000.000000000000',
      'rsi14', '70.00000000', 'momentum7', '1.00000000', 'momentum30', '2.00000000',
      'volatility30Annualized', '30.00000000', 'inputCount', 90,
      'inputStart', '2026-07-15T00:00:00.000Z', 'inputEnd', '2026-10-12T00:00:00.000Z'),
    'proposed_notional', null, 'proposed_quantity', null,
    'explanation', 'No BUY or SELL conditions',
    'reason_codes', jsonb_build_array('NO_BUY_CONDITIONS', 'NO_SELL_CONDITIONS'),
    'data_quality', 'VALID', 'freshness', 'CURRENT', 'input_count', 90,
    'input_start', '2026-07-15T00:00:00Z', 'input_end', '2026-10-12T00:00:00Z',
    'source', 'Coinbase Advanced Trade public API', 'ai_status', 'NOT_REQUESTED',
    'risk_status', 'NOT_EVALUATED', 'outcome', 'ANALYSIS_ONLY',
    'idempotency_key', 'PREVIEW_ONLY:BASELINE_V1:BTC-EUR:2026-10-13T00:00:00.000Z'
  ));

  perform set_config('request.jwt.claims', json_build_object('role', 'service_role', 'is_anonymous', false)::text, true);
  execute 'set local role service_role';
  select * into strict result from public.store_strategy_analysis_previews(fixture_owner_id, payload);
  if result.inserted_count <> 1 or result.skipped_count <> 0 then raise exception 'FAIL: first preview insert'; end if;
  select * into strict result from public.store_strategy_analysis_previews(fixture_owner_id, payload);
  if result.inserted_count <> 0 or result.skipped_count <> 1 then raise exception 'FAIL: preview idempotency'; end if;
  begin
    insert into public.strategy_analysis_runs (owner_id) values (fixture_owner_id);
    raise exception 'FAIL: service role directly inserted preview';
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', fixture_owner_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', fixture_owner_id, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  if (select count(*) from public.get_latest_strategy_analysis_previews(fixture_owner_id)
      where signal = 'HOLD' and outcome = 'ANALYSIS_ONLY') <> 1 then
    raise exception 'FAIL: owner preview read';
  end if;
  begin
    delete from public.strategy_analysis_runs where strategy_analysis_runs.owner_id = fixture_owner_id;
    raise exception 'FAIL: browser deleted preview';
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
  if (select count(*) from public.strategy_analysis_runs) <> analysis_count_before + 1 then raise exception 'FAIL: preview count'; end if;
  if (select count(*) from public.portfolios) <> portfolio_count_before + 1
     or (select count(*) from public.portfolio_ledger) <> ledger_count_before then
    raise exception 'FAIL: preview changed financial records';
  end if;
end;
$strategy_analysis_verification$;
rollback;
select 'AI-007 hosted strategy analysis verification passed; all fixtures rolled back' as result;
