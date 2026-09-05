-- =============================================================================
-- 0023_live_availability_foundation.sql
-- Purpose: Phase 1 of "Live Availability, Smart Booking & Real-Time
-- Restaurant Experience" -- database/RPC foundation only. No visible
-- behaviour changes for any existing screen or restaurant: every new flag
-- below starts disabled (is_enabled_default = false, rollout_percentage =
-- 0), and the new RPC is purely additive (nothing existing calls it yet).
--
-- What this migration adds, and why each piece is safe:
--
--   1. feature_flag_overrides_restaurant_owner_write: a restaurant's own
--      owner/manager can now set/change/remove a feature-flag override
--      scoped to THEIR OWN restaurant_id (previously, per 0020, only a
--      platform admin could write ANY override, including a restaurant's
--      own). This is what will let each restaurant owner turn the new
--      live-availability capabilities on/off for their own restaurant (the
--      spec's "Restaurant Owner Control" section) without needing a
--      platform admin to do it for them. Organization-scoped overrides are
--      deliberately NOT opened up here -- those span every restaurant in an
--      organization and stay platform-admin-only, unchanged.
--
--   2. Six new feature_flags rows, one per new toggleable capability:
--      live_availability, waitlist_public, live_occupancy,
--      last_minute_alerts, popularity_indicator, customer_notifications.
--      Reuses the existing feature_flags/feature_flag_overrides system
--      (0010) rather than a new settings table -- there was already a
--      generic, per-restaurant-overridable mechanism for exactly this.
--
--   3. get_public_availability_summary(): a new SECURITY DEFINER function,
--      reachable by the `anon` role (same pattern as book_public_reservation,
--      0014), returning ONLY aggregated, anonymized numbers -- a count of
--      free standalone tables and a yes/no for a combinable option -- for
--      each bookable time slot on a given date. No guest name, phone, table
--      id, or any other per-reservation detail is ever returned by this
--      function; it never selects from `reservations` at all, only from
--      `tables` (via the existing get_available_tables /
--      get_available_table_combinations functions from 0013). This directly
--      satisfies both the "no fake scarcity" rule (every number is real,
--      queried live, nothing hard-coded or estimated) and the "privacy"
--      rule (nothing personally identifying can leak through it).
--
--      Known, documented limitation (same style as book_public_reservation's
--      rate-limiter note): a shift that crosses midnight (closes_at <=
--      opens_at, e.g. a club open 22:00-04:00) is skipped by the slot
--      generator for now -- it simply produces no time slots for that
--      shift, rather than mis-generating them. Same-day shifts (the
--      overwhelming majority of restaurants) are unaffected. Closing this
--      gap is tracked for a later pass once a real midnight-crossing
--      restaurant needs it, rather than shipping untested wraparound logic.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Let a restaurant's own owner/manager manage their OWN restaurant's
-- feature-flag overrides. Additive to feature_flag_overrides_platform_write
-- (0020, platform-admin, unrestricted) and feature_flag_overrides_select
-- (0011, already lets any restaurant member READ their own restaurant's
-- overrides) -- this is the first WRITE policy scoped to the restaurant's
-- own staff. Organization-scoped rows (restaurant_id is null) are excluded
-- by the `restaurant_id is not null` check, so an owner can never touch an
-- organization-wide override this way.
-- ---------------------------------------------------------------------------
create policy feature_flag_overrides_restaurant_owner_write on public.feature_flag_overrides for all
  using (restaurant_id is not null and has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]))
  with check (restaurant_id is not null and has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[]));

comment on policy feature_flag_overrides_restaurant_owner_write on public.feature_flag_overrides is
  'A restaurant owner/manager may set/change/remove a flag override for their OWN restaurant_id only -- added for the Live Availability feature''s per-restaurant owner toggles. Organization-scoped overrides stay platform-admin-only (feature_flag_overrides_platform_write, 0020).';

-- ---------------------------------------------------------------------------
-- 2. New flag definitions. All disabled by default -- an owner (or, until
-- the owner-facing settings screen ships, a platform admin) must opt a
-- restaurant in explicitly. `on conflict do nothing` makes this migration
-- safe to re-run.
-- ---------------------------------------------------------------------------
insert into public.feature_flags (key, description, is_enabled_default, rollout_percentage) values
  ('live_availability',      'Show live per-time-slot table availability on the public restaurant page.', false, 0),
  ('waitlist_public',        'Let customers join the waitlist themselves from the public restaurant page, with no staff involved.', false, 0),
  ('live_occupancy',         'Show an anonymized, aggregate "how busy is it right now" indicator on the public restaurant page.', false, 0),
  ('last_minute_alerts',     'Notify waiting/interested customers automatically when a cancellation opens up a last-minute slot.', false, 0),
  ('popularity_indicator',   'Show an anonymized "popular time" indicator based on real recent booking volume.', false, 0),
  ('customer_notifications', 'Send customers proactive live-availability / waitlist notifications (new template_codes on the existing notifications system, 0008).', false, 0)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. get_public_availability_summary(): anonymous-callable, aggregate-only
-- live availability for one restaurant/date/party size. Built entirely on
-- top of get_available_tables() / get_available_table_combinations() (0013)
-- -- the same, already-tested allocation-lookup functions the staff app and
-- book_reservation() itself use -- so there is exactly one implementation of
-- "is a table free at this time", reused here rather than re-derived.
-- ---------------------------------------------------------------------------
create or replace function public.get_public_availability_summary(
  p_restaurant_slug text,
  p_date date,
  p_party_size int default 2,
  p_interval_minutes int default 30
)
returns table (
  slot_starts_at timestamptz,
  slot_ends_at timestamptz,
  available_table_count int,
  has_combinable_option boolean
)
security definer
set search_path = public
language plpgsql
stable
as $$
declare
  v_restaurant       public.restaurants%rowtype;
  v_duration_min     int;
  v_interval_min     int;
  v_dow              smallint;
  v_special          public.special_hours%rowtype;
  v_shift            record;
  v_shift_start_ts   timestamp;
  v_shift_close_ts   timestamp;
  v_cursor_ts        timestamp;
  v_slot_start_tz    timestamptz;
  v_slot_end_tz      timestamptz;
begin
  if p_restaurant_slug is null or p_date is null then
    raise exception 'INVALID_ARGUMENTS';
  end if;

  select * into v_restaurant
  from public.restaurants
  where slug = p_restaurant_slug and deleted_at is null and is_active;
  if not found then
    raise exception 'RESTAURANT_NOT_FOUND';
  end if;

  if p_party_size is null or p_party_size < v_restaurant.min_party_size or p_party_size > v_restaurant.max_party_size then
    raise exception 'PARTY_SIZE_OUT_OF_RANGE';
  end if;

  v_duration_min := v_restaurant.default_reservation_duration_min;
  -- Clamp to a sane range rather than trusting a public, unauthenticated
  -- caller's raw input -- a 0 or negative value would spin the loop below
  -- forever, and a huge one is never a real UI need.
  v_interval_min := greatest(5, least(coalesce(p_interval_minutes, 30), 240));
  v_dow := extract(dow from p_date);

  select * into v_special from public.special_hours where restaurant_id = v_restaurant.id and date = p_date;

  for v_shift in (
    select opens_at, closes_at from (
      select v_special.opens_at as opens_at, v_special.closes_at as closes_at
      where v_special.id is not null and not v_special.is_closed
      union all
      select oh.opens_at, oh.closes_at
      from public.opening_hours oh
      where v_special.id is null and oh.restaurant_id = v_restaurant.id and oh.day_of_week = v_dow and not oh.is_closed
    ) shifts
    where opens_at is not null and closes_at is not null
  )
  loop
    -- Documented limitation (see migration header): a shift crossing
    -- midnight is skipped here, not mis-generated.
    continue when v_shift.closes_at <= v_shift.opens_at;

    v_shift_start_ts := p_date::timestamp + v_shift.opens_at;
    v_shift_close_ts := p_date::timestamp + v_shift.closes_at;
    v_cursor_ts := v_shift_start_ts;

    while v_cursor_ts + make_interval(mins => v_duration_min) <= v_shift_close_ts
    loop
      v_slot_start_tz := v_cursor_ts at time zone v_restaurant.timezone;
      v_slot_end_tz := v_slot_start_tz + make_interval(mins => v_duration_min);

      slot_starts_at := v_slot_start_tz;
      slot_ends_at := v_slot_end_tz;
      select count(*)::int into available_table_count
      from public.get_available_tables(v_restaurant.id, v_slot_start_tz, v_slot_end_tz, p_party_size);
      has_combinable_option := exists (
        select 1 from public.get_available_table_combinations(v_restaurant.id, v_slot_start_tz, v_slot_end_tz, p_party_size)
      );
      return next;

      v_cursor_ts := v_cursor_ts + make_interval(mins => v_interval_min);
    end loop;
  end loop;

  return;
end;
$$;

grant execute on function public.get_public_availability_summary(text, date, int, int) to anon, authenticated;

comment on function public.get_public_availability_summary is
  'Public/anon-callable. Per-time-slot live availability for one restaurant/date/party size, built on get_available_tables()/get_available_table_combinations() (0013). Returns only aggregated counts and booleans -- never a table id, a guest name, or any other per-reservation detail -- so it is safe to expose with no RLS grant on tables/reservations themselves. Raises RESTAURANT_NOT_FOUND / PARTY_SIZE_OUT_OF_RANGE / INVALID_ARGUMENTS.';
