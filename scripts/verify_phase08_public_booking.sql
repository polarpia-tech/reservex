-- =============================================================================
-- verify_phase08_public_booking.sql
-- Proves, against real data, that the Phase 08 public layer (0014) does what
-- it claims and nothing more:
--   A. anon can browse an ACTIVE restaurant's public profile + hours.
--   B. anon still cannot see floor-plan detail (zones/tables) -- unchanged.
--   C. A real guest (no session at all) can book a table end to end.
--   D. Party size outside the restaurant's own min/max is rejected.
--   E. Booking too soon or too far ahead (booking window) is rejected.
--   F. Booking at a time the restaurant is actually closed is rejected.
--   G. A guest with no name/phone/email at all is rejected.
--   H. The basic anti-spam rate guard trips on a 4th rapid attempt, global
--      across restaurants, and BEFORE the availability check even runs.
--   I. The customers_insert/update RLS fix: nobody can claim or reassign
--      someone else's auth_user_id.
--   J. A signed-in customer's own profile fills in missing guest details,
--      they can see their own new reservation (and nobody else can), and
--      they can cancel it themselves -- but not set any OTHER status.
--   K. restaurants_public_select never leaks an inactive restaurant to anon.
-- Run after migrations (through 0014) + seed.sql, with local_dev_shim.sql
-- already re-applied (it now also creates the "anon" role).
-- =============================================================================

\set ON_ERROR_STOP off

\echo '=== TEST A: anon reads Athens'' public profile + opening hours ==='
set role anon;
select name, city, is_active from public.restaurants where slug = 'taverna-ithaki';
select count(*) as athens_hours_visible_to_anon from public.opening_hours where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001';
reset role;
\echo '(expected: 1 row "Ταβέρνα Ιθάκη"/Athens/true, and a nonzero hours count)'

\echo ''
\echo '=== TEST B: anon still cannot see floor-plan detail ==='
set role anon;
select count(*) as tables_visible_to_anon from public.tables where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001';
select count(*) as zones_visible_to_anon from public.table_zones where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001';
reset role;
\echo '(expected: 0 and 0 -- unchanged from Phase 02/06, only Phase 08''s new policies were added)'

\echo ''
\echo '=== TEST C: a real anonymous guest books a table, no session at all ==='
set role anon;
select id as booking_c_id, status, source, guest_name into temporary table _t_booking_c from public.book_public_reservation(
  p_restaurant_slug => 'taverna-ithaki',
  p_starts_at       => (current_date + interval '2 days' + time '12:00') at time zone 'Europe/Athens',
  p_party_size      => 2,
  p_guest_name      => 'Anon Guest C',
  p_guest_phone     => '+30 690 555 1001'
);
select status, source, guest_name from _t_booking_c;
select count(*) as guest_can_read_it_back_themselves from public.reservations where id = (select booking_c_id from _t_booking_c);
reset role;
select count(*) as row_really_exists_admin_view from public.reservations where id = (select booking_c_id from _t_booking_c);
\echo '(expected: the temp-table row shows status=confirmed/source=web/guest_name="Anon Guest C" -- that data came straight back from the RPC call itself. guest_can_read_it_back_themselves = 0: an anonymous guest has no session and reservations_select grants nothing to them, so they can NEVER look their own booking back up this way -- a real, disclosed limitation, not a bug (see README: guests get their confirmation only from this one response). row_really_exists_admin_view = 1 confirms the booking is genuinely in the table, just invisible to its own anonymous creator.)'

\echo ''
\echo '=== TEST D: party size outside min/max (Athens allows 1-14) -> PARTY_SIZE_OUT_OF_RANGE ==='
set role anon;
select public.book_public_reservation(
  p_restaurant_slug => 'taverna-ithaki',
  p_starts_at       => (current_date + interval '1 day' + time '12:00') at time zone 'Europe/Athens',
  p_party_size      => 99,
  p_guest_name      => 'Should Fail D',
  p_guest_phone     => '+30 690 555 9001'
);
reset role;
\echo '(expected: ERROR: PARTY_SIZE_OUT_OF_RANGE)'

\echo ''
\echo '=== TEST E: booking window -- 5 minutes from now (min is 1 hour) -> OUTSIDE_BOOKING_WINDOW ==='
set role anon;
select public.book_public_reservation(
  p_restaurant_slug => 'taverna-ithaki',
  p_starts_at       => now() + interval '5 minutes',
  p_party_size      => 2,
  p_guest_name      => 'Should Fail E1',
  p_guest_phone     => '+30 690 555 9002'
);
reset role;
\echo '(expected: ERROR: OUTSIDE_BOOKING_WINDOW)'
set role anon;
select public.book_public_reservation(
  p_restaurant_slug => 'taverna-ithaki',
  p_starts_at       => now() + interval '90 days',
  p_party_size      => 2,
  p_guest_name      => 'Should Fail E2',
  p_guest_phone     => '+30 690 555 9003'
);
reset role;
\echo '(expected: ERROR: OUTSIDE_BOOKING_WINDOW -- max is 60 days)'

\echo ''
\echo '=== TEST F: 04:00 local time -- outside both the lunch and dinner shifts -> RESTAURANT_CLOSED ==='
set role anon;
select public.book_public_reservation(
  p_restaurant_slug => 'taverna-ithaki',
  p_starts_at       => (current_date + interval '2 days' + time '04:00') at time zone 'Europe/Athens',
  p_party_size      => 2,
  p_guest_name      => 'Should Fail F',
  p_guest_phone     => '+30 690 555 9004'
);
reset role;
\echo '(expected: ERROR: RESTAURANT_CLOSED)'

\echo ''
\echo '=== TEST G: no name, no phone, no email at all -> GUEST_DETAILS_REQUIRED ==='
set role anon;
select public.book_public_reservation(
  p_restaurant_slug => 'taverna-ithaki',
  p_starts_at       => (current_date + interval '2 days' + time '13:30') at time zone 'Europe/Athens',
  p_party_size      => 2
);
reset role;
\echo '(expected: ERROR: GUEST_DETAILS_REQUIRED)'

\echo ''
\echo '=== TEST H: rate guard -- 3 legitimate bookings then a 4th, same phone, within 15 minutes ==='
set role anon;
select set_config('x.phone', '+30 690 555 2002', false); -- just to echo below, not read by the function
select id into temporary table _t_booking_h1 from public.book_public_reservation(
  p_restaurant_slug => 'taverna-ithaki', p_starts_at => (current_date + interval '2 days' + time '19:00') at time zone 'Europe/Athens',
  p_party_size => 2, p_guest_name => 'Rate Test 1', p_guest_phone => '+30 690 555 2002'
);
select id into temporary table _t_booking_h2 from public.book_public_reservation(
  p_restaurant_slug => 'taverna-ithaki', p_starts_at => (current_date + interval '2 days' + time '21:00') at time zone 'Europe/Athens',
  p_party_size => 2, p_guest_name => 'Rate Test 2', p_guest_phone => '+30 690 555 2002'
);
select id into temporary table _t_booking_h3 from public.book_public_reservation(
  p_restaurant_slug => 'taverna-ithaki', p_starts_at => (current_date + interval '2 days' + time '23:00') at time zone 'Europe/Athens',
  p_party_size => 2, p_guest_name => 'Rate Test 3', p_guest_phone => '+30 690 555 2002'
);
reset role;
select count(*) as three_bookings_so_far from public.reservations where guest_phone = '+30 690 555 2002';
-- (deliberately checked as postgres/admin, not anon: an anonymous guest can
-- never read reservations back at all -- see Test C -- so this count would
-- misleadingly show 0 under "set role anon" too, for the same reason, not
-- because the bookings failed.)
set role anon;
select public.book_public_reservation(
  p_restaurant_slug => 'taverna-ithaki', p_starts_at => (current_date + interval '3 days' + time '12:30') at time zone 'Europe/Athens',
  p_party_size => 2, p_guest_name => 'Rate Test 4 Should Fail', p_guest_phone => '+30 690 555 2002'
);
reset role;
\echo '(expected: three_bookings_so_far = 3, then ERROR: RATE_LIMITED on the 4th -- note it is even a DIFFERENT, otherwise-bookable time slot, proving the guard runs before availability is ever checked)'

\echo ''
\echo '=== SETUP for I/J: a brand-new auth user with no customers row yet ==='
insert into auth.users (id, email) values
  ('77777777-7777-7777-7777-777777777777', 'newcustomer@example.com'),
  ('88888888-8888-8888-8888-888888888888', 'othercustomer@example.com')
on conflict (id) do nothing;

\echo ''
\echo '=== TEST I: customers RLS hardening -- cannot claim or reassign someone elses auth_user_id ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
insert into public.customers (auth_user_id, full_name) values ('88888888-8888-8888-8888-888888888888', 'Spoofed Identity');
reset role;
\echo '(expected: ERROR: new row violates row-level security policy -- cannot insert a customers row claiming ANOTHER users auth_user_id)'

set role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
insert into public.customers (id, auth_user_id, full_name, email) values
  ('99999999-1111-0000-0000-000000000001', '77777777-7777-7777-7777-777777777777', 'Real New Customer', 'newcustomer@example.com');
update public.customers set auth_user_id = '88888888-8888-8888-8888-888888888888' where id = '99999999-1111-0000-0000-000000000001';
reset role;
\echo '(expected: the INSERT with their OWN auth_user_id succeeds; the UPDATE reassigning it to someone elses fails with the same RLS error)'

set role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
update public.customers set phone = '+30 690 555 3003' where id = '99999999-1111-0000-0000-000000000001';
select auth_user_id, phone from public.customers where id = '99999999-1111-0000-0000-000000000001';
reset role;
\echo '(expected: updating their OWN phone/name still works fine -- only auth_user_id reassignment is blocked)'

\echo ''
\echo '=== TEST J: signed-in customer books with no guest fields at all (profile fallback), sees only their own reservation, and can cancel it (but nothing else) ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
select id as booking_j_id into temporary table _t_booking_j from public.book_public_reservation(
  p_restaurant_slug => 'taverna-ithaki',
  p_starts_at       => (current_date + interval '3 days' + time '12:00') at time zone 'Europe/Athens',
  p_party_size      => 2
);
select customer_id, guest_email from public.reservations where id = (select booking_j_id from _t_booking_j);
reset role;
\echo '(expected: customer_id = the row just created above, guest_email = newcustomer@example.com -- filled in from their profile/auth email even though no guest_* args were passed)'

set role authenticated;
select set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', false);
select count(*) as other_customer_can_see_it from public.reservations where id = (select booking_j_id from _t_booking_j);
reset role;
\echo '(expected: 0 -- a different customer cannot see this reservation)'

set role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
select count(*) as owner_can_see_it from public.reservations where id = (select booking_j_id from _t_booking_j);
update public.reservations set status = 'seated' where id = (select booking_j_id from _t_booking_j);
reset role;
\echo '(expected: owner_can_see_it=1, then ERROR: new row violates row-level security policy -- the row DOES match reservations_customer_cancel''s USING clause (owned, not yet terminal), so Postgres attempts the update under that policy, but its WITH CHECK only allows the new status to be ''cancelled'' -- "seated" fails it, and no other policy grants a customer UPDATE at all, so the whole statement is rejected outright rather than silently doing nothing. Status is therefore provably still "confirmed" going into the next step.)'

set role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
update public.reservations set status = 'cancelled', cancellation_reason = 'change of plans' where id = (select booking_j_id from _t_booking_j);
select status, cancellation_reason, cancelled_at is not null as cancelled_at_set from public.reservations where id = (select booking_j_id from _t_booking_j);
reset role;
select blocks_availability from public.reservation_tables where reservation_id = (select booking_j_id from _t_booking_j);
\echo '(expected: the "cancelled" UPDATE succeeds this time (status=cancelled, cancelled_at_set=t) -- proving the customer genuinely CAN self-cancel, just nothing else. blocks_availability is checked here as postgres/admin, not the customer -- reservation_tables stays staff-only per Test B, so the customer themselves cannot read this table at all; the admin view is what proves the table was really freed (f) by the existing 0006 propagation trigger.)'

\echo ''
\echo '=== TEST K: restaurants_public_select never leaks an inactive restaurant ==='
update public.restaurants set is_active = false where id = 'bbbbbbbb-0000-0000-0000-000000000002';
set role anon;
select count(*) as munich_visible_while_inactive from public.restaurants where slug = 'zur-alten-post';
reset role;
update public.restaurants set is_active = true where id = 'bbbbbbbb-0000-0000-0000-000000000002';
\echo '(expected: 0 -- flipped back to active right after)'

\echo ''
\echo '=== CLEANUP ==='
delete from public.reservation_tables where reservation_id in (
  select booking_c_id from _t_booking_c
  union select id from _t_booking_h1 union select id from _t_booking_h2 union select id from _t_booking_h3
  union select booking_j_id from _t_booking_j
);
delete from public.reservations where id in (
  select booking_c_id from _t_booking_c
  union select id from _t_booking_h1 union select id from _t_booking_h2 union select id from _t_booking_h3
  union select booking_j_id from _t_booking_j
);
delete from public.customers where id = '99999999-1111-0000-0000-000000000001';
delete from auth.users where id in ('77777777-7777-7777-7777-777777777777', '88888888-8888-8888-8888-888888888888');
drop table if exists _t_booking_c, _t_booking_h1, _t_booking_h2, _t_booking_h3, _t_booking_j;
\echo 'done.'
