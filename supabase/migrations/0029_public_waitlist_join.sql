-- =============================================================================
-- 0029_public_waitlist_join.sql
-- Purpose: Phase 6, Part 2a of "Live Availability, Smart Booking & Real-Time
-- Restaurant Experience" -- the SELF-SERVICE half of the `waitlist_public`
-- flag (seeded, but inert, in 0023: "Let customers join the waitlist
-- themselves from the public restaurant page, with no staff involved.").
--
-- A full STAFF-facing waitlist already existed before this migration
-- (waitlist_entries / waitlist_status, 0006; RLS in 0011: waitlist_select,
-- waitlist_staff_write). This migration does NOT create a second, parallel
-- waitlist table -- it gives an ANONYMOUS (or signed-in) visitor exactly one
-- new, narrow way to insert a row into that SAME table, so a restaurant's
-- existing staff waitlist screen (apps/mobile/app/(tabs)/reservations/
-- waitlist/*) picks up a public join with zero changes of its own. Same
-- "one implementation, reused" reasoning as book_public_reservation (0014)
-- reusing book_reservation (0013).
--
-- Three things:
--   1. waitlist_entries.guest_email -- the existing table only had
--      guest_name/guest_phone (it was only ever written by staff, who always
--      have a phone number to hand). A public, anonymous joiner needs the
--      same "phone OR email" identity rule book_public_reservation already
--      enforces (some visitors only want to give an email) -- so this column
--      is added here, purely additive, staff-write paths are unaffected.
--   2. join_public_waitlist() -- the public entry point. SECURITY DEFINER,
--      reachable directly by `anon`, same security posture and reasoning as
--      book_public_reservation (0014) -- see that migration's long comment
--      for why a SECURITY DEFINER SQL function, not an Edge Function. Every
--      check below is either a genuine validation this input needs, or a
--      direct re-use of an already-tested function (is_restaurant_open_at,
--      get_available_tables, get_available_table_combinations).
--
--      One check here has NO equivalent in book_public_reservation: this
--      function REJECTS the join with AVAILABILITY_EXISTS if a table (or
--      combination) is actually free for the requested slot right now. A
--      waitlist is for when the restaurant is genuinely full -- accepting a
--      join anyway would let a lazy or broken client silently degrade a
--      bookable guest into a merely-waiting one. The public page is expected
--      to only ever show the "join waitlist" affordance once its own
--      availability check has already come back empty (Part 2c), but the
--      server never trusts that alone.
--
--      Also new (no equivalent in book_public_reservation): a duplicate-join
--      guard. A guest re-tapping "join waitlist" (impatience, a flaky
--      connection, a double-tap) must not silently pile up N identical
--      'waiting' rows for the same restaurant/date/identity -- that would
--      both look like N separate parties to staff and, once Part 2b's push
--      matching exists, fire N separate notifications for one person.
--   3. is_owner_configurable is DELIBERATELY NOT set for waitlist_public in
--      this migration -- unlike 0028's live_availability, this phase isn't
--      finished yet: join_public_waitlist() exists, but nothing on the
--      public web page can call it (Part 2c) and no one is notified when a
--      table frees up (Part 2b) -- see 0028's own header comment, point 1,
--      for exactly why "flip is_owner_configurable only once the feature it
--      gates actually has real behavior wired up" is the rule, not a one-off.
--      Turning the owner toggle on now would show a restaurant owner a
--      working-looking switch for a feature their guests cannot actually
--      use yet. The i18n label/description keys for this flag ARE added
--      alongside this migration (see packages/i18n's own commit) so that
--      whichever later migration finally flips is_owner_configurable only
--      has to change the one column -- the toggle screen's translations are
--      already in place and ready.
-- =============================================================================

alter table public.waitlist_entries
  add column if not exists guest_email citext;

comment on column public.waitlist_entries.guest_email is
  'Added in 0029 for the public self-service join path (join_public_waitlist), which -- like book_public_reservation -- accepts phone OR email as the guest''s contact identity. Null for every pre-existing, staff-created row.';

-- ---------------------------------------------------------------------------
-- join_public_waitlist: the public entry point for a customer adding
-- themselves to a restaurant's waitlist -- an anonymous guest, or a
-- signed-in customer. Mirrors book_public_reservation (0014) closely on
-- purpose: same identity-resolution block, same abuse-rate shape, same
-- "re-validate everything server-side" posture.
-- ---------------------------------------------------------------------------
create or replace function public.join_public_waitlist(
  p_restaurant_slug text,
  p_desired_starts_at timestamptz,
  p_party_size int,
  p_guest_name text default null,
  p_guest_phone text default null,
  p_guest_email citext default null,
  p_zone_preference_id uuid default null
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

  -- A table (or combination) is genuinely free right now -- the visitor
  -- should book directly, not wait for one. See this migration's header
  -- comment for why this is enforced here, not left to the client alone.
  select exists (
    select 1 from public.get_available_tables(v_restaurant.id, p_desired_starts_at, v_ends_at, p_party_size, p_zone_preference_id)
    union all
    select 1 from public.get_available_table_combinations(v_restaurant.id, p_desired_starts_at, v_ends_at, p_party_size)
  ) into v_has_availability;
  if v_has_availability then
    raise exception 'AVAILABILITY_EXISTS';
  end if;

  -- Identity resolution: identical shape to book_public_reservation (0014).
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

  -- Abuse guard: same 3-in-15-minutes shape as book_public_reservation,
  -- scoped to this restaurant's waitlist instead of platform-wide bookings.
  select count(*) into v_recent_count
  from public.waitlist_entries
  where restaurant_id = v_restaurant.id
    and created_at > now() - interval '15 minutes'
    and ((p_guest_phone is not null and guest_phone = p_guest_phone) or (p_guest_email is not null and guest_email = p_guest_email));
  if v_recent_count >= 3 then
    raise exception 'RATE_LIMITED';
  end if;

  -- Duplicate-join guard: this exact identity is already waiting for this
  -- restaurant on this same local date -- return the existing row instead
  -- of creating a second one.
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
    return v_entry;
  end if;

  insert into public.waitlist_entries (
    restaurant_id, customer_id, guest_name, guest_phone, guest_email,
    party_size, requested_date, requested_time_range, zone_preference_id, status
  )
  values (
    v_restaurant.id, v_customer_id, p_guest_name, p_guest_phone, p_guest_email,
    p_party_size, v_requested_date, tstzrange(p_desired_starts_at, v_ends_at, '[)'), p_zone_preference_id, 'waiting'
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
    jsonb_build_object('party_size', p_party_size, 'desired_starts_at', p_desired_starts_at)
  );

  return v_entry;
end;
$$;

grant execute on function public.join_public_waitlist(text, timestamptz, int, text, text, citext, uuid) to anon, authenticated;

comment on function public.join_public_waitlist is
  'Public/anon-callable entry point for self-service waitlist join -- inserts into the SAME waitlist_entries table staff already read/write (0006/0011), so the existing staff waitlist screen needs no changes. SECURITY DEFINER: re-validates restaurant/flag-enabled/party-size/booking-window/opening-hours/guest-identity/abuse-rate itself, and additionally REJECTS the join if a table is actually available right now (AVAILABILITY_EXISTS) or returns the caller''s existing row if they already have one waiting for this restaurant+date (idempotent re-tap). See this migration''s header comment for the full reasoning.

Note: waitlist_public.is_owner_configurable is still false after this migration -- see the header comment, point 3. This function is real and independently callable (e.g. for testing), but no owner can turn the flag on from the app yet, and even once one does, nothing on the public page offers a "join waitlist" affordance until Part 2c ships.';
