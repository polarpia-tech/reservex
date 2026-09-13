-- =============================================================================
-- 0042_events_offers_public.sql
-- Purpose: Phase 20 (customer-facing Events & Offers). Two things:
--   1. `events` (existing since 0004, staff-only until now) gets a narrow
--      public read policy, same pattern as restaurants/opening_hours/
--      special_hours in 0014 -- only active, non-deleted, non-private events
--      of an active restaurant are visible to anon.
--   2. A brand new `offers` table (discounts/promotions -- "happy hour",
--      "20% off Tuesdays", etc.) with the same owner/manager/reservation_
--      manager write policy already used for `events`, plus its own public
--      read policy.
-- Deliberately NOT in this migration: ratings/reviews. That needs a
-- moderation story and a trust model (who may review, one review per
-- completed reservation, abuse prevention) that this PR did not scope --
-- see README "Τι ΔΕΝ χτίστηκε" for this phase.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Public read for events. Same narrow shape as 0014: only what a public
-- page needs to DISPLAY, nothing that leaks internal capacity/booking-window
-- planning detail beyond what's already in the row (this table has no
-- separate "private detail" column split, unlike tables/table_zones).
-- is_private events (buyouts, closed-door parties) are deliberately excluded
-- from public read -- they are not something a random visitor should see
-- advertised on the restaurant's own public page.
-- ---------------------------------------------------------------------------
create policy events_public_select on public.events for select
  using (
    is_active
    and deleted_at is null
    and not is_private
    and exists (
      select 1 from public.restaurants r
      where r.id = events.restaurant_id and r.deleted_at is null and r.is_active
    )
  );

-- ---------------------------------------------------------------------------
-- 2. offers: discounts/promotions a restaurant runs (e.g. "Happy Hour
-- 17:00-19:00", "20% off for parties of 6+"). Deliberately simpler than
-- `events`: no capacity/booking-window fields (an offer is not something a
-- guest reserves a slot for -- it's terms that apply to a normal
-- reservation), no cover_image_url column (mirrors why restaurants itself
-- doesn't have one yet, see Φάση 05's README note on Storage buckets not
-- being set up -- adding an image column with no working upload path
-- anywhere would invite exactly the "fake button that does nothing" the
-- project has avoided since Φάση 05).
-- valid_from/valid_until are both nullable: an offer with neither is a
-- standing/evergreen offer (e.g. a permanent "kids eat free on Sundays"),
-- not a bug -- the public query layer (packages/core) treats null as
-- "no bound on this side".
-- ---------------------------------------------------------------------------
create table public.offers (
  id                uuid primary key default gen_random_uuid(),
  restaurant_id     uuid not null references public.restaurants(id) on delete cascade,
  title             text not null,
  title_i18n        jsonb not null default '{}'::jsonb,
  description       text,
  description_i18n  jsonb not null default '{}'::jsonb,
  valid_from        timestamptz,
  valid_until       timestamptz check (valid_until is null or valid_from is null or valid_until > valid_from),
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

create trigger trg_offers_updated_at
  before update on public.offers
  for each row execute function public.set_updated_at();

create index idx_offers_restaurant on public.offers(restaurant_id) where deleted_at is null;

alter table public.offers enable row level security;

create policy offers_select on public.offers for select using (is_restaurant_member(restaurant_id));
create policy offers_write on public.offers for all
  using (has_restaurant_role(restaurant_id, array['owner', 'manager', 'reservation_manager']::public.staff_role[]))
  with check (has_restaurant_role(restaurant_id, array['owner', 'manager', 'reservation_manager']::public.staff_role[]));

-- Same narrow public-read shape as events_public_select above. An offer
-- outside its own [valid_from, valid_until] window is intentionally still
-- readable here (RLS only gates deleted_at/is_active/restaurant-active) --
-- the "is this currently valid" time check is a query-layer concern
-- (packages/core/src/api/offers.ts), same division of responsibility as
-- is_restaurant_open_at() being a separate concern from the opening_hours
-- read policy in 0014.
create policy offers_public_select on public.offers for select
  using (
    is_active
    and deleted_at is null
    and exists (
      select 1 from public.restaurants r
      where r.id = offers.restaurant_id and r.deleted_at is null and r.is_active
    )
  );
