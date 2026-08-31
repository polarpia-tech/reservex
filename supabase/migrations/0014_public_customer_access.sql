-- =============================================================================
-- 0014_public_customer_access.sql
-- Purpose: Phase 08 -- the public, unauthenticated side of the platform:
-- browsing a restaurant's page, booking a table with no staff account at
-- all, and (optionally) a lightweight customer account for booking history
-- and self-service cancellation. Four things happen here:
--
--   1. A real security fix to the Phase 02 `customers` RLS policies, found
--      while building this phase's account signup flow (see below).
--   2. New PUBLIC read policies for the handful of tables a restaurant's
--      public page and the booking flow actually need to see.
--   3. is_restaurant_open_at(): a reusable, publicly-callable function that
--      answers "is this restaurant open at this instant", correctly, using
--      Postgres's own native IANA timezone support -- not hand-rolled
--      timezone math in application code.
--   4. book_public_reservation(): the single public entry point for an
--      anonymous (or logged-in customer) booking. SECURITY DEFINER, reachable
--      directly by the `anon` role over PostgREST -- see the long comment on
--      that function for why this is safe and why it replaces the Edge
--      Function this exact use case was pointed at in 0011's and 0013's
--      comments.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Security fix: `customers_insert` / `customers_update` (0011) let ANY
-- authenticated user set `auth_user_id` to ANY value, including someone
-- else's -- the policies only checked `auth.uid() is not null`, never that
-- the row being written actually claims the CALLER's own identity. Found
-- while wiring up customer self-signup (which self-inserts a customers row)
-- for this phase; fixing it here rather than silently building on top of a
-- gap, per the project's "must be tested, not assumed" security rule.
-- ---------------------------------------------------------------------------
drop policy if exists customers_insert on public.customers;
create policy customers_insert on public.customers for insert
  with check (auth.uid() is not null and (auth_user_id is null or auth_user_id = auth.uid()));

drop policy if exists customers_update on public.customers;
create policy customers_update on public.customers for update
  using (owns_customer(id))
  with check (owns_customer(id) and (auth_user_id is null or auth_user_id = auth.uid()));

comment on policy customers_insert on public.customers is
  'A signed-in user may create a customers row for THEMSELVES only -- auth_user_id must be null or their own uid. Fixed in 0014 after the original 0011 check only required "any signed-in user", which allowed claiming someone elses auth_user_id.';
comment on policy customers_update on public.customers is
  'Fixed in 0014 alongside customers_insert: a customer may still update their own row (name/phone/email/locale/marketing_opt_in), but may not reassign auth_user_id away from themselves.';

-- ---------------------------------------------------------------------------
-- 2. Public read access. Deliberately narrow: only the tables a public
-- restaurant page and the booking flow need to DISPLAY. Floor plan detail
-- (table_zones, tables, table_combinations, reservation_tables) stays
-- staff-only, as before -- a customer never needs to see individual tables
-- or other guests' booking patterns, and the actual availability check runs
-- inside book_public_reservation() below (SECURITY DEFINER), which does not
-- need the CALLER to have read access to those tables itself.
-- ---------------------------------------------------------------------------
create policy restaurants_public_select on public.restaurants for select
  using (deleted_at is null and is_active);

create policy opening_hours_public_select on public.opening_hours for select
  using (exists (
    select 1 from public.restaurants r
    where r.id = opening_hours.restaurant_id and r.deleted_at is null and r.is_active
  ));

create policy special_hours_public_select on public.special_hours for select
  using (exists (
    select 1 from public.restaurants r
    where r.id = special_hours.restaurant_id and r.deleted_at is null and r.is_active
  ));

comment on policy restaurants_public_select on public.restaurants is
  'Phase 08: anyone (anon included) may read an active restaurant''s public profile. OR''d with restaurants_select (0011), which still covers staff reading their own restaurant even while inactive.';

-- ---------------------------------------------------------------------------
-- 3. Customer self-service cancellation. Narrowly scoped: a customer may
-- move THEIR OWN, still-cancellable reservation to 'cancelled' and nothing
-- else -- not to any other status, and not a reservation they don't own or
-- one that's already in a terminal state. Known, accepted residual gap
-- (documented in the Phase 08 README): RLS checks the resulting ROW, not
-- which COLUMNS changed, so a customer could in principle also change e.g.
-- party_size in the same UPDATE as long as status ends up 'cancelled' --
-- low-risk since a cancelled reservation no longer blocks a table or does
-- anything with its other fields.
-- ---------------------------------------------------------------------------
create policy reservations_customer_cancel on public.reservations for update
  using (
    customer_id is not null
    and owns_customer(customer_id)
    and status not in ('completed', 'cancelled', 'no_show')
  )
  with check (
    customer_id is not null
    and owns_customer(customer_id)
    and status = 'cancelled'
  );

-- ---------------------------------------------------------------------------
-- is_restaurant_open_at: local wall-clock day-of-week/time-of-day for
-- p_instant, computed via Postgres's own `AT TIME ZONE` (correct for every
-- IANA zone, including DST) -- not re-implemented in application code.
-- special_hours for that local date wins outright if present; otherwise any
-- matching opening_hours shift for that day counts, including a shift that
-- started the PREVIOUS local day and crosses midnight (closes_at <=
-- opens_at, per 0004's documented convention).
-- SECURITY INVOKER on purpose: opening_hours/special_hours are now publicly
-- readable (see above), so there is no privilege boundary to cross here.
-- ---------------------------------------------------------------------------
create or replace function public.is_restaurant_open_at(p_restaurant_id uuid, p_instant timestamptz)
returns boolean
language plpgsql
stable
as $$
declare
  v_tz          text;
  v_local_ts    timestamp;
  v_local_date  date;
  v_local_dow   smallint;
  v_local_time  time;
  v_special     public.special_hours%rowtype;
begin
  select timezone into v_tz from public.restaurants where id = p_restaurant_id and deleted_at is null and is_active;
  if not found then
    return false;
  end if;

  v_local_ts   := p_instant at time zone v_tz;
  v_local_date := v_local_ts::date;
  v_local_dow  := extract(dow from v_local_ts);
  v_local_time := v_local_ts::time;

  select * into v_special from public.special_hours where restaurant_id = p_restaurant_id and date = v_local_date;
  if found then
    if v_special.is_closed or v_special.opens_at is null or v_special.closes_at is null then
      return false;
    end if;
    if v_special.closes_at > v_special.opens_at then
      return v_local_time >= v_special.opens_at and v_local_time < v_special.closes_at;
    else
      return v_local_time >= v_special.opens_at; -- crosses midnight; the "next morning" continuation is handled by tomorrow's own special_hours row, not here
    end if;
  end if;

  return exists (
    -- Shift starts today (same-day, or crosses into tomorrow).
    select 1 from public.opening_hours oh
    where oh.restaurant_id = p_restaurant_id and oh.day_of_week = v_local_dow and not oh.is_closed
      and (
        (oh.closes_at > oh.opens_at and v_local_time >= oh.opens_at and v_local_time < oh.closes_at)
        or (oh.closes_at <= oh.opens_at and v_local_time >= oh.opens_at)
      )
  ) or exists (
    -- Shift started YESTERDAY and crossed midnight into this morning.
    select 1 from public.opening_hours oh
    where oh.restaurant_id = p_restaurant_id and oh.day_of_week = ((v_local_dow + 6) % 7) and not oh.is_closed
      and oh.closes_at <= oh.opens_at and v_local_time < oh.closes_at
  );
end;
$$;

grant execute on function public.is_restaurant_open_at(uuid, timestamptz) to anon, authenticated;

comment on function public.is_restaurant_open_at is
  'Is this restaurant open at this UTC instant, in ITS OWN local timezone? Checks special_hours override first, then opening_hours (including a shift that crosses midnight from the previous day). Public/anon-callable -- used by book_public_reservation and available for a website "open now" indicator.';

-- ---------------------------------------------------------------------------
-- book_public_reservation: the ONE public entry point for a booking made
-- with no staff session -- an anonymous guest, or a signed-in customer.
--
-- Why a SECURITY DEFINER SQL function instead of an Edge Function (which is
-- what 0011's and 0013's comments originally pointed this at): the actual
-- reason an Edge Function was assumed necessary was "an anonymous caller
-- has no RLS identity that could pass reservations_staff_write". That's
-- still true, but the fix doesn't need a whole separate Deno service with
-- its own service-role key and CORS config -- a SECURITY DEFINER function
-- solves exactly the same problem inside Postgres: it runs as its OWNER
-- (which, like every function in this schema, effectively bypasses RLS the
-- same way a service-role client would), and it re-implements every check a
-- trusted caller would need to pass, in one place, in the same language and
-- transaction as the actual booking logic. It then calls the EXISTING,
-- already-verified book_reservation() (0013) for the actual allocation +
-- insert -- that inner call also runs with the definer's bypass-RLS
-- privileges (a SECURITY INVOKER function called from inside a SECURITY
-- DEFINER one runs as whoever the CURRENT role is at that point, which is
-- already the definer's owner) -- so there is exactly one implementation of
-- "hold a table for a reservation", reused by staff, and now by the public.
--
-- Because this function is reachable directly by the `anon` role with no
-- session at all, it is the single most security-sensitive piece of code
-- in the whole project so far, and everything it does is either a genuine
-- validation this input needs, or a direct re-use of an already-tested
-- function -- nothing here bypasses a check "for convenience".
--
-- Rate limiting: a full IP/network-level limiter is NOT implemented here
-- (that belongs at the Supabase/CDN/WAF layer, not in application SQL) --
-- documented as a known gap in the Phase 08 README, to close before a real
-- production launch. What IS implemented is a narrow, real abuse guard: no
-- more than 3 web-sourced reservations from the same phone/email in a
-- rolling 15-minute window, restaurant-wide.
-- ---------------------------------------------------------------------------
create or replace function public.book_public_reservation(
  p_restaurant_slug text,
  p_starts_at timestamptz,
  p_party_size int,
  p_guest_name text default null,
  p_guest_phone text default null,
  p_guest_email citext default null,
  p_special_requests text default null
)
returns public.reservations
security definer
set search_path = public
language plpgsql
as $$
declare
  v_restaurant      public.restaurants%rowtype;
  v_customer_id     uuid;
  v_customer_name   text;
  v_customer_phone  text;
  v_customer_email  citext;
  v_ends_at         timestamptz;
  v_recent_count    int;
  v_reservation     public.reservations%rowtype;
begin
  select * into v_restaurant
  from public.restaurants
  where slug = p_restaurant_slug and deleted_at is null and is_active;
  if not found then
    raise exception 'RESTAURANT_NOT_FOUND';
  end if;

  if p_party_size is null or p_party_size < v_restaurant.min_party_size or p_party_size > v_restaurant.max_party_size then
    raise exception 'PARTY_SIZE_OUT_OF_RANGE';
  end if;

  if p_starts_at < now() + make_interval(hours => v_restaurant.booking_window_min_hours)
     or p_starts_at > now() + make_interval(days => v_restaurant.booking_window_max_days) then
    raise exception 'OUTSIDE_BOOKING_WINDOW';
  end if;

  if not public.is_restaurant_open_at(v_restaurant.id, p_starts_at) then
    raise exception 'RESTAURANT_CLOSED';
  end if;

  -- Identity: a signed-in customer's own profile fills in whatever the
  -- guest fields didn't provide (falling back to their verified auth email
  -- if even their customer profile has none yet); an anonymous guest must
  -- supply enough to be reachable. Note this is intentionally a STRICTER
  -- rule than the `reservations` table's own CHECK constraint (which is
  -- already satisfied by customer_id alone) -- a host still needs a name to
  -- call out at the stand, whoever is booking.
  if auth.uid() is not null then
    select id, full_name, phone, email into v_customer_id, v_customer_name, v_customer_phone, v_customer_email
    from public.customers where auth_user_id = auth.uid();

    if v_customer_id is null then
      -- Lazily create it here too (belt-and-braces alongside the web app's
      -- own signup flow): auth.uid() is the verified caller, not a
      -- client-supplied value, so there is no spoofing risk in creating it
      -- on their behalf.
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
  from public.reservations
  where source = 'web'
    and created_at > now() - interval '15 minutes'
    and ((p_guest_phone is not null and guest_phone = p_guest_phone) or (p_guest_email is not null and guest_email = p_guest_email));
  if v_recent_count >= 3 then
    raise exception 'RATE_LIMITED';
  end if;

  v_ends_at := p_starts_at + make_interval(mins => v_restaurant.default_reservation_duration_min);

  v_reservation := public.book_reservation(
    p_restaurant_id      => v_restaurant.id,
    p_starts_at          => p_starts_at,
    p_ends_at            => v_ends_at,
    p_party_size         => p_party_size,
    p_source             => 'web',
    p_customer_id        => v_customer_id,
    p_guest_name         => p_guest_name,
    p_guest_phone        => p_guest_phone,
    p_guest_email        => p_guest_email,
    p_special_requests   => p_special_requests
  );

  insert into public.audit_logs (restaurant_id, actor_type, actor_user_id, action, entity_type, entity_id, after_data)
  values (
    v_restaurant.id,
    (case when auth.uid() is not null then 'user' else 'system' end)::public.audit_actor_type,
    auth.uid(),
    'reservation.created_public',
    'reservation',
    v_reservation.id,
    jsonb_build_object('party_size', p_party_size, 'starts_at', p_starts_at, 'source', 'web')
  );

  return v_reservation;
end;
$$;

grant execute on function public.book_public_reservation(text, timestamptz, int, text, text, citext, text) to anon, authenticated;

comment on function public.book_public_reservation is
  'The public booking entry point -- callable with no staff session at all. SECURITY DEFINER: re-validates restaurant/party-size/booking-window/opening-hours/guest-identity/basic-abuse-rate itself, then delegates the actual allocation + EXCLUDE-constraint-guarded insert to the existing book_reservation() (0013). See the full comment above for why this replaces the Edge Function earlier phases assumed this would need.';
