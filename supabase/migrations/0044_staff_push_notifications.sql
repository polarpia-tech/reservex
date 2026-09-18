-- =============================================================================
-- 0044_staff_push_notifications.sql
-- Phase 23: real push notifications to restaurant staff (owner/manager/
-- server) when a new reservation comes in -- while the app is closed, the
-- tablet is asleep, or nobody is looking at it. Closes the gap left open
-- since Phase 09 (0016): 'push' has been a valid notification_channel
-- since 0008, but nothing ever queued a staff row on it, and nothing ever
-- sent one -- 0016's own comment on queue_notification says so plainly
-- ("push/email/sms/whatsapp rows stay queued ... until a real dispatcher --
-- not built in Phase 09 -- picks them up"), and Phase 22 (0043) built that
-- dispatcher for email/sms only, by explicit, disclosed design (its own
-- header: "'push'/'whatsapp' rows are left exactly as they've always
-- been ... honestly still 'not built'").
--
-- This migration: (1) a table to hold each staff member's device push
-- token(s), (2) a 'push' queuing path alongside the existing 'in_app' one
-- on new-reservation, reusing should_notify_staff's own preference model,
-- and (3) widens Phase 22's claim/dispatch trigger machinery to also
-- cover 'push' rows for staff, exactly the same claim -> sending -> sent/
-- failed state machine already proven for email/sms. The actual Expo Push
-- API call is added to the dispatch-notifications Edge Function
-- (supabase/functions/dispatch-notifications), not here -- same split as
-- 0043/Resend/Twilio.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. push_tokens: one row per (user, device). A staff member can be signed
-- in on more than one device (a personal phone AND the shop's tablet), so
-- this is keyed on the token itself, not one row per user -- unique on
-- expo_push_token means re-registering the same device just upserts
-- (updates updated_at) instead of accumulating duplicate rows, and signing
-- out on that device deletes exactly that one token, leaving any other
-- device's token untouched.
-- ---------------------------------------------------------------------------
create table public.push_tokens (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  expo_push_token   text not null unique,
  platform          text not null check (platform in ('ios', 'android')),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_push_tokens_user on public.push_tokens(user_id);

create trigger trg_push_tokens_updated_at
  before update on public.push_tokens
  for each row execute function public.set_updated_at();

comment on table public.push_tokens is
  'Phase 23. One row per (staff user, device) Expo push token. Written by the mobile app itself right after the user grants notification permission (see apps/mobile/src/services/pushNotifications.ts) -- never by any trigger or server-side code. unique(expo_push_token) makes re-registering the same device an upsert, and lets a signed-out device delete only its own row.';

alter table public.push_tokens enable row level security;

-- A staff member manages ONLY their own token rows -- register on login,
-- delete on logout, nothing else. No admin/staff-of-same-restaurant
-- visibility is needed: dispatch-notifications reads this table with the
-- service-role client (see supabaseAdmin.ts), which bypasses RLS
-- entirely, exactly like every other Phase 22 provider call.
create policy push_tokens_owner_all on public.push_tokens for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on policy push_tokens_owner_all on public.push_tokens is
  'Phase 23. A user may insert/select/update/delete only their own push token rows. The dispatcher reads this table via the service-role client, so this policy never has to grant broader read access than "your own device".';

-- ---------------------------------------------------------------------------
-- 2. should_notify_staff, 4-arg overload: same preference lookup as the
-- existing 3-arg version (which stays untouched and keeps defaulting every
-- existing 'in_app' call site in reservations_notify_on_change), but for an
-- explicit channel -- used below to gate 'push' the same way 'in_app' is
-- already gated, via the SAME staff_notification_preferences table (0008),
-- just filtered to channel = 'push' instead of hardcoded to 'in_app'.
-- Default (no explicit preference row) is true: push is ON unless a staff
-- member turns it off, matching the "a new reservation is exactly the kind
-- of thing you want to be woken up for" intent behind this whole feature.
-- ---------------------------------------------------------------------------
create or replace function public.should_notify_staff(
  p_restaurant_id uuid,
  p_user_id uuid,
  p_event_type text,
  p_channel public.notification_channel
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_enabled from public.staff_notification_preferences
      where restaurant_id = p_restaurant_id and user_id = p_user_id
        and event_type = p_event_type and channel = p_channel),
    true
  );
$$;

comment on function public.should_notify_staff(uuid, uuid, text, public.notification_channel) is
  'Phase 23. Same lookup as the 3-arg should_notify_staff (which stays as the in_app-hardcoded version every existing call site already uses), generalized to an explicit channel -- used for the new push-notification gate.';

revoke all on function public.should_notify_staff(uuid, uuid, text, public.notification_channel) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. reservations_notify_on_change: full replace (same signature -- CREATE
-- OR REPLACE is safe here, unlike claim_notifications_for_dispatch below).
-- The ONLY change from 0016's version is the one new `if` block inside the
-- INSERT branch's staff loop, queuing a 'push' row alongside the existing
-- 'in_app' one. Every other branch (cancellation/no-show/reschedule) is
-- copied verbatim, unchanged -- this migration deliberately does not add
-- push for those yet (staying scoped to "tell me about a NEW booking",
-- the actual ask this Phase addresses); a follow-up phase can extend the
-- same pattern to those branches later.
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

    -- Staff, in-app + push, skipping whoever just made the booking
    -- themselves -- they already see the result on their own screen.
    for v_staff in
      select ru.user_id from public.restaurant_users ru
      where ru.restaurant_id = new.restaurant_id and ru.is_active
        and ru.user_id is distinct from new.created_by_user_id
    loop
      if public.should_notify_staff(new.restaurant_id, v_staff.user_id, 'new_reservation') then
        perform public.queue_notification(new.restaurant_id, 'staff', null, v_staff.user_id, 'in_app', 'reservation_created', v_payload, new.id);
      end if;
      -- Phase 23: the actual ask -- wake up whoever isn't looking at the
      -- app right now. Gated by the SAME staff_notification_preferences
      -- table, just for channel='push', so a staff member who wants the
      -- in-app inbox entry but not a phone buzz (or vice versa) can turn
      -- either off independently via setNotificationPreference.
      if public.should_notify_staff(new.restaurant_id, v_staff.user_id, 'new_reservation', 'push') then
        perform public.queue_notification(new.restaurant_id, 'staff', null, v_staff.user_id, 'push', 'reservation_created', v_payload, new.id);
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

comment on function public.reservations_notify_on_change is
  'Phase 09 trigger function, Phase 23: the INSERT branch now also queues a push notification to staff on a new reservation (should_notify_staff(...,''push'') gate), alongside the pre-existing in_app one. Every other branch unchanged from 0016.';

-- ---------------------------------------------------------------------------
-- 4. claim_notifications_for_dispatch: widen to also claim 'push' rows for
-- staff. This CHANGES the returned column list (adds recipient_user_id),
-- which CREATE OR REPLACE cannot do for a function with a RETURNS TABLE
-- signature -- Postgres requires dropping it first.
-- ---------------------------------------------------------------------------
drop function if exists public.claim_notifications_for_dispatch(int);

create or replace function public.claim_notifications_for_dispatch(p_limit int default 25)
returns table (
  id uuid,
  restaurant_id uuid,
  restaurant_name text,
  restaurant_timezone text,
  channel public.notification_channel,
  template_code text,
  payload jsonb,
  recipient_type public.notification_recipient_type,
  recipient_user_id uuid,
  to_email citext,
  to_phone text,
  locale text,
  dispatch_attempts int
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with due as (
    select n.id
    from public.notifications n
    where n.status = 'queued'
      and (
        (n.channel in ('email', 'sms') and n.recipient_type in ('customer', 'guest'))
        or (n.channel = 'push' and n.recipient_type = 'staff')
      )
      and (n.scheduled_for is null or n.scheduled_for <= now())
    order by n.scheduled_for nulls first, n.created_at
    limit p_limit
    for update skip locked
  ),
  claimed as (
    update public.notifications n
    set status = 'sending', dispatch_attempts = n.dispatch_attempts + 1, last_attempt_at = now()
    from due
    where n.id = due.id
    returning n.*
  )
  select
    claimed.id,
    claimed.restaurant_id,
    r.name,
    r.timezone,
    claimed.channel,
    claimed.template_code,
    claimed.payload,
    claimed.recipient_type,
    claimed.recipient_user_id,
    coalesce(c.email, res.guest_email) as to_email,
    coalesce(c.phone, res.guest_phone) as to_phone,
    coalesce(c.preferred_locale, r.default_locale) as locale,
    claimed.dispatch_attempts
  from claimed
  join public.restaurants r on r.id = claimed.restaurant_id
  left join public.customers c on claimed.recipient_type = 'customer' and c.id = claimed.recipient_customer_id
  left join public.reservations res on claimed.recipient_type = 'guest' and res.id = claimed.reservation_id;
end;
$$;

comment on function public.claim_notifications_for_dispatch is
  'Phase 22/23. Atomically claims up to p_limit due, queued email/sms (customer/guest) OR push (staff) notifications (FOR UPDATE SKIP LOCKED), flips them to status=sending, and returns everything dispatch-notifications needs -- including recipient_user_id now, for looking up that staff member''s push_tokens rows. SECURITY DEFINER; EXECUTE revoked from anon/authenticated below -- callable only via the service-role Edge Function client.';

revoke all on function public.claim_notifications_for_dispatch(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. The immediate-dispatch trigger: widen to also ping for 'push' rows.
-- WHEN clauses cannot be ALTERed, so drop + recreate, same as 0043 itself
-- did to first introduce this trigger.
-- ---------------------------------------------------------------------------
create or replace function public.trigger_dispatch_notifications_on_insert()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
declare
  v_webhook_secret text;
  v_function_url constant text :=
    'https://uzbhmapldymvzpqqegub.supabase.co/functions/v1/dispatch-notifications';
begin
  if new.channel not in ('email', 'sms', 'push') or new.status <> 'queued' then
    return new;
  end if;

  select decrypted_secret
    into v_webhook_secret
    from vault.decrypted_secrets
    where name = 'notifications_webhook_secret'
    limit 1;

  if v_webhook_secret is null then
    raise warning 'trigger_dispatch_notifications_on_insert: notifications_webhook_secret not found in Vault, skipping immediate dispatch ping for notification %', new.id;
    return new;
  end if;

  perform net.http_post(
    url := v_function_url,
    body := jsonb_build_object('reason', 'notification_inserted', 'notification_id', new.id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_webhook_secret
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

revoke all on function public.trigger_dispatch_notifications_on_insert() from public, anon, authenticated;

drop trigger if exists trg_dispatch_notifications_on_insert on public.notifications;
create trigger trg_dispatch_notifications_on_insert
  after insert on public.notifications
  for each row
  when (new.channel in ('email', 'sms', 'push') and new.status = 'queued')
  execute function public.trigger_dispatch_notifications_on_insert();

comment on trigger trg_dispatch_notifications_on_insert on public.notifications is
  'Phase 22/23. Pings dispatch-notifications via pg_net immediately after an email/sms/push row is queued, so staff do not have to wait for the next cron sweep to be woken up about a new reservation.';
