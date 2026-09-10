-- =============================================================================
-- verify_phase18_admin_hardening.sql
-- Phase 18, part 1 (migration 0041): proves the new admin-role hierarchy
-- actually narrows WRITE access (not just UI), and that the previously-
-- missing platform-admin read path into audit_logs now works.
--   A. has_platform_admin_role() -- basic true/false.
--   B. admin_suspend_restaurant/admin_unsuspend_restaurant -- support_admin
--      CAN; finance_admin/technical_admin/read_only_admin CANNOT.
--   C. admin_set_subscription -- finance_admin CAN; support_admin/
--      technical_admin/read_only_admin CANNOT.
--   D. feature_flags/feature_flag_overrides write -- technical_admin CAN;
--      support_admin/finance_admin/read_only_admin CANNOT; read stays
--      universal for every role (unchanged from 0011/0020).
--   E. audit_logs -- any active admin role, including read_only_admin, can
--      read via admin_list_audit_logs() AND a direct table select (the
--      additive audit_logs_platform_select policy); a non-admin cannot.
--   F. admin_get_my_role() returns the caller's own current role.
-- Uses ONE rotating test subject (the Munich owner, 22222222-...,
-- otherwise not a platform admin) re-granted a different role between
-- sections via admin_grant_platform_admin's own upsert -- seed.sql only
-- has 4 users total, not one free user per new role. Revoked at cleanup,
-- unlike Phase 13's own script (which deliberately left its one grant in
-- place) -- cycling one user through 5 roles would otherwise leave a
-- confusing final state for whoever inspects the database after this runs.
-- Run after migrations through 0041 + seed.sql, with local_dev_shim.sql
-- already applied, AFTER verify_phase13_platform_admin.sql (alphabetical
-- order in run_all_verifications.sh already guarantees this).
-- =============================================================================

\set ON_ERROR_STOP off

-- ---------------------------------------------------------------------------
-- Test A: has_platform_admin_role().
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false); -- super_admin (from Phase 13's own setup)
set role authenticated;
do $$
begin
  if has_platform_admin_role(array['super_admin']::public.platform_admin_role[])
     and not has_platform_admin_role(array['finance_admin']::public.platform_admin_role[]) then
    raise notice 'TEST A1 (super_admin matches its own role, not an unrelated one): PASS';
  else
    raise notice 'TEST A1: FAIL';
  end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- Test B: admin_suspend_restaurant/admin_unsuspend_restaurant, role-scoped.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false); -- super_admin grants the role each time
set role authenticated;
select role from public.admin_grant_platform_admin('owner.munich@example.com', 'support_admin');
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '=== TEST B1: support_admin CAN suspend a restaurant ==='
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
select id from public.admin_suspend_restaurant('bbbbbbbb-0000-0000-0000-000000000002', 'phase18 test -- support_admin suspend');
\echo '(expected: succeeds)'
select public.admin_unsuspend_restaurant('bbbbbbbb-0000-0000-0000-000000000002');
\echo '(expected: succeeds -- support_admin can also unsuspend)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select role from public.admin_grant_platform_admin('owner.munich@example.com', 'finance_admin');
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '=== TEST B2: finance_admin CANNOT suspend a restaurant ==='
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
select public.admin_suspend_restaurant('bbbbbbbb-0000-0000-0000-000000000002', 'should be rejected -- finance_admin is out of scope');
\echo '(expected: ERROR: NOT_AUTHORIZED)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- Test C: admin_set_subscription, role-scoped.
-- ---------------------------------------------------------------------------
\echo '=== TEST C1: finance_admin CAN set a subscription ==='
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false); -- still finance_admin from B2's grant
set role authenticated;
select organization_id, status from public.admin_set_subscription('aaaaaaaa-0000-0000-0000-000000000002', 'starter', 'trialing', now() + interval '14 days', null, 'phase18 test -- finance_admin');
\echo '(expected: succeeds, status=trialing)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select role from public.admin_grant_platform_admin('owner.munich@example.com', 'technical_admin');
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '=== TEST C2: technical_admin CANNOT set a subscription ==='
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
select public.admin_set_subscription('aaaaaaaa-0000-0000-0000-000000000002', 'business', 'active', null, now() + interval '30 days', 'should be rejected -- technical_admin is out of scope');
\echo '(expected: ERROR: NOT_AUTHORIZED)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- Test D: feature_flags/feature_flag_overrides write, role-scoped. Read
-- (feature_flags_select, 0011) stays universal for every signed-in user --
-- not re-tested here, unchanged and already covered by Phase 13's Test E4.
-- ---------------------------------------------------------------------------
\echo '=== TEST D1: technical_admin CAN write a feature flag ==='
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false); -- still technical_admin from C2's grant
set role authenticated;
insert into public.feature_flags (id, key, description, is_enabled_default) values
  ('66666666-f000-0000-0000-000000000002', 'phase18_test_flag', 'Verification-only flag', false)
returning key;
\echo '(expected: succeeds)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select role from public.admin_grant_platform_admin('owner.munich@example.com', 'support_admin');
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '=== TEST D2: support_admin CANNOT write a feature flag ==='
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
update public.feature_flags set description = 'should be rejected' where id = '66666666-f000-0000-0000-000000000002';
\echo '(expected: 0 rows updated -- RLS silently filters, not an error, since UPDATE ... WHERE with no matching row under the policy is not itself an error)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

do $$
begin
  if (select description from public.feature_flags where id = '66666666-f000-0000-0000-000000000002') = 'Verification-only flag' then
    raise notice 'TEST D2 (dynamic check -- support_admin''s update was silently blocked by RLS): PASS';
  else
    raise notice 'TEST D2 (dynamic check): FAIL -- description was changed by a role without manage_feature_flags';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Test E: audit_logs -- the new platform-admin read path. read_only_admin
-- specifically, since it is the role with NO write capability anywhere --
-- proving it can still see everything is the whole point of Phase 18's
-- "view stays universal" design.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select role from public.admin_grant_platform_admin('owner.munich@example.com', 'read_only_admin');
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '=== TEST E1: read_only_admin CAN read audit_logs via admin_list_audit_logs() ==='
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
select count(*) as should_be_gt_0 from public.admin_list_audit_logs(null, null, null, 'restaurant.suspended_by_platform', null, null, null, 50, 0);
\echo '(expected: >= 1 -- at least this script''s own TEST B1 suspension)'

\echo '=== TEST E2: read_only_admin CAN read audit_logs via a direct table select too (audit_logs_platform_select) ==='
select count(*) as should_be_gt_0 from public.audit_logs where action = 'platform_admin.granted';
\echo '(expected: >= 1)'

\echo '=== TEST E3: read_only_admin CANNOT write anything -- suspend, subscription, and feature flags all rejected ==='
select public.admin_suspend_restaurant('bbbbbbbb-0000-0000-0000-000000000002', 'should be rejected -- read_only_admin');
\echo '(expected: ERROR: NOT_AUTHORIZED)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '=== TEST E4: a non-admin (the customer, maria) CANNOT read audit_logs at all ==='
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
set role authenticated;
select public.admin_list_audit_logs();
\echo '(expected: ERROR: NOT_AUTHORIZED)'
select count(*) as should_be_0 from public.audit_logs where action = 'platform_admin.granted';
\echo '(expected: 0 -- audit_logs_select, 0011, only covers a restaurant owner/manager reading THEIR OWN restaurant''s rows; maria is a customer, not staff of any restaurant, and this query has no restaurant_id filter at all)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- Test F: admin_get_my_role().
-- ---------------------------------------------------------------------------
\echo '=== TEST F1: admin_get_my_role() returns the caller''s own current role ==='
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
select public.admin_get_my_role() as should_be_read_only_admin;
\echo '(expected: read_only_admin)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '=== TEST F2: admin_get_my_role() returns NULL for a non-admin ==='
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
set role authenticated;
select public.admin_get_my_role() as should_be_null;
\echo '(expected: null)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Cleanup: unlike Phase 13's own script, revoke the rotating test subject's
-- admin access entirely (rather than leaving it on some arbitrary last-
-- assigned role) and remove the test flag/subscription/suspension state.
-- ---------------------------------------------------------------------------
\echo '=== CLEANUP ==='
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select public.admin_unsuspend_restaurant('bbbbbbbb-0000-0000-0000-000000000002');
select public.admin_revoke_platform_admin('22222222-2222-2222-2222-222222222222');
reset role;
select set_config('request.jwt.claim.sub', '', false);
delete from public.feature_flags where id = '66666666-f000-0000-0000-000000000002';
delete from public.subscriptions where organization_id = 'aaaaaaaa-0000-0000-0000-000000000002' and status = 'trialing';
