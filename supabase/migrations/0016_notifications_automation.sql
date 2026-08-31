-- =============================================================================
-- 0016_notifications_automation.sql
-- Phase 09: turns the Phase 02 notifications schema (0008) from an inert
-- table with no writer into something that actually queues messages when
-- real events happen -- a new reservation, a cancellation, a no-show, and
-- scheduled pre-arrival reminders -- plus a genuinely working in-app inbox
-- for both restaurant staff and customers.
--
-- Honesty note, upfront (see the Phase 09 README section for the full
-- version): this migration makes QUEUEING and IN-APP delivery real and
-- verified end to end. It does NOT add a working push/email/SMS
-- dispatcher -- that needs a real external provider (Expo Push/FCM/APNs
-- for push, an email API for email) that this sandbox has no network
-- access to test against. A row queued for the 'push'/'email' channel
-- sits at status='queued' exactly as it always could since Phase 02;
-- only 'in_app' rows are actually "delivered" the instant they're
-- inserted, because the in-app inbox reads this very table directly --
-- there is no separate delivery step for that channel, or need for one.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. New enum values.
--
-- 'in_app' on notification_channel: the one channel this phase can
-- honestly claim is fully delivered (see above).
--
-- 'guest' on notification_recipient_type: a real gap this migration fixes.
-- 0008 (Phase 02) predates Phase 08's anonymous guest bookings -- its
-- check constraint below assumed every notification recipient is either a
-- customers row or an auth.users row. A guest reservation (no customer_id
-- at all, per Phase 08's book_public_reservation) has neither, so without
-- this fix there would be no way to even queue a "your reservation is
-- confirmed" email for a guest who never created an account.
-- ---------------------------------------------------------------------------
alter type public.notification_channel add value if not exists 'in_app';
alter type public.notification_recipient_type add value if not exists 'guest';

-- ---------------------------------------------------------------------------
-- 2. Loosen the recipient/type check constraint to allow the new 'guest'
--    case: no customer_id, no user_id -- whatever contact info exists
--    (guest_email/guest_phone) travels in `payload` instead, since there is
--    no row anywhere to join back to. `restaurants_public_select`-style
--    reasoning applies here too: a guest notification is visible to NO ONE
--    via notifications_select (0011) except restaurant staff -- there is no
--    account for anon/authenticated-as-guest to read it back with, which is
--    consistent with Phase 08's "guests can't read their booking back either".
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint notifications_recipient_matches_type;
alter table public.notifications add constraint notifications_recipient_matches_type check (
  (recipient_type = 'customer' and recipient_customer_id is not null and recipient_user_id is null)
  or
  (recipient_type = 'staff' and recipient_user_id is not null and recipient_customer_id is null)
  or
  (recipient_type = 'guest' and recipient_customer_id is null and recipient_user_id is null)
);

-- ---------------------------------------------------------------------------
-- 3. Link a notification back to the reservation that caused it. Lets a
--    cancellation withdraw its OWN still-queued reminders (see the trigger
--    below) with a plain indexed equality, and lets the inbox UI offer a
--    "view reservation" deep link.
-- ---------------------------------------------------------------------------
alter table public.notifications add column if not exists reservation_id uuid references public.reservations(id) on delete cascade;
create index if not exists idx_notifications_reservation on public.notifications(reservation_id) where reservation_id is not null;

-- 'in_app' is deliberately not a valid reminder_rules.channel. queue_notification()
-- marks an in_app row 'delivered' the instant it is inserted, regardless of
-- scheduled_for -- correct for every OTHER use of that channel (an in-app
-- notification IS visible the moment it's created), but wrong for a
-- reminder, whose entire point is to appear LATER, closer to arrival. A
-- real "deliver this in-app row at its scheduled_for time" mechanism would
-- need an actual background worker, which does not exist yet (see the
-- dispatcher note in this migration's header) -- so this constraint stops
-- an owner from configuring a rule that would silently misbehave instead
-- of leaving it as an untested trap.
alter table public.reminder_rules drop constraint if exists reminder_rules_channel_not_in_app;
alter table public.reminder_rules add constraint reminder_rules_channel_not_in_app check (channel <> 'in_app');

-- ---------------------------------------------------------------------------
-- 4. queue_notification(): the ONLY path that ever inserts into
--    notifications. SECURITY DEFINER, because notifications_select (0011)
--    is the only RLS policy this table has ever had -- there is
--    deliberately no insert grant for `authenticated`/`anon` at all,
--    matching 0008's own original comment ("a background worker picks up
--    status=queued rows"). Every trigger in this migration calls this
--    instead of inserting directly, so there is exactly one place that
--    decides what "already delivered" means for a given channel.
-- ---------------------------------------------------------------------------
create or replace function public.queue_notification(
  p_restaurant_id uuid,
  p_recipient_type public.notification_recipient_type,
  p_recipient_customer_id uuid,
  p_recipient_user_id uuid,
  p_channel public.notification_channel,
  p_template_code text,
  p_payload jsonb default '{}'::jsonb,
  p_reservation_id uuid default null,
  p_scheduled_for timestamptz default null
)
returns public.notifications
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.notifications;
begin
  insert into public.notifications (
    restaurant_id, recipient_type, recipient_customer_id, recipient_user_id,
    channel, template_code, payload, reservation_id, scheduled_for,
    status, sent_at
  ) values (
    p_restaurant_id, p_recipient_type, p_recipient_customer_id, p_recipient_user_id,
    p_channel, p_template_code, p_payload, p_reservation_id, p_scheduled_for,
    (case when p_channel = 'in_app' then 'delivered' else 'queued' end)::public.notification_status,
    case when p_channel = 'in_app' then now() else null end
  )
  returning * into v_row;
  return v_row;
end;
$$;

comment on function public.queue_notification is
  'The only INSERT path into public.notifications. in_app rows are marked delivered immediately -- the inbox IS the delivery mechanism for that channel. push/email/sms/whatsapp rows stay queued (as they always could) until a real dispatcher -- not built in Phase 09 -- picks them up.';

-- ---------------------------------------------------------------------------
-- 5. should_notify_staff(): true unless that staff member has explicitly
--    turned OFF this event type for the 'in_app' channel. Absence of a
--    staff_notification_preferences row means "use the platform default",
--    per 0008's own comment on that table -- the default here is ON, since
--    an in-app inbox item is low-noise (it just sits in a list; nothing
--    pushes/rings/emails from it).
-- ---------------------------------------------------------------------------
create or replace function public.should_notify_staff(p_restaurant_id uuid, p_user_id uuid, p_event_type text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_enabled from public.staff_notification_preferences
      where restaurant_id = p_restaurant_id and user_id = p_user_id
        and event_type = p_event_type and channel = 'in_app'),
    true
  );
$$;

-- ---------------------------------------------------------------------------
-- 6. schedule_reservation_reminders(): (re)computes every pre-arrival
--    reminder for one reservation from its restaurant's active
--    reminder_rules. Always starts by deleting this reservation's own
--    still-queued reminders, so it is safe to call again after a
--    reschedule -- old timings never linger alongside new ones.
--
--    A rule whose fire time has already passed (e.g. a "24h before" rule
--    on a reservation booked same-day) is silently skipped -- sending a
--    reminder in the past makes no sense, and this is not an error.
-- ---------------------------------------------------------------------------
create or replace function public.schedule_reservation_reminders(p_reservation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_res public.reservations%rowtype;
  v_rule record;
  v_fire_at timestamptz;
  v_payload jsonb;
begin
  select * into v_res from public.reservations where id = p_reservation_id;
  if not found or v_res.status <> 'confirmed' then
    return;
  end if;

  delete from public.notifications
   where reservation_id = p_reservation_id and template_code = 'reservation_reminder' and status = 'queued';

  for v_rule in
    select * from public.reminder_rules where restaurant_id = v_res.restaurant_id and is_active
  loop
    v_fire_at := v_res.starts_at - make_interval(mins => v_rule.minutes_before_start);
    if v_fire_at <= now() then
      continue;
    end if;

    v_payload := jsonb_build_object(
      'reservationId', v_res.id, 'startsAt', v_res.starts_at, 'partySize', v_res.party_size, 'reminderRuleId', v_rule.id
    );

    if v_res.customer_id is not null then
      perform public.queue_notification(
        v_res.restaurant_id, 'customer', v_res.customer_id, null, v_rule.channel,
        'reservation_reminder', v_payload, v_res.id, v_fire_at
      );
    elsif v_res.guest_email is not null and v_rule.channel = 'email' then
      -- A guest with no account can only ever be reached by email (there is
      -- no push token, no in-app session to show an inbox in) -- a rule
      -- configured for push/sms/whatsapp simply has no reachable channel
      -- for this guest and is silently skipped, same as "nothing to queue".
      perform public.queue_notification(
        v_res.restaurant_id, 'guest', null, null, 'email',
        'reservation_reminder', v_payload, v_res.id, v_fire_at
      );
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. The trigger that ties it all together. AFTER INSERT OR UPDATE on
--    reservations -- covers every path that creates/changes one:
--    book_reservation (Phase 07, staff+AI) and book_public_reservation
--    (Phase 08, guest+customer) both funnel through the same reservations
--    table, so this is the one place that needs to know about either.
-- ---------------------------------------------------------------------------
create or replace function public.reservations_notify_on_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff record;
  v_payload jsonb;
begin
  if tg_op = 'INSERT' then
    v_payload := jsonb_build_object(
      'reservationId', new.id, 'startsAt', new.starts_at, 'partySize', new.party_size,
      'guestName', coalesce(new.guest_name, (select full_name from public.customers c where c.id = new.customer_id))
    );

    -- Staff, in-app, skipping whoever just made the booking themselves --
    -- they already see the result on their own screen. (Cancellation/
    -- no-show below do NOT have an equivalent "who did this" column to
    -- skip by -- reservations only tracks its original creator, not who
    -- last changed its status -- so every active staff member is notified
    -- there. Disclosed asymmetry, not an oversight.)
    for v_staff in
      select ru.user_id from public.restaurant_users ru
      where ru.restaurant_id = new.restaurant_id and ru.is_active
        and ru.user_id is distinct from new.created_by_user_id
    loop
      if public.should_notify_staff(new.restaurant_id, v_staff.user_id, 'new_reservation') then
        perform public.queue_notification(new.restaurant_id, 'staff', null, v_staff.user_id, 'in_app', 'reservation_created', v_payload, new.id);
      end if;
    end loop;

    -- Confirmation to whoever made it: in-app if they have a customer
    -- account, a queued (not dispatched) email if they're a guest who gave
    -- an email, nothing at all if neither (matches book_public_reservation's
    -- own GUEST_DETAILS_REQUIRED rule -- every guest booking has at least a
    -- phone or an email, but a phone-only guest has no channel to reach here).
    if new.customer_id is not null then
      perform public.queue_notification(new.restaurant_id, 'customer', new.customer_id, null, 'in_app', 'reservation_confirmed', v_payload, new.id);
    elsif new.guest_email is not null then
      perform public.queue_notification(new.restaurant_id, 'guest', null, null, 'email', 'reservation_confirmed', v_payload, new.id);
    end if;

    perform public.schedule_reservation_reminders(new.id);
    return new;
  end if;

  -- tg_op = 'UPDATE' from here on.

  if new.status is distinct from old.status and new.status = 'cancelled' then
    v_payload := jsonb_build_object('reservationId', new.id, 'startsAt', new.starts_at, 'partySize', new.party_size, 'cancellationReason', new.cancellation_reason);

    for v_staff in
      select ru.user_id from public.restaurant_users ru where ru.restaurant_id = new.restaurant_id and ru.is_active
    loop
      if public.should_notify_staff(new.restaurant_id, v_staff.user_id, 'cancellation') then
        perform public.queue_notification(new.restaurant_id, 'staff', null, v_staff.user_id, 'in_app', 'reservation_cancelled', v_payload, new.id);
      end if;
    end loop;

    if new.customer_id is not null then
      perform public.queue_notification(new.restaurant_id, 'customer', new.customer_id, null, 'in_app', 'reservation_cancelled', v_payload, new.id);
    elsif new.guest_email is not null then
      perform public.queue_notification(new.restaurant_id, 'guest', null, null, 'email', 'reservation_cancelled', v_payload, new.id);
    end if;

    -- Withdraw reminders that haven't gone out yet -- nobody should get a
    -- "see you tonight" reminder for a table they already cancelled.
    delete from public.notifications
     where reservation_id = new.id and template_code = 'reservation_reminder' and status = 'queued';

  elsif new.status is distinct from old.status and new.status = 'no_show' then
    v_payload := jsonb_build_object('reservationId', new.id, 'startsAt', new.starts_at, 'partySize', new.party_size);
    for v_staff in
      select ru.user_id from public.restaurant_users ru where ru.restaurant_id = new.restaurant_id and ru.is_active
    loop
      if public.should_notify_staff(new.restaurant_id, v_staff.user_id, 'no_show') then
        perform public.queue_notification(new.restaurant_id, 'staff', null, v_staff.user_id, 'in_app', 'no_show_recorded', v_payload, new.id);
      end if;
    end loop;

  elsif new.status = 'confirmed' and (new.starts_at, new.party_size) is distinct from (old.starts_at, old.party_size) then
    -- A reschedule (book_reservation's UPDATE branch never changes status
    -- itself -- see 0013) -- recompute reminders from the new time, and let
    -- everyone involved know the time/size actually changed.
    v_payload := jsonb_build_object('reservationId', new.id, 'startsAt', new.starts_at, 'partySize', new.party_size);

    for v_staff in
      select ru.user_id from public.restaurant_users ru where ru.restaurant_id = new.restaurant_id and ru.is_active
    loop
      if public.should_notify_staff(new.restaurant_id, v_staff.user_id, 'reschedule') then
        perform public.queue_notification(new.restaurant_id, 'staff', null, v_staff.user_id, 'in_app', 'reservation_rescheduled', v_payload, new.id);
      end if;
    end loop;

    if new.customer_id is not null then
      perform public.queue_notification(new.restaurant_id, 'customer', new.customer_id, null, 'in_app', 'reservation_rescheduled', v_payload, new.id);
    elsif new.guest_email is not null then
      perform public.queue_notification(new.restaurant_id, 'guest', null, null, 'email', 'reservation_rescheduled', v_payload, new.id);
    end if;

    perform public.schedule_reservation_reminders(new.id);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_reservations_notify on public.reservations;
create trigger trg_reservations_notify
  after insert or update on public.reservations
  for each row execute function public.reservations_notify_on_change();

comment on trigger trg_reservations_notify on public.reservations is
  'Phase 09: queues in-app/email notifications and (re)schedules reminders on create/cancel/no-show/reschedule. SECURITY DEFINER (via queue_notification/schedule_reservation_reminders) since notifications has no direct insert grant for any role.';

-- ---------------------------------------------------------------------------
-- 8. RLS: let a recipient mark their OWN notification as read. This is the
--    one write notifications has ever needed from a plain client -- no
--    insert policy is added (queue_notification's SECURITY DEFINER stays
--    the only writer), and the WITH CHECK below only ever allows the new
--    status to be 'read', so a recipient cannot forge a 'sent'/'delivered'
--    status or hand the row to someone else.
-- ---------------------------------------------------------------------------
drop policy if exists notifications_recipient_mark_read on public.notifications;
create policy notifications_recipient_mark_read on public.notifications for update
  using (
    (recipient_user_id is not null and recipient_user_id = auth.uid())
    or (recipient_customer_id is not null and owns_customer(recipient_customer_id))
  )
  with check (
    status = 'read'
    and (
      (recipient_user_id is not null and recipient_user_id = auth.uid())
      or (recipient_customer_id is not null and owns_customer(recipient_customer_id))
    )
  );

comment on policy notifications_recipient_mark_read on public.notifications is
  'Deliberately narrow, same pattern as reservations_customer_cancel (0014): a recipient may only ever flip THEIR OWN row to status=read, nothing else. A determined client could still rewrite payload/template_code on their own row via this same UPDATE (Postgres RLS cannot restrict which columns an UPDATE touches without an extra trigger) -- accepted, disclosed risk: the blast radius is "a user misleads their own inbox view", never another tenant''s data or another user''s row.';
