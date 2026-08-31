-- =============================================================================
-- verify_phase11_voice_readiness.sql
-- Phase 11 (Voice): proves the small SQL surface added by 0018 does what it
-- claims:
--   A. restaurants.ai_voice_phone_number can be set, and is unique across
--      restaurants when set (but many restaurants may leave it null).
--   B. find_customer_by_phone() resolves an existing customer of THIS
--      restaurant by phone, returns null for an unknown number, and
--      returns null for a customer who exists but at a DIFFERENT
--      restaurant (no cross-tenant leakage).
--   C. find_customer_by_phone() is NOT callable by authenticated or anon
--      -- the explicit revoke in 0018 actually took effect. This is the
--      one security-sensitive claim in this migration, so it gets its own
--      dedicated test rather than being assumed from reading the SQL.
--   D. ai_conversations.caller_phone stores independently of customer_id
--      (a voice conversation from an unrecognized number still gets a
--      usable audit trail).
-- Run after migrations through 0018 + seed.sql, with local_dev_shim.sql
-- already applied.
-- =============================================================================

\set ON_ERROR_STOP off

-- ---------------------------------------------------------------------------
-- Test A: ai_voice_phone_number uniqueness.
-- ---------------------------------------------------------------------------
\echo '=== TEST A1: set ai_voice_phone_number on Athens restaurant ==='
update public.restaurants set ai_voice_phone_number = '+493012340001'
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';
select ai_voice_phone_number from public.restaurants where id = 'bbbbbbbb-0000-0000-0000-000000000001';
\echo '(expected: +493012340001)'

\echo '=== TEST A2: the SAME number on a second restaurant -> rejected ==='
update public.restaurants set ai_voice_phone_number = '+493012340001'
 where id = 'bbbbbbbb-0000-0000-0000-000000000002';
\echo '(expected: ERROR: duplicate key value violates unique constraint "uidx_restaurants_ai_voice_phone_number")'

\echo '=== TEST A3: null is fine for many restaurants (partial unique index) ==='
select count(*) as restaurants_with_null_voice_number from public.restaurants where ai_voice_phone_number is null;
\echo '(expected: 1 or more -- the partial unique index only constrains non-null values)'

-- ---------------------------------------------------------------------------
-- Test B: find_customer_by_phone -- resolves within tenant, null otherwise.
-- ---------------------------------------------------------------------------
\echo '=== TEST B1: known customer, correct restaurant -> resolves ==='
select public.find_customer_by_phone('bbbbbbbb-0000-0000-0000-000000000001', '+30 690 000 1111') as resolved_customer;
\echo '(expected: a non-null uuid, IF the seed customer''s phone matches this literal -- see the follow-up dynamic check just below, which is the one that actually matters)'

select c.phone from public.customers c
join public.restaurant_customers rc on rc.customer_id = c.id
where rc.restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001'
limit 1;
\echo '(the seed customer''s real phone number, for reference against the dynamic test below)'

do $$
declare
  v_phone text;
  v_expected_id uuid;
  v_resolved_id uuid;
begin
  select c.id, c.phone into v_expected_id, v_phone
  from public.customers c
  join public.restaurant_customers rc on rc.customer_id = c.id
  where rc.restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001'
  limit 1;

  v_resolved_id := public.find_customer_by_phone('bbbbbbbb-0000-0000-0000-000000000001', v_phone);
  if v_resolved_id = v_expected_id then
    raise notice 'TEST B1 (dynamic): PASS -- resolved % for phone %', v_resolved_id, v_phone;
  else
    raise notice 'TEST B1 (dynamic): FAIL -- expected %, got %', v_expected_id, v_resolved_id;
  end if;
end $$;

\echo '=== TEST B2: unknown phone number -> null ==='
select public.find_customer_by_phone('bbbbbbbb-0000-0000-0000-000000000001', '+1 555 000 0000') as resolved_customer;
\echo '(expected: null)'

\echo '=== TEST B3: customer exists, but at a DIFFERENT restaurant -> null (no cross-tenant leak) ==='
do $$
declare
  v_phone text;
  v_resolved_id uuid;
begin
  select c.phone into v_phone
  from public.customers c
  join public.restaurant_customers rc on rc.customer_id = c.id
  where rc.restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001'
  limit 1;

  -- Same phone number, but asking on behalf of the MUNICH restaurant, which
  -- this customer has no restaurant_customers row for.
  v_resolved_id := public.find_customer_by_phone('bbbbbbbb-0000-0000-0000-000000000002', v_phone);
  if v_resolved_id is null then
    raise notice 'TEST B3: PASS -- no cross-tenant match';
  else
    raise notice 'TEST B3: FAIL -- leaked customer % across restaurants', v_resolved_id;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Test C: find_customer_by_phone is not reachable by anon/authenticated.
-- ---------------------------------------------------------------------------
\echo '=== TEST C1: authenticated staff calling find_customer_by_phone directly -> rejected ==='
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
set role authenticated;
select public.find_customer_by_phone('bbbbbbbb-0000-0000-0000-000000000001', '+30 690 000 1111');
\echo '(expected: ERROR: permission denied for function find_customer_by_phone)'
reset role;
select set_config('request.jwt.claim.sub', '', false);

\echo '=== TEST C2: anon calling find_customer_by_phone directly -> rejected ==='
set role anon;
select public.find_customer_by_phone('bbbbbbbb-0000-0000-0000-000000000001', '+30 690 000 1111');
\echo '(expected: ERROR: permission denied for function find_customer_by_phone)'
reset role;

-- ---------------------------------------------------------------------------
-- Test D: ai_conversations.caller_phone -- usable even with no customer_id.
-- ---------------------------------------------------------------------------
\echo '=== TEST D: a voice conversation from an unrecognized number still logs caller_phone ==='
insert into public.ai_conversations (id, restaurant_id, customer_id, channel, caller_phone, locale)
values ('a0000000-0000-0000-0000-00000000e001', 'bbbbbbbb-0000-0000-0000-000000000001', null, 'voice', '+1 555 000 0000', 'el')
returning channel, customer_id, caller_phone;
\echo '(expected: voice, null, +1 555 000 0000 -- a fully anonymous caller still gets a usable audit trail)'

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Cleanup
-- ---------------------------------------------------------------------------
\echo '=== CLEANUP ==='
delete from public.ai_conversations where id = 'a0000000-0000-0000-0000-00000000e001';
update public.restaurants set ai_voice_phone_number = null where id = 'bbbbbbbb-0000-0000-0000-000000000001';
\echo 'done.'
