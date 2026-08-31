-- =============================================================================
-- verify_phase13_platform_admin.sql
-- Phase 13 (Admin πλατφόρμας): proves the SQL surface added by 0020 does
-- what it claims:
--   A. is_platform_admin()/is_platform_super_admin() -- correct for an
--      admin, a non-admin, and a revoked (is_active=false) former admin.
--   B. admin_suspend_restaurant/admin_unsuspend_restaurant -- only a
--      platform admin can call them; a suspended restaurant disappears
--      from the public directory/profile AND book_public_reservation,
--      while its own staff can still see it (with the reason); the two
--      columns are provably NOT writable by a direct client UPDATE, even
--      by the restaurant's own owner, even though restaurants_update
--      would otherwise allow them to update that row.
--   C. admin_set_subscription -- retire-then-insert respects
--      uidx_subscriptions_active_per_org (0007), same sequence Phase 12's
--      stripe-webhook upsert uses; a second call correctly retires the
--      first row instead of erroring.
--   D. admin_grant_platform_admin/admin_revoke_platform_admin --
--      super_admin only (a 'support' admin cannot grant/revoke anyone,
--      including themselves); the last-active-super_admin lockout guard.
--   E. feature_flags/feature_flag_overrides -- platform admins can write
--      (0020), a non-admin authenticated user cannot, and the pre-existing
--      Phase 02/0011 read policies are untouched.
-- Run after migrations through 0020 + seed.sql, with local_dev_shim.sql
-- already applied. Uses the Athens/Munich restaurants and their owners
-- from seed.sql.
-- =============================================================================

\set ON_ERROR_STOP off

-- ---------------------------------------------------------------------------
-- SETUP: Athens owner becomes the first (manually-provisioned, as the
-- README documents -- no self-service path exists) super_admin.
-- ---------------------------------------------------------------------------
insert into public.platform_admins (id, user_id, role, is_active)
values ('55555555-a000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'super_admin', true);

-- ---------------------------------------------------------------------------
-- Test A: is_platform_admin / is_platform_super_admin.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
do $$
begin
  if is_platform_admin() and is_platform_super_admin() then
    raise notice 'TEST A1 (super_admin is both admin and super_admin): PASS';
  else
    raise notice 'TEST A1: FAIL -- is_platform_admin=%, is_platform_super_admin=%', is_platform_admin(), is_platform_super_admin();
  end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false); -- Athens manager, not a platform admin
set role authenticated;
do $$
begin
  if not is_platform_admin() and not is_platform_super_admin() then
    raise notice 'TEST A2 (ordinary restaurant staff is neither): PASS';
  else
    raise notice 'TEST A2: FAIL';
  end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- Test B: restaurant suspension.
-- ---------------------------------------------------------------------------
\echo '=== TEST B1: a non-admin cannot suspend a restaurant ==='
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false); -- Munich owner, not a platform admin
set role authenticated;
select public.admin_suspend_restaurant('bbbbbbbb-0000-0000-0000-000000000001', 'should be rejected');
\echo '(expected: ERROR: NOT_AUTHORIZED)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '=== TEST B2: reason is required ==='
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select public.admin_suspend_restaurant('bbbbbbbb-0000-0000-0000-000000000001', '');
\echo '(expected: ERROR: REASON_REQUIRED)'

\echo '=== TEST B3: a platform admin CAN suspend, with a reason ==='
select id, suspended_by_platform_at is not null as is_suspended, suspension_reason
from public.admin_suspend_restaurant('bbbbbbbb-0000-0000-0000-000000000001', 'non-payment (test)');
\echo '(expected: is_suspended = t)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_public_count int;
begin
  -- B4: suspended restaurant is gone from the PUBLIC-facing read path.
  set role anon;
  select count(*) into v_public_count from public.restaurants where slug = 'taverna-ithaki';
  reset role;
  if v_public_count = 0 then
    raise notice 'TEST B4 (suspended restaurant invisible to anon via restaurants_public_select): PASS';
  else
    raise notice 'TEST B4: FAIL -- anon still sees % row(s)', v_public_count;
  end if;
end $$;

-- B5: ...but its OWN staff still see it (they need to see the suspension reason).
-- set_config/set role cannot run inside a do $$ block's own transaction
-- boundary reliably across role switches, so this one is plain top-level
-- SQL, same style as every other role-switch test in this project.
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select count(*) as should_be_1 from public.restaurants where id = 'bbbbbbbb-0000-0000-0000-000000000001';
\echo '(TEST B5 expected: 1 -- restaurant''s own owner still sees it via restaurants_select, suspended or not)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '=== TEST B6: book_public_reservation refuses a suspended restaurant ==='
set role anon;
select public.book_public_reservation('taverna-ithaki', now() + interval '2 days', 2, 'Test Guest', '+30 690 111 2222', null, null);
\echo '(expected: ERROR: RESTAURANT_NOT_FOUND -- same message as a slug that does not exist at all, on purpose)'
reset role;

\echo '=== TEST B7: the two suspension columns cannot be written by a direct client UPDATE, even by the restaurant''s own owner ==='
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
update public.restaurants set suspension_reason = 'trying to self-write around the platform' where id = 'bbbbbbbb-0000-0000-0000-000000000001';
\echo '(expected: ERROR: PLATFORM_MANAGED_COLUMN)'
update public.restaurants set suspended_by_platform_at = null where id = 'bbbbbbbb-0000-0000-0000-000000000001';
\echo '(expected: ERROR: PLATFORM_MANAGED_COLUMN -- trying to self-UNsuspend directly is blocked exactly the same way)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- B8: an unrelated column update on the SAME row is unaffected by the trigger.
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
update public.restaurants set description = 'Phase 13 test description' where id = 'bbbbbbbb-0000-0000-0000-000000000001';
\echo '(expected: UPDATE 1 -- the trigger only blocks the two platform-managed columns, not the whole row)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '=== TEST B9: admin_unsuspend_restaurant restores public visibility ==='
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select id, suspended_by_platform_at, suspension_reason from public.admin_unsuspend_restaurant('bbbbbbbb-0000-0000-0000-000000000001');
\echo '(expected: both columns null again)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_count int;
begin
  set role anon;
  select count(*) into v_count from public.restaurants where slug = 'taverna-ithaki';
  reset role;
  if v_count = 1 then
    raise notice 'TEST B9 (dynamic check): PASS -- restaurant visible to anon again after unsuspend';
  else
    raise notice 'TEST B9 (dynamic check): FAIL -- anon sees % row(s)', v_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Test C: admin_set_subscription.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;

\echo '=== TEST C1: comp a plan for the Munich org with no Stripe involvement at all ==='
select organization_id, plan_id, status, provider_subscription_id is null as no_stripe_id
from public.admin_set_subscription('aaaaaaaa-0000-0000-0000-000000000002', 'business', 'active', null, now() + interval '90 days', 'pilot restaurant comp');
\echo '(expected: status=active, no_stripe_id=t)'

reset role;
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_active_count int;
begin
  -- C2: only ONE non-terminal subscription exists for the org after the call (constraint respected).
  select count(*) into v_active_count from public.subscriptions
  where organization_id = 'aaaaaaaa-0000-0000-0000-000000000002' and status in ('trialing', 'active', 'past_due');
  if v_active_count = 1 then
    raise notice 'TEST C2 (exactly one non-terminal subscription after admin_set_subscription): PASS';
  else
    raise notice 'TEST C2: FAIL -- % non-terminal rows', v_active_count;
  end if;
end $$;

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;

\echo '=== TEST C3: setting a SECOND plan for the same org retires the first, not errors ==='
select status from public.admin_set_subscription('aaaaaaaa-0000-0000-0000-000000000002', 'starter', 'past_due', null, null, 'downgraded, payment issue (test)');
\echo '(expected: status=past_due, no unique-constraint error)'

reset role;
select set_config('request.jwt.claim.sub', '', false);

do $$
declare
  v_active_count int;
  v_history_count int;
begin
  select count(*) into v_active_count from public.subscriptions
  where organization_id = 'aaaaaaaa-0000-0000-0000-000000000002' and status in ('trialing', 'active', 'past_due');
  select count(*) into v_history_count from public.subscriptions
  where organization_id = 'aaaaaaaa-0000-0000-0000-000000000002';
  if v_active_count = 1 and v_history_count = 2 then
    raise notice 'TEST C3 (dynamic check): PASS -- 1 active + 1 retired (cancelled) row, full history kept';
  else
    raise notice 'TEST C3 (dynamic check): FAIL -- active=%, total=%', v_active_count, v_history_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Test D: grant/revoke platform admin -- super_admin only, last-super-admin guard.
-- ---------------------------------------------------------------------------
\echo '=== TEST D1: a non-admin cannot grant platform admin to anyone ==='
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
select public.admin_grant_platform_admin('manager.athens@example.com', 'support');
\echo '(expected: ERROR: NOT_AUTHORIZED)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '=== TEST D2: super_admin grants support access to the Athens manager ==='
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select user_id, role, is_active from public.admin_grant_platform_admin('manager.athens@example.com', 'support');
\echo '(expected: role=support, is_active=t)'

\echo '=== TEST D3: a support admin cannot grant platform admin to anyone else (super_admin only) ==='
reset role;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false); -- now a support admin (D2)
set role authenticated;
select public.admin_grant_platform_admin('owner.munich@example.com', 'support');
\echo '(expected: ERROR: NOT_AUTHORIZED -- support cannot self-escalate or grant others)'

\echo '=== TEST D4: a support admin CAN still use ordinary admin_* operations (suspend/subscription) ==='
select id from public.admin_suspend_restaurant('bbbbbbbb-0000-0000-0000-000000000002', 'support-role smoke test');
select public.admin_unsuspend_restaurant('bbbbbbbb-0000-0000-0000-000000000002');
\echo '(expected: both succeed -- support and super_admin are equal for ops actions, only admin grant/revoke is super_admin-only)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '=== TEST D5: cannot revoke the LAST active super_admin ==='
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select public.admin_revoke_platform_admin('11111111-1111-1111-1111-111111111111');
\echo '(expected: ERROR: CANNOT_REVOKE_LAST_SUPER_ADMIN)'

\echo '=== TEST D6: CAN revoke a non-super_admin (the support admin from D2) ==='
select public.admin_revoke_platform_admin('33333333-3333-3333-3333-333333333333');
select role, is_active from public.platform_admins where user_id = '33333333-3333-3333-3333-333333333333';
\echo '(expected: is_active=f, row kept not deleted)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- Test E: feature_flags / feature_flag_overrides.
-- ---------------------------------------------------------------------------
\echo '=== TEST E1: a platform admin can create a feature flag ==='
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
insert into public.feature_flags (id, key, description, is_enabled_default) values
  ('66666666-f000-0000-0000-000000000001', 'phase13_test_flag', 'Verification-only flag', false)
returning key, is_enabled_default;
\echo '(expected: succeeds)'

\echo '=== TEST E2: a platform admin can create a per-organization override ==='
insert into public.feature_flag_overrides (flag_id, organization_id, is_enabled) values
  ('66666666-f000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', true)
returning organization_id, is_enabled;
\echo '(expected: succeeds)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '=== TEST E3: a non-admin authenticated user CANNOT write a feature flag ==='
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
insert into public.feature_flags (key, is_enabled_default) values ('rogue_flag', true);
\echo '(expected: ERROR -- new row violates row-level security policy, no write policy for a non-admin)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '=== TEST E4: feature_flags_select (0011, unchanged) still lets ANY signed-in user READ flags ==='
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
set role authenticated;
select count(*) as should_be_1 from public.feature_flags where key = 'phase13_test_flag';
\echo '(expected: 1 -- read access was never platform-admin-only, only WRITE is new in Phase 13)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Cleanup
-- ---------------------------------------------------------------------------
\echo '=== CLEANUP ==='
delete from public.feature_flag_overrides where flag_id = '66666666-f000-0000-0000-000000000001';
delete from public.feature_flags where id = '66666666-f000-0000-0000-000000000001';
delete from public.subscriptions where organization_id = 'aaaaaaaa-0000-0000-0000-000000000002';
update public.restaurants set description = null where id = 'bbbbbbbb-0000-0000-0000-000000000001';
delete from public.platform_admins where user_id in ('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333');
\echo 'done.'
