-- AI-003 hosted verification after reviewed migration application.
-- Execute this ENTIRE file as one administrator execute_sql request.
-- All random synthetic Auth users/financial fixtures roll back; no credentials.
-- Actual independent-session lock contention is tested by concurrency.mjs.
begin;
do $portfolio_verification$
declare
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  anonymous_owner uuid := gen_random_uuid();
  portfolio_a uuid;
  portfolio_b uuid;
  first_snapshot record;
  current_snapshot record;
  function_name text;
begin
  insert into auth.users (id, aud, role, is_anonymous)
    values (owner_a, 'authenticated', 'authenticated', false),
           (owner_b, 'authenticated', 'authenticated', false),
           (anonymous_owner, 'authenticated', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', owner_a::text, true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', owner_a, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';

  if exists (select 1 from public.get_dry_run_portfolio(owner_a)) then
    raise exception 'FAIL: uninitialized owner returned a portfolio';
  end if;
  select * into strict first_snapshot from public.initialize_dry_run_portfolio(owner_a);
  portfolio_a := first_snapshot.id;
  if first_snapshot.mode <> 'DRY_RUN'
     or first_snapshot.starting_capital <> '500.000000000000'
     or first_snapshot.eur_balance <> '500.000000000000'
     or first_snapshot.btc_balance <> '0.000000000000'
     or first_snapshot.eth_balance <> '0.000000000000'
     or first_snapshot.initial_funding_count <> 1
     or first_snapshot.ledger_entry_count <> 1 then
    raise exception 'FAIL: initial balance/ledger snapshot does not match EUR500';
  end if;
  for attempt in 1..5 loop
    select * into strict current_snapshot from public.initialize_dry_run_portfolio(owner_a);
    if current_snapshot is distinct from first_snapshot then
      raise exception 'FAIL: repeated initialization changed portfolio or funding';
    end if;
  end loop;

  foreach function_name in array array[
    'public.initialize_dry_run_portfolio', 'private.initialize_dry_run_portfolio',
    'public.get_dry_run_portfolio'
  ] loop
    begin
      execute format('select * from %s($1)', function_name) using owner_b;
      raise exception 'FAIL: cross-owner RPC allowed: %', function_name;
    exception when insufficient_privilege then null;
    end;
    begin
      execute format('select * from %s($1)', function_name) using null::uuid;
      raise exception 'FAIL: null-owner RPC allowed: %', function_name;
    exception when insufficient_privilege then null;
    end;
  end loop;

  begin
    insert into public.portfolio_ledger
      (portfolio_id, transaction_type, currency, amount, reference_type, reference_id, idempotency_key)
      values (portfolio_a, 'ADJUSTMENT', 'EUR', 999, 'TEST', 'forged', 'hosted-portfolio-forged');
    raise exception 'FAIL: browser manufactured ledger funds';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.portfolio_ledger set amount = 999 where portfolio_id = portfolio_a;
    raise exception 'FAIL: browser ledger UPDATE allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.portfolio_ledger where portfolio_id = portfolio_a;
    raise exception 'FAIL: browser ledger DELETE allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    truncate public.portfolio_ledger;
    raise exception 'FAIL: browser ledger TRUNCATE allowed';
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', owner_b::text, true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', owner_b, 'role', 'authenticated', 'is_anonymous', false)::text, true);
  execute 'set local role authenticated';
  select * into strict current_snapshot from public.initialize_dry_run_portfolio(owner_b);
  portfolio_b := current_snapshot.id;
  if portfolio_a = portfolio_b
     or (select count(*) from public.portfolios) <> 1
     or (select count(*) from public.portfolio_ledger) <> 1
     or exists (select 1 from public.portfolios where id = portfolio_a)
     or exists (select 1 from public.portfolio_ledger where portfolio_id = portfolio_a) then
    raise exception 'FAIL: owner isolation after both portfolios are initialized';
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', anonymous_owner::text, true);
  -- Deliberately omit anonymous JWT flag: the private DB guard must still deny.
  perform set_config('request.jwt.claims', json_build_object(
    'sub', anonymous_owner, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    perform private.initialize_dry_run_portfolio(anonymous_owner);
    raise exception 'FAIL: anonymous Auth database owner initialized funds';
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', owner_a::text, true);
  perform set_config('request.jwt.claims', json_build_object(
    'sub', owner_a, 'role', 'authenticated', 'is_anonymous', true)::text, true);
  execute 'set local role authenticated';
  begin
    perform public.get_dry_run_portfolio(owner_a);
    raise exception 'FAIL: anonymous JWT read RPC allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.initialize_dry_run_portfolio(owner_a);
    raise exception 'FAIL: anonymous JWT initialization RPC allowed';
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  execute 'set local role authenticated';
  begin
    perform public.initialize_dry_run_portfolio(owner_a);
    raise exception 'FAIL: missing identity initialization allowed';
  exception when insufficient_privilege then null;
  end;
  execute 'reset role';
  execute 'set local role anon';
  begin
    perform public.initialize_dry_run_portfolio(owner_a);
    raise exception 'FAIL: anonymous role initialization allowed';
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
  -- Statement-level immutable guards also apply to privileged database writers.
  begin
    update public.portfolio_ledger set amount = 999 where portfolio_id = portfolio_a;
    raise exception 'FAIL: privileged ledger UPDATE allowed';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'LEDGER_APPEND_ONLY' then raise; end if;
  end;
  begin
    delete from public.portfolio_ledger where portfolio_id = portfolio_a;
    raise exception 'FAIL: privileged ledger DELETE allowed';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'LEDGER_APPEND_ONLY' then raise; end if;
  end;
  begin
    truncate public.portfolio_ledger;
    raise exception 'FAIL: privileged ledger TRUNCATE allowed';
  exception when object_not_in_prerequisite_state then
    if sqlerrm <> 'LEDGER_APPEND_ONLY' then raise; end if;
  end;
  if (select count(*) from public.portfolios where id in (portfolio_a, portfolio_b)) <> 2
     or (select count(*) from public.portfolio_ledger where portfolio_id in (portfolio_a, portfolio_b)
         and transaction_type = 'INITIAL_CAPITAL' and currency = 'EUR' and amount = 500) <> 2 then
    raise exception 'FAIL: verification changed financial history';
  end if;
end;
$portfolio_verification$;
rollback;
select 'AI-003 hosted portfolio verification passed; all fixtures rolled back' as result;
