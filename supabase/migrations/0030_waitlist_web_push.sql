-- =============================================================================
-- 0030_waitlist_web_push.sql
-- Purpose: Phase 6, Part 2b of "Live Availability, Smart Booking & Real-Time
-- Restaurant Experience" -- the notify-when-a-table-opens-up half of the
-- self-service waitlist (0029). No account required: the browser's Web
-- Push subscription itself IS the identity a notification is addressed to,
-- exactly like a phone number would be for an SMS -- so this works equally
-- for a signed-in customer and a fully anonymous guest, per the product
-- decision to support both.
--
-- Three things:
--   1. waitlist_entries.push_subscription / push_sent_at -- where a joining
--      browser's Web Push subscription (the standard {endpoint, keys:
--      {p256dh, auth}} object every browser's Push API returns) is stored.
--      Tied to the ENTRY, not to a customer account or a new subscriptions
--      table -- an anonymous guest has no account to tie it to, and one
--      waitlist join is exactly the granularity a notification makes sense
--      at (see the migration comment on join_public_waitlist below for the
--      re-tap/refresh behaviour).
--   2. join_public_waitlist() gains one new optional parameter to accept
--      the subscription at join time (or update it on a dedupe re-tap, in
--      case the browser generated a new one since the guest last tapped
--      "join").
--   3. claim_waitlist_matches_for_restaurant() -- the ONE new piece of real
--      logic. NOT reachable by anon/authenticated at all: this is called
--      exclusively by the notify-waitlist Edge Function using the service
--      role key, which already bypasses RLS entirely -- wrapping it in a
--      SECURITY DEFINER function anyway (rather than the Edge Function
--      doing several raw table queries) keeps "does this waitlist entry now
--      have a real match" as ONE tested piece of SQL, not reimplemented
--      Deno-side, following this codebase's standing "one implementation,
--      reused" rule. Atomically finds every 'waiting' entry for a
--      restaurant that (a) has a push subscription and hasn't been notified
--      yet, and (b) NOW has a real, available table for its exact desired
--      slot (reusing get_available_tables/get_available_table_combinations,
--      0013 -- the same functions the booking engine itself trusts), and
--      marks each one 'notified' in the same statement that selects it, so
--      two near-simultaneous triggers for the same restaurant can never
--      both claim (and therefore double-push) the same entry.
--
--      HONESTY NOTE, in the same spirit as stripe-webhook's own header
--      comment (0019): this function is exercised by
--      scripts/verify_phase_waitlist_push.sql against real local data, but
--      the actual HTTPS delivery of a push message to a real browser is
--      NOT something this migration or that script can verify -- that only
--      happens once the notify-waitlist Edge Function is deployed and a
--      real browser subscribes. A known, accepted residual gap: if the
--      actual push delivery fails after this function has already marked
--      an entry 'notified' (e.g. the subscription expired), that guest is
--      never actually notified, but the row still reads 'notified' -- staff
--      can still see and act on any waiting/notified entry from the
--      existing waitlist screen regardless.
-- =============================================================================

alter table public.waitlist_entries
  add column if not exists push_subscription jsonb,
  add column if not exists push_sent_at timestamptz;

comment on column public.waitlist_entries.push_subscription is
  'The joining browser''s Web Push subscription ({endpoint, keys: {p256dh, auth}}), captured at join time by join_public_waitlist (0030). Null for every staff-created entry, and for a public join where the guest declined the browser''s notification permission prompt -- in both cases this entry simply never becomes a candidate for claim_waitlist_matches_for_restaurant.';

comment on column public.waitlist_entries.push_sent_at is
  'Set the moment claim_waitlist_matches_for_restaurant (0030) claims this entry for notification -- alongside status becoming ''notified''. Never reset; a re-tap of join_public_waitlist while still ''waiting'' can refresh push_subscription itself, but this column is untouched by that (it only means "the entry has never been claimed").';

-- ---------------------------------------------------------------------------
-- join_public_waitlist: add p_push_subscription. Postgres identifies a
-- function by name AND argument list, so adding an 8th parameter does NOT
-- replace the 7-argument version from 0029 -- it would silently create a
-- SECOND overload, leaving both reachable (and ambiguous to PostgREST's
-- RPC dispatch, which resolves by argument names in the request body).
-- The old signature is dropped explicitly first so exactly one version of
-- this function ever exists, same as 0028 dropping a superseded policy
-- before creating its replacement (see that migration's header comment).
-- Every existing caller that omits the new argument is unaffected: it
-- defaults to null, same as if Part 2b didn't exist yet.
-- ---------------------------------------------------------------------------
drop function if exists public.join_public_waitlist(text, timestamptz, int, text, text, citext, uuid);

create or replace function public.join_public_waitlist(
  p_restaurant_slug text,
  p_desired_starts_at timestamptz,
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
  v_ends_at          timestamptz;
  v_requested_date   date;
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

  if not public.is_feature_enabled_for_restaurant(p_restaurant_slug, 'waitlist_public') then
    raise exception 'FEATURE_DISABLED';
  end if;

  if p_party_size is null or p_party_size < v_restaurant.min_party_size or p_party_size > v_restaurant.max_party_size then
    raise exception 'PARTY_SIZE_OUT_OF_RANGE';
  end if;

  if p_desired_starts_at < now() + make_interval(hours => v_restaurant.booking_window_min_hours)
     or p_desired_starts_at > now() + make_interval(days => v_restaurant.booking_window_max_days) then
    raise exception 'OUTSIDE_BOOKING_WINDOW';
  end if;

  if not public.is_restaurant_open_at(v_restaurant.id, p_desired_starts_at) then
    raise exception 'RESTAURANT_CLOSED';
  end if;

  v_ends_at := p_desired_starts_at + make_interval(mins => v_restaurant.default_reservation_duration_min);
  v_requested_date := (p_desired_starts_at at time zone v_restaurant.timezone)::date;

  select exists (
    select 1 from public.get_available_tables(v_restaurant.id, p_desired_starts_at, v_ends_at, p_party_size, p_zone_preference_id)
    union all
    select 1 from public.get_available_table_combinations(v_restaurant.id, p_desired_starts_at, v_ends_at, p_party_size)
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

  -- Duplicate-join guard: same identity, same restaurant, same local date,
  -- still waiting -- refresh the push subscription (the browser may have
  -- generated a new one since the first tap) and return the same row,
  -- rather than creating a second one.
  select * into v_entry
  from public.waitlist_entries
  where restaurant_id = v_restaurant.id
    and status = 'waiting'
    and requested_date = v_requested_date
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
    party_size, requested_date, requested_time_range, zone_preference_id, status, push_subscription
  )
  values (
    v_restaurant.id, v_customer_id, p_guest_name, p_guest_phone, p_guest_email,
    p_party_size, v_requested_date, tstzrange(p_desired_starts_at, v_ends_at, '[)'), p_zone_preference_id, 'waiting', p_push_subscription
  )
  returning * into v_entry;

  insert into public.audit_logs (restaurant_id, actor_type, actor_user_id, action, entity_type, entity_id, after_data)
  values (
    v_restaurant.id,
    (case when auth.uid() is not null then 'user' else 'system' end)::public.audit_actor_type,
    auth.uid(),
    'waitlist.joined_public',
    'waitlist_entry',
    v_entry.id,
    jsonb_build_object('party_size', p_party_size, 'desired_starts_at', p_desired_starts_at, 'has_push_subscription', p_push_subscription is not null)
  );

  return v_entry;
end;
$$;

grant execute on function public.join_public_waitlist(text, timestamptz, int, text, text, citext, uuid, jsonb) to anon, authenticated;

comment on function public.join_public_waitlist is
  'Public/anon-callable entry point for self-service waitlist join -- inserts into the SAME waitlist_entries table staff already read/write (0006/0011), so the existing staff waitlist screen needs no changes. SECURITY DEFINER: re-validates restaurant/flag-enabled/party-size/booking-window/opening-hours/guest-identity/abuse-rate itself, and additionally REJECTS the join if a table is actually available right now (AVAILABILITY_EXISTS) or returns the caller''s existing row if they already have one waiting for this restaurant+date (idempotent re-tap, and refreshes push_subscription on that path -- 0030). See this migration''s header comment for the full reasoning.

Note: waitlist_public.is_owner_configurable is still false after this migration -- see 0029''s header comment, point 3, and 0030''s own header comment.';

-- ---------------------------------------------------------------------------
-- claim_waitlist_matches_for_restaurant: internal-only (no anon/authenticated
-- grant -- callable only via the service role, i.e. only from the
-- notify-waitlist Edge Function). See this migration's header comment for
-- the full reasoning, including the accepted residual gap around a push
-- send that fails after an entry is already marked 'notified'.
--
-- Explicit `revoke all ... from public` BELOW the function, same
-- revoke-then-(no)grant pattern 0021's "security hardening" section uses
-- throughout: Postgres grants EXECUTE on a newly created function to PUBLIC
-- by default, which would otherwise make this callable by anon/authenticated
-- too despite there being no explicit grant for either -- confirmed the hard
-- way, exactly like several of 0021's functions were, by testing
-- has_function_privilege('anon', ...) locally before this revoke was added
-- and finding it TRUE. Never assume "no grant statement" means "no access".
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
begin
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
      and (
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
      )
    for update of we skip locked
  ) matched
  where w.id = matched.id
  returning w.id, w.push_subscription, w.party_size, w.guest_name, lower(w.requested_time_range), upper(w.requested_time_range);
end;
$$;

revoke all on function public.claim_waitlist_matches_for_restaurant(uuid) from public;

comment on function public.claim_waitlist_matches_for_restaurant is
  'Internal only, service-role-only -- NOT granted to anon/authenticated, and PUBLIC EXECUTE explicitly revoked (Postgres''s own default for a newly created function, see this migration''s comment above the function). Called by the notify-waitlist Edge Function whenever a restaurant''s availability heartbeat (restaurant_availability_versions, 0025) changes. Atomically finds every ''waiting'', push-subscribed, not-yet-claimed entry whose exact desired slot is NOW available, and marks it ''notified'' in the same statement (FOR UPDATE SKIP LOCKED) so two near-simultaneous triggers can never double-claim (and therefore double-push) the same entry. Returns exactly what the Edge Function needs to actually send the push -- nothing else.';
