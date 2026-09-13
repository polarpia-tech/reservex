-- =============================================================================
-- verify_phase21_events_offers.sql
-- Proves, against real data, that migration 0042 does what it claims:
--   A. Athens owner creates a public (active, non-private) event for Athens.
--   B. Athens owner creates a private event for Athens (still allowed to
--      create -- it's the PUBLIC READ that excludes it, not the write).
--   C. Athens owner creates an inactive event for Athens.
--   D. Athens owner is BLOCKED from creating an event for Munich (tenant
--      isolation on write, unchanged from 0011 -- this migration only adds
--      a new SELECT policy, never touches events_write).
--   E. anon (a genuinely anonymous session, no jwt claim at all) sees
--      exactly the ONE public event (A), never B or C.
--   F. Another restaurant's own staff (Munich owner) sees the SAME ONE
--      public Athens event anon does -- via events_public_select, exactly
--      like anon would (a public event is public to everyone, staff
--      included) -- but NOT the private/inactive ones, and this is on TOP
--      of the pre-existing, unchanged tenant isolation on the STAFF policy
--      itself (Munich owner still gets 0 rows from events_select alone).
--   G. Athens owner creates an active offer and an inactive offer for
--      Athens; anon sees only the active one.
--   H. Athens owner is BLOCKED from creating an offer for Munich.
--   I. An offer belonging to a restaurant that is (temporarily) inactive is
--      NOT visible to anon, even though the offer row itself is active --
--      restaurant-active gating works exactly like 0014's restaurant check.
-- IMPORTANT test-script note: `select set_config('request.jwt.claim.sub',
-- ..., false)` sets a SESSION-level (not transaction-level) GUC -- it is
-- NOT cleared by `reset role`. Every place below that switches from an
-- authenticated context back to anon explicitly clears it first, otherwise
-- a later "set role anon" would silently inherit the previous session's
-- identity and make is_restaurant_member() (the STAFF select policy)
-- wrongly return true for what should be a truly anonymous check.
-- Run after migrations (through 0042) + seed.sql.
-- =============================================================================

\set ON_ERROR_STOP off

\echo '=== TEST A: Athens owner creates a PUBLIC event for Athens -> expects success ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
insert into public.events (id, restaurant_id, name, starts_at, ends_at, is_active, is_private)
values ('11111111-0000-0000-0000-0000000000e1', 'bbbbbbbb-0000-0000-0000-000000000001',
        'Live Jazz Night', now() + interval '7 days', now() + interval '7 days 3 hours', true, false);
reset role;

\echo ''
\echo '=== TEST B: Athens owner creates a PRIVATE event for Athens -> expects success (write still allowed) ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
insert into public.events (id, restaurant_id, name, starts_at, ends_at, is_active, is_private)
values ('11111111-0000-0000-0000-0000000000e2', 'bbbbbbbb-0000-0000-0000-000000000001',
        'Private Buyout', now() + interval '10 days', now() + interval '10 days 4 hours', true, true);
reset role;

\echo ''
\echo '=== TEST C: Athens owner creates an INACTIVE event for Athens -> expects success ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
insert into public.events (id, restaurant_id, name, starts_at, ends_at, is_active, is_private)
values ('11111111-0000-0000-0000-0000000000e3', 'bbbbbbbb-0000-0000-0000-000000000001',
        'Cancelled Tasting Menu', now() + interval '14 days', now() + interval '14 days 2 hours', false, false);
reset role;

\echo ''
\echo '=== TEST D: Athens owner tries to create an event for MUNICH -> expects RLS ERROR ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
insert into public.events (id, restaurant_id, name, starts_at, ends_at)
values ('11111111-0000-0000-0000-0000000000e4', 'bbbbbbbb-0000-0000-0000-000000000002',
        'Should Fail', now() + interval '7 days', now() + interval '7 days 2 hours');
reset role;
\echo '(expected: ERROR - new row violates row-level security policy for table "events")'

\echo ''
\echo '=== TEST E: a genuinely anonymous session sees exactly ONE public event for Athens ==='
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select id, name from public.events where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001' order by name;
select count(*) as anon_visible_athens_events from public.events where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001';
reset role;
\echo '(expected: exactly 1 row, "Live Jazz Night" -- the private and inactive ones are invisible)'

\echo ''
\echo '=== TEST F: Munich owner (a DIFFERENT restaurant''s own staff) sees the same ONE public Athens event, never the private/inactive ones ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
select id, name from public.events where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001' order by name;
select count(*) as munich_owner_sees_athens_events from public.events where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001';
reset role;
\echo '(expected: exactly 1 row, "Live Jazz Night" -- same as anon in TEST E: a public event is public to everyone, not just anon; the STAFF policy alone still contributes 0 for Munich, it is events_public_select doing the work here, same as for anon)'

\echo ''
\echo '=== TEST G: Athens owner creates an active offer + an inactive offer; anon sees only the active one ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
insert into public.offers (id, restaurant_id, title, is_active)
values ('22222222-0000-0000-0000-0000000000f1', 'bbbbbbbb-0000-0000-0000-000000000001', 'Happy Hour 17:00-19:00', true);
insert into public.offers (id, restaurant_id, title, is_active)
values ('22222222-0000-0000-0000-0000000000f2', 'bbbbbbbb-0000-0000-0000-000000000001', 'Expired Summer Deal', false);
reset role;
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select id, title from public.offers where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001';
select count(*) as anon_visible_athens_offers from public.offers where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001';
reset role;
\echo '(expected: exactly 1 row, "Happy Hour 17:00-19:00")'

\echo ''
\echo '=== TEST H: Athens owner tries to create an offer for MUNICH -> expects RLS ERROR ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
insert into public.offers (id, restaurant_id, title)
values ('22222222-0000-0000-0000-0000000000f3', 'bbbbbbbb-0000-0000-0000-000000000002', 'Should Fail');
reset role;
\echo '(expected: ERROR - new row violates row-level security policy for table "offers")'

\echo ''
\echo '=== TEST I: an active offer on a TEMPORARILY INACTIVE restaurant is invisible to anon ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
insert into public.offers (id, restaurant_id, title, is_active)
values ('22222222-0000-0000-0000-0000000000f4', 'bbbbbbbb-0000-0000-0000-000000000002', 'Munich Weekday Lunch Deal', true);
reset role;
update public.restaurants set is_active = false where id = 'bbbbbbbb-0000-0000-0000-000000000002';
select set_config('request.jwt.claim.sub', '', false);
set role anon;
select count(*) as anon_visible_munich_offers_while_inactive from public.offers where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000002';
reset role;
update public.restaurants set is_active = true where id = 'bbbbbbbb-0000-0000-0000-000000000002';
\echo '(expected: 0 while inactive -- restored to active immediately after so later scripts are unaffected)'

\echo ''
\echo '=== CLEANUP: remove all rows this script inserted ==='
delete from public.events where id in (
  '11111111-0000-0000-0000-0000000000e1', '11111111-0000-0000-0000-0000000000e2', '11111111-0000-0000-0000-0000000000e3'
);
delete from public.offers where id in (
  '22222222-0000-0000-0000-0000000000f1', '22222222-0000-0000-0000-0000000000f2', '22222222-0000-0000-0000-0000000000f4'
);
