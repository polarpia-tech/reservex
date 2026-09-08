-- Migration 0032: replace the Supabase Dashboard Database Webhook with our
-- own pg_net-based trigger, calling notify-waitlist directly
-- =============================================================================
-- Phase 6, Part 2b, final piece. The original plan (see migrations 0030/0031
-- and the notify-waitlist Edge Function's own header comment) was to wire
-- restaurant_availability_versions -> notify-waitlist through the Supabase
-- Dashboard's own "Database Webhooks" feature -- deliberately NOT in a
-- migration, specifically to avoid hand-writing an HTTP call from inside
-- Postgres and guessing the right internal argument shape.
--
-- That plan hit a real, live blocker: creating a Database Webhook on this
-- project fails with `ERROR: 3F000: schema "supabase_functions" does not
-- exist`, even after enabling the pg_net extension (the extension the
-- Dashboard feature itself says it needs). This is a genuine gap in this
-- project's own infrastructure, not something a migration can fix -- the
-- supabase_functions schema is Supabase-managed, not ours to create.
--
-- Rather than block Part 2b entirely on a Supabase Support ticket, this
-- migration achieves the exact same result ourselves, directly: a plain
-- AFTER INSERT OR UPDATE trigger on restaurant_availability_versions that
-- calls net.http_post(...) -- pg_net's own stable, public, documented
-- function (not the undocumented supabase_functions.http_request shape
-- 0030's header comment was originally worried about guessing wrong).
-- Firing a webhook this way is in fact exactly what the Dashboard feature
-- itself does under the hood; we are only skipping the layer that is
-- currently broken on this project, not inventing a new mechanism.
--
-- Two things this migration deliberately does NOT do:
--
-- 1. It does NOT put the shared webhook secret (WAITLIST_WEBHOOK_SECRET,
--    the same value already set as an Edge Function secret in migration
--    0030's delivery) anywhere in this file. A migration file is committed
--    to git; the secret is not something that belongs there. Instead, the
--    trigger function reads it at call time from Supabase Vault
--    (vault.decrypted_secrets), under the name 'waitlist_webhook_secret'.
--    That row is inserted once, by hand, directly in the SQL editor -- NOT
--    part of this migration, same discipline this project already applies
--    to the VAPID private key. If the secret is missing (e.g. this
--    migration ran before that one-time step), the trigger logs a warning
--    and does nothing, rather than breaking every availability update.
--
-- 2. It does NOT store or send a Supabase service-role JWT to authenticate
--    the HTTP call to notify-waitlist. Instead, migration accompanies a
--    config.toml change (`[functions.notify-waitlist] verify_jwt = false`)
--    that puts notify-waitlist in the exact same category stripe-webhook
--    and voice-webhook are already in -- a function called by a caller with
--    no Supabase session, authenticated by its own x-webhook-secret check
--    instead of Supabase's own gateway JWT check. This is a redeploy, not a
--    migration change; it must be applied via `supabase functions deploy
--    notify-waitlist` for the new config to take effect.
--
-- Security: this function reads a live secret from Vault, so it must never
-- be directly callable by a client role, in either direction -- not via the
-- Postgres-default PUBLIC-execute grant, and not via this project's own
-- platform-level default-privileges rule that grants EXECUTE on every new
-- function straight to anon/authenticated (the exact gap migration 0031
-- found and fixed for claim_waitlist_matches_for_restaurant). Both are
-- revoked explicitly below, from the start, instead of being caught by a
-- second follow-up migration this time.
-- =============================================================================

create or replace function public.trigger_notify_waitlist_on_availability_change()
returns trigger
security definer
set search_path = public
language plpgsql
as $$
declare
  v_webhook_secret text;
  v_function_url constant text :=
    'https://uzbhmapldymvzpqqegub.supabase.co/functions/v1/notify-waitlist';
begin
  select decrypted_secret
    into v_webhook_secret
    from vault.decrypted_secrets
    where name = 'waitlist_webhook_secret'
    limit 1;

  if v_webhook_secret is null then
    -- Expected right after this migration runs, before the one-time manual
    -- vault.create_secret step below has been done -- log and move on
    -- rather than failing every availability update in the meantime.
    raise warning 'trigger_notify_waitlist_on_availability_change: waitlist_webhook_secret not found in Vault, skipping notification for restaurant %', new.restaurant_id;
    return new;
  end if;

  perform net.http_post(
    url := v_function_url,
    body := jsonb_build_object(
      'type', tg_op,
      'table', tg_table_name,
      'record', to_jsonb(new)
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_webhook_secret
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

revoke all on function public.trigger_notify_waitlist_on_availability_change() from public, anon, authenticated;

drop trigger if exists notify_waitlist_on_availability_change on public.restaurant_availability_versions;

create trigger notify_waitlist_on_availability_change
  after insert or update on public.restaurant_availability_versions
  for each row
  execute function public.trigger_notify_waitlist_on_availability_change();

comment on function public.trigger_notify_waitlist_on_availability_change is
  'Phase 6, Part 2b (migration 0032). Fires on every insert/update of restaurant_availability_versions (the Phase 3 heartbeat table, 0025) and posts to the notify-waitlist Edge Function via pg_net.http_post -- a direct replacement for the Supabase Dashboard''s own "Database Webhooks" feature, which fails on this project (missing supabase_functions schema, see this migration''s header comment) even with pg_net enabled. Reads the shared x-webhook-secret value from Supabase Vault (name = ''waitlist_webhook_secret'', inserted by hand, never committed to a migration) rather than storing it in this file or sending a service-role JWT. security definer so it can read that Vault row regardless of who/what fired the underlying trigger; EXECUTE is explicitly revoked from public, anon and authenticated (this project''s own default privileges otherwise grant EXECUTE on every new function straight to anon/authenticated -- see migration 0031) so this can never be called directly as an ordinary function, only fired as a trigger.';
