-- =============================================================================
-- verify_phase09_notifications.sql
-- Proves, against real data, that the Phase 09 notification automation
-- (0016) does what it claims and nothing more:
--   A. A new staff-created reservation queues an in-app notification to
--      OTHER staff, but not to whoever created it.
--   B. An explicit staff opt-out (staff_notification_preferences,
--      is_enabled=false) is actually respected.
--   C/D. Reminder scheduling: an active rule with a still-future fire time
--      queues a reminder; a rule whose fire time has already passed is
--      silently skipped.
--   E. A guest (no account) booking queues a 'guest' recipient_type email
--      confirmation, and a push-only reminder rule has no reachable
--      channel for that guest (silently skipped).
--   F. Cancelling a reservation queues cancellation notices AND withdraws
--      its own still-queued reminder.
--   G. A no-show notifies staff but never the customer.
--   H. Rescheduling recomputes reminders from the new time and notifies
--      customer + staff.
--   I. Staff can mark only THEIR OWN in-app notification read -- not force
--      any other status, not a colleague's row (even though they CAN see
--      it via the pre-existing is_restaurant_member SELECT policy).
--   J. Customer inbox RLS + cross-customer isolation.
--   K. queue_notification() really is the only insert path -- a direct
--      client-side INSERT is rejected.
-- Run after migrations through 0016 + seed.sql, with local_dev_shim.sql
-- already applied.
-- =============================================================================

\set ON_ERROR_STOP off

-- ---------------------------------------------------------------------------
-- Setup: a second customer (own auth user, no restaurant ties) for the
-- cross-customer isolation check in Test J.
-- ---------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('55555555-0000-0000-0000-000000000002', 'second.customer@example.com')
on conflict (id) do nothing;
insert into public.customers (id, auth_user_id, full_name, email, phone) values
  ('eeeeeeee-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000002', 'Second Customer', 'second.customer@example.com', '+30 690 000 9999')
on conflict (id) do nothing;

\echo ''
\echo '=== TEST A: new staff-created reservation notifies OTHER staff, not the creator ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false); -- owner
select id as booking_a_id into temporary table _t_booking_a from public.book_reservation(
  p_restaurant_id => 'bbbbbbbb-0000-0000-0000-000000000001',
  p_starts_at     => (current_date + interval '2 days' + time '12:30') at time zone 'Europe/Athens',
  p_ends_at       => (current_date + interval '2 days' + time '14:00') at time zone 'Europe/Athens',
  p_party_size    => 2,
  p_source        => 'walk_in',
  p_guest_name    => 'Phone Guest',
  p_guest_phone   => '+30 690 000 0001'
);
reset role;
select recipient_user_id, template_code, status from public.notifications
 where reservation_id = (select booking_a_id from _t_booking_a) and recipient_type = 'staff';
\echo '(expected: exactly one row, recipient_user_id = the MANAGER (33333333...), never the owner who created it)'
select count(*) as guest_confirmation_rows from public.notifications
 where reservation_id = (select booking_a_id from _t_booking_a) and template_code = 'reservation_confirmed';
\echo '(expected: 0 -- this guest gave a phone but no email, so there is no channel to confirm on)'

\echo ''
\echo '=== TEST B: an explicit staff opt-out is respected ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false); -- manager opts self out
insert into public.staff_notification_preferences (restaurant_id, user_id, event_type, channel, is_enabled)
values ('bbbbbbbb-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'new_reservation', 'in_app', false)
on conflict (restaurant_id, user_id, event_type, channel) do update set is_enabled = false;
reset role;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false); -- owner books again
select id as booking_b_id into temporary table _t_booking_b from public.book_reservation(
  p_restaurant_id => 'bbbbbbbb-0000-0000-0000-000000000001',
  p_starts_at     => (current_date + interval '3 days' + time '12:30') at time zone 'Europe/Athens',
  p_ends_at       => (current_date + interval '3 days' + time '14:00') at time zone 'Europe/Athens',
  p_party_size    => 2,
  p_source        => 'walk_in',
  p_guest_name    => 'Another Phone Guest',
  p_guest_phone   => '+30 690 000 0002'
);
reset role;
select count(*) as staff_notified from public.notifications where reservation_id = (select booking_b_id from _t_booking_b) and recipient_type = 'staff';
\echo '(expected: 0 -- the only other active staff member (manager) explicitly opted out; the owner is skipped anyway as the creator)'

\echo ''
\echo '=== TEST C/D: reminder rules -- one fires, one whose time already passed is skipped ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false); -- owner
insert into public.reminder_rules (restaurant_id, name, minutes_before_start, channel, is_active) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '2h before (push)', 120, 'push', true),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'absurdly early (would already be in the past)', 999999, 'push', true);

select id as booking_c_id into temporary table _t_booking_c from public.book_reservation(
  p_restaurant_id => 'bbbbbbbb-0000-0000-0000-000000000001',
  p_starts_at     => (current_date + interval '5 days' + time '20:00') at time zone 'Europe/Athens',
  p_ends_at       => (current_date + interval '5 days' + time '21:30') at time zone 'Europe/Athens',
  p_party_size    => 2,
  p_source        => 'admin',
  p_customer_id   => 'eeeeeeee-0000-0000-0000-000000000001'
);
reset role;
select channel, status, recipient_customer_id, scheduled_for = (select starts_at from public.reservations where id = (select booking_c_id from _t_booking_c)) - interval '120 min' as fires_120min_before
  from public.notifications
 where reservation_id = (select booking_c_id from _t_booking_c) and template_code = 'reservation_reminder';
\echo '(expected: exactly ONE row -- channel=push, status=queued, recipient_customer_id set, fires_120min_before=t. The 999999-minutes-before rule is silently skipped -- its fire time is already in the past.)'

\echo ''
\echo '=== TEST E: guest (no account) booking -- email confirmation queued, push-only reminder has no reachable channel ==='
set role anon;
-- IMPORTANT: set_config's third argument (is_local=false) makes a setting
-- stick for the rest of the whole psql SESSION, not just one statement --
-- unlike a real anon HTTP request (which never carries a JWT at all), this
-- script's session would otherwise still be holding the OWNER's uuid from
-- test C/D's set_config call. Clearing it here is what makes auth.uid()
-- correctly read back as null for this "truly anonymous" booking.
select set_config('request.jwt.claim.sub', '', false);
select id as booking_e_id into temporary table _t_booking_e from public.book_public_reservation(
  p_restaurant_slug => 'taverna-ithaki',
  p_starts_at       => (current_date + interval '2 days' + time '19:30') at time zone 'Europe/Athens',
  p_party_size      => 2,
  p_guest_name      => 'Guest With Email',
  p_guest_email     => 'guest.with.email@example.com'
);
reset role;
select recipient_type, channel, status, payload->>'guestName' as guest_name from public.notifications
 where reservation_id = (select booking_e_id from _t_booking_e) and template_code = 'reservation_confirmed';
\echo '(expected: recipient_type=guest, channel=email, status=queued (NOT dispatched -- no real email provider wired up), guest_name="Guest With Email")'
select count(*) as staff_notified_for_guest_booking from public.notifications
 where reservation_id = (select booking_e_id from _t_booking_e) and recipient_type = 'staff' and template_code = 'reservation_created';
\echo '(expected: 1, not 2 -- a guest booking has no created_by_user_id to skip, so in principle BOTH active staff would be notified, but the manager permanently opted out of new_reservation in test B and never opted back in, so only the owner gets this one)'
select count(*) as reminder_rows_for_guest from public.notifications
 where reservation_id = (select booking_e_id from _t_booking_e) and template_code = 'reservation_reminder';
\echo '(expected: 0 -- the only active rule left after test C/D is channel=push, and a guest with no account has no push channel to reach; only a channel=email rule could ever reach them)'

\echo ''
\echo '=== TEST F: cancellation queues cancellation notices AND withdraws its own queued reminder ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
update public.reservations set status = 'cancelled', cancellation_reason = 'test cleanup' where id = (select booking_c_id from _t_booking_c);
reset role;
select count(*) as staff_cancel_notices from public.notifications
 where reservation_id = (select booking_c_id from _t_booking_c) and recipient_type = 'staff' and template_code = 'reservation_cancelled';
\echo '(expected: 2 -- unlike new_reservation, cancellation has no "who did it" column to skip by, so every active staff member is notified, including the owner who just cancelled it themselves -- disclosed, intentional)'
select count(*) as customer_cancel_notice from public.notifications
 where reservation_id = (select booking_c_id from _t_booking_c) and recipient_type = 'customer' and template_code = 'reservation_cancelled';
\echo '(expected: 1 -- the customer gets a cancellation receipt too, even though they were not the one who cancelled it here)'
select count(*) as leftover_reminder from public.notifications
 where reservation_id = (select booking_c_id from _t_booking_c) and template_code = 'reservation_reminder' and status = 'queued';
\echo '(expected: 0 -- the reminder queued in test C/D was withdrawn the moment this reservation was cancelled)'

\echo ''
\echo '=== TEST G: no-show notifies staff, never the customer ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select id as booking_g_id into temporary table _t_booking_g from public.book_reservation(
  p_restaurant_id => 'bbbbbbbb-0000-0000-0000-000000000001',
  p_starts_at     => (current_date + interval '6 days' + time '13:00') at time zone 'Europe/Athens',
  p_ends_at       => (current_date + interval '6 days' + time '14:30') at time zone 'Europe/Athens',
  p_party_size    => 2,
  p_source        => 'admin',
  p_customer_id   => 'eeeeeeee-0000-0000-0000-000000000001'
);
update public.reservations set status = 'no_show' where id = (select booking_g_id from _t_booking_g);
reset role;
select count(*) as staff_no_show_notices from public.notifications
 where reservation_id = (select booking_g_id from _t_booking_g) and recipient_type = 'staff' and template_code = 'no_show_recorded';
\echo '(expected: 2 -- both active staff members)'
select count(*) as customer_no_show_notices from public.notifications
 where reservation_id = (select booking_g_id from _t_booking_g) and recipient_type = 'customer' and template_code = 'no_show_recorded';
\echo '(expected: 0 -- a no-show is never surfaced to the guest in-app, by design)'

\echo ''
\echo '=== TEST H: reschedule recomputes reminders and notifies customer + staff ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select id as booking_h_id into temporary table _t_booking_h from public.book_reservation(
  p_restaurant_id => 'bbbbbbbb-0000-0000-0000-000000000001',
  p_starts_at     => (current_date + interval '7 days' + time '13:00') at time zone 'Europe/Athens',
  p_ends_at       => (current_date + interval '7 days' + time '14:30') at time zone 'Europe/Athens',
  p_party_size    => 2,
  p_source        => 'admin',
  p_customer_id   => 'eeeeeeee-0000-0000-0000-000000000001'
);
select (public.book_reservation(
  p_restaurant_id  => 'bbbbbbbb-0000-0000-0000-000000000001',
  p_starts_at      => (current_date + interval '8 days' + time '14:00') at time zone 'Europe/Athens',
  p_ends_at        => (current_date + interval '8 days' + time '15:30') at time zone 'Europe/Athens',
  p_party_size     => 2,
  p_customer_id    => 'eeeeeeee-0000-0000-0000-000000000001',
  p_reservation_id => (select booking_h_id from _t_booking_h)
)).status as rescheduled_status;
reset role;
select starts_at from public.reservations where id = (select booking_h_id from _t_booking_h);
\echo '(expected: the NEW time, 8 days out at 14:00 Athens)'
select recipient_type, channel, status, scheduled_for = (select starts_at from public.reservations where id = (select booking_h_id from _t_booking_h)) - interval '120 min' as fires_120min_before_new_time
  from public.notifications
 where reservation_id = (select booking_h_id from _t_booking_h) and template_code = 'reservation_reminder';
\echo '(expected: exactly one row, recomputed against the NEW start time, not the old one)'
select count(*) as reschedule_notices from public.notifications
 where reservation_id = (select booking_h_id from _t_booking_h) and template_code = 'reservation_rescheduled';
\echo '(expected: 3 -- 2 staff + 1 customer)'

\echo ''
\echo '=== TEST I: staff can mark ONLY their own notification read -- nothing else ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false); -- manager
select id as manager_notif_id into temporary table _t_manager_notif from public.notifications
 where recipient_user_id = '33333333-3333-3333-3333-333333333333' and reservation_id = (select booking_a_id from _t_booking_a) limit 1;
update public.notifications set status = 'read' where id = (select manager_notif_id from _t_manager_notif);
select status from public.notifications where id = (select manager_notif_id from _t_manager_notif);
reset role;
\echo '(expected: status = read -- a recipient marking their own row read succeeds)'

set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
update public.notifications set status = 'sent' where id = (select manager_notif_id from _t_manager_notif);
reset role;
\echo '(expected: ERROR: new row violates row-level security policy -- the WITH CHECK only ever allows status=read, never any other value, even on your own row)'

-- (no temp table here on purpose: it would be created under the postgres
-- superuser role at this point in the script, and a later `set role
-- authenticated` block would then hit "permission denied" reading a temp
-- table it doesn't own -- a plain subquery avoids the issue entirely and
-- is resolved fresh, under the right role, every time it's used below.)
set role authenticated;
select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false); -- manager, NOT the owner
select count(*) as manager_can_see_owners_row from public.notifications
 where recipient_user_id = '11111111-1111-1111-1111-111111111111' and template_code = 'reservation_cancelled';
update public.notifications set status = 'read'
 where recipient_user_id = '11111111-1111-1111-1111-111111111111' and template_code = 'reservation_cancelled';
reset role;
select status from public.notifications
 where recipient_user_id = '11111111-1111-1111-1111-111111111111' and template_code = 'reservation_cancelled';
\echo '(expected: manager_can_see_owners_row=1 -- both are staff at the same restaurant, is_restaurant_member lets them see each others notifications per the pre-existing 0011 SELECT policy -- but the UPDATE right above silently affects 0 rows, so status stays whatever it already was, NOT read: this is the mark-as-read policy correctly being narrower than the SELECT policy.)'

\echo ''
\echo '=== TEST J: customer inbox -- own notifications, mark read, cross-customer isolation ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false); -- the customer (Maria)
select count(*) as marias_inbox_count from public.notifications where recipient_customer_id = 'eeeeeeee-0000-0000-0000-000000000001';
select id as maria_notif_id into temporary table _t_maria_notif from public.notifications
 where recipient_customer_id = 'eeeeeeee-0000-0000-0000-000000000001' and template_code = 'reservation_cancelled' limit 1;
update public.notifications set status = 'read' where id = (select maria_notif_id from _t_maria_notif);
select status from public.notifications where id = (select maria_notif_id from _t_maria_notif);
reset role;
\echo '(expected: marias_inbox_count > 0, and after the update, status = read)'

set role authenticated;
select set_config('request.jwt.claim.sub', '55555555-0000-0000-0000-000000000002', false); -- unrelated second customer
select count(*) as second_customer_sees_marias_inbox from public.notifications where recipient_customer_id = 'eeeeeeee-0000-0000-0000-000000000001';
reset role;
\echo '(expected: 0 -- customers, unlike staff, have no is_restaurant_member escape hatch; complete cross-customer isolation)'

\echo ''
\echo '=== TEST K: queue_notification() really is the only insert path ==='
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false); -- even a real owner...
insert into public.notifications (restaurant_id, recipient_type, recipient_user_id, channel, template_code)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'staff', '11111111-1111-1111-1111-111111111111', 'in_app', 'hand_crafted');
reset role;
\echo '(expected: ERROR: new row violates row-level security policy for table "notifications" -- there has never been an INSERT policy on this table for any client role; queue_notification()''s SECURITY DEFINER is the only door in.)'

\echo ''
\echo '=== CLEANUP ==='
delete from public.reservations where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001'
  and id in (
    select booking_a_id from _t_booking_a
    union select booking_b_id from _t_booking_b
    union select booking_c_id from _t_booking_c
    union select booking_e_id from _t_booking_e
    union select booking_g_id from _t_booking_g
    union select booking_h_id from _t_booking_h
  );
delete from public.reminder_rules where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001';
delete from public.staff_notification_preferences where restaurant_id = 'bbbbbbbb-0000-0000-0000-000000000001';
delete from public.customers where id = 'eeeeeeee-0000-0000-0000-000000000002';
delete from auth.users where id = '55555555-0000-0000-0000-000000000002';
drop table if exists _t_booking_a, _t_booking_b, _t_booking_c, _t_booking_e, _t_booking_g, _t_booking_h, _t_manager_notif, _t_maria_notif;
\echo 'done.'
