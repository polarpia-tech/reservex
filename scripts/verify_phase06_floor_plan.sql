-- =============================================================================
-- verify_phase06_floor_plan.sql
-- Proves, against the Phase 02 RLS policies (0011) that Phase 06's table/zone
-- management screens now actually exercise, that:
--   1. An owner/manager can create zones & tables for THEIR OWN restaurant.
--   2. They CANNOT do the same for a restaurant they don't belong to
--      (tenant isolation on WRITE, not just read).
--   3. A plain "host" role (not owner/manager) CAN change a table's status
--      (the app's floor view relies on this -- it is not a bug that any
--      staff member can do it, the RLS policy grants it on purpose).
--   4. That same host CANNOT create a table or rename a zone -- those stay
--      owner/manager-only, matching `tables_insert` / `table_zones_write`.
-- Run after migrations + seed.sql.
-- =============================================================================

\set ON_ERROR_STOP off

\echo '=== SETUP: a temporary "host" staff member at the Athens restaurant ==='
insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555', 'host.athens@example.com')
on conflict (id) do nothing;
insert into public.restaurant_users (restaurant_id, user_id, role, joined_at) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'host', now())
on conflict (restaurant_id, user_id) do nothing;

\echo ''
\echo '=== TEST A: Athens owner creates a new zone for Athens -> expects success ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
insert into public.table_zones (id, restaurant_id, name, zone_type)
values ('cccccccc-0000-0000-0000-0000000000a1', 'bbbbbbbb-0000-0000-0000-000000000001', 'Test Zone', 'indoor');
reset role;

\echo ''
\echo '=== TEST B: Athens owner creates a table in that zone -> expects success ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
insert into public.tables (id, restaurant_id, zone_id, label, capacity_min, capacity_max)
values ('dddddddd-0000-0000-0000-0000000000a1', 'bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-0000000000a1', 'ZTEST-1', 2, 4);
reset role;

\echo ''
\echo '=== TEST C: Athens owner tries to create a zone for MUNICH -> expects RLS ERROR ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
insert into public.table_zones (restaurant_id, name, zone_type)
values ('bbbbbbbb-0000-0000-0000-000000000002', 'Should Not Exist', 'indoor');
\echo '^^^ expected: ERROR - new row violates row-level security policy'
reset role;

\set ON_ERROR_STOP on

\echo ''
\echo '=== TEST D: Athens owner tries to rename MUNICH''s existing table B1 -> expects 0 rows affected ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
update public.tables set label = 'HACKED' where id = 'dddddddd-0000-0000-0000-000000000003';
reset role;
select label as should_still_be_b1 from public.tables where id = 'dddddddd-0000-0000-0000-000000000003';

\echo ''
\echo '=== TEST E: the Athens HOST (not owner/manager) changes a table status -> expects success ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
update public.tables set status = 'cleaning' where id = 'dddddddd-0000-0000-0000-0000000000a1';
reset role;
select status as should_be_cleaning from public.tables where id = 'dddddddd-0000-0000-0000-0000000000a1';

\echo ''
\echo '=== TEST F: the same host tries to create a NEW table -> expects 0 rows (structural change is owner/manager only) ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
\set ON_ERROR_STOP off
insert into public.tables (restaurant_id, zone_id, label, capacity_min, capacity_max)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-0000000000a1', 'ZTEST-2', 2, 4);
\echo '^^^ expected: ERROR - new row violates row-level security policy (tables_insert is owner/manager only)'
\set ON_ERROR_STOP on
reset role;

\echo ''
\echo '=== TEST G: the same host tries to rename the zone -> expects 0 rows affected (table_zones_write is owner/manager only) ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
update public.table_zones set name = 'Hacked Zone' where id = 'cccccccc-0000-0000-0000-0000000000a1';
reset role;
select name as should_still_be_test_zone from public.table_zones where id = 'cccccccc-0000-0000-0000-0000000000a1';

\echo ''
\echo '=== CLEANUP ==='
delete from public.tables where id = 'dddddddd-0000-0000-0000-0000000000a1';
delete from public.table_zones where id = 'cccccccc-0000-0000-0000-0000000000a1';
delete from public.restaurant_users where user_id = '55555555-5555-5555-5555-555555555555';
delete from auth.users where id = '55555555-5555-5555-5555-555555555555';
select 'cleanup done' as result;
