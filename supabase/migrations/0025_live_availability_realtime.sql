-- =============================================================================
-- 0025_live_availability_realtime.sql
-- Purpose: Phase 3 of "Live Availability, Smart Booking & Real-Time
-- Restaurant Experience" -- make the customer-facing live availability
-- panel (Phase 2, migrations 0023/0024) update itself the instant someone
-- else's booking changes the picture, instead of only ever reflecting
-- whatever was true 350ms after the visitor last touched the date/party-size
-- inputs.
--
-- Why not just subscribe to Postgres Changes on `reservations` or
-- `reservation_tables` directly: both tables carry guest PII (guest_name,
-- guest_phone, guest_email, internal_notes on reservations; even
-- reservation_tables, PII-free itself, would still hand an anonymous
-- subscriber a live feed of every table-assignment insert/update/delete for
-- the restaurant -- far more than "does the picture I'm looking at need a
-- refresh?"). Section 28 of the spec ("PRIVACY") is explicit that live
-- booking indicators must never expose guest identity. So, same
-- "narrowest safe surface" reasoning as book_public_reservation (0014),
-- get_public_availability_summary (0023) and
-- is_feature_enabled_for_restaurant (0024): a new table that holds NOTHING
-- but "this restaurant's availability picture changed at time T" -- no
-- party size, no table id, no guest data, not even which date changed.
--
-- Why one row per restaurant rather than one row (or an event log) per
-- restaurant+date: an event log would grow forever and need its own
-- cleanup job, which is more moving parts than this feature is worth (see
-- also section 36, "add only what's genuinely needed"). A single
-- upserted row per restaurant means a change on ANY date makes an open
-- booking form quietly re-check the ONE date it currently has selected --
-- occasionally an unnecessary re-check (someone booked a different day),
-- but that costs one cheap read-only RPC call, which is far cheaper than
-- either polling on a timer (explicitly discouraged by section 38,
-- "PERFORMANCE") or building per-date bookkeeping this feature does not
-- need.
--
-- Hook point: `reservation_tables`, not `reservations` -- one place
-- (0006's own trigger pair) already denormalizes "does this reservation
-- currently hold a table" onto reservation_tables.blocks_availability /
-- time_range for the EXCLUDE constraint, and get_available_tables /
-- get_available_table_combinations (0013) already read ONLY from
-- reservation_tables, never from reservations directly. So "something
-- that could change get_available_tables' answer just happened" is
-- exactly "a row in reservation_tables was inserted, updated, or deleted"
-- -- no need to duplicate 0006's own reservation-status-to-availability
-- logic here.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- restaurant_availability_versions: a heartbeat, not a record. One row per
-- restaurant; updated_at bumped every time that restaurant's table
-- availability could have changed. Anon/authenticated readable by design --
-- there is nothing in this table that identifies any booking, guest, or
-- even which table/date was affected.
-- ---------------------------------------------------------------------------
create table public.restaurant_availability_versions (
  restaurant_id  uuid primary key references public.restaurants(id) on delete cascade,
  updated_at     timestamptz not null default now()
);

comment on table public.restaurant_availability_versions is
  'Phase 3 of the Live Availability upgrade. One heartbeat row per restaurant, bumped whenever reservation_tables changes for it. Carries no guest/booking data by design -- see this migration''s header comment. Anonymous browsers subscribe to this table via Supabase Realtime to know when to silently re-check get_public_availability_summary(), instead of polling on a timer.';

alter table public.restaurant_availability_versions enable row level security;

-- Deliberately unconditional: the row itself is just a restaurant_id and a
-- timestamp, already implied by the restaurant's own public slug being
-- known (0014's restaurants_public_select already lets anon read far more
-- about the restaurant than this). Scoping this to "restaurant is
-- active/not deleted" would need a join on every realtime change event for
-- no real privacy benefit, since a heartbeat for an inactive restaurant
-- leaks nothing either.
create policy restaurant_availability_versions_select on public.restaurant_availability_versions
  for select
  using (true);

grant select on public.restaurant_availability_versions to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Trigger: bump the restaurant's heartbeat row on every reservation_tables
-- change. AFTER, not BEFORE -- this must never be able to block or fail the
-- actual booking/cancellation it's reacting to; if this insert/update ever
-- raised, the whole point (a nice-to-have realtime nudge) would be taking
-- down the booking engine itself, which is backwards.
--
-- ON CONFLICT DO UPDATE means concurrent bookings for the SAME restaurant
-- (but different tables) serialize briefly on this one row -- never a
-- deadlock (only one row, one table, ever locked here), just a short wait,
-- and far cheaper than the alternative of polling on a timer.
-- ---------------------------------------------------------------------------
create or replace function public.bump_restaurant_availability_version()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
declare
  v_restaurant_id uuid;
begin
  v_restaurant_id := coalesce(new.restaurant_id, old.restaurant_id);

  insert into public.restaurant_availability_versions (restaurant_id, updated_at)
  values (v_restaurant_id, now())
  on conflict (restaurant_id) do update set updated_at = excluded.updated_at;

  return null; -- AFTER trigger; return value is ignored either way.
end;
$$;

comment on function public.bump_restaurant_availability_version is
  'AFTER trigger on reservation_tables. Upserts that restaurant''s heartbeat row in restaurant_availability_versions so anonymous browsers subscribed via Supabase Realtime know to silently re-check availability. SECURITY DEFINER: a guest''s own INSERT into reservation_tables (via book_public_reservation, 0014) only grants them write access to reservation_tables itself, not to this new table -- this trigger is the one and only writer.';

create trigger trg_reservation_tables_bump_availability
  after insert or update or delete on public.reservation_tables
  for each row execute function public.bump_restaurant_availability_version();

-- ---------------------------------------------------------------------------
-- Add the new table to Supabase's realtime publication so Postgres Changes
-- subscriptions can actually see its inserts/updates. Guarded with an
-- existence check (rather than a bare ALTER PUBLICATION) so this migration
-- stays safe to reason about even if a future migration, or a manual
-- Dashboard toggle, already added this table -- ALTER PUBLICATION ... ADD
-- TABLE errors out if the table is already a publication member, which
-- would otherwise turn a harmless no-op into a failed deploy.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'restaurant_availability_versions'
  ) then
    alter publication supabase_realtime add table public.restaurant_availability_versions;
  end if;
end;
$$;
