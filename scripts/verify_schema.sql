-- =============================================================================
-- verify_schema.sql
-- Proves, with real queries against real data, the two guarantees the
-- blueprint promised: (1) the database itself refuses a double booking,
-- and (2) Row Level Security actually isolates two restaurants' data.
-- Run after migrations + seed.sql. Expected output is annotated inline.
-- =============================================================================

\set ON_ERROR_STOP off
\echo '=== TEST 1: overlapping reservation on the same table MUST be rejected ==='
begin;
  insert into public.reservations (restaurant_id, customer_id, status, source, party_size, starts_at, ends_at, guest_name)
  values (
    'bbbbbbbb-0000-0000-0000-000000000001', null, 'confirmed', 'walk_in', 2,
    (current_date + interval '1 day' + time '20:30') at time zone 'Europe/Athens',
    (current_date + interval '1 day' + time '22:00') at time zone 'Europe/Athens',
    'Overlap Test'
  ) returning id \gset overlap_
  insert into public.reservation_tables (reservation_id, table_id)
  values (:'overlap_id', 'dddddddd-0000-0000-0000-000000000002');
rollback;
\echo '^^^ expected: ERROR - conflicting key value violates exclusion constraint (this is CORRECT behaviour)'

\set ON_ERROR_STOP on
\echo ''
\echo '=== TEST 2: a NON-overlapping reservation on the same table MUST succeed ==='
begin;
  insert into public.reservations (restaurant_id, customer_id, status, source, party_size, starts_at, ends_at, guest_name)
  values (
    'bbbbbbbb-0000-0000-0000-000000000001', null, 'confirmed', 'walk_in', 2,
    (current_date + interval '1 day' + time '22:15') at time zone 'Europe/Athens',
    (current_date + interval '1 day' + time '23:30') at time zone 'Europe/Athens',
    'No-overlap Test'
  ) returning id \gset ok_
  insert into public.reservation_tables (reservation_id, table_id)
  values (:'ok_id', 'dddddddd-0000-0000-0000-000000000002');
  select 'TEST 2 PASSED: non-overlapping booking accepted' as result;
rollback;

\echo ''
\echo '=== TEST 3: cancelling a reservation frees its table for the same slot ==='
begin;
  update public.reservations set status = 'cancelled', cancelled_at = now()
  where id = 'ffffffff-0000-0000-0000-000000000001';

  insert into public.reservations (restaurant_id, customer_id, status, source, party_size, starts_at, ends_at, guest_name)
  values (
    'bbbbbbbb-0000-0000-0000-000000000001', null, 'confirmed', 'walk_in', 2,
    (current_date + interval '1 day' + time '20:30') at time zone 'Europe/Athens',
    (current_date + interval '1 day' + time '22:00') at time zone 'Europe/Athens',
    'Reuses freed table'
  ) returning id \gset freed_
  insert into public.reservation_tables (reservation_id, table_id)
  values (:'freed_id', 'dddddddd-0000-0000-0000-000000000002');
  select 'TEST 3 PASSED: cancelled reservation no longer blocks the table' as result;
rollback;

\echo ''
\echo '=== TEST 4: RLS -- the Munich owner must see ZERO Athens reservations ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select count(*) as visible_reservations_for_munich_owner from public.reservations;
\echo '^^^ expected: 0 (Athens reservation is invisible to the Munich account)'
reset role;

\echo ''
\echo '=== TEST 5: RLS -- the Athens owner must see the Athens reservation ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select count(*) as visible_reservations_for_athens_owner from public.reservations;
\echo '^^^ expected: 1'
reset role;

\echo ''
\echo '=== TEST 6: RLS -- the customer sees only her own reservation, nothing about the CRM notes ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select count(*) as visible_reservations_for_customer from public.reservations;
select count(*) as visible_crm_rows_for_customer from public.restaurant_customers;
\echo '^^^ expected: 1 reservation visible, 0 CRM rows visible (notes/VIP flag stay internal to the restaurant)'
reset role;

\echo ''
\echo '=== TEST 7: RLS -- a Munich owner cannot rename the Athens restaurant ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
update public.restaurants set name = 'HACKED' where id = 'bbbbbbbb-0000-0000-0000-000000000001';
\echo '^^^ expected: UPDATE 0 (RLS hid the row from the Munich owner entirely -- nothing to update)'
reset role;
-- verify as postgres (bypasses RLS) that the name really is untouched
select name from public.restaurants where id = 'bbbbbbbb-0000-0000-0000-000000000001';
\echo '^^^ expected: still "Ταβέρνα Ιθάκη" -- proves the blocked update never applied'
