-- =============================================================================
-- verify_phase07_reservation_engine.sql
-- Proves, against real data and the RLS policies from 0011, that the
-- reservation engine from 0013 actually delivers what it promises:
--   A. Reservation visibility respects tenant isolation (SELECT).
--   B. Smart allocation picks the single best-fit table automatically.
--   C. When no single table fits, it correctly reports NO_AVAILABILITY
--      rather than silently succeeding or double-booking.
--   D. A VIP table is excluded from automatic allocation, even when it
--      would otherwise be the only thing that fits.
--   E. A predefined table combination is used when no single table has
--      enough capacity, and both member tables get held.
--   F. Once a combination's tables are held, the same combination is
--      correctly reported as unavailable for another overlapping booking.
--   G. The EXCLUDE constraint -- not just the SQL availability filter -- is
--      what actually prevents double-booking: manually forcing a table that
--      is already held raises DOUBLE_BOOKED instead of corrupting data.
--   H. Rescheduling moves a reservation's hold to a new time slot.
--   I. A restaurant's own RLS still applies INSIDE the function: staff from
--      another restaurant cannot use it to touch a restaurant they don't
--      belong to.
--   J. Status changes auto-stamp timestamps and correctly free/re-block the
--      table via the existing 0006 propagation trigger.
--   K. A plain "host" (not owner/manager) can create bookings too --
--      reservations_staff_write is intentionally any-staff, matching how
--      the floor/host screens are meant to be used.
-- Run after migrations (through 0013) + seed.sql.
-- =============================================================================

\set ON_ERROR_STOP off

\echo '=== SETUP: temporary host user, and a T1+T2 combination for Athens ==='
insert into auth.users (id, email) values
  ('66666666-6666-6666-6666-666666666666', 'host2.athens@example.com')
on conflict (id) do nothing;
insert into public.restaurant_users (restaurant_id, user_id, role, joined_at) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666', 'host', now())
on conflict (restaurant_id, user_id) do nothing;

insert into public.table_combinations (id, restaurant_id, name, combined_capacity_min, combined_capacity_max)
values ('99999999-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'T1+T2', 6, 8)
on conflict (id) do nothing;
insert into public.table_combination_members (combination_id, table_id) values
  ('99999999-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000001'),
  ('99999999-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002')
on conflict do nothing;

\echo ''
\echo '=== TEST A: Munich owner selects reservations -> sees ONLY Munich (0 rows, none exist yet) ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select count(*) as munich_visible_reservations from public.reservations where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001';
reset role;
\echo '(expected: 0 -- Munich owner cannot see Athens'' seed reservation)'

\echo ''
\echo '=== TEST B: Athens owner books party of 2 tomorrow 18:00-19:30 -> auto-assigns T1 (only fit) ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select id as booking_c_id into temporary table _t_booking_c from public.book_reservation(
  p_restaurant_id => 'bbbbbbbb-0000-0000-0000-000000000001',
  p_starts_at     => (current_date + interval '1 day' + time '18:00') at time zone 'Europe/Athens',
  p_ends_at       => (current_date + interval '1 day' + time '19:30') at time zone 'Europe/Athens',
  p_party_size    => 2,
  p_guest_name    => 'Test Guest C'
);
select rt.table_id, t.label from public.reservation_tables rt join public.tables t on t.id = rt.table_id
  where rt.reservation_id = (select booking_c_id from _t_booking_c);
reset role;
\echo '(expected: exactly one row, label T1)'

\echo ''
\echo '=== TEST C: party of 4 at the SAME time as the seed reservation (T2 already held) -> NO_AVAILABILITY ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.book_reservation(
  p_restaurant_id => 'bbbbbbbb-0000-0000-0000-000000000001',
  p_starts_at     => (current_date + interval '1 day' + time '20:00') at time zone 'Europe/Athens',
  p_ends_at       => (current_date + interval '1 day' + time '21:30') at time zone 'Europe/Athens',
  p_party_size    => 4,
  p_guest_name    => 'Test Guest Should Fail'
);
reset role;
\echo '(expected: ERROR: NO_AVAILABILITY -- T1 is too small for 4, T2 is already held by the seed reservation)'

\echo ''
\echo '=== TEST D: mark T1 as VIP, then request party of 2 at a free slot -> still NO_AVAILABILITY (VIP excluded) ==='
update public.tables set is_vip = true where id = 'dddddddd-0000-0000-0000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.book_reservation(
  p_restaurant_id => 'bbbbbbbb-0000-0000-0000-000000000001',
  p_starts_at     => (current_date + interval '1 day' + time '12:30') at time zone 'Europe/Athens',
  p_ends_at       => (current_date + interval '1 day' + time '14:00') at time zone 'Europe/Athens',
  p_party_size    => 2,
  p_guest_name    => 'Test Guest Should Fail VIP'
);
reset role;
\echo '(expected: ERROR: NO_AVAILABILITY -- T1 is the only table that fits a party of 2, but it is VIP and excluded from auto-allocation)'
update public.tables set is_vip = false where id = 'dddddddd-0000-0000-0000-000000000001';
\echo '(T1 un-flagged as VIP again for the rest of the script)'

\echo ''
\echo '=== TEST E: party of 7 at lunch (12:30-14:00, nothing booked then) -> falls back to the T1+T2 combination ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select id as booking_e_id into temporary table _t_booking_e from public.book_reservation(
  p_restaurant_id => 'bbbbbbbb-0000-0000-0000-000000000001',
  p_starts_at     => (current_date + interval '1 day' + time '12:30') at time zone 'Europe/Athens',
  p_ends_at       => (current_date + interval '1 day' + time '14:00') at time zone 'Europe/Athens',
  p_party_size    => 7,
  p_guest_name    => 'Test Guest E (party of 7)'
);
select t.label from public.reservation_tables rt join public.tables t on t.id = rt.table_id
  where rt.reservation_id = (select booking_e_id from _t_booking_e) order by t.label;
reset role;
\echo '(expected: two rows, T1 and T2 -- the whole combination held together)'

\echo ''
\echo '=== TEST F: another party of 7 overlapping the same lunch slot -> NO_AVAILABILITY (combo already held) ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.book_reservation(
  p_restaurant_id => 'bbbbbbbb-0000-0000-0000-000000000001',
  p_starts_at     => (current_date + interval '1 day' + time '13:00') at time zone 'Europe/Athens',
  p_ends_at       => (current_date + interval '1 day' + time '14:30') at time zone 'Europe/Athens',
  p_party_size    => 7,
  p_guest_name    => 'Test Guest Should Fail F'
);
reset role;
\echo '(expected: ERROR: NO_AVAILABILITY)'

\echo ''
\echo '=== TEST G: manually forcing T1 for a time that overlaps Test B''s 18:00-19:30 hold -> DOUBLE_BOOKED ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select public.book_reservation(
  p_restaurant_id => 'bbbbbbbb-0000-0000-0000-000000000001',
  p_starts_at     => (current_date + interval '1 day' + time '18:30') at time zone 'Europe/Athens',
  p_ends_at       => (current_date + interval '1 day' + time '19:00') at time zone 'Europe/Athens',
  p_party_size    => 2,
  p_guest_name    => 'Test Guest Should Fail G',
  p_table_ids     => array['dddddddd-0000-0000-0000-000000000001']::uuid[]
);
reset role;
\echo '(expected: ERROR: DOUBLE_BOOKED -- this is the EXCLUDE constraint firing, proving it is the real guard, not just the availability query)'

\echo ''
\echo '=== TEST H: reschedule Test B''s reservation to 21:00-22:30 the same day ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select starts_at at time zone 'Europe/Athens' as new_local_start
into temporary table _t_h_result
from public.book_reservation(
  p_restaurant_id   => 'bbbbbbbb-0000-0000-0000-000000000001',
  p_starts_at       => (current_date + interval '1 day' + time '21:00') at time zone 'Europe/Athens',
  p_ends_at         => (current_date + interval '1 day' + time '22:30') at time zone 'Europe/Athens',
  p_party_size      => 2,
  p_guest_name      => 'Test Guest C (rescheduled)',
  p_reservation_id  => (select booking_c_id from _t_booking_c)
);
select * from _t_h_result;
select count(*) as tables_still_held_on_it from public.reservation_tables where reservation_id = (select booking_c_id from _t_booking_c);
reset role;
drop table _t_h_result;
\echo '(expected: new_local_start = 21:00, and exactly 1 row still held -- old hold was replaced, not duplicated)'

\echo ''
\echo '=== TEST I: Munich owner tries to book a table AT ATHENS -> blocked by RLS inside the function ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select public.book_reservation(
  p_restaurant_id => 'bbbbbbbb-0000-0000-0000-000000000001',
  p_starts_at     => (current_date + interval '2 days' + time '18:00') at time zone 'Europe/Athens',
  p_ends_at       => (current_date + interval '2 days' + time '19:00') at time zone 'Europe/Athens',
  p_party_size    => 2,
  p_guest_name    => 'Cross-tenant attempt'
);
reset role;
\echo '(expected: ERROR: RESTAURANT_NOT_FOUND -- the restaurants_select RLS policy (0011) already hides Athens from the Munich owner, so the function''s own lookup of p_restaurant_id fails before it ever reaches the reservations INSERT. Tenant isolation holds either way; this is just where it happens to bite first.)'

\echo ''
\echo '=== TEST J: status transitions auto-stamp timestamps and free the table again ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
update public.reservations set status = 'seated' where id = (select booking_c_id from _t_booking_c);
select status, seated_at is not null as seated_at_set, completed_at is not null as completed_at_set
  from public.reservations where id = (select booking_c_id from _t_booking_c);
select blocks_availability from public.reservation_tables where reservation_id = (select booking_c_id from _t_booking_c);
update public.reservations set status = 'completed' where id = (select booking_c_id from _t_booking_c);
select status, seated_at is not null as seated_at_set, completed_at is not null as completed_at_set
  from public.reservations where id = (select booking_c_id from _t_booking_c);
select blocks_availability from public.reservation_tables where reservation_id = (select booking_c_id from _t_booking_c);
select count(*) as t1_free_again_at_2100 from public.get_available_tables(
  'bbbbbbbb-0000-0000-0000-000000000001',
  (current_date + interval '1 day' + time '21:00') at time zone 'Europe/Athens',
  (current_date + interval '1 day' + time '22:30') at time zone 'Europe/Athens',
  2
) where table_id = 'dddddddd-0000-0000-0000-000000000001';
reset role;
\echo '(expected: after "seated", seated_at_set=t, blocks_availability=t; after "completed", completed_at_set=t, blocks_availability=f, and t1_free_again_at_2100=1)'

\echo ''
\echo '=== TEST K: a plain "host" (not owner/manager) can also create a booking ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
select id as booking_k_id into temporary table _t_booking_k from public.book_reservation(
  p_restaurant_id => 'bbbbbbbb-0000-0000-0000-000000000001',
  p_starts_at     => (current_date + interval '3 days' + time '19:00') at time zone 'Europe/Athens',
  p_ends_at       => (current_date + interval '3 days' + time '20:30') at time zone 'Europe/Athens',
  p_party_size    => 2,
  p_source        => 'walk_in',
  p_guest_name    => 'Walk-in via host'
);
select count(*) from _t_booking_k where booking_k_id is not null;
reset role;
\echo '(expected: 1 -- host role is allowed to write reservations, matching reservations_staff_write = any active staff member)'

\echo ''
\echo '=== CLEANUP ==='
delete from public.reservation_tables where reservation_id in (
  select booking_c_id from _t_booking_c union select booking_e_id from _t_booking_e union select booking_k_id from _t_booking_k
);
delete from public.reservations where id in (
  select booking_c_id from _t_booking_c union select booking_e_id from _t_booking_e union select booking_k_id from _t_booking_k
);
delete from public.table_combination_members where combination_id = '99999999-0000-0000-0000-000000000001';
delete from public.table_combinations where id = '99999999-0000-0000-0000-000000000001';
delete from public.restaurant_users where user_id = '66666666-6666-6666-6666-666666666666';
delete from auth.users where id = '66666666-6666-6666-6666-666666666666';
drop table if exists _t_booking_c, _t_booking_e, _t_booking_k;
\echo 'done.'
