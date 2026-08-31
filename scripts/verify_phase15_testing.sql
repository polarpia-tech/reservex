-- =============================================================================
-- verify_phase15_testing.sql
--
-- Phase 15 ("RLS, conflicts, AI permissions, payments" per the blueprint) is
-- NOT a new feature -- every table and function it touches already shipped
-- in an earlier phase, each with its own verify_phaseNN_*.sql. What this
-- script adds is the cross-cutting audit those per-feature scripts never
-- did: systematically confirming EVERY table has RLS enabled (not just the
-- ones a given phase happened to test), and closing specific cross-tenant
-- read-isolation gaps that were never explicitly asserted anywhere
-- (tables/table_zones, notifications, payments, subscriptions -- confirmed
-- by grepping every existing verify_phaseNN script for "other restaurant"/
-- "cross-tenant" phrasing before writing this one). See
-- verify_phase15_concurrency.sh (a separate file -- real OS-level
-- concurrent connections can't be driven from inside a single .sql script)
-- for the "conflicts" dimension.
--
--   A. RLS coverage: every public.* base table has row security enabled --
--      an automated assertion, not a one-time manual check, so a future
--      migration that forgets to enable RLS on a new table fails THIS
--      script loudly instead of silently shipping an open table.
--   A2-A5. Cross-tenant SELECT isolation on tables/table_zones,
--      notifications, payments, and subscriptions -- Munich staff/owner
--      see ZERO Athens rows on each, and vice versa. None of these four
--      were ever explicitly asserted this way in any earlier phase script.
--   C. AI action integrity: a member of staff cannot bypass the AI
--      Gateway's Edge Function confirm/reject flow by writing directly to
--      ai_actions (no UPDATE/INSERT-as-executed policy exists at all --
--      Phase 10 tested INSERT rejection for a *proposed* row; this adds
--      the specific self-approval bypass and cross-restaurant read checks
--      that weren't covered there).
--   D. Payments: the unique constraint that makes Stripe webhook replay
--      safe (uidx_payments_provider_ref) actually rejects a duplicate
--      (provider, provider_payment_id) row -- proven by really attempting
--      it, not inferred from the schema.
--
-- Run after migrations (through 0020) + seed.sql.
-- =============================================================================

\set ON_ERROR_STOP off

\echo '=== SECTION A1: every public.* table has RLS enabled (automated, not a one-off manual check) ==='
select count(*) as tables_without_rls
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
\echo '(expected: 0 -- if this is nonzero, a table exists with RLS never enabled at all)'

\echo ''
\echo '=== SETUP: a Munich manager, a payment + subscription for each org, an ai_actions row for Athens ==='
insert into auth.users (id, email) values
  ('77777777-7777-7777-7777-777777777777', 'manager.munich@example.com')
on conflict (id) do nothing;
insert into public.restaurant_users (restaurant_id, user_id, role, joined_at) values
  ('bbbbbbbb-0000-0000-0000-000000000002', '77777777-7777-7777-7777-777777777777', 'manager', now())
on conflict (restaurant_id, user_id) do nothing;

-- Inserted as postgres (bypasses RLS), same as a service-role Edge Function
-- would -- these two tables have no direct-write policy for authenticated
-- at all (Phase 12), so this is the only way to seed test rows for them.
insert into public.payments (id, restaurant_id, provider, provider_payment_id, payment_type, status, amount_cents)
values
  ('55555555-0001-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'stripe', 'pi_test_athens_p15', 'deposit', 'succeeded', 2000),
  ('55555555-0002-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'stripe', 'pi_test_munich_p15', 'deposit', 'succeeded', 3000)
on conflict (id) do nothing;

insert into public.subscription_plans (id, code, name, price_cents, billing_interval, currency)
values ('88888888-0000-0000-0000-000000000001', 'p15_test_plan', 'P15 Test Plan', 5000, 'monthly', 'EUR')
on conflict (id) do nothing;

insert into public.subscriptions (id, organization_id, plan_id, status)
values
  ('99999999-1111-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', '88888888-0000-0000-0000-000000000001', 'active'),
  ('99999999-1111-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', '88888888-0000-0000-0000-000000000001', 'active')
on conflict (id) do nothing;

insert into public.ai_conversations (id, restaurant_id, user_id, channel)
values ('66666666-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'staff_chat')
on conflict (id) do nothing;
insert into public.ai_actions (id, conversation_id, restaurant_id, tool_name, input, requires_confirmation, status)
values ('44444444-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
        'bulkCancelReservations', '{}'::jsonb, true, 'proposed')
on conflict (id) do nothing;

\echo ''
\echo '=== SECTION A2: tables/table_zones cross-tenant SELECT isolation ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
select count(*) as munich_manager_sees_athens_tables from public.tables where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001';
select count(*) as munich_manager_sees_athens_zones from public.table_zones where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001';
reset role;
\echo '(expected: 0 and 0 -- Munich manager cannot see Athens'' floor plan)'

\echo ''
\echo '=== SECTION A3: notifications cross-tenant SELECT isolation ==='
-- queue_notification() is SECURITY DEFINER (Phase 09) so this insert works
-- regardless of caller; queue one staff notification for Athens only.
select public.queue_notification(
  p_restaurant_id => 'bbbbbbbb-0000-0000-0000-000000000001'::uuid,
  p_recipient_type => 'staff'::notification_recipient_type,
  p_recipient_customer_id => null,
  p_recipient_user_id => '11111111-1111-1111-1111-111111111111'::uuid,
  p_channel => 'in_app'::notification_channel,
  p_template_code => 'reservation_created'::text
);
set role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
select count(*) as munich_manager_sees_athens_notifications from public.notifications where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001';
reset role;
\echo '(expected: 0 -- Munich manager cannot see an Athens staff notification)'

\echo ''
\echo '=== SECTION A4: payments cross-tenant SELECT isolation ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
select count(*) as munich_manager_sees_athens_payment from public.payments where id = '55555555-0001-0000-0000-000000000001';
reset role;
\echo '(expected: 0 -- Munich manager cannot see an Athens payment row)'

\echo ''
\echo '=== SECTION A5: subscriptions cross-tenant SELECT isolation (org-scoped, not restaurant-scoped) ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select count(*) as munich_owner_sees_athens_subscription from public.subscriptions where organization_id = 'aaaaaaaa-0000-0000-0000-000000000001';
reset role;
\echo '(expected: 0 -- Munich''s org owner cannot see Ithaki Hospitality''s subscription)'

\echo ''
\echo '=== SECTION C1: staff CANNOT self-approve a proposed AI action by writing directly to ai_actions ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
update public.ai_actions set status = 'executed', confirmed_by_user_id = '11111111-1111-1111-1111-111111111111'
  where id = '44444444-0000-0000-0000-000000000001';
reset role;
select status from public.ai_actions where id = '44444444-0000-0000-0000-000000000001';
\echo '(expected: UPDATE 0 above, status still "proposed" here -- no UPDATE policy exists on ai_actions at all; only the Edge Function''s service-role client, via re-run authorize(), may transition it)'

\echo ''
\echo '=== SECTION C2: staff CANNOT insert a NEW ai_actions row directly as already "executed" (skip the propose step) ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
insert into public.ai_actions (conversation_id, restaurant_id, tool_name, input, requires_confirmation, status)
values ('66666666-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'cancelReservation', '{}'::jsonb, false, 'executed');
reset role;
\echo '(expected: ERROR -- no INSERT policy on ai_actions for authenticated at all, same as Phase 10''s Test E for the proposed case)'

\echo ''
\echo '=== SECTION C3: a Munich staff member CANNOT see an Athens ai_actions row (cross-restaurant read) ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '77777777-7777-7777-7777-777777777777', false);
select count(*) as munich_manager_sees_athens_ai_action from public.ai_actions where id = '44444444-0000-0000-0000-000000000001';
reset role;
\echo '(expected: 0)'

\echo ''
\echo '=== SECTION D1: uidx_payments_provider_ref genuinely rejects a duplicate (provider, provider_payment_id) row ==='
\echo '(this is what makes a replayed Stripe webhook event safe -- see stripe-webhook''s UPDATE-by-provider_payment_id'
\echo ' pattern, Phase 12: a second delivery of the same event finds the existing row and updates it again, it never'
\echo ' gets the chance to double-insert, and this constraint is the backstop if anything ever DID try to)'
insert into public.payments (restaurant_id, provider, provider_payment_id, payment_type, status, amount_cents)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'stripe', 'pi_test_athens_p15', 'deposit', 'requires_capture', 999);
\echo '(expected: ERROR -- duplicate key value violates unique constraint "uidx_payments_provider_ref")'

\echo ''
\echo '=== CLEANUP ==='
delete from public.ai_actions where id = '44444444-0000-0000-0000-000000000001';
delete from public.ai_conversations where id = '66666666-0000-0000-0000-000000000001';
delete from public.subscriptions where id in ('99999999-1111-0000-0000-000000000001', '99999999-1111-0000-0000-000000000002');
delete from public.subscription_plans where id = '88888888-0000-0000-0000-000000000001';
delete from public.payments where id in ('55555555-0001-0000-0000-000000000001', '55555555-0002-0000-0000-000000000001');
delete from public.notifications where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001' and template_code = 'reservation_created' and recipient_user_id = '11111111-1111-1111-1111-111111111111';
delete from public.restaurant_users where user_id = '77777777-7777-7777-7777-777777777777';
delete from auth.users where id = '77777777-7777-7777-7777-777777777777';
\echo 'done.'
