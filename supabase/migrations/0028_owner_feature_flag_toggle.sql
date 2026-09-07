-- =============================================================================
-- 0028_owner_feature_flag_toggle.sql
-- Purpose: Phase 6 of "Live Availability, Smart Booking & Real-Time
-- Restaurant Experience" -- the first genuinely owner-facing piece: a
-- restaurant owner/manager can now turn 'live_availability' (Phase 3's
-- public per-time-slot availability widget) on for their OWN restaurant,
-- without needing a platform admin to do it from the admin dashboard.
--
-- Until now this flag defaulted OFF for every restaurant platform-wide
-- (0023, is_enabled_default = false) and only a platform admin could
-- override it, per restaurant or per organization, via
-- feature_flag_overrides_platform_write (0020) -- exactly as
-- apps/web/app/[locale]/r/[slug]/page.tsx's own comment already
-- anticipated when Phase 2 (0024) shipped the public resolution RPC:
-- "off for every restaurant until its owner (or a platform admin)
-- explicitly turns it on". This migration builds the owner half of that
-- sentence; the platform-admin half already existed.
--
-- Three things:
--   1. feature_flags.is_owner_configurable -- marks which flags a
--      restaurant owner/manager is allowed to toggle themselves, distinct
--      from flags that stay platform-admin-only (e.g. anything still in
--      private beta, or with no owner-facing meaning at all). Only
--      'live_availability' is marked true here -- the other four
--      Live-Availability-epic flags seeded alongside it in 0023
--      (waitlist_public, live_occupancy, last_minute_alerts,
--      popularity_indicator) have no real feature behind them yet, so
--      exposing an owner toggle for them now would be a switch that does
--      nothing when flipped. Each one gets is_owner_configurable = true
--      in its OWN phase's migration, once the feature it gates actually
--      exists -- never presenting a toggle that doesn't yet do anything.
--   2. Replace feature_flag_overrides_restaurant_owner_write (0023) with
--      the narrower feature_flag_overrides_owner_write below. 0023's own
--      policy let a restaurant owner/manager write ANY feature_flag_
--      overrides row scoped to their own restaurant_id -- for every flag,
--      not just the ones meant to be owner-facing. That was harmless in
--      practice (no code reads an override for the other four flags yet,
--      so writing one has zero observable effect), but it is the wrong
--      shape now that "owner-configurable" is a real, named concept: an
--      owner using the API directly (not the app UI) could otherwise set
--      an override for a flag this migration deliberately does NOT expose
--      a toggle for. RLS policies are PERMISSIVE (OR'd together), so
--      simply adding a narrower policy alongside the old broad one would
--      have accomplished nothing -- the broad one would still win. Since
--      migrations are forward-only, 0023's policy can't be edited in
--      place; it is dropped and superseded here instead.
--   3. feature_flag_overrides_owner_write -- the same "plain RLS CRUD"
--      shape as the platform's own feature_flag_overrides_platform_write
--      (0020; see that migration's own header comment for why a policy,
--      not a SECURITY DEFINER function, is the right tool for a
--      non-monetary, fully-reversible, no-auth.users-data write like this
--      one). Scoped to: the caller is owner/manager of the override's
--      restaurant_id, AND the flag being overridden is_owner_configurable.
--      restaurant_id is not null is part of the check deliberately, not
--      just for NULL-safety -- an owner may only ever affect their OWN
--      restaurant, never an organization-scoped override (which would
--      also affect every other restaurant in their organization); that
--      stays platform-admin-only.
-- =============================================================================

alter table public.feature_flags
  add column if not exists is_owner_configurable boolean not null default false;

comment on column public.feature_flags.is_owner_configurable is
  'True if a restaurant owner/manager may toggle this flag themselves for their own restaurant (feature_flag_overrides_owner_write, 0028). False (the default) keeps a flag platform-admin-only. Set true for a flag only once the feature it gates actually has real behavior wired up -- see this migration''s header comment.';

update public.feature_flags set is_owner_configurable = true where key = 'live_availability';

drop policy if exists feature_flag_overrides_restaurant_owner_write on public.feature_flag_overrides;

create policy feature_flag_overrides_owner_write on public.feature_flag_overrides for all
  using (
    restaurant_id is not null
    and has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[])
    and exists (select 1 from public.feature_flags ff where ff.id = flag_id and ff.is_owner_configurable)
  )
  with check (
    restaurant_id is not null
    and has_restaurant_role(restaurant_id, array['owner', 'manager']::public.staff_role[])
    and exists (select 1 from public.feature_flags ff where ff.id = flag_id and ff.is_owner_configurable)
  );

comment on policy feature_flag_overrides_owner_write on public.feature_flag_overrides is
  'Additive to feature_flag_overrides_select (0011, already scoped to the override''s own org owner/restaurant member) and feature_flag_overrides_platform_write (0020, platform-admin, any flag). Lets a restaurant owner/manager write ONLY a restaurant-scoped override, and ONLY for a flag marked is_owner_configurable -- never an organization-scoped override, never a platform-admin-only flag.';
