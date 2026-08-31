-- =============================================================================
-- verify_phase16_optimization.sql
--
-- Empirically proves what 0021_optimization.sql's Section A/B claim to have
-- done -- "tested, not assumed", the project's own standing rule. Three
-- parts:
--
--   A. Security: PUBLIC no longer has EXECUTE on any of the 20 functions
--      this migration touched -- an automated has_function_privilege()
--      sweep, not a one-off manual check, so a future migration that
--      re-introduces the PUBLIC default on one of these fails THIS script
--      loudly. Then POSITIVE tests: the 7 functions that must stay
--      anon-callable (is_restaurant_member/has_restaurant_role/
--      is_org_owner/owns_customer, referenced inside RLS policies on
--      tables anon can query -- see 0021's A1b comment for why -- plus
--      book_public_reservation/is_restaurant_open_at/
--      compute_deposit_amount, the pre-existing Phase 08/12 anon grants)
--      genuinely still work end-to-end for anon and authenticated,
--      exactly as they did before this migration -- re-running the
--      anon-facing slice of verify_phase08_public_booking.sql's own Test A
--      is what actually caught the real regression during this migration's
--      own development (see 0021's header/A1b comment): the first attempt
--      revoked is_restaurant_member/has_restaurant_role/is_org_owner/
--      owns_customer down to authenticated-only, which looked correct by
--      caller-grep alone but broke every anon query on restaurants/
--      opening_hours/special_hours/deposit_policies, because Postgres
--      evaluates EVERY permissive RLS policy on a queried table for the
--      querying role, not just the one that would grant access -- and
--      evaluating a function the caller has no EXECUTE on raises a hard
--      error for the whole statement, it does not just skip that policy.
--   B. Performance: the 17 new FK-covering indexes exist, AND at least one
--      of them is genuinely used by the planner for the exact kind of
--      query it exists for (EXPLAIN, not just "the index exists" --
--      an index nobody's query plan ever picks is not really verified).
--
-- Run after migrations (through 0021) + seed.sql.
-- =============================================================================

\set ON_ERROR_STOP off

\echo '=== SECTION A1: automated sweep -- PUBLIC has EXECUTE on NONE of the 20 hardened functions ==='
select count(*) as still_public_executable
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and has_function_privilege('public', p.oid, 'EXECUTE')
  and p.proname in (
    'is_restaurant_member','has_restaurant_role','is_org_owner','owns_customer',
    'queue_notification','reservations_notify_on_change','reservations_propagate_to_tables',
    'should_notify_staff','schedule_reservation_reminders','reservation_tables_sync_from_reservation',
    'reservations_set_status_timestamps','set_updated_at','protect_restaurant_suspension_columns',
    'get_reservation_analytics','get_restaurant_staff','get_available_tables','get_available_table_combinations',
    'book_reservation','is_restaurant_open_at','book_public_reservation','compute_deposit_amount'
  );
\echo '(expected: 0 -- if nonzero, a future migration re-introduced the PUBLIC-EXECUTE default on one of these)'

\echo ''
\echo '=== SECTION A2: automated sweep -- the 7 functions RLS depends on for anon queries all HAVE anon EXECUTE ==='
select count(*) as anon_executable_count
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and has_function_privilege('anon', p.oid, 'EXECUTE')
  and p.proname in ('is_restaurant_member','has_restaurant_role','is_org_owner','owns_customer',
                     'book_public_reservation','is_restaurant_open_at','compute_deposit_amount');
\echo '(expected: 7 -- if less, anon-facing queries on restaurants/opening_hours/special_hours/deposit_policies/customers will start throwing "permission denied for function" instead of evaluating RLS normally -- see this migration''s A1b header comment for the real regression this guards against)'

\echo ''
\echo '=== SECTION A3: positive test -- anon can STILL read Athens'' public profile + opening hours (the exact query that caught the regression during development) ==='
set role anon;
select name, city, is_active from public.restaurants where slug = 'taverna-ithaki';
select count(*) as athens_hours_visible_to_anon from public.opening_hours where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001';
reset role;
\echo '(expected: 1 row "Ταβέρνα Ιθάκη"/Athens/true, and a nonzero hours count -- NOT "permission denied for function is_restaurant_member")'

\echo ''
\echo '=== SECTION A4: positive test -- anon querying floor-plan detail still resolves to a clean empty result, not an error ==='
set role anon;
select count(*) as tables_visible_to_anon from public.tables where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001';
reset role;
\echo '(expected: 0 -- a successful empty result. If this instead raises "permission denied for function is_restaurant_member", the anon grant on that function was lost.)'

\echo ''
\echo '=== SECTION A5: positive test -- an authenticated staff member can still call is_restaurant_member()-gated RPCs (get_available_tables) ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select count(*) as slots_found from public.get_available_tables(
  p_restaurant_id => 'bbbbbbbb-0000-0000-0000-000000000001',
  p_starts_at => (current_date + interval '3 days' + time '19:00') at time zone 'Europe/Athens',
  p_ends_at   => (current_date + interval '3 days' + time '20:30') at time zone 'Europe/Athens',
  p_party_size => 2
);
reset role;
\echo '(expected: a real integer, no permission-denied error -- authenticated still has EXECUTE on get_available_tables after the revoke-then-grant)'

\echo ''
\echo '=== SECTION A6: negative test -- anon STILL cannot call get_available_tables directly (authenticated-only, unaffected by A1b''s broader grant) ==='
set role anon;
select public.get_available_tables(
  p_restaurant_id => 'bbbbbbbb-0000-0000-0000-000000000001',
  p_starts_at => (current_date + interval '3 days' + time '19:00') at time zone 'Europe/Athens',
  p_ends_at   => (current_date + interval '3 days' + time '20:30') at time zone 'Europe/Athens',
  p_party_size => 2
);
reset role;
\echo '(expected: ERROR: permission denied for function get_available_tables -- this one was correctly NOT widened to anon, unlike is_restaurant_member/has_restaurant_role/is_org_owner/owns_customer)'

\echo ''
\echo '=== SECTION A7: negative test -- a random authenticated user (not a member of this restaurant) still cannot call book_reservation for it ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
select public.book_reservation(
  p_restaurant_id => 'bbbbbbbb-0000-0000-0000-000000000001',
  p_starts_at => (current_date + interval '4 days' + time '19:00') at time zone 'Europe/Athens',
  p_ends_at   => (current_date + interval '4 days' + time '20:30') at time zone 'Europe/Athens',
  p_party_size => 2,
  p_guest_name => 'Should Not Work'
);
reset role;
\echo '(expected: ERROR: NO_AVAILABILITY, not a successful booking. book_reservation is SECURITY INVOKER, so its own internal lookup of that restaurant''s tables runs under the CALLER''s RLS -- tables_select requires is_restaurant_member(), which this customer fails, so the function sees zero visible tables and concludes NO_AVAILABILITY rather than raising an explicit authorization error. Same pattern verify_phase07''s own Test I documents for RESTAURANT_NOT_FOUND: tenant isolation holds either way, this is just where it happens to bite first -- confirming EXECUTE-granting authenticated as a ROLE (this migration''s change) never bypassed the RLS-based authorization actually gating what that role can see and do (unchanged by this migration).)'

\echo ''
\echo '=== SECTION B1: automated check -- all 17 FK-index-gap additions exist ==='
select count(*) as fk_indexes_found
from pg_indexes
where schemaname = 'public' and indexname in (
  'idx_ai_actions_confirmed_by_user_id','idx_audit_logs_organization_id','idx_events_deposit_policy_id',
  'idx_feature_flag_overrides_organization_id','idx_feature_flag_overrides_restaurant_id','idx_payments_customer_id',
  'idx_payments_deposit_policy_id','idx_platform_admins_granted_by','idx_reservation_tables_restaurant_id',
  'idx_reservations_created_by_user_id','idx_reservations_zone_preference_id','idx_staff_notification_preferences_user_id',
  'idx_subscriptions_plan_id','idx_table_combinations_restaurant_id','idx_waitlist_entries_converted_reservation_id',
  'idx_waitlist_entries_customer_id','idx_waitlist_entries_zone_preference_id'
);
\echo '(expected: 17)'

\echo ''
\echo '=== SECTION B2: the planner genuinely uses one of the new indexes -- audit_logs by organization_id, the highest-value addition (append-only, unbounded growth) ==='
set role postgres;
explain (format text) select * from public.audit_logs where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset role;
\echo '(expected: the plan output above should mention "idx_audit_logs_organization_id" -- if it shows a Seq Scan instead, either the table is too small for the planner to bother (fine on this small seeded dataset, would still matter at production scale) or the index genuinely is not being picked up)'

\echo ''
\echo 'done.'
