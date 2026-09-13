-- =============================================================================
-- verify_phase22_notification_dispatch.sql
-- Proves, against real data, what migration 0043 actually claims: the
-- claim/retry state machine for email/sms notification dispatch, NOT the
-- real Resend/Twilio HTTP calls (see 0043's own header for why the latter
-- cannot be verified here).
--
--   A. queue_notification() for a CUSTOMER email -> queued, scheduled_for
--      null (immediate).
--   B. A raw guest reservation insert (status='confirmed', guest_email set,
--      no customer_id) fires 0016's own trigger end-to-end: it queues a
--      guest 'reservation_confirmed' email (immediate) AND, via
--      schedule_reservation_reminders, a future-dated 'reservation_reminder'
--      row for whatever active reminder_rules this restaurant has -- this
--      script adds its own reminder_rule first so that row is guaranteed
--      to exist, rather than depending on what seed.sql happens to define.
--   C. claim_notifications_for_dispatch(10) claims the two DUE rows (A, B's
--      immediate confirmation) but NOT B's future reminder -- proving the
--      scheduled_for filter actually works, not just the channel filter.
--   D. Every claimed row's joined recipient contact (to_email) and locale
--      resolve correctly: A's customer email/preferred_locale from
--      `customers`, B's guest email from `reservations.guest_email` (no
--      customers row exists for a guest at all).
--   E. mark_notification_dispatched(A, success) -> 'sent', attempts left at
--      1 (never retried), error_message cleared.
--   F. mark_notification_dispatched(B's confirmation, failure) -> back to
--      'queued' with a future scheduled_for (backoff) and dispatch_attempts
--      still 1 -- NOT re-claimable immediately by a second claim call.
--   G. Simulate exhausting retries: manually push dispatch_attempts to 5,
--      re-claim (attempts becomes 6), then mark_notification_dispatched
--      with failure -> 'failed' permanently, not 'queued' again.
--   H. Two concurrent claims never double-claim: a second
--      claim_notifications_for_dispatch call right after C returns 0 of
--      the same rows (they are now 'sending', no longer 'queued').
--   I. EXECUTE on both SECURITY DEFINER functions is revoked from
--      anon/authenticated (same discipline as claim_waitlist_matches_for_
--      restaurant, 0031) -- a plain authenticated/anon role gets
--      "permission denied for function", not a data leak.
--
-- Run after migrations (through 0043) + seed.sql.
-- =============================================================================

\set ON_ERROR_STOP off

\echo '=== SETUP: an active email reminder_rule for Athens, so TEST B has something to schedule ==='
insert into public.reminder_rules (id, restaurant_id, name, minutes_before_start, channel, is_active)
values ('33333333-0000-0000-0000-0000000000a1', 'bbbbbbbb-0000-0000-0000-000000000001', '24h email reminder', 1440, 'email', true);

\echo ''
\echo '=== TEST A: queue_notification() for a CUSTOMER email -> queued, immediate ==='
select (public.queue_notification(
  'bbbbbbbb-0000-0000-0000-000000000001', 'customer', 'eeeeeeee-0000-0000-0000-000000000001', null,
  'email', 'reservation_confirmed', '{"startsAt":"2027-01-01T19:00:00Z","partySize":2}'::jsonb
)).id as notification_a_id \gset

select status, scheduled_for, dispatch_attempts from public.notifications where id = :'notification_a_id';
\echo '(expected: queued, scheduled_for null, dispatch_attempts 0)'

\echo ''
\echo '=== TEST B: a raw GUEST reservation insert fires the Phase 09 trigger end-to-end ==='
insert into public.reservations (id, restaurant_id, customer_id, status, party_size, starts_at, ends_at, guest_name, guest_email)
values ('44444444-0000-0000-0000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000001', null, 'confirmed', 4,
        now() + interval '10 days', now() + interval '10 days 2 hours', 'Guest Tester', 'guest-tester@example.com');

select id, channel, template_code, status, scheduled_for, recipient_type
  from public.notifications
  where reservation_id = '44444444-0000-0000-0000-0000000000b1' and channel in ('email','sms')
  order by template_code;
\echo '(expected: two rows -- reservation_confirmed/email/queued/scheduled_for null, and reservation_reminder/email/queued/scheduled_for ~10 days minus 24h from now, i.e. clearly in the future)'

select id as notification_b_confirm_id from public.notifications
  where reservation_id = '44444444-0000-0000-0000-0000000000b1' and template_code = 'reservation_confirmed' and channel = 'email' \gset
select id as notification_b_reminder_id from public.notifications
  where reservation_id = '44444444-0000-0000-0000-0000000000b1' and template_code = 'reservation_reminder' and channel = 'email' \gset

\echo ''
\echo '=== TEST C+D: claim_notifications_for_dispatch(10) claims exactly the 2 DUE rows (A, B-confirm), not the future reminder -- and resolves contact info correctly ==='
select id, channel, template_code, recipient_type, to_email, locale, restaurant_name, dispatch_attempts
  from public.claim_notifications_for_dispatch(10)
  order by template_code;
\echo '(expected: exactly 2 rows. reservation_confirmed(customer): to_email=maria@example.com, locale=el. reservation_confirmed(guest): to_email=guest-tester@example.com. Both restaurant_name = the Athens restaurant''s name, dispatch_attempts = 1. The reminder row must NOT appear.)'

select status, dispatch_attempts from public.notifications where id = :'notification_a_id';
select status, dispatch_attempts from public.notifications where id = :'notification_b_confirm_id';
select status, dispatch_attempts from public.notifications where id = :'notification_b_reminder_id';
\echo '(expected: first two rows now status=sending, dispatch_attempts=1. The reminder row is untouched: status=queued, dispatch_attempts=0.)'

\echo ''
\echo '=== TEST H: a second claim call right after C claims 0 of the same rows (no double-claim) ==='
select count(*) as second_claim_count from public.claim_notifications_for_dispatch(10);
\echo '(expected: 0 -- A and B-confirm are already sending, not queued; the reminder is still not due)'

\echo ''
\echo '=== TEST E: mark_notification_dispatched(A, success) -> sent, attempts stay 1 ==='
select public.mark_notification_dispatched(:'notification_a_id', true, 'resend-msg-123', null);
select status, dispatch_attempts, provider_message_id, error_message, sent_at is not null as has_sent_at
  from public.notifications where id = :'notification_a_id';
\echo '(expected: sent, 1, resend-msg-123, null, true)'

\echo ''
\echo '=== TEST F: mark_notification_dispatched(B-confirm, failure) -> back to queued with a future scheduled_for, attempts stay 1 ==='
select public.mark_notification_dispatched(:'notification_b_confirm_id', false, null, 'Twilio API error (400): invalid number');
select status, dispatch_attempts, error_message, scheduled_for > now() as backoff_is_future
  from public.notifications where id = :'notification_b_confirm_id';
\echo '(expected: queued, 1, the error message, true -- NOT immediately re-claimable)'

select count(*) as reclaim_before_due from public.claim_notifications_for_dispatch(10) where id = :'notification_b_confirm_id';
\echo '(expected: 0 -- backoff has not elapsed yet)'

\echo ''
\echo '=== TEST G: exhausting retries -> failed permanently, never queued again ==='
update public.notifications set dispatch_attempts = 5, status = 'queued', scheduled_for = null where id = :'notification_b_confirm_id';
select id from public.claim_notifications_for_dispatch(10) where id = :'notification_b_confirm_id' \gset
select status, dispatch_attempts from public.notifications where id = :'notification_b_confirm_id';
\echo '(expected: sending, dispatch_attempts=6 -- claim always increments first)'
select public.mark_notification_dispatched(:'notification_b_confirm_id', false, null, 'Twilio API error (500): persistent outage');
select status, dispatch_attempts, error_message from public.notifications where id = :'notification_b_confirm_id';
\echo '(expected: failed, 6, the error message -- attempts >= 5 means no more retries)'

\echo ''
\echo '=== TEST I: EXECUTE on both functions is revoked from anon/authenticated ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select * from public.claim_notifications_for_dispatch(1);
reset role;
\echo '(expected: ERROR - permission denied for function claim_notifications_for_dispatch)'

set role anon;
select set_config('request.jwt.claim.sub', '', false);
select public.mark_notification_dispatched(:'notification_a_id', true, null, null);
reset role;
\echo '(expected: ERROR - permission denied for function mark_notification_dispatched)'

\echo ''
\echo '=== CLEANUP ==='
delete from public.notifications where id in (:'notification_a_id', :'notification_b_confirm_id', :'notification_b_reminder_id');
delete from public.reservations where id = '44444444-0000-0000-0000-0000000000b1';
delete from public.reminder_rules where id = '33333333-0000-0000-0000-0000000000a1';
