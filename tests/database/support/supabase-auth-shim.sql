-- Test-only replacements for Supabase-managed roles and Auth helpers.
-- This file is NEVER part of a migration or applied to a hosted project.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create table auth.users (id uuid primary key, aud text, role text);

create function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Model Supabase's broad historical defaults so the migration must explicitly
-- remove them, rather than passing security tests only on a pristine database.
alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
