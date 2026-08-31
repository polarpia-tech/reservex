-- =============================================================================
-- 0002_identity_and_tenancy.sql
-- Purpose: the multi-tenant backbone. One organization can own many
-- restaurants (locations). Every tenant-scoped table in later migrations
-- carries a restaurant_id that RLS policies (0011) key off.
-- =============================================================================

create type public.restaurant_type as enum (
  'restaurant', 'cafe', 'bar', 'club', 'beach_venue', 'hotel_venue', 'event_venue'
);

create type public.staff_role as enum (
  'owner', 'manager', 'reservation_manager', 'host', 'staff'
);

-- ---------------------------------------------------------------------------
-- organizations: the billing / account entity. "Restaurant Group" in the
-- product brief. Owns one or more restaurants.
-- ---------------------------------------------------------------------------
create table public.organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(trim(name)) > 0),
  owner_user_id    uuid not null references auth.users(id) on delete restrict,
  billing_email    citext,
  default_locale   text not null default 'en',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  deleted_at       timestamptz
);

create trigger trg_organizations_updated_at
  before update on public.organizations
  for each row execute function public.set_updated_at();

create index idx_organizations_owner on public.organizations(owner_user_id) where deleted_at is null;

comment on table public.organizations is
  'Billing/account entity. One organization can own many restaurants (multi-location groups).';

-- ---------------------------------------------------------------------------
-- restaurants: one physical venue/location. This is what the product brief
-- calls "Munich Restaurant", "Berlin Restaurant", "Munich Club", etc.
-- ---------------------------------------------------------------------------
create table public.restaurants (
  id                                uuid primary key default gen_random_uuid(),
  organization_id                   uuid not null references public.organizations(id) on delete cascade,
  name                              text not null check (char_length(trim(name)) > 0),
  slug                              text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  restaurant_type                   public.restaurant_type not null default 'restaurant',
  description                       text,
  description_i18n                  jsonb not null default '{}'::jsonb,   -- { "de": "...", "tr": "..." }
  logo_url                          text,
  cover_image_url                   text,
  gallery_image_urls                text[] not null default array[]::text[],
  address_line                      text,
  city                              text,
  postal_code                       text,
  country_code                      char(2),                              -- ISO 3166-1 alpha-2, e.g. 'DE', 'GR'
  phone                             text,
  email                             citext,
  website_url                       text,
  social_links                      jsonb not null default '{}'::jsonb,   -- { "instagram": "...", "facebook": "..." }
  timezone                          text not null default 'Europe/Athens', -- IANA tz name; authoritative local time
  default_locale                    text not null default 'el',
  supported_locales                 text[] not null default array['el','en'],
  seating_capacity_total            int,
  default_reservation_duration_min  int not null default 90 check (default_reservation_duration_min > 0),
  default_turnover_buffer_min       int not null default 15 check (default_turnover_buffer_min >= 0),
  min_party_size                    int not null default 1 check (min_party_size > 0),
  max_party_size                    int not null default 20 check (max_party_size >= min_party_size),
  booking_window_min_hours          int not null default 1,   -- earliest a customer may book (e.g. 1h ahead)
  booking_window_max_days           int not null default 60,  -- furthest a customer may book ahead
  is_active                         boolean not null default true,
  created_at                        timestamptz not null default now(),
  updated_at                        timestamptz not null default now(),
  deleted_at                        timestamptz
);

create trigger trg_restaurants_updated_at
  before update on public.restaurants
  for each row execute function public.set_updated_at();

create index idx_restaurants_org on public.restaurants(organization_id) where deleted_at is null;
create index idx_restaurants_active on public.restaurants(is_active) where deleted_at is null;

comment on table public.restaurants is
  'One physical venue/location. Every operational table below is scoped to a restaurant_id.';
comment on column public.restaurants.timezone is
  'IANA timezone name. This is the AUTHORITATIVE clock for all reservations at this restaurant, per the product brief.';

-- ---------------------------------------------------------------------------
-- restaurant_users: who can work at which restaurant, and in what role.
-- A single person (auth user) can belong to several restaurants -- e.g. a
-- roaming manager in a restaurant group, or a consultant.
-- ---------------------------------------------------------------------------
create table public.restaurant_users (
  id                    uuid primary key default gen_random_uuid(),
  restaurant_id         uuid not null references public.restaurants(id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  role                  public.staff_role not null,
  -- Fine-grained additive/subtractive permission overrides on top of the role
  -- default (e.g. {"reservations.cancel_bulk": false}). Deliberately NOT a
  -- full custom-RBAC engine yet -- that would be over-engineering for the
  -- MVP's 5 fixed roles. This column is the escape hatch for later.
  permission_overrides  jsonb not null default '{}'::jsonb,
  is_active             boolean not null default true,
  invited_at            timestamptz not null default now(),
  joined_at             timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (restaurant_id, user_id)
);

create trigger trg_restaurant_users_updated_at
  before update on public.restaurant_users
  for each row execute function public.set_updated_at();

create index idx_restaurant_users_user on public.restaurant_users(user_id) where is_active;
create index idx_restaurant_users_restaurant on public.restaurant_users(restaurant_id) where is_active;

comment on table public.restaurant_users is
  'Join table: which auth users can access which restaurant, and their role. A user row here per restaurant they work at.';
