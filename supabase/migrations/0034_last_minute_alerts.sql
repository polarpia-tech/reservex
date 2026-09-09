-- =============================================================================
-- 0034_last_minute_alerts.sql
-- Purpose: Phase 6, sub-feature 3 of "Live Availability, Smart Booking &
-- Real-Time Restaurant Experience" -- "last-minute availability alerts"
-- (the last_minute_alerts flag seeded back in 0023, never implemented until
-- now). Deliberately built as a NEW, simpler entry point on top of the
-- self-service waitlist mechanism already verified live end-to-end in
-- production (0029-0032, confirmed 2026-09-08 with a real Android push
-- notification) -- not a separate table, not a separate push pipeline.
--
-- The product difference from the existing public waitlist (0029, part 2c):
-- join_public_waitlist requires the guest to first pick a specific date and
-- time, find out it's unavailable, and only then be offered "join the
-- waitlist for that exact slot". A last-minute alert is more spontaneous:
-- "let me know if ANYTHING opens up today, right now until closing" -- no
-- specific time to pick at all. Same guest identity rules, same push
-- pipeline, same claim_waitlist_matches_for_restaurant trigger chain --
-- only the JOIN shape and the AVAILABILITY-MATCHING shape differ, both
-- addressed below.
--
-- Three things:
--   1. waitlist_entries.is_last_minute -- distinguishes a last-minute entry
--      from a regular one. Needed because a last-minute entry's
--      requested_time_range is NOT "the exact slot the guest wants" (as it
--      is for a regular entry) -- it is "now (at join time) through
--      closing", stored purely for bookkeeping/expiry/display. Matching it
--      literally against get_available_tables/get_available_table_combinations
--      (which check availability across the ENTIRE given range as one
--      fixed-duration block) would require an actual free table for the
--      whole remainder of the day, which would almost never happen -- the
--      feature would look "built" but silently never fire. See point 3.
--   2. join_last_minute_alert(): the new public/anon-callable entry point.
--      Mirrors join_public_waitlist's guest-identity/rate-limit/duplicate-
--      join/audit-log logic closely (same patterns, same error codes where
--      they apply) but computes "now through closing today" internally
--      instead of taking a desired time from the caller, and checks
--      immediate availability (right now, for one standard-duration slot)
--      rather than a caller-specified slot.
--   3. claim_waitlist_matches_for_restaurant() gains an is_last_minute
--      branch: for a last-minute entry, it checks availability for a
--      FRESH standard-duration slot computed at claim time (now() through
--      now() + the restaurant's default_reservation_duration_min) instead
--      of the entry's own (deliberately wide) stored range, and returns
--      THAT actual matched slot (not the wide stored range) as
--      slot_starts_at/slot_ends_at, since that's what the push notification
--      text actually shows the guest. The existing non-last-minute branch
--      is completely unchanged -- same SQL as 0030, byte for byte -- so the
--      already-verified regular waitlist path carries zero regression risk
--      from this migration.
--
-- Known, documented limitation (disclosed here rather than silently
-- ignored, same "honesty note" convention as every other phase in this
-- project): join_last_minute_alert deliberately does NOT enforce the
-- restaurant's booking_window_min_hours (join_public_waitlist does -- see
-- 0029/0030 -- because a last-minute alert's entire premise is immediacy,
-- which is often shorter than that minimum lead time). This means a guest
-- CAN join a last-minute alert and later BE NOTIFIED of a real opening, but
-- when they then try to actually complete the booking, book_public_reservation
-- (0014) still enforces booking_window_min_hours independently and can
-- reject it as OUTSIDE_BOOKING_WINDOW. This is a real, accepted UX gap for
-- any restaurant whose booking_window_min_hours is large -- tracked as a
-- follow-up (e.g. a public "call the restaurant directly" fallback for that
-- specific case), not solved here.
--
-- Second known limitation, inherited from get_public_availability_summary's
-- own documented limitation (0023): a shift that crosses midnight
-- (closes_at <= opens_at) is skipped when resolving "today's closing time"
-- below, same as it is for slot generation there. A restaurant whose ONLY
-- currently-open shift crosses midnight will incorrectly get RESTAURANT_CLOSED
-- from join_last_minute_alert even though it is, in fact, open -- same
-- accepted gap, same future fix path (once a real midnight-crossing
-- restaurant needs it).
-- =============================================================================

alter table public.waitlist_entries
  add column if not exists is_last_minute boolean not null default false;

comment on column public.waitlist_entries.is_last_minute is
  'True for an entry created by join_last_minute_alert (0034) rather than join_public_waitlist (0029/0030). Changes how claim_waitlist_matches_for_restaurant (0030, branched in 0034) checks availability for this row: a FRESH standard-duration slot computed at claim time (now() through now() + the restaurant''s default_reservation_duration_min), not this row''s own requested_time_range, which for a last-minute entry is deliberately wide (now-at-join-time through closing) and used only for bookkeeping/expiry/display -- never as a literal slot to check availability against.';

-- ---------------------------------------------------------------------------
-- join_last_minute_alert: public/anon-callable. Same guest-identity /
-- rate-limit / duplicate-join / audit-log shape as join_public_waitlist
-- (0029/0030), but resolves "now through closing today" itself rather than
-- accepting a desired time, and checks immediate (right-now) availability
-- for one standard-duration slot instead of a caller-specified one.
-- ---------------------------------------------------------------------------
create or replace function public.join_last_minute_alert(
  p_restaurant_slug text,
  p_party_size int,
  p_guest_name text default null,
  p_guest_phone text default null,
  p_guest_email citext default null,
  p_zone_preference_id uuid default null,
  p_push_subscription jsonb default null
)
returns public.waitlist_entries
security definer
set search_path = public
language plpgsql
as $$
declare
  v_restaurant       public.restaurants%rowtype;
  v_customer_id      uuid;
  v_customer_name    text;
  v_customer_phone   text;
  v_customer_email   citext;
  v_local_ts         timestamp;
  v_local_date       date;
  v_local_dow        smallint;
  v_local_time       time;
  v_special          public.special_hours%rowtype;
  v_shift            record;
  v_window_end_local time;
  v_window_end_ts    timestamp;
  v_window_end_tz    timestamptz;
  v_immediate_ends   timestamptz;
  v_recent_count     int;
  v_has_availability boolean;
  v_entry            public.waitlist_entries%rowtype;
begin
  select * into v_restaurant
  from public.restaurants
  where slug = p_restaurant_slug and deleted_at is null and is_active;
  if not found then
    raise exception 'RESTAURANT_NOT_FOUND';
  end if;

  if not public.is_feature_enabled_for_restaurant(p_restaurant_slug, 'last_minute_alerts') then
    raise exception 'FEATURE_DISABLED';
  end if;

  if p_party_size is null or p_party_size < v_restaurant.min_party_size or p_party_size > v_restaurant.max_party_size then
    raise exception 'PARTY_SIZE_OUT_OF_RANGE';
  end if;

  -- Resolve "today, from now until closing" -- same special_hours-then-
  -- opening_hours resolution and same midnight-crossing skip as
  -- get_public_availability_summary (0023); see this migration's header
  -- comment for the accepted limitation that implies.
  v_local_ts   := now() at time zone v_restaurant.timezone;
  v_local_date := v_local_ts::date;
  v_local_dow  := extract(dow from v_local_ts);
  v_local_time := v_local_ts::time;

  select * into v_special from public.special_hours where restaurant_id = v_restaurant.id and date = v_local_date;

  v_window_end_local := null;
  for v_shift in (
    select opens_at, closes_at from (
      select v_special.opens_at as opens_at, v_special.closes_at as closes_at
      where v_special.id is not null and not v_special.is_closed
      union all
      select oh.opens_at, oh.closes_at
      from public.opening_hours oh
      where v_special.id is null and oh.restaurant_id = v_restaurant.id and oh.day_of_week = v_local_dow and not oh.is_closed
    ) shifts
    where opens_at is not null and closes_at is not null
  )
  loop
    continue when v_shift.closes_at <= v_shift.opens_at; -- midnight-crossing shift, skipped (see header comment)
    continue when not (v_local_time >= v_shift.opens_at and v_local_time < v_shift.closes_at); -- not the currently active shift

    v_window_end_local := v_shift.closes_at;
    exit; -- at most one shift can be "currently active" for a given instant
  end loop;

  if v_window_end_local is null then
    raise exception 'RESTAURANT_CLOSED';
  end if;

  -- v_window_end_ts MUST stay a plain `timestamp` (no time zone) up to this
  -- point -- applying `at time zone` to it here interprets it as LOCAL wall-
  -- clock time in the restaurant's zone and converts to UTC correctly, same
  -- as get_public_availability_summary (0023) does for v_cursor_ts. Doing
  -- the two steps in the other order (assigning into a `timestamptz`
  -- variable first, then applying `at time zone` to THAT) silently double-
  -- converts: the first assignment already casts using the session's own
  -- time zone, then `at time zone` shifts a second time -- caught the hard
  -- way in local testing (produced a value 3 hours into the NEXT day for a
  -- UTC+3 restaurant with a UTC session, before this fix).
  v_window_end_ts := v_local_date::timestamp + v_window_end_local;
  v_window_end_tz := v_window_end_ts at time zone v_restaurant.timezone;

  v_immediate_ends := now() + make_interval(mins => v_restaurant.default_reservation_duration_min);
  if v_immediate_ends > v_window_end_tz then
    raise exception 'NO_TIME_REMAINING_TODAY';
  end if;

  select exists (
    select 1 from public.get_available_tables(v_restaurant.id, now(), v_immediate_ends, p_party_size, p_zone_preference_id)
    union all
    select 1 from public.get_available_table_combinations(v_restaurant.id, now(), v_immediate_ends, p_party_size)
  ) into v_has_availability;
  if v_has_availability then
    raise exception 'AVAILABILITY_EXISTS';
  end if;

  if auth.uid() is not null then
    select id, full_name, phone, email into v_customer_id, v_customer_name, v_customer_phone, v_customer_email
    from public.customers where auth_user_id = auth.uid();

    if v_customer_id is null then
      insert into public.customers (auth_user_id, full_name, email, phone)
      values (auth.uid(), p_guest_name, p_guest_email, p_guest_phone)
      returning id into v_customer_id;
    else
      p_guest_name  := coalesce(p_guest_name, v_customer_name);
      p_guest_phone := coalesce(p_guest_phone, v_customer_phone);
      p_guest_email := coalesce(p_guest_email, v_customer_email);
    end if;

    if p_guest_email is null then
      select email into p_guest_email from auth.users where id = auth.uid();
    end if;
  end if;

  if p_guest_name is null or trim(p_guest_name) = '' or (p_guest_phone is null and p_guest_email is null) then
    raise exception 'GUEST_DETAILS_REQUIRED';
  end if;

  select count(*) into v_recent_count
  from public.waitlist_entries
  where restaurant_id = v_restaurant.id
    and created_at > now() - interval '15 minutes'
    and ((p_guest_phone is not null and guest_phone = p_guest_phone) or (p_guest_email is not null and guest_email = p_guest_email));
  if v_recent_count >= 3 then
    raise exception 'RATE_LIMITED';
  end if;

  -- Duplicate-join guard, scoped to is_last_minute = true so a regular
  -- waitlist join for today and a last-minute alert for today are never
  -- mistaken for each other -- they represent different guest intents even
  -- when it's the same person on the same day.
  select * into v_entry
  from public.waitlist_entries
  where restaurant_id = v_restaurant.id
    and status = 'waiting'
    and is_last_minute = true
    and requested_date = v_local_date
    and (
      (v_customer_id is not null and customer_id = v_customer_id)
      or (p_guest_phone is not null and guest_phone = p_guest_phone)
      or (p_guest_email is not null and guest_email = p_guest_email)
    )
  order by created_at desc
  limit 1;
  if found then
    if p_push_subscription is not null then
      update public.waitlist_entries set push_subscription = p_push_subscription where id = v_entry.id
      returning * into v_entry;
    end if;
    return v_entry;
  end if;

  insert into public.waitlist_entries (
    restaurant_id, customer_id, guest_name, guest_phone, guest_email,
    party_size, requested_date, requested_time_range, zone_preference_id, status, push_subscription, is_last_minute
  )
  values (
    v_restaurant.id, v_customer_id, p_guest_name, p_guest_phone, p_guest_email,
    p_party_size, v_local_date, tstzrange(now(), v_window_end_tz, '[)'), p_zone_preference_id, 'waiting', p_push_subscription, true
  )
  returning * into v_entry;

  insert into public.audit_logs (restaurant_id, actor_type, actor_user_id, action, entity_type, entity_id, after_data)
  values (
    v_restaurant.id,
    (case when auth.uid() is not null then 'user' else 'system' end)::public.audit_actor_type,
    auth.uid(),
    'waitlist.joined_last_minute',
    'waitlist_entry',
    v_entry.id,
    jsonb_build_object('party_size', p_party_size, 'window_ends_at', v_window_end_tz, 'has_push_subscription', p_push_subscription is not null)
  );

  return v_entry;
end;
$$;

grant execute on function public.join_last_minute_alert(text, int, text, text, citext, uuid, jsonb) to anon, authenticated;

comment on function public.join_last_minute_alert is
  'Public/anon-callable entry point for "notify me if anything opens up today" (Phase 6, last_minute_alerts flag, 0034). Inserts into the SAME waitlist_entries table as join_public_waitlist (0029), with is_last_minute = true -- so it is picked up by the same claim_waitlist_matches_for_restaurant / push pipeline (0030, branched in this migration) and visible on the same existing staff waitlist screen. Resolves "now through closing today" itself instead of taking a desired time from the caller; see this migration''s header comment for two documented limitations (booking_window_min_hours not enforced here, and midnight-crossing shifts not supported).

Note: last_minute_alerts.is_owner_configurable is still false after this migration, same as waitlist_public was before 0033 -- a future migration flips it once this is verified live, per that migration''s own pattern.';

-- ---------------------------------------------------------------------------
-- claim_waitlist_matches_for_restaurant: CREATE OR REPLACE with the SAME
-- signature and return shape as 0030 -- an is_last_minute branch is added
-- to the availability check and to the returned slot times; the
-- non-last-minute path below is unchanged, byte for byte, from 0030.
-- ---------------------------------------------------------------------------
create or replace function public.claim_waitlist_matches_for_restaurant(p_restaurant_id uuid)
returns table (
  entry_id uuid,
  push_subscription jsonb,
  party_size int,
  guest_name text,
  slot_starts_at timestamptz,
  slot_ends_at timestamptz
)
security definer
set search_path = public
language plpgsql
as $$
declare
  v_duration_min int;
begin
  select default_reservation_duration_min into v_duration_min
  from public.restaurants where id = p_restaurant_id;

  return query
  update public.waitlist_entries w
  set status = 'notified',
      notified_at = now(),
      push_sent_at = now()
  from (
    select we.id
    from public.waitlist_entries we
    where we.restaurant_id = p_restaurant_id
      and we.status = 'waiting'
      and we.push_subscription is not null
      and we.push_sent_at is null
      -- A last-minute entry expires once we're past the closing time it was
      -- created against (upper(requested_time_range), see join_last_minute_alert)
      -- -- a regular entry's own desired slot can be in the past too without
      -- ever having been claimed, but changing that path is out of scope
      -- here (see this migration's header comment on regression safety).
      and (not we.is_last_minute or now() < upper(we.requested_time_range))
      and (
        case when we.is_last_minute then
          exists (
            select 1 from public.get_available_tables(
              p_restaurant_id, now(), now() + make_interval(mins => v_duration_min), we.party_size, we.zone_preference_id
            )
          )
          or exists (
            select 1 from public.get_available_table_combinations(
              p_restaurant_id, now(), now() + make_interval(mins => v_duration_min), we.party_size
            )
          )
        else
          exists (
            select 1 from public.get_available_tables(
              p_restaurant_id, lower(we.requested_time_range), upper(we.requested_time_range), we.party_size, we.zone_preference_id
            )
          )
          or exists (
            select 1 from public.get_available_table_combinations(
              p_restaurant_id, lower(we.requested_time_range), upper(we.requested_time_range), we.party_size
            )
          )
        end
      )
    for update of we skip locked
  ) matched
  where w.id = matched.id
  returning
    w.id,
    w.push_subscription,
    w.party_size,
    w.guest_name,
    case when w.is_last_minute then now() else lower(w.requested_time_range) end,
    case when w.is_last_minute then now() + make_interval(mins => v_duration_min) else upper(w.requested_time_range) end;
end;
$$;

comment on function public.claim_waitlist_matches_for_restaurant is
  'Internal only, service-role-only -- NOT granted to anon/authenticated, and PUBLIC EXECUTE explicitly revoked by 0030 (CREATE OR REPLACE here keeps that same revoke in effect, since it only replaces the function body, not its grants). Called by the notify-waitlist Edge Function whenever a restaurant''s availability heartbeat (restaurant_availability_versions, 0025) changes. Atomically finds every ''waiting'', push-subscribed, not-yet-claimed entry that NOW has a real match, and marks it ''notified'' in the same statement (FOR UPDATE SKIP LOCKED) so two near-simultaneous triggers can never double-claim (and therefore double-push) the same entry. Branched by is_last_minute (0034): a last-minute entry is matched against a FRESH standard-duration slot computed at claim time (now() through now() + default_reservation_duration_min), not its own (deliberately wide) stored range, and the returned slot_starts_at/slot_ends_at reflect that actual matched slot, not the stored range -- a regular entry''s behavior is byte-for-byte unchanged from 0030.';
