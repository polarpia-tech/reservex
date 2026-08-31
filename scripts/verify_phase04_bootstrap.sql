-- =============================================================================
-- verify_phase04_bootstrap.sql
-- Demonstrates a real chicken-and-egg gap in the Phase 02 RLS design: a
-- brand-new user can create their own organization and restaurant directly
-- (RLS allows it, they own both), but CANNOT insert their own first
-- restaurant_users("owner") row directly -- because that policy requires
-- already being owner/manager of the restaurant, which is exactly what
-- they're trying to become. This is why bootstrap-restaurant is an Edge
-- Function (service role), not a client-side insert. Run after migrations
-- + seed.sql.
-- =============================================================================

\set ON_ERROR_STOP off
\echo '=== SETUP: a brand-new user with zero restaurants ==='
insert into auth.users (id, email) values
  ('66666666-6666-6666-6666-666666666666', 'new.owner@example.com')
on conflict (id) do nothing;

\echo ''
\echo '=== TEST A: new user creates their own organization directly (client-side) ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
insert into public.organizations (id, name, owner_user_id)
values ('77777777-0000-0000-0000-000000000001', 'Brand New Bistro Group', '66666666-6666-6666-6666-666666666666');
\echo '^^^ expected: INSERT 1 (RLS allows it -- they are setting themselves as owner_user_id)'

\echo ''
\echo '=== TEST B: same user creates a restaurant under that org directly ==='
insert into public.restaurants (id, organization_id, name, slug, city, country_code, timezone)
values ('88888888-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001',
        'Brand New Bistro', 'brand-new-bistro', 'Munich', 'DE', 'Europe/Berlin');
\echo '^^^ expected: INSERT 1 (RLS allows it -- is_org_owner() passes)'

\echo ''
\echo '=== TEST C: same user tries to insert their OWN owner membership directly -- THE GAP ==='
insert into public.restaurant_users (restaurant_id, user_id, role)
values ('88888888-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666', 'owner');
\echo '^^^ expected: ERROR - new row violates row-level security policy (proves the gap: no existing owner/manager row -> has_restaurant_role() is false for everyone, including themselves)'
reset role;

\set ON_ERROR_STOP on
\echo ''
\echo '=== TEST D: the SAME insert, run as postgres (simulating the service-role Edge Function) ==='
insert into public.restaurant_users (restaurant_id, user_id, role, joined_at)
values ('88888888-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666', 'owner', now());
insert into public.audit_logs (organization_id, restaurant_id, actor_type, actor_user_id, action, entity_type, entity_id, after_data)
values ('77777777-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000001', 'system',
        '66666666-6666-6666-6666-666666666666', 'restaurant.bootstrapped', 'restaurant',
        '88888888-0000-0000-0000-000000000001', jsonb_build_object('name', 'Brand New Bistro'));
select 'TEST D PASSED: service-role insert + audit log succeed' as result;

\echo ''
\echo '=== TEST E: the user can now see their own restaurant (membership is active) ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
select count(*) as visible_restaurants_after_bootstrap from public.restaurants where id = '88888888-0000-0000-0000-000000000001';
\echo '^^^ expected: 1'
reset role;

\echo ''
\echo '=== TEST F: an EXISTING owner (Athens) invites a new staff member directly (no service role needed for THIS part) ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false); -- Athens owner from seed.sql
insert into public.restaurant_users (restaurant_id, user_id, role, invited_at)
values ('bbbbbbbb-0000-0000-0000-000000000001', '66666666-6666-6666-6666-666666666666', 'staff', now());
select 'TEST F PASSED: an existing owner CAN directly insert a new staff row for someone else' as result;
reset role;

\echo ''
\echo '=== CLEANUP ==='
delete from public.restaurant_users where user_id = '66666666-6666-6666-6666-666666666666';
delete from public.audit_logs where actor_user_id = '66666666-6666-6666-6666-666666666666';
delete from public.restaurants where id = '88888888-0000-0000-0000-000000000001';
delete from public.organizations where id = '77777777-0000-0000-0000-000000000001';
delete from auth.users where id = '66666666-6666-6666-6666-666666666666';
select 'cleanup done' as result;
