-- =============================================================================
-- 0006_reservations.sql
-- Purpose: THE core of the whole platform. A reservation, its assigned
-- table(s), and the database-level guarantee that two reservations can never
-- overlap on the same table -- enforced by Postgres itself, not application
-- code, so it holds even under concurrent requests.
-- =============================================================================

create type public.reservation_status as enum (
  'pending', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show'
);

create type public.reservation_source as enum (
  'app', 'web', 'widget', 'qr', 'phone', 'whatsapp', 'sms', 'walk_in', 'admin'
);

-- ---------------------------------------------------------------------------
-- reservations
-- ---------------------------------------------------------------------------
create table public.reservations (
  id                    uuid primary key default gen_random_uuid(),
  restaurant_id         uuid not null references public.restaurants(id) on delete cascade,
  customer_id           uuid references public.customers(id) on delete set null,
  event_id              uuid references public.events(id) on delete set null,

  status                public.reservation_status not null default 'pending',
  source                public.reservation_source not null default 'app',

  party_size            int not null check (party_size > 0),
  starts_at             timestamptz not null,
  ends_at               timestamptz not null check (ends_at > starts_at),
  -- Snapshot of the restaurant's turnover-buffer setting AT BOOKING TIME, so a
  -- later change to restaurant settings never silently rewrites past bookings.
  buffer_minutes        int not null default 0 check (buffer_minutes >= 0),

  zone_preference_id    uuid references public.table_zones(id) on delete set null,

  -- Guest details are captured on the reservation itself (not only on
  -- `customers`), because a booking can be taken for someone who never
  -- creates an account (phone call, walk-in typed in by staff).
  guest_name            text,
  guest_phone           text,
  guest_email           citext,
  special_requests      text,
  internal_notes        text,                 -- staff-only, never shown to the guest

  created_by_user_id    uuid references auth.users(id) on delete set null,
  created_by_ai         boolean not null default false,

  confirmed_at          timestamptz,
  seated_at             timestamptz,
  completed_at          timestamptz,
  cancelled_at          timestamptz,
  cancellation_reason   text,
  no_show_marked_at     timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint reservations_guest_identity_present
    check (customer_id is not null or guest_name is not null or guest_phone is not null)
);

create trigger trg_reservations_updated_at
  before update on public.reservations
  for each row execute function public.set_updated_at();

create index idx_reservations_restaurant_time on public.reservations(restaurant_id, starts_at);
create index idx_reservations_customer on public.reservations(customer_id);
create index idx_reservations_status on public.reservations(restaurant_id, status);
create index idx_reservations_event on public.reservations(event_id) where event_id is not null;

comment on table public.reservations is
  'One booking. May not yet have a table assigned (see reservation_tables) while status = pending.';

-- ---------------------------------------------------------------------------
-- reservation_tables: which physical table(s) are held for a reservation.
-- Several rows for one reservation = combined tables for a large party.
--
-- time_range and blocks_availability are DENORMALIZED from the parent
-- reservation (via the triggers below) purely so the EXCLUDE constraint can
-- see them -- Postgres exclusion constraints cannot reach into another
-- table. This is the single mechanism that makes double-booking impossible.
-- ---------------------------------------------------------------------------
create table public.reservation_tables (
  id                   uuid primary key default gen_random_uuid(),
  reservation_id       uuid not null references public.reservations(id) on delete cascade,
  table_id             uuid not null references public.tables(id) on delete restrict,
  restaurant_id        uuid not null references public.restaurants(id) on delete cascade,
  time_range           tstzrange not null,
  blocks_availability  boolean not null default true,
  created_at           timestamptz not null default now(),

  -- The actual double-booking guard: no two rows for the SAME table may have
  -- OVERLAPPING time_range while both still block availability. Cancelled /
  -- completed / no-show reservations (blocks_availability = false) are
  -- excluded, so history never blocks a new booking.
  exclude using gist (table_id with =, time_range with &&) where (blocks_availability)
);

create index idx_reservation_tables_reservation on public.reservation_tables(reservation_id);
create index idx_reservation_tables_table_time on public.reservation_tables using gist (table_id, time_range);

comment on table public.reservation_tables is
  'Assigns 1+ physical tables to a reservation. The EXCLUDE constraint here is the database-enforced double-booking guard.';

-- ---------------------------------------------------------------------------
-- Trigger: whenever a reservation_tables row is inserted, pull the
-- authoritative time/status data from its parent reservation.
-- ---------------------------------------------------------------------------
create or replace function public.reservation_tables_sync_from_reservation()
returns trigger
language plpgsql
as $$
declare
  r public.reservations%rowtype;
begin
  select * into r from public.reservations where id = new.reservation_id;
  if not found then
    raise exception 'reservation % does not exist', new.reservation_id;
  end if;

  new.restaurant_id := r.restaurant_id;
  new.time_range := tstzrange(r.starts_at, r.ends_at + make_interval(mins => r.buffer_minutes), '[)');
  new.blocks_availability := r.status in ('pending', 'confirmed', 'seated');
  return new;
end;
$$;

create trigger trg_reservation_tables_sync
  before insert on public.reservation_tables
  for each row execute function public.reservation_tables_sync_from_reservation();

-- ---------------------------------------------------------------------------
-- Trigger: whenever a reservation's time or status changes, propagate that
-- to every reservation_tables row that points at it (e.g. moving a
-- reservation from 20:00 to 21:00, or cancelling it frees the table).
-- ---------------------------------------------------------------------------
create or replace function public.reservations_propagate_to_tables()
returns trigger
language plpgsql
as $$
begin
  if (new.starts_at, new.ends_at, new.buffer_minutes, new.status)
     is distinct from (old.starts_at, old.ends_at, old.buffer_minutes, old.status)
  then
    update public.reservation_tables
       set time_range = tstzrange(new.starts_at, new.ends_at + make_interval(mins => new.buffer_minutes), '[)'),
           blocks_availability = new.status in ('pending', 'confirmed', 'seated')
     where reservation_id = new.id;
  end if;
  return new;
end;
$$;

create trigger trg_reservations_propagate
  after update on public.reservations
  for each row execute function public.reservations_propagate_to_tables();

-- ---------------------------------------------------------------------------
-- waitlist_entries: a reservation request with no table assigned yet,
-- waiting for one to free up.
-- ---------------------------------------------------------------------------
create type public.waitlist_status as enum (
  'waiting', 'notified', 'booked', 'expired', 'cancelled'
);

create table public.waitlist_entries (
  id                        uuid primary key default gen_random_uuid(),
  restaurant_id             uuid not null references public.restaurants(id) on delete cascade,
  customer_id               uuid references public.customers(id) on delete set null,
  guest_name                text,
  guest_phone               text,
  party_size                int not null check (party_size > 0),
  requested_date            date not null,
  requested_time_range      tstzrange not null,   -- the window the guest would accept, e.g. [19:00, 21:00)
  zone_preference_id        uuid references public.table_zones(id) on delete set null,
  status                    public.waitlist_status not null default 'waiting',
  priority_score            numeric not null default 0,
  notified_at               timestamptz,
  expires_at                timestamptz,
  converted_reservation_id  uuid references public.reservations(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create trigger trg_waitlist_entries_updated_at
  before update on public.waitlist_entries
  for each row execute function public.set_updated_at();

create index idx_waitlist_restaurant_status on public.waitlist_entries(restaurant_id, status, requested_date);

comment on table public.waitlist_entries is
  'A reservation request with no table yet. Notified in priority order when a matching table frees up.';
