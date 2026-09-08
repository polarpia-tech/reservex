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

-- Supabase automatically creates and manages a "supabase_realtime"
-- publication for every project (what Postgres Changes / Realtime
-- subscriptions read from). Migration 0025 assumes it already exists --
-- true on every real Supabase project, never true on a bare local/CI
-- Postgres instance -- and does `alter publication supabase_realtime add
-- table ...`, which errors with "publication ... does not exist" without
-- this. An empty publication here is enough for that ALTER to succeed;
-- nothing in this test harness needs it to actually stream changes.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;

-- Supabase Vault (schema "vault", encrypted secret storage) is likewise a
-- managed feature of every real Supabase project, never present on a bare
-- local/CI Postgres instance. Migration 0032's trigger reads the
-- 'waitlist_webhook_secret' from vault.decrypted_secrets and already
-- handles a MISSING secret gracefully (logs a warning, does not raise --
-- see that migration's own comment), but it still needs the relation
-- itself to exist to even attempt the SELECT. An empty stub is enough --
-- this test harness never needs a real decrypted value, only for the
-- lookup to return zero rows instead of erroring "relation does not
-- exist". NEVER put a real secret value in this file (see this project's
-- standing rule that no real secret is ever committed to git).
create schema if not exists vault;

create table if not exists vault.decrypted_secrets (
  id               uuid primary key default gen_random_uuid(),
  name             text,
  decrypted_secret text
);
