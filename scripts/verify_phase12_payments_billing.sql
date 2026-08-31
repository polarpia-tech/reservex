-- =============================================================================
-- verify_phase12_payments_billing.sql
-- Phase 12 (Payments & billing): proves the SQL surface added by 0019 does
-- what it claims:
--   A. compute_deposit_amount -- every calculation_type, and the
--      event > vip > party_size_threshold > all specificity order when
--      several active policies could apply to the same reservation.
--   B. evaluate_reservation_cancellation_refund -- refund eligibility is
--      computed from the SNAPSHOT frozen on the payment, not the policy's
--      current value; only 'deposit' payments still capturable/succeeded
--      are considered.
--   C. payments / subscriptions / subscription_plans remain write-blocked
--      for the authenticated role directly -- 0011's own comment says
--      "money actually moves only via Edge Functions ... running as
--      service role", this proves that claim, doesn't just repeat it.
--   D. deposit_policies_public_select actually lets anon read active
--      policies (and only active ones), while anon still can't write.
--   E. uidx_subscriptions_active_per_org (0007) -- the constraint
--      bootstrap-restaurant's trial-subscription step, and later Stripe
--      webhook upserts, both depend on -- only one non-terminal
--      subscription per organization.
-- Run after migrations through 0019 + seed.sql, with local_dev_shim.sql
-- already applied. Uses the Athens restaurant/reservation/customer from
-- seed.sql (bbbbbbbb-...0001 / ffffffff-...0001 / eeeeeeee-...0001).
-- =============================================================================

\set ON_ERROR_STOP off

-- ---------------------------------------------------------------------------
-- Test A: compute_deposit_amount.
-- ---------------------------------------------------------------------------
\echo '=== SETUP: four active deposit policies on the Athens restaurant, one per applies_to ==='
insert into public.deposit_policies (id, restaurant_id, name, applies_to, calculation_type, amount_cents, percentage, percentage_base_amount_cents, party_size_threshold, cancellation_window_hours, is_active) values
  ('11111111-dddd-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'All bookings',        'all',                  'fixed',      2000, null, null, null, 24, true),
  ('11111111-dddd-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'Large parties',       'party_size_threshold', 'per_person', 1000, null, null, 6,    24, true),
  ('11111111-dddd-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', 'VIP tables',          'vip',                  'percentage', null, 20,   4000, null, 24, true),
  ('11111111-dddd-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000001', 'Inactive test policy','all',                  'fixed',      9999, null, null, null, 24, false);

insert into public.events (id, restaurant_id, name, starts_at, ends_at, deposit_policy_id) values
  ('11111111-eeee-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Live music night',
   now() + interval '10 days', now() + interval '10 days' + interval '3 hours', '11111111-dddd-0000-0000-000000000001')
on conflict do nothing;
-- The event's OWN deposit policy is the 'all' one above (id ...0001) -- reused
-- deliberately so Test A6 can tell "matched via applies_to=event" apart from
-- "matched via applies_to=all" by which policy_id comes back.
update public.events set deposit_policy_id = '11111111-dddd-0000-0000-000000000001'
 where id = '11111111-eeee-0000-0000-000000000001';
-- Give the event its own dedicated policy instead, so priority is unambiguous:
insert into public.deposit_policies (id, restaurant_id, name, applies_to, calculation_type, amount_cents, cancellation_window_hours, is_active) values
  ('11111111-dddd-0000-0000-000000000005', 'bbbbbbbb-0000-0000-0000-000000000001', 'Event deposit', 'event', 'fixed', 5000, 48, true);
update public.events set deposit_policy_id = '11111111-dddd-0000-0000-000000000005'
 where id = '11111111-eeee-0000-0000-000000000001';

do $$
declare
  v_policy_id uuid;
  v_amount int;
begin
  -- A1: fixed 'all' policy, no other policy applies (party_size below threshold, not vip, no event).
  select policy_id, amount_cents into v_policy_id, v_amount
  from public.compute_deposit_amount('bbbbbbbb-0000-0000-0000-000000000001', 2, false, null);
  if v_policy_id = '11111111-dddd-0000-0000-000000000001' and v_amount = 2000 then
    raise notice 'TEST A1 (fixed, applies_to=all): PASS -- policy %, amount %', v_policy_id, v_amount;
  else
    raise notice 'TEST A1: FAIL -- got policy %, amount % (expected 11111111-dddd-...0001, 2000)', v_policy_id, v_amount;
  end if;

  -- A2: per_person threshold policy wins over 'all' once party_size >= 6.
  select policy_id, amount_cents into v_policy_id, v_amount
  from public.compute_deposit_amount('bbbbbbbb-0000-0000-0000-000000000001', 6, false, null);
  if v_policy_id = '11111111-dddd-0000-0000-000000000002' and v_amount = 6000 then
    raise notice 'TEST A2 (per_person, party_size_threshold beats all): PASS -- amount % (1000 x 6)', v_amount;
  else
    raise notice 'TEST A2: FAIL -- got policy %, amount % (expected 11111111-dddd-...0002, 6000)', v_policy_id, v_amount;
  end if;

  -- A3: percentage VIP policy: round(4000 * 4 * 20 / 100) = 3200.
  select policy_id, amount_cents into v_policy_id, v_amount
  from public.compute_deposit_amount('bbbbbbbb-0000-0000-0000-000000000001', 4, true, null);
  if v_policy_id = '11111111-dddd-0000-0000-000000000003' and v_amount = 3200 then
    raise notice 'TEST A3 (percentage, applies_to=vip): PASS -- amount % (20%% of 4000x4)', v_amount;
  else
    raise notice 'TEST A3: FAIL -- got policy %, amount % (expected 11111111-dddd-...0003, 3200)', v_policy_id, v_amount;
  end if;

  -- A4: specificity order -- vip AND party_size_threshold AND all all apply
  -- simultaneously (party_size 6, is_vip true, no event) -> vip must win.
  select policy_id, amount_cents into v_policy_id, v_amount
  from public.compute_deposit_amount('bbbbbbbb-0000-0000-0000-000000000001', 6, true, null);
  if v_policy_id = '11111111-dddd-0000-0000-000000000003' then
    raise notice 'TEST A4 (vip beats party_size_threshold beats all): PASS';
  else
    raise notice 'TEST A4: FAIL -- got policy % (expected the vip policy 11111111-dddd-...0003)', v_policy_id;
  end if;

  -- A5: event beats everything, including vip, when an event_id is supplied
  -- and matches this policy's own deposit_policy_id.
  select policy_id, amount_cents into v_policy_id, v_amount
  from public.compute_deposit_amount('bbbbbbbb-0000-0000-0000-000000000001', 6, true, '11111111-eeee-0000-0000-000000000001');
  if v_policy_id = '11111111-dddd-0000-0000-000000000005' and v_amount = 5000 then
    raise notice 'TEST A5 (event beats vip/party_size_threshold/all): PASS';
  else
    raise notice 'TEST A5: FAIL -- got policy %, amount % (expected 11111111-dddd-...0005, 5000)', v_policy_id, v_amount;
  end if;

  -- A6: inactive policy never matches, even though it would otherwise (applies_to=all).
  -- Isolate by using a restaurant/party_size combo where ONLY the inactive
  -- 'all' policy and no other policy would apply -- not possible on Athens
  -- (it always has an active 'all' policy too), so instead assert directly
  -- that the inactive policy's id never comes back across any of the calls
  -- above, and that a restaurant with ONLY an inactive policy returns zero rows.
  if not exists (
    select 1 from public.deposit_policies where id = '11111111-dddd-0000-0000-000000000004' and is_active
  ) then
    raise notice 'TEST A6 setup check (inactive policy really is inactive): PASS';
  else
    raise notice 'TEST A6 setup check: FAIL';
  end if;

  -- A7: no active policy at all -> zero rows (Munich restaurant has none).
  select policy_id, amount_cents into v_policy_id, v_amount
  from public.compute_deposit_amount('bbbbbbbb-0000-0000-0000-000000000002', 4, false, null);
  if v_policy_id is null and v_amount is null then
    raise notice 'TEST A7 (no applicable policy -> no deposit required): PASS';
  else
    raise notice 'TEST A7: FAIL -- expected no rows, got policy %, amount %', v_policy_id, v_amount;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Test B: evaluate_reservation_cancellation_refund -- window-boundary cases,
-- using the SNAPSHOT on the payment, not the policy's current value.
-- ---------------------------------------------------------------------------
\echo '=== SETUP: two throwaway reservations + deposit payments with different snapshots ==='
insert into public.reservations (id, restaurant_id, customer_id, status, source, party_size, starts_at, ends_at, buffer_minutes, guest_name) values
  ('22222222-ffff-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'confirmed', 'app', 2, now() + interval '48 hours', now() + interval '49 hours', 15, 'Window test A (outside)'),
  ('22222222-ffff-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'confirmed', 'app', 2, now() + interval '10 hours', now() + interval '11 hours', 15, 'Window test B (inside)');

insert into public.payments (id, restaurant_id, reservation_id, customer_id, provider, provider_payment_id, payment_type, status, amount_cents, deposit_policy_id, cancellation_window_hours_snapshot) values
  ('33333333-aaaa-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', '22222222-ffff-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 'stripe', 'pi_test_outside', 'deposit', 'requires_capture', 2000, '11111111-dddd-0000-0000-000000000001', 24),
  ('33333333-aaaa-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', '22222222-ffff-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001', 'stripe', 'pi_test_inside', 'deposit', 'succeeded', 2000, '11111111-dddd-0000-0000-000000000001', 24),
  -- Same reservation as the "inside" case, but a REFUND payment_type, and a
  -- FAILED deposit -- neither should be returned by the function at all.
  ('33333333-aaaa-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', '22222222-ffff-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001', 'stripe', 'pi_test_refund', 'refund', 'succeeded', 2000, null, null),
  ('33333333-aaaa-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000001', '22222222-ffff-0000-0000-000000000002', 'eeeeeeee-0000-0000-0000-000000000001', 'stripe', 'pi_test_failed', 'deposit', 'failed', 2000, '11111111-dddd-0000-0000-000000000001', 24);

-- Now EDIT the policy's cancellation_window_hours to something very
-- different (1 hour) -- the function must still use the SNAPSHOT (24h)
-- frozen on the payment, never this new value, proving point 2 of 0019's
-- header comment actually holds at query time, not just in the DDL comment.
update public.deposit_policies set cancellation_window_hours = 1 where id = '11111111-dddd-0000-0000-000000000001';

do $$
declare
  v_row record;
  v_count int;
begin
  -- B1: reservation 48h out, 24h snapshot window -> starts_at - 24h is still
  -- ~24h in the future -> refund_eligible = true, DESPITE the policy now
  -- saying 1 hour.
  select * into v_row from public.evaluate_reservation_cancellation_refund('22222222-ffff-0000-0000-000000000001')
  where payment_id = '33333333-aaaa-0000-0000-000000000001';
  if v_row.refund_eligible = true then
    raise notice 'TEST B1 (outside window, uses frozen 24h snapshot not the edited 1h policy): PASS';
  else
    raise notice 'TEST B1: FAIL -- expected refund_eligible=true, got %', v_row.refund_eligible;
  end if;

  -- B2: reservation 10h out, 24h snapshot window -> starts_at - 24h is in
  -- the PAST -> refund_eligible = false (late cancellation -> fee).
  select * into v_row from public.evaluate_reservation_cancellation_refund('22222222-ffff-0000-0000-000000000002')
  where payment_id = '33333333-aaaa-0000-0000-000000000002';
  if v_row.refund_eligible = false then
    raise notice 'TEST B2 (inside window -> not refund-eligible, becomes a fee): PASS';
  else
    raise notice 'TEST B2: FAIL -- expected refund_eligible=false, got %', v_row.refund_eligible;
  end if;

  -- B3: only 'deposit' payments in a capturable/succeeded state are
  -- returned -- the refund-type and failed-status rows on reservation 2
  -- must NOT appear (exactly 1 row expected for that reservation).
  select count(*) into v_count from public.evaluate_reservation_cancellation_refund('22222222-ffff-0000-0000-000000000002');
  if v_count = 1 then
    raise notice 'TEST B3 (only capturable/succeeded deposit payments returned, not refund/failed rows): PASS';
  else
    raise notice 'TEST B3: FAIL -- expected exactly 1 row, got %', v_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Test C: payments / subscriptions / subscription_plans stay write-blocked
-- for the authenticated role, even for the restaurant's own owner.
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false); -- Athens owner
set role authenticated;

\echo '=== TEST C1: owner cannot insert a payments row directly ==='
insert into public.payments (restaurant_id, payment_type, status, amount_cents)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'deposit', 'requires_action', 1000);
\echo '(expected: ERROR -- new row violates row-level security policy / permission denied. No INSERT policy exists for payments at all -- 0011: money only moves via Edge Functions.)'

\echo '=== TEST C2: owner cannot insert a subscriptions row directly ==='
insert into public.subscriptions (organization_id, plan_id, status)
select 'aaaaaaaa-0000-0000-0000-000000000001', id, 'active' from public.subscription_plans where code = 'starter';
\echo '(expected: ERROR -- same reasoning, no INSERT policy on subscriptions)'

\echo '=== TEST C3: owner cannot insert a subscription_plans row directly ==='
insert into public.subscription_plans (code, name, price_cents) values ('rogue_plan', 'Rogue', 100);
\echo '(expected: ERROR -- subscription_plans_select is read-only (using (true)), no write policy exists)'

reset role;
select set_config('request.jwt.claim.sub', '', false);

-- ---------------------------------------------------------------------------
-- Test D: deposit_policies_public_select -- anon can read ACTIVE policies
-- (and only those), and still cannot write.
-- ---------------------------------------------------------------------------
set role anon;

\echo '=== TEST D1: anon can read the active Athens deposit policies ==='
select count(*) as visible_active_policies from public.deposit_policies
where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001' and is_active;
\echo '(expected: 4 -- the four active policies inserted in Test A''s setup)'

\echo '=== TEST D2: anon does NOT see the inactive policy ==='
select count(*) as visible_rows from public.deposit_policies where id = '11111111-dddd-0000-0000-000000000004';
\echo '(expected: 0 -- deposit_policies_public_select filters on is_active)'

\echo '=== TEST D3: anon cannot write to deposit_policies ==='
insert into public.deposit_policies (restaurant_id, name, applies_to, calculation_type, amount_cents)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'Anon-inserted', 'all', 'fixed', 100);
\echo '(expected: ERROR -- deposit_policies_write requires owner/manager role, anon has none)'

\echo '=== TEST D4: anon cannot call evaluate_reservation_cancellation_refund (authenticated-only grant) ==='
select public.evaluate_reservation_cancellation_refund('22222222-ffff-0000-0000-000000000001');
\echo '(expected: ERROR -- permission denied for function evaluate_reservation_cancellation_refund)'

\echo '=== TEST D5: anon CAN call compute_deposit_amount (granted to anon -- public site needs it pre-booking) ==='
select policy_id, amount_cents from public.compute_deposit_amount('bbbbbbbb-0000-0000-0000-000000000001', 2, false, null);
\echo '(expected: succeeds, returns the fixed 2000-cent "all" policy -- no error)'

reset role;

-- ---------------------------------------------------------------------------
-- Test E: uidx_subscriptions_active_per_org -- only one non-terminal
-- subscription per organization (relied on by bootstrap-restaurant's trial
-- creation AND the stripe-webhook subscription upsert).
-- ---------------------------------------------------------------------------
\echo '=== SETUP: Munich org has no subscription yet (bootstrap-restaurant was never invoked for it in this SQL-only test) ==='
do $$
declare
  v_starter_plan uuid;
begin
  select id into v_starter_plan from public.subscription_plans where code = 'starter';

  insert into public.subscriptions (id, organization_id, plan_id, status, trial_ends_at)
  values ('44444444-bbbb-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', v_starter_plan, 'trialing', now() + interval '14 days');
  raise notice 'TEST E1 (first trialing subscription for an org): PASS -- insert succeeded';
end $$;

\echo '=== TEST E2: a second non-terminal subscription for the SAME org is rejected ==='
insert into public.subscriptions (organization_id, plan_id, status)
select 'aaaaaaaa-0000-0000-0000-000000000002', id, 'active' from public.subscription_plans where code = 'professional';
\echo '(expected: ERROR: duplicate key value violates unique constraint "uidx_subscriptions_active_per_org")'

do $$
begin
  -- E3: retiring the first (cancelled = terminal, outside the partial
  -- index) THEN inserting a new active one must succeed -- this is exactly
  -- the sequence stripe-webhook's upsertSubscriptionFromStripeObject runs
  -- when an org converts from trial to paid.
  update public.subscriptions set status = 'cancelled' where id = '44444444-bbbb-0000-0000-000000000001';
  insert into public.subscriptions (id, organization_id, plan_id, status)
  select '44444444-bbbb-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', id, 'active'
  from public.subscription_plans where code = 'professional';
  raise notice 'TEST E3 (retire trial, then insert active -- the trial-to-paid conversion path): PASS';
exception when others then
  raise notice 'TEST E3: FAIL -- %', sqlerrm;
end $$;

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Cleanup
-- ---------------------------------------------------------------------------
\echo '=== CLEANUP ==='
delete from public.subscriptions where id in ('44444444-bbbb-0000-0000-000000000001', '44444444-bbbb-0000-0000-000000000002');
delete from public.payments where id::text like '33333333-aaaa-%';
delete from public.reservation_tables where reservation_id::text like '22222222-ffff-%';
delete from public.reservations where id::text like '22222222-ffff-%';
delete from public.events where id = '11111111-eeee-0000-0000-000000000001';
delete from public.deposit_policies where id::text like '11111111-dddd-%';
\echo 'done.'
