-- =============================================================================
-- 0022_fix_book_reservation_deadlock.sql
--
-- Real GitHub Actions CI run caught a gap the sandbox's own Postgres never
-- surfaced: under true concurrency, two transactions racing to book the
-- same table can trigger a genuine Postgres deadlock (SQLSTATE 40P01)
-- instead of the clean exclusion_violation (23P01) book_reservation()
-- already caught. This adds the missing WHEN clause -- both map to the
-- same DOUBLE_BOOKED error, since from the caller's side they mean the
-- same thing: lost the race for this table. Full create-or-replace of
-- 0013's function (forward-only migrations -- 0013 itself never changes).
-- =============================================================================

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
    when deadlock_detected then
      raise exception 'DOUBLE_BOOKED';
  end;

  return v_reservation;
end;
$$;

comment on function public.book_reservation is
  'Create (p_reservation_id null) or reschedule (p_reservation_id set) a reservation with smart table allocation, in one atomic transaction. SECURITY INVOKER: writes go through the caller''s own RLS. Catches both exclusion_violation and deadlock_detected from the reservation_tables insert as DOUBLE_BOOKED -- see 0022''s header comment.';
