-- =============================================================================
-- 0004_availability_and_events.sql
-- Purpose: when a restaurant is open (recurring + one-off overrides) and
-- special events with their own capacity/booking rules.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- opening_hours: recurring weekly schedule. Multiple rows per day are
-- allowed on purpose, to express split shifts (e.g. lunch 12:00-15:00 and
-- dinner 19:00-23:30 as two separate rows for the same day_of_week).
-- day_of_week: 0 = Sunday ... 6 = Saturday (matches JS Date#getDay()).
-- closes_at <= opens_at is allowed and means "crosses midnight" (clubs/bars).
-- ---------------------------------------------------------------------------
create table public.opening_hours (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  day_of_week    smallint not null check (day_of_week between 0 and 6),
  label          text,                      -- optional: 'lunch', 'dinner', 'happy hour'
  opens_at       time not null,
  closes_at      time not null,
  is_closed      boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger trg_opening_hours_updated_at
  before update on public.opening_hours
  for each row execute function public.set_updated_at();

create index idx_opening_hours_restaurant on public.opening_hours(restaurant_id, day_of_week);

comment on column public.opening_hours.closes_at is
  'If closes_at <= opens_at, the shift crosses midnight (e.g. a club open 22:00-04:00).';

-- ---------------------------------------------------------------------------
-- special_hours: one-off overrides for a specific calendar date (holidays,
-- reduced hours, closures). One row per date; if present it fully overrides
-- that date's recurring opening_hours.
-- ---------------------------------------------------------------------------
create table public.special_hours (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  date           date not null,
  opens_at       time,
  closes_at      time,
  is_closed      boolean not null default false,
  reason         text,                      -- e.g. "Easter Sunday", "Private buyout"
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (restaurant_id, date)
);

create trigger trg_special_hours_updated_at
  before update on public.special_hours
  for each row execute function public.set_updated_at();

create index idx_special_hours_restaurant_date on public.special_hours(restaurant_id, date);

-- ---------------------------------------------------------------------------
-- events: NYE, live music, private buyouts, etc. Events can carry their own
-- capacity and booking window, separate from normal service.
-- deposit_policy_id is added later by 0007 (payments), once that table exists.
-- ---------------------------------------------------------------------------
create table public.events (
  id                  uuid primary key default gen_random_uuid(),
  restaurant_id       uuid not null references public.restaurants(id) on delete cascade,
  name                text not null,
  description         text,
  description_i18n    jsonb not null default '{}'::jsonb,
  cover_image_url     text,
  starts_at           timestamptz not null,
  ends_at             timestamptz not null check (ends_at > starts_at),
  capacity            int check (capacity > 0),
  min_party_size      int,
  max_party_size      int,
  is_private          boolean not null default false,
  booking_opens_at    timestamptz,
  booking_closes_at   timestamptz,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create trigger trg_events_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

create index idx_events_restaurant_time on public.events(restaurant_id, starts_at) where deleted_at is null;
