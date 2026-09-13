-- =============================================================================
-- 0043_notification_dispatch.sql
-- Phase 22: turns 'queued' email/sms notifications (Phase 09, 0016) into
-- messages actually delivered through a real provider (Resend for email,
-- Twilio for SMS), plumbed via the same pg_net + Vault pattern this project
-- already established for notify-waitlist (0032/0033) -- with one addition,
-- explained below, for the timing case that pattern alone cannot cover.
--
-- HONESTY NOTE, same discipline as every other Phase in this project: this
-- migration and the accompanying dispatch-notifications Edge Function make
-- the CLAIMING/RETRY/STATE-MACHINE side of dispatch real and verified
-- end-to-end against a local Postgres instance (see
-- scripts/verify_phase22_notification_dispatch.sql). The actual HTTP calls
-- to Resend/Twilio are NOT something a local migration or SQL test can
-- verify -- they need a real deployed function and real provider API keys.
-- That end-to-end send must be checked by hand once this is deployed and
-- the provider secrets are set (see this migration's own README section
-- for the exact one-time steps), not assumed to work because the code
-- looks right.
--
-- WHY THIS NEEDS SOMETHING notify-waitlist DIDN'T: notify-waitlist only
-- ever reacts to an event (availability just changed) -- a plain AFTER
-- INSERT/UPDATE trigger calling net.http_post is the whole story. Email/SMS
-- notifications have that SAME immediate case (a guest's booking
-- confirmation/cancellation, queued with scheduled_for = null -- see 0016's
-- reservations_notify_on_change), but ALSO a genuinely time-based case:
-- pre-arrival reminders, queued for a specific future scheduled_for that
-- nothing "happens" at except the clock reaching it. A trigger cannot fire
-- when nothing changes a row -- something has to periodically ask "is
-- anything due yet?". This project has no pg_cron scheduled job anywhere
-- (grep supabase/migrations for it -- there is none), and enabling pg_cron
-- is, like pg_net before it, a project-level Dashboard toggle this sandbox
-- cannot verify actually works here (see 0032's own header for the exact
-- kind of "looks supported, fails on this project" surprise pg_net was).
-- Rather than guess at a second unverifiable extension, the periodic sweep
-- for due reminders is a GitHub Actions scheduled workflow (this repo
-- already runs real, reviewable Actions YAML for CI/deploy -- see ci.yml/
-- deploy.yml's own header notes) hitting the SAME Edge Function on a
-- schedule. The trigger below stays for what it's actually good at: waking
-- up the function immediately for the common case (an immediate email),
-- instead of making every guest wait for the next cron tick.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. State machine additions.
--
-- 'sending': a row a dispatch call has claimed but not yet resolved. Exists
-- so two overlapping dispatch calls (the insert trigger firing at the same
-- moment a cron sweep is already in flight) can never both pick up the same
-- row -- claim_notifications_for_dispatch's own UPDATE ... WHERE status =
-- 'queued' below is what actually enforces this (ordinary row-level
-- locking: only one concurrent UPDATE can win per row), 'sending' is just
-- the visible marker of "already claimed, not done yet".
--
-- dispatch_attempts / last_attempt_at: lets mark_notification_dispatched
-- give up after repeated provider failures (a permanently invalid phone
-- number, say) instead of retrying the same row forever, and space retries
-- out instead of hammering the provider every single cron tick.
-- dispatch_attempts is incremented at CLAIM time (below), not at mark time
-- -- a claimed row that never gets resolved at all (the function crashes,
-- the container is killed mid-request) must still count as an attempt, or
-- a permanently-broken row claimed over and over by every cron tick would
-- never reach the retry ceiling.
-- ---------------------------------------------------------------------------
alter type public.notification_status add value if not exists 'sending';

alter table public.notifications add column if not exists dispatch_attempts int not null default 0;
alter table public.notifications add column if not exists last_attempt_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. claim_notifications_for_dispatch(): atomically claims up to p_limit
-- due, queued email/sms rows and returns everything the Edge Function needs
-- to actually send them -- the notification row itself, joined recipient
-- contact info, and the restaurant's name/timezone/default_locale for
-- rendering.
--
-- Deliberately scoped to recipient_type in ('customer', 'guest') and
-- channel in ('email', 'sms'): staff notifications are always queued as
-- 'in_app' (0016's reservations_notify_on_change never queues a staff
-- email/sms), and 'push'/'whatsapp' rows are left exactly as they've
-- always been since Phase 02/09 -- queued, undelivered, honestly still
-- "not built" (see this migration's header and the README section for
-- what that means for those two channels going forward).
--
-- Guest contact info has no FK of its own on notifications (0016's own
-- comment: a guest notification carries no customer_id/user_id at all) --
-- it lives on the reservation that caused it, so this joins reservations
-- via reservation_id. A guest reminder/confirmation whose reservation_id
-- is somehow null (should not happen -- every guest queue_notification
-- call in 0016 passes one) is defensively excluded rather than sent with
-- no address to send to.
-- ---------------------------------------------------------------------------
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
      and n.channel in ('email', 'sms')
      and n.recipient_type in ('customer', 'guest')
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
  'Phase 22. Atomically claims up to p_limit due, queued email/sms notifications (FOR UPDATE SKIP LOCKED, so concurrent callers never double-claim), flips them to status=sending, and returns everything dispatch-notifications needs to render and send them. SECURITY DEFINER: notifications/customers/reservations have no policy that would let an ordinary client run this join. EXECUTE revoked from anon/authenticated below -- callable only via the service-role Edge Function client.';

revoke all on function public.claim_notifications_for_dispatch(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. mark_notification_dispatched(): the only path back from 'sending'.
-- On success: 'sent' (matches the notifications table's own pre-existing
-- status vocabulary from 0008 -- this migration does not introduce a
-- separate "delivered by provider" step; provider delivery webhooks, e.g.
-- Resend's, are a real future improvement, not built here).
--
-- On failure: retry a bounded number of times (5) with a short linear
-- backoff (dispatch_attempts * 2 minutes) by going back to 'queued' with a
-- future scheduled_for, so the row is naturally picked up again by either
-- the next cron sweep or -- if another, unrelated row for the same
-- reservation triggers the insert path again -- sooner. After 5 attempts,
-- 'failed' permanently; error_message keeps the last provider error for
-- whoever investigates (see the new admin-visible gap this leaves,
-- disclosed in the README section, since there is no UI for this yet).
-- ---------------------------------------------------------------------------
create or replace function public.mark_notification_dispatched(
  p_id uuid,
  p_success boolean,
  p_provider_message_id text default null,
  p_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempts int;
begin
  if p_success then
    update public.notifications
    set status = 'sent', provider_message_id = p_provider_message_id, error_message = null, sent_at = now()
    where id = p_id and status = 'sending';
    return;
  end if;

  select dispatch_attempts into v_attempts from public.notifications where id = p_id;
  if v_attempts is null then
    return; -- row vanished/was already resolved elsewhere; nothing to do
  end if;

  if v_attempts >= 5 then
    update public.notifications
    set status = 'failed', error_message = p_error_message
    where id = p_id and status = 'sending';
  else
    update public.notifications
    set status = 'queued', error_message = p_error_message, scheduled_for = now() + make_interval(mins => v_attempts * 2)
    where id = p_id and status = 'sending';
  end if;
end;
$$;

comment on function public.mark_notification_dispatched is
  'Phase 22. The only path back from status=sending. Success -> sent. Failure -> queued with a short linear backoff for up to 5 attempts, then failed permanently. SECURITY DEFINER, EXECUTE revoked from anon/authenticated -- called only by the dispatch-notifications Edge Function with the service-role client.';

revoke all on function public.mark_notification_dispatched(uuid, boolean, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The immediate-dispatch trigger. Same shape as 0032's
-- trigger_notify_waitlist_on_availability_change: reads a shared secret
-- from Vault (name = 'notifications_webhook_secret', inserted by hand, one
-- time, never in a migration -- see this migration's README section), and
-- posts to dispatch-notifications via net.http_post if present.
--
-- Deliberately a thin "wake up, something might be due" ping with NO
-- notification-specific payload: the row this trigger fired for might not
-- even be email/sms (this fires on every insert), and by the time the HTTP
-- call is actually handled the row could already have been claimed by a
-- concurrent cron sweep anyway. dispatch-notifications always re-queries
-- via claim_notifications_for_dispatch rather than trusting anything this
-- trigger sends, so there is nothing sensitive to put in the body and
-- nothing wrong with pinging it once per insert even for in_app/push rows.
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
  if new.channel not in ('email', 'sms') or new.status <> 'queued' then
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
  when (new.channel in ('email', 'sms') and new.status = 'queued')
  execute function public.trigger_dispatch_notifications_on_insert();

comment on trigger trg_dispatch_notifications_on_insert on public.notifications is
  'Phase 22. Pings dispatch-notifications via pg_net immediately after an email/sms row is queued, so an immediate notification (e.g. a guest''s booking confirmation) does not have to wait for the next GitHub Actions cron sweep. Reminders (scheduled_for in the future) are unaffected by how fast this fires -- claim_notifications_for_dispatch only claims rows that are actually due -- so this trigger firing "too early" for a reminder is harmless, not a race.';
