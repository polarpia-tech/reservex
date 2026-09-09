-- =============================================================================
-- 0036_popularity_indicators.sql
-- Purpose: Phase 6, sub-feature 4 of "Live Availability, Smart Booking &
-- Real-Time Restaurant Experience" -- an anonymized "popular time" badge on
-- the public restaurant page's Live Availability time-slot chips (0023's
-- LiveAvailabilityPanel), so a guest can see at a glance which times are
-- historically busiest for THIS restaurant, without ever seeing a raw
-- headcount for anyone else's reservation.
--
-- Design (confirmed with the team before building): for a given restaurant
-- and date, look at the SAME day-of-week over the last 8 weeks, bucket every
-- real (confirmed/seated/completed -- never pending/cancelled/no_show, which
-- never represented actual demand) reservation's local start time into
-- 30-minute buckets, and flag a bucket "popular" only when:
--   1. the restaurant has at least 12 total qualifying reservations on that
--      day-of-week in the lookback window at all (otherwise: no badges,
--      full stop -- a brand-new or low-traffic restaurant gets an honest
--      "not enough data yet", never a fabricated "popular" claim just
--      because one bucket happens to have the most of a tiny sample), and
--   2. that specific bucket has at least 3 reservations AND is within 70%
--      of that day-of-week's single busiest bucket (so only the genuine
--      top tier gets the badge, not every bucket that ever had a booking).
--
-- Returns ONLY the list of popular local times (as 'HH24:MI' text, 30-min
-- granularity) -- never counts, never which reservations, never anything
-- that could be used to infer how full any specific slot actually is right
-- now. This is deliberately a SEPARATE signal from get_public_availability_
-- summary (0023): "historically popular" (this function, backward-looking)
-- vs. "free tables right now" (that one, live) answer different questions
-- and are shown together as two independent badges on the same chip.
--
-- KNOWN LIMITATION, documented not hidden: bucket boundaries are plain
-- 30-minute wall-clock buckets (00:00, 00:30, 01:00, ...) in the
-- restaurant's own timezone, which will not always land exactly on this
-- restaurant's own slot-start grid if its opening_hours.opens_at isn't
-- itself on a :00/:30 boundary (e.g. a restaurant that opens at 18:15) --
-- the same class of approximation get_public_availability_summary's own
-- shift-walking already accepts for irregular hours, not a new gap this
-- migration introduces.
--
-- Same timezone-conversion discipline as 0023/0034: every intermediate
-- value stays a plain `timestamp` (via `at time zone`) all the way through;
-- nothing is ever assigned into a declared `timestamptz` variable and then
-- converted a second time (the exact bug 0034's own header comment
-- documents fixing).
-- =============================================================================

create or replace function public.get_public_popularity_indicators(
  p_restaurant_slug text,
  p_date date
)
returns table (
  popular_local_time text
)
security definer
set search_path = public
language plpgsql
stable
as $$
declare
  v_restaurant         public.restaurants%rowtype;
  v_dow                smallint;
  v_lookback_days      constant int := 56;   -- 8 weeks
  v_min_total_sample   constant int := 12;   -- minimum real reservations on this day-of-week before showing ANY badge
  v_min_bucket_count   constant int := 3;    -- a single bucket must itself have at least this many to ever be "popular"
  v_popular_ratio      constant numeric := 0.7; -- and be within 70% of that day-of-week's single busiest bucket
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

  v_dow := extract(dow from p_date);

  return query
  with local_starts as (
    select (r.starts_at at time zone v_restaurant.timezone) as local_starts_at
    from public.reservations r
    where r.restaurant_id = v_restaurant.id
      and r.status in ('confirmed', 'seated', 'completed')
      and (r.starts_at at time zone v_restaurant.timezone) >= (p_date - v_lookback_days)
      and (r.starts_at at time zone v_restaurant.timezone) < p_date
      and extract(dow from (r.starts_at at time zone v_restaurant.timezone)) = v_dow
  ),
  buckets as (
    select
      -- Cast to plain `time` here (not just date_trunc('hour', ...), which
      -- keeps the DATE too) -- the whole point is to merge the same
      -- time-of-day across every one of the last 8 same-weekday dates into
      -- ONE bucket. Without the ::time cast, every week's 20:00 becomes its
      -- own distinct bucket (2026-09-04 20:00, 2026-08-28 20:00, ...) and
      -- nothing ever accumulates a real count -- caught in local testing
      -- before this ever reached production.
      (date_trunc('hour', local_starts_at)
        + floor(extract(minute from local_starts_at) / 30) * interval '30 minutes')::time as bucket_time,
      count(*) as bucket_count
    from local_starts
    group by 1
  ),
  totals as (
    select coalesce(sum(bucket_count), 0) as total_sample, coalesce(max(bucket_count), 0) as max_bucket
    from buckets
  )
  select to_char(b.bucket_time, 'HH24:MI')
  from buckets b, totals t
  where t.total_sample >= v_min_total_sample
    and b.bucket_count >= v_min_bucket_count
    and b.bucket_count >= v_popular_ratio * t.max_bucket
  order by 1;
end;
$$;

grant execute on function public.get_public_popularity_indicators(text, date) to anon, authenticated;

comment on function public.get_public_popularity_indicators is
  'Phase 6, sub-feature 4 (migration 0036). Anonymized, aggregate-only "popular time" indicator for a restaurant''s public page: given a date, returns the HH:MM local-time buckets (30-min granularity) that have historically been that restaurant''s busiest, same day-of-week, over the last 8 weeks -- never raw counts, never per-reservation detail. Returns NO rows (not an error) when the restaurant has fewer than 12 real (confirmed/seated/completed) reservations on that day-of-week in the lookback window, rather than showing a misleading badge on thin data. anon-callable, SECURITY DEFINER (same class of function as get_public_availability_summary, 0023): a guest never has direct SELECT on reservations.';
