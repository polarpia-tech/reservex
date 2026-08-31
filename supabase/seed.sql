-- =============================================================================
-- seed.sql
-- Demo data for local development: two independent restaurants (in two
-- different organizations, two different countries) so that multi-tenancy
-- and RLS isolation are visibly exercised, not just theoretical.
--
-- Fixed UUIDs on purpose, so this file is idempotent-ish and so the
-- verification script (scripts/verify_schema.sql) can reference the same ids.
-- Run via `supabase db reset` (which applies migrations then this file), or
-- directly with psql against a database that already has the migrations.
-- =============================================================================

-- ---- auth users (in real Supabase these already exist via auth.users) ------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner.athens@example.com'),   -- Owner, Ταβέρνα Ιθάκη
  ('22222222-2222-2222-2222-222222222222', 'owner.munich@example.com'),   -- Owner, Zur Alten Post
  ('33333333-3333-3333-3333-333333333333', 'manager.athens@example.com'), -- Manager, Ταβέρνα Ιθάκη
  ('44444444-4444-4444-4444-444444444444', 'maria@example.com')           -- Customer
on conflict (id) do nothing;

-- ---- organizations -----------------------------------------------------
insert into public.organizations (id, name, owner_user_id, billing_email, default_locale) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Ithaki Hospitality',  '11111111-1111-1111-1111-111111111111', 'owner.athens@example.com', 'el'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Alte Post GmbH',      '22222222-2222-2222-2222-222222222222', 'owner.munich@example.com', 'de');

-- ---- restaurants ---------------------------------------------------------
insert into public.restaurants (
  id, organization_id, name, slug, restaurant_type, city, country_code,
  timezone, default_locale, supported_locales, min_party_size, max_party_size
) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Ταβέρνα Ιθάκη', 'taverna-ithaki', 'restaurant', 'Athens', 'GR',
   'Europe/Athens', 'el', array['el','en'], 1, 14),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   'Zur Alten Post', 'zur-alten-post', 'restaurant', 'Munich', 'DE',
   'Europe/Berlin', 'de', array['de','en','tr'], 1, 20);

-- ---- staff -----------------------------------------------------------
insert into public.restaurant_users (restaurant_id, user_id, role, joined_at) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner', now()),
  ('bbbbbbbb-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'manager', now()),
  ('bbbbbbbb-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'owner', now());

-- ---- floor plan --------------------------------------------------------
insert into public.table_zones (id, restaurant_id, name, zone_type) values
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'Εσωτερικός χώρος', 'indoor'),
  ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'Αυλή', 'outdoor'),
  ('cccccccc-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002', 'Innenraum', 'indoor');

insert into public.tables (id, restaurant_id, zone_id, label, capacity_min, capacity_max) values
  ('dddddddd-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'T1', 2, 2),
  ('dddddddd-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002', 'T2', 4, 6),
  ('dddddddd-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003', 'B1', 2, 4);

-- ---- opening hours (Tue-Sun 12:00-16:00 & 19:00-23:30, closed Monday) -----
insert into public.opening_hours (restaurant_id, day_of_week, label, opens_at, closes_at, is_closed)
select 'bbbbbbbb-0000-0000-0000-000000000001'::uuid, d, 'lunch', '12:00'::time, '16:00'::time, false
from generate_series(0, 6) as d where d <> 1
union all
select 'bbbbbbbb-0000-0000-0000-000000000001'::uuid, d, 'dinner', '19:00'::time, '23:30'::time, false
from generate_series(0, 6) as d where d <> 1
union all
select 'bbbbbbbb-0000-0000-0000-000000000001'::uuid, 1, 'closed', '00:00'::time, '00:00'::time, true;

-- ---- a customer, seen by the Athens restaurant only -----------------------
insert into public.customers (id, auth_user_id, full_name, email, phone, preferred_locale) values
  ('eeeeeeee-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444',
   'Μαρία Παπαδοπούλου', 'maria@example.com', '+30 690 000 0000', 'el');

insert into public.restaurant_customers (restaurant_id, customer_id, visit_count, is_vip) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 3, false);

-- ---- one confirmed reservation, tomorrow 20:00-21:30 local, at table T2 --
insert into public.reservations (
  id, restaurant_id, customer_id, status, source, party_size,
  starts_at, ends_at, buffer_minutes, guest_name
) values (
  'ffffffff-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
  'eeeeeeee-0000-0000-0000-000000000001', 'confirmed', 'app', 4,
  (current_date + interval '1 day' + time '20:00') at time zone 'Europe/Athens',
  (current_date + interval '1 day' + time '21:30') at time zone 'Europe/Athens',
  15, 'Μαρία Παπαδοπούλου'
);

insert into public.reservation_tables (reservation_id, table_id) values
  ('ffffffff-0000-0000-0000-000000000001', 'dddddddd-0000-0000-0000-000000000002');
