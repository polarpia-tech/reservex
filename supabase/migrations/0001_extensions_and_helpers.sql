-- =============================================================================
-- 0001_extensions_and_helpers.sql
-- Purpose: enable required Postgres extensions and shared helper objects used
-- by every later migration (updated_at trigger, exclusion-constraint support).
-- =============================================================================

-- gen_random_uuid() for primary keys
create extension if not exists pgcrypto;

-- required so an EXCLUDE constraint can mix an equality column (table_id)
-- with a range column (tstzrange) in the same GiST index -- this is the
-- mechanism that makes double-booking impossible at the database level.
create extension if not exists btree_gist;

-- case-insensitive text, used for email columns
create extension if not exists citext;

-- ---------------------------------------------------------------------------
-- Generic "updated_at" trigger, attached to every table that has that column.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'Row-level trigger: stamps updated_at = now() on every UPDATE. Attached per-table.';
