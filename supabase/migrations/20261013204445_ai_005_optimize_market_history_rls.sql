-- AI-005: avoid re-evaluating Auth helper functions for every row in the
-- historical market-data read policies. This is a forward-only correction to
-- the already deployed AI-004 migration.

drop policy if exists market_candles_authenticated_read
  on public.market_candles;

create policy market_candles_authenticated_read
  on public.market_candles
  for select
  to authenticated
  using (
    (select auth.uid()) is not null
    and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false)
  );

drop policy if exists market_data_import_runs_owner_read
  on public.market_data_import_runs;

create policy market_data_import_runs_owner_read
  on public.market_data_import_runs
  for select
  to authenticated
  using (
    (select auth.uid()) = owner_id
    and not coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false)
  );
