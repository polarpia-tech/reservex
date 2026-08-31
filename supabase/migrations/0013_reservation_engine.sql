-- =============================================================================
-- 0013_reservation_engine.sql
-- Purpose: Phase 07 -- the deterministic reservation engine. Three pieces:
--   1. get_available_tables / get_available_table_combinations: read-only
--      availability lookups a client can call directly to show a host what's
--      free before they commit to anything.
--   2. book_reservation: the single, atomic entry point that actually
--      creates or reschedules a reservation. "Atomic" here means literally
--      one Postgres function call = one transaction, so the read (what's
--      free) and the write (hold it) can never be split by a concurrent
--      request sneaking in between them.
--   3. reservations_set_status_timestamps: a small trigger so confirmed_at /
--      seated_at / completed_at / cancelled_at / no_show_marked_at are set
--      automatically the moment `status` changes, instead of every caller
--      having to remember to set them by hand.
--
-- All of this is plain, deterministic business logic -- SQL and plpgsql, no
-- AI involved. Per the project's standing architecture principle, a future
-- AI assistant (chat/voice) will call these exact same functions a human
-- host uses from the app; it never gets a private, unaudited path around
-- them. Every function here is SECURITY INVOKER (the default -- notably NOT
-- SECURITY DEFINER like 0012's get_restaurant_staff), so normal RLS applies
-- to every read and write it performs, using the CALLING user's own
-- permissions. That is what makes multi-tenant isolation hold here for
-- free: a host at restaurant A simply cannot make this function touch
-- restaurant B's tables or reservations, because the same RLS policies from
-- 0011 that protect a plain client-side query also protect every statement
-- inside these functions.
--
-- The customer-facing, unauthenticated booking flow mentioned in 0011's
-- comment above the reservations RLS policies (a public widget with no
-- staff session) is NOT built here -- it needs its own Edge Function running
-- as the service role, since an anonymous visitor has no RLS identity to
-- invoke book_reservation as. That's Phase 08 (Customer Experience). This
-- phase covers STAFF creating/managing reservations from the app.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- get_available_tables: single physical tables that fit party_size and are
-- completely free for [p_starts_at, p_ends_at).
--
-- VIP tables are excluded from automatic allocation by design (p_include_vip
-- defaults to false): a VIP table should not get silently handed to whoever
-- happens to book first. Staff can still assign a VIP table on purpose by
-- passing it explicitly as a manual table_id to book_reservation, which
-- skips this function entirely. This is a deliberate product decision, not
-- a technical limitation -- documented in the Phase 07 README section.
--
-- Pass p_exclude_reservation_id when checking availability for a
-- reservation that is itself being rescheduled, so its own current hold on
-- a table doesn't count as a conflict against itself.
-- ---------------------------------------------------------------------------
create or replace function public.get_available_tables(
  p_restaurant_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_party_size int,
  p_zone_id uuid default null,
  p_exclude_reservation_id uuid default null,
  p_include_vip boolean default false
)
returns table (
  table_id uuid,
  label text,
  zone_id uuid,
  capacity_min int,
  capacity_max int,
  is_vip boolean
)
language sql
stable
as $$
  select t.id, t.label, t.zone_id, t.capacity_min, t.capacity_max, t.is_vip
  from public.tables t
  where t.restaurant_id = p_restaurant_id
    and t.deleted_at is null
    and t.is_active
    and t.capacity_min <= p_party_size
    and t.capacity_max >= p_party_size
    and (p_zone_id is null or t.zone_id = p_zone_id)
    and (p_include_vip or not t.is_vip)
    and not exists (
      select 1 from public.reservation_tables rt
      where rt.table_id = t.id
        and rt.blocks_availability
        and rt.time_range && tstzrange(p_starts_at, p_ends_at, '[)')
        and (p_exclude_reservation_id is null or rt.reservation_id <> p_exclude_reservation_id)
    )
  order by (t.capacity_max - p_party_size) asc, t.capacity_min asc, t.label asc;
$$;

grant execute on function public.get_available_tables(uuid, timestamptz, timestamptz, int, uuid, uuid, boolean) to authenticated;

comment on function public.get_available_tables is
  'Single tables that fit party_size and have no overlapping active reservation. VIP tables excluded unless p_include_vip. SECURITY INVOKER: relies on the caller''s own tables/reservation_tables RLS.';

-- ---------------------------------------------------------------------------
-- get_available_table_combinations: predefined multi-table groups (from
-- table_combinations / table_combination_members, migration 0003) whose
-- combined capacity fits party_size and where EVERY member table is free
-- for the requested slot. A combination is an all-or-nothing unit: it is
-- only offered if none of its member tables is already held.
-- ---------------------------------------------------------------------------
create or replace function public.get_available_table_combinations(
  p_restaurant_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_party_size int,
  p_exclude_reservation_id uuid default null
)
returns table (
  combination_id uuid,
  name text,
  combined_capacity_min int,
  combined_capacity_max int,
  table_ids uuid[]
)
language sql
stable
as $$
  select tc.id, tc.name, tc.combined_capacity_min, tc.combined_capacity_max,
         array_agg(t.id order by t.label)
  from public.table_combinations tc
  join public.table_combination_members tcm on tcm.combination_id = tc.id
  join public.tables t on t.id = tcm.table_id
  where tc.restaurant_id = p_restaurant_id
    and tc.is_active
    and tc.combined_capacity_min <= p_party_size
    and tc.combined_capacity_max >= p_party_size
    and t.deleted_at is null
    and t.is_active
  group by tc.id, tc.name, tc.combined_capacity_min, tc.combined_capacity_max
  having not exists (
    select 1
    from public.table_combination_members tcm2
    join public.reservation_tables rt on rt.table_id = tcm2.table_id
    where tcm2.combination_id = tc.id
      and rt.blocks_availability
      and rt.time_range && tstzrange(p_starts_at, p_ends_at, '[)')
      and (p_exclude_reservation_id is null or rt.reservation_id <> p_exclude_reservation_id)
  )
  order by (tc.combined_capacity_max - p_party_size) asc, tc.combined_capacity_min asc, tc.name asc;
$$;

grant execute on function public.get_available_table_combinations(uuid, timestamptz, timestamptz, int, uuid) to authenticated;

comment on function public.get_available_table_combinations is
  'Predefined table groups (table_combinations) whose combined capacity fits party_size and whose every member table is free. All-or-nothing per combination.';

-- ---------------------------------------------------------------------------
-- book_reservation: create a new reservation, OR (when p_reservation_id is
-- given) reschedule an existing one -- same allocation logic either way, so
-- there is exactly one place this business rule lives.
--
-- Allocation order when p_table_ids is not supplied:
--   1. A single best-fit table in the requested zone (least wasted seats).
--   2. A single best-fit table in any zone.
--   3. A predefined table combination that fits.
--   4. None of the above -> raise NO_AVAILABILITY.
-- Passing p_table_ids skips allocation entirely and holds exactly those
-- tables (this is how a host manually assigns a VIP table, or overrides the
-- system's suggestion).
--
-- Concurrency safety: the actual guarantee against double-booking is NOT
-- "we checked availability first" (that check can always race with another
-- request) -- it's the EXCLUDE constraint on reservation_tables from 0006.
-- If two staff members somehow both pass this function's availability check
-- for the same table at the same time, only one INSERT into
-- reservation_tables will succeed; Postgres itself rejects the second with
-- an exclusion_violation, which this function catches and turns into a
-- clean DOUBLE_BOOKED error rather than a raw Postgres error string.
-- ---------------------------------------------------------------------------
create or replace function public.book_reservation(
  p_restaurant_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_party_size int,
  p_source public.reservation_source default 'admin',
  p_customer_id uuid default null,
  p_guest_name text default null,
  p_guest_phone text default null,
  p_guest_email citext default null,
  p_special_requests text default null,
  p_internal_notes text default null,
  p_zone_preference_id uuid default null,
  p_buffer_minutes int default null,
  p_table_ids uuid[] default null,
  p_reservation_id uuid default null
)
returns public.reservations
language plpgsql
as $$
declare
  v_restaurant  public.restaurants%rowtype;
  v_buffer      int;
  v_table_ids   uuid[];
  v_reservation public.reservations%rowtype;
begin
  if p_ends_at <= p_starts_at then
    raise exception 'INVALID_TIME_RANGE';
  end if;
  if p_party_size is null or p_party_size <= 0 then
    raise exception 'INVALID_PARTY_SIZE';
  end if;

  select * into v_restaurant from public.restaurants where id = p_restaurant_id and deleted_at is null;
  if not found then
    raise exception 'RESTAURANT_NOT_FOUND';
  end if;

  v_buffer := coalesce(p_buffer_minutes, v_restaurant.default_turnover_buffer_min);

  if p_table_ids is not null and array_length(p_table_ids, 1) > 0 then
    -- Manual choice always wins; no smart-allocation lookup at all.
    v_table_ids := p_table_ids;
  else
    if p_zone_preference_id is not null then
      select array_agg(a.table_id) into v_table_ids
      from (
        select table_id from public.get_available_tables(
          p_restaurant_id, p_starts_at, p_ends_at, p_party_size, p_zone_preference_id, p_reservation_id
        ) limit 1
      ) a;
    end if;

    if v_table_ids is null then
      select array_agg(a.table_id) into v_table_ids
      from (
        select table_id from public.get_available_tables(
          p_restaurant_id, p_starts_at, p_ends_at, p_party_size, null, p_reservation_id
        ) limit 1
      ) a;
    end if;

    if v_table_ids is null then
      select c.table_ids into v_table_ids
      from public.get_available_table_combinations(
        p_restaurant_id, p_starts_at, p_ends_at, p_party_size, p_reservation_id
      ) c
      limit 1;
    end if;

    if v_table_ids is null then
      raise exception 'NO_AVAILABILITY';
    end if;
  end if;

  begin
    if p_reservation_id is null then
      insert into public.reservations (
        restaurant_id, customer_id, status, source, party_size, starts_at, ends_at, buffer_minutes,
        zone_preference_id, guest_name, guest_phone, guest_email, special_requests, internal_notes,
        created_by_user_id
      ) values (
        p_restaurant_id, p_customer_id, 'confirmed', p_source, p_party_size, p_starts_at, p_ends_at, v_buffer,
        p_zone_preference_id, p_guest_name, p_guest_phone, p_guest_email, p_special_requests, p_internal_notes,
        auth.uid()
      )
      returning * into v_reservation;
    else
      update public.reservations
         set party_size          = p_party_size,
             starts_at           = p_starts_at,
             ends_at             = p_ends_at,
             buffer_minutes      = v_buffer,
             zone_preference_id  = p_zone_preference_id,
             guest_name          = coalesce(p_guest_name, guest_name),
             guest_phone         = coalesce(p_guest_phone, guest_phone),
             guest_email         = coalesce(p_guest_email, guest_email),
             special_requests    = coalesce(p_special_requests, special_requests),
             internal_notes      = coalesce(p_internal_notes, internal_notes)
       where id = p_reservation_id
         and restaurant_id = p_restaurant_id
       returning * into v_reservation;

      if not found then
        raise exception 'RESERVATION_NOT_FOUND';
      end if;

      delete from public.reservation_tables where reservation_id = p_reservation_id;
    end if;

    insert into public.reservation_tables (reservation_id, table_id)
    select v_reservation.id, unnest(v_table_ids);
  exception
    when exclusion_violation then
      raise exception 'DOUBLE_BOOKED';
  end;

  return v_reservation;
end;
$$;

grant execute on function public.book_reservation(
  uuid, timestamptz, timestamptz, int, public.reservation_source, uuid, text, text, citext, text, text, uuid, int, uuid[], uuid
) to authenticated;

comment on function public.book_reservation is
  'Create (p_reservation_id null) or reschedule (p_reservation_id set) a reservation with smart table allocation, in one atomic transaction. SECURITY INVOKER: writes go through the caller''s own RLS, so tenant isolation is enforced the same way it is for any direct client write.';

-- ---------------------------------------------------------------------------
-- reservations_set_status_timestamps: fills in the matching *_at column the
-- moment `status` changes, so no caller (this migration's own function,
-- direct client updates from the floor/reservation screens, or the AI layer
-- later) has to remember to set it by hand. coalesce() means a timestamp is
-- only ever set once, even if status bounces back and forth.
-- ---------------------------------------------------------------------------
create or replace function public.reservations_set_status_timestamps()
returns trigger
language plpgsql
as $$
begin
  if new.status is distinct from old.status then
    case new.status
      when 'confirmed' then new.confirmed_at := coalesce(new.confirmed_at, now());
      when 'seated'    then new.seated_at := coalesce(new.seated_at, now());
      when 'completed' then new.completed_at := coalesce(new.completed_at, now());
      when 'cancelled' then new.cancelled_at := coalesce(new.cancelled_at, now());
      when 'no_show'   then new.no_show_marked_at := coalesce(new.no_show_marked_at, now());
      else
        -- 'pending' or any future status: nothing to stamp.
        null;
    end case;
  end if;
  return new;
end;
$$;

create trigger trg_reservations_status_timestamps
  before update on public.reservations
  for each row execute function public.reservations_set_status_timestamps();

comment on trigger trg_reservations_status_timestamps on public.reservations is
  'Auto-stamps confirmed_at/seated_at/completed_at/cancelled_at/no_show_marked_at on status change. Runs before trg_reservations_propagate (0006, AFTER UPDATE) so reservation_tables sees the final row.';
