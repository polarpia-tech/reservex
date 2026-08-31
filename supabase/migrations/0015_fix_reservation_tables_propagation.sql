-- =============================================================================
-- 0015_fix_reservation_tables_propagation.sql
--
-- Bug found while verifying Phase 08 (public customer booking / self-cancel):
-- public.reservations_propagate_to_tables() (0006, AFTER UPDATE on
-- reservations) keeps reservation_tables.blocks_availability in sync whenever
-- a reservation's status/time changes. It was a plain SECURITY INVOKER
-- function, so its internal `update public.reservation_tables ...` runs as
-- whichever role triggered the outer update on reservations.
--
-- That was invisible through the end of Phase 07 because every status change
-- up to that point was made by restaurant staff, and reservation_tables_all's
-- RLS policy (0011) already grants restaurant members full access to their
-- own restaurant's reservation_tables rows -- so the trigger's inner UPDATE
-- always succeeded.
--
-- Phase 08 introduces the first status change made by a NON-staff role: a
-- customer cancelling their own reservation directly, via the narrowly
-- scoped reservations_customer_cancel policy (0014). reservation_tables is
-- deliberately staff-only (see 0014's comments -- floor plan detail is never
-- exposed publicly), so when the trigger's inner UPDATE ran as that
-- customer, RLS silently filtered it down to zero affected rows: no error
-- raised, but the physical table was never actually freed. The reservation
-- itself was correctly marked cancelled, but reservation_tables kept
-- blocks_availability = true indefinitely, which means get_available_tables/
-- get_available_table_combinations (0013) would have kept treating that
-- table as occupied even after the guest cancelled -- a real availability
-- bug, caught by scripts/verify_phase08_public_booking.sql Test J.
--
-- Fix: this propagation is internal bookkeeping that must hold regardless of
-- which role changed the parent reservation, so the function becomes
-- SECURITY DEFINER (same pattern already used by 0012's get_restaurant_staff
-- and 0014's book_public_reservation), with a pinned search_path. It remains
-- a narrow, deliberate bypass: it only ever copies fields from the
-- reservation row that was just written under that write's own RLS check --
-- it takes no other input from the caller and grants no new read access.
-- =============================================================================

create or replace function public.reservations_propagate_to_tables()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.starts_at, new.ends_at, new.buffer_minutes, new.status)
     is distinct from (old.starts_at, old.ends_at, old.buffer_minutes, old.status)
  then
    update public.reservation_tables
       set time_range = tstzrange(new.starts_at, new.ends_at + make_interval(mins => new.buffer_minutes), '[)'),
           blocks_availability = new.status in ('pending', 'confirmed', 'seated')
     where reservation_id = new.id;
  end if;
  return new;
end;
$$;

comment on function public.reservations_propagate_to_tables() is
  'SECURITY DEFINER (fixed in 0015): must free/reserve tables regardless of which role changed the parent reservation -- restaurant staff or a customer self-cancelling. reservation_tables itself stays staff-only under RLS; this trigger is the one deliberate, narrow bypass, and it only ever copies fields already present on the reservation row that was just written under that write''s own RLS check -- it accepts no other input from the caller.';
