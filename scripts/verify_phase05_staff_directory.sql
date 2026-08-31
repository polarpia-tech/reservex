-- =============================================================================
-- verify_phase05_staff_directory.sql
-- Proves get_restaurant_staff() (0012) does what its comment claims:
--   1. A member of a restaurant sees that restaurant's staff, WITH emails.
--   2. The same person gets ZERO rows when asking for a DIFFERENT
--      restaurant's staff -- i.e. the SECURITY DEFINER function does not
--      leak across tenants just because it can technically see all of
--      auth.users and all of restaurant_users once inside the function body.
--   3. Someone who is not staff ANYWHERE gets zero rows for either.
-- Run after migrations + seed.sql.
-- =============================================================================

\set ON_ERROR_STOP on

\echo '=== TEST A: Athens owner asks for Athens staff -> expects 2 rows (owner + manager), with real emails ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select role, email from public.get_restaurant_staff('bbbbbbbb-0000-0000-0000-000000000001') order by role;
reset role;

\echo ''
\echo '=== TEST B: Athens owner asks for MUNICH staff -> expects 0 rows (tenant isolation) ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select count(*) as should_be_zero from public.get_restaurant_staff('bbbbbbbb-0000-0000-0000-000000000002');
reset role;

\echo ''
\echo '=== TEST C: Athens MANAGER (not owner) can also see the Athens roster -> expects 2 rows ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
select role, email from public.get_restaurant_staff('bbbbbbbb-0000-0000-0000-000000000001') order by role;
reset role;

\echo ''
\echo '=== TEST D: a customer (staff nowhere) asks for Athens staff -> expects 0 rows ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select count(*) as should_be_zero from public.get_restaurant_staff('bbbbbbbb-0000-0000-0000-000000000001');
reset role;

\echo ''
\echo '=== TEST E: Munich owner sees only Munich staff (1 row), not Athens ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select role, email from public.get_restaurant_staff('bbbbbbbb-0000-0000-0000-000000000002');
reset role;

\echo ''
\echo 'All tests above ran without error. Manually confirm: A=2 rows, B=0, C=2 rows, D=0, E=1 row.'
