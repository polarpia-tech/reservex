-- =============================================================================
-- 0008_notifications.sql
-- Purpose: outbound messages to staff and guests, across channels (push,
-- email, sms, whatsapp), plus the configuration for who gets notified about
-- what, and the automated reminder schedule.
-- =============================================================================

create type public.notification_channel as enum ('push', 'email', 'sms', 'whatsapp');
create type public.notification_recipient_type as enum ('customer', 'staff');
create type public.notification_status as enum ('queued', 'sent', 'delivered', 'failed', 'read');

-- ---------------------------------------------------------------------------
-- notifications: the outbound log. One row per message actually queued/sent.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id                      uuid primary key default gen_random_uuid(),
  restaurant_id           uuid references public.restaurants(id) on delete cascade,
  recipient_type          public.notification_recipient_type not null,
  recipient_customer_id   uuid references public.customers(id) on delete cascade,
  recipient_user_id       uuid references auth.users(id) on delete cascade,
  channel                 public.notification_channel not null,
  -- e.g. 'reservation_confirmed', 'reservation_cancelled', 'reservation_reminder',
  -- 'no_show_recorded', 'vip_reservation_created', 'large_party_alert'
  template_code           text not null,
  payload                 jsonb not null default '{}'::jsonb,
  status                  public.notification_status not null default 'queued',
  provider_message_id     text,
  error_message           text,
  scheduled_for           timestamptz,        -- null = send immediately
  sent_at                 timestamptz,
  created_at              timestamptz not null default now(),

  constraint notifications_recipient_matches_type check (
    (recipient_type = 'customer' and recipient_customer_id is not null and recipient_user_id is null)
    or
    (recipient_type = 'staff' and recipient_user_id is not null and recipient_customer_id is null)
  )
);

create index idx_notifications_restaurant on public.notifications(restaurant_id);
create index idx_notifications_pending on public.notifications(scheduled_for) where status = 'queued';
create index idx_notifications_customer on public.notifications(recipient_customer_id);
create index idx_notifications_user on public.notifications(recipient_user_id);

comment on table public.notifications is
  'Outbound message log across all channels. A background worker picks up status=queued rows (respecting scheduled_for) and dispatches via the matching channel adapter.';

-- ---------------------------------------------------------------------------
-- staff_notification_preferences: who on staff wants to hear about what.
-- Absence of a row = use the sensible platform default for that event type.
-- ---------------------------------------------------------------------------
create table public.staff_notification_preferences (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  event_type     text not null,      -- e.g. 'new_reservation', 'cancellation', 'vip_reservation', 'no_show'
  channel        public.notification_channel not null,
  is_enabled     boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (restaurant_id, user_id, event_type, channel)
);

create trigger trg_staff_notification_preferences_updated_at
  before update on public.staff_notification_preferences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- reminder_rules: automated guest reminders, e.g. "24h before" push +
-- "3h before" SMS. A restaurant can define as many as it wants.
-- ---------------------------------------------------------------------------
create table public.reminder_rules (
  id                    uuid primary key default gen_random_uuid(),
  restaurant_id         uuid not null references public.restaurants(id) on delete cascade,
  name                  text not null,
  minutes_before_start  int not null check (minutes_before_start > 0),
  channel               public.notification_channel not null,
  is_active             boolean not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger trg_reminder_rules_updated_at
  before update on public.reminder_rules
  for each row execute function public.set_updated_at();

create index idx_reminder_rules_restaurant on public.reminder_rules(restaurant_id) where is_active;
