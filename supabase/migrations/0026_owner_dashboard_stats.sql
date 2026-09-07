-- =============================================================================
-- 0026_owner_dashboard_stats.sql
-- Purpose: Phase 4 of "Live Availability, Smart Booking & Real-Time Restaurant
-- Experience" -- a live, real-time dashboard for restaurant staff (owner/
-- manager/host/etc, on the mobile app): today's reservation/cover counts,
-- no-shows, cancellations, current table occupancy, and an hourly breakdown
-- for a simple bar chart + peak-hour insight.
--
-- No new tables, triggers, or Realtime publication changes are needed for
-- this phase. Staff already has full SELECT access to reservations/tables
-- for their own restaurant (0011's reservations_select / tables_select RLS
-- policies), and 0025's restaurant_availability_versions heartbeat already
-- fires on every reservation_tables insert/update/delete -- which covers
-- every state change this dashboard cares about: a new booking inserts a
-- reservation_tables row, and every status transition (confirmed -> seated
-- -> completed, or -> cancelled / no_show) updates blocks_availability on
-- that same row via 0006's reservations_propagate_to_tables trigger. So the
-- exact same subscribeToAvailabilityChanges() wiring from Phase 3 (see
-- 0025's header) is reused as this dashboard's "something changed, go
-- silently re-fetch your stats" signal -- see
-- subscribeToRestaurantDashboard() in packages/core/src/api/ownerDashboard.ts.
--
-- Both functions below are SECURITY INVOKER (the caller's own RLS applies,
-- same principle as fetchReservations()/fetchTables() elsewhere in this
-- codebase) with an explicit is_restaurant_member() guard for a clear error
-- instead of a silently-empty result for a non-member. Both are STABLE
-- (read-only, no side effects) and granted to `authenticated` only -- unlike
-- Phase 1-3's public-facing functions, there is no anonymous/guest use case
-- here.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- get_restaurant_dashboard_stats: one row of aggregate counts for a single
-- restaurant-day, in the RESTAURANT's own local timezone (0002:
-- restaurants.timezone is "the authoritative clock for all reservations at
-- this restaurant, per the product brief") -- not the caller's device
-- timezone, which is the MVP simplification other mobile screens still rely
-- on (see reservations/new.tsx and the Phase 07 README). p_local_date
-- defaults to "today" in that same restaurant-local sense.
--
-- reservations_total counts every reservation touching that local day,
-- whatever its status, so staff can see raw booking volume. covers_total /
-- the hourly breakdown / peak hour all use the SAME status filter (pending,
-- confirmed, seated, completed) -- i.e. every reservation except the ones
-- that did NOT happen -- so "covers" reads as "guests expected or served",
-- not inflated by bookings that were cancelled or never showed up.
-- no_shows_count / cancellations_count are reported separately so staff can
-- see those without hunting through the day's full list.
--
-- occupied_tables_count / active_tables_count / occupancy_percent are a
-- RIGHT NOW snapshot of public.tables.status, independent of p_local_date --
-- occupancy is inherently a live concept, not a historical one, so viewing
-- a past date's stats still shows today's actual occupancy rather than a
-- meaningless historical occupancy nobody logged.
-- ---------------------------------------------------------------------------
create or replace function public.get_restaurant_dashboard_stats(
  p_restaurant_id uuid,
  p_local_date date default null
)
returns table (
  local_date            date,
  reservations_total    int,
  covers_total          int,
  no_shows_count        int,
  cancellations_count   int,
  occupied_tables_count int,
  active_tables_count   int,
  occupancy_percent     numeric,
  peak_hour_local       int,
  peak_hour_covers      int
)
language plpgsql
stable
security invoker
as $$
declare
  v_tz          text;
  v_local_date  date;
  v_day_start   timestamptz;
  v_day_end     timestamptz;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    raise exception 'not a member of this restaurant' using errcode = '42501';
  end if;

  select timezone into v_tz from public.restaurants where id = p_restaurant_id;
  if v_tz is null then
    raise exception 'restaurant not found' using errcode = 'P0002';
  end if;

  v_local_date := coalesce(p_local_date, (now() at time zone v_tz)::date);
  v_day_start  := v_local_date::timestamp at time zone v_tz;
  v_day_end    := v_day_start + interval '1 day';

  return query
  with day_reservations as (
    select r.status, r.party_size, r.starts_at
    from public.reservations r
    where r.restaurant_id = p_restaurant_id
      and r.starts_at >= v_day_start
      and r.starts_at < v_day_end
  ),
  counted as (
    select
      count(*)::int as reservations_total,
      coalesce(sum(party_size) filter (where status in ('pending', 'confirmed', 'seated', 'completed')), 0)::int as covers_total,
      count(*) filter (where status = 'no_show')::int as no_shows_count,
      count(*) filter (where status = 'cancelled')::int as cancellations_count
    from day_reservations
  ),
  peak as (
    select
      extract(hour from (starts_at at time zone v_tz))::int as hour_local,
      sum(party_size)::int as covers
    from day_reservations
    where status in ('pending', 'confirmed', 'seated', 'completed')
    group by 1
    order by covers desc, hour_local asc
    limit 1
  ),
  occupancy as (
    select
      count(*) filter (where status in ('occupied', 'seated'))::int as occupied_tables_count,
      count(*)::int as active_tables_count
    from public.tables
    where restaurant_id = p_restaurant_id
      and is_active
      and status <> 'out_of_service'
  )
  select
    v_local_date,
    counted.reservations_total,
    counted.covers_total,
    counted.no_shows_count,
    counted.cancellations_count,
    occupancy.occupied_tables_count,
    occupancy.active_tables_count,
    case when occupancy.active_tables_count > 0
      then round(100.0 * occupancy.occupied_tables_count / occupancy.active_tables_count, 1)
      else 0::numeric
    end,
    peak.hour_local,
    peak.covers
  from counted, occupancy
  left join peak on true;
end;
$$;

comment on function public.get_restaurant_dashboard_stats(uuid, date) is
  'Phase 4 owner dashboard: one row of today''s (or p_local_date''s) reservation/cover/no-show/cancellation counts plus a right-now occupancy snapshot and peak hour, all computed in the restaurant''s own IANA timezone. SECURITY INVOKER -- relies on the caller''s existing reservations_select/tables_select RLS, same as fetchReservations()/fetchTables().';

grant execute on function public.get_restaurant_dashboard_stats(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- get_restaurant_dashboard_hourly: the same day's reservations broken down
-- by local hour, for the dashboard's hourly bar chart. Only hours with at
-- least one qualifying reservation are returned (a sparse result, ordered by
-- hour) -- the mobile client fills in the gaps when it draws the chart,
-- exactly like get_public_availability_summary (0023) already leaves gap-
-- filling / formatting to its caller rather than doing it in SQL.
-- ---------------------------------------------------------------------------
create or replace function public.get_restaurant_dashboard_hourly(
  p_restaurant_id uuid,
  p_local_date date default null
)
returns table (
  hour_local          int,
  reservations_count  int,
  covers_count        int
)
language plpgsql
stable
security invoker
as $$
declare
  v_tz          text;
  v_local_date  date;
  v_day_start   timestamptz;
  v_day_end     timestamptz;
begin
  if not public.is_restaurant_member(p_restaurant_id) then
    raise exception 'not a member of this restaurant' using errcode = '42501';
  end if;

  select timezone into v_tz from public.restaurants where id = p_restaurant_id;
  if v_tz is null then
    raise exception 'restaurant not found' using errcode = 'P0002';
  end if;

  v_local_date := coalesce(p_local_date, (now() at time zone v_tz)::date);
  v_day_start  := v_local_date::timestamp at time zone v_tz;
  v_day_end    := v_day_start + interval '1 day';

  return query
  select
    extract(hour from (r.starts_at at time zone v_tz))::int as hour_local,
    count(*)::int as reservations_count,
    coalesce(sum(r.party_size), 0)::int as covers_count
  from public.reservations r
  where r.restaurant_id = p_restaurant_id
    and r.starts_at >= v_day_start
    and r.starts_at < v_day_end
    and r.status in ('pending', 'confirmed', 'seated', 'completed')
  group by 1
  order by 1;
end;
$$;

comment on function public.get_restaurant_dashboard_hourly(uuid, date) is
  'Phase 4 owner dashboard: reservations/covers for one restaurant-day grouped by local hour, sparse (only hours with data), for the mobile hourly bar chart. Same RLS/timezone approach as get_restaurant_dashboard_stats().';

grant execute on function public.get_restaurant_dashboard_hourly(uuid, date) to authenticated;
