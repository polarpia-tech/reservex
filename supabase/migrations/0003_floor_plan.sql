-- =============================================================================
-- 0003_floor_plan.sql
-- Purpose: zones, physical tables, and table combinations (joining tables
-- into one bookable unit for large parties).
-- =============================================================================

create type public.table_zone_type as enum (
  'indoor', 'outdoor', 'terrace', 'garden', 'bar',
  'vip', 'private_room', 'smoking', 'non_smoking', 'event'
);

create type public.table_shape as enum ('round', 'square', 'rectangle');

-- Table's own operational status. Deliberately separate from a reservation's
-- status (public.reservation_status, next migration) -- a table can be
-- "occupied" by a walk-in with no reservation at all.
create type public.table_status as enum (
  'available', 'reserved', 'seated', 'occupied', 'cleaning', 'blocked', 'out_of_service'
);

-- ---------------------------------------------------------------------------
-- table_zones
-- ---------------------------------------------------------------------------
create table public.table_zones (
  id             uuid primary key default gen_random_uuid(),
  restaurant_id  uuid not null references public.restaurants(id) on delete cascade,
  name           text not null,
  zone_type      public.table_zone_type not null default 'indoor',
  sort_order     int not null default 0,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create trigger trg_table_zones_updated_at
  before update on public.table_zones
  for each row execute function public.set_updated_at();

create index idx_table_zones_restaurant on public.table_zones(restaurant_id) where is_active;

-- ---------------------------------------------------------------------------
-- tables: the physical/bookable unit on the floor plan.
-- ---------------------------------------------------------------------------
create table public.tables (
  id              uuid primary key default gen_random_uuid(),
  restaurant_id   uuid not null references public.restaurants(id) on delete cascade,
  zone_id         uuid references public.table_zones(id) on delete set null,
  label           text not null,                    -- e.g. "T12", "Bar-3"
  capacity_min    int not null default 1 check (capacity_min > 0),
  capacity_max    int not null check (capacity_max >= capacity_min),
  is_vip          boolean not null default false,
  is_combinable   boolean not null default true,     -- can this table be merged with a neighbour?
  shape           public.table_shape not null default 'square',
  pos_x           numeric,                            -- floor-plan canvas coordinates (px or %, FE's choice)
  pos_y           numeric,
  width           numeric,
  height          numeric,
  rotation_deg    numeric not null default 0,
  status          public.table_status not null default 'available',
  is_active       boolean not null default true,      -- soft-disable ("temporarily disable tables")
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (restaurant_id, label)
);

create trigger trg_tables_updated_at
  before update on public.tables
  for each row execute function public.set_updated_at();

create index idx_tables_restaurant on public.tables(restaurant_id) where deleted_at is null;
create index idx_tables_zone on public.tables(zone_id);
create index idx_tables_status on public.tables(restaurant_id, status) where deleted_at is null;

comment on table public.tables is
  'One physical table. capacity_min/max drives smart allocation; status is live operational state for the floor view.';

-- ---------------------------------------------------------------------------
-- table_combinations: N physical tables merged into one bookable unit for a
-- large party (e.g. T4 + T5 -> "T4+T5", capacity 4-10).
-- ---------------------------------------------------------------------------
create table public.table_combinations (
  id                     uuid primary key default gen_random_uuid(),
  restaurant_id          uuid not null references public.restaurants(id) on delete cascade,
  name                   text not null,
  combined_capacity_min  int not null check (combined_capacity_min > 0),
  combined_capacity_max  int not null check (combined_capacity_max >= combined_capacity_min),
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create trigger trg_table_combinations_updated_at
  before update on public.table_combinations
  for each row execute function public.set_updated_at();

create table public.table_combination_members (
  combination_id  uuid not null references public.table_combinations(id) on delete cascade,
  table_id        uuid not null references public.tables(id) on delete cascade,
  primary key (combination_id, table_id)
);

create index idx_combo_members_table on public.table_combination_members(table_id);

comment on table public.table_combinations is
  'A named group of tables that can be booked together as one unit for large parties.';
