-- =============================================================================
-- verify_phase10_ai_gateway.sql
-- Phase 10 (AI Gateway) verifies ONLY what can actually be verified in this
-- sandbox: the SQL-level pieces the ai-gateway Edge Function depends on.
-- There is no Deno runtime and no network access to api.anthropic.com here,
-- so the model-calling / tool-selection loop in
-- supabase/functions/ai-gateway/index.ts cannot be exercised end-to-end --
-- see that file's header comment. What this script DOES prove, against
-- real data:
--   A. get_reservation_analytics (0017) returns correct aggregates for a
--      restaurant member, and rejects a non-member with NOT_AUTHORIZED
--      rather than a misleading all-zero result.
--   B. get_reservation_analytics rejects an invalid date range.
--   C. ai_conversations_insert (0011) lets a staff member insert their OWN
--      staff_chat row directly, but rejects a customer_chat row (user_id
--      null) -- confirming the "gap" investigated before writing any Phase
--      10 code is real, and is not being silently papered over.
--   D. ai_messages has NO insert policy for any client role, for ANY
--      channel -- confirming even a direct staff_chat conversation cannot
--      be completed by a client alone; the Edge Function's service-role
--      client is structurally required end-to-end, not just for the
--      customer/voice/whatsapp channels.
--   E. ai_actions has NO insert policy for any client role either.
--   F. The full proposed -> executed ai_actions lifecycle the Edge
--      Function relies on: a service-role-equivalent write can create a
--      conversation + messages + a proposed action, then transition it to
--      executed with confirmed_by_user_id/confirmed_at/executed_at/result
--      all populated -- exactly the sequence handleChat()/
--      handleConfirmOrReject() perform.
--   G. ai_conversations_one_party (0009) still rejects a staff_chat row
--      with no user_id -- the constraint was not weakened by this phase.
--   H. ai_conversations_select visibility: any active staff member of the
--      restaurant can see a colleague's staff_chat conversation (shared,
--      restaurant-scoped visibility -- intended, not a leak); a staff
--      member of a DIFFERENT restaurant cannot.
-- Run after migrations through 0017 + seed.sql, with local_dev_shim.sql
-- already applied.
-- =============================================================================

\set ON_ERROR_STOP off

-- ---------------------------------------------------------------------------
-- Test A: get_reservation_analytics -- member sees correct aggregates.
-- ---------------------------------------------------------------------------
\echo '=== TEST A: get_reservation_analytics, restaurant member ==='
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false); -- owner, Athens
set role authenticated;
select * from public.get_reservation_analytics(
  'bbbbbbbb-0000-0000-0000-000000000001', current_date, current_date + 2
);
\echo '(expected: total_reservations=1, confirmed_count=1, no_show_rate=0, avg_party_size=4.0, total_covers=4 -- the seed reservation, confirmed, party of 4)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '=== TEST A2: get_reservation_analytics, NOT a member -> NOT_AUTHORIZED ==='
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false); -- owner, Munich
set role authenticated;
select * from public.get_reservation_analytics(
  'bbbbbbbb-0000-0000-0000-000000000001', current_date, current_date + 2
);
\echo '(expected: ERROR: NOT_AUTHORIZED -- not the misleading all-zero result a plain RLS-filtered query would silently give)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- Test B: invalid date range.
-- ---------------------------------------------------------------------------
\echo '=== TEST B: get_reservation_analytics, invalid date range ==='
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select * from public.get_reservation_analytics(
  'bbbbbbbb-0000-0000-0000-000000000001', current_date + 5, current_date
);
\echo '(expected: ERROR: INVALID_DATE_RANGE)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- Test C: ai_conversations_insert -- staff_chat (user_id = self) succeeds;
-- customer_chat (user_id null) is rejected by RLS, exactly the schema gap
-- this phase's investigation surfaced and deliberately did not "fix" (see
-- 0017's migration comment) -- the Edge Function's service-role client is
-- the actual, intended door for every channel.
-- ---------------------------------------------------------------------------
\echo '=== TEST C1: ai_conversations_insert, staff_chat with own user_id -> allowed ==='
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
insert into public.ai_conversations (restaurant_id, user_id, channel)
values ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'staff_chat')
returning id, channel;
\echo '(expected: one row inserted -- this is the one case ai_conversations_insert CAN satisfy directly)'
reset role;
select set_config('request.jwt.claim.sub', '', false);
delete from public.ai_conversations where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001' and user_id = '11111111-1111-1111-1111-111111111111';

\echo '=== TEST C2: ai_conversations_insert, customer_chat (user_id null) -> rejected ==='
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
insert into public.ai_conversations (restaurant_id, user_id, channel)
values ('bbbbbbbb-0000-0000-0000-000000000001', null, 'customer_chat');
\echo '(expected: ERROR: new row violates row-level security policy -- with check (user_id = auth.uid()) can never be true when user_id is null)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- Test D: ai_messages -- no insert policy for authenticated, at all.
-- ---------------------------------------------------------------------------
\echo '=== TEST D: ai_messages insert as authenticated -> rejected (no policy exists) ==='
insert into public.ai_conversations (id, restaurant_id, user_id, channel)
values ('a0000000-0000-0000-0000-00000000d001', 'bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'staff_chat');
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
insert into public.ai_messages (conversation_id, role, content)
values ('a0000000-0000-0000-0000-00000000d001', 'user', 'hello');
\echo '(expected: ERROR: new row violates row-level security policy for table "ai_messages" -- confirms even MY OWN staff_chat conversation cannot be completed without the service role)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- Test E: ai_actions -- no insert policy for authenticated, at all.
-- ---------------------------------------------------------------------------
\echo '=== TEST E: ai_actions insert as authenticated -> rejected (no policy exists) ==='
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
insert into public.ai_actions (conversation_id, restaurant_id, tool_name, input)
values ('a0000000-0000-0000-0000-00000000d001', 'bbbbbbbb-0000-0000-0000-000000000001', 'cancelReservation', '{}'::jsonb);
\echo '(expected: ERROR: new row violates row-level security policy for table "ai_actions")'
reset role;
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- Test F: the full proposed -> executed lifecycle, written as the superuser
-- (standing in for the Edge Function's service-role admin client, which
-- bypasses RLS the same way) -- proving the exact sequence handleChat() and
-- handleConfirmOrReject() perform is representable and constraint-clean.
-- ---------------------------------------------------------------------------
\echo '=== TEST F: ai_actions proposed -> executed lifecycle ==='
insert into public.ai_messages (conversation_id, role, content)
values ('a0000000-0000-0000-0000-00000000d001', 'user', 'Cancel reservation ffffffff-0000-0000-0000-000000000001');

insert into public.ai_actions (id, conversation_id, restaurant_id, tool_name, input, requires_confirmation, status)
values (
  'a0000000-0000-0000-0000-00000000f001', 'a0000000-0000-0000-0000-00000000d001', 'bbbbbbbb-0000-0000-0000-000000000001',
  'cancelReservation', jsonb_build_object('reservationId', 'ffffffff-0000-0000-0000-000000000001'), true, 'proposed'
);

insert into public.ai_messages (conversation_id, role, content, tool_name, tool_input)
values (
  'a0000000-0000-0000-0000-00000000d001', 'assistant', 'Cancel reservation ffffffff-0000-0000-0000-000000000001?',
  'cancelReservation', jsonb_build_object('reservationId', 'ffffffff-0000-0000-0000-000000000001')
);

select status, requires_confirmation, confirmed_by_user_id, executed_at from public.ai_actions where id = 'a0000000-0000-0000-0000-00000000f001';
\echo '(expected: proposed, t, null, null -- nothing executed yet)'

-- Simulate confirm: the human approves, the Gateway executes and records the outcome.
update public.ai_actions
   set status = 'executed',
       confirmed_by_user_id = '11111111-1111-1111-1111-111111111111',
       confirmed_at = now(),
       executed_at = now(),
       result = jsonb_build_object('status', 'cancelled')
 where id = 'a0000000-0000-0000-0000-00000000f001';

select status, confirmed_by_user_id is not null as was_confirmed, confirmed_at is not null as has_confirmed_at,
       executed_at is not null as has_executed_at, result
  from public.ai_actions where id = 'a0000000-0000-0000-0000-00000000f001';
\echo '(expected: executed, t, t, t, {"status": "cancelled"})'

-- ---------------------------------------------------------------------------
-- Test G: ai_conversations_one_party constraint still holds.
-- ---------------------------------------------------------------------------
\echo '=== TEST G: ai_conversations_one_party rejects staff_chat with no user_id ==='
insert into public.ai_conversations (restaurant_id, user_id, channel)
values ('bbbbbbbb-0000-0000-0000-000000000001', null, 'staff_chat');
\echo '(expected: ERROR: new row for relation "ai_conversations" violates check constraint "ai_conversations_one_party")'

-- ---------------------------------------------------------------------------
-- Test H: ai_conversations_select visibility -- shared within the
-- restaurant, not shared across restaurants.
-- ---------------------------------------------------------------------------
\echo '=== TEST H1: a colleague (manager, same restaurant) CAN see the conversation ==='
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false); -- manager, Athens
set role authenticated;
select count(*) as visible_to_manager from public.ai_conversations where id = 'a0000000-0000-0000-0000-00000000d001';
\echo '(expected: 1 -- is_restaurant_member(restaurant_id) grants visibility to any active staff, not just the author)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '=== TEST H2: staff at a DIFFERENT restaurant CANNOT see it ==='
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false); -- owner, Munich
set role authenticated;
select count(*) as visible_to_other_restaurant from public.ai_conversations where id = 'a0000000-0000-0000-0000-00000000d001';
\echo '(expected: 0)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Cleanup
-- ---------------------------------------------------------------------------
\echo '=== CLEANUP ==='
delete from public.ai_actions where id = 'a0000000-0000-0000-0000-00000000f001';
delete from public.ai_messages where conversation_id = 'a0000000-0000-0000-0000-00000000d001';
delete from public.ai_conversations where id = 'a0000000-0000-0000-0000-00000000d001';
\echo 'done.'
