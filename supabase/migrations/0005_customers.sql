-- =============================================================================
-- 0005_customers.sql
-- Purpose: separate the customer's platform-wide identity (one login, can
-- book at any restaurant) from each restaurant's own CRM record about that
-- customer (visit history, VIP flag, notes) -- restaurants own their guest
-- relationship; the platform owns the login.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- customers: platform identity. auth_user_id is nullable on purpose -- staff
-- can create a reservation for a walk-in/phone customer who never signs up.
-- ---------------------------------------------------------------------------
create table public.customers (
  id                 uuid primary key default gen_random_uuid(),
  auth_user_id       uuid unique references auth.users(id) on delete set null,
  full_name          text,
  email              citext,
  phone              text,
  preferred_locale   text not null default 'en',
  marketing_opt_in   boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz
);

create trigger trg_customers_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

create unique index uidx_customers_auth_user on public.customers(auth_user_id) where auth_user_id is not null;
create index idx_customers_email on public.customers(email) where deleted_at is null;
create index idx_customers_phone on public.customers(phone) where deleted_at is null;

comment on table public.customers is
  'Platform-wide guest identity. Not restaurant-scoped: the same customer can book at many restaurants with one account.';

-- ---------------------------------------------------------------------------
-- restaurant_customers: the CRM record. One row per (restaurant, customer)
-- pair, created lazily on a guest's first reservation at that restaurant.
-- ---------------------------------------------------------------------------
create table public.restaurant_customers (
  id                    uuid primary key default gen_random_uuid(),
  restaurant_id         uuid not null references public.restaurants(id) on delete cascade,
  customer_id           uuid not null references public.customers(id) on delete cascade,
  display_name          text,               -- name as given at booking, may differ from account name
  is_vip                boolean not null default false,
  tags                  text[] not null default array[]::text[],
  notes                 text,               -- free-text staff notes ("allergic to shellfish", "regular, window seat")
  preferences           jsonb not null default '{}'::jsonb,  -- { "seating_zone": "outdoor", "occasions": [...] }
  visit_count           int not null default 0,
  no_show_count         int not null default 0,
  cancellation_count    int not null default 0,
  last_visit_at         timestamptz,
  first_seen_at         timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (restaurant_id, customer_id)
);

create trigger trg_restaurant_customers_updated_at
  before update on public.restaurant_customers
  for each row execute function public.set_updated_at();

create index idx_restaurant_customers_restaurant on public.restaurant_customers(restaurant_id);
create index idx_restaurant_customers_customer on public.restaurant_customers(customer_id);
create index idx_restaurant_customers_vip on public.restaurant_customers(restaurant_id) where is_vip;

comment on table public.restaurant_customers is
  'Per-restaurant CRM record: visit history, VIP status, notes and preferences. Keeps each restaurants guest data separate, per the products privacy-by-design principle.';
