-- AI-002 hosted RLS verification, run as the project administrator after the
-- foundation migration. Execute this entire file as ONE execute_sql request.
-- All synthetic users, portfolio/ledger fixtures and claims are rolled back.
-- No email, password, API credential or persistent financial initialization.

begin;

do $rls_verification$
declare
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  portfolio_a uuid := gen_random_uuid();
  portfolio_b uuid := gen_random_uuid();
  ledger_a uuid := gen_random_uuid();
  ledger_b uuid := gen_random_uuid();
begin
  insert into auth.users (id, aud, role)
    values (owner_a, 'authenticated', 'authenticated'),
           (owner_b, 'authenticated', 'authenticated');
  insert into public.portfolios (id, owner_id)
    values (portfolio_a, owner_a), (portfolio_b, owner_b);
  insert into public.portfolio_ledger
    (id, portfolio_id, transaction_type, currency, amount,
     reference_type, reference_id, idempotency_key)
    values
      (ledger_a, portfolio_a, 'INITIAL_CAPITAL', 'EUR', 500,
       'RLS_TEST', owner_a::text, 'hosted-rls-fixture'),
      (ledger_b, portfolio_b, 'INITIAL_CAPITAL', 'EUR', 500,
       'RLS_TEST', owner_b::text, 'hosted-rls-fixture');

  -- Set both legacy and current PostgREST claim settings. No tokens are used.
  perform set_config('request.jwt.claim.sub', owner_a::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', owner_a, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  if auth.uid() is distinct from owner_a then
    raise exception 'FAIL: hosted auth.uid() does not resolve owner A';
  end if;
  if (select count(*) from public.portfolios) <> 1
     or not exists (select 1 from public.portfolios where id = portfolio_a) then
    raise exception 'FAIL: owner A cannot read exactly their portfolio';
  end if;
  if exists (select 1 from public.portfolios where id = portfolio_b) then
    raise exception 'FAIL: owner A can read owner B portfolio';
  end if;
  if (select count(*) from public.portfolio_ledger) <> 1
     or not exists (select 1 from public.portfolio_ledger where id = ledger_a) then
    raise exception 'FAIL: owner A cannot read exactly their ledger';
  end if;
  if exists (select 1 from public.portfolio_ledger where id = ledger_b) then
    raise exception 'FAIL: owner A can read owner B ledger';
  end if;

  -- Catch only the expected SQLSTATE 42501; other failures do not count as
  -- authorization success. Each block is a savepoint within this transaction.
  begin
    insert into public.portfolio_ledger
      (portfolio_id, transaction_type, currency, amount,
       reference_type, reference_id, idempotency_key)
      values (portfolio_a, 'ADJUSTMENT', 'EUR', 999,
        'RLS_TEST', 'forged', 'hosted-rls-forged');
    raise exception 'FAIL: authenticated ledger INSERT was allowed';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.portfolio_ledger set amount = 999 where id = ledger_a;
    raise exception 'FAIL: authenticated ledger UPDATE was allowed';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.portfolio_ledger where id = ledger_a;
    raise exception 'FAIL: authenticated ledger DELETE was allowed';
  exception when insufficient_privilege then null;
  end;

  begin
    truncate public.portfolio_ledger;
    raise exception 'FAIL: authenticated ledger TRUNCATE was allowed';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.portfolios (owner_id) values (owner_a);
    raise exception 'FAIL: authenticated portfolio INSERT was allowed';
  exception when insufficient_privilege then null;
  end;

  begin
    update public.portfolios set owner_id = owner_b where id = portfolio_a;
    raise exception 'FAIL: authenticated ownership reassignment was allowed';
  exception when insufficient_privilege then null;
  end;

  begin
    delete from public.portfolios where id = portfolio_a;
    raise exception 'FAIL: authenticated portfolio DELETE was allowed';
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', owner_b::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', owner_b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';

  if auth.uid() is distinct from owner_b then
    raise exception 'FAIL: hosted auth.uid() does not resolve owner B';
  end if;
  if (select count(*) from public.portfolios) <> 1
     or not exists (select 1 from public.portfolios where id = portfolio_b)
     or exists (select 1 from public.portfolios where id = portfolio_a) then
    raise exception 'FAIL: owner B portfolio ownership isolation';
  end if;
  if (select count(*) from public.portfolio_ledger) <> 1
     or not exists (select 1 from public.portfolio_ledger where id = ledger_b)
     or exists (select 1 from public.portfolio_ledger where id = ledger_a) then
    raise exception 'FAIL: owner B ledger ownership isolation';
  end if;

  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  execute 'set local role authenticated';
  if exists (select 1 from public.portfolios)
     or exists (select 1 from public.portfolio_ledger) then
    raise exception 'FAIL: missing user identity exposes financial rows';
  end if;

  execute 'reset role';
  -- An anonymous role cannot access private tables even with an owner-shaped
  -- claim setting; role privileges and ownership RLS are independent defenses.
  perform set_config('request.jwt.claim.sub', owner_a::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', owner_a, 'role', 'anon')::text, true);
  execute 'set local role anon';

  begin
    perform id from public.portfolios;
    raise exception 'FAIL: anonymous portfolio SELECT was allowed';
  exception when insufficient_privilege then null;
  end;

  begin
    perform id from public.portfolio_ledger;
    raise exception 'FAIL: anonymous ledger SELECT was allowed';
  exception when insufficient_privilege then null;
  end;

  execute 'reset role';
  if (select count(*) from public.portfolios
      where id in (portfolio_a, portfolio_b)) <> 2 then
    raise exception 'FAIL: security verification changed portfolio fixtures';
  end if;
  if (select count(*) from public.portfolio_ledger
      where id in (ledger_a, ledger_b) and amount = 500) <> 2 then
    raise exception 'FAIL: security verification changed ledger fixtures';
  end if;
end;
$rls_verification$;

rollback;

select 'AI-002 hosted RLS verification passed; all fixtures rolled back' as result;
