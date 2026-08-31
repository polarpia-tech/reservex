-- =============================================================================
-- local_dev_shim.sql
-- FOR LOCAL TESTING ONLY -- never run this against a real Supabase project.
-- Supabase already provides the `auth` schema, `auth.users` table and
-- `auth.uid()` function; this file fakes a minimal version of them so the
-- migrations above (which reference auth.users / auth.uid()) can be applied
-- and exercised against a plain, local PostgreSQL instance.
-- =============================================================================

create schema if not exists auth;

create table if not exists auth.users (
  id         uuid primary key default gen_random_uuid(),
  email      text
);

-- Supabase's real auth.uid() reads the "sub" claim out of the request JWT.
-- Here we read it from a Postgres session setting instead, so a test script
-- can impersonate different users with:
--   select set_config('request.jwt.claim.sub', '<uuid>', false);
create or replace function auth.uid() returns uuid
language sql stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- Two non-superuser roles that mimic Supabase's real "authenticated" and
-- "anon" roles: neither has BYPASSRLS, so they are the only roles that can
-- meaningfully test our RLS policies (the postgres superuser bypasses RLS
-- entirely, by design). "anon" is what an unauthenticated request runs as
-- in real Supabase (via the anon API key) -- added in Phase 08, the first
-- phase with any RLS policy that actually grants that role something
-- (public restaurant browsing, public booking).
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
end
$$;

grant usage on schema public, auth to authenticated, anon;
grant select, insert, update, delete on all tables in schema public to authenticated, anon;
grant usage, select on all sequences in schema public to authenticated, anon;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, anon;
