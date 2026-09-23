-- =============================================================================
-- 0045_staff_web_push.sql
-- Phase 24: the iPhone/desktop half of staff push notifications. Phase 23
-- (0044) covers Android/native via Expo push tokens (push_tokens) -- but a
-- native iOS build needs an Apple Developer account, a Mac, and App Store/
-- TestFlight distribution, none of which exist for this project yet (see
-- README's own note on this decision). Instead: a minimal installable web
-- page (apps/web's new /staff route) that a staff member adds to their
-- iPhone/iPad home screen (Safari 16.4+) or any desktop browser, and
-- subscribes to standard Web Push -- exactly the same browser API already
-- proven end-to-end in production for the guest waitlist feature (0030-
-- 0032, apps/web/src/lib/webPush.ts, apps/web/public/sw.js's existing
-- 'push'/'notificationclick' listeners, which are already generic enough
-- to show ANY {title, body} push payload, not just a waitlist match).
--
-- This table is deliberately separate from push_tokens (0044), not a third
-- 'platform' value on it -- a Web Push subscription is a whole object
-- ({endpoint, keys: {p256dh, auth}}), not a single opaque string like an
-- Expo push token, so it needs its own columns. Same ownership/RLS shape
-- as push_tokens otherwise: one row per (staff user, browser
-- installation), owner-only, unique on endpoint so re-subscribing the same
-- installation is an upsert.
-- =============================================================================

create table public.staff_web_push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_staff_web_push_subscriptions_user on public.staff_web_push_subscriptions(user_id);

create trigger trg_staff_web_push_subscriptions_updated_at
  before update on public.staff_web_push_subscriptions
  for each row execute function public.set_updated_at();

comment on table public.staff_web_push_subscriptions is
  'Phase 24. One row per (staff user, browser installation) Web Push subscription -- the iPhone/desktop counterpart to push_tokens (0044, Expo/Android). Written by the /staff PWA page itself (apps/web/src/lib/webPush.ts) right after the user grants notification permission -- never by any trigger or server-side code. unique(endpoint) makes re-subscribing the same installation an upsert.';

alter table public.staff_web_push_subscriptions enable row level security;

create policy staff_web_push_subscriptions_owner_all on public.staff_web_push_subscriptions for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

comment on policy staff_web_push_subscriptions_owner_all on public.staff_web_push_subscriptions is
  'Phase 24. A user may insert/select/update/delete only their own subscription rows. dispatch-notifications reads this table via the service-role client, exactly like push_tokens (0044), so this policy never has to grant broader read access than "your own installation".';
